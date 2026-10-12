#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# discover.sh — find candidate source URLs and detect new feed/index entries.
#
# Default output remains TSV for interactive use. Add --json for a versioned
# report with per-source availability/coverage, leads, pending dates, exceptions
# and gaps. Exit 0=complete, 1=partial (usable rows were still emitted),
# 2=failed/usage. Only complete + completeNoNew is a quiet-day result.
#
#   scripts/discover.sh "keywords"            # search trusted sources
#   scripts/discover.sh --json "keywords"     # machine-readable search report
#   scripts/discover.sh new --cached --json    # zero-network prepared scan
#   scripts/discover.sh new                    # independently refreshes sources
# ---------------------------------------------------------------------------
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
FETCH="$ROOT/scripts/fetch.sh"
REPORTER="$ROOT/scripts/discovery-report.js"
RAW="$ROOT/data/raw"
DISC="$RAW/discovery"
DISCOVER_METRICS_FILE="${DISCOVER_METRICS_FILE:-}"
mkdir -p "$DISC"
discover_metric() {
  [ -n "$DISCOVER_METRICS_FILE" ] || return 0
  jq -nc --arg kind "$1" --arg source "$2" --arg outcome "$3" --arg network "$4" \
    '{kind:$kind,source:$source,outcome:$outcome,network:($network == "1"),reused:($outcome == "success" and $network != "1")}' \
    >> "$DISCOVER_METRICS_FILE" 2>/dev/null || : > "${DISCOVER_METRICS_FILE}.error" 2>/dev/null || true
}
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

[ -f "$REPORTER" ] || { echo "discover: FAILED — missing report helper: $REPORTER" >&2; exit 2; }

# Optional run-scoped cache collapses repeated keyword searches and fetch.sh
# force failures without making a transient failure durable across the next run.
DISCOVER_RUN_ID="${DISCOVER_RUN_ID:-${POGO_RUN_ID:-}}"
if [ -n "$DISCOVER_RUN_ID" ] && [[ ! "$DISCOVER_RUN_ID" =~ ^[A-Za-z0-9._-]{1,80}$ ]]; then
  echo "DISCOVER_RUN_ID must use only A-Z, a-z, 0-9, . _ - (max 80 chars)" >&2
  exit 2
fi
RUN_CACHE=""
if [ -n "$DISCOVER_RUN_ID" ]; then
  RUN_CACHE="$DISC/run-cache/$DISCOVER_RUN_ID"
  mkdir -p "$RUN_CACHE"
  export FETCH_RUN_ID="${FETCH_RUN_ID:-$DISCOVER_RUN_ID}"
fi

# Optional, bounded retry for the one direct MediaWiki search request. fetch.sh
# owns retry policy for named/detail fetches.
DISCOVER_RETRY_LIMIT="${DISCOVER_RETRY_LIMIT:-0}"
[[ "$DISCOVER_RETRY_LIMIT" =~ ^[0-9]{1,2}$ ]] || { echo "DISCOVER_RETRY_LIMIT must be a small non-negative integer" >&2; exit 2; }
DISCOVER_RETRY_BUDGET="${DISCOVER_RETRY_BUDGET:-$((10#$DISCOVER_RETRY_LIMIT * 8))}"
[[ "$DISCOVER_RETRY_BUDGET" =~ ^[0-9]{1,4}$ ]] || { echo "DISCOVER_RETRY_BUDGET must be a non-negative integer" >&2; exit 2; }
DISCOVER_RETRY_DELAY="${DISCOVER_RETRY_DELAY:-0}"
[[ "$DISCOVER_RETRY_DELAY" =~ ^[0-9]+([.][0-9]+)?$ ]] || { echo "DISCOVER_RETRY_DELAY must be seconds" >&2; exit 2; }
DISCOVER_RETRY_LEFT=$((10#$DISCOVER_RETRY_BUDGET))
retry_discover_transport() {
  local attempt=0 rc
  while :; do
    "$@"; rc=$?
    [ "$rc" = 0 ] && return 0
    if [ "$attempt" -ge "$DISCOVER_RETRY_LIMIT" ] || [ "$DISCOVER_RETRY_LEFT" -le 0 ]; then return "$rc"; fi
    attempt=$((attempt + 1)); DISCOVER_RETRY_LEFT=$((DISCOVER_RETRY_LEFT - 1))
    discover_metric retry fandom-search retry 1
    [ "$DISCOVER_RETRY_DELAY" = 0 ] || sleep "$DISCOVER_RETRY_DELAY"
  done
}

usage() {
  echo 'usage: scripts/discover.sh [--json] "<keywords>" | scripts/discover.sh new [--cached] [--json]' >&2
}

save_atomic() {
  local input="$1" output="$2" tmp
  tmp="$(mktemp "$DISC/.write.XXXXXX")" || return 1
  if cat "$input" > "$tmp" && mv "$tmp" "$output"; then return 0; fi
  rm -f "$tmp"
  return 1
}

report_exit() {
  case "$(jq -r '.status // "failed"' "$1" 2>/dev/null)" in
    complete) return 0 ;;
    partial) return 1 ;;
    *) return 2 ;;
  esac
}

