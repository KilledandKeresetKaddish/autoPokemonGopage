#!/usr/bin/env bash
# Integration checks for one-Pi prompting and failed-run draft recovery.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/.pi-tmp"
TMP_ROOT=$(mktemp -d "$ROOT/.pi-tmp/run-daily-test.XXXXXX")
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() { echo "test-run-daily: FAIL: $*" >&2; exit 1; }
assert_eq() { [ "$1" = "$2" ] || fail "expected [$2], got [$1]${3:+ ($3)}"; }
assert_file() { [ -f "$1" ] || fail "missing file: $1"; }
assert_absent() { [ ! -e "$1" ] || fail "expected absent: $1"; }
assert_clean() { [ -z "$(git -C "$1" status --porcelain --untracked-files=all)" ] || fail "dirty fixture: $1"; }

make_fixture() {
  local name="$1"
  local f="$TMP_ROOT/$name"
  mkdir -p "$f/scripts" "$f/tasks/subagents" "$f/public/data/i18n" "$f/data" "$f/bin"
  cp "$ROOT/scripts/run-daily.sh" "$ROOT/scripts/resume-snapshot.sh" "$f/scripts/"

  cat > "$f/scripts/preflight.sh" <<'SH'
#!/usr/bin/env bash
exit "${MOCK_PREFLIGHT_RC:-0}"
SH
  cat > "$f/scripts/validate.sh" <<'SH'
#!/usr/bin/env bash
exit "${MOCK_VALIDATE_RC:-0}"
SH
  cat > "$f/scripts/publish.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[ "${MOCK_PUBLISH_RC:-0}" = 0 ] || exit "$MOCK_PUBLISH_RC"
git add -A public data/state.json
git diff --cached --quiet || git commit -qm fixture-publish
[ "${MOCK_PUBLISH_AFTER_COMMIT_RC:-0}" = 0 ] || exit "$MOCK_PUBLISH_AFTER_COMMIT_RC"
SH
  chmod +x "$f/scripts/"*.sh

  cat > "$f/bin/pi" <<'SH'
#!/usr/bin/env bash
set -uo pipefail
argc=$#
[ "$argc" -gt 0 ] || exit 90
printf 'started\n' >> logs/pi-started
: > logs/mock-argv
for ((i=1; i<argc; i++)); do printf '%s\n' "${!i}" >> logs/mock-argv; done
printf '%s' "${!argc}" > logs/mock-prompt
case "${MOCK_MODE:-noop}" in
  fail-initial)
    printf 'draft-one\n' > public/data/events.json
    rm -f public/data/mega.json data/state.json
    printf 'allowed-new\n' > public/data/featured.json
    git add public/data/events.json public/data/featured.json data/state.json
    exit 7
    ;;
  fail-again)
    grep -qx 'draft-one' public/data/events.json || exit 91
    grep -qx 'allowed-new' public/data/featured.json || exit 92
    [ ! -e public/data/mega.json ] || exit 93
    [ ! -e data/state.json ] || exit 94
    printf 'draft-two\n' > public/data/events.json
    printf 'allowed-new-two\n' > public/data/featured.json
    printf 'staged\n' > public/data/rotations.json
    git add public/data/rotations.json
    printf 'staged-and-unstaged-final\n' > public/data/rotations.json
    exit 8
    ;;
  recovered-success)
    grep -qx 'draft-two' public/data/events.json || exit 95
    grep -qx 'allowed-new-two' public/data/featured.json || exit 96
    grep -qx 'staged-and-unstaged-final' public/data/rotations.json || exit 97
    [ ! -e public/data/mega.json ] || exit 98
    [ ! -e data/state.json ] || exit 99
    grep -q 'RECOVERED DRAFT — INSPECT BEFORE CONTINUING' logs/mock-prompt || exit 100
    ;;
  fresh)
    grep -qx 'base-events' public/data/events.json || exit 101
    grep -qx 'base-mega' public/data/mega.json || exit 102
    grep -qx 'base-state' data/state.json || exit 103
    [ ! -e public/data/featured.json ] || exit 104
    ;;
  modify-success)
    printf 'publish-draft\n' > public/data/events.json
    ;;
  protected-index)
    sed -i 's/<body>/<body class="forbidden">/' public/index.html
    printf 'otherwise-allowed\n' > public/data/events.json
    exit 10
    ;;
  publish-recovered)
    grep -qx 'publish-draft' public/data/events.json || exit 105
    ;;
  fail-no-edits) exit 9 ;;
  noop) ;;
  *) exit 89 ;;
