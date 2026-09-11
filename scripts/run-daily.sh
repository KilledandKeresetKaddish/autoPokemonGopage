#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# run-daily.sh — cron entrypoint. Invokes the configured coding-agent CLI to
# update site content, then validates and either publishes or rolls back.
#
# The agent is intentionally pluggable. Pick your CLI with the AGENT_CLI env
# var (default: claude). Add/adjust the invocation for your CLI in run_agent().
#   AGENT_CLI=claude  ./scripts/run-daily.sh
#   AGENT_CLI=aider   ./scripts/run-daily.sh
# ---------------------------------------------------------------------------
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p logs
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
LOG="logs/daily-$(date -u +%F).log"
exec > >(tee -a "$LOG") 2>&1

echo "===== daily run $(date -u +%FT%TZ) ====="

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

# keep the log dir bounded — drop run logs older than ~30 days
find logs -maxdepth 1 -name 'daily-*.log' -type f -mtime +30 -delete 2>/dev/null || true
find logs -maxdepth 1 -name 'pi-events-*.jsonl' -type f -mtime +7 -delete 2>/dev/null || true

AGENT_CLI="${AGENT_CLI:-claude}"
PI_EVENT_LOG=""
[ "$AGENT_CLI" = "pi" ] && [ "${PI_VERBOSE:-0}" = "1" ] && PI_EVENT_LOG="logs/pi-events-$(date -u +%F).jsonl"
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
  0) RESUME_RESTORED=1 ;;
  3|4) ;;
  *) echo "!!! cannot inspect/restore the pending daily snapshot — aborting"; exit 1 ;;
esac

