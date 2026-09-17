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
    --data-urlencode)
      case "$2" in page=*) printf '%s\n' "${2#page=}" >> "$FIXTURE/fandom-pages" ;; esac
      shift 2 ;;
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
  https://pokemongo.fandom.com/api.php)
    case "${FANDOM_MODE:-valid}" in
      valid) cp "$FIXTURE/fandom-valid.json" "$out" ;;
      api-error) cp "$FIXTURE/fandom-api-error.json" "$out" ;;
      empty) cp "$FIXTURE/fandom-empty.json" "$out" ;;
      whitespace) cp "$FIXTURE/fandom-whitespace.json" "$out" ;;
      challenge) cp "$FIXTURE/fandom-challenge.json" "$out" ;;
      *) echo "unexpected FANDOM_MODE $FANDOM_MODE" >&2; exit 99 ;;
    esac ;;
  *) echo "unexpected mock URL $url" >&2; exit 99 ;;
esac
touch -d '2026-09-10T12:00:00Z' "$out"
SH
cat > "$T/bin/mv" <<'SH'
#!/usr/bin/env bash
if [ "${FAIL_META_REPLACE:-0}" = 1 ] && [[ "${@: -1}" == */details/*.json ]]; then exit 73; fi
exec /bin/mv "$@"
SH
cat > "$T/bin/head" <<'SH'
#!/usr/bin/env bash
target="${@: -1}"
if [ "${1:-}" = -c ] && [ "${2:-}" = 16384 ]; then
  case "${FAIL_DETAIL_CHECK:-}" in
    cached) [[ "$target" == */details/*.txt ]] && { echo 'mock cached-body inspection failure' >&2; exit 79; } ;;
    fresh) [[ "$target" == */details/.fetch.* ]] && { echo 'mock fresh-body inspection failure' >&2; exit 79; } ;;
  esac
fi
exec /usr/bin/head "$@"
SH
# Match exact extraction filters/options so faults cannot hit front-door validation.
export REAL_JQ="$(command -v jq)" REAL_GREP="$(command -v grep)" REAL_TEE="$(command -v tee)"
cat > "$T/bin/jq" <<'SH'
#!/usr/bin/env bash
for arg in "$@"; do
  if { [ "${DISCOVERY_FAULT:-}" = feed ] && [[ "$arg" == *'select($endd >= $today'* ]]; } ||
     { [ "${DISCOVERY_FAULT:-}" = calendar ] && [ "$arg" = '.[] | "\(.id) \(.name) \(.link)"' ]; }; then
    echo "mock jq failure at $DISCOVERY_FAULT extraction" >&2; exit 77
  fi
done
exec "$REAL_JQ" "$@"
SH
cat > "$T/bin/grep" <<'SH'
#!/usr/bin/env bash
if [ "${DISCOVERY_FAULT:-}" = official ] && [ "${1:-}" = -oE ] &&
   [ "${2:-}" = 'https://(www\.)?pokemongo\.com/(news|post)/[a-zA-Z0-9/_-]+' ]; then
  echo 'mock grep read error at official extraction' >&2; exit 2
fi
exec "$REAL_GREP" "$@"
SH
cat > "$T/bin/tee" <<'SH'
#!/usr/bin/env bash
if [ "${DISCOVERY_FAULT:-}" = output ]; then
  echo 'mock tee result write failure' >&2; exit 74