report_summary() {
  local report="$1" prefix="$2" output="$3" status empty
  status="$(jq -r '.status // "failed"' "$report")"
  if [ -n "$DISCOVER_METRICS_FILE" ]; then
    jq -c '{kind:"coverage",status,sources:(.sources // null)}' "$report" >> "$DISCOVER_METRICS_FILE" 2>/dev/null || : > "${DISCOVER_METRICS_FILE}.error" 2>/dev/null || true
  fi
  case "$status" in
    complete)
      empty="$(jq -r '.completeNoNew // .completeNoCandidates // false' "$report")"
      if [ "$empty" = true ]; then
        echo "$prefix: COMPLETE — complete coverage, no new candidates." >&2
      else
        echo "$prefix: COMPLETE — candidate report -> ${output#$ROOT/}" >&2
      fi ;;
    partial)
      echo "$prefix: PARTIAL — usable candidates/leads were emitted; inspect sources, pendingDate, exceptions and gaps in ${output#$ROOT/}. Do not call this a quiet day." >&2 ;;
    *)
      echo "$prefix: FAILED — no complete coverage; inspect source failures/gaps in ${output#$ROOT/}. This is not a no-candidate result." >&2 ;;
  esac
}

RENDER_OUTPUT=""
render_report() {
  # render_report REPORT STEM FORMAT WORKDIR; stdout is the requested contract.
  local report="$1" stem="$2" format="$3" work="$4" json_out="$stem.json" text_out="$stem.txt"
  save_atomic "$report" "$json_out" || { echo "discover: FAILED — cannot save machine-readable report: $json_out" >&2; return 2; }
  if [ "$format" = json ]; then
    cat "$json_out" || return 2
    RENDER_OUTPUT="$json_out"
    return 0
  fi
  if ! node "$REPORTER" tsv --input "$json_out" > "$work/rows"; then
    echo "discover: FAILED — cannot render TSV report" >&2
    return 2
  fi
  # tee is intentional: a write failure must not be mistaken for an empty scan.
  if ! tee "$text_out" < "$work/rows"; then
    echo "discover: FAILED — cannot save TSV report: $text_out" >&2
    return 2
  fi
  RENDER_OUTPUT="$text_out"
}

mark_refresh_failures() {
  local verify="$1" tmp name
  shift
  for name in "$@"; do
    tmp="$(mktemp "$DISC/.verify.XXXXXX")" || return 1
    if jq --arg n "$name" '(.sources[] | select(.name == $n)).refreshFailed = true' "$verify" > "$tmp" && mv "$tmp" "$verify"; then :; else rm -f "$tmp"; return 1; fi
  done
}

new_mode() {
  local cached=0 format=tsv arg refresh_failed=() refresh_rc=0 work verify report today upper stamp stem output rc
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --cached) cached=1 ;;
      --json) format=json ;;
      *) usage; return 2 ;;
    esac
    shift
  done
  work="$(mktemp -d "$DISC/.new.XXXXXX")" || { echo 'discover new: FAILED — cannot create work directory' >&2; return 2; }
  trap 'rm -rf "$work"' RETURN
  if [ "$cached" = 0 ]; then
    # Refresh every required primary independently. A failure cannot stop a
    # still-usable sibling from producing leads in the final report.
    for arg in events events-hub events-official; do
      "$FETCH" "$arg" >/dev/null || { refresh_failed+=("$arg"); refresh_rc=1; }
    done
  fi
  if ! "$FETCH" verify --json --max-age 86400 events events-hub events-official > "$work/verify"; then
    # verify still emits a complete per-source JSON array on ordinary failures.
    [ -s "$work/verify" ] || printf '{"sources":[]}' > "$work/verify"
  fi
  [ "${#refresh_failed[@]}" = 0 ] || mark_refresh_failures "$work/verify" "${refresh_failed[@]}" || {
    echo 'discover new: FAILED — cannot record refresh failure status' >&2; return 2;
  }
  today="$(date -u +%F)"
  upper="$(date -u -d "$(date -u +%Y-%m-01) +2 months" +%F 2>/dev/null || echo 9999-12-31)"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  if ! node "$REPORTER" new --verify "$work/verify" --feed "$RAW/events.json" --hub "$RAW/events-hub.txt" \
      --official "$RAW/events-official.txt" --calendar "$ROOT/public/data/events.json" --today "$today" --upper "$upper" \
      --generated-at "$(date -u +%FT%TZ)" > "$work/report"; then
    echo 'discover new: FAILED — report extraction failed' >&2
    return 2
  fi
  stem="$DISC/new-$stamp"
  render_report "$work/report" "$stem" "$format" "$work" || return $?
  output="$RENDER_OUTPUT"
  report_summary "$work/report" 'discover new' "$output"
  report_exit "$work/report"; rc=$?
  # A default refresh error is represented in the report; do not discard
  # candidates just because it returns partial/nonzero.
  [ "$refresh_rc" = 0 ] || [ "$rc" != 0 ] || rc=1
  return "$rc"
}

