#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# preflight.sh — render dry-run linter. Simulates the calendar logic in
# public/app.js against the data the agent just wrote, and FAILS the run on
# semantic breakage that validate.sh (structure only) cannot see:
#
#   1. ORPHAN raid  — a raid-battles event that day-icons would hide but no
#                     rotation 5★/Mega segment ever links to → silently vanishes.
#   2. ICON↔DRAWER  — a rotation segment shows a boss its drawer event lacks, OR
#                     a drawer lists a boss shown in no icon (the "3 birds vs the
#                     full all-gen pool" divergence).
#   3. MEGA BASE-ID — a 5★/Mega segment uses a form id (≥10000) instead of the
#                     base dex → the day-icon opens a bare, link-less drawer.
#   (+ a soft WARN for over-long chip names that crowd the day cells.)
#
# Run BEFORE validate.sh in run-daily.sh; non-zero exit = roll back. The render
# contract these checks enforce is documented in AGENTS.md ("渲染契约").
# Degrades gracefully (exit 0 + WARN) if python3 or the JSON isn't usable —
# those are validate.sh's job, not this gate's.
# ---------------------------------------------------------------------------
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v python3 >/dev/null 2>&1 || { echo "preflight: WARN python3 not found — render checks skipped"; exit 0; }

python3 - <<'PY'
import json, sys
from datetime import date, timedelta

def load(p):
    try:
        with open(p, encoding='utf-8') as f: return json.load(f)
    except Exception as e:
        print(f"preflight: WARN cannot read {p} ({e}) — skipping render checks (validate.sh owns JSON validity)")
        sys.exit(0)

events = load('public/data/events.json')
rot    = load('public/data/rotations.json')
try:
    cats = load('public/data/categories.json')
except SystemExit:
    cats = {}
if not isinstance(events, list): events = []
if not isinstance(rot, dict): rot = {}

fails, warns = [], []
def fail(m): fails.append(m)
def warn(m): warns.append(m)

def pday(s):
    if not s: return None
    try: return date(int(s[0:4]), int(s[5:7]), int(s[8:10]))
    except Exception: return None

def ids_of(obj):
    return {p.get('id') for p in (obj.get('pokemon') or []) if p.get('id')}

# ---- mirror app.js category/long-term logic -------------------------------
CHIP_TYPES = {'pokemon-spotlight-hour','spotlight-hour','raid-hour','max-mondays'}
for k, v in (cats.items() if isinstance(cats, dict) else []):
    if isinstance(v, dict) and v.get('kind') == 'chip': CHIP_TYPES.add(k)
LONG_TYPES = {'season','go-pass','go-battle-league'}

def is_long(e):
    if e.get('longTerm') is True or e.get('display') == 'banner': return True
    if e.get('longTerm') is False or e.get('display') == 'bar': return False
    if e.get('type') in LONG_TYPES: return True
    s, en = pday(e.get('start')), pday(e.get('end')) or pday(e.get('start'))
    return bool(s and en and (en - s).days >= 14)

# 5★/Mega rotation segments are the only ones that become day-icons (app.js)
icon_segs = []
for t in (rot.get('tracks') or []):
    if t.get('key') in ('5star', 'mega'):
        for seg in (t.get('segments') or []):
            icon_segs.append((t.get('key'), seg))

def overlaps(s1, e1, s2, e2):
    if not (s1 and s2): return False
    e1 = e1 or s1; e2 = e2 or s2
    return not (e1 < s2 or s1 > e2)

# findRaidEvent(): the raid-battles event a given icon opens (first id+date match)
def find_raid_event(seg):
    sids = ids_of(seg)
    if not sids: return None
    ss, se = pday(seg.get('start')), pday(seg.get('end')) or pday(seg.get('start'))
    for e in events:
        if e.get('type') != 'raid-battles': continue
        es, ee = pday(e.get('start')), pday(e.get('end')) or pday(e.get('start'))
        if not es: continue
        if not overlaps(ss, se, es, ee): continue
        if ids_of(e) & sids: return e
    return None

def segs_matching_event(E):
    eids = ids_of(E)
    es, ee = pday(E.get('start')), pday(E.get('end')) or pday(E.get('start'))
    out = []
    for key, seg in icon_segs:
        ss, se = pday(seg.get('start')), pday(seg.get('end')) or pday(seg.get('start'))
        if overlaps(ss, se, es, ee) and (ids_of(seg) & eids): out.append((key, seg))
    return out

