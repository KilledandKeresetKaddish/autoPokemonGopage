#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# fetch.sh — dumb downloader. Its ONLY job is to pull raw bytes into data/raw/.
# Deciding WHAT to fetch, WHETHER it's needed today, and HOW to interpret the
# result is the AI agent's job (see AGENTS.md). Keep this script boring on
# purpose: the more logic lives here, the more it breaks when sources change.
#
# Usage:
#   scripts/fetch.sh list                  # show what's cached and how old
#   scripts/fetch.sh events raids ...       # fetch specific sources
#   scripts/fetch.sh all                    # fetch everything
#   scripts/fetch.sh url [--force|--max-age SECONDS|--cached|--info] [--meta] <URL...>
# Default url/--force downloads; --cached never downloads; --info prints metadata.
# --meta keeps the selected download/reuse behavior but prints metadata/path instead of
# the body. --max-age reuses a verified body only within that age. Failures return nonzero
# without printing stale content; --cached is an explicit last-good read.
#
# Several sources (Hub tier/event pages, pokébase, the official site) sit behind
# a Cloudflare "managed challenge" or heavy JS — a plain curl only gets the
# challenge/shell page. Those are fetched through a CF-solver, set by TIER_METHOD:
#   TIER_METHOD=jina          (default) https://r.jina.ai reader, zero install
#   TIER_METHOD=flaresolverr  self-hosted solver at $FLARESOLVERR_URL
#   TIER_METHOD=direct        plain curl (only works if the page is unprotected)
# ---------------------------------------------------------------------------
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAW="$ROOT/data/raw"
mkdir -p "$RAW"

UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
TIER_METHOD="${TIER_METHOD:-jina}"
JINA_PREFIX="${JINA_PREFIX:-https://r.jina.ai/}"
FLARESOLVERR_URL="${FLARESOLVERR_URL:-http://localhost:8191/v1}"

