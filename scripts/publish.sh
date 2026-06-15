#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# publish.sh — commit the day's content change (nginx serves public/ in place,
# so the commit is for history + one-command rollback). Pushing to the remote
# is optional: set PUBLISH_PUSH=1 to also push.
# ---------------------------------------------------------------------------
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

git add -A public data/state.json
if git diff --cached --quiet; then
  echo "publish: no content changes today"
  exit 0
fi

git commit -q -m "chore(daily): content update $(date -u +%F)"
echo "publish: committed."

if [ "${PUBLISH_PUSH:-0}" = "1" ]; then
  git push 2>&1 && echo "publish: pushed." || echo "publish: push failed (non-fatal)"
fi
