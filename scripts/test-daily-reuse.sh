#!/usr/bin/env bash
# Offline integration: real fetch/discover/candidate code, fixed sources + mock curl.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/.pi-tmp"
T=$(mktemp -d "$ROOT/.pi-tmp/daily-reuse.XXXXXX")
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/scripts" "$T/bin" "$T/data/raw" "$T/public/data"
cp "$ROOT/scripts/fetch.sh" "$ROOT/scripts/discover.sh" "$ROOT/scripts/discovery-report.js" "$ROOT/scripts/daily-candidates.js" "$ROOT/scripts/daily-run-record.js" "$T/scripts/"
cp "$ROOT/public/app.js" "$T/public/app.js" # shared browser/Node event timing contract
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
[ ! -e "$FIXTURE/fail-once" ] || { rm "$FIXTURE/fail-once"; exit 22; }
if [ "$head" = 1 ]; then printf 'HTTP/2 200\r\ncontent-type: image/png\r\ncontent-length: 123\r\n'; exit; fi
[ -n "$out" ] || exit 98
case "$url" in
  */ScrapedDuck/data/events.json) cp "$FIXTURE/feed" "$out" ;;
  https://r.jina.ai/https://pokemongohub.net/post/event/) cp "$FIXTURE/hub-index" "$out" ;;
  https://r.jina.ai/https://pokemongo.com/news) cp "$FIXTURE/official-index" "$out" ;;
  https://r.jina.ai/https://pokemongohub.net/?s=*) cp "$FIXTURE/hub-search" "$out" ;;
  https://r.jina.ai/https://leekduck.com/events/*|https://r.jina.ai/https://pokemongohub.net/post/monthly/)
    cp "$FIXTURE/body" "$out" ;;
  https://pokemongo.fandom.com/api.php?*) cp "$FIXTURE/fandom-search.json" "$out" ;;
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
if [ "${FAIL_NAMED_REPLACE:-0}" = 1 ] && [[ "${@: -1}" == */data/raw/events.json ]]; then exit 74; fi
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
# The output sink remains mockable so a failed report write cannot masquerade as an empty scan.
export REAL_TEE="$(command -v tee)"
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
cat > "$T/hub-index" <<'TXT'
[Fixture Hub](/post/event/fixture/)
TXT
cat > "$T/official-index" <<'TXT'
[Fixture Official](/news/fixture/)
TXT
cat > "$T/hub-search" <<'TXT'
[Hub search result](https://pokemongohub.net/post/event/fixture-search/)
TXT
cat > "$T/fandom-search.json" <<'JSON'
{"query":{"search":[{"title":"Fixture Festival Wiki"}]}}
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

# Prepared daily discovery is strictly offline, emits the additive JSON contract,
# and keeps TSV compatibility. Standalone mode refreshes each primary once.
scripts/fetch.sh events events-hub events-official > /dev/null
eq "$(count)" 3
scripts/discover.sh new --cached --json > "$T/new.json" 2> "$T/scan.err"
eq "$(count)" 3
jq -e '.status == "complete" and .sources.leekduck.status == "complete" and .sources.hub.status == "complete" and .sources.official.status == "complete" and ([.candidates[].kind] | index("new")) and ([.candidates[] | select(.url == "https://pokemongohub.net/post/event/fixture/")] | length == 1) and ([.candidates[] | select(.url == "https://pokemongo.com/news/fixture/")] | length == 1)' "$T/new.json" > /dev/null
scripts/discover.sh new --cached > "$T/scan" 2> "$T/scan.err"
grep -q '^NEW' "$T/scan" || fail 'missing discovered event'
eq "$(count)" 3
scripts/discover.sh new > /dev/null 2> "$T/scan.err"
eq "$(count)" 6
cp data/raw/events.json "$T/good-feed"
cp data/raw/events-hub.txt "$T/hub-good"
cp data/raw/events-official.txt "$T/official-good"

# A date-TBD entry and an identity-less row make the scan partial, but the valid
# sibling remains a normal candidate: no made-up date and no all-or-nothing drop.
cat > data/raw/events.json <<'JSON'
[
  {"eventID":"fixture","name":"Fixture Festival","start":"2026-09-11T10:00:00","end":"2026-09-11T18:00:00","link":"https://leekduck.com/events/fixture/"},
  {"eventID":"tbd-dates","name":"Dates To Be Announced","start":null,"end":null,"link":"https://leekduck.com/events/tbd-dates/"},
  {"name":"No Stable Identity","start":"2026-09-12","end":"2026-09-12","link":"https://leekduck.com/events/no-id/"}
]
JSON
touch -d '2026-09-10T12:00:00Z' data/raw/events.json
reject scripts/discover.sh new --cached --json
jq -e '.status == "partial" and ([.candidates[] | select(.kind == "new" and .id == "fixture")] | length == 1) and (.pendingDate | length == 1) and .pendingDate[0].id == "tbd-dates" and (.exceptions | length == 1) and (.exceptions[0].reason | contains("eventID"))' "$T/rejected.out" > /dev/null
grep -q 'PARTIAL' "$T/rejected.err" || fail 'TBD scan was not partial'
cp "$T/good-feed" data/raw/events.json; touch -d '2026-09-10T12:00:00Z' data/raw/events.json

# Top-level damage/missing/stale sources are explicit source failures, while
# independent Hub/official leads still survive in the machine-readable output.
for broken in missing invalid shape stale; do
  case "$broken" in
    missing) rm data/raw/events.json ;;
    invalid) echo 'not json' > data/raw/events.json ;;
    shape) echo '{}' > data/raw/events.json ;;
    stale) touch -d '2026-09-09T12:00:00Z' data/raw/events.json ;;
  esac
  reject scripts/discover.sh new --cached --json
  jq -e '.status == "partial" and .sources.leekduck.status == "failed" and ([.candidates[] | select(.kind == "hub-lead" or .kind == "official-lead")] | length >= 1)' "$T/rejected.out" > /dev/null || fail "broken $broken hid usable independent leads"
  grep -q 'PARTIAL' "$T/rejected.err" || fail "broken $broken was not labeled partial"
  ! grep -q 'no new candidates' "$T/rejected.err" || fail "broken $broken falsely reported quiet day"
  cp "$T/good-feed" data/raw/events.json; touch -d '2026-09-10T12:00:00Z' data/raw/events.json
