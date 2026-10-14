#!/usr/bin/env bash
# Offline production transport/metric regressions; never contacts a solver or website.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/.pi-tmp"
T=$(mktemp -d "$ROOT/.pi-tmp/fetch-retries.XXXXXX")
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/scripts" "$T/bin" "$T/data/raw"
cp "$ROOT/scripts/fetch.sh" "$ROOT/scripts/daily-run-record.js" "$T/scripts/"
export FIXTURE="$T" PATH="$T/bin:$PATH" FETCH_RETRY_DELAY=0
cat > "$T/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
out=''; url=''; payload=''; head=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -d) payload="$2"; shift 2 ;;
    -A|-H|--max-time|-X) shift 2 ;;
    -*I*) head=1; shift ;;
    http://*|https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
if [ -n "$payload" ]; then
  [ "$url" = 'http://mock-solver.invalid/v1' ] || exit 98
  url=$(jq -r .url <<< "$payload")
fi
printf '%s\n' "$url" >> "$FIXTURE/requests"
fail=0
case "$MOCK_MODE" in
  fail) fail=1 ;;
  once) if [ ! -e "$FIXTURE/tried" ]; then touch "$FIXTURE/tried"; fail=1; fi ;;
  success|parse-fail|empty) ;;
  *) exit 99 ;;
esac
# A transport failure may still output parseable content: it must not be swallowed.
if [ "$head" = 1 ]; then body=$'HTTP/2 200\r\ncontent-type: image/png\r\n'
else
  case "$MOCK_MODE" in
    parse-fail) body='not JSON' ;;
    empty) body='{"solution":{"response":""}}' ;;
    *) body='{"solution":{"response":"Verified fixture article"}}' ;;
  esac
fi
if [ -n "$out" ]; then printf '%s\n' "$body" > "$out"; else printf '%s\n' "$body"; fi
[ "$fail" = 0 ] || exit 22
SH
chmod +x "$T/bin/curl"
cd "$T"
fail() { echo "test-fetch-retries: FAIL: $*" >&2; exit 1; }
for method in image flaresolverr; do
  if [ "$method" = image ]; then
    urls=('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/1.png' 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/2.png')
    export TIER_METHOD=jina
  else
    urls=('https://pokemongohub.net/post/event/retry-one/' 'https://pokemongohub.net/post/event/retry-two/')
    export TIER_METHOD=flaresolverr FLARESOLVERR_URL=http://mock-solver.invalid/v1
  fi
  for scenario in exhausted zero recovered; do
    rm -rf data/raw/details; rm -f "$T/tried"; : > "$T/requests"
    run="$T/logs/runs/$method-$scenario"; mkdir -p "$run"
    : > "$run/discover.jsonl"
    export FETCH_METRICS_FILE="$run/fetch.jsonl" FETCH_RETRY_LIMIT=1 FETCH_RETRY_BUDGET=1
    export MOCK_MODE=fail
    expected=3; retries=1; success=0
    case "$scenario" in
      zero) export FETCH_RETRY_BUDGET=0; expected=2; retries=0 ;;
      recovered) export MOCK_MODE=once; success=1 ;;
    esac
    rc=0
    scripts/fetch.sh url "${urls[@]}" > "$T/out" 2> "$T/err" || rc=$?
    if [ "$success" = 1 ]; then [ "$rc" = 0 ] || fail "$method retry recovery failed"
    else [ "$rc" != 0 ] || fail "$method masked transport failure"; fi
    actual=$(wc -l < "$T/requests")
    [ "$actual" = "$expected" ] || fail "$method/$scenario calls=$actual expected=$expected"
    jq -es --arg u1 "${urls[0]}" --arg u2 "${urls[1]}" --argjson n "$retries" \
      'all(.[]; .url == $u1 or .url == $u2) and ([.[] | select(.kind == "retry")] | length == $n)' "$run/fetch.jsonl" > /dev/null
    # Exhaustion does not consume the next URL's mandatory first attempt.
    [ "$(grep -Fc "${urls[1]}" "$T/requests")" = 1 ] || fail 'next URL lost first attempt or received fresh budget'
    node scripts/daily-run-record.js "$run" failed "$rc" "$(date -u +%s%3N)"
    jq -e --argjson requests "$expected" --argjson retries "$retries" \
      '.network.requests == $requests and .network.retries == $retries and .network.cacheHits == 0' "$run/summary.json" > /dev/null
    if [ "$method" = flaresolverr ]; then
      if [ "$success" = 0 ]; then [ -z "$(find data/raw/details -type f -name '*.json' -print)" ] || fail 'failed transport published cache'
      else
        before=$(wc -l < "$T/requests")
        scripts/fetch.sh url --max-age 86400 "${urls[@]}" > /dev/null
        [ "$(wc -l < "$T/requests")" = "$before" ] || fail 'cache reuse used network'
        node scripts/daily-run-record.js "$run" failed 0 "$(date -u +%s%3N)"
        jq -e '.network.requests == 3 and .network.retries == 1 and .network.cacheHits == 2' "$run/summary.json" > /dev/null
      fi
    fi
    [ -z "$(find data/raw -type f -name '.*' -print)" ] || fail 'transport temporary files leaked'
  done
done
# Parsing/empty solver output cannot replace last-good, even with successful transport.
export MOCK_MODE=success FETCH_RETRY_BUDGET=0
scripts/fetch.sh url "${urls[0]}" > /dev/null
cp -a data/raw/details "$T/good-details"
for mode in parse-fail empty fail; do
  export MOCK_MODE="$mode"
  if scripts/fetch.sh url --force "${urls[0]}" > "$T/out" 2> "$T/err"; then fail "solver $mode falsely succeeded"; fi
  [ ! -s "$T/out" ] || fail 'failed solver printed success body'
  diff -r "$T/good-details" data/raw/details > /dev/null
  [ -z "$(find data/raw -type f -name '.*' -print)" ] || fail 'solver failure leaked files'
done
echo 'test-fetch-retries: PASS (image/solver shared budget, zero/recovery/exhaustion, real metrics→summary, cache/last-good/cleanup)'
