#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# validate.sh — the safety gate. Run after the agent edits content. Confirms
# the agent stayed inside its sandbox and didn't break the page. Exit 0 = OK
# to publish; non-zero = roll back. See AGENTS.md for the rules enforced here.
# ---------------------------------------------------------------------------
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
fail=0
say() { echo "validate: $*"; }

# 1) Protected files must be byte-identical to the committed reference.
if [ -f scripts/protected.sha256 ]; then
  if ! sha256sum -c scripts/protected.sha256 >/dev/null 2>&1; then
    say "FAIL protected file(s) changed:"
    sha256sum -c scripts/protected.sha256 2>&1 | grep -v ': OK$' || true
    fail=1
  fi
else
  say "WARN scripts/protected.sha256 missing — integrity check skipped"
fi

H=public/index.html
# 2) Required structural tokens must still be present.
req=(
  'id="view-calendar"' 'id="view-rankings"' 'id="view-clock"' 'id="view-links"'
  'id="calendar"' 'id="main-tabs"' 'id="rank-subtabs"'
  'id="event-detail"' 'id="last-updated"'
  'id="long-term"' 'id="rotations"'
  'data-rank-panel="current"' 'data-rank-panel="attackers"'
  'data-rank-panel="defenders"' 'data-rank-panel="raid"'
)
for t in "${req[@]}"; do
  grep -qF "$t" "$H" || { say "FAIL missing required token: $t"; fail=1; }
done

# 2b) app.js must be loaded as itself or a cache-busted URL (app.js?…), never a
#     renamed/broken source like app.js.bak that would ship a blank dashboard.
grep -qE 'src="app\.js(\?[^"]*)?"' "$H" || { say "FAIL app.js <script> src must be app.js or app.js?<cache-bust>"; fail=1; }

# 3) AI editable-region markers must exist and be balanced.
for region in calendar-notes rankings-current rankings-attackers rankings-defenders rankings-raid; do
  grep -qF "AI:START $region" "$H" || { say "FAIL missing marker: AI:START $region"; fail=1; }
  grep -qF "AI:END $region"   "$H" || { say "FAIL missing marker: AI:END $region"; fail=1; }
done
starts=$(grep -c 'AI:START' "$H"); ends=$(grep -c 'AI:END' "$H")
[ "$starts" = "$ends" ] || { say "FAIL marker imbalance (START=$starts END=$ends)"; fail=1; }

# 3b) Each AI region must be non-empty — hard-enforces the "never ship empty
#     rankings" rule that was previously only a soft prompt instruction.
for region in calendar-notes rankings-current rankings-attackers rankings-defenders rankings-raid; do
  body=$(awk -v r="$region" 'index($0,"AI:START "r){f=1;next} index($0,"AI:END "r){f=0} f{print}' "$H")
  [ -n "$(printf '%s' "$body" | tr -d '[:space:]')" ] || { say "FAIL AI region empty: $region"; fail=1; }
done

# 4) Data files the agent writes must be valid JSON.
for j in public/data/events.json public/data/meta.json public/data/rotations.json public/data/categories.json data/state.json; do
  if [ -f "$j" ]; then
    jq empty "$j" >/dev/null 2>&1 || { say "FAIL invalid JSON: $j"; fail=1; }
  else
    say "FAIL missing JSON file: $j"; fail=1
  fi
done