esac
SH
  chmod +x "$f/bin/pi"

  printf 'RULE_AGENTS_UNIQUE\n' > "$f/AGENTS.md"
  printf 'RULE_DAILY_UNIQUE\n' > "$f/tasks/daily-update.md"
  local brief token
  for brief in 00-source-scout 10-calendar-curator 20-rotation-curator 30-ranking-curator 40-english-curator 90-state-validator; do
    token=${brief%%-*}
    printf 'RULE_BRIEF_%s_UNIQUE\n' "$token" > "$f/tasks/subagents/$brief.md"
  done
  cat > "$f/public/index.html" <<'HTML'
<html><body>
<!-- AI:START calendar-notes --><div data-ai-region="calendar-notes">base</div><!-- AI:END calendar-notes -->
<!-- AI:START rankings-current --><div data-ai-region="rankings-current">base</div><!-- AI:END rankings-current -->
<!-- AI:START rankings-attackers --><div data-ai-region="rankings-attackers">base</div><!-- AI:END rankings-attackers -->
<!-- AI:START rankings-defenders --><div data-ai-region="rankings-defenders">base</div><!-- AI:END rankings-defenders -->
<!-- AI:START rankings-raid --><div data-ai-region="rankings-raid">base</div><!-- AI:END rankings-raid -->
</body></html>
HTML
  printf 'base-events\n' > "$f/public/data/events.json"
  printf 'base-rotations\n' > "$f/public/data/rotations.json"
  printf 'base-categories\n' > "$f/public/data/categories.json"
  printf 'base-meta\n' > "$f/public/data/meta.json"
  printf 'base-mega\n' > "$f/public/data/mega.json"
  printf 'base-en\n' > "$f/public/data/i18n/en.json"
  printf 'base-locations\n' > "$f/public/data/locations.json"
  printf 'base-state\n' > "$f/data/state.json"
  printf 'logs/\n*.out\n' > "$f/.gitignore"
  printf 'fixture\n' > "$f/fixture.txt"

  git -C "$f" init -q
  git -C "$f" config user.name fixture
  git -C "$f" config user.email fixture@example.invalid
  git -C "$f" add .
  git -C "$f" commit -qm base
  printf '%s\n' "$f"
}

# Build the existing pending.tar format from selected worktree paths, then return
# the fixture to its clean baseline so run-daily exercises restoration itself.
craft_snapshot() {
  local f="$1" note="$2"
  shift 2
  local base stage index patch_hash note_hash
  base=$(git -C "$f" rev-parse HEAD)
  stage="$f/logs/craft"
  index="$stage/index"
  rm -rf "$stage"
  mkdir -p "$stage" "$f/logs/resume"
  GIT_INDEX_FILE="$index" git -C "$f" read-tree "$base"
  GIT_INDEX_FILE="$index" git -C "$f" add -A -- "$@"
  GIT_INDEX_FILE="$index" git -C "$f" diff --cached --binary --full-index --no-renames "$base" -- > "$stage/changes.patch"
  patch_hash=$(sha256sum "$stage/changes.patch" | awk '{print $1}')
  note_hash=$(printf '%s' "$note" | sha256sum | awk '{print $1}')
  cat > "$stage/meta" <<EOF
version=1
base_head=$base
note_hash=$note_hash
created_at=2026-09-11T00:00:00Z
patch_sha256=$patch_hash
EOF
  tar -cf "$f/logs/resume/pending.tar" -C "$stage" meta changes.patch
  rm -rf "$stage"
  git -C "$f" reset --hard -q "$base"
  git -C "$f" clean -fdq
  assert_clean "$f"
}