done

# A readable homepage/root link is not official-news coverage. It remains an
# explicit gap rather than becoming an empty complete scan.
printf '[Home](https://pokemongo.com/)\n' > data/raw/events-official.txt
touch -d '2026-09-10T12:00:00Z' data/raw/events-official.txt
reject scripts/discover.sh new --cached --json
jq -e '.status == "partial" and .sources.official.status == "failed" and (.sources.official.reason | contains("news"))' "$T/rejected.out" > /dev/null
after_home=$(count)
eq "$after_home" 6 # --cached made no requests
cp "$T/official-good" data/raw/events-official.txt

# A challenge body and a broken calendar cannot erase leads from healthy sources.
printf 'Just a moment...\n' > data/raw/events-hub.txt
touch -d '2026-09-10T12:00:00Z' data/raw/events-hub.txt
reject scripts/discover.sh new --cached --json
jq -e '.status == "partial" and .sources.hub.status == "failed" and ([.candidates[] | select(.kind == "new" or .kind == "official-lead")] | length >= 1)' "$T/rejected.out" > /dev/null
cp "$T/hub-good" data/raw/events-hub.txt
cp public/data/events.json "$T/cal"
echo '{}' > public/data/events.json
reject scripts/discover.sh new --cached --json
jq -e '.status == "partial" and .sources.calendar.status == "failed" and ([.candidates[]] | length >= 1)' "$T/rejected.out" > /dev/null
mv "$T/cal" public/data/events.json