source_from_verify() {
  # source_from_verify ALIAS NAMED_SOURCE WORKDIR; sets SEARCH_* globals.
  local alias="$1" name="$2" work="$3" verify path
  SEARCH_PATH=""; SEARCH_REASON=""
  verify="$work/$alias.verify"
  if ! "$FETCH" verify --json --max-age 86400 "$name" > "$verify"; then :; fi
  path="$(jq -r '.sources[0] | select(.valid and .fresh) | .path // empty' "$verify" 2>/dev/null)"
  if [ -z "$path" ]; then
    "$FETCH" "$name" >/dev/null || true
    "$FETCH" verify --json --max-age 86400 "$name" > "$verify" || true
    path="$(jq -r '.sources[0] | select(.valid and .fresh) | .path // empty' "$verify" 2>/dev/null)"
  fi
  if [ -n "$path" ]; then
    SEARCH_PATH="$path"
  else
    SEARCH_REASON="$(jq -r '.sources[0].reason // "source refresh/validation failed"' "$verify" 2>/dev/null || true)"
    [ -n "$SEARCH_REASON" ] || SEARCH_REASON='source refresh/validation failed'
  fi
}

fetch_detail_path() {
  # fetch_detail_path URL WORKDIR NAME; returns a verified cache path in SEARCH_PATH.
  local url="$1" work="$2" name="$3" meta err path
  meta="$work/$name.meta"; err="$work/$name.err"
  SEARCH_PATH=""; SEARCH_REASON=""
  if "$FETCH" url --max-age 86400 --meta "$url" > "$meta" 2> "$err"; then
    path="$(jq -r 'select(.path | type == "string") | .path' "$meta" 2>/dev/null)"
    if [ -n "$path" ] && [ -s "$path" ]; then SEARCH_PATH="$path"; return 0; fi
    SEARCH_REASON='fetch metadata had no readable body path'
  else
    SEARCH_REASON="$(tail -n 1 "$err" 2>/dev/null || true)"
    [ -n "$SEARCH_REASON" ] || SEARCH_REASON='detail fetch failed'
  fi
  return 1
}

fandom_search_path() {
  local encoded="$1" work="$2" url key cache tmp stamp age now
  SEARCH_PATH=""; SEARCH_REASON=""
  url="https://pokemongo.fandom.com/api.php?action=query&list=search&srsearch=${encoded}&srlimit=8&srprop=&format=json"
  key="$(printf '%s' "$url" | sha256sum | cut -d' ' -f1)"
  cache="$DISC/search-cache/fandom-$key.json"
  mkdir -p "$(dirname "$cache")"
  if [ -s "$cache" ]; then
    stamp="$(date -u -r "$cache" +%s 2>/dev/null || echo 0)"; now="$(date -u +%s)"; age=$((now - stamp))
    if [ "$stamp" -gt 0 ] && [ "$age" -ge 0 ] && [ "$age" -lt 86400 ] &&
       jq -e '.query | type == "object" and (.search | type == "array")' "$cache" >/dev/null 2>&1; then
      SEARCH_PATH="$cache"; discover_metric request fandom-search success 0; return 0
    fi
  fi
  tmp="$(mktemp "$DISC/search-cache/.fandom.XXXXXX")" || { SEARCH_REASON='cannot create Fandom temporary cache'; return 1; }
  if ! retry_discover_transport curl -fsSL --max-time 40 -A "$UA" -o "$tmp" "$url"; then
    discover_metric request fandom-search failed 1
    rm -f "$tmp"; SEARCH_REASON='Fandom search request failed'; return 1
  fi
  discover_metric request fandom-search success 1
  if ! jq -e '.query | type == "object" and (.search | type == "array")' "$tmp" >/dev/null 2>&1; then
    rm -f "$tmp"; SEARCH_REASON='Fandom search returned an error/unparseable response'; return 1
  fi
  if ! mv "$tmp" "$cache"; then
    rm -f "$tmp"; SEARCH_REASON='Fandom search cache replacement failed'; return 1
  fi
  SEARCH_PATH="$cache"
}

