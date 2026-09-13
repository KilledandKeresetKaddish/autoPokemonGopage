#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# discover.sh — FIND candidate source URLs, and DETECT newly-listed events.
#
# fetch.sh DOWNLOADS things whose URL you already know. discover.sh covers the
# two gaps the daily agent otherwise can't fill on its own:
#
#   scripts/discover.sh "<keywords>"   SEARCH — find the URL for an event you can
#                                      name (LeekDuck feed + GO Hub + 官方 news +
#                                      Pokémon GO Wiki/Fandom search).
#   scripts/discover.sh new --cached   DETECT from prepared <24h caches, no network.
#   scripts/discover.sh new            DETECT — list events that appear in the
#                                      freshly-fetched feeds but are NOT yet in
#                                      public/data/events.json, cross-checked
#                                      against Hub / official for corroboration.
#
# Both reach the network mostly through the SAME path as fetch.sh (Cloudflare/JS
# pages solved by Jina; the Fandom search hits its MediaWiki JSON API directly) and
# only ever touch the project's trusted, allowlisted sources. Everything
# printed is a LEAD, not truth: open each with `scripts/fetch.sh url --max-age 86400 <URL>`, read
# it, confirm it's the right event/Pokémon, THEN edit. Never invent a URL.
#
# Output: tab-separated  TAG <tab> TITLE <tab> URL [<tab> …]  — saved under
# data/raw/discovery/ for auditability.
# ---------------------------------------------------------------------------
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
FETCH="$ROOT/scripts/fetch.sh"
RAW="$ROOT/data/raw"
DISC="$RAW/discovery"
mkdir -p "$DISC"
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