def grid_start(y, m):
    first = date(y, m, 1)
    return first - timedelta(days=first.weekday())  # Monday-first, like app.js

def has_icons(y, m):
    gs = grid_start(y, m)
    for key, seg in icon_segs:
        ss, se = pday(seg.get('start')), pday(seg.get('end')) or pday(seg.get('start'))
        mons = [p for p in (seg.get('pokemon') or []) if p.get('id') or p.get('sprite')]
        if not (mons and ss): continue
        si, ei = (ss - gs).days, (se - gs).days
        if not (ei < 0 or si > 41): return True
    return False

def in_month_days(E, y, m):
    gs = grid_start(y, m)
    s, en = pday(E.get('start')), pday(E.get('end')) or pday(E.get('start'))
    if not s: return []
    si, ei = (s - gs).days, (en - gs).days
    out = []
    for i in range(max(0, si), min(41, ei) + 1):
        d = gs + timedelta(days=i)
        if d.year == y and d.month == m: out.append(d)
    return out

# ---- Check 1 (WARN): over-long chip names crowd a day cell ----------------
for e in events:
    if e.get('type') in CHIP_TYPES and not is_long(e):
        nm = e.get('name', '')
        if len(nm) > 16:
            warn(f"long chip name ({len(nm)} chars) may crowd the day cell — shorten or use a 角标: {e.get('id')} «{nm}»")

# ---- Check 2 (FAIL): orphan raid-battles that day-icons hide & never link --
for E in events:
    if E.get('type') != 'raid-battles' or is_long(E): continue
    if segs_matching_event(E): continue          # reachable via some day-icon
    s, en = pday(E.get('start')), pday(E.get('end')) or pday(E.get('start'))
    if not s: continue
    months, cur = set(), date(s.year, s.month, 1)
    while cur <= en:
        months.add((cur.year, cur.month))
        cur = date(cur.year + (1 if cur.month == 12 else 0), 1 if cur.month == 12 else cur.month + 1, 1)
    for (y, mn) in sorted(months):
        if in_month_days(E, y, mn) and has_icons(y, mn):
            fail(f"orphan raid: '{E.get('id')}' (raid-battles) is hidden by day-icons in {y}-{mn:02d} "
                 f"but no 5★/Mega rotation segment links to it → it vanishes. Add a rotations.json "
                 f"segment (matching dex id + dates) or set longTerm:true.")
            break

# ---- Check 3 (FAIL): icon↔drawer consistency ------------------------------
# 3a phantom: a segment's icon opens event E but shows a boss E doesn't list.
for key, seg in icon_segs:
    E = find_raid_event(seg)
    if not E: continue
    extra = ids_of(seg) - ids_of(E)
    if extra:
        fail(f"icon↔drawer: rotation segment «{seg.get('cn') or seg.get('name')}» "
             f"({seg.get('start')}) lists dex {sorted(extra)} not in its drawer event "
             f"'{E.get('id')}' — the rotation panel would show bosses the drawer denies.")
# 3b coverage: every boss in a raid drawer must appear in some linking icon.
for E in events:
    if E.get('type') != 'raid-battles': continue
    segs = segs_matching_event(E)
    if not segs: continue
    union = set().union(*[ids_of(seg) for _, seg in segs]) if segs else set()
    missing = ids_of(E) - union
    if missing:
        fail(f"icon↔drawer: raid drawer '{E.get('id')}' lists dex {sorted(missing)} that appear in "
             f"NO rotation icon for those days — the weekly-rotation panel under-reports the pool "
             f"(e.g. showing 3 birds while the drawer has the full all-gen list). Sync seg.pokemon "
             f"to the event's pokemon[].")

# ---- Check 4 (FAIL): Mega/5★ segment must use BASE dex id, not a form id ---
for key, seg in icon_segs:
    for p in (seg.get('pokemon') or []):
        i = p.get('id')
        if isinstance(i, int) and i >= 10000:
            fail(f"mega base-id: rotation segment «{seg.get('cn') or seg.get('name')}» pokemon id={i} "
                 f"is a form id (≥10000). Use the BASE national-dex id + a \"sprite\" override, or the "
                 f"day-icon can't match its raid event (opens a bare drawer).")

# ---- report ---------------------------------------------------------------
for w in warns: print(f"preflight: WARN {w}")
for f in fails: print(f"preflight: FAIL {f}")
if fails:
    print(f"preflight: {len(fails)} render check(s) failed")
    sys.exit(1)
print(f"preflight: OK render checks passed" + (f" ({len(warns)} warning(s))" if warns else ""))
PY