# 4b) events.json data hygiene — guards against unbounded growth and against
#     duplicate / repeatedly-added events. Keep it bounded, ids unique, and
#     prune events that ended well in the past (>100 days ~= 3 months).
E=public/data/events.json
if [ -f "$E" ] && jq empty "$E" >/dev/null 2>&1; then
  n=$(jq 'length' "$E")
  [ "$n" -le 250 ] || { say "FAIL events.json too large ($n entries > 250)"; fail=1; }
  dups=$(jq '[.[].id] | group_by(.) | map(select(length > 1)) | length' "$E")
  [ "$dups" = 0 ] || { say "FAIL events.json has $dups duplicate id(s)"; fail=1; }
  # semantic floors — catch a gutted/partial rewrite that is still structurally
  # valid. Non-emptiness only: cannot be satisfied by fabricating content.
  [ "$n" -ge 5 ] || { say "FAIL events.json too small ($n entries < 5 — gutted/partial run?)"; fail=1; }
  badf=$(jq '[.[] | select(((.id // "")=="") or ((.name // "")=="") or ((.start // "")=="") or ((.type // "")=="") or ((.end != null) and (.end < .start)))] | length' "$E")
  [ "$badf" = 0 ] || { say "FAIL events.json has $badf event(s) with empty id/name/start/type or end<start"; fail=1; }
  cut=$(date -u -d '90 days ago' +%F 2>/dev/null || date -u -v-90d +%F 2>/dev/null || true)
  if [ -n "$cut" ]; then
    stale=$(jq --arg c "$cut" '[.[] | select(((.end // .start) | tostring | .[0:10]) < $c)] | length' "$E")
    [ "$stale" = 0 ] || { say "FAIL events.json has $stale stale event(s) ended >90d ago (prune old events)"; fail=1; }
  else
    say "WARN could not compute stale-event cutoff (no GNU/BSD date) — skipping age check"
  fi
fi

# 4c) rotations.json must carry a tracks array.
R=public/data/rotations.json
if [ -f "$R" ] && jq empty "$R" >/dev/null 2>&1; then
  jq -e '.tracks | type == "array"' "$R" >/dev/null 2>&1 || { say "FAIL rotations.json missing tracks[]"; fail=1; }
  bad_seg=$(jq '[.tracks[]?.segments[]? | select(((.start // "")=="") or ((.pokemon // []) | length == 0))] | length' "$R" 2>/dev/null || echo 0)
  [ "${bad_seg:-0}" = 0 ] || { say "FAIL rotations.json has $bad_seg segment(s) missing start or pokemon[]"; fail=1; }
fi

# 4d) categories.json: the agent may register NEW event types, but only with a
#     palette key from the theme (no arbitrary colours) and a valid render kind.
C=public/data/categories.json
if [ -f "$C" ] && jq empty "$C" >/dev/null 2>&1; then
  bad=$(jq '
    ["purple","green","greenlt","rust","orange","red","teal","teallt","blue","indigo","mauve","gold","brown"] as $pal
    | [ to_entries[] | .value as $v | select( ($pal | index($v.palette) | not) or (($v.kind // "bar") | (. != "bar" and . != "chip")) ) ]
    | length' "$C")
  [ "${bad:-0}" = 0 ] || { say "FAIL categories.json: $bad entry(ies) off-palette or bad kind (palettes: purple green greenlt rust orange red teal teallt blue indigo mauve gold brown; kind: bar|chip)"; fail=1; }
fi

# 5) No stray <script> injected into the editable regions of index.html
#    (agent-written HTML must be inert). app.js is the only allowed script.
if [ "$(grep -c '<script' "$H")" -ne 1 ]; then
  say "FAIL unexpected <script> count in index.html (only app.js is allowed)"; fail=1
fi

# 5b) AI regions must not contain dangerous HTML: <style>, <iframe>, <object>,
#     <embed>, event-handler attributes (onerror, onload, onclick…), or javascript: URIs.
for region in calendar-notes rankings-current rankings-attackers rankings-defenders rankings-raid; do
  body=$(awk -v r="$region" 'index($0,"AI:START "r){f=1;next} index($0,"AI:END "r){f=0} f{print}' "$H")
  if printf '%s' "$body" | grep -qiE '<(style|iframe|object|embed)[ >]'; then
    say "FAIL AI region $region contains forbidden tag (<style>/<iframe>/<object>/<embed>)"; fail=1
  fi
  if printf '%s' "$body" | grep -qiE '\bon[a-z]+\s*='; then
    say "FAIL AI region $region contains event-handler attribute (onerror/onload/onclick…)"; fail=1
  fi
  if printf '%s' "$body" | grep -qiF 'javascript:'; then
    say "FAIL AI region $region contains javascript: URI"; fail=1
  fi
done

[ "$fail" = 0 ] && say "OK all checks passed"
exit $fail