# A failed default refresh is partial even if it can retain fresh last-good
# bodies; failure never turns into a complete/no-new result.
touch "$T/fail"
reject scripts/discover.sh new --json
jq -e '.status == "partial" and ([.sources[] | select(.status == "partial")] | length >= 1)' "$T/rejected.out" > /dev/null
grep -q 'PARTIAL' "$T/rejected.err" || fail 'refresh failure not partial'
rm "$T/fail"

# When every source is unavailable, the JSON result says failed (and not no
# candidates); --cached stays zero-network even for this error path.
rm -f data/raw/events.json data/raw/events-hub.txt data/raw/events-official.txt
before=$(count)
reject scripts/discover.sh new --cached --json
eq "$(count)" "$before"
jq -e '.status == "failed" and (.completeNoNew == false)' "$T/rejected.out" > /dev/null
grep -q 'FAILED' "$T/rejected.err" || fail 'all-source failure not labeled failed'
! grep -q 'no new candidates' "$T/rejected.err" || fail 'all-source failure called quiet'
scripts/fetch.sh events events-hub events-official > /dev/null
cp data/raw/events.json "$T/good-feed"; cp data/raw/events-hub.txt "$T/hub-good"; cp data/raw/events-official.txt "$T/official-good"

# Exact retained URLs are the only automatic coverage proof. A same-named later
# official period remains an independent lead instead of being suppressed by
# calendar prose/token overlap.
printf '[]\n' > data/raw/events.json
touch -d '2026-09-10T12:00:00Z' data/raw/events.json
printf '[Fixture Hub](https://pokemongohub.net/post/event/fixture/)\n' > data/raw/events-hub.txt
printf '[Fixture Festival](https://pokemongo.com/news/fixture-festival-2027/)\n' > data/raw/events-official.txt
touch -d '2026-09-10T12:00:00Z' data/raw/events-hub.txt data/raw/events-official.txt
cat > public/data/events.json <<'JSON'
[
  {"id":"old-fixture","name":"Fixture Festival","link":"https://pokemongo.com/news/fixture-festival-2026/"},
  {"id":"known-hub","link":"https://pokemongohub.net/post/event/fixture/"}
]
JSON
scripts/discover.sh new --cached --json > "$T/same-name.json" 2> "$T/scan.err"
jq -e '.status == "complete" and ([.candidates[] | select(.kind == "official-lead" and (.url | contains("2027")))] | length == 1)' "$T/same-name.json" > /dev/null || fail 'same-name later official period was suppressed'

# Complete-empty is reserved for complete coverage with all source URLs already
# retained; this is distinct from malformed/missing source inputs above.
cat > public/data/events.json <<'JSON'
[
  {"id":"known-hub","link":"https://pokemongohub.net/post/event/fixture/"},
  {"id":"known-official","link":"https://pokemongo.com/news/fixture-festival-2027/"}
]
JSON
scripts/discover.sh new --cached > "$T/scan" 2> "$T/scan.err"
[ ! -s "$T/scan" ] || fail 'complete empty scan emitted leads'
grep -q 'COMPLETE.*no new candidates' "$T/scan.err" || fail 'complete empty scan was not explicit'

# A report-output failure is a hard failure, never an empty result.
cp "$T/good-feed" data/raw/events.json; cp "$T/hub-good" data/raw/events-hub.txt; cp "$T/official-good" data/raw/events-official.txt
printf '[]\n' > public/data/events.json
touch -d '2026-09-10T12:00:00Z' data/raw/events.json data/raw/events-hub.txt data/raw/events-official.txt
reject env DISCOVERY_FAULT=output scripts/discover.sh new --cached
grep -q 'cannot save TSV report' "$T/rejected.err" || fail 'output write failure not preserved'
[ ! -s "$T/rejected.out" ] || fail 'failed TSV write emitted partial output'