run_daily() {
  local f="$1" mode="$2" note="$3" out="$4"
  shift 4
  set +e
  (cd "$f" && env PATH="$f/bin:$PATH" AGENT_CLI=pi PI_PROVIDER=myproxy \
    PI_MODEL=gptauth/gpt-5.6-sol MOCK_MODE="$mode" "$@" ./scripts/run-daily.sh "$note") > "$out" 2>&1
  RUN_RC=$?
  set -e
}

check_pi_prompt() {
  local f="$1" arg
  for arg in -p --no-extensions --no-skills --no-prompt-templates --no-context-files --no-session --tools read,bash,edit,write --provider myproxy --model gptauth/gpt-5.6-sol; do
    assert_eq "$(grep -Fxc -- "$arg" "$f/logs/mock-argv" || true)" 1 "Pi argv: $arg"
  done
  ! grep -q -- '--exclude-tools' "$f/logs/mock-argv" || fail "legacy delegation argv remains"
  for arg in RULE_AGENTS_UNIQUE RULE_DAILY_UNIQUE RULE_BRIEF_00_UNIQUE RULE_BRIEF_10_UNIQUE RULE_BRIEF_20_UNIQUE RULE_BRIEF_30_UNIQUE RULE_BRIEF_40_UNIQUE RULE_BRIEF_90_UNIQUE; do
    assert_eq "$(grep -Foc -- "$arg" "$f/logs/mock-prompt" || true)" 1 "prompt injection: $arg"
  done
}

# Agent failure -> atomic snapshot -> rollback; next failure replaces it with the
# cumulative final tree (new/deleted/staged+unstaged), then a successful run restores
# and publishes that exact draft.
f=$(make_fixture cumulative)
run_daily "$f" fail-initial 'same-note' "$f/first.out"
[ "$RUN_RC" -ne 0 ] || fail "first failing agent returned success"
assert_file "$f/logs/resume/pending.tar"
assert_clean "$f"
assert_eq "$(cat "$f/public/data/events.json")" base-events
assert_absent "$f/public/data/featured.json"
run_daily "$f" fail-again 'same-note' "$f/second.out"
[ "$RUN_RC" -ne 0 ] || fail "second failing agent returned success"
assert_file "$f/logs/resume/pending.tar"
assert_clean "$f"
run_daily "$f" recovered-success 'same-note' "$f/third.out" EXTRA_INSTRUCTIONS=ignored-env-note
assert_eq "$RUN_RC" 0 "recovered success"
assert_absent "$f/logs/resume/pending.tar"
assert_eq "$(git -C "$f" show HEAD:public/data/events.json)" draft-two
assert_eq "$(git -C "$f" show HEAD:public/data/featured.json)" allowed-new-two
assert_eq "$(git -C "$f" show HEAD:public/data/rotations.json)" staged-and-unstaged-final
! git -C "$f" cat-file -e HEAD:public/data/mega.json 2>/dev/null || fail "deleted file was not preserved"
! git -C "$f" cat-file -e HEAD:data/state.json 2>/dev/null || fail "staged deletion was not preserved"
check_pi_prompt "$f"
python3 - "$f/logs/mock-prompt" <<'PYTEST'
import sys
text = open(sys.argv[1]).read()
assert text.index('===== OPERATOR NOTE') < text.index('===== RECOVERED DRAFT')
assert 'ignored-env-note' not in text
assert 'scripts/discover.sh new --cached' in text
assert 'committed processed-detail records' in text
assert 'tools, shell commands, APIs, extensions, or another coding-agent CLI' in text
PYTEST

# Note mismatch, HEAD mismatch, and corruption all discard eligibility and start fresh.
f=$(make_fixture note-mismatch)
run_daily "$f" fail-initial note-a "$f/fail.out"
run_daily "$f" fresh note-b "$f/fresh.out"
assert_eq "$RUN_RC" 0
assert_absent "$f/logs/resume/pending.tar"
grep -q 'operator-note mismatch' "$f/fresh.out" || fail "note mismatch reason missing"

