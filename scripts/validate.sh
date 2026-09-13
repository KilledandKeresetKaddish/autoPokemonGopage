#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# validate.sh — the safety gate. Run after the agent edits content. Confirms
# the agent stayed inside its sandbox and didn't break the page. Exit 0 = OK
# to publish; non-zero = roll back. See AGENTS.md for the rules enforced here.
# ---------------------------------------------------------------------------
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
fail=0
say() { echo "validate: $*"; }

# 1) Protected files must be byte-identical to the committed reference.
if [ -f scripts/protected.sha256 ]; then
  if ! sha256sum -c scripts/protected.sha256 >/dev/null 2>&1; then
    say "FAIL protected file(s) changed:"
    sha256sum -c scripts/protected.sha256 2>&1 | grep -v ': OK$' || true
    fail=1
  fi
else
  say "FAIL scripts/protected.sha256 missing — protected-file integrity cannot be verified"
  fail=1
fi

H=public/index.html
# 2) Required structural tokens must still be present.
req=(
  'id="view-calendar"' 'id="view-rankings"' 'id="view-mega"' 'id="view-clock"' 'id="view-spots"' 'id="view-links"'
  'id="calendar"' 'id="main-tabs"' 'id="rank-subtabs"'
  'id="spots-summary"' 'id="spots-controls"' 'id="spots-results"'
  'id="event-detail"' 'id="last-updated"' 'id="lang-toggle"'
  'id="long-term"' 'id="pvp-band"' 'id="rotations"'
  'data-ai-region="calendar-notes"' 'data-ai-region="rankings-current"'
  'data-ai-region="rankings-attackers"' 'data-ai-region="rankings-defenders"' 'data-ai-region="rankings-raid"'
  'data-rank-panel="current"' 'data-rank-panel="attackers"'
  'data-rank-panel="defenders"' 'data-rank-panel="raid"'
)
for t in "${req[@]}"; do
  grep -qF "$t" "$H" || { say "FAIL missing required token: $t"; fail=1; }
done

# 2b) app.js must be loaded as itself or a cache-busted URL (app.js?…), never a
#     renamed/broken source like app.js.bak that would ship a blank dashboard.
grep -qE 'src="app\.js(\?[^"]*)?"' "$H" || { say "FAIL app.js <script> src must be app.js or app.js?<cache-bust>"; fail=1; }

# 2c) During an actual daily run, index.html may differ from HEAD only inside
#     the five marker bodies. Standalone maintainer validation skips this check
#     so deliberate shell/structure work can be validated before its commit.
if [ "${POGO_DAILY_RUN:-0}" = 1 ]; then
  if ! python3 - <<'PY'
import re, subprocess, sys
regions = ['calendar-notes','rankings-current','rankings-attackers','rankings-defenders','rankings-raid']
current = open('public/index.html', encoding='utf-8').read()
try: baseline = subprocess.check_output(['git','show','HEAD:public/index.html'], text=True)
except Exception as e:
    print('validate: FAIL cannot read HEAD:public/index.html for protected-shell comparison:', e)
    sys.exit(1)
def strip_bodies(text):
    for name in regions:
        pattern = r'(<!-- AI:START '+re.escape(name)+r' -->).*?(<!-- AI:END '+re.escape(name)+r' -->)'
        text, count = re.subn(pattern, r'\1\n__DAILY_REGION_BODY__\n\2', text, flags=re.S)
        if count != 1:
            print(f'validate: FAIL cannot normalize marker region {name} (count={count})')
            sys.exit(1)
    return text
if strip_bodies(current) != strip_bodies(baseline):
    print('validate: FAIL public/index.html changed outside the five AI marker bodies')
    sys.exit(1)
PY
  then
    fail=1
  fi
fi

# 3) AI editable-region markers must exist and be balanced. Count occurrences,
#    not lines (grep -c would under-count two markers sharing a line).
for region in calendar-notes rankings-current rankings-attackers rankings-defenders rankings-raid; do
  grep -qF "AI:START $region" "$H" || { say "FAIL missing marker: AI:START $region"; fail=1; }
  grep -qF "AI:END $region"   "$H" || { say "FAIL missing marker: AI:END $region"; fail=1; }
