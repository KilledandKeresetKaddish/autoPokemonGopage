#!/usr/bin/env bash
# Runs only as the isolated child of daily-agent-run.py. One CLI, one prompt.
set -uo pipefail
PROMPT=$(cat "$1") || exit 1
case "${AGENT_CLI:-claude}" in
  claude)
    claude -p "$PROMPT" --bare --permission-mode acceptEdits \
      --allowedTools "Bash Read Edit Write Glob Grep" --disallowedTools "WebFetch WebSearch" ;;
  aider) aider --yes-always --no-auto-commits --message "$PROMPT" ;;
  gemini) gemini -p "$PROMPT" -y ;;
  codex) codex exec --sandbox workspace-write -a never "$PROMPT" ;;
  opencode) opencode run "$PROMPT" ;;
  pi)
    # Confirm these flags against `pi --help` on the deployment host before use.
    # -p stays the default: silence is not evidence of a stall. No provider changes.
    pi_args=(-p --no-extensions --no-skills --no-prompt-templates --no-context-files --no-session --tools read,bash,edit,write)
    [ "${PI_VERBOSE:-0}" = 1 ] && pi_args=(--mode json --no-extensions --no-skills --no-prompt-templates --no-context-files --no-session --tools read,bash,edit,write)
    [ -n "${PI_PROVIDER:-}" ] && pi_args+=(--provider "$PI_PROVIDER")
    [ -n "${PI_MODEL:-}" ] && pi_args+=(--model "$PI_MODEL")
    if [ "${PI_VERBOSE:-0}" = 1 ]; then
      pi "${pi_args[@]}" "$PROMPT" > "$PI_EVENT_LOG"
    else
      pi "${pi_args[@]}" "$PROMPT"
    fi ;;
  *) "${AGENT_CLI}" "$PROMPT" ;;
esac