f=$(make_fixture head-mismatch)
run_daily "$f" fail-initial same "$f/fail.out"
printf 'new-head\n' >> "$f/fixture.txt"
git -C "$f" add fixture.txt
git -C "$f" commit -qm new-head
run_daily "$f" fresh same "$f/fresh.out"
assert_eq "$RUN_RC" 0
grep -q 'base HEAD mismatch' "$f/fresh.out" || fail "HEAD mismatch reason missing"

f=$(make_fixture corrupt)
mkdir -p "$f/logs/resume"
printf 'not a tar\n' > "$f/logs/resume/pending.tar"
run_daily "$f" fresh '' "$f/fresh.out"
assert_eq "$RUN_RC" 0
grep -q 'corrupt archive' "$f/fresh.out" || fail "corrupt snapshot reason missing"
assert_absent "$f/logs/resume/pending.tar"

# A crafted draft may contain an allowed path absent from HEAD plus an index shell
# violation. Rejection must remove the new path and restore every tracked path before
# a fresh Pi run starts.
f=$(make_fixture rejected-cleanup)
sed -i 's/<body>/<body class="forbidden">/' "$f/public/index.html"
printf 'allowed-new\n' > "$f/public/data/featured.json"
craft_snapshot "$f" same public/index.html public/data/featured.json
rm -f "$f/logs/pi-started"
run_daily "$f" fresh same "$f/restore.out"
assert_eq "$RUN_RC" 0
assert_clean "$f"
assert_absent "$f/logs/resume/pending.tar"
assert_file "$f/logs/pi-started"
grep -q 'public/index.html protection mismatch' "$f/restore.out" || fail "restored protection violation was not rejected"

# If that cleanup command fails, pending.tar remains the recovery source and Pi must
# not start against a partially cleaned tree.
f=$(make_fixture cleanup-failure)
sed -i 's/<body>/<body class="forbidden">/' "$f/public/index.html"
printf 'allowed-new\n' > "$f/public/data/featured.json"
craft_snapshot "$f" same public/index.html public/data/featured.json
old_snapshot=$(sha256sum "$f/logs/resume/pending.tar" | awk '{print $1}')
mkdir -p "$f/logs/fail-bin"
cat > "$f/logs/fail-bin/git" <<'SH'
#!/usr/bin/env bash
if [ "${MOCK_FAIL_RESTORE_CHECKOUT:-0}" = 1 ] && [ "${1:-}" = checkout ]; then exit 73; fi
exec /usr/bin/git "$@"
SH
chmod +x "$f/logs/fail-bin/git"
rm -f "$f/logs/pi-started"
run_daily "$f" fresh same "$f/restore.out" PATH="$f/bin:$f/logs/fail-bin:$PATH" MOCK_FAIL_RESTORE_CHECKOUT=1
[ "$RUN_RC" -ne 0 ] || fail "cleanup command failure returned success"
assert_absent "$f/logs/pi-started"
assert_file "$f/logs/resume/pending.tar"
assert_eq "$(sha256sum "$f/logs/resume/pending.tar" | awk '{print $1}')" "$old_snapshot" "cleanup failure deleted/replaced pending snapshot"
grep -q 'rejected draft cleanup failed; pending snapshot retained' "$f/restore.out" || fail "cleanup hard failure not reported"

