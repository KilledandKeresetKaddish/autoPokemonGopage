/* ============================================================================
 * pogo-agent frontend (PROTECTED — the daily agent must not edit this file).
 * Renders: calendar (from data/events.json), rankings sub-tab switching,
 * and the personal daily tracker (localStorage, auto-resets each day).
 * ========================================================================== */
'use strict';

const state = { events: [], calYear: 0, calMonth: 0 };
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']; // Monday-first

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
function typeColor(type) {
  const map = {
    'community-day': '#58b368', 'raid-day': '#e3350d', 'raid-battles': '#e3350d',
    'pokemon-go-fest': '#9b59b6', 'spotlight-hour': '#ffcb05', 'research': '#2a75bb',
    'event': '#2a75bb', 'season': '#16a085', 'pokemon-spotlight-hour': '#ffcb05',
  };
  if (map[type]) return map[type];
  let h = 0; for (const ch of String(type || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 55%, 50%)`;
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
}

/* ---------- calendar ---------- */
function eventsOnDay(d) {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return state.events.filter(ev => ev._s && day >= ev._s && day <= ev._e);
}
function renderCalendar() {
  $('#cal-title').textContent = `${state.calYear}年${state.calMonth + 1}月`;
  const grid = $('#calendar');
  grid.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'cal-grid cal-head';
  WEEKDAYS.forEach(w => {
    const c = document.createElement('div');
    c.className = 'cal-cell cal-wd'; c.textContent = w; head.appendChild(c);
  });
  grid.appendChild(head);

  const body = document.createElement('div');
  body.className = 'cal-grid';
  const first = new Date(state.calYear, state.calMonth, 1);
  const firstDow = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(state.calYear, state.calMonth, 1 - firstDow);
  const today = ymd(new Date());

  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const cell = document.createElement('div');
    cell.className = 'cal-cell day';
    if (d.getMonth() !== state.calMonth) cell.classList.add('other-month');
    if (ymd(d) === today) cell.classList.add('today');

    const num = document.createElement('div');
    num.className = 'daynum'; num.textContent = d.getDate(); cell.appendChild(num);

    const evs = eventsOnDay(d);
    evs.slice(0, 3).forEach(ev => {
      const chip = document.createElement('button');
      chip.className = 'event-chip';
      chip.style.borderLeftColor = typeColor(ev.type);
      const img = ev.image ? `<img class="chip-img" src="${escapeHtml(ev.image)}" alt="" loading="lazy">` : '';
      chip.innerHTML = `${img}<span>${escapeHtml(ev.name)}</span>`;
      chip.addEventListener('click', () => openDetail(ev));
      cell.appendChild(chip);
    });
    if (evs.length > 3) {
      const more = document.createElement('div');
      more.className = 'more'; more.textContent = `+${evs.length - 3}`; cell.appendChild(more);
    }
    body.appendChild(cell);
  }
  grid.appendChild(body);
}

function openDetail(ev) {
  const mons = (ev.pokemon || []).map(p =>
    `<figure class="mon"><img class="mon-icon" src="${escapeHtml(spriteUrl(p.id))}" alt="${escapeHtml(p.name)}" loading="lazy">${p.shiny ? '<span class="shiny">✨</span>' : ''}<figcaption>${escapeHtml(p.name)}</figcaption></figure>`
  ).join('');
  const bonuses = (ev.bonuses || []).map(b => `<li>${escapeHtml(b)}</li>`).join('');
  $('#detail-body').innerHTML = `
    ${ev.image ? `<img class="detail-img" src="${escapeHtml(ev.image)}" alt="">` : ''}
    <h3>${escapeHtml(ev.name)}</h3>
    <p class="muted">${escapeHtml(ev.heading || ev.type || '')} · ${escapeHtml(fmtRange(ev.start, ev.end))}</p>
    ${mons ? `<div class="mon-row">${mons}</div>` : ''}
    ${bonuses ? `<h4>加成</h4><ul>${bonuses}</ul>` : ''}
    ${ev.link ? `<a class="btn btn-primary" href="${escapeHtml(ev.link)}" target="_blank" rel="noopener">打开活动页 ↗</a>` : ''}
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
}

async function init() {
  setupTabs();
  setupCalNav();
  setupDetail();
  renderTracker();
  await loadData();
  renderCalendar();
}

document.addEventListener('DOMContentLoaded', init);
