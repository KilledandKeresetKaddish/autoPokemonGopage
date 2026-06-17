/* ============================================================================
 * pogo-agent frontend (PROTECTED — the daily content agent must not edit this).
 * Renders: the month calendar (spanning bars + day chips, from data/events.json),
 * the rankings sub-tab switching, and the personal daily tracker (localStorage,
 * auto-resets each day). After editing this file or style.css, regenerate
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
function firstSprite(ev) {
  const p = (ev.pokemon || [])[0];
  return p && p.id ? spriteUrl(p.id) : '';
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

  // map every event into grid indices, clipped to the visible 0..41 range
  const bars = [], chipsByDay = {}, longTerm = [];
  state.events.forEach(ev => {
    if (!ev._s) return;
    const si = dayDiff(gridStart, ev._s);
    const ei = dayDiff(gridStart, ev._e);
    if (ei < 0 || si > 41) return; // outside the visible grid
    // long-running background events leave the grid for the compact band below
    if (isLongTerm(ev)) { longTerm.push(ev); return; }
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
      let tag = '';
      if (ymd(date) === todayStr) tag = '<span class="tag">今天</span>';
      else if (date.getDate() === 1) tag = `<span class="moy">${date.getMonth() + 1}月</span>`;
      num.innerHTML = `<span class="dn">${date.getDate()}</span>${tag}`;
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
            + `<span class="ct">${escapeHtml(cat.label)}</span><span class="cn">${escapeHtml(ev.name)}</span>`;
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
      const bar = document.createElement('button');
      bar.className = 'cal-bar' + (isL ? ' l' : '') + (isR ? ' r' : '') + (b.cat.bg ? ' bg' : '') + (b.ev.highlight ? ' hl' : '');
      bar.style.left = `calc(${leftCol / 7 * 100}% + 3px)`;
      bar.style.width = `calc(${span / 7 * 100}% - 6px)`;
      bar.style.top = (NUM_H + b.lane * LANE_H) + 'px';
      bar.style.background = b.cat.color;
      bar.style.color = b.cat.fg;
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
  renderLegend(present);
  renderLongTerm(longTerm);
}

// Legend reflects only the categories actually present in the current month.
function renderLegend(present) {
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
  box.innerHTML = items.map(c =>
    `<span class="lg"><i class="${c.kind === 'chip' ? 'round' : ''}" style="background:${c.color}"></i>${escapeHtml(c.label)}</span>`
  ).join('') || '';
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
      const mons = (seg.pokemon || []).map(p =>
        p && p.id ? `<img class="spr" src="${escapeHtml(spriteUrl(p.id))}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''
      ).join('');
      const range = (seg.start || seg.end)
        ? `<span class="rot-range">${escapeHtml(fmtDateShort(seg.start))}${seg.end && seg.end !== seg.start ? '–' + escapeHtml(fmtDateShort(seg.end)) : ''}</span>`
        : '';
      row.innerHTML = `${mons}<span class="rot-name">${escapeHtml(seg.cn || seg.name || '')}</span>${range}`;
      card.appendChild(row);
    });
    box.appendChild(card);
  });
}

function openDetail(ev) {
  const cat = catOf(ev);
  const mons = (ev.pokemon || []).map(p =>
    `<figure class="mon"><img class="mon-icon" src="${escapeHtml(spriteUrl(p.id))}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.style.visibility='hidden'">${p.shiny ? '<span class="shiny">✨</span>' : ''}<figcaption>${escapeHtml(p.name)}</figcaption></figure>`
  ).join('');
  const bonuses = (ev.bonuses || []).map(b => `<li>${escapeHtml(b)}</li>`).join('');
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
    ${links ? `<div class="detail-links">${links}</div>` : ''}
  `;
  $('#event-detail').hidden = false;
}

/* ---------- tracker (localStorage, daily reset) ---------- */
const TASKS = [{ k: 'coins', l: '金币' }, { k: 'pass', l: 'Pass 点' }, { k: 'raid', l: 'Raid' }];
const ACCOUNTS = [1, 2, 3, 4, 5];
const LS_KEY = 'pogo-tracker-v1';

function trackerLoad() {
  let d;
  try { d = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { d = {}; }
  const today = ymd(new Date());
  if (d.date !== today) { d = { date: today, names: (d && d.names) || {}, checks: {} }; trackerSave(d); }
  d.names = d.names || {}; d.checks = d.checks || {};
  return d;
}
function trackerSave(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch (e) {} }

function renderTracker() {
  const d = trackerLoad();
  const root = $('#tracker');
  root.innerHTML = '';
  let done = 0;
  const total = ACCOUNTS.length * TASKS.length;

  ACCOUNTS.forEach(a => {
    const row = document.createElement('div');
    row.className = 'trk-row';

    const name = document.createElement('input');
    name.className = 'trk-name';
    name.value = d.names[a] || '';
    name.placeholder = `账号 ${a}`;
    name.addEventListener('input', () => { const x = trackerLoad(); x.names[a] = name.value; trackerSave(x); });
    row.appendChild(name);

    TASKS.forEach(t => {
      const id = `${a}.${t.k}`;
      const checked = !!d.checks[id];
      if (checked) done++;
      const lab = document.createElement('label');
      lab.className = 'trk-check' + (checked ? ' on' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = checked;
      cb.addEventListener('change', () => { const x = trackerLoad(); x.checks[id] = cb.checked; trackerSave(x); renderTracker(); });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(t.l));
      row.appendChild(lab);
    });
    root.appendChild(row);
  });
  $('#tracker-progress').textContent = `${done} / ${total}`;
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
  renderTracker();
  await loadData();
  renderCalendar();
  renderRotations();
}

document.addEventListener('DOMContentLoaded', init);