# A post-apply checker execution failure restores the baseline if possible, retains
# the legal snapshot, and hard-stops before Pi.
f=$(make_fixture restore-checker-failure)
printf 'legal-draft\n' > "$f/public/data/events.json"
craft_snapshot "$f" same public/data/events.json
old_snapshot=$(sha256sum "$f/logs/resume/pending.tar" | awk '{print $1}')
mkdir -p "$f/logs/fail-bin"
printf '#!/usr/bin/env bash\nexit 74\n' > "$f/logs/fail-bin/python3"
chmod +x "$f/logs/fail-bin/python3"
rm -f "$f/logs/pi-started"
run_daily "$f" fresh same "$f/restore.out" PATH="$f/bin:$f/logs/fail-bin:$PATH"
[ "$RUN_RC" -ne 0 ] || fail "checker execution failure returned success"
assert_absent "$f/logs/pi-started"
assert_clean "$f"
assert_eq "$(cat "$f/public/data/events.json")" base-events
assert_eq "$(sha256sum "$f/logs/resume/pending.tar" | awk '{print $1}')" "$old_snapshot" "checker failure did not retain legal snapshot"
grep -q 'post-apply index protection check failed' "$f/restore.out" || fail "checker failure not reported"

# Failure to execute the patch-path checker is also operational: retain the pending
# snapshot and stop before applying it or invoking Pi.
f=$(make_fixture path-checker-failure)
printf 'legal-draft\n' > "$f/public/data/events.json"
craft_snapshot "$f" same public/data/events.json
old_snapshot=$(sha256sum "$f/logs/resume/pending.tar" | awk '{print $1}')
mkdir -p "$f/logs/fail-bin"
cat > "$f/logs/fail-bin/git" <<'SH'
#!/usr/bin/env bash
if [ "${MOCK_FAIL_PATH_CHECK:-0}" = 1 ] && [ "${1:-}" = apply ] && [ "${2:-}" = --numstat ]; then exit 76; fi
exec /usr/bin/git "$@"
SH
chmod +x "$f/logs/fail-bin/git"
rm -f "$f/logs/pi-started"
run_daily "$f" fresh same "$f/restore.out" PATH="$f/bin:$f/logs/fail-bin:$PATH" MOCK_FAIL_PATH_CHECK=1
[ "$RUN_RC" -ne 0 ] || fail "path-checker execution failure returned success"
assert_absent "$f/logs/pi-started"
assert_clean "$f"
assert_eq "$(sha256sum "$f/logs/resume/pending.tar" | awk '{print $1}')" "$old_snapshot" "path-checker failure discarded pending snapshot"
grep -q 'cannot verify pending snapshot paths' "$f/restore.out" || fail "path-checker error misclassified"

# An applicability pre-check command failure is ambiguous: retain the legal snapshot,
# leave the still-clean tree alone, and stop before Pi.
f=$(make_fixture apply-check-failure)
printf 'legal-draft\n' > "$f/public/data/events.json"
craft_snapshot "$f" same public/data/events.json
old_snapshot=$(sha256sum "$f/logs/resume/pending.tar" | awk '{print $1}')
mkdir -p "$f/logs/fail-bin"
cat > "$f/logs/fail-bin/git" <<'SH'
#!/usr/bin/env bash
if [ "${MOCK_FAIL_APPLY_CHECK:-0}" = 1 ] && [ "${1:-}" = apply ] && [ "${2:-}" = --check ]; then
  echo 'mock git apply --check failure' >&2
  exit 77
fi
exec /usr/bin/git "$@"
SH
chmod +x "$f/logs/fail-bin/git"
rm -f "$f/logs/pi-started"
run_daily "$f" fresh same "$f/restore.out" PATH="$f/bin:$f/logs/fail-bin:$PATH" MOCK_FAIL_APPLY_CHECK=1
[ "$RUN_RC" -ne 0 ] || fail "apply pre-check failure returned success"
assert_absent "$f/logs/pi-started"
assert_clean "$f"
assert_eq "$(sha256sum "$f/logs/resume/pending.tar" | awk '{print $1}')" "$old_snapshot" "apply pre-check failure discarded pending snapshot"
grep -q 'mock git apply --check failure' "$f/restore.out" || fail "original apply pre-check error missing"
grep -q 'patch applicability pre-check failed' "$f/restore.out" || fail "apply pre-check hard failure not reported"

