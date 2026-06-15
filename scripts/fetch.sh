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
# The two `tiers-*` sources come from pokemongohub.net, which sits behind a
# Cloudflare "managed challenge" — a plain curl only gets the challenge page.
# So tier pages are fetched through a CF-solver, selectable with TIER_METHOD:
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
)
declare -A EXT=( [tiers-attackers]=txt [tiers-defenders]=txt )   # default: json
is_tier() { [[ "$1" == tiers-* ]]; }
ext_of()  { echo "${EXT[$1]:-json}"; }
ALL=(events raids eggs research gamemaster tiers-attackers tiers-defenders)

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
        -d "{\"cmd\":\"request.get\",\"url\":\"${url}\",\"maxTimeout\":120000}" \
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
  if is_tier "$name"; then fetch_tier "$url" "$tmp" || ok=0; else fetch_plain "$url" "$tmp" || ok=0; fi
  if [ "$ok" = 1 ] && [ -s "$tmp" ]; then
    mv "$tmp" "$out"
    echo "OK   $name  $(wc -c <"$out")b  -> data/raw/$(basename "$out")"
  else
    rm -f "$tmp"
    echo "FAIL $name  <- $url" >&2
    return 1
  fi
}

[ $# -eq 0 ] && { echo "usage: fetch.sh <list|all|${ALL[*]}>"; exit 1; }
case "$1" in
  list)      list_status; exit 0 ;;
  -h|--help) echo "sources: ${ALL[*]}"; exit 0 ;;
  all)       set -- "${ALL[@]}" ;;
esac

rc=0
for s in "$@"; do fetch_one "$s" || rc=1; done
exit $rc
