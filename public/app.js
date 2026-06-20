/* ============================================================================
 * pogo-agent frontend (PROTECTED — the daily content agent must not edit this).
 * Renders: the month calendar (spanning bars + day chips, from data/events.json)
 * and the rankings sub-tab switching. After editing this file or style.css, regenerate
 * scripts/protected.sha256 or the next daily run fails validation.
 * ========================================================================== */
'use strict';

const state = { events: [], rotations: null, categories: {}, calYear: 0, calMonth: 0 };
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']; // Monday-first

/* ---------- calendar geometry (px) ---------- */
const NUM_H = 30;   // height reserved for the day-number row
const LANE_H = 23;  // vertical pitch of one spanning-bar lane

/* ---------- event categories -------------------------------------------------
 * Each LeekDuck event `type` maps to a colour + Chinese label + how it shows:
 *   kind 'bar'  → a spanning bar across the days it covers (named events)
 *   kind 'chip' → a small marker inside a single day cell (recurring/point events)
 *   bg true     → a low-key background band (season / pass) so named events read.
 * Unknown types fall back to a hashed colour and are barred unless single-day. */
/* Tarot-harmonised palette: one family of muted, antique jewel tones — even
 * lightness/chroma, hue is the only variable — so bars read like coloured
 * enamel inlaid in the gold-on-black deck instead of a rainbow. All bar text
 * is a single dark sepia ink (--ink-dark) for the "engraved gemstone" look. */
const INK_DARK = '#17130b';
/* The theme PALETTE is the only place raw hex lives. Categories — both the
 * built-ins below and the agent-editable data/categories.json — reference a
 * palette KEY, never a raw colour, so new event types can be registered in data
 * without inventing off-theme colours. Families: warm rust/orange = raids,
 * grass-green = 社区日/聚焦, teal = 调查, blue = 活动, indigo = 对战联盟, gold/brown = bands. */
const PALETTE = {
  purple:'#9c7bb0', green:'#74a06f', greenlt:'#93b37e', rust:'#b16a5c', orange:'#c0824f',
  red:'#c85d4e', teal:'#4f8f93', teallt:'#54979a', blue:'#5b8fa6', indigo:'#7a7fb8',
  mauve:'#bd7f97', gold:'#b08a44', brown:'#8c6f3e',
};
/* Built-in defaults: event `type` → palette key + 简体中文 label + render kind
 * ('bar' spans the days it covers, 'chip' is a single-day marker; bg = muted
 * long-running band). data/categories.json is merged OVER these for new types. */
const CATEGORY_DEFAULTS = {
  'pokemon-go-fest':        { palette:'purple',  label:'GO Fest',  kind:'bar' },
  'community-day':          { palette:'green',   label:'社区日',    kind:'bar' },
  'pokemon-spotlight-hour': { palette:'greenlt', label:'聚焦时刻',  kind:'chip' },
  'spotlight-hour':         { palette:'greenlt', label:'聚焦时刻',  kind:'chip' },
  'raid-battles':           { palette:'rust',    label:'团战 Boss', kind:'bar' },
  'raid-hour':              { palette:'orange',  label:'团战时刻',  kind:'chip' },
  'raid-day':               { palette:'red',     label:'团战日',    kind:'bar' },
  'research':               { palette:'teal',    label:'调查',      kind:'bar' },
  'choose-your-path':       { palette:'teallt',  label:'限时调查',  kind:'bar' },
  'event':                  { palette:'blue',    label:'活动',      kind:'bar' },
  'go-battle-league':       { palette:'indigo',  label:'对战联盟',  kind:'bar' },
  'max-mondays':            { palette:'mauve',   label:'Max 周一',  kind:'chip' },
  'go-pass':                { palette:'gold',    label:'GO Pass',   kind:'bar', bg:true, fg:'#1d1402' },
  'season':                 { palette:'brown',   label:'赛季',      kind:'bar', bg:true, fg:'#fbeccb' },
};
// Resolve a category def ({palette,label,kind,bg?,fg?}) to render fields. An
// unknown palette key falls back to a muted hashed colour (validation blocks it).
function resolveCat(def) {
  return {
    color: PALETTE[def.palette] || hashColor(def.palette || def.label || ''),
    fg: def.fg || INK_DARK,
    label: def.label || def.palette || '活动',
    kind: def.kind === 'chip' ? 'chip' : 'bar',
    bg: !!def.bg,
  };
}

/* ---------- small helpers ---------- */
function $(sel) { return document.querySelector(sel); }
function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parseDay(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]); // pure date → local (no UTC round-trip)
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function spriteUrl(id) {
  return id ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png` : '';
}
function hashColor(s) {
  // Muted, low-chroma fallback so unknown types still sit inside the tarot family.
  let h = 0; for (const ch of String(s || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 22%, 60%)`;
}
function dayDiff(a, b) { return Math.round((b - a) / 86400000); }
// Step N calendar days from a LOCAL-midnight date, staying in the viewer's own
// timezone. Adding raw 86400000ms drifts across DST (a fall-back day is 25h, so
// the ms lands at 23:00 of the prior day and ymd() reads the wrong date) — so the
// "today" highlight could land a day early. Building from Y/M/D+n is DST-safe.
function addDays(base, n) { return new Date(base.getFullYear(), base.getMonth(), base.getDate() + n); }
function catOf(ev) {
  const def = (state.categories && state.categories[ev.type]) || CATEGORY_DEFAULTS[ev.type];
  if (def) return resolveCat(def);
  const span = ev._s && ev._e ? dayDiff(ev._s, ev._e) : 0;
  return { color: hashColor(ev.type), fg: INK_DARK, label: ev.heading || ev.type || '活动', kind: span >= 1 ? 'bar' : 'chip' };
}
/* Long-running "background" events (season / pass / league, or anything that
 * spans more than ~2 weeks) are pulled out of the day grid into a compact band
 * so they don't bury the headline short events. The daily agent can override
 * either way with an explicit longTerm (or display:'banner'|'bar') flag. */
