#!/usr/bin/env bash
# Save/restore one pending daily draft as an atomic, gitignored snapshot.
set -uo pipefail

usage() {
  echo "usage: $0 save <file> <base-head> <note-hash> <created-at> -- <allowed-path>..." >&2
  echo "       $0 restore <file> <base-head> <note-hash> -- <allowed-path>..." >&2
  echo "       $0 clear <file>" >&2
  exit 64
}

path_allowed() {
  local wanted="$1" path
  for path in "${ALLOWED[@]}"; do
    [ "$wanted" = "$path" ] && return 0
  done
  return 1
}

parse_allowed() {
  [ "${1:-}" = "--" ] || usage
  shift
  [ "$#" -gt 0 ] || usage
  ALLOWED=("$@")
}

index_scope_ok() {
  local base="$1"
  path_allowed public/index.html || return 0
  [ -f public/index.html ] || return 2
  git cat-file -e "$base:public/index.html" 2>/dev/null || return 2
  python3 - "$base" <<'PY'
import re, subprocess, sys

regions = ['calendar-notes', 'rankings-current', 'rankings-attackers', 'rankings-defenders', 'rankings-raid']
current = open('public/index.html', encoding='utf-8').read()
baseline = subprocess.check_output(['git', 'show', f'{sys.argv[1]}:public/index.html'], text=True)

def shell(text):
    for name in regions:
        pattern = r'(<!-- AI:START ' + re.escape(name) + r' -->).*?(<!-- AI:END ' + re.escape(name) + r' -->)'
        text, count = re.subn(pattern, r'\1\n__DAILY_REGION_BODY__\n\2', text, flags=re.S)
        if count != 1:
            sys.exit(2)
    return text

sys.exit(0 if shell(current) == shell(baseline) else 2)
PY
}

