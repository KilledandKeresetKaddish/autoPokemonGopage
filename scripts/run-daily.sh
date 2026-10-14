#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# run-daily.sh — cron entrypoint. Invokes the configured coding-agent CLI to
# update site content, then validates and either publishes or rolls back.
#
# The agent is intentionally pluggable. Pick your CLI with AGENT_CLI
# (default: claude); supported invocations live in daily-agent.sh.
#   AGENT_CLI=claude  ./scripts/run-daily.sh
#   AGENT_CLI=aider   ./scripts/run-daily.sh
# ---------------------------------------------------------------------------
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p logs
# Fail before any agent can run without its supervisor or publishing gates.
for dependency in git jq node python3; do
  command -v "$dependency" >/dev/null 2>&1 || {
    echo "$dependency is required for the daily supervisor/gates; aborting"
    exit 1
  }
done
if [ "$(uname -s)" != Linux ] || [ ! -r /proc/self/stat ]; then
  echo 'Linux with readable /proc is required to confirm agent termination; aborting'
  exit 1
fi
# One checkout, one writer. Concurrent cron/manual runs can otherwise mix two
# agents' edits and let one process validate while the other is still writing.
command -v flock >/dev/null 2>&1 || {
  echo "flock is required for a race-free daily run (install util-linux); aborting"
  exit 1
}
exec 9>logs/.daily-run.lock
if ! flock -n 9; then
  echo "daily run already active for this checkout; refusing a concurrent run"
  exit 1
fi
mkdir -p logs/runs || exit 1
# Incomplete records are evidence, not disposable locks. A previous SIGKILL/power
# loss may have left a child writing; never silently clear its tree or snapshot.
for previous in logs/runs/*/active; do
  [ -f "$previous" ] || continue
  python3 scripts/daily-agent-run.py check "${previous%/active}" || exit 1
done
RUN_DIR="$(mktemp -d "logs/runs/daily-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")" || exit 1
POGO_RUN_ID="${RUN_DIR##*/}"  # always new; never trust a caller's stale run ID
export POGO_RUN_ID
RUN_START_MS="$(date +%s%3N)"
LOG="$RUN_DIR/daily.log"
: > "$RUN_DIR/active" || exit 1
exec > >(tee -a "$LOG") 2>&1
RUN_STATUS=failed
WRITER_CONFIRMED=1
METRICS_OK=1
SUPERVISOR_PID=""
record() {
  # kind name exitCode are command results, not agent-written assertions.
  if ! jq -nc --arg time "$(date -u +%FT%TZ)" --arg kind "$1" --arg name "$2" --argjson exitCode "$3" \
    '{time:$time,kind:$kind,name:$name,exitCode:$exitCode}' >> "$RUN_DIR/events.jsonl"; then
    METRICS_OK=0
    echo '!!! event log write failed; publication blocked' >&2
    return 1
  fi
}
on_exit() {
  local rc="$1"
  trap - EXIT
  [ "$METRICS_OK" = 1 ] || rc=1
  if ! node scripts/daily-run-record.js "$RUN_DIR" "$RUN_STATUS" "$rc" "$RUN_START_MS"; then
    echo '!!! metrics persistence FAILED — no success recorded; inspect publish/HEAD and tree manually' >&2
    rc=1
  fi
  if [ "$WRITER_CONFIRMED" = 1 ] && [ "$METRICS_OK" = 1 ]; then
    rm -f "$RUN_DIR/active" || rc=1
  fi
  exit "$rc"
}
on_signal() {
  echo "!!! wrapper received $1 — asking agent supervisor to stop its own group" >&2
  RUN_STATUS=unconfirmed
  if [ -n "$SUPERVISOR_PID" ]; then
    kill -s "$1" "$SUPERVISOR_PID" 2>/dev/null || true
  else
    # Between agent and gates: preserve the tree, not a guessed rollback.
    exit 1
  fi
}
trap 'on_exit $?' EXIT
trap 'on_signal TERM' TERM
trap 'on_signal INT' INT
record start invocation 0 || exit 1
echo "===== daily run $POGO_RUN_ID $(date -u +%FT%TZ) ====="
# 7200 seconds is a conservative safety ceiling, not a target duration.
AGENT_TIMEOUT_SECONDS="${AGENT_TIMEOUT_SECONDS:-7200}"
AGENT_TERM_GRACE_SECONDS="${AGENT_TERM_GRACE_SECONDS:-10}"
AGENT_DRAIN_SECONDS="${AGENT_DRAIN_SECONDS:-10}"
AGENT_KILL_WAIT_SECONDS="${AGENT_KILL_WAIT_SECONDS:-5}"
for value in "$AGENT_TIMEOUT_SECONDS" "$AGENT_TERM_GRACE_SECONDS" "$AGENT_DRAIN_SECONDS" "$AGENT_KILL_WAIT_SECONDS"; do
  [[ "$value" =~ ^[1-9][0-9]{0,5}$ ]] || { echo '!!! agent time limits must be positive integer seconds' >&2; exit 1; }