save_run_search_report() {
  local report="$1" key="$2" destination
  [ -n "$RUN_CACHE" ] || return 0
  destination="$RUN_CACHE/search-$key.json"
  save_atomic "$report" "$destination"
}

search_mode() {
  local format="$1" query="$2" work encoded key cached_report input stamp stem output rc
  work="$(mktemp -d "$DISC/.search.XXXXXX")" || { echo 'discover: FAILED — cannot create work directory' >&2; return 2; }
  input="$work/input.json"
  trap 'rm -rf "$work"' RETURN
  key="$(printf '%s' "$query" | sha256sum | cut -d' ' -f1)"
  cached_report="${RUN_CACHE:+$RUN_CACHE/search-$key.json}"
  if [ -n "$cached_report" ] && jq -e --arg q "$query" '.version == 1 and .mode == "search" and .query == $q and (.status == "complete" or .status == "partial" or .status == "failed")' "$cached_report" >/dev/null 2>&1; then
    cp "$cached_report" "$work/report" || return 2
  else
    encoded="$(jq -nr --arg q "$query" '$q|@uri')" || { echo 'discover: FAILED — cannot encode query' >&2; return 2; }
    source_from_verify leekduck events "$work"; local leek_path="$SEARCH_PATH" leek_reason="$SEARCH_REASON"
    fetch_detail_path "https://pokemongohub.net/?s=${encoded}" "$work" hub; local hub_path="$SEARCH_PATH" hub_reason="$SEARCH_REASON"
    # Shared exact URL + fetch.sh --max-age means every keyword in this run
    # consumes the same validated official index instead of force-downloading it.
    fetch_detail_path 'https://pokemongo.com/news' "$work" official; local official_path="$SEARCH_PATH" official_reason="$SEARCH_REASON"
    fandom_search_path "$encoded" "$work"; local fandom_path="$SEARCH_PATH" fandom_reason="$SEARCH_REASON"
    jq -n --arg query "$query" \
      --arg leekPath "$leek_path" --arg leekReason "$leek_reason" \
      --arg hubPath "$hub_path" --arg hubReason "$hub_reason" \
      --arg officialPath "$official_path" --arg officialReason "$official_reason" \
      --arg fandomPath "$fandom_path" --arg fandomReason "$fandom_reason" \
      '{query:$query,sources:{
        leekduck:{available:($leekPath|length>0),path:$leekPath,reason:$leekReason},
        hub:{available:($hubPath|length>0),path:$hubPath,reason:$hubReason},
        official:{available:($officialPath|length>0),path:$officialPath,reason:$officialReason},
        fandom:{available:($fandomPath|length>0),path:$fandomPath,reason:$fandomReason}
      }}' > "$input" || return 2
    if ! node "$REPORTER" search --input "$input" > "$work/report"; then
      echo 'discover: FAILED — search report extraction failed' >&2
      return 2
    fi
    save_run_search_report "$work/report" "$key" || { echo 'discover: FAILED — cannot save run search report' >&2; return 2; }
  fi
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"; stem="$DISC/discover-$stamp"
  render_report "$work/report" "$stem" "$format" "$work" || return $?
  output="$RENDER_OUTPUT"
  report_summary "$work/report" 'discover' "$output"
  report_exit "$work/report"; rc=$?
  return "$rc"
}

FORMAT=tsv
if [ "${1:-}" = --json ]; then FORMAT=json; shift; fi
if [ "${1:-}" = new ]; then
  shift
  # Keep both option orders usable: discover new --cached --json and the
  # global discover --json new --cached are equivalent.
  new_mode "$@"
  exit $?
fi
QUERY="${*:-}"
[ -n "${QUERY// /}" ] || { usage; exit 2; }
search_mode "$FORMAT" "$QUERY"
exit $?
