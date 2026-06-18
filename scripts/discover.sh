#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# discover.sh — FIND candidate source URLs for a query.
#
# This is the piece fetch.sh is missing. fetch.sh DOWNLOADS things whose URL you
# already know (named sources, or `fetch.sh url <URL>`). discover.sh FINDS the
# URL in the first place — so when a task needs a page the bulk feeds don't carry
# (a Hub per-boss raid guide, an official news post, …) the agent can locate it
# instead of guessing or giving up.
#
# It only ever returns URLs on the project's trusted Pokémon sources, and it
# reaches the network through the SAME path as fetch.sh (so Cloudflare/JS pages
# are solved by Jina). Candidates are LEADS, not truth: the agent must still open
# each one with `scripts/fetch.sh url <URL>`, read it, and confirm it is the right
# event/Pokémon before using it. Never invent or hand-build a URL.
#
# Usage:
#   scripts/discover.sh "<keywords>"          # search all trusted sources
#   scripts/discover.sh "mega scizor raid"    # English names match best (sources are EN)
#
# Output (stdout): tab-separated  SOURCE <tab> TITLE <tab> URL  — one lead per
# line, also saved under data/raw/discovery/ for auditability.
# ---------------------------------------------------------------------------
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
FETCH="$ROOT/scripts/fetch.sh"
RAW="$ROOT/data/raw"
DISC="$RAW/discovery"
mkdir -p "$DISC"

QUERY="${*:-}"
[ -n "${QUERY// /}" ] || { echo "usage: scripts/discover.sh \"<keywords>\"" >&2; exit 1; }

# url-encode the query (jq is already a dependency of validate.sh)
ENC="$(jq -nr --arg q "$QUERY" '$q|@uri')"
OUT="$DISC/discover-$(date -u +%Y%m%dT%H%M%SZ).txt"

{
  # --- 1) LeekDuck — the ScrapedDuck `events` feed already carries every event's
  #     canonical link, so there's no search endpoint to hit: just match the query
  #     tokens against the (English) event names in the cached feed.
  EV="$RAW/events.json"
  [ -s "$EV" ] || "$FETCH" events >/dev/null 2>&1 || true
  if [ -s "$EV" ]; then
    jq -r --arg q "$QUERY" '
      ($q | ascii_downcase | split(" ") | map(select(length > 0))) as $ts
      | .[]
      | (.name | ascii_downcase) as $n
      | select( ($ts | length) > 0 and (all($ts[]; . as $t | $n | contains($t))) )
      | "leekduck\t\(.name)\t\(.link)"
    ' "$EV" 2>/dev/null
  fi

  # --- 2) Pokémon GO Hub — WordPress site search, rendered through the solver
  #     (the same Jina path fetch.sh already uses for hub pages). Pull /post/ URLs.
  HUB="$("$FETCH" url "https://pokemongohub.net/?s=${ENC}" 2>/dev/null || true)"
  if [ -n "$HUB" ]; then
    # markdown links first — [Title](https://pokemongohub.net/post/…) — keeps titles
    printf '%s\n' "$HUB" \
      | grep -oE '\[[^][]+\]\(https://(www\.)?pokemongohub\.net/post/[^) ]+\)' 2>/dev/null \
      | awk 'match($0,/\]\(/){t=substr($0,2,RSTART-2); u=substr($0,RSTART+2); sub(/\)$/,"",u); printf "gohub\t%s\t%s\n",t,u}'
    # bare URLs as a fallback, in case the solver returned HTML rather than markdown
    printf '%s\n' "$HUB" \
      | grep -oE 'https://(www\.)?pokemongohub\.net/post/[a-zA-Z0-9/_-]+' 2>/dev/null \
      | awk '{printf "gohub\t-\t%s\n",$0}'
  fi

  # --- 3) Official pokemongo.com news — the news index has no usable search, so we
  #     fetch it and keep ONLY posts whose link text/URL actually contain the query
  #     tokens. Never dump the whole index: an unfiltered list would hand the agent
  #     unrelated 官方 URLs as if they were query-specific leads (false matches).
  OFF="$("$FETCH" url "https://pokemongo.com/news" 2>/dev/null || true)"
  if [ -n "$OFF" ]; then
    printf '%s\n' "$OFF" \
      | grep -oE '\[[^][]+\]\(https://(www\.)?pokemongo\.com/(news|post)/[^) ]+\)' 2>/dev/null \
      | awk -v q="$QUERY" '
          BEGIN { n = split(tolower(q), ts, " ") }
          match($0, /\]\(/) {
            t = substr($0, 2, RSTART - 2); u = substr($0, RSTART + 2); sub(/\)$/, "", u);
            hay = tolower(t " " u); ok = (n > 0);
            for (i = 1; i <= n; i++) if (index(hay, ts[i]) == 0) { ok = 0; break }
            if (ok) printf "official\t%s\t%s\n", t, u
          }'
  fi
} | awk -F'\t' '{k=$3; sub(/\/$/,"",k)} !seen[k]++' | tee "$OUT"

echo >&2
if [ -s "$OUT" ]; then
  echo "discover: $(wc -l <"$OUT") candidate(s) -> ${OUT#$ROOT/}" >&2
  echo "discover: NEXT — open each with  scripts/fetch.sh url <URL>  and confirm it's the same event/Pokémon before using. Never guess a URL." >&2
else
  echo "discover: no candidates for \"$QUERY\". Try English Pokémon/event names, or browse the source index via fetch.sh url. Do NOT invent a URL — record the gap in data/state.json." >&2
fi