done
export AGENT_TERM_GRACE_SECONDS AGENT_DRAIN_SECONDS AGENT_KILL_WAIT_SECONDS
export FETCH_METRICS_FILE="$ROOT/$RUN_DIR/fetch.jsonl" DISCOVER_METRICS_FILE="$ROOT/$RUN_DIR/discover.jsonl"
# Keep completed run logs for ~30 days; never delete an active or last-success run.
LAST_SUCCESS_ID="$(jq -r '.runId // empty' logs/lastSuccess.json 2>/dev/null || true)"
for old in logs/runs/*; do
  [ -d "$old" ] || continue
  [ -e "$old/active" ] && continue
  [ "${old##*/}" = "$LAST_SUCCESS_ID" ] && continue
  if [ "$(find "$old" -maxdepth 0 -mtime +30 -print)" ]; then rm -rf -- "$old"; fi
done
# Refuse to run over ANY uncommitted maintainer work. Logs, raw caches, local Pi
# artifacts and note.txt are gitignored; everything else must start at HEAD so an
# allowed-diff check can attribute every post-agent change to this invocation.
if ! GIT_STATUS="$(git status --porcelain --untracked-files=all)"; then
  echo "!!! cannot inspect the Git working tree — refusing to run without a trustworthy baseline"
  exit 1
fi
if [ -n "$GIT_STATUS" ]; then
  echo "!!! uncommitted/untracked files outside ignored runtime caches —"
  echo "!!! commit, stash or remove them before the daily run. Aborting."
  git status --short --untracked-files=all
  exit 1
fi
if ! BASE_HEAD="$(git rev-parse --verify 'HEAD^{commit}')"; then
  echo "!!! cannot resolve the committed Git baseline — aborting before agent invocation"
  exit 1
fi

AGENT_CLI="${AGENT_CLI:-claude}"
PI_EVENT_LOG=""
[ "$AGENT_CLI" = pi ] && [ "${PI_VERBOSE:-0}" = 1 ] && PI_EVENT_LOG="$ROOT/$RUN_DIR/pi-events.jsonl"
export AGENT_CLI PI_EVENT_LOG
if [ "$AGENT_CLI" = pi ]; then
  if ! pi --version > "$RUN_DIR/pi-version.txt" 2>&1 || ! pi --help > "$RUN_DIR/pi-help.txt" 2>&1; then
    echo '!!! installed Pi CLI version/help unavailable; refusing an unverified invocation' >&2
    exit 1
  fi
  for flag in --no-extensions --no-skills --no-prompt-templates --no-context-files --no-session --tools --provider --model --mode; do
    if ! grep -Fq -- "$flag" "$RUN_DIR/pi-help.txt"; then
      echo "!!! installed Pi CLI lacks required flag $flag" >&2
      exit 1
    fi
  done
  grep -Eq -- '(^|[[:space:]])-p([[:space:],]|$)' "$RUN_DIR/pi-help.txt" || {
    echo '!!! installed Pi CLI lacks -p' >&2; exit 1;
  }