# Opt-in retry budget for transient transport failures. A run can set
# FETCH_RETRY_LIMIT=1 FETCH_RETRY_BUDGET=8; the default preserves one attempt.
FETCH_RETRY_LIMIT="${FETCH_RETRY_LIMIT:-0}"
[[ "$FETCH_RETRY_LIMIT" =~ ^[0-9]{1,2}$ ]] || { echo "FETCH_RETRY_LIMIT must be a small non-negative integer" >&2; exit 2; }
FETCH_RETRY_BUDGET="${FETCH_RETRY_BUDGET:-$((10#$FETCH_RETRY_LIMIT * 8))}"
[[ "$FETCH_RETRY_BUDGET" =~ ^[0-9]{1,4}$ ]] || { echo "FETCH_RETRY_BUDGET must be a non-negative integer" >&2; exit 2; }
FETCH_RETRY_DELAY="${FETCH_RETRY_DELAY:-0}"
[[ "$FETCH_RETRY_DELAY" =~ ^[0-9]+([.][0-9]+)?$ ]] || { echo "FETCH_RETRY_DELAY must be seconds" >&2; exit 2; }
RETRY_BUDGET_LEFT=$((10#$FETCH_RETRY_BUDGET))

# Optional per-run records deduplicate forced refreshes/failures without making
# failure state durable. POGO_RUN_ID is supplied by the daily wrapper.
FETCH_RUN_ID="${FETCH_RUN_ID:-${POGO_RUN_ID:-}}"
if [ -n "$FETCH_RUN_ID" ] && [[ ! "$FETCH_RUN_ID" =~ ^[A-Za-z0-9._-]{1,80}$ ]]; then
  echo "FETCH_RUN_ID must use only A-Z, a-z, 0-9, . _ - (max 80 chars)" >&2
  exit 2
fi
RUN_CACHE=""
if [ -n "$FETCH_RUN_ID" ]; then
  RUN_CACHE="$RAW/run-cache/$FETCH_RUN_ID"
  mkdir -p "$RUN_CACHE"
fi
FETCH_METRICS_FILE="${FETCH_METRICS_FILE:-}"

retry_transport() {
  local attempt=0 rc
  while :; do
    "$@"; rc=$?
    [ "$rc" = 0 ] && return 0
    if [ "$attempt" -ge "$FETCH_RETRY_LIMIT" ] || [ "$RETRY_BUDGET_LEFT" -le 0 ]; then
      return "$rc"
    fi
    attempt=$((attempt + 1)); RETRY_BUDGET_LEFT=$((RETRY_BUDGET_LEFT - 1))
    [ "$FETCH_RETRY_DELAY" = 0 ] || sleep "$FETCH_RETRY_DELAY"
  done
}

fetch_metric() {
  [ -n "$FETCH_METRICS_FILE" ] || return 0
  mkdir -p "$(dirname "$FETCH_METRICS_FILE")" 2>/dev/null || return 0
  jq -nc --arg time "$(date -u +%FT%TZ)" --arg runId "$FETCH_RUN_ID" \
    --arg url "$1" --arg outcome "$2" --arg mode "$3" --arg network "$4" \
    '{time:$time,runId:($runId | if length > 0 then . else null end),url:$url,outcome:$outcome,mode:$mode,network:($network == "1"),reused:($outcome == "success" and $network != "1")}' \
    >> "$FETCH_METRICS_FILE" 2>/dev/null || true
}

run_record_path() {
  [ -n "$RUN_CACHE" ] || return 1
  printf '%s/%s.json' "$RUN_CACHE" "$1"
}

run_record_outcome() {
  local key="$1" file
  file="$(run_record_path "$key")" || return 1
  jq -r --arg u "$2" 'select(.url == $u and (.outcome == "success" or .outcome == "failed")) | .outcome' "$file" 2>/dev/null
}

run_record() {
  local key="$1" url="$2" outcome="$3" reason="${4:-}" file tmp
  file="$(run_record_path "$key")" || return 0
  tmp="$(mktemp "$RUN_CACHE/.record.XXXXXX")" || return 0
  if jq -n --arg url "$url" --arg outcome "$outcome" --arg reason "$reason" \
      --arg time "$(date -u +%FT%TZ)" '{url:$url,outcome:$outcome,reason:$reason,time:$time}' > "$tmp" &&
     mv "$tmp" "$file"; then
    return 0
  fi
  rm -f "$tmp"
  return 0 # Metrics/dedup hints must never turn a verified fetch into a failure.
}

# source -> URL
declare -A URLS=(
  [events]="https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.json"
  [raids]="https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/raids.json"
  [eggs]="https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/eggs.json"
  [research]="https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/research.json"
  [gamemaster]="https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.min.json"
  [tiers-attackers]="https://pokemongohub.net/post/guide/max-attackers-tier-list/"
  [tiers-defenders]="https://pokemongohub.net/post/guide/max-defenders-tier-list/"
  [tiers-pokebase]="https://pokebase.app/pokemon-go/tier-lists"
  [events-hub]="https://pokemongohub.net/post/event/"
  [events-pokebase]="https://pokebase.app/pokemon-go"
  [events-official]="https://pokemongo.com/news"
)
# Rendered-page scrapes are .txt (markdown/HTML to parse); JSON sources stay .json.
declare -A EXT=(
  [tiers-attackers]=txt [tiers-defenders]=txt [tiers-pokebase]=txt
  [events-hub]=txt [events-pokebase]=txt [events-official]=txt
)   # default: json
# Route through the CF-solver (Jina/FlareSolverr) when the source needs a browser.
is_protected() { [[ "$1" == tiers-* || "$1" == events-hub || "$1" == events-pokebase || "$1" == events-official ]]; }
ext_of()  { echo "${EXT[$1]:-json}"; }
ALL=(events raids eggs research gamemaster tiers-attackers tiers-defenders tiers-pokebase events-hub events-pokebase events-official)

# Domains the agent may pull AD-HOC pages from via `fetch.sh url <URL>` (beyond the
# named sources above) — trusted Pokémon GO sources only, suffix-matched on host.
ALLOW_HOSTS=(leekduck.com pokemongohub.net db.pokemongohub.net pokebase.app pokemongo.com dialgadex.com raw.githubusercontent.com pvpoke.com pokeapi.co serebii.net pokemongo.fandom.com)

list_status() {
  # sha256 (16 hex) lets the agent compare against the hashes recorded in
  # committed data/state.json: identical bytes can reuse previous interpretation,
  # but detail-page checks and date-driven maintenance remain independent.
  for k in "${ALL[@]}"; do
    f="$RAW/$k.$(ext_of "$k")"
    if [ -f "$f" ]; then
      printf '%-18s cached %8sb  @ %s  sha256:%.16s\n' "$k" "$(wc -c <"$f")" \
        "$(date -u -r "$f" +%FT%TZ 2>/dev/null)" "$(sha256sum "$f" | cut -d' ' -f1)"
    else
      printf '%-18s (not fetched)\n' "$k"
    fi
  done
}

# Plain download (ScrapedDuck / PvPoke — clean, no bot protection).
fetch_plain() {
  local url="$1" tmp="$2"
  retry_transport curl -fsSL -A "$UA" -H 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8' \
       --compressed --max-time 90 "$url" -o "$tmp"
}

# Tier pages — route through a Cloudflare solver.
fetch_tier() {
  local url="$1" tmp="$2"
  case "$TIER_METHOD" in
    jina)
      retry_transport curl -fsSL --max-time 120 "${JINA_PREFIX}${url}" -o "$tmp" ;;
    flaresolverr)
      # Preserve the solver response check after transport retries: a 200 JSON
      # shell is not a usable named/detail body.
      retry_transport curl -fsS --max-time 150 -X POST "$FLARESOLVERR_URL" \
        -H 'Content-Type: application/json' \
        -d "$(jq -nc --arg u "$url" '{"cmd":"request.get","url":$u,"maxTimeout":120000}')" \
        | jq -r '.solution.response // empty' > "$tmp"
      [ -s "$tmp" ] ;;
    direct)
      fetch_plain "$url" "$tmp" ;;
    *)
      echo "unknown TIER_METHOD: $TIER_METHOD" >&2; return 2 ;;
  esac
}

