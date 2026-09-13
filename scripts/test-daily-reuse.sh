#!/usr/bin/env bash
# Offline integration: real fetch/discover/candidate code, fixed sources + mock curl.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/.pi-tmp"
T=$(mktemp -d "$ROOT/.pi-tmp/daily-reuse.XXXXXX")
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/scripts" "$T/bin" "$T/data/raw" "$T/public/data"
cp "$ROOT/scripts/fetch.sh" "$ROOT/scripts/discover.sh" "$ROOT/scripts/daily-candidates.js" "$T/scripts/"
export FIXTURE="$T" TIER_METHOD=jina PATH="$T/bin:$PATH"
cat > "$T/bin/date" <<'SH'
#!/usr/bin/env bash
# Fixed now, real GNU parsing and file timestamps.
if [ "$#" = 2 ] && [ "$1" = -u ] && [[ "$2" == +* ]]; then
  exec /bin/date -u -d '2026-09-10T12:00:00Z' "$2"
fi
exec /bin/date "$@"
SH
cat > "$T/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FIXTURE/requests"
out=''; url=''; head=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -A|-H|--max-time|-X|-d) shift 2 ;;
    -*I*) head=1; shift ;;
    https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
[ ! -e "$FIXTURE/fail" ] || exit 22
if [ "$head" = 1 ]; then printf 'HTTP/2 200\r\ncontent-type: image/png\r\ncontent-length: 123\r\n'; exit; fi
[ -n "$out" ] || exit 98
case "$url" in
  */ScrapedDuck/data/events.json) cp "$FIXTURE/feed" "$out" ;;
  https://r.jina.ai/https://pokemongohub.net/post/event/) printf '[Event](https://pokemongohub.net/post/event/fixture/)\n' > "$out" ;;
  https://r.jina.ai/https://pokemongo.com/) printf '[Home](https://pokemongo.com/)\n' > "$out" ;;
  https://r.jina.ai/https://leekduck.com/events/*|https://r.jina.ai/https://pokemongohub.net/post/monthly/)
    cp "$FIXTURE/body" "$out" ;;
  *) echo "unexpected mock URL $url" >&2; exit 99 ;;