# A confirmed disallowed patch path remains an invalid snapshot, not an operational
# checker failure: reject it and continue fresh.
f=$(make_fixture disallowed-path)
printf 'forbidden-draft\n' > "$f/fixture.txt"
craft_snapshot "$f" same fixture.txt
rm -f "$f/logs/pi-started"
run_daily "$f" fresh same "$f/restore.out"
assert_eq "$RUN_RC" 0
assert_clean "$f"
assert_absent "$f/logs/resume/pending.tar"
assert_file "$f/logs/pi-started"
grep -q 'invalid or disallowed patch' "$f/restore.out" || fail "disallowed path was not rejected"

# A snapshot I/O failure must leave the current tree untouched and must not delete
# the previous complete snapshot before its replacement exists.
f=$(make_fixture save-failure)
run_daily "$f" fail-initial same "$f/first.out"
old_snapshot=$(sha256sum "$f/logs/resume/pending.tar" | awk '{print $1}')
mkdir -p "$f/logs/fail-bin"
printf '#!/usr/bin/env bash\n[ "${1:-}" = -cf ] && exit 77\nexec /usr/bin/tar "$@"\n' > "$f/logs/fail-bin/tar"
chmod +x "$f/logs/fail-bin/tar"
set +e
(cd "$f" && env PATH="$f/bin:$f/logs/fail-bin:$PATH" AGENT_CLI=pi MOCK_MODE=fail-again ./scripts/run-daily.sh same) > "$f/fail.out" 2>&1
RUN_RC=$?
set -e
[ "$RUN_RC" -ne 0 ] || fail "snapshot write failure returned success"
assert_eq "$(cat "$f/public/data/events.json")" draft-two
assert_eq "$(cat "$f/public/data/featured.json")" allowed-new-two
assert_absent "$f/public/data/mega.json"
assert_eq "$(sha256sum "$f/logs/resume/pending.tar" | awk '{print $1}')" "$old_snapshot" "previous snapshot changed before atomic replacement"
grep -q 'current working tree is preserved' "$f/fail.out" || fail "save-failure preservation not reported"

# An operational index checker failure while replacing a restored snapshot is a save
# error, not a confirmed scope violation: keep both the current tree and old snapshot.
f=$(make_fixture save-checker-failure)
run_daily "$f" fail-initial same "$f/first.out"
old_snapshot=$(sha256sum "$f/logs/resume/pending.tar" | awk '{print $1}')
mkdir -p "$f/logs/fail-bin"
cat > "$f/logs/fail-bin/python3" <<'SH'
#!/usr/bin/env bash
count_file=logs/python-count
count=0
[ ! -f "$count_file" ] || count=$(cat "$count_file")
count=$((count + 1))
printf '%s\n' "$count" > "$count_file"
[ "$count" -eq 1 ] && exec /usr/bin/python3 "$@"
exit 75
SH
chmod +x "$f/logs/fail-bin/python3"
run_daily "$f" fail-again same "$f/fail.out" PATH="$f/bin:$f/logs/fail-bin:$PATH"
[ "$RUN_RC" -ne 0 ] || fail "save-side checker failure returned success"
assert_eq "$(cat "$f/public/data/events.json")" draft-two
assert_eq "$(sha256sum "$f/logs/resume/pending.tar" | awk '{print $1}')" "$old_snapshot" "save-side checker failure replaced old snapshot"
grep -q 'cannot verify public/index.html scope' "$f/fail.out" || fail "save-side checker error misclassified"

# Changes outside the protected index regions are ineligible and use the old rollback.
f=$(make_fixture protected-index)
run_daily "$f" protected-index '' "$f/fail.out"
[ "$RUN_RC" -ne 0 ] || fail "protected index change returned success"
assert_absent "$f/logs/resume/pending.tar"
assert_clean "$f"
grep -q 'outside the trusted daily scope' "$f/fail.out" || fail "protected-region rejection missing"

