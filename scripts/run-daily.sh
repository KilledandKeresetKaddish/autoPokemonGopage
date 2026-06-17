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
LOG="logs/daily-$(date -u +%F).log"
exec > >(tee -a "$LOG") 2>&1

echo "===== daily run $(date -u +%FT%TZ) ====="

# keep the log dir bounded — drop run logs older than ~30 days
find logs -maxdepth 1 -name 'daily-*.log' -type f -mtime +30 -delete 2>/dev/null || true

AGENT_CLI="${AGENT_CLI:-claude}"
PROMPT="$(cat tasks/daily-update.md)"

run_agent() {
  case "$AGENT_CLI" in
    claude)
      # Headless Claude Code, sandboxed to this project dir.
      claude -p "$PROMPT" \
        --permission-mode acceptEdits \
        --allowedTools "Task Bash Read Edit MultiEdit Write Glob Grep" \
        --add-dir "$ROOT"
      ;;
    aider)
      aider --yes --no-auto-commit --message "$PROMPT"
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
      # Pi Coding Agent. Reads AGENTS.md automatically; -p = non-interactive print
      # mode (built-in read/write/edit/bash run without prompts). No OS sandbox, so
      # fetch.sh's network works out of the box. Pick the model via env (set in cron):
      #   PI_PROVIDER=<provider id in ~/.pi/agent/models.json>   PI_MODEL=<pattern>
      pi_args=(-p)
      [ -n "${PI_PROVIDER:-}" ] && pi_args+=(--provider "$PI_PROVIDER")
      [ -n "${PI_MODEL:-}" ] && pi_args+=(--model "$PI_MODEL")
      pi "${pi_args[@]}" "$PROMPT"
      ;;
    *)
      # Generic fallback: treat $AGENT_CLI as a command taking the prompt arg.
      "$AGENT_CLI" "$PROMPT"
      ;;
  esac
}

echo "--- invoking agent: $AGENT_CLI ---"
run_agent || echo "WARN agent exited non-zero (continuing to validation)"

echo "--- validating ---"
if scripts/validate.sh; then
  echo "--- publishing ---"
  scripts/publish.sh
  echo "===== done OK $(date -u +%FT%TZ) ====="
else
  echo "!!! validation FAILED — rolling back working tree to last good commit"
  git checkout -- public data/state.json 2>/dev/null || true
  git clean -fdq public 2>/dev/null || true
  echo "===== rolled back $(date -u +%FT%TZ) ====="
  exit 1
fi