# Inject every governing document exactly once. Pi context-file loading is disabled,
# so the model need not re-read any of these files unless genuine context compaction
# later loses a specific passage.
PROMPT="The complete daily rules and six sequential responsibility briefs are embedded below,
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
\`scripts/discover.sh new\`, and date-driven maintenance still must run. Use the
committed state at base HEAD \`$BASE_HEAD\` (for example,
\`git show $BASE_HEAD:data/state.json\`) as the last successfully processed source
baseline; do not let hashes/timestamps in the draft state create a false quiet day.
Correct the draft when sources changed, reuse content that is still valid, and do not
unconditionally redo sound work.

===== END RECOVERED DRAFT ====="
fi

run_agent() {
  case "$AGENT_CLI" in
    claude)
      # Headless Claude Code. NOTE: this is NOT sandboxed — the bare `Bash`
      # allowlist pre-approves every shell command and acceptEdits auto-accepts
      # file edits; the real guardrails are the gates + protected-area check
      # below. --bare (recent CLIs) skips hooks/plugins and this repo's
      # coding-agent CLAUDE.md; web tools are hidden so the agent relies on
      # fetch.sh/discover.sh exactly as AGENTS.md promises.
      claude -p "$PROMPT" \
        --bare \
        --permission-mode acceptEdits \
        --allowedTools "Bash Read Edit Write Glob Grep" \
        --disallowedTools "WebFetch WebSearch"
      ;;
    aider)
      aider --yes-always --no-auto-commits --message "$PROMPT"
      ;;
    gemini)
      gemini -p "$PROMPT" -y
      ;;
    codex)
      # Non-interactive. Needs file edits + outbound network (fetch.sh curls
      # ScrapedDuck/Jina). The workspace-write sandbox blocks network by default;
      # enable it in ~/.codex/config.toml:  [sandbox_workspace_write]\n network_access = true
      # (If the sandbox fights you, swap for: codex exec --dangerously-bypass-approvals-and-sandbox "$PROMPT")
      codex exec --sandbox workspace-write -a never "$PROMPT"
      ;;
    opencode)
      opencode run "$PROMPT"
      ;;
    pi)
      # One non-interactive Pi performs every embedded brief sequentially. Disable
      # ambient extensions, skills, templates, context files, and sessions so rules
      # are injected once and delegation is unavailable. Provider/model values pass
      # through byte-for-byte from the environment.
      #
      # Live debugging: set PI_VERBOSE=1 to swap -p for --mode json and tee the event
      # stream to its own clean jsonl (logs/pi-events-<UTC-date>.jsonl). Watch it from
      # another terminal with:
      #   tail -F logs/pi-events-$(date -u +%F).jsonl | jq -c 'select(.type|test("tool_execution"))'
      pi_args=(-p --no-extensions --no-skills --no-prompt-templates --no-context-files --no-session --tools read,bash,edit,write)
      [ "${PI_VERBOSE:-0}" = "1" ] && pi_args=(--mode json --no-extensions --no-skills --no-prompt-templates --no-context-files --no-session --tools read,bash,edit,write)
      [ -n "${PI_PROVIDER:-}" ] && pi_args+=(--provider "$PI_PROVIDER")
      [ -n "${PI_MODEL:-}" ] && pi_args+=(--model "$PI_MODEL")
      if [ "${PI_VERBOSE:-0}" = "1" ]; then
        pi "${pi_args[@]}" "$PROMPT" > "$PI_EVENT_LOG"
      else
        pi "${pi_args[@]}" "$PROMPT"
      fi
      ;;
    *)
      # Generic fallback: treat $AGENT_CLI as a command taking the prompt arg.
      "$AGENT_CLI" "$PROMPT"
      ;;
  esac
}

echo "--- invoking agent: $AGENT_CLI ---"
# Capture this invocation separately (the daily log may contain an earlier run
# from the same UTC day). Delegation is unavailable to the configured Pi, but
# retain the old fail-safe for any unexpected CLI output indicating an
# unacknowledged background writer.
AGENT_CAPTURE="logs/.agent-run-$(date -u +%Y%m%dT%H%M%S)-$$.out"
run_agent 2>&1 | tee "$AGENT_CAPTURE"
agent_rc=${PIPESTATUS[0]}
agent_gate=0
async_unack=0
if [ "$agent_rc" -ne 0 ]; then
  echo "!!! agent exited non-zero (rc=$agent_rc) — publication is blocked"
  # Any CLI can leave a valid-looking partial edit behind. Keep running the
  # diagnostic gates, but fail closed and roll the working tree back afterward.
  agent_gate=1
fi
if grep -qF 'Subagent async grouped result intercom delivery was not acknowledged' "$AGENT_CAPTURE" \
   || { [ -n "$PI_EVENT_LOG" ] && grep -qF 'Subagent async grouped result intercom delivery was not acknowledged' "$PI_EVENT_LOG"; }; then
  echo "!!! unacknowledged background result — refusing to validate/publish an incomplete run"
  echo "!!! inspect the result path and confirm the writer has ended before touching this checkout"
  agent_gate=1
  async_unack=1
fi
rm -f "$AGENT_CAPTURE"

# An unacknowledged async result may mean a detached writer is still alive. Do
# NOT snapshot, validate, checkout, clean or claim rollback: touching the
# checkout would race that process. Leave the tree for diagnosis; the next
# run's clean-tree guard will block automatically.
if [ "$async_unack" = 1 ]; then
  echo "!!! run stopped without rollback because writer termination is unproven"
  echo "!!! inspect/stop the child result process, then restore or commit the working tree manually"
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
echo "--- preflight (render dry-run) ---"
POGO_DAILY_RUN=1 scripts/preflight.sh; pf=$?
echo "--- validating ---"
POGO_DAILY_RUN=1 scripts/validate.sh; vl=$?

rollback_daily_tree() {
  # Reset index + worktree so staged, unstaged, deleted, and untracked daily files
  # all return to the committed baseline; ignored raw/log caches survive.
  git reset -q "$BASE_HEAD" -- public data 2>/dev/null || true
  git checkout -- public data 2>/dev/null || true
  git clean -fdq public data 2>/dev/null || true
}

save_failed_draft_and_rollback() {
  if [ "$SNAPSHOT_SCOPE_TRUSTED" != 1 ]; then
    echo "!!! baseline/write scope is untrusted; using the existing rollback path without a snapshot"
    rollback_daily_tree
    return 0
  fi

  scripts/resume-snapshot.sh save "$RESUME_FILE" "$BASE_HEAD" "$NOTE_HASH" "$(date -u +%FT%TZ)" -- "${DAILY_PATHS[@]}"
  snapshot_rc=$?
  case "$snapshot_rc" in
    0)
      rollback_daily_tree
      echo "===== draft saved; working tree rolled back $(date -u +%FT%TZ) ====="
      return 0
      ;;
    2)
      # Disallowed paths/protected index regions are not eligible draft content.
      echo "!!! draft is outside the trusted daily scope; using the existing rollback path"
      rollback_daily_tree
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

if [ "$agent_gate" = 0 ] && [ "$pa" = 0 ] && [ "$pf" = 0 ] && [ "$vl" = 0 ]; then
  echo "--- publishing ---"
  scripts/publish.sh
  publish_rc=$?
  if [ "$publish_rc" = 0 ]; then
    if ! scripts/resume-snapshot.sh clear "$RESUME_FILE"; then
      echo "!!! publish succeeded but the pending snapshot could not be cleared"
      exit 1
    fi
    # Sweep agent temp/backup files under data/ (untracked, non-ignored — e.g. a
    # state.json.bak): publish only commits public + data/state.json, so a stray
    # would survive and trip tomorrow's dirty-tree guard. git clean without -x
    # keeps the ignored data/raw cache.
    git clean -fdq data 2>/dev/null || true
    echo "===== done OK $(date -u +%FT%TZ) ====="
    exit 0
  fi

  echo "!!! publish FAILED (rc=$publish_rc)"
  AFTER_PUBLISH_HEAD=$(git rev-parse --verify 'HEAD^{commit}' 2>/dev/null || true)
  if [ -z "$AFTER_PUBLISH_HEAD" ] || [ "$AFTER_PUBLISH_HEAD" != "$BASE_HEAD" ]; then
    echo "!!! HEAD changed during publish; refusing to roll back a possibly successful commit"
    exit 1
  fi
  save_failed_draft_and_rollback || exit 1
  exit 1
fi

echo "!!! gate FAILED (agent=$agent_gate protected=$pa preflight=$pf validate=$vl) — saving draft before rollback"
save_failed_draft_and_rollback || exit 1
exit 1