esac
touch -d '2026-09-10T12:00:00Z' "$out"
SH
cat > "$T/bin/mv" <<'SH'
#!/usr/bin/env bash
if [ "${FAIL_META_REPLACE:-0}" = 1 ] && [[ "${@: -1}" == */details/*.json ]]; then exit 73; fi
exec /bin/mv "$@"
SH
chmod +x "$T/bin/"*
fail() { echo "test-daily-reuse: FAIL: $*" >&2; exit 1; }
eq() { [ "$1" = "$2" ] || fail "expected [$2], got [$1]"; }
count() { wc -l < "$T/requests"; }
reject() {
  if "$@" > "$T/rejected.out" 2> "$T/rejected.err"; then fail "unexpected success: $*"; fi
}
cat > "$T/feed" <<'JSON'
[{"eventID":"fixture","name":"Fixture Festival","start":"2026-09-11T10:00:00","end":"2026-09-11T18:00:00","link":"https://leekduck.com/events/fixture/"}]
JSON
printf '[]\n' > "$T/public/data/events.json"
printf 'detail version one\n' > "$T/body"
: > "$T/requests"
cd "$T"

# Prepared daily discovery does no duplicate requests; standalone still fetches.
scripts/fetch.sh events events-hub events-official > /dev/null
eq "$(count)" 3
scripts/discover.sh new --cached > "$T/scan" 2> "$T/scan.err"
eq "$(count)" 3
grep -q '^NEW' "$T/scan" || fail 'missing discovered event'
scripts/discover.sh new > /dev/null 2> "$T/scan.err"
eq "$(count)" 6
cp data/raw/events.json "$T/good-feed"
for broken in missing invalid shape stale; do
  case "$broken" in
    missing) rm data/raw/events.json ;;
    invalid) echo 'not json' > data/raw/events.json ;;
    shape) echo '{}' > data/raw/events.json ;;
    stale) touch -d '2026-09-09T12:00:00Z' data/raw/events.json ;;
  esac
  reject scripts/discover.sh new --cached
  grep -q INCOMPLETE "$T/rejected.err" || fail 'incomplete scan not labeled'
  ! grep -q '无新增活动' "$T/rejected.err" || fail 'false quiet-day'
  cp "$T/good-feed" data/raw/events.json; touch -d '2026-09-10T12:00:00Z' data/raw/events.json
done
eq "$(count)" 6
cp data/raw/events-hub.txt "$T/hub"
echo 'Just a moment...' > data/raw/events-hub.txt
reject scripts/discover.sh new --cached
cp "$T/hub" data/raw/events-hub.txt; touch -d '2026-09-10T12:00:00Z' data/raw/events-hub.txt
cp public/data/events.json "$T/cal"
echo '{}' > public/data/events.json
reject scripts/discover.sh new --cached
mv "$T/cal" public/data/events.json
touch "$T/fail"
reject scripts/discover.sh new
grep -q INCOMPLETE "$T/rejected.err" || fail 'refresh failure not incomplete'
rm "$T/fail"
# Legitimate complete empty scan is different from malformed inputs.
echo '[]' > data/raw/events.json; touch -d '2026-09-10T12:00:00Z' data/raw/events.json
scripts/discover.sh new --cached > "$T/scan" 2> "$T/scan.err"
[ ! -s "$T/scan" ] || fail 'unexpected leads'
grep -q '无新增活动' "$T/scan.err" || fail 'valid empty scan failed'

u='https://leekduck.com/events/fixture/?a=1'
before=$(count)
scripts/fetch.sh url "$u" > "$T/result"
cmp "$T/body" "$T/result"
eq "$(count)" "$((before + 1))"
scripts/fetch.sh url --info "$u" > "$T/info"
jq -e --arg u "$u" '.url == $u and .ageSeconds == 0 and .stale == false and (.sha256|length)==64' "$T/info" > /dev/null
body_path=$(jq -r .path "$T/info")
cmp "$T/body" "$body_path"
# No body leakage in metadata; cached/plain output keeps exact bytes.
! grep -q 'detail version' "$T/info" || fail 'info dumped body'
scripts/fetch.sh url --cached "$u" > "$T/result"; cmp "$T/body" "$T/result"
scripts/fetch.sh url --max-age 86400 "$u" > "$T/result"; cmp "$T/body" "$T/result"
eq "$(count)" "$((before + 1))"
scripts/fetch.sh url --force "$u" > /dev/null
eq "$(count)" "$((before + 2))"
scripts/fetch.sh url "$u" > /dev/null
eq "$(count)" "$((before + 3))" # legacy call always fresh
scripts/fetch.sh url --max-age 86400 'https://leekduck.com/events/fixture/?a=2' > /dev/null
eq "$(count)" "$((before + 4))" # distinct query key
key=$(printf '%s' "$u" | sha256sum | cut -d' ' -f1)
meta="data/raw/details/$key.json"
jq '.lastFetch="2026-09-09T12:00:00Z"' "$meta" > "$T/old"; mv "$T/old" "$meta"
scripts/fetch.sh url --cached "$u" > "$T/result" 2> "$T/warning"
grep -q STALE "$T/warning" || fail 'stale cached read not labeled'
cp "$meta" "$T/saved-meta"; cp "$body_path" "$T/saved-body"
touch "$T/fail"
reject scripts/fetch.sh url --max-age 86400 "$u"
[ ! -s "$T/rejected.out" ] || fail 'refresh failure emitted stale body'
grep -q 'refresh failed' "$T/rejected.err" || fail 'missing refresh failure'
cmp "$meta" "$T/saved-meta"; cmp "$body_path" "$T/saved-body"
rm "$T/fail"
# HTTP success with empty body also must not replace last good.
: > "$T/body"
reject scripts/fetch.sh url --force "$u"
cmp "$meta" "$T/saved-meta"; cmp "$body_path" "$T/saved-body"
printf 'detail version two: new rewards\n' > "$T/body"
reject env FAIL_META_REPLACE=1 scripts/fetch.sh url --force "$u"
cmp "$meta" "$T/saved-meta"; cmp "$body_path" "$T/saved-body"
[ ! -s "$T/rejected.out" ] || fail 'metadata failure emitted uncommitted body'
scripts/fetch.sh url --max-age 86400 "$u" > "$T/result"
cmp "$T/body" "$T/result"
scripts/fetch.sh url --info "$u" > "$T/info"
jq -e '.lastFetch=="2026-09-10T12:00:00Z" and .ageSeconds==0' "$T/info" > /dev/null
[ ! -e "$body_path" ] || fail 'old body generation not cleaned after success'
# Corrupted cache cannot count as a hit.
echo 'corruption' > "$(jq -r .path "$T/info")"
reject scripts/fetch.sh url --info "$u"
scripts/fetch.sh url --max-age 86400 "$u" > "$T/result"; cmp "$T/body" "$T/result"
before=$(count)
scripts/fetch.sh url 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/1.png' > "$T/head"
grep -q 'HTTP/2 200' "$T/head"; grep -q 'content-type: image/png' "$T/head"
tail -1 "$T/requests" | grep -q -- '-fsSIL' || fail 'image no longer HEAD'
eq "$(count)" "$((before + 1))"
reject scripts/fetch.sh url --cached 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/1.png'
reject scripts/fetch.sh url 'https://example.invalid/'
reject scripts/fetch.sh url --max-age nope "$u"
eq "$(count)" "$((before + 1))"
node "$ROOT/scripts/test-daily-candidates.js" "$T"
echo 'test-daily-reuse: PASS'