# Keyword search keeps per-source status, caches the shared official index across
# different queries, and reuses an exact same-query report inside a run ID.
rm -rf data/raw/details data/raw/discovery/search-cache data/raw/discovery/run-cache
: > "$T/requests"
scripts/discover.sh --json 'fixture festival' > "$T/search-one.json" 2> "$T/search-one.err"
jq -e '.status == "complete" and (.sources.official.resultCount >= 0) and ([.candidates[].source] | index("fandom"))' "$T/search-one.json" > /dev/null
scripts/discover.sh --json 'fixture another' > "$T/search-two.json" 2> "$T/search-two.err"
eq "$(grep -Fc 'https://r.jina.ai/https://pokemongo.com/news' "$T/requests")" 1
before=$(count)
DISCOVER_RUN_ID=shared-search scripts/discover.sh --json 'shared fixture' > "$T/shared-one.json" 2> "$T/shared-one.err"
after_first=$(count)
DISCOVER_RUN_ID=shared-search scripts/discover.sh --json 'shared fixture' > "$T/shared-two.json" 2> "$T/shared-two.err"
eq "$(count)" "$after_first"
[ "$after_first" -ge "$before" ] || fail 'shared search request counter regressed'

# A readable official shell is not complete keyword coverage, even when every
# transport succeeds. A real index with no matching title is complete-empty.
node <<'JS'
const assert = require('node:assert/strict'), fs = require('node:fs');
const { buildSearchReport } = require('./scripts/discovery-report.js');
const paths = { leekduck:'empty-feed.json', hub:'empty-search.txt', official:'official-shell.txt', fandom:'empty-fandom.json' };
fs.writeFileSync(paths.leekduck, '[]'); fs.writeFileSync(paths.hub, 'No results found.');
fs.writeFileSync(paths.official, '[Home](https://pokemongo.com/)');
fs.writeFileSync(paths.fandom, '{"query":{"search":[]}}');
const input = { query:'unmatched fixture', sources:Object.fromEntries(Object.entries(paths).map(([name,path])=>[name,{available:true,path}])) };
const shell = buildSearchReport(input);
assert.equal(shell.status, 'partial'); assert.equal(shell.sources.official.status, 'partial');
assert.equal(shell.completeNoCandidates, false); assert.match(shell.sources.official.reason, /news/);
fs.writeFileSync(paths.official, '[Other news](https://pokemongo.com/news/unrelated/)');
const index = buildSearchReport(input);
assert.equal(index.status, 'complete'); assert.equal(index.completeNoCandidates, true);
JS

# All keyword sources failing is a failed report, not a successful "no candidates".
rm -f data/raw/events.json
rm -rf data/raw/details data/raw/discovery/search-cache
touch "$T/fail"
before=$(count)
reject env DISCOVER_RUN_ID=all-search-fails scripts/discover.sh --json 'all sources fail'
jq -e '.status == "failed" and (.completeNoCandidates == false)' "$T/rejected.out" > /dev/null
grep -q 'FAILED' "$T/rejected.err" || fail 'all-search failure not labeled failed'
! grep -q 'no new candidates' "$T/rejected.err" || fail 'all-search failure called no-candidate'
after_first=$(count)
reject env DISCOVER_RUN_ID=all-search-fails scripts/discover.sh --json 'all sources fail'
eq "$(count)" "$after_first" # same-run failed report is reused, not retried six times
rm "$T/fail"
scripts/fetch.sh events events-hub events-official > /dev/null
printf '[]\n' > public/data/events.json