fi
RESUME_FILE="logs/resume/pending.tar"

# Optional one-off operator instruction for THIS run only. Priority remains:
# positional $1 > EXTRA_INSTRUCTIONS > none. Its exact effective bytes identify
# whether a pending draft belongs to this run.
EXTRA="${1:-${EXTRA_INSTRUCTIONS:-}}"
NOTE_HASH=$(printf '%s' "$EXTRA" | sha256sum | awk '{print $1}') || {
  echo "!!! cannot hash the effective operator note — aborting"
  exit 1
}

# locations.json is admin-curated. An explicit location-edit operator note is the
# authorization; unrelated notes and ordinary runs keep the path outside scope.
operator_requests_location_edit() {
  local note="$1"
  local action='(新增|添加|增加|移除|删除|修改|更改|修正|纠正|更新|重命名|改名|(^|[^[:alpha:]])(add|remove|delete|change|update|correct|rename|edit)([^[:alpha:]]|$))'
  local direct='(spot[[:space:]-]*atlas|locations\.json|地点图鉴|点位图鉴)'
  local kind='(道馆|(^|[^[:alpha:]])(gym|showcase)([^[:alpha:]]|$))'
  local coordinates='(坐标|经纬度|(^|[^[:alpha:]])(coordinates?|latitude|longitude|lat|lng)([^[:alpha:]]|$))'
  local zone='(时区|(^|[^[:alpha:]])(timezone|time[[:space:]-]+zone)([^[:alpha:]]|$))'
  printf '%s\n' "$note" | grep -Eiq -- "$action" || return 1
  printf '%s\n' "$note" | grep -Eiq -- "$direct" && return 0
  if printf '%s\n' "$note" | grep -Eiq -- "$kind"; then
    printf '%s\n' "$note" | grep -Eiq -- "($coordinates|$zone)" && return 0
  fi
  if printf '%s\n' "$note" | grep -Eiq -- "$coordinates"; then
    printf '%s\n' "$note" | grep -Eiq -- "$zone" && return 0
  fi
  if command -v jq >/dev/null 2>&1 && [ -r public/data/locations.json ]; then
    jq -e --arg note "$note" '
      ($note | ascii_downcase) as $n
      | any(.spots[]?; . as $spot
          | ($n | contains($spot.id | ascii_downcase))
            or ($n | contains($spot.name | ascii_downcase)))
    ' public/data/locations.json >/dev/null 2>&1 && return 0
  fi
  return 1
}
LOCATION_EDIT_ALLOWED=0
if [ -n "$EXTRA" ] && operator_requests_location_edit "$EXTRA"; then
  LOCATION_EDIT_ALLOWED=1
fi

# This is the existing daily write whitelist, shared with snapshot save/restore.
DAILY_PATHS=(
  public/data/events.json public/data/rotations.json public/data/categories.json
  public/data/meta.json public/data/featured.json public/data/mega.json
  public/data/i18n/en.json public/index.html data/state.json
)
[ "$LOCATION_EDIT_ALLOWED" = 1 ] && DAILY_PATHS+=(public/data/locations.json)
is_daily_path() {
  local path allowed
  path="$1"
  for allowed in "${DAILY_PATHS[@]}"; do
    [ "$path" = "$allowed" ] && return 0
  done
  return 1
}

# A clean checkout may receive the last failed run's draft before the single agent
# starts. Invalid/mismatched snapshots are discarded and logged by the helper.
RESUME_RESTORED=0
scripts/resume-snapshot.sh restore "$RESUME_FILE" "$BASE_HEAD" "$NOTE_HASH" -- "${DAILY_PATHS[@]}"
resume_rc=$?
case "$resume_rc" in
  0) RESUME_RESTORED=1; record recovery restored 0 || exit 1 ;;
  3) record recovery absent 3 || exit 1 ;;
  4) record recovery discarded 4 || exit 1 ;;
  *) echo "!!! cannot inspect/restore the pending daily snapshot — aborting"; exit 1 ;;