const LONG_TYPES = new Set(['season', 'go-pass', 'go-battle-league']);
function isLongTerm(ev) {
  if (ev.longTerm === true || ev.display === 'banner') return true;
  if (ev.longTerm === false || ev.display === 'bar') return false;
  if (LONG_TYPES.has(ev.type)) return true;
  if (!ev._s || !ev._e) return false;
  return dayDiff(ev._s, ev._e) >= 14;
}
function fmtDateTime(s) {
  const d = new Date(s); if (isNaN(d.getTime())) return s || '';
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtRange(start, end) {
  if (!start) return '时间待定';
  const s = fmtDateTime(start);
  if (!end || end === start) return s;
  return `${s} — ${fmtDateTime(end)}`;
}
// Month/day only — the long-event band and rotation tracks don't need HH:MM.
function fmtDateShort(s) {
  const d = new Date(s); if (isNaN(d.getTime())) return s || '';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
// Sprite for a pokemon/counter/rotation entry: an explicit `sprite` URL wins
// (needed for Mega/Primal/GMax/regional forms the base dex id can't represent),
// else the national-dex sprite from `id`.
function monSprite(p) {
  return p ? (p.sprite || (p.id ? spriteUrl(p.id) : '')) : '';
}
function firstSprite(ev) {
  return monSprite((ev.pokemon || [])[0]);
}
// Pokémon GO Hub DB page for an entry. `hub` (e.g. "212-Mega", "77-Galarian")
// overrides; else the national-dex id. Forms keep the base id in data (so the
// day-icon↔event match still works), so set `hub` for the exact form page.
function hubHref(p) {
  const slug = p && (p.hub || p.id);
  return slug ? 'https://db.pokemongohub.net/pokemon/' + encodeURIComponent(slug) : '';
}
// Wrap a sprite <img> string in a link to its hub page (no-op without an id).
function linkSprite(imgHtml, p) {
  const href = hubHref(p);
  return href ? `<a class="spr-link" href="${href}" target="_blank" rel="noopener">${imgHtml}</a>` : imgHtml;
}
// Make STATIC sprite <img> (the ranking panels baked into index.html) clickable →
// hub. Uses data-hub if present, else the base national-dex id parsed from a
// PokeAPI sprite URL. Skips type icons, already-linked imgs and the calendar
// day-icon buttons; form-id sprites (≥10000) need an explicit data-hub.
function linkifySprites(root) {
  if (!root) return;
  root.querySelectorAll('img').forEach(img => {
    if (img.closest('a') || img.closest('button') || img.closest('#calendar') || img.closest('#long-term')) return;
    let slug = img.getAttribute('data-hub');
    if (!slug) {
      const m = /\/pokemon\/(\d+)\.png(?:[?#]|$)/.exec(img.getAttribute('src') || '');
      if (m && +m[1] < 10000) slug = m[1];
    }
    if (!slug) return;
    const a = document.createElement('a');
    a.className = 'spr-link';
    a.href = 'https://db.pokemongohub.net/pokemon/' + slug;
    a.target = '_blank'; a.rel = 'noopener';
    img.parentNode.insertBefore(a, img);
    a.appendChild(img);
  });
}

/* ---------- data ---------- */
async function loadData() {
  try {
    const r = await fetch('data/events.json?t=' + Date.now());
    const raw = await r.json();
    state.events = (Array.isArray(raw) ? raw : []).map(ev => {
      const s = parseDay(ev.start);
      const e = parseDay(ev.end) || s;
      return Object.assign({}, ev, { _s: s, _e: e });
    });
  } catch (e) { state.events = []; }
  try {
    const m = await (await fetch('data/meta.json?t=' + Date.now())).json();
    $('#last-updated').textContent = m && m.lastUpdated ? ('更新于 ' + fmtDateTime(m.lastUpdated)) : '尚未更新';
  } catch (e) { $('#last-updated').textContent = ''; }
  try {
    state.rotations = await (await fetch('data/rotations.json?t=' + Date.now())).json();
  } catch (e) { state.rotations = null; }
  try {
    state.categories = (await (await fetch('data/categories.json?t=' + Date.now())).json()) || {};
  } catch (e) { state.categories = {}; }
  try {
    const ft = await (await fetch('data/featured.json?t=' + Date.now())).json();
    const ftSet = new Set(Array.isArray(ft) ? ft : []);
    state.events.forEach(ev => { if (ftSet.has(ev.id)) ev._featured = true; });
  } catch (e) { /* no featured.json — fine */ }
}

/* ---------- calendar ---------- */
// Build the 6-week (Monday-first) grid for the active month and return the
// Date the grid starts on (the Monday on/before the 1st).
function gridStartDate() {
  const first = new Date(state.calYear, state.calMonth, 1);
  const firstDow = (first.getDay() + 6) % 7; // Monday = 0
  return new Date(state.calYear, state.calMonth, 1 - firstDow);
}

// Greedy interval-partition: assign each visible bar to the lowest lane whose
// previous bar has already ended. Mutates each item with `.lane`.
function packLanes(items) {
  const laneEnd = []; // laneEnd[l] = last occupied grid index in lane l
  items.forEach(it => {
    let l = 0;
    while (laneEnd[l] != null && laneEnd[l] >= it.si) l++;
    it.lane = l; laneEnd[l] = it.ei;
  });
}

// A weekly rotation day-icon stands in for a real raid event when one exists in
// events.json (same boss dex id + overlapping dates). Resolve to that event so the
// drawer carries its counters / links / summary instead of a bare name + sprite.
function findRaidEvent(rd) {
  const ids = new Set((rd && rd.mons || []).map(m => m && m.id).filter(Boolean));
  if (!ids.size) return null;
  const rs = parseDay(rd.start), re = parseDay(rd.end) || rs;
  return state.events.find(ev => {
    if (ev.type !== 'raid-battles' || !ev._s || !ev._e) return false;
    if (rs && re && (ev._e < rs || ev._s > re)) return false; // dates don't overlap
    return (ev.pokemon || []).some(p => p && ids.has(p.id));
  }) || null;
}

function renderCalendar() {
  $('#cal-title').textContent = `${state.calYear}年${state.calMonth + 1}月`;
  const root = $('#calendar');
  root.innerHTML = '';

  // weekday header
  const dow = document.createElement('div');
  dow.className = 'cal-dow';
  WEEKDAYS.forEach((w, i) => {
    const c = document.createElement('div');
    c.className = 'cal-wd' + (i >= 5 ? ' weekend' : '');
    c.textContent = w; dow.appendChild(c);
  });
  root.appendChild(dow);

  const gridStart = gridStartDate();
  const todayStr = ymd(new Date());
  const present = new Set();

  // weekly 5★/Mega rotation bosses → one icon per track next to the day number
  // (driven by rotations.json, which carries pokemon ids; events.json raids don't).
  const raidsByDay = {};
  (state.rotations && state.rotations.tracks || [])
    .filter(t => t.key === '5star' || t.key === 'mega')
    .forEach(t => (t.segments || []).forEach(seg => {
      const si = dayDiff(gridStart, parseDay(seg.start));
      const ei = dayDiff(gridStart, parseDay(seg.end || seg.start));
      const mons = (seg.pokemon || []).filter(p => p && (p.id || p.sprite));
      if (!mons.length || isNaN(si) || isNaN(ei) || ei < 0 || si > 41) return;
      for (let i = Math.max(0, si); i <= Math.min(41, ei); i++) {
        (raidsByDay[i] = raidsByDay[i] || []).push(
          { tier: t.key, color: t.color, tag: t.tag, mons, name: seg.cn || seg.name, start: seg.start, end: seg.end });
      }
    }));
  // only let the icons REPLACE the grid bars when we actually have icons this month
  const hasRaidIcons = Object.keys(raidsByDay).length > 0;

  // map every event into grid indices, clipped to the visible 0..41 range
  const bars = [], chipsByDay = {}, longTerm = [];
  state.events.forEach(ev => {
    if (!ev._s) return;
    const si = dayDiff(gridStart, ev._s);
    const ei = dayDiff(gridStart, ev._e);
    if (ei < 0 || si > 41) return; // outside the visible grid
    // long-running background events leave the grid for the compact band below
    if (isLongTerm(ev)) { longTerm.push(ev); return; }
    // weekly 5★/Mega bosses show as day-number icons instead — but only drop the
    // bar when we actually have those icons this month (else keep it as fallback).
    if (ev.type === 'raid-battles' && hasRaidIcons) return;
    const cat = catOf(ev);
    present.add(ev.type);
    if (cat.kind === 'chip') {
      for (let i = Math.max(0, si); i <= Math.min(41, ei); i++) {
        (chipsByDay[i] = chipsByDay[i] || []).push({ ev, cat });
      }
    } else {
      bars.push({ ev, cat, si: Math.max(0, si), ei: Math.min(41, ei), realStart: si, realEnd: ei });
    }
  });

  // lane-pack bars: anchor longer events first so they settle into low lanes
  bars.sort((a, b) => a.si - b.si || (b.ei - b.si) - (a.ei - a.si));
  packLanes(bars);

  const weeks = document.createElement('div');
  weeks.className = 'cal-weeks';

  for (let r = 0; r < 6; r++) {
    const rs = r * 7, re = rs + 6;
    // skip a trailing week that is entirely in another month
    const startMon = addDays(gridStart, rs).getMonth();
    const endMon = addDays(gridStart, re).getMonth();
    if (r >= 4 && startMon !== state.calMonth && endMon !== state.calMonth) continue;

    const week = document.createElement('div');
    week.className = 'cal-week';

    // how many lanes does this row need? → reserve that much vertical space
    let maxLane = -1;
    bars.forEach(b => { if (!(b.ei < rs || b.si > re)) maxLane = Math.max(maxLane, b.lane); });
    const barsH = (maxLane + 1) * LANE_H;
    week.style.setProperty('--bars-h', barsH + 'px');

    for (let c = 0; c < 7; c++) {
      const idx = rs + c;
      const date = addDays(gridStart, idx);
      const inMonth = date.getMonth() === state.calMonth;
      const cell = document.createElement('div');
      cell.className = 'cal-day'
        + (inMonth ? '' : ' out')
        + (c >= 5 ? ' weekend' : '')
        + (ymd(date) === todayStr ? ' today' : '');

      const num = document.createElement('div');
      num.className = 'cal-daynum';
      const moy = date.getDate() === 1 ? `<span class="moy">${date.getMonth() + 1}月</span>` : '';
      num.innerHTML = `<span class="dn">${date.getDate()}</span>${moy}`;
      // weekly raid icons (one per track; cycles if the segment has >1 boss)
      const raids = inMonth ? (raidsByDay[idx] || []) : [];
      if (raids.length) {
        const rbox = document.createElement('div');
        rbox.className = 'daynum-raids';
        raids.forEach(rd => {
          const mons = rd.mons.slice(0, 3);
          const b = document.createElement('button');
          b.className = 'raid-ico ' + (rd.tier === '5star' ? 's5' : 'mega') + (mons.length > 1 ? ' slide n' + mons.length : '');
          if (rd.color) b.style.setProperty('--ring', rd.color);
          const badge = (rd.tag || (rd.tier === '5star' ? '5★' : 'M')).slice(0, 2);
          b.title = `${rd.name} · ${fmtDateShort(rd.start)}–${fmtDateShort(rd.end)}`;
          b.innerHTML = mons.map(p => `<img src="${escapeHtml(monSprite(p))}" alt="" loading="lazy" onerror="this.style.display='none'">`).join('')
            + `<span class="tg">${escapeHtml(badge)}</span>`;
          b.addEventListener('click', () => openDetail(
            findRaidEvent(rd) || {
              name: rd.name, heading: '团战 Boss', type: 'raid-battles',
              start: rd.start, end: rd.end, pokemon: rd.mons
            }));
          rbox.appendChild(b);
        });
        num.appendChild(rbox);
      }
      cell.appendChild(num);

      const spacer = document.createElement('div');
      spacer.className = 'cal-barspace';
      cell.appendChild(spacer);

      // day chips (point events), with overflow collapse
      const list = (chipsByDay[idx] || []);
      if (inMonth && list.length) {
        const cw = document.createElement('div');
        cw.className = 'cal-chips';
        list.slice(0, 3).forEach(({ ev, cat }) => {
          const sp = firstSprite(ev);
          const chip = document.createElement('button');
          chip.className = 'cal-chip' + (ev._featured ? ' ft' : '') + (ev.highlight ? ' hl' : '');
          chip.style.setProperty('--c', cat.color);
          chip.title = `${ev.name} · ${fmtRange(ev.start, ev.end)}`;
          chip.innerHTML = `<i class="dot"></i>${sp ? `<img class="spr" src="${escapeHtml(sp)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}`
            + (ev.highlight ? '<span class="hl-star">✨</span>' : '')
            + `<span class="cn">${escapeHtml(ev.name)}</span>`;
          chip.addEventListener('click', () => openDetail(ev));
          cw.appendChild(chip);
        });
        if (list.length > 3) {
          const more = document.createElement('div');
          more.className = 'cal-more'; more.textContent = `+${list.length - 3}`;
          cw.appendChild(more);
        }
        cell.appendChild(cw);
      }
      week.appendChild(cell);
    }

    // spanning bar overlay for this row
    const layer = document.createElement('div');
    layer.className = 'cal-barlayer';
    bars.forEach(b => {
      if (b.ei < rs || b.si > re) return;
      const segS = Math.max(b.si, rs), segE = Math.min(b.ei, re);
      const leftCol = segS - rs, span = segE - segS + 1;
      const isL = b.realStart === segS, isR = b.realEnd === segE;
      const featured = b.ev._featured;
      const quiet = !featured && !b.ev.highlight && !b.cat.bg;
      const bar = document.createElement('button');
      bar.className = 'cal-bar' + (isL ? ' l' : '') + (isR ? ' r' : '') + (b.cat.bg ? ' bg' : '')
        + (featured ? ' ft' : '') + (b.ev.highlight ? ' hl' : '') + (quiet ? ' q' : '') + (isL ? '' : ' cont');
      bar.style.left = `calc(${leftCol / 7 * 100}% + 3px)`;
      bar.style.width = `calc(${span / 7 * 100}% - 6px)`;
      bar.style.top = (NUM_H + b.lane * LANE_H) + 'px';
      if (quiet) {
        bar.style.setProperty('--c', b.cat.color);   // .q renders tint + left strip from --c
      } else {
        bar.style.background = b.cat.color;
        bar.style.color = b.cat.fg;
      }
      const sp = isL && !b.cat.bg ? firstSprite(b.ev) : '';
      bar.title = `${b.ev.name} · ${fmtRange(b.ev.start, b.ev.end)}`;
      bar.innerHTML = (sp ? `<img class="spr" src="${escapeHtml(sp)}" alt="" loading="lazy" onerror="this.style.display='none'">` : '')
        + (isL && b.ev.highlight ? '<span class="hl-star">✨</span>' : '')
        + `<span class="bn">${escapeHtml(b.ev.name)}</span>`;
      bar.addEventListener('click', () => openDetail(b.ev));
      layer.appendChild(bar);
    });
    week.appendChild(layer);
    weeks.appendChild(week);
  }

  root.appendChild(weeks);
  renderLegend(present, hasRaidIcons);
  renderLongTerm(longTerm);
}

// Legend reflects only the categories actually present in the current month.
function renderLegend(present, hasRaids) {
  const box = $('#cal-legend');
  if (!box) return;
  const seen = new Set();
  const items = [];
  present.forEach(type => {
    const cat = catOf({ type });
    const key = cat.label + cat.color;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(cat);
  });
  items.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'bar' ? -1 : 1));
  let html = items.map(c =>
    `<span class="lg"><i class="${c.kind === 'chip' ? 'round' : ''}" style="background:${escapeHtml(c.color)}"></i>${escapeHtml(c.label)}</span>`
  ).join('');
  if (hasRaids) {
    html += '<span class="lg"><i class="ring s5"></i>5★ 团战</span><span class="lg"><i class="ring mega"></i>超级团战</span>';
  }
  box.innerHTML = html || '';
}

// Compact band of long-running events (season / pass / league / multi-week),
// shown under the grid so the day cells stay focused on headline events.
function renderLongTerm(list) {
  const box = $('#long-term');
  if (!box) return;
  if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = '<span class="lt-title">长期活动</span>';
  list.slice().sort((a, b) => a._s - b._s).forEach(ev => {
    const cat = catOf(ev);
    const sp = firstSprite(ev);
    const pill = document.createElement('button');
    pill.className = 'lt-pill';
    pill.style.setProperty('--c', cat.color);
    pill.title = `${ev.name} · ${fmtRange(ev.start, ev.end)}`;
    pill.innerHTML = (sp ? `<img class="spr" src="${escapeHtml(sp)}" alt="" loading="lazy" onerror="this.style.display='none'">` : '')
      + `<span class="lt-name">${escapeHtml(ev.name)}</span>`
      + `<span class="lt-range">${escapeHtml(fmtDateShort(ev.start))}–${escapeHtml(fmtDateShort(ev.end))}</span>`;
    pill.addEventListener('click', () => openDetail(ev));
    box.appendChild(pill);
  });
}

// Weekly rotation tracks (5★ / Mega / Max) for the current month, from
// data/rotations.json. Stacked card-per-track list — readable at any width.
function renderRotations() {
  const box = $('#rotations'); if (!box) return;
  const note = $('#rot-note');
  const data = state.rotations;
  const tracks = (data && Array.isArray(data.tracks)) ? data.tracks : [];
  if (note) note.textContent = (data && data.note) ? data.note : '';
  box.innerHTML = '';
  if (!tracks.length) {
    box.innerHTML = '<p class="muted">本月轮换将在每日更新后显示。</p>';
    return;
  }
  tracks.forEach(tr => {
    const color = tr.color || '#b08a44';
    const card = document.createElement('div');
    card.className = 'rot-track';
    const head = document.createElement('div');
    head.className = 'rot-track-head';
    head.innerHTML = `<i style="background:${escapeHtml(color)}"></i><span>${escapeHtml(tr.label || '')}</span>`;
    card.appendChild(head);
    (tr.segments || []).forEach(seg => {
      const row = document.createElement('div');
      row.className = 'rot-seg';
      row.style.setProperty('--c', color);
      const mons = (seg.pokemon || []).map(p => {
        const sp = monSprite(p);
        if (!sp) return '';
        return linkSprite(`<img class="spr" src="${escapeHtml(sp)}" alt="${escapeHtml(p.name || '')}" loading="lazy" onerror="this.style.display='none'">`, p);
      }).join('');
      const range = (seg.start || seg.end)
        ? `<span class="rot-range">${escapeHtml(fmtDateShort(seg.start))}${seg.end && seg.end !== seg.start ? '–' + escapeHtml(fmtDateShort(seg.end)) : ''}</span>`
        : '';
      row.innerHTML = `${mons}<span class="rot-name">${escapeHtml(seg.cn || seg.name || '')}</span>${range}`;
      card.appendChild(row);
    });
    box.appendChild(card);
  });
}

/* Inline resource icons. Tokens map to the actual asset filenames in
 * public/assets/icons/ (mixed .png/.webp, some capitalised/spaced). Unknown
 * tokens fall back to <token>.png so new clean-named icons work without editing
 * this map. Missing files hide gracefully; size is locked by CSS (.ico/.ico-lg). */
const ICONS = {
  // Pokémon types
  normal:'normal.webp',
  bug:'bug.png', dark:'dark.webp', dragon:'dragon.png', electric:'electric.webp',
  fairy:'fairy.webp', fighting:'fighting.png', fire:'fire.png', flying:'flying.png',
  ghost:'ghost.webp', grass:'grass.webp', ground:'ground.webp', ice:'ice.webp',
  poison:'poison.webp', psychic:'psychic.webp', rock:'rock.webp', steel:'steel.webp', water:'water.webp',
  // items / activities
  candy:'candy.png', 'xl-candy':'xl-candy.png', 'rare-candy':'rare-candy.png',
  stardust:'stardust.png', xp:'xp.png', lure:'lure.png', incense:'incense.png',
  incubator:'incubators.png', 'golden-razz':'golden-razz-berry.png', 'silver-berry':'silver_berry.webp',
  pokeball:'poke-ball.png', pokestop:'pokestop.png', raid:'Raid.png', spawn:'Reward%20spawn.png',
  rocket:'teamrocket_r.png', trading:'trading.png',
};
// Replace :name: tokens with a local icon. Text is escaped first, so tokens are
// the only markup injected (and the token charset is constrained → safe).
function iconify(s) {
  return escapeHtml(s).replace(/:([a-z0-9_-]{1,24}):/g, (m, n) =>
    `<img class="ico" src="assets/icons/${ICONS[n] || (n + '.png')}" alt="" onerror="this.style.display='none'">`);
}
function openDetail(ev) {
  const cat = catOf(ev);
  const mons = (ev.pokemon || []).map(p => {
    const img = `<img class="mon-icon" src="${escapeHtml(monSprite(p))}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.style.visibility='hidden'">`;
    return `<figure class="mon">${linkSprite(img, p)}${p.shiny ? '<span class="shiny">✨</span>' : ''}<figcaption>${escapeHtml(p.name)}</figcaption></figure>`;
  }).join('');
  const bonuses = (ev.bonuses || []).map(b => `<li>${iconify(b)}</li>`).join('');
  // Best counters → collapsible, sprite + recommended moves.
  const counters = (ev.counters || []).filter(c => c && (c.id || c.name || c.sprite)).map(c => {
    const moves = [c.fast, c.charged].filter(Boolean).map(escapeHtml).join(' / ');
    const csp = monSprite(c);
    const cimg = csp ? `<img class="spr" src="${escapeHtml(csp)}" alt="${escapeHtml(c.name || '')}" loading="lazy" onerror="this.style.display='none'">` : '';
    return `<div class="ctr-row">`
      + (cimg ? linkSprite(cimg, c) : '')
      + `<div><strong>${escapeHtml(c.name || '')}</strong>${moves ? `<div class="ctr-moves">${moves}</div>` : ''}</div></div>`;
  }).join('');
  // Generic extra sections (paid/ticketed options, special research, …) → collapsible.
  const sections = (ev.sections || []).filter(s => s && s.title).map(s => {
    const items = (s.items || []).map(it => `<li>${iconify(it)}</li>`).join('');
    const body = items ? `<ul>${items}</ul>` : (s.body ? `<p>${iconify(s.body)}</p>` : '');
    return `<details><summary>${escapeHtml(s.title)}</summary><div class="det-body">${body}</div></details>`;
  }).join('');
  // Prefer the aggregated multi-source links[]; fall back to the legacy single link.
  const linkList = (ev.links && ev.links.length) ? ev.links
    : (ev.link ? [{ label: '活动页', url: ev.link }] : []);
  const links = linkList
    .filter(l => l && l.url)
    .map((l, i) => `<a class="btn ${i === 0 ? 'btn-primary' : ''}" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label || '链接')} ↗</a>`)
    .join('');
  $('#detail-body').innerHTML = `
    <span class="detail-cat" style="--c:${cat.color}">${escapeHtml(cat.label)}</span>
    ${ev.image ? `<img class="detail-img" src="${escapeHtml(ev.image)}" alt="">` : ''}
    <h3>${escapeHtml(ev.name)}</h3>
    <p class="muted">${escapeHtml(ev.heading || ev.type || '')} · ${escapeHtml(fmtRange(ev.start, ev.end))}</p>
    ${ev.summary ? `<p class="detail-summary">${escapeHtml(ev.summary)}</p>` : ''}
    ${mons ? `<div class="mon-row">${mons}</div>` : ''}
    ${bonuses ? `<h4>加成</h4><ul>${bonuses}</ul>` : ''}
    ${counters ? `<details><summary>团战 Counter</summary><div class="det-body">${counters}</div></details>` : ''}
    ${sections}
    ${links ? `<div class="detail-links">${links}</div>` : ''}
  `;
  $('#event-detail').hidden = false;
  linkifySprites($('#detail-body'));
}

/* ---------- world clock (time-band country filter) ----------------------------
 * Owner feature (not the daily content agent's): pick a local-hour window and
 * list every country/region currently inside it, grouped by UTC offset. All time
 * math is done live in the browser via Intl + IANA zone ids (DST handled for us),
 * so the static table only carries display data. Offsets are NEVER hard-coded.
 *   row = [国家, 城市/时区标注, ISO2(flagcdn), IANA zone, lock?]
 *   lock: 1 = 锁区 (Niantic suspended play) · 2 = 部分可玩 (partially playable)
 * Multi-zone countries list each OFFICIAL zone (e.g. US ×7); single-tz countries
 * (China = UTC+8 only) list once. Zone ids are validated against Node ICU before
 * shipping; flags from flagcdn.com (renders cross-platform, unlike emoji flags). */
const WC_LOCK = { 1: '锁区', 2: '部分可玩' };
const WC_NOTE = {
  cn: '中国大陆官方使用 UTC+8(北京时间)。多数内地城市为空地图,海南、东北、新疆及粤/桂部分口岸(珠海、深圳等)附近有可玩区域。',
  ru: 'Niantic 已暂停俄罗斯的游玩,社区普遍视为锁区。',
  by: '与俄罗斯同批被 Niantic 暂停游玩,社区视为锁区。',
};
const WC_WD = { Mon:'一', Tue:'二', Wed:'三', Thu:'四', Fri:'五', Sat:'六', Sun:'日' };
const WC_DATA = [
  // 覆盖 UTC+14 → −12 的全部时区(用户指定的代表地点)。同一时区可多国并列。
  ['基里巴斯','圣诞岛 Kiritimati','ki','Pacific/Kiritimati'],
  ['萨摩亚','阿皮亚','ws','Pacific/Apia'],
  ['新西兰','查塔姆群岛','nz','Pacific/Chatham'],
  ['新西兰','奥克兰 / 惠灵顿','nz','Pacific/Auckland'],
  ['新喀里多尼亚','努美阿','nc','Pacific/Noumea'],
  ['澳大利亚','豪勋爵岛','au','Australia/Lord_Howe'],
  ['澳大利亚','悉尼','au','Australia/Sydney'],
  ['澳大利亚','达尔文','au','Australia/Darwin'],
  ['日本','东京 / 千叶','jp','Asia/Tokyo'],
  ['澳大利亚','Eucla','au','Australia/Eucla'],
  ['台湾','新北','tw','Asia/Taipei'],
  ['马来西亚','吉隆坡','my','Asia/Kuala_Lumpur'],
  ['新加坡','新加坡','sg','Asia/Singapore'],
  ['越南','胡志明市','vn','Asia/Ho_Chi_Minh'],
  ['印度尼西亚','雅加达','id','Asia/Jakarta'],
  ['缅甸','仰光','mm','Asia/Yangon'],
  ['孟加拉国','达卡 / 吉大港','bd','Asia/Dhaka'],
  ['尼泊尔','加德满都','np','Asia/Kathmandu'],
  ['印度','孟买 / 新德里','in','Asia/Kolkata'],
  ['马尔代夫','马累','mv','Indian/Maldives'],
  ['阿富汗','喀布尔','af','Asia/Kabul'],
  ['阿联酋','迪拜 / 阿布扎比','ae','Asia/Dubai'],
  ['伊朗','德黑兰','ir','Asia/Tehran'],
  ['土耳其','伊斯坦布尔','tr','Europe/Istanbul'],
  ['以色列','耶路撒冷','il','Asia/Jerusalem'],
  ['希腊','雅典','gr','Europe/Athens'],
  ['西班牙','萨拉戈萨','es','Europe/Madrid'],
  ['匈牙利','布达佩斯','hu','Europe/Budapest'],
  ['法国','巴黎','fr','Europe/Paris'],
  ['英国','伦敦','gb','Europe/London'],
  ['西班牙','加那利群岛','es','Atlantic/Canary'],
  ['冰岛','雷克雅未克','is','Atlantic/Reykjavik'],
  ['佛得角','普拉亚','cv','Atlantic/Cape_Verde'],
  ['巴西','费尔南多·迪诺罗尼亚群岛','br','America/Noronha'],
  ['加拿大','圣约翰斯(纽芬兰)','ca','America/St_Johns'],
  ['巴西','圣保罗','br','America/Sao_Paulo'],
  ['阿根廷','布宜诺斯艾利斯','ar','America/Argentina/Buenos_Aires'],
  ['美国','纽约','us','America/New_York'],
  ['加拿大','蒙特利尔','ca','America/Toronto'],
  ['多米尼加','圣多明各','do','America/Santo_Domingo'],
  ['美国','芝加哥 / 休斯敦','us','America/Chicago'],
  ['墨西哥','墨西哥城','mx','America/Mexico_City'],
  ['美国','丹佛 / 新墨西哥','us','America/Denver'],
  ['美国','旧金山','us','America/Los_Angeles'],
  ['加拿大','温哥华','ca','America/Vancouver'],
  ['美国','安克雷奇(阿拉斯加)','us','America/Anchorage'],
  ['法属波利尼西亚','甘比尔群岛','pf','Pacific/Gambier'],
  ['法属波利尼西亚','马克萨斯群岛','pf','Pacific/Marquesas'],
  ['美国','檀香山(夏威夷)','us','Pacific/Honolulu'],
  ['美属萨摩亚','帕果帕果','as','Pacific/Pago_Pago'],
  ['美国本土外小岛','贝克 / 豪兰岛','us','Etc/GMT+12'],
];

// 精选地点(社区常用 PoGo 热点)。[名称, 国家·城市, ISO2, IANA时区, 备注, 纬度, 经度]
// 时间一律实时计算;坐标可点击跳转地图。highlight = 选中时段时此刻当地处于该时段。
const WC_SPOTS = [
  ['Wellington 植物园 / Auckland','新西兰 · 惠灵顿/奥克兰','nz','Pacific/Auckland','最早时区起点;活动 / raid 开局', -41.2806, 174.7676],
  ['Sydney 悉尼歌剧院一带','澳大利亚 · 悉尼','au','Australia/Sydney','早时区 raid / 活动候选', -33.8568, 151.2153],
  ['Shibuya / Shinjuku 涩谷新宿','日本 · 东京','jp','Asia/Tokyo','主热点;Go Fest / raid / city play 常用', 35.6595, 139.7005],
  ['台北车站 Taipei Main Station','台湾 · 台北','tw','Asia/Taipei','raid-only 老热点;现强度有争议', 25.0478, 121.5173],
  ['Dubai Marina 迪拜码头','阿联酋 · 迪拜','ae','Asia/Dubai','catch event 强,主要靠 lures', 25.0805, 55.1403],
  ['Plaza de Europa','西班牙 · 萨拉戈萨','es','Europe/Madrid','spawn density 高', 41.6488, -0.8891],
  ['Margaret Island 玛格丽特岛','匈牙利 · 布达佩斯','hu','Europe/Budapest','有人觉得比 Zara 好,证据较弱', 47.5278, 19.0506],
  ['Ibirapuera Park 伊比拉普埃拉公园','巴西 · 圣保罗','br','America/Sao_Paulo','stops + 重 lures;活动日 catch 强', -23.5874, -46.6576],
  ['Bryant Park / Central Park','美国 · 纽约','us','America/New_York','spawn + lure + raid 强(NYC)', 40.7536, -73.9832],
  ['Havana 随机坐标','古巴 · 哈瓦那','cu','America/Havana','Go Fest 末尾随机坐标,不算稳定热点', 23.1136, -82.3666],
  ['Lincoln Park','美国 · 芝加哥','us','America/Chicago','Go Fest / city play;非自然 density', 41.9214, -87.6513],
  ['Calle República de El Salvador 21','墨西哥 · 墨西哥城 CDMX','mx','America/Mexico_City','疑似社区热点;stops / gyms 密集', 19.4316, -99.1336],
  ['PIER 39 / Santa Monica Pier','美国 · 旧金山 / 洛杉矶','us','America/Los_Angeles','传统 pier 热点;评价分裂', 37.8087, -122.4098],
  ['Honolulu / Waikiki','美国 · 夏威夷檀香山','us','Pacific/Honolulu','最后尾巴时区', 21.2793, -157.8294],
];

let wcActive = false; // false = 显示全部(最早→最晚);true = 按所选时段筛选

const wcPad = n => String(n).padStart(2, '0');
// One Intl read per zone → current offset (minutes), local h:m, weekday, day-shift.
function wcCompute(zone, now) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now)) if (x.type !== 'literal') p[x.type] = x.value;
  const h = (+p.hour) % 24;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, h, +p.minute, +p.second);
  const offset = Math.round((asUTC - now.getTime()) / 60000);
  const dayDelta = Math.round(
    (Date.UTC(+p.year, +p.month - 1, +p.day) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  return { offset, h, m: +p.minute, wd: p.weekday, dayDelta };
}
function wcFmtOffset(min) {
  const sign = min < 0 ? '-' : '+', a = Math.abs(min);
  const h = Math.floor(a / 60), m = a % 60;
  return 'UTC' + sign + h + (m ? ':' + wcPad(m) : '');
}
// Inclusive on both ends, hour granularity; wraps past midnight when start > end.
function wcInRange(h, start, end) {
  if (start === end) return h === start;
  return start < end ? (h >= start && h <= end) : (h >= start || h <= end);
}
// 本机当前时间 + 浏览器检测到的时区。随 renderWorldClock 的分钟 tick 一起刷新。
function renderWcNow(now) {
  const el = $('#wc-now'); if (!el) return;
  let zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  const wd = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  el.innerHTML = `<span class="wc-now-label muted">你的当地时间</span>`
    + `<span class="wc-now-time">${wcPad(now.getHours())}:${wcPad(now.getMinutes())}</span>`
    + `<span class="wc-now-wd muted">周${wd}</span>`
    + `<span class="wc-off">${wcFmtOffset(-now.getTimezoneOffset())}</span>`
    + (zone ? `<span class="wc-now-zone muted">${escapeHtml(zone)}</span>` : '');
}
function renderWorldClock() {
  const startSel = $('#wc-start'), endSel = $('#wc-end'), box = $('#wc-results');
  if (!startSel || !endSel || !box) return;
  const start = +startSel.value, end = +endSel.value, now = new Date();
  renderWcNow(now);
  // ----- 国家列表:按当前 UTC 偏移分组;不选时段=全部,选了则筛选;最早→最晚 -----
  const groups = new Map();
  WC_DATA.forEach(t => {
    let c; try { c = wcCompute(t[3], now); } catch (e) { return; }
    if (wcActive && !wcInRange(c.h, start, end)) return;
    if (!groups.has(c.offset)) groups.set(c.offset, { off: c.offset, s: c, items: [] });
    groups.get(c.offset).items.push({ country: t[0], city: t[1], cc: t[2], lock: t[4] || 0 });
  });
  const arr = [...groups.values()].sort((a, b) => b.off - a.off); // 最早(高偏移)→ 最晚
  const total = arr.reduce((n, g) => n + g.items.length, 0);
  const sum = $('#wc-summary');
  if (sum) sum.textContent = wcActive
    ? `当地 ${wcPad(start)}:00–${wcPad(end)}:59 · 命中 ${arr.length} 个时区 / ${total} 个地区`
    : `全部时段 · ${arr.length} 个时区(最早 → 最晚)`;
  box.innerHTML = arr.length ? arr.map(g => {
    const dd = g.s.dayDelta > 0 ? ' <span class="wc-dd">次日</span>' : (g.s.dayDelta < 0 ? ' <span class="wc-dd">昨日</span>' : '');
    const items = g.items.slice().sort((a, b) => a.country.localeCompare(b.country, 'zh-Hans')).map(it => {
      const note = WC_NOTE[it.cc] ? ` title="${escapeHtml(WC_NOTE[it.cc])}"` : '';
      const badge = it.lock ? `<span class="wc-lock l${it.lock}">${WC_LOCK[it.lock]}</span>` : '';
      return `<div class="wc-item${it.lock ? ' locked' : ''}"${note}>`
        + `<img class="wc-flag" src="https://flagcdn.com/w40/${it.cc}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
        + `<div class="wc-meta"><span class="wc-country">${escapeHtml(it.country)}</span>`
        + `<span class="wc-city">${escapeHtml(it.city)}</span></div>${badge}</div>`;
    }).join('');
    return `<div class="wc-group"><div class="wc-group-head">`
      + `<span class="wc-time">${wcPad(g.s.h)}:${wcPad(g.s.m)}</span>`
      + `<span class="wc-off">${wcFmtOffset(g.off)}</span>`
      + `<span class="wc-wd muted">周${WC_WD[g.s.wd] || ''}${dd}</span>`
      + `<span class="wc-count muted">${g.items.length}</span></div>`
      + `<div class="wc-list">${items}</div></div>`;
  }).join('') : '<p class="muted" style="padding:1rem;text-align:center">该时段暂无匹配的地区。</p>';
  renderWcSpots(start, end, now);
}
// 把"所选时段(以该精选地点的当地时间计)"换算成当前用户的本地时间窗口。用户时区取自
// 浏览器;无法判断时回退到中国时间(UTC+8)。返回 "HH:MM–HH:MM"。
function wcUserWindow(spotOffset, start, end) {
  let uo = -new Date().getTimezoneOffset() / 60;   // 用户 UTC 偏移(小时)
  if (!isFinite(uo)) uo = 8;
  const so = spotOffset / 60;                       // 地点 UTC 偏移(c.offset 是分钟 → 小时)
  const fmt = h => {
    let mins = Math.round((h - so + uo) * 60);
    mins = ((mins % 1440) + 1440) % 1440;
    return wcPad(Math.floor(mins / 60)) + ':' + wcPad(mins % 60);
  };
  return fmt(start) + '–' + fmt(end);
}
// 精选地点侧栏:始终列出(最早→最晚),实时显示当地时间 + 坐标;选中时段则高亮命中者。
function renderWcSpots(start, end, now) {
  const box = $('#wc-spots'); if (!box) return;
  const rows = WC_SPOTS.map(s => {
    let c; try { c = wcCompute(s[3], now); } catch (e) { c = null; }
    return { s, c };
  }).filter(x => x.c).sort((a, b) => b.c.offset - a.c.offset);
  box.innerHTML = '<div class="wc-spots-head"><span class="dia">◆</span><h3>精选地点</h3></div>'
    + rows.map(({ s, c }) => {
      const hot = wcActive && wcInRange(c.h, start, end);
      const dd = c.dayDelta > 0 ? ' 次日' : (c.dayDelta < 0 ? ' 昨日' : '');
      const geo = `${s[5].toFixed(4)}, ${s[6].toFixed(4)}`;
      return `<div class="wc-spot${hot ? ' hot' : ''}${wcActive && !hot ? ' dim' : ''}">`
        + `<div class="wc-spot-top">`
        + `<img class="wc-flag" src="https://flagcdn.com/w40/${s[2]}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
        + `<span class="wc-spot-time">${wcPad(c.h)}:${wcPad(c.m)}</span>`
        + `<span class="wc-off">${wcFmtOffset(c.offset)}</span>`
        + `<span class="wc-spot-wd muted">周${WC_WD[c.wd] || ''}${dd}</span></div>`
        + `<div class="wc-spot-name">${escapeHtml(s[0])}</div>`
        + `<div class="wc-spot-sub muted">${escapeHtml(s[1])} · ${escapeHtml(s[3])}</div>`
        + `<div class="wc-spot-note muted">${escapeHtml(s[4])}</div>`
        + `<div class="wc-spot-foot"><a class="wc-spot-geo" href="https://www.google.com/maps?q=${s[5]},${s[6]}" target="_blank" rel="noopener">📍 ${geo}</a>`
        + (wcActive ? `<span class="wc-spot-you muted" title="你的当地时间(该地点处于所选时段时)"><span class="dia">✦</span> ${wcUserWindow(c.offset, start, end)}</span>` : '')
        + `</div></div>`;
    }).join('');
}
function setupWorldClock() {
  const startSel = $('#wc-start'), endSel = $('#wc-end'), allBtn = $('#wc-all');
  if (!startSel || !endSel) return;
  let opts = '';
  for (let i = 0; i < 24; i++) opts += `<option value="${i}">${wcPad(i)}:00</option>`;
  startSel.innerHTML = opts; endSel.innerHTML = opts;
  // restore last choice (range + mode) from localStorage; fall back to the 4–7 example
  let savedWc = {}; try { savedWc = JSON.parse(localStorage.getItem('wc-range') || '{}'); } catch (e) {}
  startSel.value = String(savedWc.start != null ? savedWc.start : 4);
  endSel.value = String(savedWc.end != null ? savedWc.end : 7);
  const saveWc = () => { try { localStorage.setItem('wc-range', JSON.stringify({ mode: wcActive ? 'range' : 'all', start: +startSel.value, end: +endSel.value })); } catch (e) {} };
  const dimWc = () => [startSel, endSel].forEach(s => s.classList.toggle('wc-off-dim', !wcActive));
  const activate = () => { wcActive = true; if (allBtn) allBtn.classList.remove('active'); dimWc(); saveWc(); renderWorldClock(); };
  startSel.addEventListener('change', activate);
  endSel.addEventListener('change', activate);
  if (allBtn) allBtn.addEventListener('click', () => { wcActive = false; allBtn.classList.add('active'); dimWc(); saveWc(); renderWorldClock(); });
  wcActive = (savedWc.mode === 'range'); // restore mode (default = 全部时段)
  if (allBtn) allBtn.classList.toggle('active', !wcActive);
  dimWc();
  renderWorldClock();
  // tick so times/groups shift as the minute rolls — only while the clock view is open
  setInterval(() => {
    const v = $('#view-clock');
    if (v && v.classList.contains('active')) renderWorldClock();
  }, 30000);
}

/* ---------- wiring ---------- */
function setupTabs() {
  $('#main-tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#main-tabs button').forEach(x => x.classList.toggle('active', x === b));
    const v = b.dataset.view;
    document.querySelectorAll('.view').forEach(s => s.classList.toggle('active', s.id === `view-${v}`));
  });
  $('#rank-subtabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#rank-subtabs button').forEach(x => x.classList.toggle('active', x === b));
    const r = b.dataset.rank;
    document.querySelectorAll('.rank-panel').forEach(p => p.classList.toggle('active', p.dataset.rankPanel === r));
  });
}
function setupCalNav() {
  const now = new Date();
  state.calYear = now.getFullYear();
  state.calMonth = now.getMonth();
  $('#cal-prev').addEventListener('click', () => { shiftMonth(-1); });
  $('#cal-next').addEventListener('click', () => { shiftMonth(1); });
  $('#cal-today').addEventListener('click', () => { const t = new Date(); state.calYear = t.getFullYear(); state.calMonth = t.getMonth(); renderCalendar(); });
}
function shiftMonth(delta) {
  let m = state.calMonth + delta, y = state.calYear;
  if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
  state.calMonth = m; state.calYear = y; renderCalendar();
}
function setupDetail() {
  const panel = $('#event-detail');
  const close = () => { panel.hidden = true; };
  $('#detail-close').addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.addEventListener('mousedown', e => { if (!panel.hidden && !panel.contains(e.target)) close(); });
}

async function init() {
  setupTabs();
  setupCalNav();
  setupDetail();
  setupWorldClock();
  await loadData();
  renderCalendar();
  renderRotations();
  // make the static ranking-panel sprites clickable → Pokémon GO Hub DB
  // auto-link every Pokémon sprite the agent renders (rankings, rotations,
  // free-form notes, …) → hub. Calendar grid + 长期 band are excluded inside
  // linkifySprites (their icons open the in-page drawer instead).
  linkifySprites(document.body);
}

document.addEventListener('DOMContentLoaded', init);