# Named-source replacement validates before atomic cache publication: JSON error
# objects/challenge pages and a failed rename preserve the previous good body.
cp data/raw/events.json "$T/named-events-good"
printf '{"error":"upstream unavailable"}\n' > "$T/feed"
reject scripts/fetch.sh events
cmp "$T/named-events-good" data/raw/events.json
[ ! -s "$T/rejected.out" ] || fail 'named JSON failure printed stale content'
cp "$T/named-events-good" "$T/feed"
cp data/raw/events-hub.txt "$T/named-hub-good"
printf '<title>Just a moment...</title>\n' > "$T/hub-index"
reject scripts/fetch.sh events-hub
cmp "$T/named-hub-good" data/raw/events-hub.txt
cat > "$T/hub-index" <<'TXT'
[Normal article](https://pokemongohub.net/post/event/normal/)
This ordinary article quotes 403 Forbidden and Cloudflare while explaining a login error.
TXT
scripts/fetch.sh events-hub > /dev/null
printf '{"error":"news unavailable"}\n' > "$T/official-index"
cp data/raw/events-official.txt "$T/named-official-good"
reject scripts/fetch.sh events-official
cmp "$T/named-official-good" data/raw/events-official.txt
cp "$T/named-events-good" "$T/feed"
reject env FAIL_NAMED_REPLACE=1 scripts/fetch.sh events
cmp "$T/named-events-good" data/raw/events.json
scripts/fetch.sh events > /dev/null
cp "$T/hub-good" "$T/hub-index"
cp "$T/official-good" "$T/official-index"
scripts/fetch.sh events-hub events-official > /dev/null

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
scripts/fetch.sh url --max-age 86400 --meta "$u" > "$T/meta"
jq -e --arg p "$body_path" '.path == $p and .ageSeconds == 0' "$T/meta" > /dev/null
! grep -q 'detail version' "$T/meta" || fail 'meta mode dumped body'
eq "$(count)" "$((before + 1))"
# A run ID makes a force request happen once and exposes optional metrics without
# changing normal body-output compatibility.
before=$(count)
FETCH_RUN_ID=force-once FETCH_METRICS_FILE="$T/metrics.jsonl" scripts/fetch.sh url --force --meta "$u" > "$T/force-meta"
eq "$(count)" "$((before + 1))"
FETCH_RUN_ID=force-once FETCH_METRICS_FILE="$T/metrics.jsonl" scripts/fetch.sh url --force --meta "$u" > "$T/force-meta-again"
eq "$(count)" "$((before + 1))"
jq -e '.path | type == "string"' "$T/force-meta-again" > /dev/null
[ "$(wc -l < "$T/metrics.jsonl")" -ge 2 ] || fail 'run metrics hook did not record fetch outcomes'
jq -s 'any(.[]; .network == true) and any(.[]; .reused == true)' "$T/metrics.jsonl" > /dev/null || fail 'run metrics did not expose network/reuse audit fields'
# A same-run failure is also reused as a failure; the next run remains free to retry.
run_fail_url='https://leekduck.com/events/run-failure/'
touch "$T/fail"
before=$(count)
reject env FETCH_RUN_ID=failed-round scripts/fetch.sh url --force "$run_fail_url"
eq "$(count)" "$((before + 1))"
reject env FETCH_RUN_ID=failed-round scripts/fetch.sh url --force "$run_fail_url"
eq "$(count)" "$((before + 1))"
rm "$T/fail"
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
  'Title: Not Found
Warning: Target URL returned error 404: Not Found
Markdown Content:
The requested page does not exist.'
  'Warning: Target URL returned error 410: Gone'
  'Warning: Target URL returned error 400: Bad Request'
  '{"status":"error","message":"solver unavailable"}'
  '{"error":{"code":403},"message":"upstream denied"}'
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
# Feed real retry metrics to the production summary, not a richer mock schema.
retry_dir="$T/logs/runs/retry"
mkdir -p "$retry_dir"
: > "$retry_dir/discover.jsonl"
touch "$T/fail-once"
before_retry=$(count)
FETCH_RETRY_LIMIT=1 FETCH_METRICS_FILE="$retry_dir/fetch.jsonl" scripts/fetch.sh url --force "$u" > "$T/result"
eq "$(count)" "$((before_retry + 2))"
jq -es --arg u "$u" 'all(.[]; .url == $u) and any(.[]; .kind == "retry")' "$retry_dir/fetch.jsonl" > /dev/null || fail 'retry metrics did not identify the requested URL'
node scripts/daily-run-record.js "$retry_dir" failed 1 "$(date -u +%s%3N)"
jq -e '.network.requests == 2 and .network.retries == 1 and .network.cacheHits == 0' "$retry_dir/summary.json" > /dev/null || fail 'real fetch retries were lost in run metrics'
node "$ROOT/scripts/test-daily-candidates.js" "$T"
echo 'test-daily-reuse: PASS'
