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
  'id="view-calendar"' 'id="view-rankings"' 'id="view-tracker"'
  'id="calendar"' 'id="tracker"' 'id="main-tabs"' 'id="rank-subtabs"'
  'id="event-detail"' 'id="last-updated"' 'src="app.js"'
  'data-rank-panel="current"' 'data-rank-panel="attackers"'
  'data-rank-panel="defenders"' 'data-rank-panel="raid"'
)
for t in "${req[@]}"; do
  grep -qF "$t" "$H" || { say "FAIL missing required token: $t"; fail=1; }
done

# 3) AI editable-region markers must exist and be balanced.
for region in calendar-notes rankings-current rankings-attackers rankings-defenders rankings-raid; do
  grep -qF "AI:START $region" "$H" || { say "FAIL missing marker: AI:START $region"; fail=1; }
  grep -qF "AI:END $region"   "$H" || { say "FAIL missing marker: AI:END $region"; fail=1; }
done
starts=$(grep -c 'AI:START' "$H"); ends=$(grep -c 'AI:END' "$H")
[ "$starts" = "$ends" ] || { say "FAIL marker imbalance (START=$starts END=$ends)"; fail=1; }

# 4) Data files the agent writes must be valid JSON.
for j in public/data/events.json public/data/meta.json data/state.json; do
  if [ -f "$j" ]; then
    jq empty "$j" >/dev/null 2>&1 || { say "FAIL invalid JSON: $j"; fail=1; }
  else
    say "FAIL missing JSON file: $j"; fail=1
  fi
done

# 5) No stray <script> injected into the editable regions of index.html
#    (agent-written HTML must be inert). app.js is the only allowed script.
if [ "$(grep -c '<script' "$H")" -ne 1 ]; then
  say "FAIL unexpected <script> count in index.html (only app.js is allowed)"; fail=1
fi

[ "$fail" = 0 ] && say "OK all checks passed"
exit $fail