# Detail pages are free-form prose, so reject only unambiguous gateway/challenge
# responses before they can become a last-good cache body.
DETAIL_BODY_REASON=""
check_detail_body() {
  local file="$1" prefix lower line check_rc=0
  local html_title_re error_line_re jina_warning_re ray_line_re
  DETAIL_BODY_REASON=""
  if [ ! -s "$file" ]; then
    DETAIL_BODY_REASON="empty response"
    return 1
  fi
  LC_ALL=C grep -q '[^[:space:]]' "$file" || check_rc=$?
  case "$check_rc" in
    0) ;;
    1) DETAIL_BODY_REASON="blank response"; return 1 ;;
    *) DETAIL_BODY_REASON="response whitespace inspection failed"; return 2 ;;
  esac
  if ! prefix="$(LC_ALL=C head -c 16384 "$file")"; then
    DETAIL_BODY_REASON="response prefix inspection failed"
    return 2
  fi
  lower="${prefix,,}"
  html_title_re='<title[^>]*>[[:space:]]*(just a moment(\.\.\.)?|attention required!?([[:blank:]]*\|[[:blank:]]*cloudflare)?|403[[:blank:]]+forbidden|access[[:blank:]]+denied|internal[[:blank:]]+server[[:blank:]]+error)[[:space:]]*</title>'
  if [[ "$lower" =~ $html_title_re ]]; then
    DETAIL_BODY_REASON="challenge or explicit error response"
    return 1
  fi
  error_line_re='^[[:blank:]]*(title:[[:blank:]]*)?(just a moment(\.\.\.)?|attention required!?([[:blank:]]*\|[[:blank:]]*cloudflare)?|403[[:blank:]]+forbidden|access[[:blank:]]+denied|internal[[:blank:]]+server[[:blank:]]+error)[[:blank:]]*$'
  jina_warning_re='^[[:blank:]]*(warning:[[:blank:]]*)?target[[:blank:]]+url[[:blank:]]+returned[[:blank:]]+error[[:blank:]]+(401|403|429|5[0-9][0-9])([[:blank:]]*:[[:blank:]].*)?[[:blank:]]*$'
  ray_line_re='^[[:blank:]]*cloudflare[[:blank:]]+ray[[:blank:]]+id([[:blank:]]*:[[:blank:]]*[[:alnum:]-]+)?[[:blank:]]*$'
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    if [[ "$line" =~ $error_line_re ]] || [[ "$line" =~ $jina_warning_re ]] ||
       [[ "$line" =~ $ray_line_re ]]; then
      DETAIL_BODY_REASON="challenge or explicit error response"
      return 1
    fi
  done <<< "$lower"
  # Solver/API error objects are rejected structurally. This intentionally reads
  # JSON only when the response itself starts as JSON, so prose that mentions
  # 403 or Cloudflare remains a valid article.
  if [[ "$lower" =~ ^[[:space:]]*\{ ]] &&
     jq -e 'type == "object" and (
       (.error? != null) or (.errors? != null) or (.success? == false) or
       ((.status? | tostring | ascii_downcase) | test("^(error|failed|failure)$")) or
       (.code? as $code | ($code | type) == "number" and $code >= 400 and (.message? | type == "string"))
     )' "$file" >/dev/null 2>&1; then
    DETAIL_BODY_REASON="structured solver/API error response"
    return 1
  fi
  return 0
}