# Empty failed drafts restore and are cleared by a successful no-op.
f=$(make_fixture noop)
run_daily "$f" fail-no-edits '' "$f/fail.out"
[ "$RUN_RC" -ne 0 ] || fail "empty failing run returned success"
assert_file "$f/logs/resume/pending.tar"
run_daily "$f" noop '' "$f/success.out"
assert_eq "$RUN_RC" 0
assert_absent "$f/logs/resume/pending.tar"
grep -q 'restored pending draft' "$f/success.out" || fail "empty snapshot was not restored"

# Gate and pre-commit publish failures use the same preservation path.
f=$(make_fixture gate)
run_daily "$f" modify-success '' "$f/gate.out" MOCK_VALIDATE_RC=6
[ "$RUN_RC" -ne 0 ] || fail "failed gate returned success"
assert_file "$f/logs/resume/pending.tar"
assert_clean "$f"

f=$(make_fixture publish)
run_daily "$f" modify-success '' "$f/publish.out" MOCK_PUBLISH_RC=12
[ "$RUN_RC" -ne 0 ] || fail "failed publish returned success"
assert_file "$f/logs/resume/pending.tar"
assert_clean "$f"
run_daily "$f" publish-recovered '' "$f/recover.out"
assert_eq "$RUN_RC" 0
assert_absent "$f/logs/resume/pending.tar"
assert_eq "$(git -C "$f" show HEAD:public/data/events.json)" publish-draft

f=$(make_fixture published-commit)
run_daily "$f" modify-success '' "$f/publish.out" MOCK_PUBLISH_AFTER_COMMIT_RC=13
[ "$RUN_RC" -ne 0 ] || fail "post-commit publish failure returned success"
assert_eq "$(git -C "$f" show HEAD:public/data/events.json)" publish-draft
assert_clean "$f"
grep -q 'refusing to roll back a possibly successful commit' "$f/publish.out" || fail "published commit rollback guard missing"

# Real eight documents are still embedded in full exactly once (not only sentinel
# fixture rules). This tests transport/priority/argv, not model rule compliance.
f=$(make_fixture actual-prompt)
cp "$ROOT/AGENTS.md" "$f/AGENTS.md"
cp "$ROOT/tasks/daily-update.md" "$f/tasks/daily-update.md"
cp "$ROOT/tasks/subagents/"*.md "$f/tasks/subagents/"
git -C "$f" add AGENTS.md tasks
git -C "$f" commit -qm actual-rules
run_daily "$f" noop '' "$f/actual.out" PI_VERBOSE=1 EXTRA_INSTRUCTIONS='exact env note — verify' \
  PI_PROVIDER='myproxy exact' PI_MODEL='gptauth/gpt-5.6-sol' TIER_METHOD=jina
assert_eq "$RUN_RC" 0
assert_eq "$(grep -Fxc -- '--mode' "$f/logs/mock-argv")" 1
assert_eq "$(grep -Fxc -- 'json' "$f/logs/mock-argv")" 1
! grep -Fxq -- '-p' "$f/logs/mock-argv" || fail 'verbose mode kept -p'
assert_eq "$(grep -Fxc -- 'myproxy exact' "$f/logs/mock-argv")" 1
assert_eq "$(grep -Fxc -- 'gptauth/gpt-5.6-sol' "$f/logs/mock-argv")" 1
python3 - "$f" <<'PYTEST'
import pathlib, sys
root = pathlib.Path(sys.argv[1])
text = (root / 'logs/mock-prompt').read_text()
files = ['AGENTS.md', 'tasks/daily-update.md'] + sorted(str(p.relative_to(root)) for p in (root / 'tasks/subagents').glob('*.md'))
assert len(files) == 8
for file in files:
    start, end = f'===== begin {file} =====', f'===== end {file} ====='
    assert text.count(start) == text.count(end) == 1
    body = text.split(start, 1)[1].split(end, 1)[0].strip()
    assert body == (root / file).read_text().strip()
assert text.count('exact env note — verify') == 1
assert text.index('===== OPERATOR NOTE') > text.index('===== end tasks/subagents/90-state-validator.md')
assert '===== RECOVERED DRAFT' not in text
PYTEST

echo "test-run-daily: PASS"