esac

# Inject the eight core documents once. Detailed HTML/schema reference is on demand.
if [ ! -r tasks/reference/daily-schemas.md ]; then
  echo '!!! required on-demand schema/HTML reference is unreadable' >&2
  exit 1
fi
# Pi context-file loading is disabled, so the model need not re-read any of
# these files unless genuine context compaction loses a specific passage.
PROMPT="The core daily rules and six sequential responsibility briefs are embedded below,
each exactly once. They are all duties of this one current agent. Do not delegate via
tools, shell commands, APIs, extensions, or another coding-agent CLI. Do not re-read the
embedded files merely to load them again; after genuine context compaction, re-read only
the specific passage that was actually lost. Complete every phase yourself in order."
PROMPT_FILES=(
  AGENTS.md
  tasks/daily-update.md
  tasks/subagents/00-source-scout.md
  tasks/subagents/10-calendar-curator.md
  tasks/subagents/20-rotation-curator.md
  tasks/subagents/30-ranking-curator.md
  tasks/subagents/40-english-curator.md
  tasks/subagents/90-state-validator.md
)
for prompt_file in "${PROMPT_FILES[@]}"; do
  if [ ! -r "$prompt_file" ]; then
    echo "!!! required prompt file is unreadable: $prompt_file"
    exit 1
  fi
  PROMPT+="

===== begin $prompt_file =====

$(cat "$prompt_file")

===== end $prompt_file ====="
done

# Addenda stay last so the one-off operator request retains its existing priority.
if [ -n "$EXTRA" ]; then
  PROMPT+="

===== OPERATOR NOTE — THIS RUN ONLY =====

The following is an extra request for this single run. Do it **in addition to** (never
instead of) the normal daily update, and only **within the embedded AGENTS.md hard
rules**: if it conflicts with those rules, they win and you skip the conflicting part.
If it would require editing protected files (app.js / style.css / scripts / index.html
outside the AI markers), do NOT attempt it — record it in data/state.json for a
developer instead, so this run still passes validation.

$EXTRA

===== END OPERATOR NOTE ====="
  echo "--- operator note injected (this run only) ---"
  printf '%s\n' "$EXTRA"
fi
if [ "$RESUME_RESTORED" = 1 ]; then
  PROMPT+="

===== RECOVERED DRAFT — INSPECT BEFORE CONTINUING =====