# ============================ DETECT MODE ==================================
# `discover.sh new` — what showed up in the feeds this cycle that the calendar
# doesn't have yet. Pure detection: it re-fetches the feeds (网抓) and diffs them
# against public/data/events.json; it never guesses an event into existence.
if [ "${1:-}" = "new" ]; then
  TODAY="$(date -u +%F)"
  OUT="$DISC/new-$(date -u +%Y%m%dT%H%M%SZ).txt"
  CAL="$ROOT/public/data/events.json"
  FEED="$RAW/events.json"

  # Standalone mode still refreshes; daily Scout prepares these once, then uses
  # --cached. Never silently report an incomplete/invalid scan as "no new events".
  case "${2:-}" in
    "")
      "$FETCH" events events-hub events-official >/dev/null || {
        echo "discover new: INCOMPLETE — source refresh failed; inspect last-good caches" >&2; exit 1;
      } ;;
    --cached) ;;
    *) echo "usage: discover.sh new [--cached]" >&2; exit 2 ;;
  esac
  [ "$#" -le 2 ] || { echo "usage: discover.sh new [--cached]" >&2; exit 2; }
  HUB="$RAW/events-hub.txt"; OFF="$RAW/events-official.txt"
  for f in "$FEED" "$HUB" "$OFF"; do
    stamp="$(date -u -r "$f" +%s 2>/dev/null || echo 0)"
    age=$(( $(date -u +%s) - stamp ))
    if [ ! -s "$f" ] || [ "$age" -lt 0 ] || [ "$age" -ge 86400 ]; then
      echo "discover new: INCOMPLETE — missing/empty/stale input: $f (requires <24h)" >&2; exit 1
    fi
  done
  if ! jq -e 'type == "array" and all(.[]; (.eventID | type == "string" and length > 0)
      and (.name | type == "string" and length > 0) and (.link | test("^https?://"))
      and (.start | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}"))
      and ((.end // .start) | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}")))' "$FEED" >/dev/null ||
     ! jq -e 'type == "array" and all(.[]; .id | type == "string")' "$CAL" >/dev/null; then
    echo "discover new: INCOMPLETE — unparseable feed/calendar shape" >&2; exit 1
  fi
  incomplete() { echo "discover new: INCOMPLETE — $*" >&2; exit 1; }
  # Basic source/link checks only, not proof the page's semantics are reliable.
  # Each index must link its own source; challenge/errors still need inspection.
  for f in "$HUB" "$OFF"; do
    domain='pokemongohub\.net'
    [ "$f" != "$OFF" ] || domain='pokemongo\.com'
    grep -E "https://(www\.)?$domain/" "$f" >/dev/null ||
      incomplete "unreadable index/source link: $f"
    grep -Ei 'Just a moment\.\.\.|Attention Required!|Cloudflare Ray ID' "$f" >/dev/null
    rc=$?
    [ "$rc" = 1 ] || incomplete "index challenge/read check: $f (grep rc=$rc)"
  done
  KNOWN="$(jq -c '[.[].id]' "$CAL")" || incomplete "calendar ID extraction"
  work="$(mktemp -d "$DISC/.new.XXXXXX")" || incomplete "temporary result directory"
  trap 'rm -rf "$work"' EXIT

  # Distinctive tokens of a name/slug: lowercase a-z0-9 words ≥4 chars, minus
  # Pokémon-GO boilerplate and pure numbers. Corroboration/coverage decisions
  # require ALL of these to match — a single generic token ("raid", "2026")
  # must never count as cross-source evidence.
  STOP='^(raid|raids|battle|battles|hour|hours|event|events|pokemon|community|week|weekend|league|research|spotlight|special|super|mega|shadow|primal|with|into|from|this|that|january|february|march|april|june|july|august|september|october|november|december)$'
  toks() { printf '%s' "$1" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '\n' | awk -v stop="$STOP" 'length>=4 && !/^[0-9]+$/ && $0 !~ stop'; }
  # Upper bound = end of next month (the calendar's retention window: current +
  # next month). Beyond that an event is genuinely future, not a missed one.
  UPPER="$(date -u -d "$(date -u +%Y-%m-01) +2 months" +%F 2>/dev/null || echo 9999-12-31)"

  # Materialize/check each extraction before rendering any results. A later
  # successful command must never hide an earlier failure in a grouped pipeline.
  jq -r --arg today "$TODAY" --arg upper "$UPPER" --argjson known "$KNOWN" '
    .[]
    | (.eventID) as $eid
    | ((.end // .start) | tostring)[0:10] as $endd
    | ((.start) | tostring)[0:10] as $startd
    | select($endd >= $today and $startd < $upper)
    | select(($known | index($eid)) == null)
    | "\($eid)\t\(.name)\t\(.link)\t\($startd)→\($endd)"
  ' "$FEED" > "$work/feed" || incomplete "feed candidate extraction"
  CALTEXT="$(jq -r '.[] | "\(.id) \(.name) \(.link)"' "$CAL" | tr 'A-Z' 'a-z')" ||
    incomplete "calendar text extraction"
  grep -oE 'https://(www\.)?pokemongo\.com/(news|post)/[a-zA-Z0-9/_-]+' "$OFF" > "$work/official"
  rc=$?
  [ "$rc" -le 1 ] || incomplete "official URL extraction (grep rc=$rc)"
  awk '!s[$0]++' "$work/official" > "$work/unique" || incomplete "official URL deduplication"

  : > "$work/candidates" || incomplete "candidate result write"
  while IFS=$'\t' read -r eid name link dates; do
    [ -n "$eid" ] || continue
    # Corroboration requires EVERY distinctive token, not generic raid/year words.
    hub=0; off=0
    dt="$(toks "$name")" || incomplete "feed name token extraction"
    if [ -n "$dt" ]; then
      hub=1; off=1
      while IFS= read -r t; do
        grep -iF "$t" "$HUB" >/dev/null; rc=$?
        [ "$rc" -le 1 ] || incomplete "Hub corroboration read (grep rc=$rc)"
        [ "$rc" = 0 ] || hub=0
        grep -iF "$t" "$OFF" >/dev/null; rc=$?
        [ "$rc" -le 1 ] || incomplete "official corroboration read (grep rc=$rc)"
        [ "$rc" = 0 ] || off=0
      done <<< "$dt"
    fi
    corr="LeekDuck"; [ "$hub" = 1 ] && corr="$corr+Hub"; [ "$off" = 1 ] && corr="$corr+官方"
    printf 'NEW\t%s\t%s\t%s\t佐证:%s\n' "$name" "$link" "$dates" "$corr" >> "$work/candidates" ||
      incomplete "feed candidate result write"
  done < "$work/feed" || incomplete "feed candidate read"

  while IFS= read -r url; do
    # Suppress only if ALL distinctive slug tokens occur in the calendar.
    # Generic-only slugs remain leads. Empty grep results are a valid empty scan.
    slug="${url##*/}"; covered=0
    dt="$(toks "$slug")" || incomplete "official slug token extraction"
    if [ -n "$dt" ]; then
      covered=1
      while IFS= read -r t; do
        [[ "$CALTEXT" == *"$t"* ]] || { covered=0; break; }
      done <<< "$dt"
    fi
    if [ "$covered" = 0 ]; then
      printf 'OFFICIAL-LEAD\t-\t%s\n' "$url" >> "$work/candidates" || incomplete "official candidate result write"
    fi
  done < "$work/unique" || incomplete "official candidate read"
  tee "$OUT" < "$work/candidates" || incomplete "result write/output (any partial candidates are incomplete)"

  echo >&2
  if [ -s "$OUT" ]; then
    echo "discover new: 候选已存 -> ${OUT#$ROOT/}" >&2
    echo "discover new: 逐条 scripts/fetch.sh url --max-age 86400 <URL> 打开核实(同一活动/日期)后再加入 events.json;拿不准把 gap 上报 State+Validator 记入 data/state.json,勿编。" >&2
  else
    echo "discover new: 本周期 feed 相对当前日历无新增活动。" >&2
  fi
  exit 0
fi

# ============================ SEARCH MODE (default) ========================
QUERY="${*:-}"
[ -n "${QUERY// /}" ] || { echo "usage: scripts/discover.sh \"<keywords>\"   |   scripts/discover.sh new [--cached]" >&2; exit 1; }

ENC="$(jq -nr --arg q "$QUERY" '$q|@uri')"
OUT="$DISC/discover-$(date -u +%Y%m%dT%H%M%SZ).txt"

{
  # --- 1) LeekDuck — the ScrapedDuck `events` feed already carries every event's
  #     canonical link, so there's no search endpoint to hit: score the query
  #     tokens against the (English) event names in the cached feed. Majority-of-
  #     tokens matching, best matches first (requiring ALL tokens made the
  #     documented multi-word queries like "mega scizor raid guide" miss events
  #     that were sitting right in the feed).
  EV="$RAW/events.json"
  [ -s "$EV" ] || "$FETCH" events >/dev/null 2>&1 || true
  if [ -s "$EV" ]; then
    jq -r --arg q "$QUERY" '
      ($q | ascii_downcase | split(" ") | map(select(length > 0))) as $ts
      | ((($ts | length) + 1) / 2 | floor) as $need
      | [ .[]
          | (.name | ascii_downcase) as $n
          | ([ $ts[] | select(. as $t | $n | contains($t)) ] | length) as $hits
          | select($hits > 0 and $hits >= $need)
          | { hits: $hits, line: "leekduck\t\(.name)\t\(.link)" } ]
      | sort_by(-.hits) | .[0:15][] | .line
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

  # --- 4) Pokémon GO Wiki (Fandom) — the MediaWiki search API returns clean JSON,
  #     so curl api.php directly (it isn't Cloudflare-gated; the Jina solver is only
  #     for rendered article pages). This is the search path the LeekDuck feed / Hub
  #     can't give for region- or local-only events that surface only on the wiki.
  #     Host is fixed + allowlisted, query is url-encoded. Hits are LEADS: open each
  #     /wiki/ page with `scripts/fetch.sh url` and confirm before using.
  FAN="$(curl -fsSL --max-time 40 -A "$UA" \
    "https://pokemongo.fandom.com/api.php?action=query&list=search&srsearch=${ENC}&srlimit=8&srprop=&format=json" 2>/dev/null || true)"
  if [ -n "$FAN" ]; then
    printf '%s\n' "$FAN" | jq -r '
      (.query.search // [])[]
      | "fandom\t\(.title)\thttps://pokemongo.fandom.com/wiki/\(.title | gsub(" "; "_") | @uri)"
    ' 2>/dev/null || true
  fi
} | awk -F'\t' '{k=$3; sub(/\/$/,"",k)} !seen[k]++' | tee "$OUT"

echo >&2
if [ -s "$OUT" ]; then
  echo "discover: $(wc -l <"$OUT") candidate(s) -> ${OUT#$ROOT/}" >&2
  echo "discover: NEXT — open each with  scripts/fetch.sh url --max-age 86400 <URL>  and confirm it's the same event/Pokémon before using. Never guess a URL." >&2
else
  echo "discover: no candidates for \"$QUERY\". Try English Pokémon/event names, or browse the source index via fetch.sh url. Do NOT invent a URL — report the gap for data/state.json (State+Validator is its sole writer)." >&2
fi