done
starts=$(grep -o 'AI:START' "$H" | wc -l); ends=$(grep -o 'AI:END' "$H" | wc -l)
[ "$starts" = "$ends" ] || { say "FAIL marker imbalance (START=$starts END=$ends)"; fail=1; }

# Extract one AI region's body. Markers are first split onto their own lines so
# content sharing a physical line with a marker is still captured — a line-wise
# awk would both false-FAIL a one-line region as "empty" AND let dangerous HTML
# on a marker line escape the 5b safety scan.
ai_region() {
  sed -e 's/<!-- AI:/\n<!-- AI:/g' -e 's/-->/-->\n/g' "$H" \
    | awk -v r="$1" '
        index($0, "AI:START " r " ") { f=1; next }
        index($0, "AI:END " r " ")   { f=0 }
        f { print }'
}

# 3b) Each AI region must be non-empty — hard-enforces the "never ship empty
#     rankings" rule that was previously only a soft prompt instruction.
for region in calendar-notes rankings-current rankings-attackers rankings-defenders rankings-raid; do
  body=$(ai_region "$region")
  [ -n "$(printf '%s' "$body" | tr -d '[:space:]')" ] || { say "FAIL AI region empty: $region"; fail=1; }
  wrappers=$(printf '%s' "$body" | grep -o "data-ai-region=\"$region\"" | wc -l)
  [ "$wrappers" = 1 ] || { say "FAIL AI region $region must contain exactly one matching data-ai-region wrapper"; fail=1; }
done

# 4) Data files the agent writes must be valid JSON.
for j in public/data/events.json public/data/meta.json public/data/rotations.json public/data/categories.json public/data/mega.json public/data/featured.json public/data/locations.json public/data/i18n/ui.json public/data/i18n/en.json data/state.json; do
  if [ -f "$j" ]; then
    jq empty "$j" >/dev/null 2>&1 || { say "FAIL invalid JSON: $j"; fail=1; }
  else
    say "FAIL missing JSON file: $j"; fail=1
  fi
done

# 4b) events.json data hygiene — guards against unbounded growth and against
#     duplicate / repeatedly-added events. Keep it bounded, ids unique, and
#     prune events that ended well in the past (>90 days ~= 3 months).
E=public/data/events.json
if [ -f "$E" ] && jq empty "$E" >/dev/null 2>&1; then
  n=$(jq 'length' "$E")
  [ "$n" -le 250 ] || { say "FAIL events.json too large ($n entries > 250)"; fail=1; }
  dups=$(jq '[.[].id] | group_by(.) | map(select(length > 1)) | length' "$E")
  [ "$dups" = 0 ] || { say "FAIL events.json has $dups duplicate id(s)"; fail=1; }
  # semantic floors — catch a gutted/partial rewrite that is still structurally
  # valid. Non-emptiness only: cannot be satisfied by fabricating content.
  [ "$n" -ge 5 ] || { say "FAIL events.json too small ($n entries < 5 — gutted/partial run?)"; fail=1; }
  badf=$(jq '[.[] | select(((.id // "")=="") or ((.name // "")=="") or ((.start // "")=="") or ((.type // "")=="") or ((.end != null) and (.end < .start)))] | length' "$E")
  [ "$badf" = 0 ] || { say "FAIL events.json has $badf event(s) with empty id/name/start/type or end<start"; fail=1; }
  cut=$(date -u -d '90 days ago' +%F 2>/dev/null || date -u -v-90d +%F 2>/dev/null || true)
  if [ -n "$cut" ]; then
    stale=$(jq --arg c "$cut" '[.[] | select(((.end // .start) | tostring | .[0:10]) < $c)] | length' "$E")
    [ "$stale" = 0 ] || { say "FAIL events.json has $stale stale event(s) ended >90d ago (prune old events)"; fail=1; }
  else
    say "WARN could not compute stale-event cutoff (no GNU/BSD date) — skipping age check"
  fi
fi