fi
exec "$REAL_TEE" "$@"
SH
chmod +x "$T/bin/"*
fail() { echo "test-daily-reuse: FAIL: $*" >&2; exit 1; }
eq() { [ "$1" = "$2" ] || fail "expected [$2], got [$1]"; }
count() { wc -l < "$T/requests"; }
detail_key() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }
no_detail_cache() {
  local key
  key="$(detail_key "$1")"
  [ ! -e "data/raw/details/$key.json" ] || fail "unexpected detail metadata: $1"
  if compgen -G "data/raw/details/$key.*.txt" > /dev/null; then fail "unexpected detail body: $1"; fi
}
reject() {
  if "$@" > "$T/rejected.out" 2> "$T/rejected.err"; then fail "unexpected success: $*"; fi
}
cat > "$T/feed" <<'JSON'
[{"eventID":"fixture","name":"Fixture Festival","start":"2026-09-11T10:00:00","end":"2026-09-11T18:00:00","link":"https://leekduck.com/events/fixture/"}]
JSON
printf '[]\n' > "$T/public/data/events.json"
printf 'detail version one\n' > "$T/body"
cat > "$T/fandom-article" <<'HTML'
<section><p>October 10, 2026: Zorua appears during Community Day.</p><table><tr><td>Bonus</td><td>3× Catch Stardust</td></tr></table><a href="/wiki/Zorua">Zorua</a></section>
HTML
jq -n --rawfile text "$T/fandom-article" \
  '{parse:{title:"October 2026 Community Day: Zorua\u0027s Return",text:$text}}' > "$T/fandom-valid.json"
printf '%s\n' '{"error":{"code":"missingtitle","info":"The page you specified does not exist."}}' > "$T/fandom-api-error.json"
printf '%s\n' '{"parse":{"title":"Empty page","text":""}}' > "$T/fandom-empty.json"
printf '%s\n' '{"parse":{"title":"Blank page","text":"  \n\t\n"}}' > "$T/fandom-whitespace.json"
printf '%s\n' '{"parse":{"title":"Blocked page","text":"<title>Just a moment...</title>"}}' > "$T/fandom-challenge.json"
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
# Each index must contain its OWN source domain, not just the other primary.
before=$(count)
cp -p data/raw/events-hub.txt "$T/hub-good"
cp -p data/raw/events-official.txt "$T/official-good"
for wrong in hub official; do
  if [ "$wrong" = hub ]; then
    cp -p "$T/official-good" data/raw/events-hub.txt
  else
    cp -p "$T/hub-good" data/raw/events-official.txt
  fi
  reject scripts/discover.sh new --cached
  grep -q 'INCOMPLETE.*index/source link' "$T/rejected.err" || fail 'wrong-domain index accepted/misclassified'
  ! grep -q '无新增活动' "$T/rejected.err" || fail 'wrong-domain false empty scan'
  cp -p "$T/hub-good" data/raw/events-hub.txt
  cp -p "$T/official-good" data/raw/events-official.txt
done
# Preconditions are valid and feed has a candidate. Each injected command must
# actually run and its original diagnostic + specific failing step must survive.
for fault in feed calendar official output; do
  reject env DISCOVERY_FAULT="$fault" scripts/discover.sh new --cached
  case "$fault" in
    feed) step='feed candidate extraction'; diagnostic='mock jq failure at feed extraction' ;;
    calendar) step='calendar text extraction'; diagnostic='mock jq failure at calendar extraction' ;;
    official) step='official URL extraction'; diagnostic='mock grep read error at official extraction' ;;
    output) step='result write/output'; diagnostic='mock tee result write failure' ;;
  esac
  grep -Fq "INCOMPLETE — $step" "$T/rejected.err" || fail "missing failure step: $fault"
  grep -Fq "$diagnostic" "$T/rejected.err" || fail "fault did not hit its extraction: $fault"
  ! grep -q '无新增活动' "$T/rejected.err" || fail "fault reported as empty: $fault"
  [ ! -s "$T/rejected.out" ] || fail "unexpected partial result: $fault"
