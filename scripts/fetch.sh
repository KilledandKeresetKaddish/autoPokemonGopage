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
  [events-official]="https://pokemongo.com/"
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
  for k in "${ALL[@]}"; do
    f="$RAW/$k.$(ext_of "$k")"
    if [ -f "$f" ]; then
      printf '%-18s cached %8sb  @ %s\n' "$k" "$(wc -c <"$f")" "$(date -u -r "$f" +%FT%TZ 2>/dev/null)"
    else
      printf '%-18s (not fetched)\n' "$k"
    fi
  done
}

# Plain download (ScrapedDuck / PvPoke — clean, no bot protection).
fetch_plain() {
  local url="$1" tmp="$2"
  curl -fsSL -A "$UA" -H 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8' \
       --compressed --max-time 90 "$url" -o "$tmp"
}

# Tier pages — route through a Cloudflare solver.
fetch_tier() {
  local url="$1" tmp="$2"
  case "$TIER_METHOD" in
    jina)
      curl -fsSL --max-time 120 "${JINA_PREFIX}${url}" -o "$tmp" ;;
    flaresolverr)
      curl -fsS --max-time 150 -X POST "$FLARESOLVERR_URL" \
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

fetch_one() {
  local name="$1" url="${URLS[$1]:-}"
  if [ -z "$url" ]; then echo "unknown source: $name" >&2; return 2; fi
  local out="$RAW/$name.$(ext_of "$name")" tmp
  tmp="$(mktemp)"
  local ok=1
  if is_protected "$name"; then fetch_tier "$url" "$tmp" || ok=0; else fetch_plain "$url" "$tmp" || ok=0; fi
  if [ "$ok" = 1 ] && [ -s "$tmp" ]; then
    # JSON sources: a 200-wrapped error / rate-limit / HTML page is NOT valid JSON.
    # Reject it and keep the last good cache rather than overwrite with garbage.
    if [ "$(ext_of "$name")" = json ] && ! jq empty "$tmp" >/dev/null 2>&1; then
      rm -f "$tmp"; echo "FAIL $name  <- $url  (not valid JSON — kept last good)" >&2; return 1
    fi
    mv "$tmp" "$out"
    echo "OK   $name  $(wc -c <"$out")b  -> data/raw/$(basename "$out")"
  else
    rm -f "$tmp"
    echo "FAIL $name  <- $url" >&2
    return 1
  fi
}

# Ad-hoc single-page fetch, restricted to ALLOW_HOSTS. Prints the page to stdout
# (site domains go through the CF-solver; raw file/API hosts via plain curl).
fetch_url() {
  local url="$1" host authority rest
  # Must be an explicit http(s) URL.
  [[ "$url" =~ ^https?:// ]] || { echo "REFUSED non-http(s) URL: $url" >&2; return 2; }
  # Authority = chars after scheme up to the first /, ? or #.
  rest="${url#*://}"; authority="${rest%%/*}"; authority="${authority%%\?*}"; authority="${authority%%#*}"
  # Reject userinfo — `host:x@evil.com` would otherwise smuggle a different real
  # host past the allowlist (curl connects to the part after @).
  if [[ "$authority" == *@* ]]; then echo "REFUSED URL with userinfo '@': $url" >&2; return 2; fi
  host="${authority%%:*}"   # strip :port
  local ok=0 d
  for d in "${ALLOW_HOSTS[@]}"; do
    [[ "$host" == "$d" || "$host" == *."$d" ]] && { ok=1; break; }
  done
  if [ "$ok" != 1 ]; then echo "REFUSED off-allowlist host: ${host:-?}  ($url)" >&2; return 2; fi
  local tmp; tmp="$(mktemp)"
  case "$host" in
    raw.githubusercontent.com|*.githubusercontent.com|pokeapi.co|*.pokeapi.co)
      fetch_plain "$url" "$tmp" || { rm -f "$tmp"; echo "FAIL url <- $url" >&2; return 1; } ;;
    *)  # human-facing site domains (leekduck/hub/pokebase/official/pvpoke) → solver
      fetch_tier "$url" "$tmp" || { rm -f "$tmp"; echo "FAIL url <- $url" >&2; return 1; } ;;
  esac
  cat "$tmp"; rm -f "$tmp"
}

[ $# -eq 0 ] && { echo "usage: fetch.sh <list|all|url <URL...>|${ALL[*]}>"; exit 1; }
case "$1" in
  list)      list_status; exit 0 ;;
  -h|--help) echo "sources: ${ALL[*]}"; echo "ad-hoc:  fetch.sh url <URL...>  (hosts: ${ALLOW_HOSTS[*]})"; exit 0 ;;
  url)       shift; [ $# -eq 0 ] && { echo "usage: fetch.sh url <URL...>" >&2; exit 1; }
             rc=0; for u in "$@"; do fetch_url "$u" || rc=1; done; exit $rc ;;
  all)       set -- "${ALL[@]}" ;;
esac

rc=0
for s in "$@"; do fetch_one "$s" || rc=1; done
exit $rc
