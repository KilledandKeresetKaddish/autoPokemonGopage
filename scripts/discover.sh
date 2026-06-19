#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# discover.sh — FIND candidate source URLs, and DETECT newly-listed events.
#
# fetch.sh DOWNLOADS things whose URL you already know. discover.sh covers the
# two gaps the daily agent otherwise can't fill on its own:
#
#   scripts/discover.sh "<keywords>"   SEARCH — find the URL for an event you can
#                                      name (LeekDuck feed + GO Hub site search).
#   scripts/discover.sh new            DETECT — list events that appear in the
#                                      freshly-fetched feeds but are NOT yet in
#                                      public/data/events.json, cross-checked
#                                      against Hub / official for corroboration.
#
# Both reach the network through the SAME path as fetch.sh (Cloudflare/JS pages
# solved by Jina) and only ever touch the project's trusted sources. Everything
# printed is a LEAD, not truth: open each with `scripts/fetch.sh url <URL>`, read
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

# ============================ DETECT MODE ==================================
# `discover.sh new` — what showed up in the feeds this cycle that the calendar
# doesn't have yet. Pure detection: it re-fetches the feeds (网抓) and diffs them
# against public/data/events.json; it never guesses an event into existence.
if [ "${1:-}" = "new" ]; then
  TODAY="$(date -u +%F)"
  OUT="$DISC/new-$(date -u +%Y%m%dT%H%M%SZ).txt"
  CAL="$ROOT/public/data/events.json"
  FEED="$RAW/events.json"

  # Fresh pull: events (the structured backbone) is required; hub/official are
  # best-effort and only used to corroborate a candidate across sources.
  "$FETCH" events >/dev/null 2>&1 || true
  "$FETCH" events-hub events-official >/dev/null 2>&1 || true
  [ -s "$FEED" ] || { echo "discover new: 无法获取 events feed($FEED 为空)" >&2; exit 1; }

  KNOWN="$(jq -c '[.[].id]' "$CAL" 2>/dev/null || echo '[]')"
  HUB="$RAW/events-hub.txt"; OFF="$RAW/events-official.txt"
  # Upper bound = end of next month (the calendar's retention window: current +
  # next month). Beyond that an event is genuinely future, not a missed one.
  UPPER="$(date -u -d "$(date -u +%Y-%m-01) +2 months" +%F 2>/dev/null || echo 9999-12-31)"

  {
    # (1) feed events still current/upcoming, inside the retention window, and not
    #     already on the calendar
    jq -r --arg today "$TODAY" --arg upper "$UPPER" --argjson known "$KNOWN" '
      .[]
      | (.eventID) as $eid
      | ((.end // .start) | tostring)[0:10] as $endd
      | ((.start) | tostring)[0:10] as $startd
      | select($endd >= $today and $startd < $upper)
      | select(($known | index($eid)) == null)
      | "\($eid)\t\(.name)\t\(.link)\t\($startd)→\($endd)"
    ' "$FEED" 2>/dev/null \
    | while IFS=$'\t' read -r eid name link dates; do
        [ -n "$eid" ] || continue
        # 多方校对: does this candidate's distinctive wording also show in Hub / official?
        hub=0; off=0
        for t in $(printf '%s' "$name" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '\n' | awk 'length>=4'); do
          [ -s "$HUB" ] && grep -qiF "$t" "$HUB" && hub=1
          [ -s "$OFF" ] && grep -qiF "$t" "$OFF" && off=1
        done
        corr="LeekDuck"; [ "$hub" = 1 ] && corr="$corr+Hub"; [ "$off" = 1 ] && corr="$corr+官方"
        printf 'NEW\t%s\t%s\t%s\t佐证:%s\n' "$name" "$link" "$dates" "$corr"
      done

    # (2) official-only leads: pokemongo.com news/post links whose slug does NOT
    #     overlap the existing calendar (so likely something LeekDuck hasn't carried).
    if [ -s "$OFF" ]; then
      CALTEXT="$(jq -r '.[] | "\(.id) \(.name) \(.link)"' "$CAL" 2>/dev/null | tr 'A-Z' 'a-z')"
      grep -oE 'https://(www\.)?pokemongo\.com/(news|post)/[a-zA-Z0-9/_-]+' "$OFF" 2>/dev/null \
        | awk '!s[$0]++' \
        | while read -r url; do
            slug="${url##*/}"; covered=0
            for t in $(printf '%s' "$slug" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '\n' | awk 'length>=4'); do
              printf '%s' "$CALTEXT" | grep -qF "$t" && { covered=1; break; }
            done
            [ "$covered" = 0 ] && printf 'OFFICIAL-LEAD\t-\t%s\n' "$url"
          done
    fi
  } | tee "$OUT"

  echo >&2
  if [ -s "$OUT" ]; then
    echo "discover new: 候选已存 -> ${OUT#$ROOT/}" >&2
    echo "discover new: 逐条 scripts/fetch.sh url <URL> 打开核实(同一活动/日期)后再加入 events.json;拿不准记 data/state.json,勿编。" >&2
  else
    echo "discover new: 本周期 feed 相对当前日历无新增活动。" >&2
  fi
  exit 0
fi

# ============================ SEARCH MODE (default) ========================
QUERY="${*:-}"
[ -n "${QUERY// /}" ] || { echo "usage: scripts/discover.sh \"<keywords>\"   |   scripts/discover.sh new" >&2; exit 1; }

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