fandom_wiki_title() {
  local path="$1" title
  [[ "$path" == /wiki/* ]] || return 1
  title="${path#/wiki/}"
  [ -n "$title" ] && [[ "$title" != *\\* ]] &&
    [[ "${title,,}" != *%00* ]] &&
    [[ "$title" =~ ^([^%]|%[0-9A-Fa-f]{2})*$ ]] || return 1
  title="$(printf '%b' "${title//%/\\x}")" || return 1
  title="${title//_/ }"
  [ -n "$title" ] || return 1
  printf '%s' "$title"
}

DETAIL_FETCH_REASON=""
fetch_fandom_wiki() {
  local title="$1" tmp="$2" api="$2.api"
  if ! retry_transport curl -fsSL -A "$UA" --compressed --max-time 90 --get \
      'https://pokemongo.fandom.com/api.php' \
      --data-urlencode 'action=parse' \
      --data-urlencode "page=$title" \
      --data-urlencode 'prop=text' \
      --data-urlencode 'format=json' \
      --data-urlencode 'formatversion=2' \
      -o "$api"; then
    rm -f "$api"
    DETAIL_FETCH_REASON="Fandom API request failed"
    return 1
  fi
  if ! jq -er '
      select(.error? == null)
      | .parse | select(type == "object")
      | select((.title | type) == "string" and (.title | length) > 0)
      | .text | select(type == "string" and length > 0)
    ' "$api" > "$tmp" 2>/dev/null; then
    rm -f "$api" "$tmp"
    DETAIL_FETCH_REASON="Fandom API returned no article body"
    return 1
  fi
  rm -f "$api"
}

SOURCE_BODY_REASON=""

# Named JSON feeds deliberately validate only their stable outer contract. Event
# dates are source facts and may be TBD, so item-level date checks belong to
# discovery rather than rejecting an otherwise useful feed generation.
check_named_json() {
  local name="$1" file="$2"
  SOURCE_BODY_REASON=""
  if ! jq empty "$file" >/dev/null 2>&1; then
    SOURCE_BODY_REASON="not valid JSON"
    return 1
  fi
  if jq -e 'type == "object" and (
      (.error? != null) or (.errors? != null) or (.success? == false) or
      ((.status? | tostring | ascii_downcase) | test("^(error|failed|failure)$"))
    )' "$file" >/dev/null 2>&1; then
    SOURCE_BODY_REASON="structured JSON error response"
    return 1
  fi
  case "$name" in
    events)
      # Keep item validation in discover: one identity-less/non-object row must
      # become an exception without throwing away its valid siblings or TBD dates.
      jq -e 'type == "array"' "$file" >/dev/null 2>&1 || {
        SOURCE_BODY_REASON="expected an events array"; return 1;
      } ;;
    raids)
      jq -e '(type == "array" and all(.[]; type == "object")) or
        (type == "object" and ([.[] | select(type == "array" or type == "object")] | length > 0))' "$file" >/dev/null 2>&1 || {
        SOURCE_BODY_REASON="expected a raid collection"; return 1;
      } ;;
    gamemaster)
      jq -e 'type == "object" and (.pokemon? | type == "array")' "$file" >/dev/null 2>&1 || {
        SOURCE_BODY_REASON="missing gamemaster pokemon array"; return 1;
      } ;;
    eggs|research)
      jq -e '(type == "array" and all(.[]; type == "object")) or type == "object"' "$file" >/dev/null 2>&1 || {
        SOURCE_BODY_REASON="expected JSON collection/object"; return 1;
      } ;;
  esac
  return 0
}

# Keep these intentionally small: they distinguish an index/list from a solver
# shell without freezing a third-party article layout into a brittle schema.
check_named_text_shape() {
  local name="$1" file="$2"
  case "$name" in
    events-hub)
      grep -Eqi 'https?://(www\.)?pokemongohub\.net/post/|\]\(/post/' "$file" || {
        SOURCE_BODY_REASON="Hub index has no article link"; return 1;
      } ;;
    events-official)
      grep -Eqi 'https?://(www\.)?pokemongo\.com/([[:alpha:]]{2}/)?(news|post)/[^[:space:]/]+|\]\(/([[:alpha:]]{2}/)?(news|post)/' "$file" || {
        SOURCE_BODY_REASON="official news index has no news/article link"; return 1;
      } ;;
    events-pokebase)
      grep -Eqi '(pokebase\.app|pok[eé]base|pokemon[[:space:]]+go)' "$file" || {
        SOURCE_BODY_REASON="Pokébase listing has no recognizable source content"; return 1;
      } ;;
    tiers-*)
      grep -Eqi '(tier|pokemon|pokémon)' "$file" || {
        SOURCE_BODY_REASON="tier source has no recognizable list content"; return 1;
      } ;;
  esac
  return 0
}

check_named_source() {
  local name="$1" file="$2" rc=0
  SOURCE_BODY_REASON=""
  if [ "$(ext_of "$name")" = json ]; then
    check_named_json "$name" "$file"
    return $?
  fi
  check_detail_body "$file" || rc=$?
  case "$rc" in
    0) ;;
    1) SOURCE_BODY_REASON="$DETAIL_BODY_REASON"; return 1 ;;
    *) SOURCE_BODY_REASON="$DETAIL_BODY_REASON"; return 2 ;;
  esac
  check_named_text_shape "$name" "$file"
}

verify_source() {
  local name="$1" max_age="$2" json="$3" out f stamp age=-1 hash="" valid=false fresh=false reason=""
  f="$RAW/$name.$(ext_of "$name")"
  if [ ! -s "$f" ]; then
    reason="cache missing or empty"
  else
    stamp="$(date -u -r "$f" +%s 2>/dev/null || echo 0)"
    age=$(( $(date -u +%s) - stamp ))
    if [ "$stamp" -le 0 ] || [ "$age" -lt 0 ]; then
      reason="cache timestamp invalid"
    else
      local check_rc=0
      check_named_source "$name" "$f" || check_rc=$?
      if [ "$check_rc" != 0 ]; then
        reason="$SOURCE_BODY_REASON"
      else
        valid=true
        hash="$(sha256sum "$f" | cut -d' ' -f1)"
        if [ "$max_age" -lt 0 ] || [ "$age" -lt "$max_age" ]; then
          fresh=true
        else
          reason="cache stale (${age}s; requires <${max_age}s)"
        fi
      fi
    fi
  fi
  if [ "$json" = 1 ]; then
    jq -n --arg name "$name" --arg path "$f" --arg reason "$reason" --arg hash "$hash" \
      --argjson age "$age" --argjson valid "$valid" --argjson fresh "$fresh" \
      '{name:$name,path:$path,valid:$valid,fresh:$fresh,ageSeconds:$age,sha256:($hash|if length>0 then . else null end),reason:($reason|if length>0 then . else null end)}'
  else
    if [ "$valid" = true ] && [ "$fresh" = true ]; then
      printf 'OK   %-18s %ss %s\n' "$name" "$age" "$f"
    else
      printf 'FAIL %-18s %s\n' "$name" "$reason" >&2
    fi
  fi
  [ "$valid" = true ] && [ "$fresh" = true ]
}

verify_sources() {
  local max_age=-1 json=0 rc=0 item_rc name
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --json) json=1; shift ;;
      --max-age)
        shift
        [[ "${1:-}" =~ ^[0-9]{1,9}$ ]] || { echo "verify --max-age requires seconds" >&2; return 2; }
        max_age=$((10#$1)); shift ;;
      --*) echo "unknown verify option: $1" >&2; return 2 ;;
      *) break ;;
    esac
  done
  [ "$#" -gt 0 ] || { echo "usage: fetch.sh verify [--json] [--max-age SECONDS] <source...>" >&2; return 2; }
  if [ "$json" = 1 ]; then
    printf '{"sources":['
    local first=1 record
    for name in "$@"; do
      [[ -n "${URLS[$name]:-}" ]] || { echo "unknown source: $name" >&2; return 2; }
      record="$(verify_source "$name" "$max_age" 1)"; item_rc=$?
      [ "$first" = 1 ] || printf ','; first=0
      printf '%s' "$record"
      [ "$item_rc" = 0 ] || rc=1
    done
    printf ']}\n'
  else
    for name in "$@"; do
      [[ -n "${URLS[$name]:-}" ]] || { echo "unknown source: $name" >&2; return 2; }
      verify_source "$name" "$max_age" 0 || rc=1
    done
  fi
  return "$rc"
}

fetch_one() {
  local name="$1" url="${URLS[$1]:-}"
  if [ -z "$url" ]; then echo "unknown source: $name" >&2; return 2; fi
  local out="$RAW/$name.$(ext_of "$name")" tmp ok=1 check_rc=0
  tmp="$(mktemp "$RAW/.fetch.${name}.XXXXXX")" || { echo "FAIL $name <- $url (cannot create temporary file)" >&2; return 1; }
  if is_protected "$name"; then fetch_tier "$url" "$tmp" || ok=0; else fetch_plain "$url" "$tmp" || ok=0; fi
  if [ "$ok" != 1 ]; then
    rm -f "$tmp"
    echo "FAIL $name  <- $url (download failed; kept last good)" >&2
    return 1
  fi
  check_named_source "$name" "$tmp" || check_rc=$?
  if [ "$check_rc" != 0 ]; then
    rm -f "$tmp"
    echo "FAIL $name  <- $url ($SOURCE_BODY_REASON; kept last good)" >&2
    return 1
  fi
  if ! mv "$tmp" "$out"; then
    rm -f "$tmp"
    echo "FAIL $name  <- $url (atomic cache replacement failed; kept last good)" >&2
    return 1
  fi
  echo "OK   $name  $(wc -c <"$out")b  -> data/raw/$(basename "$out")"
}

# --- verified 简体中文 name lookup, cached forever ---------------------------
# fetch.sh zh <dexId|species-slug|move:<move-slug>> ...
# One TSV line per query: "<key>\t<en>\t<zh-Hans|NO-ZH-NAME>". Answers come from
# the local dictionary data/raw/zh-names.json; PokeAPI is queried only on first
# sight of a key (names never change), so a verification costs one line of
# context instead of a 50-100KB species JSON dump via `fetch.sh url`.
ZH_DICT="$RAW/zh-names.json"
zh_lookup() {
  local key="$1" url tmp row entry
  [[ "$key" =~ ^(move:)?[a-z0-9-]+$ ]] || { echo "FAIL zh: bad key '$key' (use a dex id, species slug, or move:<move-slug>)" >&2; return 2; }
  [ -s "$ZH_DICT" ] || echo '{}' > "$ZH_DICT"
  row="$(jq -r --arg k "$key" '.[$k] // empty | [$k, .en, (.zh // "NO-ZH-NAME")] | @tsv' "$ZH_DICT" 2>/dev/null)"
  if [ -n "$row" ]; then printf '%s\n' "$row"; return 0; fi
  if [[ "$key" == move:* ]]; then url="https://pokeapi.co/api/v2/move/${key#move:}/"
  else url="https://pokeapi.co/api/v2/pokemon-species/$key/"; fi
  tmp="$(mktemp)"
  if fetch_plain "$url" "$tmp" && jq empty "$tmp" >/dev/null 2>&1; then
    entry="$(jq -c '{en: .name, zh: (first(.names[]? | select(.language.name == "zh-Hans") | .name) // null)}' "$tmp" 2>/dev/null)"
    if [ -n "$entry" ] && [ "$entry" != null ]; then
      jq --arg k "$key" --argjson e "$entry" '.[$k] = $e' "$ZH_DICT" > "$tmp.d" && mv "$tmp.d" "$ZH_DICT"
      rm -f "$tmp"
      jq -rn --arg k "$key" --argjson e "$entry" '[$k, $e.en, ($e.zh // "NO-ZH-NAME")] | @tsv'
      return 0
    fi
  fi
  rm -f "$tmp"
  echo "FAIL zh $key  <- $url" >&2
  return 1
}

# Ad-hoc single-page fetch, restricted to ALLOW_HOSTS. Prints the page to stdout
# (site domains go through the CF-solver; raw file/API hosts via plain curl).
detail_metadata() {
  local meta="$1" body="$2" age="$3"
  jq --arg path "$body" --argjson age "$age" '. + {path:$path, ageSeconds:$age, stale:($age >= 86400)}' "$meta"
}

emit_detail() {
  local meta="$1" body="$2" age="$3"
  if [ "${URL_OUTPUT:-body}" = meta ]; then
    detail_metadata "$meta" "$body" "$age"
  else
    cat "$body"
  fi
}

fetch_url() {
  local url="$1" host authority rest
  # Must be an explicit http(s) URL.
  [[ "$url" =~ ^https?:// ]] || { echo "REFUSED non-http(s) URL: $url" >&2; return 2; }
  # Authority = chars after scheme up to the first /, ? or #.
  rest="${url#*://}"; authority="${rest%%/*}"; authority="${authority%%\?*}"; authority="${authority%%\#*}"
  # Reject userinfo — `host:x@evil.com` would otherwise smuggle a different real
  # host past the allowlist (curl connects to the part after @).
  if [[ "$authority" == *@* ]]; then echo "REFUSED URL with userinfo '@': $url" >&2; return 2; fi
  host="${authority%%:*}"   # strip :port
  local ok=0 d
  for d in "${ALLOW_HOSTS[@]}"; do
    [[ "$host" == "$d" || "$host" == *."$d" ]] && { ok=1; break; }
  done
  if [ "$ok" != 1 ]; then echo "REFUSED off-allowlist host: ${host:-?}  ($url)" >&2; return 2; fi
  # Image URLs (sprite / form-art existence checks): don't pipe pixels through
  # the Jina reader or cat raw bytes to the terminal — do a HEAD request and
  # report status + type + size. 2xx + content-type image/* = the image exists.
  case "${url%%\?*}" in
    *.png|*.webp|*.jpg|*.jpeg|*.gif)
      if [ "$URL_MODE" = cached ] || [ "$URL_MODE" = info ] || [ "${URL_OUTPUT:-body}" = meta ]; then
        echo "Image has no body cache/metadata; use url for HEAD: $url" >&2; return 2
      fi
      if retry_transport curl -fsSIL -A "$UA" --max-time 45 "$url" | tr -d '\r' \
           | grep -iE '^(HTTP/|content-type:|content-length:)'; then
        fetch_metric "$url" success "$URL_MODE" 1
        return 0
      else
        fetch_metric "$url" failed "$URL_MODE" 1
        echo "FAIL url <- $url  (image HEAD failed — image likely absent)" >&2; return 1
      fi ;;
  esac
  local key meta body hash stamp age tmp old_body invalid_body cache_reason path title check_rc run_outcome emit_rc=0
  local body_new=0 body_preexisting=0
  key="$(printf '%s' "$url" | sha256sum | cut -d' ' -f1)"
  mkdir -p "$RAW/details"
  meta="$RAW/details/$key.json"
  body=""; age=-1; invalid_body=""; cache_reason=""
  # Metadata is the atomic pointer to an immutable, content-addressed plain body.
  # A matching hash is necessary but not enough: old challenge pages must not hit.
  if jq -e --arg u "$url" '.url == $u and (.sha256 | test("^[a-f0-9]{64}$"))
      and (.lastFetch | type == "string")' "$meta" >/dev/null 2>&1; then
    hash="$(jq -r .sha256 "$meta")"
    body="$RAW/details/$key.$hash.txt"
    stamp="$(date -u -d "$(jq -r .lastFetch "$meta")" +%s 2>/dev/null || echo 0)"
    age=$(( $(date -u +%s) - stamp ))
    if [ "$stamp" -le 0 ] || [ "$age" -lt 0 ] || [ ! -s "$body" ] ||
       [ "$(sha256sum "$body" 2>/dev/null | cut -d' ' -f1)" != "$hash" ]; then
      body=""; age=-1
    else
      check_rc=0; check_detail_body "$body" || check_rc=$?
      case "$check_rc" in
        0) ;;
        1) invalid_body="$body"; cache_reason="$DETAIL_BODY_REASON"; body=""; age=-1 ;;
        *) echo "FAIL detail cache inspection: $url ($DETAIL_BODY_REASON; cache unchanged; no body)" >&2; fetch_metric "$url" failed "$URL_MODE" 0; return 1 ;;
      esac
    fi
  fi
  if [ "$URL_MODE" = info ] || [ "$URL_MODE" = cached ]; then
    [ -n "$body" ] || { echo "MISS/INVALID detail cache: $url${cache_reason:+ ($cache_reason)}" >&2; fetch_metric "$url" failed "$URL_MODE" 0; return 1; }
    if [ "$URL_MODE" = info ]; then
      detail_metadata "$meta" "$body" "$age"; emit_rc=$?
    else
      echo "CACHED last-successful body (${age}s), not a refresh: $url" >&2
      [ "$age" -lt 86400 ] || echo "STALE explicit last-good read (${age}s): $url" >&2
      emit_detail "$meta" "$body" "$age"; emit_rc=$?
    fi
    fetch_metric "$url" success "$URL_MODE" 0
    return "$emit_rc"
  fi

  # A run record only lives under an explicit run ID. It collapses repeated
  # force/retry calls while allowing a later run to retry the URL normally.
  run_outcome="$(run_record_outcome "$key" "$url" 2>/dev/null || true)"
  if [ "$run_outcome" = failed ]; then
    echo "FAIL url <- $url (same-run refresh already failed; no retry in this run)" >&2
    fetch_metric "$url" failed "$URL_MODE" 0
    return 1
  fi
  if [ "$run_outcome" = success ] && [ -n "$body" ]; then
    emit_detail "$meta" "$body" "$age"; emit_rc=$?
    fetch_metric "$url" success "$URL_MODE" 0
    return "$emit_rc"
  fi
  if [ "$URL_MODE" = age ] && [ -n "$body" ] && [ "$age" -lt "$URL_MAX_AGE" ]; then
    emit_detail "$meta" "$body" "$age"; emit_rc=$?
    fetch_metric "$url" success "$URL_MODE" 0
    return "$emit_rc"
  fi

  old_body="$body"
  tmp="$(mktemp "$RAW/details/.fetch.XXXXXX")" || { fetch_metric "$url" failed "$URL_MODE" 0; return 1; }
  local fetched=0
  DETAIL_FETCH_REASON=""
  if [[ "$rest" == */* ]]; then
    path="/${rest#*/}"; path="${path%%\?*}"; path="${path%%\#*}"
  else
    path=""
  fi
  case "$host" in
    raw.githubusercontent.com|*.githubusercontent.com|pokeapi.co|*.pokeapi.co)
      fetch_plain "$url" "$tmp" && fetched=1 ;;
    pokemongo.fandom.com)
      if [[ "$path" == /wiki/* ]] && title="$(fandom_wiki_title "$path")"; then
        fetch_fandom_wiki "$title" "$tmp" && fetched=1
      else
        DETAIL_FETCH_REASON="invalid Fandom wiki title"
      fi ;;
    *) fetch_tier "$url" "$tmp" && fetched=1 ;;
  esac
  if [ "$fetched" != 1 ]; then
    rm -f "$tmp"
    run_record "$key" "$url" failed "${DETAIL_FETCH_REASON:-refresh failed}"
    fetch_metric "$url" failed "$URL_MODE" 1
    echo "FAIL url <- $url (refresh failed${DETAIL_FETCH_REASON:+: $DETAIL_FETCH_REASON}; last good cache unchanged; no fresh body)" >&2
    return 1
  fi
  check_rc=0; check_detail_body "$tmp" || check_rc=$?
  case "$check_rc" in
    0) ;;
    1)
      rm -f "$tmp"
      run_record "$key" "$url" failed "$DETAIL_BODY_REASON"
      fetch_metric "$url" failed "$URL_MODE" 1
      echo "FAIL url <- $url (rejected detail body: $DETAIL_BODY_REASON; last good cache unchanged; no fresh body)" >&2
      return 1 ;;
    *)
      rm -f "$tmp"
      run_record "$key" "$url" failed "$DETAIL_BODY_REASON"
      fetch_metric "$url" failed "$URL_MODE" 1
      echo "FAIL url <- $url (detail body inspection failed: $DETAIL_BODY_REASON; last good cache unchanged; no fresh body)" >&2
      return 1 ;;
  esac
  hash="$(sha256sum "$tmp" | cut -d' ' -f1)"
  body="$RAW/details/$key.$hash.txt"
  if ! jq -n --arg url "$url" --arg time "$(date -u +%FT%TZ)" --arg hash "$hash" \
      '{url:$url,lastFetch:$time,sha256:$hash}' > "$tmp.meta"; then
    rm -f "$tmp" "$tmp.meta"
    run_record "$key" "$url" failed "metadata generation failed"
    fetch_metric "$url" failed "$URL_MODE" 1
    echo "FAIL detail cache write: $url" >&2; return 1
  fi
  if [ -e "$body" ]; then
    if [ "$(sha256sum "$body" 2>/dev/null | cut -d' ' -f1)" = "$hash" ]; then
      body_preexisting=1
      rm -f "$tmp"
    fi
  fi
  if [ "$body_preexisting" = 0 ]; then
    if ! mv "$tmp" "$body"; then
      rm -f "$tmp" "$tmp.meta"
      run_record "$key" "$url" failed "body replacement failed"
      fetch_metric "$url" failed "$URL_MODE" 1
      echo "FAIL detail cache write: $url" >&2; return 1
    fi
    body_new=1
  fi
  if ! mv "$tmp.meta" "$meta"; then
    [ "$body_new" = 1 ] && rm -f "$body"
    rm -f "$tmp" "$tmp.meta"
    run_record "$key" "$url" failed "metadata replacement failed"
    fetch_metric "$url" failed "$URL_MODE" 1
    echo "FAIL detail cache write: $url" >&2; return 1
  fi
  [ -z "$old_body" ] || [ "$old_body" = "$body" ] || rm -f "$old_body"
  [ -z "$invalid_body" ] || [ "$invalid_body" = "$body" ] || rm -f "$invalid_body"
  run_record "$key" "$url" success
  fetch_metric "$url" success "$URL_MODE" 1
  emit_detail "$meta" "$body" 0
}

[ $# -eq 0 ] && { echo "usage: fetch.sh <list|verify|all|zh <key...>|url <URL...>|${ALL[*]}>"; exit 1; }
case "$1" in
  list)      list_status; exit 0 ;;
  verify)    shift; verify_sources "$@"; exit $? ;;
  -h|--help) echo "sources: ${ALL[*]}"; echo "names:   fetch.sh zh <dexId|species-slug|move:<move-slug>>...  (cached 简体中文 lookup)"; echo "verify:  fetch.sh verify [--json] [--max-age SECONDS] <source...>  (no network)"; echo "ad-hoc:  fetch.sh url [--force|--max-age SECONDS|--cached|--info] [--meta] <URL...>  (hosts: ${ALLOW_HOSTS[*]})"; exit 0 ;;
  zh)        shift; [ $# -eq 0 ] && { echo "usage: fetch.sh zh <dexId|species-slug|move:<move-slug>>..." >&2; exit 1; }
             rc=0; for k in "$@"; do zh_lookup "$k" || rc=1; done; exit $rc ;;
  url)       shift
             URL_MODE=force; URL_MAX_AGE=86400; URL_OUTPUT=body
             while [ "$#" -gt 0 ]; do
               case "$1" in
                 --force) URL_MODE=force; shift ;;
                 --cached|--info) URL_MODE="${1#--}"; shift ;;
                 --meta|--path) URL_OUTPUT=meta; shift ;;
                 --max-age)
                   URL_MODE=age; shift
                   [[ "${1:-}" =~ ^[0-9]{1,9}$ ]] || { echo "--max-age requires seconds (0..999999999)" >&2; exit 2; }
                   URL_MAX_AGE=$((10#$1)); shift ;;
                 --*) echo "unknown url option: $1" >&2; exit 2 ;;
                 *) break ;;
               esac
             done
             [ $# -eq 0 ] && { echo "usage: fetch.sh url [--force|--max-age SECONDS|--cached|--info] [--meta] <URL...>" >&2; exit 1; }
             rc=0; for u in "$@"; do fetch_url "$u" || rc=1; done; exit $rc ;;
  all)       set -- "${ALL[@]}" ;;
esac

rc=0
for s in "$@"; do fetch_one "$s" || rc=1; done
exit $rc