A pending snapshot from a failed run has been applied. It is a possibly incomplete
draft, not proof that any phase finished. Inspect its changes first, then continue the
entire daily task in the required order. Source Scout, freshness checks,
\`scripts/discover.sh new --cached --json\` after preparing sources (retain partial reports), detail review, and
date-driven maintenance still must run. Use the
committed state at base HEAD \`$BASE_HEAD\` (for example,
\`git show $BASE_HEAD:data/state.json\`) as the last successfully processed source
baseline; neither raw caches nor hashes/timestamps in draft state prove successful
processing or create a quiet day. Compare URL bodies to committed processed-detail records.
Correct the draft when sources changed, reuse content that is still valid, and do not
unconditionally redo sound work.

===== END RECOVERED DRAFT ====="
fi

# One read-only, advisory checklist from the committed baseline. Refresh it after
# Scout with --discovery; an initial report is not proof that sources were checked.
WORKLIST="$ROOT/$RUN_DIR/worklist.json"
if ! node scripts/daily-worklist.js --base-ref "$BASE_HEAD" > "$WORKLIST"; then
  printf '{"advisoryOnly":true,"gaps":["initial candidate extraction failed; Scout must inspect sources directly"]}\n' > "$WORKLIST" || exit 1
fi
PROMPT+="

===== SHARED WORKLIST — ADVISORY, NOT COMPLETION EVIDENCE =====

Initial read-only hints: $WORKLIST (read once when starting Scout; not a proof
of fetch/discovery/processing). Keep this same path for all six responsibilities.
After Scout prepares caches and discovery, refresh this shared checklist using
\`node scripts/daily-worklist.js --base-ref $BASE_HEAD --discovery <this-run-report-path> > $WORKLIST\`.
Add source-identified changed/pending/force IDs to daily-candidates as needed; do not
promote cached or draft facts to processed state. All six phases may read this one
checklist, but actual verified sources and committed hashes govern every decision.

===== END SHARED WORKLIST ====="
PROMPT_FILE="$ROOT/$RUN_DIR/prompt.txt"
printf '%s' "$PROMPT" > "$PROMPT_FILE" || exit 1
chmod 600 "$PROMPT_FILE"
echo "--- invoking agent: $AGENT_CLI (prompt bytes: $(wc -c < "$PROMPT_FILE"), protective timeout: ${AGENT_TIMEOUT_SECONDS}s) ---"
# Never equate quiet stdout in Pi -p mode with a stall. Python waits for the
# whole isolated process group, and sends TERM then KILL only to THAT group.
python3 scripts/daily-agent-run.py "$PROMPT_FILE" "$ROOT/$RUN_DIR/agent.out" \
  "$ROOT/$RUN_DIR/agent-result.json" "$AGENT_TIMEOUT_SECONDS" &
SUPERVISOR_PID=$!
wait "$SUPERVISOR_PID"; agent_rc=$?
# A trap can interrupt wait without ending the supervisor. Do not touch the tree.
while kill -0 "$SUPERVISOR_PID" 2>/dev/null; do
  wait "$SUPERVISOR_PID"; agent_rc=$?
done
SUPERVISOR_PID=""
[ ! -f "$RUN_DIR/agent.out" ] || cat "$RUN_DIR/agent.out"
WRITER_CONFIRMED=0
if [ -f "$RUN_DIR/agent-result.json" ] &&
   jq -e '.writerStopped == true' "$RUN_DIR/agent-result.json" >/dev/null 2>&1; then
  WRITER_CONFIRMED=1
fi
if [ "$WRITER_CONFIRMED" != 1 ]; then
  echo '!!! writer exit unconfirmed: leave working tree and pending snapshot untouched; inspect agent group' >&2
  RUN_STATUS=unconfirmed
  record agent unconfirmed "$agent_rc" || true
  exit 1
fi
RUN_STATUS=failed  # even a handled TERM/INT is now confirmed stopped
record agent "$(jq -r .reason "$RUN_DIR/agent-result.json")" "$agent_rc" || exit 1
agent_gate=0
async_unack=0
if [ "$agent_rc" -ne 0 ]; then
  echo "!!! agent exited non-zero (rc=$agent_rc) — publication is blocked"
  agent_gate=1
fi
if grep -qF 'Subagent async grouped result intercom delivery was not acknowledged' "$RUN_DIR/agent.out" \
   || { [ -n "$PI_EVENT_LOG" ] && grep -qF 'Subagent async grouped result intercom delivery was not acknowledged' "$PI_EVENT_LOG"; }; then
  echo '!!! unacknowledged background result — cannot prove a detached writer has stopped' >&2
  agent_gate=1
  async_unack=1
fi
if [ "$async_unack" = 1 ]; then
  echo '!!! run stopped without rollback because writer termination is unproven' >&2
  WRITER_CONFIRMED=0
  RUN_STATUS=unconfirmed
  exit 1
fi

# Whole-repository write-scope check FIRST. Restore every tracked/untracked path
# outside the explicit daily whitelist before executing protected gate scripts;
# otherwise an agent could edit the validator itself or leave README/etc dirty.
echo "--- allowed-diff check (whole repository) ---"
pa=0
SNAPSHOT_SCOPE_TRUSTED=1
if ! CURRENT_HEAD="$(git rev-parse --verify 'HEAD^{commit}')"; then
  echo "!!! cannot resolve HEAD after the agent run — failing closed"
  pa=1
  SNAPSHOT_SCOPE_TRUSTED=0
elif [ "$CURRENT_HEAD" != "$BASE_HEAD" ]; then
  echo "!!! agent changed git history — resetting to the clean pre-run HEAD and failing"
  git reset --hard -q "$BASE_HEAD" 2>/dev/null || true
  git clean -fdq 2>/dev/null || true     # ignored raw/log caches survive (no -x)
  pa=1
  SNAPSHOT_SCOPE_TRUSTED=0
else
  # Do not consume Git output through process substitutions: their exit status is
  # invisible to the parent shell. Materialize each NUL-delimited listing under
  # ignored logs/ and require every command to succeed before trusting the scope.
  scope_prefix="logs/.daily-scope-$$"
  scope_ok=1
  if ! git diff --name-only -z > "$scope_prefix.work"; then
    echo "!!! cannot enumerate unstaged changes — failing closed"
    scope_ok=0
  fi
  if ! git diff --cached --name-only -z > "$scope_prefix.index"; then
    echo "!!! cannot enumerate staged changes — failing closed"
    scope_ok=0
  fi
  if ! git ls-files --others --exclude-standard -z > "$scope_prefix.untracked"; then
    echo "!!! cannot enumerate untracked files — failing closed"
    scope_ok=0
  fi
  if [ "$scope_ok" = 1 ] && ! sort -zu "$scope_prefix.work" "$scope_prefix.index" > "$scope_prefix.tracked"; then
    echo "!!! cannot combine tracked change lists — failing closed"
    scope_ok=0
  fi

  bad_tracked=(); bad_untracked=()
  if [ "$scope_ok" = 1 ]; then
    while IFS= read -r -d '' path; do
      is_daily_path "$path" || bad_tracked+=("$path")
    done < "$scope_prefix.tracked"
    while IFS= read -r -d '' path; do
      is_daily_path "$path" || bad_untracked+=("$path")
    done < "$scope_prefix.untracked"
  else
    pa=1
    SNAPSHOT_SCOPE_TRUSTED=0
  fi
  rm -f "$scope_prefix.work" "$scope_prefix.index" "$scope_prefix.tracked" "$scope_prefix.untracked"

  if [ "$scope_ok" = 1 ] && { [ "${#bad_tracked[@]}" -gt 0 ] || [ "${#bad_untracked[@]}" -gt 0 ]; }; then
    echo "!!! agent modified paths outside the daily whitelist — restoring them and failing:"
    printf '  tracked:   %s\n' "${bad_tracked[@]}"
    printf '  untracked: %s\n' "${bad_untracked[@]}"
    [ "${#bad_tracked[@]}" -eq 0 ] || {
      git reset -q HEAD -- "${bad_tracked[@]}" 2>/dev/null || true
      git checkout -- "${bad_tracked[@]}" 2>/dev/null || true
    }
    [ "${#bad_untracked[@]}" -eq 0 ] || rm -rf -- "${bad_untracked[@]}"
    pa=1
  fi
  # Normalize accidental staging while preserving allowed working-tree edits.
  # A failed reset could leave staged out-of-scope content for publish.sh, so it
  # is a hard gate failure rather than a best-effort cleanup.
  if [ "$scope_ok" = 1 ] && ! git reset -q HEAD -- .; then
    echo "!!! cannot normalize the Git index — failing closed"
    pa=1
    SNAPSHOT_SCOPE_TRUSTED=0
  fi
fi
record gate allowed-diff "$pa" || exit 1
echo "--- preflight (render dry-run) ---"
POGO_DAILY_RUN=1 scripts/preflight.sh; pf=$?
record gate preflight "$pf" || exit 1
echo "--- validating ---"
POGO_DAILY_RUN=1 scripts/validate.sh; vl=$?
record gate validate "$vl" || exit 1

rollback_daily_tree() {
  # Reset index + worktree so staged, unstaged, deleted, and untracked daily files
  # all return to the committed baseline; ignored raw/log caches survive.
  local status_file="logs/.daily-rollback-$$"
  if ! git reset -q "$BASE_HEAD" -- public data; then
    echo "!!! rollback failed while resetting the index"
    return 1
  fi
  if ! git checkout -- public data; then
    echo "!!! rollback failed while restoring tracked content"
    return 1
  fi
  if ! git clean -fdq public data; then
    echo "!!! rollback failed while removing untracked content"
    return 1
  fi
  if ! git status --porcelain --untracked-files=all -- public data > "$status_file"; then
    echo "!!! rollback result could not be verified"
    rm -f "$status_file"
    return 1
  fi
  if [ -s "$status_file" ]; then
    echo "!!! rollback left content changes in the working tree"
    cat "$status_file"
    rm -f "$status_file"
    return 1
  fi
  rm -f "$status_file"
}

save_failed_draft_and_rollback() {
  if [ "$SNAPSHOT_SCOPE_TRUSTED" != 1 ]; then
    echo "!!! baseline/write scope is untrusted; using the existing rollback path without a snapshot"
    rollback_daily_tree || return 1
    return 0
  fi

  scripts/resume-snapshot.sh save "$RESUME_FILE" "$BASE_HEAD" "$NOTE_HASH" "$(date -u +%FT%TZ)" -- "${DAILY_PATHS[@]}"
  snapshot_rc=$?
  record gate snapshot "$snapshot_rc" || return 1
  case "$snapshot_rc" in
    0)
      if ! rollback_daily_tree; then
        echo "!!! draft was saved, but working-tree rollback failed; stopping with the snapshot retained"
        return 1
      fi
      record recovery rolled-back 0 || return 1
      echo "===== draft saved; working tree rolled back $(date -u +%FT%TZ) ====="
      return 0
      ;;
    2)
      # Disallowed paths/protected index regions are not eligible draft content.
      echo "!!! draft is outside the trusted daily scope; using the existing rollback path"
      rollback_daily_tree || return 1
      return 0
      ;;
    *)
      # Atomic save did not replace the previous snapshot. Keep this complete
      # working tree rather than destroying the only copy of today's work.
      echo "!!! pending-draft save FAILED — current working tree is preserved for manual recovery"
      return 1
      ;;
  esac
}

if [ "$agent_gate" = 0 ] && [ "$pa" = 0 ] && [ "$pf" = 0 ] && [ "$vl" = 0 ] && [ "$METRICS_OK" = 1 ]; then
  echo "--- publishing ---"
  scripts/publish.sh
  publish_rc=$?
  record gate publish "$publish_rc" || { echo "!!! publish outcome logging failed; inspect HEAD before recovery"; exit 1; }
  if [ "$publish_rc" = 0 ]; then
    if ! scripts/resume-snapshot.sh clear "$RESUME_FILE"; then
      echo "!!! publish succeeded but the pending snapshot could not be cleared"
      exit 1
    fi
    record recovery cleared 0 || exit 1
    # Sweep agent temp/backup files under data/ (untracked, non-ignored — e.g. a
    # state.json.bak): publish only commits public + data/state.json, so a stray
    # would survive and trip tomorrow's dirty-tree guard. git clean without -x
    # keeps the ignored data/raw cache.
    git clean -fdq data 2>/dev/null || true
    RUN_STATUS=published
    echo "===== done OK $(date -u +%FT%TZ) ====="
    exit 0
  fi

  echo "!!! publish FAILED (rc=$publish_rc)"
  AFTER_PUBLISH_HEAD=$(git rev-parse --verify 'HEAD^{commit}' 2>/dev/null || true)
  if [ -z "$AFTER_PUBLISH_HEAD" ] || [ "$AFTER_PUBLISH_HEAD" != "$BASE_HEAD" ]; then
    record recovery head-changed 1 || true
    echo "!!! HEAD changed during publish; refusing to roll back a possibly successful commit"
    exit 1
  fi
  save_failed_draft_and_rollback || exit 1
  exit 1
fi

echo "!!! gate FAILED (agent=$agent_gate protected=$pa preflight=$pf validate=$vl) — saving draft before rollback"
save_failed_draft_and_rollback || exit 1
exit 1