patch_paths_ok() {
  local patch="$1" records="$2" record path
  if ! git apply --numstat -z --allow-empty "$patch" > "$records"; then
    echo "resume: snapshot patch is not parseable" >&2
    return 1
  fi
  while IFS= read -r -d '' record; do
    path=${record#*$'\t'}
    path=${path#*$'\t'}
    if [ -z "$path" ] || ! path_allowed "$path"; then
      echo "resume: snapshot contains disallowed path: ${path:-<invalid>}" >&2
      return 1
    fi
  done < "$records"
}

restore_allowed_paths() {
  git reset -q HEAD -- "${ALLOWED[@]}" 2>/dev/null || true
  git checkout -- "${ALLOWED[@]}" 2>/dev/null || true
  git clean -fdq -- "${ALLOWED[@]}" 2>/dev/null || true
}

invalidate() {
  local file="$1" reason="$2"
  echo "resume: discarded pending snapshot: $reason"
  rm -f -- "$file" || {
    echo "resume: cannot remove invalid pending snapshot" >&2
    return 1
  }
  return 4
}

save_snapshot() {
  local file="$1" base="$2" note_hash="$3" created="$4"
  shift 4
  parse_allowed "$@"

  local current dir stage index patch_hash archive
  current=$(git rev-parse --verify 'HEAD^{commit}') || return 1
  if [ "$current" != "$base" ]; then
    echo "resume: refusing to snapshot against a changed HEAD" >&2
    return 2
  fi
  if ! index_scope_ok "$base"; then
    echo "resume: public/index.html changed outside its daily AI regions; snapshot not eligible" >&2
    return 2
  fi

  dir=$(dirname "$file")
  mkdir -p "$dir" || return 1
  stage=$(mktemp -d "$dir/.build.XXXXXX") || return 1
  index=$(mktemp "$dir/.index.XXXXXX") || { rm -rf "$stage"; return 1; }
  archive=$(mktemp "$dir/.snapshot.XXXXXX") || { rm -rf "$stage" "$index"; return 1; }
  rm -f "$index"
  trap 'rm -rf "$stage" "$index" "$archive"' RETURN

  GIT_INDEX_FILE="$index" git read-tree "$base" || return 1
  local candidates=() path
  for path in "${ALLOWED[@]}"; do
    if [ -e "$path" ] || [ -L "$path" ] || git cat-file -e "$base:$path" 2>/dev/null; then
      candidates+=("$path")
    fi
  done
  if [ "${#candidates[@]}" -gt 0 ]; then
    GIT_INDEX_FILE="$index" git add -A -- "${candidates[@]}" || return 1
  fi
  GIT_INDEX_FILE="$index" git diff --cached --binary --full-index --no-renames "$base" -- > "$stage/changes.patch" || return 1
  patch_paths_ok "$stage/changes.patch" "$stage/paths" || return 2
  patch_hash=$(sha256sum "$stage/changes.patch" | awk '{print $1}') || return 1
  cat > "$stage/meta" <<EOF
version=1
base_head=$base
note_hash=$note_hash
created_at=$created
patch_sha256=$patch_hash
EOF
  tar -cf "$archive" -C "$stage" meta changes.patch || return 1
  chmod 600 "$archive" || return 1
  mv -f -- "$archive" "$file" || return 1
  trap - RETURN
  rm -rf "$stage" "$index"
  echo "resume: saved pending draft at $file"
}

restore_snapshot() {
  local file="$1" expected_base="$2" expected_note="$3"
  shift 3
  parse_allowed "$@"
  [ -f "$file" ] || return 3

  local dir stage entries version base note created expected_patch actual_patch records
  dir=$(dirname "$file")
  stage=$(mktemp -d "$dir/.restore.XXXXXX") || return 1
  trap 'rm -rf "$stage"' RETURN

  entries=$(tar -tf "$file" 2>/dev/null) || { invalidate "$file" "corrupt archive"; return $?; }
  [ "$entries" = $'meta\nchanges.patch' ] || { invalidate "$file" "unexpected archive contents"; return $?; }
  tar -xOf "$file" meta > "$stage/meta" 2>/dev/null || { invalidate "$file" "unreadable metadata"; return $?; }
  tar -xOf "$file" changes.patch > "$stage/changes.patch" 2>/dev/null || { invalidate "$file" "unreadable patch"; return $?; }

  [ "$(wc -l < "$stage/meta")" -eq 5 ] || { invalidate "$file" "invalid metadata"; return $?; }
  version=$(sed -n 's/^version=//p' "$stage/meta")
  base=$(sed -n 's/^base_head=//p' "$stage/meta")
  note=$(sed -n 's/^note_hash=//p' "$stage/meta")
  created=$(sed -n 's/^created_at=//p' "$stage/meta")
  expected_patch=$(sed -n 's/^patch_sha256=//p' "$stage/meta")
  if [ "$version" != 1 ] || ! [[ "$base" =~ ^[0-9a-f]{40,64}$ ]] \
     || ! [[ "$note" =~ ^[0-9a-f]{64}$ ]] || [ -z "$created" ] \
     || ! [[ "$expected_patch" =~ ^[0-9a-f]{64}$ ]]; then
    invalidate "$file" "invalid metadata"
    return $?
  fi
  [ "$base" = "$expected_base" ] || { invalidate "$file" "base HEAD mismatch"; return $?; }
  [ "$note" = "$expected_note" ] || { invalidate "$file" "operator-note mismatch"; return $?; }
  actual_patch=$(sha256sum "$stage/changes.patch" | awk '{print $1}') || return 1
  [ "$actual_patch" = "$expected_patch" ] || { invalidate "$file" "patch checksum mismatch"; return $?; }
  records="$stage/paths"
  patch_paths_ok "$stage/changes.patch" "$records" || { invalidate "$file" "invalid or disallowed patch"; return $?; }
  if ! git apply --check --binary --allow-empty "$stage/changes.patch"; then
    invalidate "$file" "patch no longer applies cleanly"
    return $?
  fi
  if ! git apply --binary --allow-empty "$stage/changes.patch"; then
    restore_allowed_paths
    invalidate "$file" "patch apply failed"
    return $?
  fi
  if ! index_scope_ok "$base"; then
    restore_allowed_paths
    invalidate "$file" "public/index.html protection mismatch"
    return $?
  fi

  trap - RETURN
  rm -rf "$stage"
  echo "resume: restored pending draft from $created"
}

[ "$#" -ge 2 ] || usage
command="$1"
shift
case "$command" in
  save)
    [ "$#" -ge 6 ] || usage
    save_snapshot "$@"
    ;;
  restore)
    [ "$#" -ge 5 ] || usage
    restore_snapshot "$@"
    ;;
  clear)
    [ "$#" -eq 1 ] || usage
    rm -f -- "$1"
    ;;
  *) usage ;;
esac