done
# Normal feed + official candidates survive completely, with official dedup.
printf '[News](https://pokemongo.com/news/unique-festival/)\nhttps://pokemongo.com/news/unique-festival/\n' > data/raw/events-official.txt
touch -d '2026-09-10T12:00:00Z' data/raw/events-official.txt
scripts/discover.sh new --cached > "$T/scan" 2> "$T/scan.err"
eq "$(wc -l < "$T/scan")" 2
grep -q $'^NEW\tFixture Festival\t' "$T/scan" || fail 'feed candidate lost'
grep -Fxq $'OFFICIAL-LEAD\t-\thttps://pokemongo.com/news/unique-festival/' "$T/scan" || fail 'official candidate lost'
cmp "$T/scan" "data/raw/discovery/new-20260910T120000Z.txt"
# jq filtering all known feed rows is valid; matching official slugs are covered.
jq '[.[] | {id:.eventID,name,link}]' "$T/good-feed" > public/data/events.json
printf 'https://pokemongo.com/news/fixture\n' > data/raw/events-official.txt
touch -d '2026-09-10T12:00:00Z' data/raw/events-official.txt
scripts/discover.sh new --cached > "$T/scan" 2> "$T/scan.err"
[ ! -s "$T/scan" ] || fail 'known events should be filtered out'
grep -q '无新增活动' "$T/scan.err" || fail 'filtered empty scan failed'
printf '[]\n' > public/data/events.json
cp -p "$T/official-good" data/raw/events-official.txt
eq "$(count)" "$before" # every cached success/failure above stayed offline
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
key="$(detail_key "$u")"
meta="data/raw/details/$key.json"
cmp "$T/body" "$body_path"
# No body leakage in metadata; cached/plain output keeps exact bytes.
! grep -q 'detail version' "$T/info" || fail 'info dumped body'
scripts/fetch.sh url --cached "$u" > "$T/result"; cmp "$T/body" "$T/result"
scripts/fetch.sh url --max-age 86400 "$u" > "$T/result"; cmp "$T/body" "$T/result"
eq "$(count)" "$((before + 1))"
# Explicit challenge/error markers never become a first cache generation.
bad_bodies=(
  '<!doctype html><html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>'
  '<html><head><title>Attention Required! | Cloudflare</title></head><body>Blocked</body></html>'
  'Title: Internal Server Error
URL Source: https://example.invalid/
Warning: Target URL returned error 403: Forbidden
Markdown Content:
Access denied by origin.'
  '403 Forbidden'
  'Access Denied'
  'Cloudflare Ray ID: 8abcdef012345678'
  '{"status":"error","message":"solver unavailable"}'
)
for i in "${!bad_bodies[@]}"; do
  bad_url="https://leekduck.com/events/blocked/?case=$i"
  printf '%s\n' "${bad_bodies[$i]}" > "$T/body"
  before_bad=$(count)
  reject scripts/fetch.sh url "$bad_url"
  [ ! -s "$T/rejected.out" ] || fail 'rejected response leaked to stdout'
  grep -q 'rejected detail body' "$T/rejected.err" || fail 'missing rejected-body diagnostic'
  eq "$(count)" "$((before_bad + 1))"
  no_detail_cache "$bad_url"
