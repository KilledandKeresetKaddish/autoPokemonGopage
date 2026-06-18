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
    const startMon = new Date(gridStart.getTime() + rs * 86400000).getMonth();
    const endMon = new Date(gridStart.getTime() + re * 86400000).getMonth();
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
      const date = new Date(gridStart.getTime() + idx * 86400000);
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
          chip.className = 'cal-chip' + (ev.highlight ? ' hl' : '');
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
      const quiet = !b.ev.highlight && !b.cat.bg;   // two-tier weight: solid only for highlight/bands
      const bar = document.createElement('button');
      bar.className = 'cal-bar' + (isL ? ' l' : '') + (isR ? ' r' : '') + (b.cat.bg ? ' bg' : '')
        + (b.ev.highlight ? ' hl' : '') + (quiet ? ' q' : '') + (isL ? '' : ' cont');
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
    `<span class="lg"><i class="${c.kind === 'chip' ? 'round' : ''}" style="background:${c.color}"></i>${escapeHtml(c.label)}</span>`
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
        return sp ? `<img class="spr" src="${escapeHtml(sp)}" alt="" loading="lazy" onerror="this.style.display='none'">` : '';
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
  const mons = (ev.pokemon || []).map(p =>
    `<figure class="mon"><img class="mon-icon" src="${escapeHtml(monSprite(p))}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.style.visibility='hidden'">${p.shiny ? '<span class="shiny">✨</span>' : ''}<figcaption>${escapeHtml(p.name)}</figcaption></figure>`
  ).join('');
  const bonuses = (ev.bonuses || []).map(b => `<li>${iconify(b)}</li>`).join('');
  // Best counters → collapsible, sprite + recommended moves.
  const counters = (ev.counters || []).filter(c => c && (c.id || c.name || c.sprite)).map(c => {
    const moves = [c.fast, c.charged].filter(Boolean).map(escapeHtml).join(' / ');
    const csp = monSprite(c);
    return `<div class="ctr-row">`
      + (csp ? `<img class="spr" src="${escapeHtml(csp)}" alt="" loading="lazy" onerror="this.style.display='none'">` : '')
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
  // ── 东亚 / 东南亚 ──
  ['日本','东京','jp','Asia/Tokyo'],
  ['韩国','首尔','kr','Asia/Seoul'],
  ['朝鲜','平壤','kp','Asia/Pyongyang'],
  ['中国','北京','cn','Asia/Shanghai',2],
  ['蒙古','乌兰巴托','mn','Asia/Ulaanbaatar'],
  ['新加坡','新加坡','sg','Asia/Singapore'],
  ['马来西亚','吉隆坡','my','Asia/Kuala_Lumpur'],
  ['文莱','斯里巴加湾市','bn','Asia/Kuching'],
  ['菲律宾','马尼拉','ph','Asia/Manila'],
  ['泰国','曼谷','th','Asia/Bangkok'],
  ['越南','河内','vn','Asia/Ho_Chi_Minh'],
  ['柬埔寨','金边','kh','Asia/Bangkok'],
  ['老挝','万象','la','Asia/Bangkok'],
  ['缅甸','仰光','mm','Asia/Yangon'],
  ['东帝汶','帝力','tl','Asia/Dili'],
  // ── 南亚 / 中亚 ──
  ['印度','新德里','in','Asia/Kolkata'],
  ['斯里兰卡','科伦坡','lk','Asia/Colombo'],
  ['尼泊尔','加德满都','np','Asia/Kathmandu'],
  ['不丹','廷布','bt','Asia/Thimphu'],
  ['孟加拉国','达卡','bd','Asia/Dhaka'],
  ['巴基斯坦','伊斯兰堡','pk','Asia/Karachi'],
  ['阿富汗','喀布尔','af','Asia/Kabul'],
  ['哈萨克斯坦','阿斯塔纳','kz','Asia/Almaty'],
  ['乌兹别克斯坦','塔什干','uz','Asia/Tashkent'],
  ['吉尔吉斯斯坦','比什凯克','kg','Asia/Bishkek'],
  ['塔吉克斯坦','杜尚别','tj','Asia/Dushanbe'],
  ['土库曼斯坦','阿什哈巴德','tm','Asia/Ashgabat'],
  // ── 西亚 / 中东 ──
  ['伊朗','德黑兰','ir','Asia/Tehran'],
  ['伊拉克','巴格达','iq','Asia/Baghdad'],
  ['以色列','耶路撒冷','il','Asia/Jerusalem'],
  ['巴勒斯坦','拉马拉','ps','Asia/Hebron'],
  ['约旦','安曼','jo','Asia/Amman'],
  ['黎巴嫩','贝鲁特','lb','Asia/Beirut'],
  ['叙利亚','大马士革','sy','Asia/Damascus'],
  ['沙特阿拉伯','利雅得','sa','Asia/Riyadh'],
  ['也门','萨那','ye','Asia/Riyadh'],
  ['科威特','科威特城','kw','Asia/Riyadh'],
  ['卡塔尔','多哈','qa','Asia/Qatar'],
  ['巴林','麦纳麦','bh','Asia/Qatar'],
  ['阿联酋','迪拜','ae','Asia/Dubai'],
  ['阿曼','马斯喀特','om','Asia/Dubai'],
  ['亚美尼亚','埃里温','am','Asia/Yerevan'],
  ['阿塞拜疆','巴库','az','Asia/Baku'],
  ['格鲁吉亚','第比利斯','ge','Asia/Tbilisi'],
  ['塞浦路斯','尼科西亚','cy','Asia/Nicosia'],
  ['马尔代夫','马累','mv','Indian/Maldives'],
  // ── 欧洲 ──
  ['英国','伦敦','gb','Europe/London'],
  ['爱尔兰','都柏林','ie','Europe/Dublin'],
  ['葡萄牙','里斯本','pt','Europe/Lisbon'],
  ['葡萄牙','亚速尔群岛','pt','Atlantic/Azores'],
  ['冰岛','雷克雅未克','is','Atlantic/Reykjavik'],
  ['法国','巴黎','fr','Europe/Paris'],
  ['摩纳哥','摩纳哥','mc','Europe/Paris'],
  ['西班牙','马德里','es','Europe/Madrid'],
  ['西班牙','加那利群岛','es','Atlantic/Canary'],
  ['德国','柏林','de','Europe/Berlin'],
  ['荷兰','阿姆斯特丹','nl','Europe/Brussels'],
  ['比利时','布鲁塞尔','be','Europe/Brussels'],
  ['卢森堡','卢森堡市','lu','Europe/Brussels'],
  ['瑞士','伯尔尼','ch','Europe/Zurich'],
  ['列支敦士登','瓦杜兹','li','Europe/Zurich'],
  ['奥地利','维也纳','at','Europe/Vienna'],
  ['意大利','罗马','it','Europe/Rome'],
  ['圣马力诺','圣马力诺','sm','Europe/Rome'],
  ['梵蒂冈','梵蒂冈城','va','Europe/Rome'],
  ['马耳他','瓦莱塔','mt','Europe/Malta'],
  ['安道尔','安道尔城','ad','Europe/Andorra'],
  ['丹麦','哥本哈根','dk','Europe/Berlin'],
  ['挪威','奥斯陆','no','Europe/Berlin'],
  ['瑞典','斯德哥尔摩','se','Europe/Berlin'],
  ['波兰','华沙','pl','Europe/Warsaw'],
  ['捷克','布拉格','cz','Europe/Prague'],
  ['斯洛伐克','布拉迪斯拉发','sk','Europe/Prague'],
  ['匈牙利','布达佩斯','hu','Europe/Budapest'],
  ['斯洛文尼亚','卢布尔雅那','si','Europe/Belgrade'],
  ['克罗地亚','萨格勒布','hr','Europe/Belgrade'],
  ['波黑','萨拉热窝','ba','Europe/Belgrade'],
  ['塞尔维亚','贝尔格莱德','rs','Europe/Belgrade'],
  ['黑山','波德戈里察','me','Europe/Belgrade'],
  ['北马其顿','斯科普里','mk','Europe/Belgrade'],
  ['阿尔巴尼亚','地拉那','al','Europe/Tirane'],
  ['希腊','雅典','gr','Europe/Athens'],
  ['保加利亚','索菲亚','bg','Europe/Sofia'],
  ['罗马尼亚','布加勒斯特','ro','Europe/Bucharest'],
  ['摩尔多瓦','基希讷乌','md','Europe/Chisinau'],
  ['乌克兰','基辅','ua','Europe/Kyiv'],
  ['芬兰','赫尔辛基','fi','Europe/Helsinki'],
  ['爱沙尼亚','塔林','ee','Europe/Tallinn'],
  ['拉脱维亚','里加','lv','Europe/Riga'],
  ['立陶宛','维尔纽斯','lt','Europe/Vilnius'],
  ['白俄罗斯','明斯克','by','Europe/Minsk',1],
  ['土耳其','伊斯坦布尔','tr','Europe/Istanbul'],
  // ── 俄罗斯(11 个官方时区,均为锁区)──
  ['俄罗斯','加里宁格勒','ru','Europe/Kaliningrad',1],
  ['俄罗斯','莫斯科','ru','Europe/Moscow',1],
  ['俄罗斯','萨马拉','ru','Europe/Samara',1],
  ['俄罗斯','叶卡捷琳堡','ru','Asia/Yekaterinburg',1],
  ['俄罗斯','鄂木斯克','ru','Asia/Omsk',1],
  ['俄罗斯','克拉斯诺亚尔斯克','ru','Asia/Krasnoyarsk',1],
  ['俄罗斯','伊尔库茨克','ru','Asia/Irkutsk',1],
  ['俄罗斯','雅库茨克','ru','Asia/Yakutsk',1],
  ['俄罗斯','符拉迪沃斯托克(海参崴)','ru','Asia/Vladivostok',1],
  ['俄罗斯','马加丹','ru','Asia/Magadan',1],
  ['俄罗斯','堪察加','ru','Asia/Kamchatka',1],
  // ── 非洲 ──
  ['埃及','开罗','eg','Africa/Cairo'],
  ['利比亚','的黎波里','ly','Africa/Tripoli'],
  ['突尼斯','突尼斯市','tn','Africa/Tunis'],
  ['阿尔及利亚','阿尔及尔','dz','Africa/Algiers'],
  ['摩洛哥','拉巴特','ma','Africa/Casablanca'],
  ['苏丹','喀土穆','sd','Africa/Khartoum'],
  ['南苏丹','朱巴','ss','Africa/Juba'],
  ['尼日利亚','阿布贾','ng','Africa/Lagos'],
  ['尼日尔','尼亚美','ne','Africa/Lagos'],
  ['喀麦隆','雅温得','cm','Africa/Lagos'],
  ['乍得','恩贾梅纳','td','Africa/Ndjamena'],
  ['中非','班吉','cf','Africa/Lagos'],
  ['加蓬','利伯维尔','ga','Africa/Lagos'],
  ['刚果(布)','布拉柴维尔','cg','Africa/Lagos'],
  ['刚果(金)','金沙萨','cd','Africa/Lagos'],
  ['刚果(金)','卢本巴希','cd','Africa/Maputo'],
  ['赤道几内亚','马拉博','gq','Africa/Lagos'],
  ['安哥拉','罗安达','ao','Africa/Lagos'],
  ['贝宁','波多诺伏','bj','Africa/Lagos'],
  ['科特迪瓦','阿比让','ci','Africa/Abidjan'],
  ['加纳','阿克拉','gh','Africa/Abidjan'],
  ['布基纳法索','瓦加杜古','bf','Africa/Abidjan'],
  ['马里','巴马科','ml','Africa/Abidjan'],
  ['塞内加尔','达喀尔','sn','Africa/Abidjan'],
  ['几内亚','科纳克里','gn','Africa/Abidjan'],
  ['几内亚比绍','比绍','gw','Africa/Bissau'],
  ['冈比亚','班珠尔','gm','Africa/Abidjan'],
  ['塞拉利昂','弗里敦','sl','Africa/Abidjan'],
  ['利比里亚','蒙罗维亚','lr','Africa/Monrovia'],
  ['多哥','洛美','tg','Africa/Abidjan'],
  ['毛里塔尼亚','努瓦克肖特','mr','Africa/Abidjan'],
  ['佛得角','普拉亚','cv','Atlantic/Cape_Verde'],
  ['圣多美和普林西比','圣多美','st','Africa/Sao_Tome'],
  ['肯尼亚','内罗毕','ke','Africa/Nairobi'],
  ['坦桑尼亚','多多马','tz','Africa/Nairobi'],
  ['乌干达','坎帕拉','ug','Africa/Nairobi'],
  ['埃塞俄比亚','亚的斯亚贝巴','et','Africa/Nairobi'],
  ['厄立特里亚','阿斯马拉','er','Africa/Nairobi'],
  ['吉布提','吉布提市','dj','Africa/Nairobi'],
  ['索马里','摩加迪沙','so','Africa/Nairobi'],
  ['马达加斯加','塔那那利佛','mg','Africa/Nairobi'],
  ['科摩罗','莫罗尼','km','Africa/Nairobi'],
  ['南非','比勒陀利亚','za','Africa/Johannesburg'],
  ['莱索托','马塞卢','ls','Africa/Johannesburg'],
  ['斯威士兰','姆巴巴内','sz','Africa/Johannesburg'],
  ['莫桑比克','马普托','mz','Africa/Maputo'],
  ['赞比亚','卢萨卡','zm','Africa/Maputo'],
  ['津巴布韦','哈拉雷','zw','Africa/Maputo'],
  ['马拉维','利隆圭','mw','Africa/Maputo'],
  ['博茨瓦纳','哈博罗内','bw','Africa/Maputo'],
  ['布隆迪','基特加','bi','Africa/Maputo'],
  ['卢旺达','基加利','rw','Africa/Maputo'],
  ['纳米比亚','温得和克','na','Africa/Windhoek'],
  ['毛里求斯','路易港','mu','Indian/Mauritius'],
  ['塞舌尔','维多利亚','sc','Indian/Mahe'],
  // ── 北美 / 中美 / 加勒比 ──
  ['美国','纽约 · 东部','us','America/New_York'],
  ['美国','芝加哥 · 中部','us','America/Chicago'],
  ['美国','丹佛 · 山地','us','America/Denver'],
  ['美国','凤凰城 · 山地(无夏令时)','us','America/Phoenix'],
  ['美国','洛杉矶 · 太平洋','us','America/Los_Angeles'],
  ['美国','安克雷奇 · 阿拉斯加','us','America/Anchorage'],
  ['美国','檀香山 · 夏威夷','us','Pacific/Honolulu'],
  ['加拿大','圣约翰斯 · 纽芬兰','ca','America/St_Johns'],
  ['加拿大','哈利法克斯 · 大西洋','ca','America/Halifax'],
  ['加拿大','多伦多 · 东部','ca','America/Toronto'],
  ['加拿大','温尼伯 · 中部','ca','America/Winnipeg'],
  ['加拿大','埃德蒙顿 · 山地','ca','America/Edmonton'],
  ['加拿大','温哥华 · 太平洋','ca','America/Vancouver'],
  ['墨西哥','墨西哥城 · 中部','mx','America/Mexico_City'],
  ['墨西哥','坎昆 · 东部','mx','America/Cancun'],
  ['墨西哥','马萨特兰 · 山地','mx','America/Mazatlan'],
  ['墨西哥','蒂华纳 · 太平洋','mx','America/Tijuana'],
  ['危地马拉','危地马拉城','gt','America/Guatemala'],
  ['伯利兹','贝尔莫潘','bz','America/Belize'],
  ['萨尔瓦多','圣萨尔瓦多','sv','America/El_Salvador'],
  ['洪都拉斯','特古西加尔巴','hn','America/Tegucigalpa'],
  ['尼加拉瓜','马那瓜','ni','America/Managua'],
  ['哥斯达黎加','圣何塞','cr','America/Costa_Rica'],
  ['巴拿马','巴拿马城','pa','America/Panama'],
  ['古巴','哈瓦那','cu','America/Havana'],
  ['牙买加','金斯敦','jm','America/Jamaica'],
  ['海地','太子港','ht','America/Port-au-Prince'],
  ['多米尼加','圣多明各','do','America/Santo_Domingo'],
  ['巴哈马','拿骚','bs','America/Toronto'],
  ['巴巴多斯','布里奇敦','bb','America/Barbados'],
  ['特立尼达和多巴哥','西班牙港','tt','America/Puerto_Rico'],
  ['安提瓜和巴布达','圣约翰斯','ag','America/Puerto_Rico'],
  ['多米尼克','罗索','dm','America/Puerto_Rico'],
  ['格林纳达','圣乔治','gd','America/Puerto_Rico'],
  ['圣基茨和尼维斯','巴斯特尔','kn','America/Puerto_Rico'],
  ['圣卢西亚','卡斯特里','lc','America/Puerto_Rico'],
  ['圣文森特和格林纳丁斯','金斯敦','vc','America/Puerto_Rico'],
  // ── 南美 ──
  ['哥伦比亚','波哥大','co','America/Bogota'],
  ['委内瑞拉','加拉加斯','ve','America/Caracas'],
  ['圭亚那','乔治敦','gy','America/Guyana'],
  ['苏里南','帕拉马里博','sr','America/Paramaribo'],
  ['厄瓜多尔','基多','ec','America/Guayaquil'],
  ['厄瓜多尔','加拉帕戈斯群岛','ec','Pacific/Galapagos'],
  ['秘鲁','利马','pe','America/Lima'],
  ['玻利维亚','拉巴斯','bo','America/La_Paz'],
  ['巴拉圭','亚松森','py','America/Asuncion'],
  ['乌拉圭','蒙得维的亚','uy','America/Montevideo'],
  ['阿根廷','布宜诺斯艾利斯','ar','America/Argentina/Buenos_Aires'],
  ['巴西','圣保罗','br','America/Sao_Paulo'],
  ['巴西','玛瑙斯','br','America/Manaus'],
  ['巴西','里奥布兰科','br','America/Rio_Branco'],
  ['巴西','费尔南多·迪诺罗尼亚','br','America/Noronha'],
  ['智利','圣地亚哥','cl','America/Santiago'],
  ['智利','复活节岛','cl','Pacific/Easter'],
  // ── 大洋洲 ──
  ['澳大利亚','悉尼 · 东部','au','Australia/Sydney'],
  ['澳大利亚','布里斯班 · 东部(无夏令时)','au','Australia/Brisbane'],
  ['澳大利亚','阿德莱德 · 中部','au','Australia/Adelaide'],
  ['澳大利亚','达尔文 · 中部(无夏令时)','au','Australia/Darwin'],
  ['澳大利亚','珀斯 · 西部','au','Australia/Perth'],
  ['新西兰','奥克兰','nz','Pacific/Auckland'],
  ['巴布亚新几内亚','莫尔斯比港','pg','Pacific/Port_Moresby'],
  ['斐济','苏瓦','fj','Pacific/Fiji'],
  ['所罗门群岛','霍尼亚拉','sb','Pacific/Guadalcanal'],
  ['瓦努阿图','维拉港','vu','Pacific/Efate'],
  ['萨摩亚','阿皮亚','ws','Pacific/Apia'],
  ['汤加','努库阿洛法','to','Pacific/Tongatapu'],
  ['基里巴斯','塔拉瓦','ki','Pacific/Tarawa'],
  ['基里巴斯','凤凰群岛','ki','Pacific/Kanton'],
  ['基里巴斯','圣诞岛','ki','Pacific/Kiritimati'],
  ['马绍尔群岛','马朱罗','mh','Pacific/Tarawa'],
  ['密克罗尼西亚','帕利基尔','fm','Pacific/Guadalcanal'],
  ['帕劳','恩吉鲁穆德','pw','Pacific/Palau'],
  ['瑙鲁','亚伦','nr','Pacific/Nauru'],
  ['图瓦卢','富纳富提','tv','Pacific/Tarawa'],
];

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
function renderWorldClock() {
  const startSel = $('#wc-start'), endSel = $('#wc-end'), box = $('#wc-results');
  if (!startSel || !endSel || !box) return;
  const start = +startSel.value, end = +endSel.value, now = new Date();
  const groups = new Map();
  WC_DATA.forEach(t => {
    let c; try { c = wcCompute(t[3], now); } catch (e) { return; }
    if (!wcInRange(c.h, start, end)) return;
    if (!groups.has(c.offset)) groups.set(c.offset, { off: c.offset, s: c, items: [] });
    groups.get(c.offset).items.push({ country: t[0], city: t[1], cc: t[2], lock: t[4] || 0 });
  });
  const arr = [...groups.values()].sort((a, b) => a.off - b.off);
  const total = arr.reduce((n, g) => n + g.items.length, 0);
  const sum = $('#wc-summary');
  if (sum) sum.textContent = `当地 ${wcPad(start)}:00–${wcPad(end)}:59 · 命中 ${arr.length} 个时区 / ${total} 个国家地区`;
  if (!arr.length) { box.innerHTML = '<p class="muted" style="padding:1rem;text-align:center">该时段暂无匹配的国家 / 地区。</p>'; return; }
  box.innerHTML = arr.map(g => {
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
  }).join('');
}
function setupWorldClock() {
  const startSel = $('#wc-start'), endSel = $('#wc-end');
  if (!startSel || !endSel) return;
  let opts = '';
  for (let i = 0; i < 24; i++) opts += `<option value="${i}">${wcPad(i)}:00</option>`;
  startSel.innerHTML = opts; endSel.innerHTML = opts;
  startSel.value = '14'; endSel.value = '18'; // demo default (= the 14–18 example)
  startSel.addEventListener('change', renderWorldClock);
  endSel.addEventListener('change', renderWorldClock);
  renderWorldClock();
  // tick so groups shift as the minute rolls — only while the clock view is open
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
  $('#cal-today').addEventListener('click', () => { state.calYear = now.getFullYear(); state.calMonth = now.getMonth(); renderCalendar(); });
}
function shiftMonth(delta) {
  let m = state.calMonth + delta, y = state.calYear;
  if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
  state.calMonth = m; state.calYear = y; renderCalendar();
}
function setupDetail() {
  $('#detail-close').addEventListener('click', () => { $('#event-detail').hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#event-detail').hidden = true; });
}

async function init() {
  setupTabs();
  setupCalNav();
  setupDetail();
  setupWorldClock();
  await loadData();
  renderCalendar();
  renderRotations();
}

document.addEventListener('DOMContentLoaded', init);