# 4c) rotations.json must carry a tracks array.
R=public/data/rotations.json
if [ -f "$R" ] && jq empty "$R" >/dev/null 2>&1; then
  jq -e '.tracks | type == "array"' "$R" >/dev/null 2>&1 || { say "FAIL rotations.json missing tracks[]"; fail=1; }
  bad_seg=$(jq '[.tracks[]?.segments[]? | select(((.start // "")=="") or ((.pokemon | type) != "array") or ((.pokemon | length) == 0))] | length' "$R" 2>/dev/null || echo 0)
  [ "${bad_seg:-0}" = 0 ] || { say "FAIL rotations.json has $bad_seg segment(s) with empty start or non-array/empty pokemon[]"; fail=1; }
fi

# 4d) categories.json: the agent may register NEW event types, but only with a
#     palette key from the theme (no arbitrary colours) and a valid render kind.
C=public/data/categories.json
if [ -f "$C" ] && jq empty "$C" >/dev/null 2>&1; then
  bad=$(jq '
    ["purple","green","greenlt","rust","orange","red","teal","teallt","blue","indigo","mauve","gold","brown"] as $pal
    | [ to_entries[] | .value as $v | select( ($pal | index($v.palette) | not) or (($v.kind // "bar") | (. != "bar" and . != "chip")) ) ]
    | length' "$C")
  [ "${bad:-0}" = 0 ] || { say "FAIL categories.json: $bad entry(ies) off-palette or bad kind (palettes: purple green greenlt rust orange red teal teallt blue indigo mauve gold brown; kind: bar|chip)"; fail=1; }
fi

# 4e) mega.json — source-backed additions and targeted completions/corrections.
#     Identity and supported values stay constrained; mechanics tables live in the
#     protected app.js. Enforce the row shape so a bad entry fails the gate rather
#     than rendering broken (initialCost must be a known tier or null for TBD).
M=public/data/mega.json
if [ -f "$M" ] && jq empty "$M" >/dev/null 2>&1; then
  jq -e 'type == "array" and length >= 1' "$M" >/dev/null 2>&1 || { say "FAIL mega.json must be a non-empty array"; fail=1; }
  bad=$(jq '
    ["normal","bug","dark","dragon","electric","fairy","fighting","fire","flying","ghost","grass","ground","ice","poison","psychic","rock","steel","water"] as $ty
    | [100,200,300,400,7500] as $cost
    | [ .[] | select(
        ((.id // 0) | (type != "number" or . <= 0))
        or ((.name // "") == "")
        or ((.en // "") == "")
        or ((.initialCost != null) and ((.initialCost as $ic | $cost | index($ic)) | not))
        or ((.boostedTypes | type) != "array")
        or ((.boostedTypes | length) == 0)
        or ([ .boostedTypes[]? as $t | select(($ty | index($t)) | not) ] | length > 0)
        or ((.sprite // "") | (type != "string" or (startswith("https://") | not)))
        or ((.hub // "") | (type != "string" or . == ""))
        or ((.superMax != null) and ((.superMax | type) != "boolean"))
      ) ] | length' "$M")
  [ "${bad:-0}" = 0 ] || { say "FAIL mega.json: $bad row(s) with bad id/name/en, initialCost not in {100,200,300,400,7500}/null, invalid/empty boostedTypes (18 type keys), missing form sprite (https URL) / hub slug — base dex art and base hub pages are never right for a Mega/Primal row — or non-boolean superMax"; fail=1; }
  dupe=$(jq '[.[].en] | group_by(.) | map(select(length > 1)) | length' "$M")
  [ "${dupe:-0}" = 0 ] || { say "FAIL mega.json has $dupe duplicate en name(s) — each Mega/Primal form needs a unique en"; fail=1; }
fi

# 4f) featured.json — admin-curated featured event ids. Shape: array of strings;
#     every id must still exist in events.json (the agent is required to prune
#     ids of removed events, AGENTS.md "Retention"/self-check).
F=public/data/featured.json
if [ -f "$F" ] && jq empty "$F" >/dev/null 2>&1; then
  if ! jq -e 'type == "array" and all(.[]; type == "string")' "$F" >/dev/null 2>&1; then
    say "FAIL featured.json must be an array of event-id strings"; fail=1
  elif [ -f "$E" ] && jq empty "$E" >/dev/null 2>&1; then
    orph=$(jq --slurpfile ev "$E" '($ev[0] | map(.id)) as $ids | [.[] as $id | select(($ids | index($id)) | not)] | length' "$F" 2>/dev/null || echo 0)
    [ "${orph:-0}" = 0 ] || { say "FAIL featured.json has $orph id(s) not present in events.json (prune stale featured ids)"; fail=1; }
  fi
fi

# 4g) The shared deterministic fixture validates the complete Spot Atlas schema
#     (including enums and exact duplicate coordinates) for both gates, then
#     exercises production timezone/UI helpers with explicit display zones.
if ! command -v node >/dev/null 2>&1; then
  say "FAIL node is required for Spot Atlas schema/timezone tests"; fail=1
elif ! node scripts/test-spot-atlas-time.js; then
  say "FAIL Spot Atlas schema/timezone tests"; fail=1
fi

# 4h) English localization is a text-only overlay over the canonical Chinese
#     structure. Enforce exact ID/array parity so dates, bosses and drawer links
#     can never drift between languages. Also keep the owner UI dictionary
#     symmetric: every static key must exist in both locales.
if command -v python3 >/dev/null 2>&1; then
  if ! python3 - <<'PY'
import json, re, sys
from html.parser import HTMLParser

def load(path):
    with open(path, encoding='utf-8') as f: return json.load(f)

events = load('public/data/events.json')
rot = load('public/data/rotations.json')
cats = load('public/data/categories.json')
loc = load('public/data/i18n/en.json')
ui = load('public/data/i18n/ui.json')
errors = []
def bad(msg): errors.append(msg)
def arr(v): return v if isinstance(v, list) else []
def text(v): return isinstance(v, str) and bool(v.strip())

# Normalize malformed-but-valid JSON into safe empty containers after recording
# deterministic errors. The validator must fail closed without a Python traceback.
if not isinstance(events, list):
    bad('events.json must be an array')
    events = []
else:
    valid_events = []
    for i, event in enumerate(events):
        if not isinstance(event, dict):
            bad(f'events.json entry {i} must be an object')
            continue
        eid = event.get('id')
        if not isinstance(eid, str) or not eid:
            bad(f'events.json entry {i} needs a string id')
            continue
        valid_events.append(event)
    events = valid_events
if not isinstance(rot, dict):
    bad('rotations.json must be an object')
    rot = {}
if not isinstance(cats, dict):
    bad('categories.json must be an object')
    cats = {}

if not isinstance(ui, dict):
    bad('ui.json must be an object')
    ui = {}
elif set(ui) != {'zh-CN', 'en'} or not all(isinstance(ui.get(k), dict) for k in ('zh-CN','en')):
    bad('ui.json must contain zh-CN and en objects')
elif set(ui['zh-CN']) != set(ui['en']):
    bad('ui.json locale key sets differ')
else:
    for lang in ('zh-CN','en'):
        for key, value in ui[lang].items():
            if not text(value): bad(f'ui.json {lang}.{key} is empty/non-string')

OVERLAY_KEYS = {'version','events','rotations','categories','regions'}
EVENT_KEYS = {'name','heading','summary','bonuses','pokemon','counters','sections'}
COUNTER_KEYS = {'name','fast','charged'}
SECTION_KEYS = {'title','items','body','mons'}
ROTATION_KEYS = {'note','tracks'}
TRACK_KEYS = {'label','segments'}
SEGMENT_KEYS = {'name','cn','pokemon'}
if not isinstance(loc, dict):
    bad('en.json must be an object')
    loc = {}
elif set(loc) != OVERLAY_KEYS:
    bad(f'en.json top-level keys must be exactly {sorted(OVERLAY_KEYS)}')

canonical_ids = {e.get('id') for e in events}
translated = loc.get('events')
if loc.get('version') != 1 or not isinstance(translated, dict):
    bad('en.json needs version:1 and events{}')
elif set(translated) != canonical_ids:
    missing = sorted(canonical_ids - set(translated), key=str)
    extra = sorted(set(translated) - canonical_ids, key=str)
    bad(f'en.json event ID parity failed (missing={missing[:5]}, orphan={extra[:5]})')
else:
    for event in events:
        eid, tx = event['id'], translated[event['id']]
        if not isinstance(tx, dict): bad(f'{eid}: translation must be an object'); continue
        if set(tx) != EVENT_KEYS: bad(f'{eid}: translation keys must be exactly {sorted(EVENT_KEYS)}')
        if not text(tx.get('name')): bad(f'{eid}: empty English name')
        for key in ('heading','summary'):
            value = tx.get(key)
            if not isinstance(value, str):
                bad(f'{eid}: English {key} must be a string')
            elif event.get(key) and not text(value):
                bad(f'{eid}: empty English {key} but canonical has text')
            elif not event.get(key) and value != '':
                bad(f'{eid}: English {key} must be empty when canonical is absent')
        for key in ('bonuses','pokemon','counters','sections'):
            canonical = event.get(key)
            if canonical is not None and not isinstance(canonical, list):
                bad(f'{eid}: canonical {key} must be an array when present')
            if not isinstance(tx.get(key), list) or len(tx[key]) != len(arr(canonical)):
                bad(f'{eid}: English {key}[] length/type differs from canonical')
        if not all(text(x) for x in arr(tx.get('bonuses'))): bad(f'{eid}: empty/non-string English bonus')
        if not all(text(x) for x in arr(tx.get('pokemon'))): bad(f'{eid}: empty English Pokémon name')
        for i, counter in enumerate(arr(event.get('counters'))):
            if not isinstance(counter, dict):
                bad(f'{eid}: canonical counter {i} must be an object')
                counter = {}
            ct = arr(tx.get('counters'))[i] if i < len(arr(tx.get('counters'))) else {}
            if not isinstance(ct, dict) or not text(ct.get('name')):
                bad(f'{eid}: counter {i} lacks an English name'); continue
            if set(ct) != COUNTER_KEYS: bad(f'{eid}: counter {i} keys must be exactly {sorted(COUNTER_KEYS)}')
            for move in ('fast','charged'):
                value = ct.get(move)
                if not isinstance(value, str):
                    bad(f'{eid}: counter {i} {move} must be a string')
                elif counter.get(move) and not text(value):
                    bad(f'{eid}: counter {i} {move} is empty but canonical has a move')
                elif not counter.get(move) and value != '':
                    bad(f'{eid}: counter {i} {move} must be empty when canonical is absent')
        for i, section in enumerate(arr(event.get('sections'))):
            if not isinstance(section, dict):
                bad(f'{eid}: canonical section {i} must be an object')
                section = {}
            st = arr(tx.get('sections'))[i] if i < len(arr(tx.get('sections'))) else {}
            if not isinstance(st, dict) or not text(st.get('title')):
                bad(f'{eid}: section {i} lacks an English title'); continue
            if set(st) != SECTION_KEYS: bad(f'{eid}: section {i} keys must be exactly {sorted(SECTION_KEYS)}')
            for key in ('items','mons'):
                if not isinstance(st.get(key), list) or len(st[key]) != len(arr(section.get(key))):
                    bad(f'{eid}: section {i} English {key}[] differs from canonical')
                elif not all(text(x) for x in st[key]):
                    bad(f'{eid}: section {i} has an empty English {key} item')
            body = st.get('body')
            if not isinstance(body, str):
                bad(f'{eid}: section {i} English body must be a string')
            elif section.get('body') and not text(body):
                bad(f'{eid}: section {i} English body is empty but canonical has body text')
            elif not section.get('body') and body != '':
                bad(f'{eid}: section {i} English body must be empty when canonical is absent')

raw_tracks = rot.get('tracks')
if not isinstance(raw_tracks, list):
    bad('rotations.json tracks must be an array')
canonical_tracks = []
for i, track in enumerate(arr(raw_tracks)):
    if not isinstance(track, dict):
        bad(f'rotations.json track {i} must be an object')
        continue
    key = track.get('key')
    if not isinstance(key, str) or not key:
        bad(f'rotations.json track {i} needs a string key')
        continue
    canonical_tracks.append(track)
tracks = {t['key']:t for t in canonical_tracks}
if len(tracks) != len(canonical_tracks): bad('rotations.json track keys must be unique')
rot_tx = loc.get('rotations')
if not isinstance(rot_tx, dict) or set(rot_tx) != ROTATION_KEYS:
    bad(f'en.json rotations keys must be exactly {sorted(ROTATION_KEYS)}')
    rot_tx = {}
rt = rot_tx.get('tracks')
if not isinstance(rt, dict) or set(rt) != set(tracks):
    bad('en.json rotation track keys differ from canonical')
else:
    if not text(rot_tx.get('note')): bad('en.json rotation note is empty')
    for key, track in tracks.items():
        tx = rt[key]
        if not isinstance(tx, dict) or not text(tx.get('label')):
            bad(f'rotation {key}: empty English label'); continue
        if set(tx) != TRACK_KEYS: bad(f'rotation {key}: keys must be exactly {sorted(TRACK_KEYS)}')
        raw_segs = track.get('segments')
        if not isinstance(raw_segs, list): bad(f'rotation {key}: canonical segments must be an array')
        segs, tsegs = arr(raw_segs), tx.get('segments')
        if not isinstance(tsegs, list) or len(tsegs) != len(segs): bad(f'rotation {key}: segment count differs'); continue
        for i, seg in enumerate(segs):
            if not isinstance(seg, dict):
                bad(f'rotation {key}/{i}: canonical segment must be an object')
                seg = {}
            st = tsegs[i]
            if not isinstance(st, dict) or not text(st.get('name')) or not text(st.get('cn')):
                bad(f'rotation {key}/{i}: empty English segment name/title'); continue
            if set(st) != SEGMENT_KEYS: bad(f'rotation {key}/{i}: keys must be exactly {sorted(SEGMENT_KEYS)}')
            canonical_names = seg.get('pokemon')
            if not isinstance(canonical_names, list): bad(f'rotation {key}/{i}: canonical pokemon must be an array')
            names = st.get('pokemon')
            if not isinstance(names, list) or len(names) != len(arr(canonical_names)) or not all(text(x) for x in names):
                bad(f'rotation {key}/{i}: English Pokémon names differ from canonical')

regions = loc.get('regions')
required_regions = {'calendar-notes','rankings-current','rankings-attackers','rankings-defenders','rankings-raid'}
if not isinstance(regions, dict) or set(regions) != required_regions or not all(text(v) for v in regions.values()):
    bad('en.json regions must contain all five non-empty AI region HTML strings')
category_tx = loc.get('categories')
if not isinstance(category_tx, dict) or set(category_tx) != set(cats):
    bad('en.json category label keys differ from categories.json')
elif not all(text(v) for v in category_tx.values()):
    bad('en.json category labels must be non-empty strings')

# Parse localized HTML as the browser would (quotes/entities included), enforce a
# tag/attribute/class/scheme allowlist, and compare all non-text structure between
# each Chinese wrapper and its English counterpart. Regex checks below remain as
# cheap defense-in-depth, but this parser owns the security boundary.
SAFE_TAGS = {'a','br','code','div','em','h3','h4','img','li','ol','p','small','span','strong','ul'}
SAFE_ATTRS = {'alt','aria-label','class','data-event-id','data-hub','href','loading','rel','src','target','title'}
SAFE_CLASSES = {
    'panel','panel-head','note-grid','callout','rank-list','rank-item','pill','pillrow','badge','btn','btn-primary',
    'muted','meta','mon-icon','mon-row','mon','shiny','tier','tier-S','tier-A','tier-B','tier-C','spr','ico','ico-lg',
    'event-link','raid-wall','raid-block','raid-boss','boss-icon','binfo','btop','raid-mega','mini','detail-links',
}
STRUCT_ATTRS = {'class','data-event-id','data-hub','href','loading','rel','src','target'}
class RichParser(HTMLParser):
    def __init__(self, label):
        super().__init__(convert_charrefs=True)
        self.label, self.fingerprint = label, []
    def check(self, tag, attrs, closing=False):
        tag = tag.lower()
        if tag not in SAFE_TAGS:
            bad(f'{self.label}: forbidden HTML tag <{tag}>')
        clean = []
        for raw_name, value in attrs:
            name, value = raw_name.lower(), value or ''
            if name not in SAFE_ATTRS or name.startswith('on'):
                bad(f'{self.label}: forbidden HTML attribute {name}')
                continue
            if name == 'class':
                classes = value.split()
                if any(c not in SAFE_CLASSES for c in classes): bad(f'{self.label}: unapproved CSS class in {value!r}')
            elif name == 'href' and not (value.startswith('https://') or value.startswith('#')):
                bad(f'{self.label}: unsafe href {value!r}')
            elif name == 'src' and not (value.startswith('https://') or value.startswith('assets/')):
                bad(f'{self.label}: unsafe src {value!r}')
            elif name == 'data-event-id' and value not in canonical_ids:
                bad(f'{self.label}: unknown data-event-id {value!r}')
            elif name == 'data-hub' and not re.fullmatch(r'[A-Za-z0-9._:-]+', value):
                bad(f'{self.label}: malformed data-hub {value!r}')
            elif name == 'target' and value != '_blank':
                bad(f'{self.label}: target must be _blank')
            elif name == 'rel' and any(x not in {'noopener','noreferrer'} for x in value.split()):
                bad(f'{self.label}: unsafe rel value')
            elif name == 'loading' and value not in {'lazy','eager'}:
                bad(f'{self.label}: invalid loading value')
            if name in STRUCT_ATTRS: clean.append((name, value))
        self.fingerprint.append(('startend' if closing else 'start', tag, tuple(sorted(clean))))
    def handle_starttag(self, tag, attrs): self.check(tag, attrs)
    def handle_startendtag(self, tag, attrs): self.check(tag, attrs, True)
    def handle_endtag(self, tag): self.fingerprint.append(('end', tag.lower()))
    def handle_decl(self, decl): bad(f'{self.label}: declarations are forbidden')
    def unknown_decl(self, data): bad(f'{self.label}: declarations are forbidden')

index_html = open('public/index.html', encoding='utf-8').read()
if isinstance(regions, dict):
    for region in sorted(required_regions):
        match = re.search(r'<!-- AI:START '+re.escape(region)+r' -->(.*?)<!-- AI:END '+re.escape(region)+r' -->', index_html, re.S)
        wrapper = re.search(r'^\s*<div\s+data-ai-region="'+re.escape(region)+r'"[^>]*>(.*)</div>\s*$', match.group(1) if match else '', re.S)
        if not wrapper:
            bad(f'{region}: cannot extract Chinese data-ai-region wrapper for parity')
            continue
        zh_parser, en_parser = RichParser('Chinese '+region), RichParser('English '+region)
        zh_parser.feed(wrapper.group(1)); zh_parser.close()
        english_html = regions.get(region, '')
        en_parser.feed(english_html if isinstance(english_html, str) else ''); en_parser.close()
        if zh_parser.fingerprint != en_parser.fingerprint:
            bad(f'{region}: English HTML structure/URLs/data references differ from Chinese')

# The protected static UI dictionary also has an innerHTML path for a few keys.
# Parse every value and require equal non-text markup across locales.
if isinstance(ui.get('zh-CN'), dict) and isinstance(ui.get('en'), dict):
    for key in sorted(set(ui['zh-CN']) & set(ui['en'])):
        zp, ep = RichParser('ui zh-CN.'+key), RichParser('ui en.'+key)
        zh_value, en_value = ui['zh-CN'][key], ui['en'][key]
        zp.feed(zh_value if isinstance(zh_value, str) else ''); zp.close()
        ep.feed(en_value if isinstance(en_value, str) else ''); ep.close()
        if zp.fingerprint != ep.fingerprint:
            bad(f'ui.{key}: locale HTML structure differs')

# English-visible content must not silently fall back to Chinese. This checks
# only en.json; trademarks/romanized names remain valid Latin text.
def strings(v):
    if isinstance(v, str): yield v
    elif isinstance(v, dict):
        for x in v.values(): yield from strings(x)
    elif isinstance(v, list):
        for x in v: yield from strings(x)
for value in strings(loc):
    if re.search(r'[\u3400-\u9fff]', value):
        bad('en.json contains CJK text (English fallback would be mixed-language)')
        break

for err in errors: print('validate: FAIL i18n ' + err)
sys.exit(1 if errors else 0)
PY
  then
    fail=1
  fi
else
  say "FAIL python3 required for bilingual structure validation"
  fail=1
fi

# English rich regions are daily-agent HTML too: apply the same inert-content
# policy used for the Chinese marker regions.
if [ -f public/data/i18n/en.json ] && jq empty public/data/i18n/en.json >/dev/null 2>&1; then
  for region in calendar-notes rankings-current rankings-attackers rankings-defenders rankings-raid; do
    body=$(jq -r --arg r "$region" '.regions[$r] // ""' public/data/i18n/en.json)
    if printf '%s' "$body" | grep -qiE '<(script|style|iframe|object|embed)[ >]'; then
      say "FAIL English region $region contains forbidden tag"; fail=1
    fi
    if printf '%s' "$body" | grep -qiE '(^|[[:space:]])on[a-z]+[[:space:]]*='; then
      say "FAIL English region $region contains event-handler attribute"; fail=1
    fi
    if printf '%s' "$body" | grep -qiF 'javascript:'; then
      say "FAIL English region $region contains javascript: URI"; fail=1
    fi
    bad_url=$(printf '%s' "$body" | grep -oiE '(href|src)[[:space:]]*=[[:space:]]*"[^"]*"' \
      | sed -E 's/^[^"]*"//; s/"$//' | grep -viE '^(https://|assets/|#)' | head -1 || true)
    if [ -n "$bad_url" ]; then
      say "FAIL English region $region has href/src with disallowed scheme: $bad_url"; fail=1
    fi
  done
fi

# 5) No stray <script> injected into the editable regions of index.html
#    (agent-written HTML must be inert). app.js is the only allowed script.
if [ "$(grep -c '<script' "$H")" -ne 1 ]; then
  say "FAIL unexpected <script> count in index.html (only app.js is allowed)"; fail=1
fi

# 5b) AI regions must not contain dangerous HTML: <style>, <iframe>, <object>,
#     <embed>, event-handler attributes (onerror, onload, onclick…), javascript: URIs,
#     or any href/src whose scheme isn't on the allowlist (defeats entity-encoded bypasses).
for region in calendar-notes rankings-current rankings-attackers rankings-defenders rankings-raid; do
  body=$(ai_region "$region")
  if printf '%s' "$body" | grep -qiE '<(style|iframe|object|embed)[ >]'; then
    say "FAIL AI region $region contains forbidden tag (<style>/<iframe>/<object>/<embed>)"; fail=1
  fi
  if printf '%s' "$body" | grep -qiE '(^|[[:space:]])on[a-z]+[[:space:]]*='; then
    say "FAIL AI region $region contains event-handler attribute (onerror/onload/onclick…)"; fail=1
  fi
  if printf '%s' "$body" | grep -qiF 'javascript:'; then
    say "FAIL AI region $region contains javascript: URI"; fail=1
  fi
  # href/src must use a safe scheme. The literal javascript: grep above misses
  # entity-encoded payloads (e.g. href="jav&#x61;script:…") that the browser decodes
  # and executes; an allowlist also blocks data:/vbscript:/protocol-relative URLs.
  # AI regions only ever need https:// , repo-relative assets/ , or #anchors.
  # (Attributes are the conventional double-quoted form the agent/app emit.)
  bad_url=$(printf '%s' "$body" | grep -oiE '(href|src)[[:space:]]*=[[:space:]]*"[^"]*"' \
    | sed -E 's/^[^"]*"//; s/"$//' | grep -viE '^(https://|assets/|#)' | head -1 || true)
  if [ -n "$bad_url" ]; then
    say "FAIL AI region $region has href/src with disallowed scheme: $bad_url"; fail=1
  fi
done

[ "$fail" = 0 ] && say "OK all checks passed"
exit $fail