done
# Normal prose can quote the same errors without being rejected.
normal_terms='Title: Pokemon GO login troubleshooting
Players may see "Access Denied" or "403 Forbidden" when logging in. Here are the steps to resolve it.'
printf '%s\n' "$normal_terms" > "$T/body"
normal_url='https://leekduck.com/events/ordinary-error-terms/'
scripts/fetch.sh url "$normal_url" > "$T/result"
cmp <(printf '%s\n' "$normal_terms") "$T/result"
# Whitespace-only downloads are invalid and never create a cache generation.
blank_url='https://leekduck.com/events/blank-response/'
printf ' \n\t\n' > "$T/body"
before_blank=$(count)
reject scripts/fetch.sh url "$blank_url"
[ ! -s "$T/rejected.out" ] || fail 'blank response leaked to stdout'
grep -q 'blank response' "$T/rejected.err" || fail 'blank response reason missing'
eq "$(count)" "$((before_blank + 1))"
no_detail_cache "$blank_url"
# A long whitespace prefix is fine when real content follows beyond the sample.
dd if=/dev/zero bs=17000 count=1 2>/dev/null | tr '\0' ' ' > "$T/body"
printf '\nreal article after whitespace prefix\n' >> "$T/body"
long_prefix_url='https://leekduck.com/events/long-whitespace-prefix/'
scripts/fetch.sh url "$long_prefix_url" > "$T/result"
cmp "$T/body" "$T/result"
# A failed forced refresh must retain a legitimate old body and its metadata.
printf '%s\n' 'Target URL returned error 403: Forbidden' > "$T/body"
cp "$meta" "$T/pre-challenge-meta"; cp "$body_path" "$T/pre-challenge-body"
before_challenge=$(count)
reject scripts/fetch.sh url --force "$u"
[ ! -s "$T/rejected.out" ] || fail 'forced challenge leaked to stdout'
eq "$(count)" "$((before_challenge + 1))"
cmp "$meta" "$T/pre-challenge-meta"; cmp "$body_path" "$T/pre-challenge-body"
# A cached-body inspection failure is not cache invalidation: every mode fails
# before network access and preserves the previous body and metadata, even when
# the would-be refreshed response is valid.
printf 'would-be valid refresh body\n' > "$T/body"
before_check_failure=$(count)
for mode in force cached info age; do
  case "$mode" in
    force) args=(--force) ;;
    cached) args=(--cached) ;;
    info) args=(--info) ;;
    age) args=(--max-age 86400) ;;
  esac
  reject env FAIL_DETAIL_CHECK=cached scripts/fetch.sh url "${args[@]}" "$u"
  [ ! -s "$T/rejected.out" ] || fail "cached inspection failure leaked to stdout: $mode"
  grep -q 'prefix inspection failed' "$T/rejected.err" || fail "cached inspection failure reason missing: $mode"
done
eq "$(count)" "$before_check_failure"
cmp "$meta" "$T/pre-challenge-meta"; cmp "$body_path" "$T/pre-challenge-body"
# A fresh-body inspection failure occurs after one request but still preserves
# the old cache generation.
printf 'fresh valid article body\n' > "$T/body"
before_fresh_check=$(count)
reject env FAIL_DETAIL_CHECK=fresh scripts/fetch.sh url --force "$u"
[ ! -s "$T/rejected.out" ] || fail 'fresh inspection failure leaked to stdout'
grep -q 'detail body inspection failed.*prefix inspection failed' "$T/rejected.err" || fail 'fresh inspection failure reason missing'
eq "$(count)" "$((before_fresh_check + 1))"
cmp "$meta" "$T/pre-challenge-meta"; cmp "$body_path" "$T/pre-challenge-body"
printf 'detail version one\n' > "$T/body"
# A manually seeded, fresh challenge cache is invalid for cached/info reuse and
# makes --max-age refresh instead of returning its body.
old_challenge_url='https://leekduck.com/events/old-challenge/'
old_challenge_key="$(detail_key "$old_challenge_url")"
printf 'Just a moment...\n' > "$T/old-challenge-body"
old_challenge_hash="$(sha256sum "$T/old-challenge-body" | cut -d' ' -f1)"
old_challenge_body="data/raw/details/$old_challenge_key.$old_challenge_hash.txt"
mkdir -p data/raw/details
cp "$T/old-challenge-body" "$old_challenge_body"
jq -n --arg u "$old_challenge_url" --arg h "$old_challenge_hash" \
  '{url:$u,lastFetch:"2026-09-10T12:00:00Z",sha256:$h}' > "data/raw/details/$old_challenge_key.json"
cp "data/raw/details/$old_challenge_key.json" "$T/old-challenge-meta"
before_old=$(count)
reject scripts/fetch.sh url --cached "$old_challenge_url"
[ ! -s "$T/rejected.out" ] || fail 'cached challenge leaked to stdout'
eq "$(count)" "$before_old"
reject scripts/fetch.sh url --info "$old_challenge_url"
eq "$(count)" "$before_old"
touch "$T/fail"
reject scripts/fetch.sh url --max-age 86400 "$old_challenge_url"
[ ! -s "$T/rejected.out" ] || fail 'failed challenge refresh leaked to stdout'
eq "$(count)" "$((before_old + 1))"
cmp "data/raw/details/$old_challenge_key.json" "$T/old-challenge-meta"
cmp "$old_challenge_body" "$T/old-challenge-body"
rm "$T/fail"
printf 'recovered article body\n' > "$T/body"
scripts/fetch.sh url --max-age 86400 "$old_challenge_url" > "$T/result"
cmp "$T/body" "$T/result"
jq -e --arg h "$old_challenge_hash" '.sha256 != $h' "data/raw/details/$old_challenge_key.json" > /dev/null
# A fresh, hash-valid whitespace cache is also a miss. Cached mode stays offline;
# max-age refreshes it and only then replaces the invalid generation.
old_blank_url='https://leekduck.com/events/old-blank/'
old_blank_key="$(detail_key "$old_blank_url")"
printf ' \n\t\n' > "$T/old-blank-body"
old_blank_hash="$(sha256sum "$T/old-blank-body" | cut -d' ' -f1)"
old_blank_body="data/raw/details/$old_blank_key.$old_blank_hash.txt"
cp "$T/old-blank-body" "$old_blank_body"
jq -n --arg u "$old_blank_url" --arg h "$old_blank_hash" \
  '{url:$u,lastFetch:"2026-09-10T12:00:00Z",sha256:$h}' > "data/raw/details/$old_blank_key.json"
before_old_blank=$(count)
reject scripts/fetch.sh url --cached "$old_blank_url"
[ ! -s "$T/rejected.out" ] || fail 'cached blank body leaked to stdout'
eq "$(count)" "$before_old_blank"
printf 'article replacing blank cache\n' > "$T/body"
scripts/fetch.sh url --max-age 86400 "$old_blank_url" > "$T/result"
cmp "$T/body" "$T/result"
eq "$(count)" "$((before_old_blank + 1))"
[ ! -e "$old_blank_body" ] || fail 'old blank generation not cleaned after valid refresh'
# Fandom wiki pages use the verified parse API, but cache the caller's wiki URL.
fandom_url='https://pokemongo.fandom.com/wiki/October_2026_Community_Day%3A_Zorua%27s_Return?from=search'
fandom_key="$(detail_key "$fandom_url")"
before_fandom=$(count)
env FANDOM_MODE=valid scripts/fetch.sh url "$fandom_url" > "$T/result"
grep -Fq '<table>' "$T/result" || fail 'Fandom parse body lost table'
grep -Fq 'href="/wiki/Zorua"' "$T/result" || fail 'Fandom parse body lost link'
eq "$(count)" "$((before_fandom + 1))"
grep -Fxq "October 2026 Community Day: Zorua's Return" "$T/fandom-pages" || fail 'Fandom title was not decoded for API encoding'
fandom_meta="data/raw/details/$fandom_key.json"
jq -e --arg u "$fandom_url" '.url == $u and (.url | contains("api.php") | not)' "$fandom_meta" > /dev/null
before_fandom_hit=$(count)
scripts/fetch.sh url --max-age 86400 "$fandom_url" > "$T/result"
eq "$(count)" "$before_fandom_hit"
for fandom_mode in api-error empty whitespace challenge; do
  fandom_bad_url="https://pokemongo.fandom.com/wiki/Fandom_${fandom_mode}"
  before_fandom_bad=$(count)
  reject env FANDOM_MODE="$fandom_mode" scripts/fetch.sh url "$fandom_bad_url"
  [ ! -s "$T/rejected.out" ] || fail "Fandom $fandom_mode leaked to stdout"
  eq "$(count)" "$((before_fandom_bad + 1))"
  no_detail_cache "$fandom_bad_url"
done
printf 'detail version one\n' > "$T/body"
before_refresh=$(count)
scripts/fetch.sh url --force "$u" > /dev/null
eq "$(count)" "$((before_refresh + 1))"
scripts/fetch.sh url "$u" > /dev/null
eq "$(count)" "$((before_refresh + 2))" # legacy call always fresh
scripts/fetch.sh url --max-age 86400 'https://leekduck.com/events/fixture/?a=2' > /dev/null
eq "$(count)" "$((before_refresh + 3))" # distinct query key
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
