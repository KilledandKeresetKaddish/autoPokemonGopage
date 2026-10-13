/* ============================================================================
 * pogo-agent frontend (PROTECTED — the daily content agent must not edit this).
 * Renders: the month calendar (spanning bars + day chips, from data/events.json)
 * and the rankings sub-tab switching. After editing this file or style.css, regenerate
 * scripts/protected.sha256 or the next daily run fails validation.
 * ========================================================================== */
'use strict';

const state = {
  events: [], eventsLoaded: false, rotations: null, categories: {}, mega: [], locations: null, locationsError: '', meta: null,
  ui: {}, en: null, zhRegions: {}, locale: 'zh-CN', calYear: 0, calMonth: 0,
};
const LOCALE_KEY = 'pogo-locale';
const REGION_NAMES = ['calendar-notes', 'rankings-current', 'rankings-attackers', 'rankings-defenders', 'rankings-raid'];
const WEEKDAYS = {
  'zh-CN': ['一', '二', '三', '四', '五', '六', '日'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
}; // Monday-first

function initialLocale() {
  try {
    const requested = new URLSearchParams(location.search).get('lang');
    if (requested === 'en') return 'en';
    if (requested === 'zh-CN' || requested === 'zh') return 'zh-CN';
    return localStorage.getItem(LOCALE_KEY) === 'en' ? 'en' : 'zh-CN';
  } catch (e) { return 'zh-CN'; }
}
state.locale = initialLocale();
function isEnglish() { return state.locale === 'en'; }
function i18n(key, vars, fallback) {
  const dict = state.ui && state.ui[state.locale] || {};
  let out = dict[key];
  if (out == null) out = fallback == null ? key : fallback;
  return String(out).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) =>
    vars && Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`);
}

/* ---------- calendar geometry (px) ---------- */
// Day-number height is CSS-driven (--num-h) so phones can stack one bounded
// raid trigger below the date without changing the seven-column geometry.
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
  'pokemon-go-fest':        { palette:'purple',  label:'GO Fest',  labelKey:'category.goFest', kind:'bar' },
  'community-day':          { palette:'green',   label:'社区日',    labelKey:'category.communityDay', kind:'bar' },
  'pokemon-spotlight-hour': { palette:'greenlt', label:'聚焦时刻',  labelKey:'category.spotlightHour', kind:'chip' },
  'spotlight-hour':         { palette:'greenlt', label:'聚焦时刻',  labelKey:'category.spotlightHour', kind:'chip' },
  'raid-battles':           { palette:'rust',    label:'团战 Boss', labelKey:'category.raidBoss', kind:'bar' },
  'raid-hour':              { palette:'orange',  label:'团战时刻',  labelKey:'category.raidHour', kind:'chip' },
  'raid-day':               { palette:'red',     label:'团战日',    labelKey:'category.raidDay', kind:'bar' },
  'research':               { palette:'teal',    label:'调查',      labelKey:'category.research', kind:'bar' },
  'choose-your-path':       { palette:'teallt',  label:'限时调查',  labelKey:'category.timedResearch', kind:'bar' },
  'event':                  { palette:'blue',    label:'活动',      labelKey:'category.event', kind:'bar' },
  'go-battle-league':       { palette:'indigo',  label:'对战联盟',  labelKey:'category.gbl', kind:'bar' },
  'max-mondays':            { palette:'mauve',   label:'Max 周一',  labelKey:'category.maxMonday', kind:'chip' },
  'go-pass':                { palette:'gold',    label:'GO Pass',   labelKey:'category.goPass', kind:'bar', bg:true, fg:'#1d1402' },
  'season':                 { palette:'brown',   label:'赛季',      labelKey:'category.season', kind:'bar', bg:true, fg:'#fbeccb' },
};
// Resolve a category def ({palette,label,kind,bg?,fg?}) to render fields. An
// unknown palette key falls back to a muted hashed colour (validation blocks it).
function resolveCat(def, type) {
  let label = def.labelKey ? i18n(def.labelKey, null, def.label) : (def.label || def.palette || i18n('category.event', null, '活动'));
  if (isEnglish() && state.en && state.en.categories && state.en.categories[type]) label = state.en.categories[type];
  return {
    color: PALETTE[def.palette] || hashColor(def.palette || def.label || ''),
    fg: def.fg || INK_DARK,
    label,
    kind: def.kind === 'chip' ? 'chip' : 'bar',
    bg: !!def.bg,
  };
}

/* Calendar raid day-icon presentation, keyed by rotations.json track.key. The
 * three known tiers get a fixed CSS class + glyph + 中文 legend label; ANY new
 * tier the game adds still renders — raidMeta() falls back to a neutral '.gen'
 * chip and a ≤2-char badge derived from track.tag (or the key). So a future
 * rotation track shows up in the day cells automatically, no code change needed.
 * Per-track `color` (from the data) drives the ring via inline --ring regardless. */
const RAID_META = {
  '5star': { cls: 's5',   tag: '5★', label: '5★ 团战', labelKey:'raid.fiveStar' },
  'mega':  { cls: 'mega', tag: 'M',  label: '超级团战', labelKey:'raid.mega' },
  'max':   { cls: 'max',  tag: 'MX', label: '极巨团战', labelKey:'raid.max' },
};
function raidMeta(key) {
  const raw = RAID_META[key];
  if (raw) return Object.assign({}, raw, { label: i18n(raw.labelKey, null, raw.label) });
  const name = key || i18n('raid.generic', null, '团战');
  return { cls: 'gen', tag: name.slice(0, 2).toUpperCase() || '★', label: i18n('raid.named', { name }, `${name} 团战`) };
}

/* ---------- Mega Evolution reference tables ---------------------------------
 * Source: Bulbapedia "Mega Evolution (GO)" (transcribed & verified against the
 * game's tables, 2026-07). These are GENERIC game mechanics, not per-Pokémon
 * content — the ONLY per-Pokémon variable is `initialCost` in data/mega.json,
 * off which everything below is looked up. Update these constants (and then
 * regenerate scripts/protected.sha256) only when Niantic changes the mechanics;
 * the daily content agent must never touch this file. */

// Column order + 中文 labels shared by every mega table.
const MEGA_LEVELS = [
  { key: 'base',     label: '普通',     labelKey:'mega.level.base' },
  { key: 'high',     label: '高级',     labelKey:'mega.level.high' },
  { key: 'max',      label: '最高',     labelKey:'mega.level.max' },
  { key: 'superMax', label: '超级最高', labelKey:'mega.level.superMax' },
];
// Table 1 — Mega Energy to Mega-Evolve at each level, keyed by Initial Cost.
// NOT a clean formula (see the 7500 row → 150, not 1500), so it is an explicit lookup.
const MEGA_ENERGY = {
  100:  { base: 20,  high: 10, max: 5,  superMax: 5  },
  200:  { base: 40,  high: 20, max: 10, superMax: 10 },
  300:  { base: 60,  high: 30, max: 15, superMax: 5  },
  400:  { base: 80,  high: 40, max: 20, superMax: 20 },
  7500: { base: 150, high: 80, max: 20, superMax: 20 },
};
// Table 2 — generic per-level bonuses (identical for every Pokémon). null → —.
const MEGA_LEVEL_BONUSES = [
  { key:'evolutions', label: '所需超级进化次数', vals: [1, 7, 30, 30] },
  { key:'energy',     label: '所需超级能量',     vals: [null, null, null, '5000 能量'] },
  { key:'rest',       label: '休息时间',         vals: ['7 天', '5 天', '3 天', '24 小时'] },
  { key:'discount',   label: '超级能量消耗减免', vals: ['80%', '90%', '95%', '98.3%'] },
  { key:'candy',      label: '捕捉糖果加成',     vals: ['🍬 1', '🍬 1', '🍬 2', '🍬 3'] },
  { key:'xl',         label: 'XL 糖果几率提升',  vals: [null, '+10%', '+25%', '+30%'] },
  { key:'xp',         label: '捕捉 XP 加成',     vals: [null, '+50 XP', '+100 XP', '+200 XP'] },
  { key:'cp',         label: 'CP 等级加成',      vals: [null, null, null, '+2 级'] },
];
// Table 3 — Mega Energy to INSTANTLY buy the Mega Level up to High/Max/SuperMax
// (Bulbapedia "Mega Level Costs", feature live since 2026-05-18), keyed by
// "No. of times Mega Evolved / Primal Reverted" (array index 0 = 1 time done).
// NOT the in-rest re-activation discount — that one is proportional to remaining
// rest time and is computed by the planner, not tabulated. Verified to reproduce
// Bulbapedia's grid exactly. Rule for the 100/200 group (300/400/7500 is exactly 2×):
//   High:     480 − 80·i                          for i = 0..5   (6 entries)
//   Max:      1400 − 80·min(i,6) − 40·max(i−6,0)  for i = 0..28  (29 entries)
//   SuperMax: Max(i) + 5000  for i = 0..28, then 5000 at i = 29  (30 entries)
// Base level is the entry level (reached by the 1st activation), so it has no column.
const MEGA_LEVELUP = (function () {
  const max100 = [];
  for (let i = 0; i < 29; i++) max100.push(1400 - 80 * Math.min(i, 6) - 40 * Math.max(i - 6, 0));
  const high100 = [];
  for (let i = 0; i < 6; i++) high100.push(480 - 80 * i);
  const superMax100 = max100.map(v => v + 5000).concat([5000]);
  const dbl = a => a.map(v => v * 2);
  return {
    sm: { high: high100,      max: max100,      superMax: superMax100 },
    lg: { high: dbl(high100), max: dbl(max100), superMax: dbl(max100).map(v => v + 5000).concat([5000]) },
  };
})();
// Which cost group an Initial Cost falls in (100/200 vs 300/400/7500).
function megaGroup(cost) { return (cost != null && cost <= 200) ? 'sm' : 'lg'; }
// Rest period in days per level, and total activations needed to reach a level.
// Level progress accrues at most ONCE PER DAY (so 1 activation/day is the fastest
// mega-based route); Super Max is bought with a flat 5,000 Energy at Max, not
// counted in activations. Both facts are load-bearing for the planner below.
const MEGA_REST = { base: 7, high: 5, max: 3, superMax: 1 };
const MEGA_NEED = { base: 1, high: 7, max: 30 };
function megaLevelAfter(n) { return n >= 30 ? 'max' : n >= 7 ? 'high' : n >= 1 ? 'base' : null; }
// 12345 → "12,345" (matches the source tables' thousands separators).
function megaComma(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

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
// Localized rich text is validated before publish, but it is still data loaded
// at runtime. Sanitize again in-browser so quote/entity parser edge cases can
// never turn a translation file into executable markup.
const SAFE_RICH_TAGS = new Set(['a','br','code','div','em','h3','h4','img','li','ol','p','small','span','strong','ul']);
const SAFE_RICH_ATTRS = new Set(['alt','aria-label','class','data-event-id','data-hub','href','loading','rel','src','target','title']);
const SAFE_RICH_CLASSES = new Set([
  'panel','panel-head','note-grid','callout','rank-list','rank-item','pill','pillrow','badge','btn','btn-primary',
  'muted','meta','mon-icon','mon-row','mon','shiny','tier','tier-S','tier-A','tier-B','tier-C','spr','ico','ico-lg',
  'event-link','raid-wall','raid-block','raid-boss','boss-icon','binfo','btop','raid-mega','mini','detail-links',
]);
function sanitizeLocalizedHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html == null ? '' : html);
  [...template.content.querySelectorAll('*')].forEach(el => {
    const tag = el.tagName.toLowerCase();
    if (!SAFE_RICH_TAGS.has(tag)) { el.remove(); return; }
    [...el.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      if (!SAFE_RICH_ATTRS.has(name) || name.startsWith('on')) { el.removeAttribute(attr.name); return; }
      const value = attr.value.trim();
      if (name === 'class') {
        const safe = value.split(/\s+/).filter(x => SAFE_RICH_CLASSES.has(x));
        if (safe.length) el.setAttribute('class', safe.join(' ')); else el.removeAttribute('class');
      } else if (name === 'href' && !(value.startsWith('https://') || value.startsWith('#'))) {
        el.removeAttribute('href');
      } else if (name === 'src' && !(value.startsWith('https://') || value.startsWith('assets/'))) {
        el.removeAttribute('src');
      } else if ((name === 'data-event-id' || name === 'data-hub') && !/^[A-Za-z0-9._:-]+$/.test(value)) {
        el.removeAttribute(attr.name);
      } else if (name === 'target' && value !== '_blank') {
        el.removeAttribute('target');
      }
    });
    if (tag === 'a' && el.getAttribute('target') === '_blank') el.setAttribute('rel', 'noopener');
  });
  return template.innerHTML;
}
// Use only for dictionary entries that intentionally contain inert markup
// (currently <strong>/<code>/<a>). Plain translations must use textContent or
// escapeHtml() at their insertion site instead.
function i18nRich(key, vars, fallback) {
  return sanitizeLocalizedHtml(i18n(key, vars, fallback));
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
  if (def) return resolveCat(def, ev.type);
  const span = ev._s && ev._e ? dayDiff(ev._s, ev._e) : 0;
  const lev = localizedEvent(ev);
  return { color: hashColor(ev.type), fg: INK_DARK, label: lev.heading || ev.type || i18n('category.event', null, '活动'), kind: span >= 1 ? 'bar' : 'chip' };
}
/* PVP events (GO Battle League seasons, cups, Battle Weekend/Day…) are pulled
 * into their own 「PVP活动」 band, mirroring the long-term band's form. The daily
 * agent marks them with pvp:true (or display:'pvp'); go-battle-league is auto-
 * classified. pvp:false forces an event out. Checked before isLongTerm so a long
 * PVP season lands in PVP, not 长期活动. */
const PVP_TYPES = new Set(['go-battle-league']);
function isPvp(ev) {
  if (ev.pvp === true || ev.display === 'pvp') return true;
  if (ev.pvp === false) return false;
  return PVP_TYPES.has(ev.type);
}
/* Long-running "background" events (season / pass, or anything that spans more
 * than ~2 weeks) are pulled out of the day grid into a compact band so they don't
 * bury the headline short events. The daily agent can override either way with an
 * explicit longTerm (or display:'banner'|'bar') flag. */
const LONG_TYPES = new Set(['season', 'go-pass']);
function isLongTerm(ev) {
  if (isPvp(ev)) return false;            // PVP events get their own band (above)
  if (ev.longTerm === true || ev.display === 'banner') return true;
  if (ev.longTerm === false || ev.display === 'bar') return false;
  if (LONG_TYPES.has(ev.type)) return true;
  if (!ev._s || !ev._e) return false;
  return dayDiff(ev._s, ev._e) >= 14;
}
function fmtDateTime(s) {
  // A date-only value has no clock component and must not take the UTC parsing
  // path (which shifts it into the prior local day west of UTC).
  if (/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return fmtDateShort(s);
  const d = new Date(s); if (isNaN(d.getTime())) return s || '';
  if (isEnglish()) return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtRange(start, end) {
  if (!start) return i18n('date.pending', null, '时间待定');
  const s = fmtDateTime(start);
  if (!end || end === start) return s;
  return `${s} — ${fmtDateTime(end)}`;
}
// Month/day only — the long-event band and rotation tracks don't need HH:MM.
function fmtDateShort(s) {
  // Canonical rotation dates are YYYY-MM-DD. new Date('YYYY-MM-DD') means UTC
  // midnight and displays the previous day west of UTC; parseDay keeps them at
  // local midnight while still accepting full timestamps.
  const d = parseDay(s); if (!d) return s || '';
  if (isEnglish()) return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
function fmtMonthTitle(year, month) {
  if (isEnglish()) return new Intl.DateTimeFormat('en-US', { year:'numeric', month:'long' }).format(new Date(year, month, 1));
  return `${year}年${month + 1}月`;
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

const SOURCE_LABEL_KEYS = {
  '官方':'source.official', 'Official':'source.official', '活动页':'source.eventPage', 'Event page':'source.eventPage',
  '链接':'source.link', 'Link':'source.link', 'Hub':'source.hub', 'LeekDuck':'source.leekduck',
  'Pokébase':'source.pokebase', 'Fandom':'source.fandom', 'Serebii':'source.serebii',
};
function localizedSourceLabel(label) {
  const key = SOURCE_LABEL_KEYS[label];
  return key ? i18n(key, null, label) : label;
}
// English content is a text-only overlay. IDs, dates, links, sprites, flags and
// every other behavioural field remain canonical in the Chinese source files.
function localizedEvent(ev) {
  if (!isEnglish() || !ev || !state.en || !state.en.events) return ev;
  const tx = state.en.events[ev.id];
  if (!tx) return ev;
  const out = Object.assign({}, ev, {
    name: tx.name || ev.name,
    heading: tx.heading || ev.heading,
    summary: tx.summary || '',
    bonuses: Array.isArray(tx.bonuses) ? tx.bonuses.slice() : [],
  });
  out.pokemon = (ev.pokemon || []).map((p, i) => Object.assign({}, p, {
    name: (tx.pokemon && tx.pokemon[i]) || p.name,
  }));
  out.counters = (ev.counters || []).map((c, i) => {
    const ct = tx.counters && tx.counters[i] || {};
    return Object.assign({}, c, {
      name: ct.name || c.name,
      fast: ct.fast || '', charged: ct.charged || '',
    });
  });
  out.sections = (ev.sections || []).map((s, i) => {
    const st = tx.sections && tx.sections[i] || {};
    const sec = Object.assign({}, s, {
      title: st.title || s.title,
      items: Array.isArray(st.items) ? st.items.slice() : [],
      body: st.body || '',
    });
    sec.mons = (s.mons || []).map((m, j) => Object.assign({}, m, {
      name: (st.mons && st.mons[j]) || m.name,
    }));
    return sec;
  });
  out.links = (ev.links || []).map(x => Object.assign({}, x, { label: localizedSourceLabel(x.label) }));
  return out;
}
function localizedRotations() {
  const data = state.rotations;
  if (!isEnglish() || !data || !state.en || !state.en.rotations) return data;
  const rt = state.en.rotations;
  return Object.assign({}, data, {
    note: rt.note || data.note,
    tracks: (data.tracks || []).map(trk => {
      const tt = rt.tracks && rt.tracks[trk.key] || {};
      return Object.assign({}, trk, {
        label: tt.label || trk.label,
        segments: (trk.segments || []).map((seg, i) => {
          const st = tt.segments && tt.segments[i] || {};
          return Object.assign({}, seg, {
            name: st.name || seg.name,
            cn: st.cn || st.name || seg.cn || seg.name,
            pokemon: (seg.pokemon || []).map((p, j) => Object.assign({}, p, {
              name: (st.pokemon && st.pokemon[j]) || p.name,
            })),
          });
        }),
      });
    }),
  });
}

/* ---------- data ---------- */
async function loadData() {
  let eventsLoadedThisTime = false;
  const bust = '?t=' + Date.now();
  try { state.ui = await (await fetch('data/i18n/ui.json' + bust)).json(); }
  catch (e) { state.ui = {}; }
  try { state.en = await (await fetch('data/i18n/en.json' + bust)).json(); }
  catch (e) { state.en = null; }
  try {
    const r = await fetch('data/events.json' + bust);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const raw = await r.json();
    if (!Array.isArray(raw) || raw.some(e => !e || typeof e.id !== 'string' || !e.id)
      || new Set(raw.map(e => e.id)).size !== raw.length) throw new Error('invalid canonical events');
    state.events = raw.map(ev => {
      const s = parseDay(ev.start);
      const e = parseDay(ev.end) || s;
      return Object.assign({}, ev, { _s: s, _e: e });
    });
    state.eventsLoaded = true; eventsLoadedThisTime = true;
  } catch (e) { /* retain the last successful canonical times, not a false withdrawal */ }
  try { state.meta = await (await fetch('data/meta.json' + bust)).json(); }
  catch (e) { state.meta = null; }
  try {
    state.rotations = await (await fetch('data/rotations.json' + bust)).json();
  } catch (e) { state.rotations = null; }
  try {
    state.categories = (await (await fetch('data/categories.json' + bust)).json()) || {};
  } catch (e) { state.categories = {}; }
  try {
    const ft = await (await fetch('data/featured.json' + bust)).json();
    const ftSet = new Set(Array.isArray(ft) ? ft : []);
    state.events.forEach(ev => { if (ftSet.has(ev.id)) ev._featured = true; });
  } catch (e) { /* no featured.json — fine */ }
  try {
    const mg = await (await fetch('data/mega.json' + bust)).json();
    state.mega = Array.isArray(mg) ? mg : [];
  } catch (e) { state.mega = []; }
  try {
    const response = await fetch('data/locations.json' + bust);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const locations = await response.json();
    if (!locations || !Array.isArray(locations.spots) || !locations.schedule) throw new Error('invalid locations schema');
    state.locations = locations;
    state.locationsError = '';
  } catch (e) {
    state.locations = null;
    state.locationsError = e && e.message || String(e);
  }
  if (reminders && eventsLoadedThisTime) reminders.setEvents(state.events, state.en?.events);
  reminderScheduler?.wake();
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
function findRaidEvent(rd, events = state.events) {
  const mons = (rd?.mons || []).filter(m => m?.id);
  if (!mons.length) return null;
  const rs = parseDay(rd.day || rd.start), re = parseDay(rd.day || rd.end) || rs;
  const matches = events.filter(ev => {
    const start = ev._s || parseDay(ev.start), end = ev._e || parseDay(ev.end) || start;
    if (ev.type !== 'raid-battles' || !ev.id || !start || !end) return false;
    if (rs && re && (end < rs || start > re)) return false;
    return mons.every(m => (ev.pokemon || []).some(p => {
      if (p.id !== m.id) return false;
      if (m.hub && p.hub) return m.hub === p.hub;
      if (m.hub || p.hub) return !!m.sprite && m.sprite === p.sprite;
      return monSprite(m) === monSprite(p);
    }));
  });
  // Ambiguous pooled badges must not silently bind a personal flag to one boss.
  if (matches.length === 1) return matches[0];
  return null;
}
let detailReturnFocus = null;
function raidFallbackEvent(rd) {
  return {
    name: rd.name, heading: i18n('category.raidBoss', null, '团战 Boss'), type: 'raid-battles',
    start: rd.start, end: rd.end, pokemon: rd.mons,
  };
}
function openRaidDay(date, raids, opener) {
  const panel = $('#event-detail'), body = $('#detail-body');
  if (!panel || !body) return;
  flushReminderEditor(); detailEvent = null;
  detailReturnFocus = opener || null;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', i18n('calendar.raidChooserLabel', null, '选择团战角标'));
  body.innerHTML = `<span class="detail-cat" style="--c:${PALETTE.rust}">${escapeHtml(i18n('calendar.raidChooserTag', null, '当日团战'))}</span>`
    + `<h3>${escapeHtml(i18n('calendar.raidChooserTitle', { date: fmtDateShort(ymd(date)) }, `${fmtDateShort(ymd(date))} · 团战角标`))}</h3>`
    + `<p class="muted">${escapeHtml(i18n('calendar.raidChooserHint', null, '选择一个团战档次查看 Boss 与详情。'))}</p>`
    + '<div class="raid-day-options"></div>';
  const list = body.querySelector('.raid-day-options');
  raids.forEach(rd => {
    const meta = raidMeta(rd.tier);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'raid-day-option';
    if (rd.color) b.style.setProperty('--ring', rd.color);
    const mons = rd.mons || [];
    const names = mons.map(m => m.name).filter(Boolean).join(' / ');
    b.innerHTML = `<span class="raid-day-tier">${escapeHtml((rd.tag || meta.tag).slice(0, 2))}</span>`
      + `<span class="raid-day-sprites">${mons.slice(0, 3).map(m => `<img src="${escapeHtml(monSprite(m))}" alt="" loading="lazy">`).join('')}</span>`
      + `<span class="raid-day-copy"><strong>${escapeHtml(rd.name || names || meta.label)}</strong>`
      + `<small>${escapeHtml(meta.label)}${names ? ' · ' + escapeHtml(names) : ''}</small></span>`;
    b.setAttribute('aria-label', `${meta.label}: ${rd.name || names}`);
    bindCalendarReminder(b, findRaidEvent(rd)?.id);
    b.addEventListener('click', () => openDetail(findRaidEvent(rd) || raidFallbackEvent(rd), opener));
    list.appendChild(b);
  });
  panel.hidden = false;
  const first = list.querySelector('button'); if (first) first.focus();
}

function renderCalendar() {
  $('#cal-title').textContent = fmtMonthTitle(state.calYear, state.calMonth);
  const root = $('#calendar');
  root.innerHTML = '';

  // weekday header
  const dow = document.createElement('div');
  dow.className = 'cal-dow';
  (WEEKDAYS[state.locale] || WEEKDAYS['zh-CN']).forEach((w, i) => {
    const c = document.createElement('div');
    c.className = 'cal-wd' + (i >= 5 ? ' weekend' : '');
    c.textContent = w; dow.appendChild(c);
  });
  root.appendChild(dow);

  const gridStart = gridStartDate();
  const todayStr = ymd(new Date());
  const present = new Set();

  // weekly raid-rotation bosses → one icon per track next to the day number
  // (driven by rotations.json, which carries pokemon ids; events.json raids don't).
  // Opt-out, not allow-list: every rotation track shows unless it sets
  // showOnCalendar:false, so a new boss tier appears in the cells with no code change.
  const raidsByDay = {};
  const raidTracks = new Map(); // track.key → {key,color,tag,name} for tracks shown this month (legend)
  const rotationData = localizedRotations();
  (rotationData && rotationData.tracks || [])
    .filter(t => t && t.key && t.showOnCalendar !== false)
    .forEach(t => (t.segments || []).forEach(seg => {
      const si = dayDiff(gridStart, parseDay(seg.start));
      const ei = dayDiff(gridStart, parseDay(seg.end || seg.start));
      const mons = (seg.pokemon || []).filter(p => p && (p.id || p.sprite));
      if (!mons.length || isNaN(si) || isNaN(ei) || ei < 0 || si > 41) return;
      raidTracks.set(t.key, { key: t.key, color: t.color, tag: t.tag, name: t.label || t.name });
      for (let i = Math.max(0, si); i <= Math.min(41, ei); i++) {
        (raidsByDay[i] = raidsByDay[i] || []).push(
          { tier: t.key, color: t.color, tag: t.tag, mons, name: seg.cn || seg.name, start: seg.start, end: seg.end });
      }
    }));
  // only let the icons REPLACE the grid bars when we actually have icons this month
  const hasRaidIcons = Object.keys(raidsByDay).length > 0;

  // map every event into grid indices, clipped to the visible 0..41 range
  const bars = [], chipsByDay = {}, longTerm = [], pvp = [];
  state.events.forEach(rawEv => {
    const ev = localizedEvent(rawEv);
    if (!ev._s) return;
    const si = dayDiff(gridStart, ev._s);
    const ei = dayDiff(gridStart, ev._e);
    if (ei < 0 || si > 41) return; // outside the visible grid
    // PVP events (league / cups / battle weekends) get their own band below 长期活动
    if (isPvp(ev)) { pvp.push(ev); return; }
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
      const monthMark = isEnglish()
        ? new Intl.DateTimeFormat('en-US', { month:'short' }).format(date)
        : `${date.getMonth() + 1}月`;
      const moy = date.getDate() === 1 ? `<span class="moy">${escapeHtml(monthMark)}</span>` : '';
      num.innerHTML = `<span class="dn">${date.getDate()}</span>${moy}`;
      // weekly raid icons (one per track; cycles if the segment has >1 boss)
      const raids = inMonth ? (raidsByDay[idx] || []).map(rd => ({ ...rd, day:ymd(date) })) : [];
      if (raids.length) {
        const rbox = document.createElement('div');
        rbox.className = 'daynum-raids';
        raids.forEach(rd => {
          const mons = rd.mons.slice(0, 3);
          const b = document.createElement('button');
          const meta = raidMeta(rd.tier);
          b.type = 'button';
          b.className = 'raid-ico ' + meta.cls + (mons.length > 1 ? ' slide n' + mons.length : '');
          if (rd.color) b.style.setProperty('--ring', rd.color);
          const badge = (rd.tag || meta.tag).slice(0, 2);
          const names = rd.mons.map(m => m.name).filter(Boolean).join(' / ');
          b.title = `${rd.name} · ${fmtDateShort(rd.start)}–${fmtDateShort(rd.end)}`;
          b.setAttribute('aria-label', `${meta.label}: ${rd.name || names}`);
          b.innerHTML = mons.map(p => `<img src="${escapeHtml(monSprite(p))}" alt="" loading="lazy" onerror="this.style.display='none'">`).join('')
            + `<span class="tg">${escapeHtml(badge)}</span>`;
          bindCalendarReminder(b, findRaidEvent(rd)?.id);
          b.addEventListener('click', () => openDetail(findRaidEvent(rd) || raidFallbackEvent(rd), b));
          rbox.appendChild(b);
        });
        num.appendChild(rbox);

        // Phones cannot fit an unbounded number of track buttons into one of
        // seven columns. CSS swaps the desktop row for this single bounded
        // trigger; its drawer exposes every track as a full-size touch target.
        const mobile = document.createElement('button');
        mobile.type = 'button'; mobile.className = 'raid-day-trigger';
        const first = raids[0].mons[0];
        mobile.innerHTML = (first ? `<img src="${escapeHtml(monSprite(first))}" alt="" loading="lazy">` : '<span>★</span>')
          + `<b>${raids.length}</b>`;
        mobile.setAttribute('aria-label', i18n('calendar.raidDayCount', { date: fmtDateShort(ymd(date)), count: raids.length }, `${fmtDateShort(ymd(date))}: ${raids.length} 个团战角标`));
        bindCalendarReminder(mobile, raids.map(rd => findRaidEvent(rd)?.id));
        mobile.addEventListener('click', () => openRaidDay(date, raids, mobile));
        num.appendChild(mobile);
      }
      cell.appendChild(num);

      const spacer = document.createElement('div');
      spacer.className = 'cal-barspace';
      cell.appendChild(spacer);

      // day chips (point events), with overflow collapse
      const list = (chipsByDay[idx] || []).slice().sort((a, b) =>
        Number(!!reminders?.view(b.ev.id).active) - Number(!!reminders?.view(a.ev.id).active));
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
          bindCalendarReminder(chip, ev.id);
          chip.addEventListener('click', () => openDetail(ev, chip));
          cw.appendChild(chip);
        });
        if (list.length > 3) {
          const more = document.createElement('button'); more.type = 'button';
          more.className = 'cal-more'; more.textContent = `+${list.length - 3}`;
          more.setAttribute('aria-label', i18n('reminder.moreEvents', { count:list.length - 3 }));
          bindCalendarReminder(more, list.slice(3).map(({ ev }) => ev.id));
          more.addEventListener('click', () => openChipDay(date, list, more));
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
      bar.style.top = `calc(var(--num-h, 30px) + ${b.lane * LANE_H}px)`;
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
      bindCalendarReminder(bar, b.ev.id);
      bar.addEventListener('click', () => openDetail(b.ev, bar));
      layer.appendChild(bar);
    });
    week.appendChild(layer);
    weeks.appendChild(week);
  }

  root.appendChild(weeks);
  renderLegend(present, raidTracks);
  renderBand('#long-term', i18n('calendar.longTerm', null, '长期活动'), longTerm);
  renderBand('#pvp-band', i18n('calendar.pvp', null, 'PVP活动'), pvp);
  reminderScheduler?.wake();
}

// Legend reflects only the categories actually present in the current month.
// raidTracks is a Map(track.key → {key,color,tag,name}) of the rotation tiers that
// placed an icon this month — emitted as ring chips so new tiers self-document.
function renderLegend(present, raidTracks) {
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
  if (raidTracks && raidTracks.size) {
    html += [...raidTracks.values()].map(t => {
      const meta = raidMeta(t.key);
      const ring = t.color ? ` style="--ring:${escapeHtml(t.color)}"` : '';
      return `<span class="lg"><i class="ring ${meta.cls}"${ring}></i>${escapeHtml(t.name || meta.label)}</span>`;
    }).join('');
  }
  box.innerHTML = html || '';
}

// Compact band of pulled-out events — 长期活动 (season / pass / multi-week) and
// PVP活动 (league / cups / battle weekends) — shown under the grid so the day
// cells stay focused on headline events. One renderer, reused for both bands.
function renderBand(boxId, title, list) {
  const box = $(boxId);
  if (!box) return;
  if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = `<span class="lt-title">${escapeHtml(title)}</span>`;
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
    bindCalendarReminder(pill, ev.id);
    pill.addEventListener('click', () => openDetail(ev, pill));
    box.appendChild(pill);
  });
}

// Weekly rotation tracks (5★ / Mega / Max) for the current month, from
// data/rotations.json. Three-column board (one column per track); the segment
// whose date window contains today is highlighted as 进行中.
function renderRotations() {
  const box = $('#rotations'); if (!box) return;
  const note = $('#rot-note');
  const data = localizedRotations();
  const tracks = (data && Array.isArray(data.tracks)) ? data.tracks : [];
  if (note) note.textContent = (data && data.note) ? data.note : '';
  box.innerHTML = '';
  if (!tracks.length) {
    box.innerHTML = `<p class="muted">${escapeHtml(i18n('rotation.empty', null, '本月轮换将在每日更新后显示。'))}</p>`;
    return;
  }
  // 三栏并列:每条轨道一列,列内纵向列出周段;当前日期落在 [start,end] 内的段高亮。
  // 「进行中」与日历同口径:parseDay 取本地零点,结束日含当天(inclusive)。
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const board = document.createElement('div');
  board.className = 'rot-board';
  tracks.forEach(tr => {
    const color = tr.color || '#b08a44';
    const col = document.createElement('div');
    col.className = 'rot-col';
    col.style.setProperty('--c', color);
    const head = document.createElement('div');
    head.className = 'rot-col-head';
    head.innerHTML = `<span class="rot-dot"></span><span class="rot-col-name">${escapeHtml(tr.label || '')}</span>`;
    col.appendChild(head);
    (tr.segments || []).forEach(seg => {
      const sd = parseDay(seg.start);
      const ed = parseDay(seg.end) || sd;
      const active = !!sd && sd <= today && today <= ed;
      const cell = document.createElement('div');

      // 列宽锁死:sprite 封顶 4 个 + 折叠 +N;≥5 只降级缩小、名称改用段标题(完整名单进 tooltip)。
      // 「进行中」沿用上面 parseDay/today 的同口径判断,语义不变。
      const mons = seg.pokemon || [];
      const CAP = 4;                  // 直接显示的最大 sprite 数
      const many = mons.length >= 5;  // 触发缩小 + 语义化标题
      const sprHtml = mons.slice(0, CAP).map(p => {
        const sp = monSprite(p);
        if (!sp) return '';
        return linkSprite(`<img class="spr" src="${escapeHtml(sp)}" alt="${escapeHtml(p.name || '')}" loading="lazy" onerror="this.style.display='none'">`, p);
      }).join('');
      const overflow = mons.length > CAP
        ? `<span class="rot-more">+${mons.length - CAP}</span>` : '';
      const fullNames = mons.map(p => p.name).filter(Boolean).join('、');
      // 优先用 curated 段名(seg.cn 已是短标题,且保留「超级/原始」与双 Boss 信息);
      // 仅当它缺失时,多只回退「传说轮替 ×N」、单只回退首只名。完整名单始终进 tooltip。
      const label = seg.cn || seg.name
        || (many ? i18n('rotation.multi', { count: mons.length }, `传说轮替 ×${mons.length}`) : ((mons[0] && mons[0].name) || ''));
      const range = (seg.start || seg.end)
        ? `<span class="rot-range">${escapeHtml(fmtDateShort(seg.start))}${seg.end && seg.end !== seg.start ? '–' + escapeHtml(fmtDateShort(seg.end)) : ''}</span>`
        : '';
      cell.className = 'rot-seg' + (active ? ' now' : '') + (many ? ' multi' : '');
      cell.innerHTML =
        `<div class="rot-spr">${sprHtml}${overflow}</div>`
        + `<div class="rot-txt"><span class="rot-name" title="${escapeHtml(fullNames)}">${escapeHtml(label)}</span>${range}</div>`
        + (active ? `<span class="rot-now">${escapeHtml(i18n('rotation.active', null, '进行中'))}</span>` : '');
      col.appendChild(cell);
    });
    board.appendChild(col);
  });
  box.appendChild(board);
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
    `<img class="ico" src="assets/icons/${escapeHtml(ICONS[n] || (n + '.png'))}" alt="" onerror="this.style.display='none'">`);
}
function openDetail(ev, opener, preserve = false) {
  const panelBefore = $('#event-detail'), scroll = panelBefore.scrollTop;
  const oldWidget = document.querySelector('.detail-reminder');
  const keepWidget = oldWidget && oldWidget.dataset.id === ev.id;
  const focused = document.activeElement, selection = focused?.tagName === 'TEXTAREA'
    ? [focused.selectionStart, focused.selectionEnd] : null;
  if (!keepWidget) flushReminderEditor();
  detailEvent = state.events.find(e => e.id === ev.id) || ev;
  ev = localizedEvent(detailEvent);
  const active = document.activeElement;
  detailReturnFocus = opener || (active && active !== document.body ? active : detailReturnFocus);
  const panel = $('#event-detail');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', ev.name || i18n('drawer.label', null, '活动详情'));
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
    // 精灵图网格:section 可带 mons[](条目形状同 pokemon[]/counters[]:{id|sprite, name?, shiny?, hub?})。
    // 渲染为无 caption、可点击跳 Hub 的图标;name 只作 alt/title(hover),绝不显示为文字/技能。
    const grid = (s.mons || []).filter(m => m && (m.id || m.name || m.sprite)).map(m => {
      const sp = monSprite(m);
      if (!sp) return '';
      const img = `<img class="spr" src="${escapeHtml(sp)}" alt="${escapeHtml(m.name || '')}" title="${escapeHtml(m.name || '')}" loading="lazy" onerror="this.style.display='none'">`;
      return `<span class="spr-cell">${linkSprite(img, m)}${m.shiny ? '<span class="shiny">✨</span>' : ''}</span>`;
    }).join('');
    const items = (s.items || []).map(it => `<li>${iconify(it)}</li>`).join('');
    const body = (grid ? `<div class="spr-grid">${grid}</div>` : '')
      + (items ? `<ul>${items}</ul>` : (s.body ? `<p>${iconify(s.body)}</p>` : ''));
    return `<details><summary>${escapeHtml(s.title)}</summary><div class="det-body">${body}</div></details>`;
  }).join('');
  // Prefer the aggregated multi-source links[]; fall back to the legacy single link.
  const linkList = (ev.links && ev.links.length) ? ev.links
    : (ev.link ? [{ label: i18n('source.eventPage', null, '活动页'), url: ev.link }] : []);
  const links = linkList
    .filter(l => l && l.url)
    .map((l, i) => `<a class="btn ${i === 0 ? 'btn-primary' : ''}" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(localizedSourceLabel(l.label) || i18n('source.link', null, '链接'))} ↗</a>`)
    .join('');
  $('#detail-body').innerHTML = `
    <span class="detail-cat" style="--c:${cat.color}">${escapeHtml(cat.label)}</span>
    ${ev.image ? `<img class="detail-img" src="${escapeHtml(ev.image)}" alt="">` : ''}
    <h3>${escapeHtml(ev.name)}</h3>
    <p class="muted">${escapeHtml(ev.heading || ev.type || '')} · ${escapeHtml(fmtRange(ev.start, ev.end))}</p>
    <div class="detail-reminder-mount"></div>
    ${ev.summary ? `<p class="detail-summary">${escapeHtml(ev.summary)}</p>` : ''}
    ${mons ? `<div class="mon-row">${mons}</div>` : ''}
    ${bonuses ? `<h4>${escapeHtml(i18n('drawer.bonuses', null, '加成'))}</h4><ul>${bonuses}</ul>` : ''}
    ${counters ? `<details><summary>${escapeHtml(i18n('drawer.counters', null, '团战 Counter'))}</summary><div class="det-body">${counters}</div></details>` : ''}
    ${sections}
    ${links ? `<div class="detail-links">${links}</div>` : ''}
  `;
  if (reminders && ev.id && (state.events.some(e => e.id === ev.id) || reminders.get(ev.id))) {
    const widget = keepWidget ? oldWidget : createReminderControls(ev.id);
    $('#detail-body .detail-reminder-mount').append(widget); syncReminderControls(widget);
  }
  panel.hidden = false;
  linkifySprites($('#detail-body'));
  if (preserve) {
    panel.scrollTop = scroll;
    if (focused?.isConnected && selection) { focused.focus({ preventScroll:true }); focused.setSelectionRange(...selection); }
  } else { const close = $('#detail-close'); if (close) close.focus(); }
  reminderScheduler?.wake();
}

/* ---------- Mega Evolution reference (view-mega) ------------------------------
 * Owner feature, not the daily agent's: a Pokémon picker + detail card that
 * DERIVES every value from one variable — `initialCost` in data/mega.json —
 * via the MEGA_* mechanics constants above. The agent only appends roster rows;
 * all logic lives here. Sprites are linked inline (linkSprite), so this survives
 * re-renders on each selection without re-running linkifySprites. */
function megaTypeIcons(types) {
  return (types || []).map(t =>
    `<img class="ico" src="assets/icons/${escapeHtml(ICONS[t] || (t + '.png'))}" alt="${escapeHtml(t)}" title="${escapeHtml(t)}" onerror="this.style.display='none'">`
  ).join('');
}
/* Planner: given how many times the selected Pokémon has already Mega-Evolved,
 * compare the three real routes to each remaining level — wait out the full rest
 * period for free (7/5/3 d), pay the prorated re-activation price once per day
 * (level progress caps at 1/day, so this is the fastest mega-based route), or
 * buy the level instantly (exact MEGA_LEVELUP prices). Daily-mode costs are
 * estimates: the in-rest price decays linearly with remaining rest time and the
 * game's rounding is unverified, so we show ceil(cost·(rest−1)/rest) with ≈. */
let megaPlanN = 0;        // "已超级进化次数" — kept across selections on purpose
let megaCurrent = null;   // entry currently shown in #mega-detail

function megaDailyStep(cost, lvl) {
  return Math.ceil(MEGA_ENERGY[cost][lvl] * (MEGA_REST[lvl] - 1) / MEGA_REST[lvl]);
}
// Aggregate one route from `n` activations done up to `target` total activations.
function megaPlanTo(cost, n, target) {
  const known = cost != null && !!MEGA_ENERGY[cost];
  const waits = {};                      // rest-length → count, e.g. {7:6, 5:23}
  let waitDays = 0, dailyDays = 0, dailyEnergy = 0, firstCost = 0;
  for (let k = n + 1; k <= target; k++) {
    const lvl = megaLevelAfter(k - 1);   // level during the wait before activation #k
    if (!lvl) { firstCost = known ? cost : null; continue; }   // #1 is instant, full price
    waitDays += MEGA_REST[lvl];
    waits[MEGA_REST[lvl]] = (waits[MEGA_REST[lvl]] || 0) + 1;
    dailyDays += 1;
    if (known) dailyEnergy += megaDailyStep(cost, lvl);
  }
  return { steps: Math.max(0, target - n), waitDays, waits, dailyDays,
           // with zero paid re-activations left, 0 is exact even for an unknown tier
           dailyEnergy: (known || dailyDays === 0) ? dailyEnergy : null, firstCost };
}
// Exact instant price to reach `key` from `n` activations done (null = unknown tier).
// From n = 0 the first activation (full initial cost) must happen first, then the
// row for "1 time Mega Evolved" applies — both are folded into the returned total.
function megaInstantCost(cost, n, key) {
  // At Max the Super-Max buy-in is the flat 5,000 in BOTH groups — tier-independent.
  if (key === 'superMax' && n >= MEGA_NEED.max) return 5000;
  if (cost == null || !MEGA_ENERGY[cost]) return null;
  const arr = MEGA_LEVELUP[megaGroup(cost)][key];
  const i = Math.max(n, 1) - 1;
  return i < arr.length ? arr[i] + (n < 1 ? cost : 0) : null;
}
function megaLevelLabel(key) {
  const row = MEGA_LEVELS.find(x => x.key === key);
  return row ? i18n(row.labelKey, null, row.label) : key;
}
function megaDisplayName(entry) { return isEnglish() ? (entry.en || entry.name) : entry.name; }
function megaWaitBreakdown(waits) {
  return Object.keys(waits).sort((a, b) => b - a).map(d =>
    i18n('mega.waitPart', { count: waits[d], days: d }, `${waits[d]}×${d}天`)).join(' + ');
}
function megaEnergyText(v) {
  return v == null ? i18n('mega.pending', null, '待定')
    : i18n('mega.energyAmount', { amount: megaComma(v) }, `${megaComma(v)} 能量`);
}
function megaDays(v) { return i18n('mega.days', { count: v }, `${v} 天`); }
function megaBonusValue(row, value, index) {
  if (value == null) return '—';
  return i18n(`mega.bonusValue.${row.key}.${index}`, null, String(value));
}
function megaPlanHtml(entry, n) {
  const cost = entry.initialCost;
  const known = cost != null && !!MEGA_ENERGY[cost];
  const lvl = megaLevelAfter(n);

  let status;
  if (!lvl) {
    status = known
      ? i18nRich('mega.status.noneKnown', { energy: megaComma(cost) }, `尚未进行首次超级进化——首次消耗 ${megaComma(cost)} 能量，已计入下表全部路线。`)
      : i18nRich('mega.status.noneUnknown', null, '尚未进行首次超级进化。');
  } else if (lvl === 'max') {
    status = i18nRich('mega.status.max', { level: megaLevelLabel('max'), count: MEGA_NEED.max, days: MEGA_REST.max },
      `当前等级：<strong>${megaLevelLabel('max')}</strong>（第 ${MEGA_NEED.max} 次已达成）· 本级休息期 ${MEGA_REST.max} 天`);
  } else {
    const next = lvl === 'base' ? 'high' : 'max';
    status = i18nRich('mega.status.progress', {
      level: megaLevelLabel(lvl), next: megaLevelLabel(next), count: MEGA_NEED[next] - n, days: MEGA_REST[lvl],
    }, `当前等级：<strong>${megaLevelLabel(lvl)}</strong> · 距${megaLevelLabel(next)}还差 ${MEGA_NEED[next] - n} 次 · 本级休息期 ${MEGA_REST[lvl]} 天`);
  }

  const targets = [];
  if (n < MEGA_NEED.high) targets.push({ key: 'high', need: MEGA_NEED.high, plus: 0 });
  if (n < MEGA_NEED.max) targets.push({ key: 'max', need: MEGA_NEED.max, plus: 0 });
  if (entry.superMax) targets.push({ key: 'superMax', need: MEGA_NEED.max, plus: 5000 });

  let html = `<p class="muted mega-plan-status">${status}</p>`;
  if (!targets.length) {
    html += `<p class="muted">${escapeHtml(entry.superMax
      ? i18n('mega.complete', null, '已达最高等级，没有可继续提升的目标。')
      : i18n('mega.completeNoSuper', null, '已达最高等级，没有可继续提升的目标（该宝可梦暂不开放超级最高）。'))}</p>`;
    return html;
  }

  const cell = (title, energy, breakdown) => `<td><div class="mp-t">${escapeHtml(title)}</div>`
    + (breakdown ? `<div class="mp-b">${escapeHtml(breakdown)}</div>` : '')
    + `<div class="mp-e">${escapeHtml(energy)}</div></td>`;
  const rows = targets.map(t => {
    const plan = megaPlanTo(cost, n, t.need);
    const extra = plan.firstCost == null ? null : plan.firstCost + t.plus;
    const need = plan.steps
      ? i18n('mega.needEvolutions', { count: plan.steps, extra: t.plus ? i18n('mega.plus5000', null, ' + 5,000 能量') : '' }, `${plan.steps} 次进化${t.plus ? ' + 5,000 能量' : ''}`)
      : (t.plus ? i18n('mega.energy5000', null, '5,000 能量') : '—');
    const waitTitle = plan.waitDays ? megaDays(plan.waitDays) : i18n('mega.now', null, '立即');
    const waitBreakdown = plan.waitDays ? megaWaitBreakdown(plan.waits) : '';
    const waitEnergy = extra == null ? i18n('mega.pending', null, '待定') : (extra ? megaEnergyText(extra) : i18n('mega.free', null, '免费'));
    const dailyTitle = plan.dailyDays ? megaDays(plan.dailyDays) : i18n('mega.now', null, '立即');
    const dailyEnergy = (plan.dailyEnergy == null || extra == null)
      ? i18n('mega.pending', null, '待定')
      : (plan.dailyEnergy ? '≈' : '') + megaEnergyText(plan.dailyEnergy + extra);
    const instant = megaInstantCost(cost, n, t.key);
    return `<tr><th>${escapeHtml(megaLevelLabel(t.key))}<div class="mp-b">${escapeHtml(i18n('mega.nth', { count: t.need }, `第 ${t.need} 次`))}${t.plus ? escapeHtml(i18n('mega.plusEnergy', null, ' + 能量')) : ''}</div></th>`
      + `<td>${escapeHtml(need)}</td>`
      + cell(waitTitle, waitEnergy, waitBreakdown)
      + cell(dailyTitle, dailyEnergy)
      + cell(i18n('mega.now', null, '立即'), megaEnergyText(instant))
      + '</tr>';
  }).join('');
  html += `<div class="mega-scroll"><table class="mega-cost-table mega-plan-table"><thead>`
    + `<tr><th>${escapeHtml(i18n('mega.targetLevel', null, '目标等级'))}</th><th>${escapeHtml(i18n('mega.remaining', null, '还需'))}</th>`
    + `<th>${escapeHtml(i18n('mega.waitOnly', null, '只等休息期'))}<div class="mp-b">${escapeHtml(i18n('mega.freeSlow', null, '免费·最慢'))}</div></th>`
    + `<th>${escapeHtml(i18n('mega.dailyPaid', null, '每天付费进化一次'))}<div class="mp-b">${escapeHtml(i18n('mega.compromise', null, '折中·1 次/天'))}</div></th>`
    + `<th>${escapeHtml(i18n('mega.instantUpgrade', null, '立即升级'))}<div class="mp-b">${escapeHtml(i18n('mega.fastest', null, '最快·最贵'))}</div></th></tr>`
    + `</thead><tbody>${rows}</tbody></table></div>`;

  if (n < MEGA_NEED.max) {
    let steps = '';
    for (let k = n + 1; k <= MEGA_NEED.max; k++) {
      const l0 = megaLevelAfter(k - 1);
      steps += l0
        ? `<tr><th>${escapeHtml(i18n('mega.nth', { count: k }, `第 ${k} 次`))}</th><td>${escapeHtml(megaLevelLabel(l0))}</td><td>${escapeHtml(megaDays(MEGA_REST[l0]))}</td>`
          + `<td>${known ? '≈' + megaComma(megaDailyStep(cost, l0)) : escapeHtml(i18n('mega.pending', null, '待定'))}</td></tr>`
        : `<tr><th>${escapeHtml(i18n('mega.nth', { count: 1 }, '第 1 次'))}</th><td>—</td><td>${escapeHtml(i18n('mega.noWait', null, '无需等待'))}</td>`
          + `<td>${known ? megaComma(cost) + escapeHtml(i18n('mega.firstFull', null, '（首次全额）')) : escapeHtml(i18n('mega.pending', null, '待定'))}</td></tr>`;
    }
    html += `<details class="mega-remega"><summary>${escapeHtml(i18n('mega.stepDetails', { from: n + 1, to: MEGA_NEED.max }, `逐次明细（第 ${n + 1}–${MEGA_NEED.max} 次）`))}</summary>`
      + `<div class="mega-scroll"><table class="mega-cost-table"><thead>`
      + `<tr><th>${escapeHtml(i18n('mega.count', null, '次数'))}</th><th>${escapeHtml(i18n('mega.duringLevel', null, '期间等级'))}</th>`
      + `<th>${escapeHtml(i18n('mega.freeWait', null, '免费需等'))}</th><th>${escapeHtml(i18n('mega.after24', null, '等 24 小时后进化 ≈能量'))}</th></tr>`
      + `</thead><tbody>${steps}</tbody></table></div></details>`;
  }

  html += `<ul class="muted mega-plan-notes">`
    + `<li>${i18nRich('mega.note.progress', null, '等级进度每天最多累计 1 次：休息期内反复花能量再进化<strong>不会</strong>更快升级，「立即升级」是唯一的加速通道。')}</li>`
    + `<li>${escapeHtml(i18n('mega.note.estimate', null, '「每天付费一次」为估算：休息期内再进化的费用随剩余时间线性递减（此处按等满 24 小时折算并向上取整），实际取整以游戏内显示为准。'))}</li>`
    + (entry.superMax
      ? `<li>${escapeHtml(i18n('mega.note.super', null, '超级最高：达到最高等级后一次性消耗 5,000 能量解锁；三条路线均已计入这 5,000。'))}</li>`
      : `<li>${escapeHtml(i18n('mega.note.noSuper', null, '该宝可梦暂不开放超级最高等级，故无此目标行。'))}</li>`)
    + `</ul>`;
  return html;
}

function renderMegaDetail(entry) {
  const box = $('#mega-detail');
  if (!box) return;
  megaCurrent = entry || null;
  if (!entry) { box.innerHTML = `<p class="muted">${escapeHtml(i18n('mega.noData', null, '暂无超级进化数据。'))}</p>`; return; }
  const name = megaDisplayName(entry);
  const cost = entry.initialCost == null ? null : entry.initialCost;
  const energy = cost != null ? MEGA_ENERGY[cost] : null;
  const levels = entry.superMax ? MEGA_LEVELS : MEGA_LEVELS.slice(0, -1);
  const img = `<img class="mon-icon" src="${escapeHtml(monSprite(entry))}" alt="${escapeHtml(name)}" loading="lazy" onerror="this.style.visibility='hidden'">`;
  const costText = cost == null ? i18n('mega.pending', null, '待定') : megaEnergyText(cost);
  const secondary = isEnglish() ? '' : entry.en;
  const header = `<div class="mega-header">${linkSprite(img, entry)}<div class="mega-head-txt">`
    + `<h3>${escapeHtml(name)}${entry.variant ? ` <span class="mega-var">${escapeHtml(entry.variant)}</span>` : ''}</h3>`
    + `<p class="muted">${escapeHtml(secondary || '')}${entry.release ? ' · ' + escapeHtml(entry.release) : ''}</p>`
    + `<div class="mega-types">${megaTypeIcons(entry.boostedTypes)}</div>`
    + `<span class="badge mega-cost">${escapeHtml(i18n('mega.firstCost', { cost: costText }, `首次进化消耗 ${costText}`))}</span>`
    + (entry.superMax ? ` <span class="badge mega-cost">${escapeHtml(i18n('mega.superEligible', null, '可达超级最高'))}</span>` : '')
    + `</div></div>`;

  const planner = `<h4>${escapeHtml(i18n('mega.plannerTitle', null, '升级规划器（按当前进度动态比较）'))}</h4>`
    + `<div class="mega-plan-bar"><span>${escapeHtml(i18n('mega.evolvedCount', null, '已超级进化次数'))}</span>`
    + `<button type="button" class="btn mega-step" data-d="-1" aria-label="${escapeHtml(i18n('mega.minusOne', null, '减一'))}">−</button>`
    + `<input id="mega-plan-n" type="number" inputmode="numeric" min="0" max="30" step="1" value="${megaPlanN}">`
    + `<button type="button" class="btn mega-step" data-d="1" aria-label="${escapeHtml(i18n('mega.plusOne', null, '加一'))}">+</button>`
    + `<span class="muted">${escapeHtml(i18n('mega.planHint', null, '（0 = 还没进化过，30 = 已满）'))}</span></div>`
    + `<div id="mega-plan-out">${megaPlanHtml(entry, megaPlanN)}</div>`;

  const head = `<tr><th>${escapeHtml(i18n('mega.levelHeader', null, 'Mega 等级'))}</th>${levels.map(x => `<th>${escapeHtml(megaLevelLabel(x.key))}</th>`).join('')}</tr>`;
  const energyTable = energy
    ? `<table class="mega-cost-table"><thead>${head}</thead><tbody><tr><th>${escapeHtml(i18n('mega.elevationEnergy', null, '升华所需能量'))}</th>`
      + levels.map(x => `<td>${megaComma(energy[x.key])}</td>`).join('') + `</tr></tbody></table>`
    : `<p class="muted">${escapeHtml(i18n('mega.unknownEnergy', null, '升华所需能量：待定（该宝可梦尚无已知的首次消耗档位）。'))}</p>`;

  const bonusTable = `<table class="mega-cost-table"><thead>${head}</thead><tbody>`
    + MEGA_LEVEL_BONUSES.map(row => `<tr><th>${escapeHtml(i18n(`mega.bonus.${row.key}`, null, row.label))}</th>`
      + row.vals.slice(0, levels.length).map((value, i) => `<td>${escapeHtml(megaBonusValue(row, value, i))}</td>`).join('') + '</tr>').join('')
    + `</tbody></table>`;

  let levelup = '';
  if (energy) {
    const group = MEGA_LEVELUP[megaGroup(cost)];
    const cols = [{ key:'high' }, { key:'max' }];
    if (entry.superMax) cols.push({ key:'superMax' });
    let rows = '';
    for (let i = 0; i < 30; i++) {
      rows += `<tr><th>${i + 1}</th>` + cols.map(col => {
        const arr = group[col.key], value = arr && i < arr.length ? arr[i] : null;
        return `<td>${value == null ? '—' : megaComma(value)}</td>`;
      }).join('') + '</tr>';
    }
    const tier = megaGroup(cost) === 'sm' ? '100 / 200' : '300 / 400 / 7500';
    levelup = `<details class="mega-remega"><summary>${escapeHtml(i18n('mega.instantTable', null, '立即升级价目表 — 按「已超级进化次数」查询（第 1–30 次）'))}</summary>`
      + `<div class="mega-scroll"><table class="mega-cost-table"><thead><tr><th>${escapeHtml(i18n('mega.count', null, '次数'))}</th>`
      + cols.map(col => `<th>${escapeHtml(megaLevelLabel(col.key))}</th>`).join('') + `</tr></thead><tbody>${rows}</tbody></table></div>`
      + `<p class="muted">${escapeHtml(i18n('mega.instantExplain', { tier }, `花超级能量把 Mega 等级一步买到该档（2026-05-18 起开放），即上方规划器「立即升级」列的完整价目。按初始费用分档：此为 ${tier} 组。「—」= 该次数下等级已自然达成。`))}</p></details>`;
  }

  const source = `<p class="muted mega-src">${escapeHtml(i18n('mega.source', null, '数据来源：'))}<a href="https://bulbapedia.bulbagarden.net/wiki/Mega_Evolution_(GO)" target="_blank" rel="noopener noreferrer">Bulbapedia — Mega Evolution (GO)</a>${escapeHtml(i18n('mega.sourceChecked', null, '（机制常量核对于 2026-07）。'))}</p>`;
  box.innerHTML = header + planner
    + `<h4>${escapeHtml(i18n('mega.staticTables', null, '静态查询表'))}</h4>` + source
    + `<h5>${escapeHtml(i18n('mega.energyTitle', null, '各等级升华所需超级能量'))}</h5>${energyTable}`
    + `<h5>${escapeHtml(i18n('mega.bonusTitle', null, '各等级加成（全宝可梦通用）'))}</h5>${bonusTable}`
    + levelup;
}
function renderMega() {
  const list = state.mega || [];
  const sel = $('#mega-select');
  let selected = megaCurrent ? list.indexOf(megaCurrent) : 0;
  if (selected < 0) selected = 0;
  if (sel) {
    const prior = Number.isFinite(+sel.value) ? +sel.value : selected;
    selected = Math.max(0, Math.min(list.length - 1, prior));
    sel.innerHTML = list.map((m, i) => `<option value="${i}">${escapeHtml(megaDisplayName(m))}</option>`).join('');
    if (list.length) sel.value = String(selected);
  }
  const overview = $('#mega-overview');
  if (overview) {
    if (!list.length) {
      overview.innerHTML = `<p class="muted">${escapeHtml(i18n('mega.noData', null, '暂无超级进化数据。'))}</p>`;
    } else {
      const rows = list.map((m, i) => {
        const name = megaDisplayName(m);
        const secondary = isEnglish() ? '' : m.en;
        const img = `<img class="spr" src="${escapeHtml(monSprite(m))}" alt="${escapeHtml(name)}" loading="lazy" onerror="this.style.visibility='hidden'">`;
        const cost = m.initialCost == null ? i18n('mega.pending', null, '待定') : megaComma(m.initialCost);
        return `<tr data-mega-idx="${i}"><td class="mega-ov-spr">${linkSprite(img, m)}</td>`
          + `<td class="mega-ov-name">${escapeHtml(name)}<div class="muted mega-ov-en">${escapeHtml(secondary || '')}</div></td>`
          + `<td class="mega-ov-types">${megaTypeIcons(m.boostedTypes)}</td><td class="mega-ov-cost">${escapeHtml(cost)}</td>`
          + `<td class="mega-ov-rel">${escapeHtml(m.release || '—')}</td></tr>`;
      }).join('');
      overview.innerHTML = `<div class="mega-scroll"><table class="mega-cost-table mega-overview-table"><thead><tr>`
        + `<th>${escapeHtml(i18n('mega.table.sprite', null, '精灵'))}</th><th>${escapeHtml(i18n('mega.table.name', null, '名称'))}</th>`
        + `<th>${escapeHtml(i18n('mega.table.types', null, '加成属性'))}</th><th>${escapeHtml(i18n('mega.table.initial', null, '首次消耗'))}</th>`
        + `<th>${escapeHtml(i18n('mega.table.release', null, '发布日期'))}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
  }
  renderMegaDetail(list[selected]);
}

function megaClampN(v) { return Math.max(0, Math.min(30, Math.floor(+v || 0))); }
function updateMegaPlan() {
  const out = $('#mega-plan-out');
  if (out && megaCurrent) out.innerHTML = megaPlanHtml(megaCurrent, megaPlanN);
}
function setupMega() {
  const sel = $('#mega-select');
  if (sel) sel.addEventListener('change', () => renderMegaDetail((state.mega || [])[+sel.value]));
  const det = $('#mega-detail');
  if (det) {
    // Delegated: #mega-detail's innerHTML is replaced on every selection change,
    // so the stepper/input can't hold their own listeners. Only #mega-plan-out is
    // re-rendered on count edits, keeping the input focused while typing.
    det.addEventListener('click', e => {
      const b = e.target.closest('.mega-step');
      if (!b) return;
      const inp = $('#mega-plan-n');
      if (!inp) return;
      megaPlanN = megaClampN((+inp.value || 0) + +b.getAttribute('data-d'));
      inp.value = String(megaPlanN);
      updateMegaPlan();
    });
    det.addEventListener('input', e => {
      if (!e.target || e.target.id !== 'mega-plan-n') return;
      megaPlanN = megaClampN(e.target.value);
      updateMegaPlan();
    });
    det.addEventListener('change', e => {          // normalize out-of-range typing on blur
      if (!e.target || e.target.id !== 'mega-plan-n') return;
      e.target.value = String(megaPlanN);
    });
  }
  const ov = $('#mega-overview');
  if (ov) ov.addEventListener('click', e => {
    if (e.target.closest('a')) return;               // let sprite → hub links work
    const tr = e.target.closest('tr[data-mega-idx]');
    if (!tr) return;
    const i = +tr.getAttribute('data-mega-idx');
    if (sel) sel.value = String(i);
    renderMegaDetail((state.mega || [])[i]);
    const d = $('#mega-detail');
    if (d && d.scrollIntoView) d.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
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
const WC_LOCK = {
  'zh-CN': { 1:'锁区', 2:'部分可玩' },
  en: { 1:'Unavailable', 2:'Partly playable' },
};
const WC_NOTE = {
  'zh-CN': {
    cn: '中国大陆官方使用 UTC+8（北京时间）。多数内地城市为空地图，海南、东北、新疆及粤/桂部分口岸附近有可玩区域。',
    ru: 'Niantic 已暂停俄罗斯的游玩，社区普遍视为锁区。',
    by: '与俄罗斯同批被 Niantic 暂停游玩，社区视为锁区。',
  },
  en: {
    cn: 'Mainland China officially uses UTC+8 (China Standard Time). Most inland cities have an empty map; limited play areas exist near some borders and coastal regions.',
    ru: 'Niantic has suspended gameplay in Russia; the community generally treats it as unavailable.',
    by: 'Gameplay was suspended alongside Russia; the community generally treats it as unavailable.',
  },
};
const WC_WD = {
  'zh-CN': { Mon:'一', Tue:'二', Wed:'三', Thu:'四', Fri:'五', Sat:'六', Sun:'日' },
  en: { Mon:'Mon', Tue:'Tue', Wed:'Wed', Thu:'Thu', Fri:'Fri', Sat:'Sat', Sun:'Sun' },
};
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
  ['台北车站 Taipei Main Station','台湾(中国) · 台北','tw','Asia/Taipei','raid-only 老热点;现强度有争议', 25.0478, 121.5173],
  ['Dubai Marina 迪拜码头','阿联酋 · 迪拜','ae','Asia/Dubai','catch event 强,主要靠 lures', 25.0805, 55.1403],
  ['Plaza de Europa','西班牙 · 萨拉戈萨','es','Europe/Madrid','spawn density 高', 41.6488, -0.8891],
  ['Margaret Island 玛格丽特岛','匈牙利 · 布达佩斯','hu','Europe/Budapest','有人觉得比 Zara 好,证据较弱', 47.5278, 19.0506],
  ['Ibirapuera Park 伊比拉普埃拉公园','巴西 · 圣保罗','br','America/Sao_Paulo','stops + 重 lures;活动日 catch 强', -23.5874, -46.6576],
  ['Bryant Park / Central Park / Times Square','美国 · 纽约','us','America/New_York','spawn + lure + raid 强(NYC)', 40.7536, -73.9832],
  ['Lincoln Park / City of Dallas','美国 · 芝加哥 / 达拉斯','us','America/Chicago','Go Fest / city play;非自然 density', 41.9214, -87.6513],
  ['Calle República de El Salvador 21','墨西哥 · 墨西哥城 CDMX','mx','America/Mexico_City','疑似社区热点;stops / gyms 密集', 19.4316, -99.1336],
  ['PIER 39 / Union Square','美国 · 旧金山','us','America/Los_Angeles','传统 pier 热点;评价分裂', 37.8087, -122.4098],
  ['Honolulu / 416 cookie','美国 · 夏威夷檀香山','us','Pacific/Honolulu','最后尾巴时区', 21.2793, -157.8294],
];

const WC_SPOTS_EN = {
  'Pacific/Auckland': ['Wellington Botanic Garden / Auckland', 'New Zealand · Wellington / Auckland', 'Earliest major time-zone starting point; useful for event and raid rollouts'],
  'Australia/Sydney': ['Sydney Opera House area', 'Australia · Sydney', 'Early-zone raid and event option'],
  'Asia/Tokyo': ['Shibuya / Shinjuku', 'Japan · Tokyo', 'Major hotspot used for GO Fest, raids, and city play'],
  'Asia/Taipei': ['Taipei Main Station', 'Taiwan · Taipei', 'Long-running raid hotspot; current activity is debated'],
  'Asia/Dubai': ['Dubai Marina', 'United Arab Emirates · Dubai', 'Strong catch-event area, driven mainly by Lures'],
  'Europe/Madrid': ['Plaza de Europa', 'Spain · Zaragoza', 'High spawn density'],
  'Europe/Budapest': ['Margaret Island', 'Hungary · Budapest', 'Sometimes rated above Zaragoza; evidence is mixed'],
  'America/Sao_Paulo': ['Ibirapuera Park', 'Brazil · São Paulo', 'Dense PokéStops and heavy Lure use; strong on event days'],
  'America/New_York': ['Bryant Park / Central Park / Times Square', 'United States · New York City', 'Strong spawns, Lures, and raids'],
  'America/Chicago': ['Lincoln Park / City of Dallas', 'United States · Chicago / Dallas', 'GO Fest and city play; density is event-dependent'],
  'America/Mexico_City': ['Calle República de El Salvador 21', 'Mexico · Mexico City', 'Community hotspot with dense PokéStops and Gyms'],
  'America/Los_Angeles': ['PIER 39 / Union Square', 'United States · San Francisco', 'Traditional pier hotspot; current reviews are mixed'],
  'Pacific/Honolulu': ['Honolulu / 416 cookie', 'United States · Honolulu, Hawaii', 'One of the final practical event time zones'],
};
function wcZoneLabel(zone) {
  const tail = String(zone || '').split('/').slice(1).join(' / ') || zone || '';
  return tail.replace(/_/g, ' ');
}
function wcCountryName(cc, fallback) {
  if (!isEnglish()) return fallback;
  try { return new Intl.DisplayNames(['en'], { type:'region' }).of(String(cc).toUpperCase()) || fallback; }
  catch (e) { return fallback; }
}
function wcSpotText(spot) {
  if (!isEnglish()) return { name:spot[0], place:spot[1], note:spot[4] };
  const en = WC_SPOTS_EN[spot[3]];
  return en ? { name:en[0], place:en[1], note:en[2] }
    : { name:wcZoneLabel(spot[3]), place:wcCountryName(spot[2], spot[1]), note:'' };
}
function wcWeekday(code) { return (WC_WD[state.locale] || WC_WD['zh-CN'])[code] || ''; }
function wcDayDelta(delta) {
  if (delta > 0) return i18n('clock.nextDay', null, '次日');
  if (delta < 0) return i18n('clock.previousDay', null, '昨日');
  return '';
}

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


/* ---------- Spot Atlas timezone helpers -------------------------------------
 * Intl can format an instant in an IANA zone, but it cannot directly turn a
 * local wall-clock value into an instant. Keep that conversion here, pure and
 * dependency-free, so browser rendering and Node fixtures exercise the same
 * DST/half-hour-aware implementation. */
const spotPartFormatters = new Map();
const validIanaTimeZones = new Set();
function isValidIanaTimeZone(zone) {
  if (typeof zone !== 'string' || !zone.trim()) return false;
  if (validIanaTimeZones.has(zone)) return true;
  try { new Intl.DateTimeFormat('en-US', { timeZone:zone }).format(0); validIanaTimeZones.add(zone); return true; }
  catch (e) { return false; }
}
function detectBrowserTimeZone(resolver) {
  try {
    const browserTimeZone = resolver
      ? resolver()
      : Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidIanaTimeZone(browserTimeZone)) return { timeZone:browserTimeZone, fallback:false };
  } catch (e) { /* explicit UTC fallback below */ }
  return { timeZone:'UTC', fallback:true };
}
function spotPartsFormatter(timeZone) {
  if (!isValidIanaTimeZone(timeZone)) throw new RangeError(`Invalid IANA time zone: ${timeZone}`);
  let formatter = spotPartFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
      timeZone, calendar:'iso8601', numberingSystem:'latn', hourCycle:'h23',
      year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit',
    });
    spotPartFormatters.set(timeZone, formatter);
  }
  return formatter;
}
function spotZonedParts(instant, timeZone) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (isNaN(date.getTime())) throw new RangeError('Invalid instant');
  const values = {};
  spotPartsFormatter(timeZone).formatToParts(date).forEach(part => {
    if (part.type !== 'literal') values[part.type] = part.value;
  });
  const year = +values.year, month = +values.month, day = +values.day;
  const hour = (+values.hour) % 24, minute = +values.minute, second = +values.second;
  const isoWeekday = ((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1;
  return { year, month, day, hour, minute, second, isoWeekday };
}
function spotWallStamp(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
}
function spotSameWall(a, b) {
  return a.year === b.year && a.month === b.month && a.day === b.day
    && (a.hour || 0) === (b.hour || 0) && (a.minute || 0) === (b.minute || 0)
    && (a.second || 0) === (b.second || 0);
}
function timeZoneOffsetMinutes(instant, timeZone) {
  const date = instant instanceof Date ? instant : new Date(instant);
  const parts = spotZonedParts(date, timeZone);
  const wholeSecond = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((spotWallStamp(parts) - wholeSecond) / 60000);
}
function zonedWallTimeToInstant(wall, timeZone) {
  const wanted = {
    year:+wall.year, month:+wall.month, day:+wall.day,
    hour:+wall.hour || 0, minute:+wall.minute || 0, second:+wall.second || 0,
  };
  const wantedStamp = spotWallStamp(wanted);
  if (!isFinite(wantedStamp)) throw new RangeError('Invalid wall-clock time');

  // Candidate offsets sampled on both sides of the date cover ordinary and
  // transition-day offsets. Exact matches are unique normally; during a fold,
  // choose the earlier instant (Temporal-compatible disambiguation).
  const offsets = new Set();
  [-48,-36,-24,-12,0,12,24,36,48].forEach(hours => {
    offsets.add(timeZoneOffsetMinutes(new Date(wantedStamp + hours * 3600000), timeZone));
  });
  const exact = [];
  offsets.forEach(offset => {
    const candidate = new Date(wantedStamp - offset * 60000);
    if (spotSameWall(spotZonedParts(candidate, timeZone), wanted)) exact.push(candidate);
  });
  if (exact.length) return new Date(Math.min(...exact.map(date => date.getTime())));

  // A nonexistent wall time (spring-forward gap) is moved forward by the gap,
  // matching Temporal's "compatible" behavior. This slow path is transition-
  // only; Spot Atlas's Tuesday 20:00 schedule always takes the exact path.
  let best = null, bestDelta = Infinity;
  for (let minute = -36 * 60; minute <= 36 * 60; minute++) {
    const candidate = new Date(wantedStamp + minute * 60000);
    const delta = spotWallStamp(spotZonedParts(candidate, timeZone)) - wantedStamp;
    if (delta >= 0 && (delta < bestDelta || (delta === bestDelta && (!best || candidate < best)))) {
      best = candidate; bestDelta = delta;
    }
  }
  if (!best) throw new RangeError(`Cannot resolve wall-clock time in ${timeZone}`);
  return best;
}
function spotAddLocalDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year:date.getUTCFullYear(), month:date.getUTCMonth() + 1, day:date.getUTCDate() };
}
function nextLocalScheduleInstant(nowInstant, locationZone, schedule) {
  const now = nowInstant instanceof Date ? new Date(nowInstant.getTime()) : new Date(nowInstant);
  if (isNaN(now.getTime())) throw new RangeError('Invalid current instant');
  const isoWeekday = Number(schedule && schedule.isoWeekday);
  const hour = Number(schedule && schedule.hour), minute = Number(schedule && schedule.minute);
  if (!Number.isInteger(isoWeekday) || isoWeekday < 1 || isoWeekday > 7
      || !Number.isInteger(hour) || hour < 0 || hour > 23
      || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new RangeError('Invalid schedule');
  }
  const localNow = spotZonedParts(now, locationZone);
  const deltaDays = (isoWeekday - localNow.isoWeekday + 7) % 7;
  let localDate = spotAddLocalDays(localNow, deltaDays);
  let target = zonedWallTimeToInstant(Object.assign(localDate, { hour, minute, second:0 }), locationZone);
  if (target.getTime() < now.getTime()) {
    localDate = spotAddLocalDays(localDate, 7);
    target = zonedWallTimeToInstant(Object.assign(localDate, { hour, minute, second:0 }), locationZone);
  }
  return target;
}
function formatTargetForZone(targetInstant, displayZone, locale) {
  const date = targetInstant instanceof Date ? targetInstant : new Date(targetInstant);
  const parts = spotZonedParts(date, displayZone);
  const localeTag = locale === 'en' ? 'en-US' : 'zh-CN';
  const weekday = new Intl.DateTimeFormat(localeTag, { timeZone:displayZone, weekday:'short' }).format(date);
  const dateText = `${parts.year}-${wcPad(parts.month)}-${wcPad(parts.day)}`;
  const time = `${wcPad(parts.hour)}:${wcPad(parts.minute)}`;
  return {
    date:dateText, weekday, time, timeZone:displayZone,
    offsetMinutes:timeZoneOffsetMinutes(date, displayZone),
    text:`${dateText} ${weekday} ${time}`,
  };
}
/* ---------- Event timing (separate from parseDay's calendar grid) ---------
 * No current-offset arithmetic. The last global zone is fixed UTC−12, NOT
 * Etc/GMT-12 (which means UTC+12). Task 4 consumes these pure values. */
function parseEventTime(value) {
  if (typeof value !== 'string') return { error:'missing/invalid date-time string' };
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (!m) return { error:'expected YYYY-MM-DD or complete ISO date-time with optional offset' };
  const year = +m[1], month = +m[2], day = +m[3], hour = +(m[4] || 0), minute = +(m[5] || 0);
  const second = +(m[6] || 0), millisecond = +(m[7] || '0').padEnd(3, '0');
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59)
    return { error:'invalid calendar date or clock time' };
  const stamp = new Date(0);
  stamp.setUTCFullYear(year, month - 1, day);
  stamp.setUTCHours(hour, minute, second, millisecond);
  if (stamp.getUTCFullYear() !== year || stamp.getUTCMonth() + 1 !== month || stamp.getUTCDate() !== day)
    return { error:'invalid calendar date (no overflow normalization)' };
  const offset = m[8] || null;
  let offsetMinutes = 0;
  if (offset && offset !== 'Z') {
    const h = +offset.slice(1, 3), min = +offset.slice(4, 6);
    if (h > 14 || min > 59 || (h === 14 && min !== 0)) return { error:'invalid numeric UTC offset' };
    offsetMinutes = (offset[0] === '-' ? -1 : 1) * (h * 60 + min);
  }
  return { parts:{ year, month, day, hour, minute, second, millisecond }, date:value.slice(0, 10),
    hasTime:!!m[4], hasOffset:!!offset, offset,
    instant:offset ? new Date(stamp.getTime() - offsetMinutes * 60000) : null };
}
function validateEventTiming(event, options) {
  const errors = [];
  if (!event || typeof event !== 'object') return ['event must be an object'];
  const t = event.timing;
  // Read-only migration compatibility; neither daily gate enables allowLegacy.
  if (!t) return options && options.allowLegacy ? [] : ['timing is required'];
  if (typeof t !== 'object' || Array.isArray(t) || Object.keys(t).some(k =>
    !['scope','mode','startPrecision','endPrecision','timeZone'].includes(k))) return ['invalid timing fields'];
  if (!['global','regional','unknown'].includes(t.scope)) errors.push('invalid timing.scope');
  if (!['local','absolute','unknown'].includes(t.mode)) errors.push('invalid timing.mode');
  for (const field of ['startPrecision','endPrecision']) {
    if (!['exact','date','unknown'].includes(t[field])) errors.push(`invalid timing.${field}`);
  }
  if (t.mode === 'local' && t.scope === 'regional') {
    if (!isValidIanaTimeZone(t.timeZone)) errors.push('regional local requires a single-venue IANA timeZone');
  } else if (Object.prototype.hasOwnProperty.call(t, 'timeZone')) errors.push('timeZone only valid for regional local');
  const start = parseEventTime(event.start), end = event.end == null ? null : parseEventTime(event.end);
  if (start.error) errors.push(`start: ${start.error}`);
  if (end && end.error) errors.push(`end: ${end.error}`);
  if (!end && t.endPrecision !== 'unknown') errors.push('missing end requires unknown endPrecision');
  for (const [name, boundary] of [['start',start],['end',end]]) {
    if (!boundary || boundary.error || t[`${name}Precision`] !== 'exact') continue;
    if (!boundary.hasTime) errors.push(`${name} exact needs a clock time`);
    if (t.mode === 'absolute' && !boundary.hasOffset) errors.push(`${name} absolute exact needs Z/numeric offset`);
    if (t.mode === 'local' && boundary.hasOffset) errors.push(`${name} local exact needs offset-free wall time`);
  }
  if (!start.error && end && !end.error) {
    if (t.mode === 'local' && end.date < start.date) errors.push('end wall date precedes start');
    if (t.mode !== 'unknown' && t.startPrecision === 'exact' && t.endPrecision === 'exact') {
      const a = t.mode === 'absolute' ? start.instant?.getTime() : spotWallStamp(start.parts) + start.parts.millisecond;
      const b = t.mode === 'absolute' ? end.instant?.getTime() : spotWallStamp(end.parts) + end.parts.millisecond;
      if (Number.isFinite(a) && Number.isFinite(b) && b <= a) errors.push('end must follow start (half-open interval)');
    } else if (t.startPrecision === 'date' && t.endPrecision === 'date' && end.date < start.date)
      errors.push('end date precedes start date');
  }
  return errors;
}
function resolveEventTiming(event, now, viewerTimeZone) {
  const errors = validateEventTiming(event);
  const timeZone = viewerTimeZone == null ? (typeof document === 'undefined' ? 'UTC' : detectBrowserTimeZone().timeZone) : viewerTimeZone;
  if (!isValidIanaTimeZone(timeZone)) errors.push(`invalid viewer IANA time zone: ${timeZone}`);
  const result = { openAt:null, closeAt:null, viewerWindow:{start:null,end:null}, viewerTimeZone:timeZone,
    status:'unknown', reason:null };
  if (errors.length) { result.status='error'; result.reason=errors.join('; '); return result; }
  const current = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(current.getTime())) { result.status='error'; result.reason='invalid now instant'; return result; }
  const t = event.timing;
  function fromWall(wall, zone) {
    return new Date(zonedWallTimeToInstant(wall, zone).getTime() + wall.millisecond);
  }
  function boundary(name) {
    if (t[`${name}Precision`] !== 'exact') return null;
    const b = parseEventTime(event[name]);
    if (t.mode === 'absolute') return b.instant;
    if (t.mode !== 'local' || t.scope === 'unknown') return null; // known clock, no safe instant
    if (t.scope === 'regional') return fromWall(b.parts, t.timeZone);
    return name === 'start' ? fromWall(b.parts, 'Pacific/Kiritimati')
      : new Date(spotWallStamp(b.parts) + b.parts.millisecond + 12 * 3600000); // fixed UTC−12
  }
  function display(name, reminderInstant) {
    if (!reminderInstant) return null;
    const instant = t.mode === 'local' && t.scope === 'global'
      ? fromWall(parseEventTime(event[name]).parts, timeZone) : reminderInstant;
    return { instant, ...formatTargetForZone(instant, timeZone, 'en') };
  }
  try {
    result.openAt = boundary('start'); result.closeAt = boundary('end');
    result.viewerWindow.start = display('start', result.openAt);
    result.viewerWindow.end = display('end', result.closeAt);
  } catch (error) {
    result.openAt=null; result.closeAt=null; result.viewerWindow={start:null,end:null};
    result.status='error'; result.reason=`time-zone conversion failed: ${error.message}`; return result;
  }
  if (result.openAt && result.closeAt && result.closeAt <= result.openAt) {
    result.status='error'; result.reason='resolved end must follow start'; return result;
  }
  const ms = current.getTime();
  if (result.closeAt && ms >= result.closeAt.getTime()) result.status='expired';
  else if (result.openAt && ms < result.openAt.getTime()) result.status='upcoming';
  else if (result.openAt) result.status='active';
  else result.reason='start instant unavailable; scope, time mechanism or precision unresolved';
  if (!result.closeAt && result.status !== 'unknown') result.reason='exact end unavailable; no automatic expiry';
  return result;
}
/* ---------- Personal event reminders (independent of TODO / daily data) ---------- */
const REMINDER_PREFIX = 'pogo-event-reminders:v1:';
const REMINDER_LEGACY_KEY = 'pogo-event-reminders';
const REMINDER_NOTE_LIMIT = 500;
function reminderNote(text) { return Array.from(String(text || '')).slice(0, REMINDER_NOTE_LIMIT).join(''); }
function reminderTimeSnapshot(event) {
  if (!event || validateEventTiming(event).length) return null;
  const { scope, mode, startPrecision, endPrecision, timeZone } = event.timing;
  const time = { start:event.start, end:event.end == null ? null : event.end,
    timing:{ scope, mode, startPrecision, endPrecision, ...(timeZone ? { timeZone } : {}) } };
  return { ...time, fingerprint:JSON.stringify(time) };
}
function decodeReminder(raw, id) {
  try {
    const r = JSON.parse(raw);
    const stamp = n => Number.isFinite(n) && n >= 0 && n <= 8640000000000000;
    if (!r || r.v !== 1 || r.id !== id || typeof r.token !== 'string' || !r.token || r.token.length > 120
      || !stamp(r.starredAt) || (r.completedAt !== null && !stamp(r.completedAt))
      || typeof r.note !== 'string' || Array.from(r.note).length > REMINDER_NOTE_LIMIT) return null;
    const time = r.time == null ? null : reminderTimeSnapshot(r.time);
    if (r.time != null && (!time || time.fingerprint !== r.time.fingerprint)) return null;
    return { v:1, id, token:r.token, starredAt:r.starredAt, completedAt:r.completedAt, note:r.note,
      names:{ 'zh-CN':typeof r.names?.['zh-CN'] === 'string' ? r.names['zh-CN'] : '',
        en:typeof r.names?.en === 'string' ? r.names.en : '' }, time };
  } catch (e) { return null; }
}
function deriveEventReminder(record, canonical, now, viewerTimeZone) {
  const event = canonical || record?.time;
  const time = event ? resolveEventTiming(event, now, viewerTimeZone)
    : { openAt:null, closeAt:null, viewerWindow:{start:null,end:null}, status:'unknown' };
  const expired = time.status === 'expired';
  const flagged = !!record && !expired, completed = flagged && record.completedAt !== null;
  return { ...time, flagged, completed, expired, active:flagged && !completed && time.status === 'active',
    canComplete:flagged && !completed && time.status === 'active', canUndo:completed,
    hasCanonical:!!canonical };
}
// Per-event keys avoid cross-event lost updates even with simultaneous tabs.
// Every mutation rereads that key; an incarnation token prevents a delayed note
// from recreating a deleted (or deleted-and-restarred) reminder. No shared index.
function createEventReminderStore(options = {}) {
  const now = options.now || Date.now;
  const zone = options.viewerTimeZone || (() => detectBrowserTimeZone().timeZone);
  const storage = () => typeof options.storage === 'function' ? options.storage() : (options.storage || localStorage);
  const token = options.token || (() => globalThis.crypto?.randomUUID?.() || `${now()}-${Math.random().toString(36).slice(2)}`);
  let records = new Map(), canonical = new Map(), names = new Map(), rawById = new Map();
  let unavailable = false, legacyIsolated = false;
  const volatile = new Map(), isolated = new Set();
  const key = id => REMINDER_PREFIX + encodeURIComponent(id);
  function accept(id, raw) {
    const r = raw === null ? null : decodeReminder(raw, id);
    if (raw !== null && !r) isolated.add(id); else isolated.delete(id);
    rawById.set(id, raw);
    const local = volatile.get(id);
    if (local && local.baseRaw !== raw) volatile.delete(id); // a newer successful tab write wins
    const current = volatile.has(id) ? volatile.get(id).record : r;
    if (current) records.set(id, current); else records.delete(id);
    return current;
  }
  function sync() {
    try {
      const s = storage(), found = new Map();
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (!k?.startsWith(REMINDER_PREFIX)) continue;
        let id;
        try { id = decodeURIComponent(k.slice(REMINDER_PREFIX.length)); }
        catch (e) { isolated.add(k); continue; }
        if (!id || key(id) !== k) { isolated.add(k); continue; }
        found.set(id, s.getItem(k));
      }
      for (const id of new Set([...records.keys(), ...rawById.keys(), ...found.keys()])) accept(id, found.get(id) ?? null);
      unavailable = false;
    } catch (e) { unavailable = true; } // never replace a usable session with a partial read
    return records;
  }
  function fresh(id) {
    try { const raw = storage().getItem(key(id)); unavailable = false; return accept(id, raw); }
    catch (e) { unavailable = true; return records.get(id) || null; }
  }
  function write(id, next) {
    const raw = rawById.get(id) ?? null, body = next ? JSON.stringify(next) : null;
    try {
      if (isolated.has(id)) throw new Error('isolated record'); // keep unsupported/corrupt bytes untouched
      const s = storage();
      const latest = s.getItem(key(id));
      if (latest !== raw) { accept(id, latest); return { ok:false, reason:'changed' }; }
      if (body !== raw) { if (next) s.setItem(key(id), body); else s.removeItem(key(id)); }
      rawById.set(id, body); volatile.delete(id); unavailable = false;
    } catch (e) { volatile.set(id, { baseRaw:raw, record:next }); unavailable = true; }
    if (next) records.set(id, next); else records.delete(id);
    return { ok:true, persisted:!volatile.has(id), record:next };
  }
  function authoritative(id, record) {
    const event = canonical.get(id);
    if (!event || !record) return record;
    // A successful canonical withdrawal replaces the old snapshot, including null.
    return { ...record, time:reminderTimeSnapshot(event), names:names.get(id) || record.names };
  }
  function viewFor(id, r) {
    // Flagged records already carry the latest successfully loaded snapshot.
    // Old tabs must not put their stale canonical times back during calibration.
    return { ...deriveEventReminder(r, r ? null : canonical.get(id), now(), zone()), hasCanonical:canonical.has(id) };
  }
  function mutate(id, expectedToken, change, sourceLoaded = false) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = fresh(id), r = sourceLoaded ? authoritative(id, latest) : latest;
      if (expectedToken && r?.token !== expectedToken) return { ok:false, reason:'missing' };
      const view = viewFor(id, r);
      if (view.expired) {
        if (r && write(id, null).reason === 'changed') continue;
        return { ok:false, reason:'expired' };
      }
      const next = change(r, view);
      if (next === undefined) return { ok:false, reason:'unavailable' };
      const result = write(id, next);
      if (result.reason !== 'changed') return result;
    }
    return { ok:false, reason:'changed' };
  }
  function refresh() {
    sync();
    for (const id of [...records.keys()]) {
      mutate(id, records.get(id).token, r => r || undefined);
    }
    // Retry a session-only deletion if storage recovers, but never delete a
    // different successful incarnation written by another tab meanwhile.
    for (const [id, local] of volatile) if (local.record === null) {
      fresh(id);
      if (volatile.get(id)?.record === null) write(id, null);
    }
    return records;
  }
  function setEvents(events, englishNames = {}) {
    if (!Array.isArray(events)) return; // failed loads are not authoritative withdrawal
    const valid = events.filter(e => e && typeof e.id === 'string' && e.id);
    canonical = new Map(valid.map(e => [e.id, e]));
    names = new Map(valid.map(e => [e.id, { 'zh-CN':e.name || '', en:englishNames[e.id]?.name || '' }]));
    sync();
    for (const [id, r] of [...records]) mutate(id, r.token, latest => latest || undefined, true);
    refresh();
  }
  function migrate() {
    let s, raw;
    try { s = storage(); raw = s.getItem(REMINDER_LEGACY_KEY); }
    catch (e) { unavailable = true; return; }
    if (raw === null) return;
    try {
      const old = JSON.parse(raw);
      if (old?.v !== 0 || !old.events || typeof old.events !== 'object' || Array.isArray(old.events)) {
        legacyIsolated = true; return;
      }
      let complete = true;
      for (const [id, r] of Object.entries(old.events)) {
        if (!id || !r || !Number.isFinite(r.starredAt) || typeof r.note !== 'string') { complete = false; continue; }
        if (s.getItem(key(id)) !== null) continue; // never overwrite a newer version / other tab
        const row = { v:1, id, token:token(), starredAt:r.starredAt,
          completedAt:Number.isFinite(r.completedAt) ? r.completedAt : null, note:reminderNote(r.note),
          names:{ 'zh-CN':r.name || '', en:r.enName || '' }, time:reminderTimeSnapshot(r.time) };
        if (!decodeReminder(JSON.stringify(row), id)) { complete = false; continue; }
        accept(id, null);
        if (!write(id, row).persisted) complete = false;
      }
      if (complete) s.removeItem(REMINDER_LEGACY_KEY); else legacyIsolated = true;
    } catch (e) { legacyIsolated = true; } // unknown versions remain isolated, never touch TODO
  }
  sync(); migrate(); sync();
  return {
    sync, refresh, setEvents,
    get:id => records.get(id) || null,
    entries:() => [...records.entries()],
    view:id => viewFor(id, records.get(id)),
    status:() => ({ unpersisted:unavailable || volatile.size > 0, isolated:legacyIsolated || isolated.size > 0 }),
    star:id => mutate(id, null, r => r || (canonical.has(id) ? { v:1, id, token:token(), starredAt:now(),
      completedAt:null, note:'', names:names.get(id), time:reminderTimeSnapshot(canonical.get(id)) } : undefined)),
    remove:(id, expectedToken) => mutate(id, expectedToken, r => r ? null : undefined),
    note:(id, text, expectedToken) => mutate(id, expectedToken, r => r ? { ...r, note:reminderNote(text) } : undefined),
    complete:(id, done, expectedToken) => mutate(id, expectedToken, (r, view) =>
      r && (done ? view.canComplete : view.canUndo) ? { ...r, completedAt:done ? now() : null } : undefined),
  };
}
function createReminderNoteSaver(store, options = {}) {
  const later = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
  const drafts = new Map();
  function flush(id) {
    const draft = drafts.get(id); if (!draft || draft.composing) return;
    cancel(draft.timer); drafts.delete(id);
    const result = store.note(id, draft.note, draft.token);
    if (result.reason === 'changed') { draft.timer = null; drafts.set(id, draft); }
    if (options.onSave) options.onSave(id, result);
    return result;
  }
  return {
    input(id, token, note, composing = false) {
      const old = drafts.get(id); if (old) cancel(old.timer);
      const draft = { token, note, composing, timer:null }; drafts.set(id, draft);
      if (!composing) draft.timer = later(() => flush(id), options.delay ?? 350);
    },
    flush, flushAll:() => [...drafts.keys()].forEach(flush),
    pending:id => drafts.get(id),
    cancel(id) { const draft = drafts.get(id); if (draft) cancel(draft.timer); drafts.delete(id); },
    cancelMissing() {
      for (const [id, d] of drafts) if (store.get(id)?.token !== d.token || !store.view(id).flagged) this.cancel(id);
    },
  };
}
// One boundary timer, capped at 30s to notice clock / IANA changes. Always read
// now again after wake; no ticking counters or per-event animation timers.
function createReminderScheduler(options) {
  const now = options.now || Date.now, later = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
  let timer = null;
  function pause() { if (timer !== null) cancel(timer); timer = null; }
  function wake() {
    pause();
    if (options.isHidden?.()) return;
    const before = now();
    options.refresh();
    const current = now(), future = options.boundaries().filter(t => Number.isFinite(t) && t > before);
    const delay = Math.max(1, Math.min(30000, ...future.map(t => t - current)));
    timer = later(wake, delay);
  }
  return { wake, pause };
}

// Half-open [start, end) on a 24h clock, hour granularity: 「结束」exclusive
// (end may be 24 = 当日结束). Wraps past midnight when start > end; start === end → empty.
function wcInRange(h, start, end) {
  if (start === end) return false;
  return start < end ? (h >= start && h < end) : (h >= start || h < end);
}
// 本机当前时间 + 浏览器检测到的时区。随 renderWorldClock 的分钟 tick 一起刷新。
function renderWcNow(now) {
  const el = $('#wc-now'); if (!el) return;
  let zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  const weekday = new Intl.DateTimeFormat(isEnglish() ? 'en-US' : 'zh-CN', { weekday:'short' }).format(now);
  el.innerHTML = `<span class="wc-now-label muted">${escapeHtml(i18n('clock.yourLocalTime', null, '你的当地时间'))}</span>`
    + `<span class="wc-now-time">${wcPad(now.getHours())}:${wcPad(now.getMinutes())}</span>`
    + `<span class="wc-now-wd muted">${escapeHtml(weekday)}</span>`
    + `<span class="wc-off">${wcFmtOffset(-now.getTimezoneOffset())}</span>`
    + (zone ? `<span class="wc-now-zone muted">${escapeHtml(zone)}</span>` : '');
}
function renderWorldClock() {
  const startSel = $('#wc-start'), endSel = $('#wc-end'), box = $('#wc-results');
  if (!startSel || !endSel || !box) return;
  const start = +startSel.value, end = +endSel.value, now = new Date();
  renderWcNow(now);
  const groups = new Map();
  WC_DATA.forEach(row => {
    let computed; try { computed = wcCompute(row[3], now); } catch (e) { return; }
    if (wcActive && !wcInRange(computed.h, start, end)) return;
    if (!groups.has(computed.offset)) groups.set(computed.offset, { off:computed.offset, s:computed, items:[] });
    groups.get(computed.offset).items.push({
      country: wcCountryName(row[2], row[0]),
      city: isEnglish() ? wcZoneLabel(row[3]) : row[1],
      cc: row[2], lock: row[4] || 0,
    });
  });
  const groupsSorted = [...groups.values()].sort((a, b) => b.off - a.off);
  const total = groupsSorted.reduce((n, group) => n + group.items.length, 0);
  const summary = $('#wc-summary');
  if (summary) summary.textContent = wcActive
    ? i18n('clock.rangeSummary', { start:wcPad(start), end:wcPad(end), zones:groupsSorted.length, places:total }, `当地 ${wcPad(start)}:00–${wcPad(end)}:00 · 命中 ${groupsSorted.length} 个时区 / ${total} 个地区`)
    : i18n('clock.allSummary', { zones:groupsSorted.length }, `全部时段 · ${groupsSorted.length} 个时区（最早 → 最晚）`);
  const notes = WC_NOTE[state.locale] || WC_NOTE['zh-CN'];
  const locks = WC_LOCK[state.locale] || WC_LOCK['zh-CN'];
  const compareLocale = isEnglish() ? 'en' : 'zh-Hans';
  box.innerHTML = groupsSorted.length ? groupsSorted.map(group => {
    const delta = wcDayDelta(group.s.dayDelta);
    const deltaHtml = delta ? ` <span class="wc-dd">${escapeHtml(delta)}</span>` : '';
    const items = group.items.slice().sort((a, b) => a.country.localeCompare(b.country, compareLocale)).map(item => {
      const note = notes[item.cc] ? ` title="${escapeHtml(notes[item.cc])}"` : '';
      const badge = item.lock ? `<span class="wc-lock l${item.lock}">${escapeHtml(locks[item.lock])}</span>` : '';
      return `<div class="wc-item${item.lock ? ' locked' : ''}"${note}>`
        + `<img class="wc-flag" src="https://flagcdn.com/w40/${item.cc}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
        + `<div class="wc-meta"><span class="wc-country">${escapeHtml(item.country)}</span>`
        + `<span class="wc-city">${escapeHtml(item.city)}</span></div>${badge}</div>`;
    }).join('');
    return `<div class="wc-group"><div class="wc-group-head"><span class="wc-time">${wcPad(group.s.h)}:${wcPad(group.s.m)}</span>`
      + `<span class="wc-off">${wcFmtOffset(group.off)}</span><span class="wc-wd muted">${escapeHtml(wcWeekday(group.s.wd))}${deltaHtml}</span>`
      + `<span class="wc-count muted">${group.items.length}</span></div><div class="wc-list">${items}</div></div>`;
  }).join('') : `<p class="muted" style="padding:1rem;text-align:center">${escapeHtml(i18n('clock.noMatches', null, '该时段暂无匹配的地区。'))}</p>`;
  renderWcSpots(start, end, now);
  renderWcPin(start, end, now);
  renderWcAxis(start, end, now);
}
function refreshWorldClockIfActive() {
  const view = $('#view-clock');
  if (view && view.classList.contains('active')) renderWorldClock();
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
// 精选地点侧栏:朴素平铺,按时区最早→最晚原序,不高亮/不淡显/不置顶;
// 保留 ✦ HH:MM–HH:MM(你的当地时段窗口)。「激活」强调只出现在悬浮条与时间轴。
function renderWcSpots(start, end, now) {
  const box = $('#wc-spots'); if (!box) return;
  const rows = WC_SPOTS.map(spot => {
    let computed; try { computed = wcCompute(spot[3], now); } catch (e) { computed = null; }
    return { spot, computed };
  }).filter(x => x.computed).sort((a, b) => b.computed.offset - a.computed.offset);
  box.innerHTML = `<div class="wc-spots-head"><span class="dia">◆</span><h3>${escapeHtml(i18n('clock.featured', null, '精选地点'))}</h3></div>`
    + '<div class="wc-spots-scroll">'
    + rows.map(({ spot, computed }) => {
      const text = wcSpotText(spot), delta = wcDayDelta(computed.dayDelta);
      const geo = `${spot[5].toFixed(4)}, ${spot[6].toFixed(4)}`;
      return `<div class="wc-spot"><div class="wc-spot-top">`
        + `<img class="wc-flag" src="https://flagcdn.com/w40/${spot[2]}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
        + `<span class="wc-spot-time">${wcPad(computed.h)}:${wcPad(computed.m)}</span><span class="wc-off">${wcFmtOffset(computed.offset)}</span>`
        + `<span class="wc-spot-wd muted">${escapeHtml(wcWeekday(computed.wd))}${delta ? ' ' + escapeHtml(delta) : ''}</span></div>`
        + `<div class="wc-spot-name">${escapeHtml(text.name)}</div>`
        + `<div class="wc-spot-sub muted">${escapeHtml(text.place)} · ${escapeHtml(spot[3])}</div>`
        + `<div class="wc-spot-note muted">${escapeHtml(text.note)}</div>`
        + `<div class="wc-spot-foot"><a class="wc-spot-geo" href="https://www.google.com/maps?q=${spot[5]},${spot[6]}" target="_blank" rel="noopener">📍 ${geo}</a>`
        + (wcActive ? `<span class="wc-spot-you" title="${escapeHtml(i18n('clock.yourWindowTitle', null, '你的当地时间（该地点处于所选时段时）'))}"><span class="dia">✦</span> ${wcUserWindow(computed.offset, start, end)}</span>` : '')
        + `</div></div>`;
    }).join('') + '</div>';
}
function renderWcPin(start, end, now) {
  const box = $('#wc-pin'); if (!box) return;
  const hot = WC_SPOTS.map(spot => {
    let computed; try { computed = wcCompute(spot[3], now); } catch (e) { computed = null; }
    return { spot, computed };
  }).filter(x => x.computed && wcActive && wcInRange(x.computed.h, start, end))
    .sort((a, b) => b.computed.offset - a.computed.offset);
  let inner;
  if (!wcActive) inner = `<div class="wc-pin-empty">${escapeHtml(i18n('clock.pinChoose', null, '选择上方时段后，正处于该时段的热点会固定显示在这里。'))}</div>`;
  else if (!hot.length) inner = `<div class="wc-pin-empty">${escapeHtml(i18n('clock.pinNone', { start:wcPad(start), end:wcPad(end) }, `当地 ${wcPad(start)}:00–${wcPad(end)}:00 暂无精选热点激活，试试相邻时段。`))}</div>`;
  else inner = '<div class="wc-pin-row">' + hot.map(({ spot, computed }) => {
    const text = wcSpotText(spot);
    return `<div class="wc-pinchip"><img class="wc-flag" src="https://flagcdn.com/w40/${spot[2]}.png" alt="" onerror="this.style.visibility='hidden'">`
      + `<span class="pc-time">${wcPad(computed.h)}:${wcPad(computed.m)}</span><div class="pc-body"><span class="pc-name">${escapeHtml(text.name)}</span>`
      + `<span class="pc-meta">${escapeHtml(text.place)} · ✦ <b>${wcUserWindow(computed.offset, start, end)}</b></span></div></div>`;
  }).join('') + '</div>';
  box.innerHTML = `<div class="wc-pin-label"><span class="dot"></span>${escapeHtml(i18n('clock.pinLabel', null, '现在激活 · 所选时段命中的热点'))}</div>` + inner;
}
function renderWcAxis(start, end, now) {
  const box = $('#wc-axis'); if (!box) return;
  const x = fraction => (1 - fraction) * 100;
  let ticks = '';
  for (let i = 0; i <= 24; i += 3) ticks += `<div class="wc-axis-tick" style="left:${x(i / 24)}%"><i></i><span>${wcPad(i % 24)}</span></div>`;
  let bands = '';
  if (wcActive && start !== end) {
    const segments = start < end ? [[start, end]] : [[start, 24], [0, end]];
    segments.forEach((segment, index) => {
      const f0 = segment[0] / 24, f1 = segment[1] / 24;
      bands += `<div class="wc-axis-band" style="left:${(1 - f1) * 100}%;width:${(f1 - f0) * 100}%">`
        + `${index === 0 ? `<span class="band-lbl">${escapeHtml(i18n('clock.selectedHours', { start:wcPad(start), end:wcPad(end) }, `所选 ${wcPad(start)}–${wcPad(end)} 点`))}</span>` : ''}</div>`;
    });
  }
  const rows = WC_SPOTS.map(spot => {
    let computed; try { computed = wcCompute(spot[3], now); } catch (e) { computed = null; }
    return { spot, computed };
  }).filter(x => x.computed).sort((a, b) => b.computed.offset - a.computed.offset);
  const pins = rows.map(({ spot, computed }, index) => {
    const hot = wcActive && wcInRange(computed.h, start, end);
    const cls = 'wc-pin2 ' + (index % 2 === 0 ? 'up' : 'down') + (hot ? ' hot' : (wcActive ? ' cool' : ''));
    const text = wcSpotText(spot);
    return `<div class="${cls}" style="left:${x((computed.h + computed.m / 60) / 24)}%" title="${escapeHtml(text.name)} · ${wcPad(computed.h)}:${wcPad(computed.m)}">`
      + `<div class="lab"><img class="wc-flag" src="https://flagcdn.com/w40/${spot[2]}.png" alt="" onerror="this.style.visibility='hidden'"><span class="pt">${wcPad(computed.h)}:${wcPad(computed.m)}</span></div>`
      + `<div class="stem"></div><div class="dot"></div></div>`;
  }).join('');
  box.innerHTML = `<div class="wc-axis"><div class="wc-axis-track"></div>${bands}${ticks}${pins}</div>`;
}

function setupWorldClock() {
  const startSel = $('#wc-start'), endSel = $('#wc-end'), allBtn = $('#wc-all');
  if (!startSel || !endSel) return;
  let startOpts = '', endOpts = '';
  for (let i = 0; i <= 23; i++) startOpts += `<option value="${i}">${wcPad(i)}:00</option>`;   // 起始 00:00–23:00
  for (let i = 1; i <= 24; i++) endOpts += `<option value="${i}">${wcPad(i)}:00</option>`;       // 结束 01:00–24:00(独占;24:00 = 当日结束)
  startSel.innerHTML = startOpts; endSel.innerHTML = endOpts;
  // restore last choice (range + mode) from localStorage; fall back to the 4–7 example
  let savedWc = {}; try { savedWc = JSON.parse(localStorage.getItem('wc-range') || '{}'); } catch (e) {}
  let sStart = savedWc.start != null ? savedWc.start : 4;
  let sEnd = savedWc.end != null ? savedWc.end : 7;
  if (sEnd === 0) sEnd = 24;                                 // migrate legacy「0 = 午夜」→ 24
  sStart = Math.min(Math.max(sStart | 0, 0), 23);
  sEnd = Math.min(Math.max(sEnd | 0, 1), 24);
  startSel.value = String(sStart);
  endSel.value = String(sEnd);
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
  // Refresh immediately when suspended timers resume; keep the existing foreground tick.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshWorldClockIfActive();
  });
  window.addEventListener('pageshow', refreshWorldClockIfActive);
  setInterval(refreshWorldClockIfActive, 30000);
}


/* ---------- Spot Atlas -------------------------------------------------------
 * locations.json owns stable facts only. Flags, offsets, target instants, map
 * URLs and browser-local display values are derived for each render. */
const SPOT_KIND_OPTIONS = ['gym','showcase','both'];
const SPOT_KIND_VALUES = ['', ...SPOT_KIND_OPTIONS];
const SPOT_SORT_VALUES = ['next','timezone','name','country','rating'];
const SPOT_KIND_STORAGE_KEY = 'pogo-spot-filter';
const SPOT_SORT_STORAGE_KEY = 'pogo-spot-sort';
let spotsCopyFeedback = null;
function spotCountryName(countryCode) {
  const code = String(countryCode || '').toUpperCase();
  try {
    return new Intl.DisplayNames([isEnglish() ? 'en' : 'zh-CN'], { type:'region' }).of(code) || code;
  } catch (e) { return code; }
}
function spotCountryFlag(countryCode) {
  const code = String(countryCode || '').toUpperCase();
  return /^[A-Z]{2}$/.test(code)
    ? String.fromCodePoint(...[...code].map(letter => 127397 + letter.charCodeAt(0))) : '';
}
function spotKindLabel(kind) {
  return i18n(`spots.kind.${kind}`, null, String(kind || '—'));
}
function spotStatusLabel(status) {
  return i18n(`spots.status.${status}`, null, String(status || '—'));
}
function spotCoordinates(spot) { return `${spot.lat}, ${spot.lng}`; }
function spotMapUrl(spot) {
  const params = new URLSearchParams({ is_login_event:'1', lat:String(spot.lat), lng:String(spot.lng) });
  return `https://pokemongo.com/map?${params}`;
}
function spotLoadPreferences(storage) {
  const preferences = { kind:'', sort:'next' };
  try {
    const store = storage || localStorage;
    const kind = store.getItem(SPOT_KIND_STORAGE_KEY);
    const sort = store.getItem(SPOT_SORT_STORAGE_KEY);
    if (SPOT_KIND_VALUES.includes(kind)) preferences.kind = kind;
    if (SPOT_SORT_VALUES.includes(sort)) preferences.sort = sort;
  } catch (e) { /* storage may be disabled */ }
  return preferences;
}
function spotSavePreferences(filters, storage) {
  try {
    const store = storage || localStorage;
    const kind = SPOT_KIND_VALUES.includes(filters.kind) ? filters.kind : '';
    const sort = SPOT_SORT_VALUES.includes(filters.sort) ? filters.sort : 'next';
    store.setItem(SPOT_KIND_STORAGE_KEY, kind);
    store.setItem(SPOT_SORT_STORAGE_KEY, sort);
  } catch (e) { /* storage may be disabled */ }
}
function spotSetOptions(select, rows, allLabel) {
  if (!select) return;
  const selected = select.value;
  select.textContent = '';
  const all = document.createElement('option'); all.value = ''; all.textContent = allLabel;
  select.appendChild(all);
  rows.forEach(row => {
    const option = document.createElement('option'); option.value = row.value; option.textContent = row.label;
    select.appendChild(option);
  });
  if ([...select.options].some(option => option.value === selected)) select.value = selected;
}
function renderSpotFilterOptions(spots) {
  const countries = [...new Set(spots.map(spot => spot.countryCode))]
    .map(code => ({ value:code, label:spotCountryName(code) }))
    .sort((a, b) => a.label.localeCompare(b.label, isEnglish() ? 'en' : 'zh-Hans'));
  const kinds = SPOT_KIND_OPTIONS.map(kind => ({ value:kind, label:spotKindLabel(kind) }));
  const statuses = [...new Set(spots.map(spot => spot.status))]
    .map(status => ({ value:status, label:spotStatusLabel(status) }));
  spotSetOptions($('#spots-country'), countries, i18n('spots.allCountries', null, '全部国家/地区'));
  spotSetOptions($('#spots-kind'), kinds, i18n('spots.allKinds', null, '全部类型'));
  spotSetOptions($('#spots-status'), statuses, i18n('spots.allStatuses', null, '全部状态'));
}
function spotView(spot, now, schedule, browserZone) {
  const target = nextLocalScheduleInstant(now, spot.timeZone, schedule);
  return {
    spot, target,
    country:spotCountryName(spot.countryCode),
    localNow:formatTargetForZone(now, spot.timeZone, state.locale),
    localTarget:formatTargetForZone(target, spot.timeZone, state.locale),
    browserTarget:formatTargetForZone(target, browserZone, state.locale),
    currentOffset:timeZoneOffsetMinutes(now, spot.timeZone),
  };
}
function spotFilterState() {
  return {
    search:($('#spots-search') && $('#spots-search').value || '').trim().toLocaleLowerCase(),
    country:$('#spots-country') && $('#spots-country').value || '',
    kind:$('#spots-kind') && $('#spots-kind').value || '',
    status:$('#spots-status') && $('#spots-status').value || '',
    review:$('#spots-review') && $('#spots-review').value || '',
    sort:$('#spots-sort') && $('#spots-sort').value || 'next',
  };
}
function spotMatches(view, filters) {
  const spot = view.spot;
  if (filters.country && spot.countryCode !== filters.country) return false;
  if (filters.kind && spot.kind !== filters.kind) return false;
  if (filters.status && spot.status !== filters.status) return false;
  if (filters.review === 'yes' && !spot.needsReview) return false;
  if (filters.review === 'no' && spot.needsReview) return false;
  if (filters.search) {
    const haystack = [spot.name, spot.note, spot.countryCode, view.country, spot.timeZone]
      .join(' ').toLocaleLowerCase();
    if (!haystack.includes(filters.search)) return false;
  }
  return true;
}
function sortSpotViews(views, mode) {
  const locale = isEnglish() ? 'en' : 'zh-Hans';
  const tie = (a, b) => a.country.localeCompare(b.country, locale)
    || a.spot.name.localeCompare(b.spot.name, locale)
    || a.spot.id.localeCompare(b.spot.id, locale);
  return views.sort((a, b) => {
    if (mode === 'timezone') return b.currentOffset - a.currentOffset || tie(a, b);
    if (mode === 'name') return a.spot.name.localeCompare(b.spot.name, locale)
      || a.spot.id.localeCompare(b.spot.id, locale);
    if (mode === 'country') return tie(a, b);
    if (mode === 'rating') {
      const ar = a.spot.rating == null ? -Infinity : +a.spot.rating;
      const br = b.spot.rating == null ? -Infinity : +b.spot.rating;
      return br - ar || a.target - b.target || tie(a, b);
    }
    return a.target - b.target || tie(a, b);
  });
}
function spotRatingStars(rating) {
  return [1,2,3].includes(rating) ? '⭐'.repeat(rating) : '';
}
function spotNoteBlock(note) {
  if (!note) return '';
  return `<div class="spots-note"><span class="spots-label">${escapeHtml(i18n('spots.note', null, '备注'))}</span>`
    + `<p>${escapeHtml(note)}</p></div>`;
}
function spotTimeBlock(label, value, extraClass) {
  return `<div class="spots-time ${extraClass || ''}"><span class="spots-label">${escapeHtml(label)}</span>`
    + `<strong>${escapeHtml(value.text)}</strong></div>`;
}
function renderSpots() {
  const results = $('#spots-results'), summary = $('#spots-summary');
  if (!results || !summary) return;
  const browser = detectBrowserTimeZone();
  const now = new Date();
  if (!state.locations) {
    summary.innerHTML = `<span class="spots-error">${escapeHtml(i18n('spots.loadError', null, '地点数据加载失败。'))}</span>`;
    results.innerHTML = `<div class="spots-empty panel">${escapeHtml(i18n('spots.loadErrorHint', null, '请稍后重新加载页面。'))}</div>`;
    return;
  }

  const spots = state.locations.spots || [];
  renderSpotFilterOptions(spots);
  const filters = spotFilterState();
  const views = [];
  spots.forEach(spot => {
    try { views.push(spotView(spot, now, state.locations.schedule, browser.timeZone)); }
    catch (error) { console.warn('Spot Atlas skipped invalid row', spot && spot.id, error); }
  });
  const filtered = sortSpotViews(views.filter(view => spotMatches(view, filters)), filters.sort);
  const browserNow = formatTargetForZone(now, browser.timeZone, state.locale);
  const zoneText = browser.fallback
    ? i18n('spots.timeZoneFallback', { zone:browser.timeZone }, `${browser.timeZone}（检测失败，已回退）`)
    : browser.timeZone;
  summary.innerHTML = `<div class="spots-summary-item"><span>${escapeHtml(i18n('spots.browserNow', null, '浏览器当前时间'))}</span><strong>${escapeHtml(browserNow.text)}</strong></div>`
    + `<div class="spots-summary-item"><span>${escapeHtml(i18n('spots.browserZone', null, '浏览器 IANA timezone'))}</span><strong${browser.fallback ? ' class="spots-fallback"' : ''}>${escapeHtml(zoneText)}</strong></div>`
    + `<div class="spots-summary-item"><span>${escapeHtml(i18n('spots.total', null, '数据点总数'))}</span><strong>${views.length}</strong></div>`
    + `<div class="spots-summary-item"><span>${escapeHtml(i18n('spots.filtered', null, '筛选后点数'))}</span><strong>${filtered.length}</strong></div>`;

  const feedback = $('#spots-feedback');
  if (feedback) feedback.textContent = spotsCopyFeedback && spotsCopyFeedback.until > Date.now()
    ? i18n(spotsCopyFeedback.key, null, spotsCopyFeedback.key === 'spots.copySuccess' ? '坐标已复制。' : '复制失败。') : '';
  if (!filtered.length) {
    results.innerHTML = `<div class="spots-empty panel">${escapeHtml(i18n('spots.empty', null, '没有符合当前筛选条件的地点。'))}</div>`;
    return;
  }
  results.innerHTML = filtered.map(view => {
    const spot = view.spot, coords = spotCoordinates(spot);
    const copied = spotsCopyFeedback && spotsCopyFeedback.id === spot.id
      && spotsCopyFeedback.key === 'spots.copySuccess' && spotsCopyFeedback.until > Date.now();
    const reviewLabel = spot.needsReview
      ? i18n('spots.needsReview', null, '待复核') : i18n('spots.reviewed', null, '已复核');
    const rating = spotRatingStars(spot.rating);
    const ratingFact = rating ? `<div><dt>${escapeHtml(i18n('spots.rating', null, '评分'))}</dt><dd>${rating}</dd></div>` : '';
    return `<article class="spots-card panel" data-spot-id="${escapeHtml(spot.id)}">`
      + `<header class="spots-card-head"><span class="spots-flag" role="img" aria-label="${escapeHtml(view.country)}">${spotCountryFlag(spot.countryCode)}</span>`
      + `<div class="spots-title"><span class="spots-country">${escapeHtml(view.country)}</span><h3>${escapeHtml(spot.name)}</h3></div>`
      + `<div class="spots-badges"><span class="badge">${escapeHtml(spotKindLabel(spot.kind))}</span>`
      + `<span class="badge spots-status-${escapeHtml(spot.status)}">${escapeHtml(spotStatusLabel(spot.status))}</span>`
      + `<span class="badge ${spot.needsReview ? 'spots-review-needed' : 'spots-review-ok'}">${escapeHtml(reviewLabel)}</span></div></header>`
      + `<dl class="spots-facts">${ratingFact}`
      + `<div><dt>${escapeHtml(i18n('spots.coordinates', null, '经纬度'))}</dt><dd><code>${escapeHtml(coords)}</code></dd></div>`
      + `<div><dt>${escapeHtml(i18n('spots.locationZone', null, '地点 timezone'))}</dt><dd><code>${escapeHtml(spot.timeZone)}</code></dd></div>`
      + `<div><dt>${escapeHtml(i18n('spots.currentOffset', null, '当前 UTC offset'))}</dt><dd>${escapeHtml(wcFmtOffset(view.currentOffset))}</dd></div></dl>`
      + `<div class="spots-times">${spotTimeBlock(i18n('spots.localNow', null, '当地现在'), view.localNow)}`
      + `${spotTimeBlock(i18n('spots.nextLocalTarget', null, '下一个当地周二 20:00'), view.localTarget)}`
      + `${spotTimeBlock(i18n('spots.browserTime', null, '我的时间'), view.browserTarget, 'spots-my-time')}</div>`
      + spotNoteBlock(spot.note)
      + `<footer class="spots-actions"><a class="btn" href="${escapeHtml(spotMapUrl(spot))}" target="_blank" rel="noopener">${escapeHtml(i18n('spots.openMap', null, '打开官方地图'))}</a>`
      + `<button class="btn spots-copy" type="button" data-copy-spot="${escapeHtml(spot.id)}">${escapeHtml(copied ? i18n('spots.copied', null, '已复制') : i18n('spots.copyCoordinates', null, '复制坐标'))}</button></footer>`
      + `</article>`;
  }).join('');
}
function fallbackCopyText(text) {
  const area = document.createElement('textarea');
  area.value = text; area.readOnly = true; area.style.position = 'fixed'; area.style.opacity = '0';
  document.body.appendChild(area); area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  area.remove();
  if (!ok) throw new Error('copy command failed');
}
async function copySpotCoordinates(spot) {
  const text = spotCoordinates(spot);
  let key = 'spots.copySuccess';
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
    else fallbackCopyText(text);
  } catch (error) {
    try { fallbackCopyText(text); }
    catch (fallbackError) { key = 'spots.copyError'; }
  }
  spotsCopyFeedback = { id:spot.id, key, until:Date.now() + 2200 };
  renderSpots();
  setTimeout(() => {
    if (spotsCopyFeedback && spotsCopyFeedback.id === spot.id && spotsCopyFeedback.until <= Date.now()) {
      spotsCopyFeedback = null;
      const view = $('#view-spots'); if (view && view.classList.contains('active')) renderSpots();
    }
  }, 2300);
}
function setupSpots() {
  const controls = $('#spots-controls'), results = $('#spots-results');
  if (!controls || !results) return;
  renderSpotFilterOptions(state.locations ? state.locations.spots || [] : []);
  const preferences = spotLoadPreferences();
  const kind = $('#spots-kind'), sort = $('#spots-sort');
  if (kind) kind.value = preferences.kind;
  if (sort) sort.value = preferences.sort;
  controls.addEventListener('submit', event => event.preventDefault());
  controls.addEventListener('input', renderSpots);
  controls.addEventListener('change', () => {
    spotSavePreferences(spotFilterState());
    renderSpots();
  });
  const reset = $('#spots-reset');
  if (reset) reset.addEventListener('click', () => {
    const search = $('#spots-search'); if (search) search.value = '';
    ['#spots-country','#spots-kind','#spots-status','#spots-review'].forEach(sel => { const el = $(sel); if (el) el.value = ''; });
    const sortSelect = $('#spots-sort'); if (sortSelect) sortSelect.value = 'next';
    spotSavePreferences(spotFilterState());
    renderSpots();
  });
  results.addEventListener('click', event => {
    const button = event.target.closest('[data-copy-spot]');
    if (!button || !state.locations) return;
    const spot = state.locations.spots.find(row => row.id === button.dataset.copySpot);
    if (spot) copySpotCoordinates(spot);
  });
  document.addEventListener('visibilitychange', () => {
    const view = $('#view-spots');
    if (!document.hidden && view && view.classList.contains('active')) renderSpots();
  });
  renderSpots();
  setInterval(() => {
    const view = $('#view-spots');
    if (view && view.classList.contains('active')) renderSpots();
  }, 30000);
}

/* ---------- Reminder UI (notes stay plain text and keep their editor node) ---------- */
let reminders = null, reminderSaver = null, reminderScheduler = null, detailEvent = null, reminderViewerZone = 'UTC';
const reminderCards = new Map(), reminderDisplayFormatters = new Map();
function reminderInstant(instant) {
  const zone = reminderViewerZone, key = state.locale + '/' + zone;
  let formatter = reminderDisplayFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(isEnglish() ? 'en-US' : 'zh-CN', {
      timeZone:zone, year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit',
      hourCycle:'h23', timeZoneName:'shortOffset',
    });
    reminderDisplayFormatters.set(key, formatter);
  }
  return formatter.format(instant) + ` (${zone})`;
}
function reminderRemaining(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000)), days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60);
  return [days ? i18n('reminder.days', { count:days }) : '', hours ? i18n('reminder.hours', { count:hours }) : '',
    minutes % 60 ? i18n('reminder.minutes', { count:minutes % 60 }) : ''].filter(Boolean).join(' ');
}
function reminderStatus(id) {
  const v = reminders.view(id), r = reminders.get(id);
  const event = r ? r.time : state.events.find(e => e.id === id);
  const globalLocal = event?.timing?.scope === 'global' && event.timing.mode === 'local';
  const lines = [];
  if (v.expired) return [i18n('reminder.expired')];
  if (v.completed) lines.push(i18n('reminder.completed'));
  if (v.status === 'active') lines.push(i18n(globalLocal ? 'reminder.globalStarted' : 'reminder.started'));
  else if (v.openAt) lines.push(i18n('reminder.opens', { time:reminderInstant(v.openAt) }));
  else lines.push(i18n('reminder.unknownStart'));
  const localStart = v.viewerWindow.start?.instant;
  if (globalLocal && localStart && Date.now() < localStart.getTime())
    lines.push(i18n('reminder.localStarts', { remaining:reminderRemaining(localStart - Date.now()), time:reminderInstant(localStart) }));
  if (v.closeAt) lines.push(i18n(globalLocal ? 'reminder.globalDeadline' : 'reminder.deadline', { time:reminderInstant(v.closeAt) }));
  else lines.push(i18n('reminder.unknownEnd'));
  if (!v.hasCanonical && r) lines.push(i18n('reminder.unavailable'));
  return lines;
}
function reminderNotice() {
  if (!reminders) return '';
  const status = reminders.status();
  return [status.unpersisted ? i18n('reminder.storageFailed') : '', status.isolated ? i18n('reminder.isolated') : ''].filter(Boolean).join(' ');
}
function bindCalendarReminder(node, ids) {
  node._reminderIds = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(id => typeof id === 'string' && id))];
  if (!node._reminderIds.length) return; // fallback raid drawers have no canonical identity
  node.dataset.reminderEvent = node._reminderIds.join(' ');
  node._reminderAria = node.getAttribute('aria-label') || node.title || node.textContent;
  const mark = document.createElement('span'); mark.className = 'reminder-mark'; mark.setAttribute('aria-hidden', 'true');
  const sparks = document.createElement('span'); sparks.className = 'reminder-sparks'; sparks.setAttribute('aria-hidden', 'true');
  sparks.innerHTML = '<i>✦</i><i>✦</i>';
  node.prepend(mark); node.append(sparks);
  syncCalendarReminder(node);
}
function syncCalendarReminder(node) {
  if (!reminders || !node._reminderIds) return;
  const views = node._reminderIds.map(id => reminders.view(id)).filter(v => v.flagged);
  const active = views.some(v => v.active), completed = views.length > 0 && views.every(v => v.completed);
  node.classList.toggle('reminder-active', active);
  node.classList.toggle('reminder-flagged', views.length > 0);
  node.classList.toggle('reminder-complete', completed);
  const mark = node.querySelector('.reminder-mark');
  if (mark) { mark.hidden = !views.length; mark.textContent = completed ? '√' : '★'; }
  node.setAttribute('aria-label', node._reminderAria + (views.length ? ' · ' + i18n(completed ? 'reminder.completed' : 'reminder.flagged') : ''));
}
function flushReminderEditor() {
  const widget = document.querySelector('.detail-reminder');
  const input = widget?.querySelector('textarea');
  if (input && reminderSaver?.pending(widget.dataset.id)) {
    input.value = reminderNote(input.value);
    reminderSaver.input(widget.dataset.id, widget.dataset.token, input.value, false);
  }
  reminderSaver?.flushAll();
}
function reminderAction(id, action) {
  if (!reminders) return;
  reminders.refresh(); reminderSaver.cancelMissing();
  const r = reminders.get(id);
  if (action === 'star') {
    if (r) {
      const draft = reminderSaver.pending(id);
      if ((draft?.note || r.note) && !confirm(i18n('reminder.confirmRemove'))) return;
      reminderSaver.cancel(id); reminders.remove(id, r.token);
    } else reminders.star(id);
  } else if (r) reminders.complete(id, r.completedAt === null, r.token);
  reminderScheduler.wake();
}
function createReminderControls(id) {
  const box = document.createElement('section'); box.className = 'detail-reminder'; box.dataset.id = id;
  box.innerHTML = '<h4 class="reminder-title"></h4><div class="reminder-actions">'
    + '<button type="button" class="btn reminder-star"></button><button type="button" class="btn reminder-done" aria-describedby="detail-reminder-status"></button></div>'
    + '<p id="detail-reminder-status" class="reminder-time"></p><label class="reminder-note-editor"><span></span><textarea rows="3"></textarea></label>'
    + '<p class="reminder-save" role="status"></p><p class="reminder-warning" role="status"></p>';
  const input = box.querySelector('textarea'); input.maxLength = REMINDER_NOTE_LIMIT * 2;
  let composing = false;
  const queue = () => {
    if (!reminders.get(id) || reminders.get(id).token !== box.dataset.token) return;
    if (!composing) input.value = reminderNote(input.value);
    reminderSaver.input(id, box.dataset.token, input.value, composing);
    box.querySelector('.reminder-save').textContent = i18n('reminder.saving');
  };
  input.addEventListener('compositionstart', () => { composing = true; queue(); });
  input.addEventListener('compositionend', () => { composing = false; queue(); });
  input.addEventListener('input', queue);
  input.addEventListener('blur', () => { composing = false; queue(); reminderSaver.flush(id); });
  box.querySelector('.reminder-star').addEventListener('click', e => { e.stopPropagation(); reminderAction(id, 'star'); });
  box.querySelector('.reminder-done').addEventListener('click', e => { e.stopPropagation(); reminderAction(id, 'complete'); });
  syncReminderControls(box);
  return box;
}
function syncReminderControls(box) {
  const id = box.dataset.id, r = reminders.get(id), v = reminders.view(id), status = reminderStatus(id);
  box.querySelector('.reminder-title').textContent = i18n('reminder.personal');
  const star = box.querySelector('.reminder-star'), done = box.querySelector('.reminder-done');
  star.textContent = i18n(r ? 'reminder.unstar' : 'reminder.star');
  star.disabled = v.expired || (!r && !v.hasCanonical);
  star.setAttribute('aria-pressed', r ? 'true' : 'false');
  done.textContent = i18n(v.completed ? 'reminder.undo' : 'reminder.done');
  done.disabled = !(v.canComplete || v.canUndo); done.title = status[0];
  box.querySelector('.reminder-time').textContent = status.join('\n');
  const label = box.querySelector('.reminder-note-editor'), input = label.querySelector('textarea');
  label.hidden = !r; input.disabled = !r;
  label.querySelector('span').textContent = i18n('reminder.noteLabel', { count:REMINDER_NOTE_LIMIT });
  input.placeholder = i18n('reminder.notePlaceholder');
  if (box.dataset.token !== (r?.token || '')) box.dataset.saveConflict = '';
  if (box.dataset.token !== (r?.token || '') || (!reminderSaver.pending(id) && document.activeElement !== input))
    input.value = r?.note || '';
  box.dataset.token = r?.token || '';
  const saved = box.querySelector('.reminder-save');
  saved.textContent = r ? i18n(reminderSaver.pending(id) ? 'reminder.saving' : (reminders.status().unpersisted ? 'reminder.sessionOnly' : 'reminder.saved')) : '';
  box.querySelector('.reminder-warning').textContent = [reminderNotice(),
    box.dataset.saveConflict && r ? i18n('reminder.editConflict') : ''].filter(Boolean).join(' ');
}
function createReminderCard(id) {
  const card = document.createElement('article'); card.className = 'reminder-item'; card.dataset.id = id;
  card.innerHTML = '<div class="reminder-card-head"><button type="button" class="reminder-open"></button><span class="reminder-mark" aria-hidden="true">★</span></div>'
    + '<p class="reminder-time"></p><p class="reminder-note-preview"></p><div class="reminder-actions">'
    + '<button type="button" class="btn reminder-star"></button><button type="button" class="btn reminder-done"></button></div>'
    + '<span class="reminder-sparks" aria-hidden="true"><i>✦</i><i>✦</i></span>';
  card.querySelector('.reminder-open').addEventListener('click', () => {
    const ev = state.events.find(e => e.id === id), r = reminders.get(id);
    if (ev) openDetail(ev, card.querySelector('.reminder-open'));
    else if (r) openDetail({ id, name:r.names[state.locale] || r.names['zh-CN'] || id, ...r.time }, card.querySelector('.reminder-open'));
  });
  card.querySelector('.reminder-star').addEventListener('click', e => { e.stopPropagation(); reminderAction(id, 'star'); });
  card.querySelector('.reminder-done').addEventListener('click', e => {
    e.stopPropagation(); reminderAction(id, 'complete');
    const group = $('#reminder-completed'); if (group.contains(card) && !group.open) group.querySelector('summary').focus();
  });
  return card;
}
function renderReminderSidebar() {
  if (!reminders) return;
  const entries = reminders.entries(), buckets = { live:[], upcoming:[], unknown:[], completed:[] };
  entries.forEach(([id, record]) => {
    const view = reminders.view(id); if (!view.flagged) return;
    const group = view.completed ? 'completed' : view.active ? 'live' : view.openAt ? 'upcoming' : 'unknown';
    buckets[group].push({ id, record, view });
  });
  Object.values(buckets).forEach(rows => rows.sort((a, b) => (a.view.openAt?.getTime() ?? Infinity) - (b.view.openAt?.getTime() ?? Infinity) || a.record.starredAt - b.record.starredAt || a.id.localeCompare(b.id)));
  const ids = new Set(entries.map(([id]) => id));
  for (const [id, card] of reminderCards) if (!ids.has(id)) { card.remove(); reminderCards.delete(id); }
  for (const [group, rows] of Object.entries(buckets)) {
    const section = $(`#reminder-${group}`), list = section.querySelector('.reminder-list');
    section.hidden = !rows.length;
    section.querySelector(group === 'completed' ? 'summary' : 'h4').textContent = i18n(`reminder.group.${group}`, { count:rows.length });
    rows.forEach(({ id, record, view }, index) => {
      let card = reminderCards.get(id);
      if (!card) { card = createReminderCard(id); reminderCards.set(id, card); }
      const ev = state.events.find(e => e.id === id), cat = ev ? catOf(ev) : { color:PALETTE.blue };
      card.style.setProperty('--c', cat.color);
      card.classList.toggle('ft', !!ev?._featured);
      card.classList.toggle('reminder-active', view.active);
      card.querySelector('.reminder-open').textContent = record.names[state.locale] || (ev ? localizedEvent(ev).name : (record.names['zh-CN'] || id));
      card.querySelector('.reminder-mark').textContent = view.completed ? '√' : '★';
      card.querySelector('.reminder-time').textContent = reminderStatus(id).join('\n');
      const note = card.querySelector('.reminder-note-preview'); note.textContent = record.note; note.hidden = !record.note;
      const star = card.querySelector('.reminder-star'), done = card.querySelector('.reminder-done');
      star.textContent = i18n('reminder.unstar');
      star.setAttribute('aria-label', i18n('reminder.removeNamed', { name:card.querySelector('.reminder-open').textContent }));
      done.textContent = i18n(view.completed ? 'reminder.undo' : 'reminder.done');
      done.setAttribute('aria-label', i18n(view.completed ? 'reminder.undoNamed' : 'reminder.completeNamed', { name:card.querySelector('.reminder-open').textContent }));
      const time = card.querySelector('.reminder-time'); time.id = 'reminder-status-' + encodeURIComponent(id);
      done.setAttribute('aria-describedby', time.id);
      done.disabled = !(view.canComplete || view.canUndo); done.title = reminderStatus(id)[0];
      if (list.children[index] !== card) list.insertBefore(card, list.children[index] || null);
    });
  }
  $('#reminder-count').textContent = String(entries.length);
  $('#reminder-empty').hidden = entries.length > 0;
  $('#reminder-notice').textContent = reminderNotice();
}
function refreshReminderUi() {
  reminderViewerZone = detectBrowserTimeZone().timeZone;
  reminders.refresh(); reminderSaver.cancelMissing();
  document.querySelectorAll('[data-reminder-event]').forEach(syncCalendarReminder);
  renderReminderSidebar();
  document.querySelectorAll('.detail-reminder').forEach(syncReminderControls);
}
function setupReminders() {
  reminderViewerZone = detectBrowserTimeZone().timeZone;
  reminders = createEventReminderStore({ viewerTimeZone:() => reminderViewerZone });
  reminders.setEvents(state.events, state.en?.events);
  reminderSaver = createReminderNoteSaver(reminders, { onSave:(id, result) => {
    const box = document.querySelector('.detail-reminder');
    if (box?.dataset.id === id) box.dataset.saveConflict = result.reason === 'changed' ? 'true' : '';
    if (!document.hidden) refreshReminderUi();
  } });
  reminderScheduler = createReminderScheduler({
    refresh:refreshReminderUi, isHidden:() => document.hidden,
    boundaries:() => reminders.entries().flatMap(([id]) => {
      const v = reminders.view(id);
      return [v.openAt?.getTime(), v.closeAt?.getTime(), v.viewerWindow.start?.instant?.getTime()];
    }),
  });
  const panel = $('#reminder-panel'); if (matchMedia('(max-width:1000px)').matches) panel.open = false;
  window.addEventListener('storage', e => {
    if (e.key === null || e.key === REMINDER_LEGACY_KEY || e.key.startsWith(REMINDER_PREFIX)) {
      reminders.sync(); reminderSaver.cancelMissing(); reminderScheduler.wake();
    }
  });
  document.addEventListener('visibilitychange', () => {
    document.body.classList.toggle('reminders-paused', document.hidden);
    if (document.hidden) { flushReminderEditor(); reminderScheduler.pause(); }
    else reminderScheduler.wake();
  });
  window.addEventListener('pagehide', () => {
    flushReminderEditor(); reminderScheduler.pause(); document.body.classList.add('reminders-paused');
  });
  const resume = () => {
    document.body.classList.toggle('reminders-paused', document.hidden); reminderScheduler.wake();
  };
  window.addEventListener('pageshow', resume);
  window.addEventListener('focus', resume);
  reminderScheduler.wake();
}
function openChipDay(date, list, opener) {
  flushReminderEditor(); detailEvent = null; detailReturnFocus = opener;
  const panel = $('#event-detail'), body = $('#detail-body');
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', i18n('reminder.dayList', { date:fmtDateShort(ymd(date)) }));
  body.innerHTML = `<h3>${escapeHtml(i18n('reminder.dayList', { date:fmtDateShort(ymd(date)) }))}</h3><div class="raid-day-options"></div>`;
  const options = body.querySelector('.raid-day-options');
  list.forEach(({ ev, cat }) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'raid-day-option';
    b.style.setProperty('--ring', cat.color); b.textContent = localizedEvent(ev).name;
    bindCalendarReminder(b, ev.id);
    b.addEventListener('click', () => openDetail(ev, opener)); options.append(b);
  });
  panel.hidden = false; options.querySelector('button')?.focus();
}

/* ---------- language / locale ---------- */
function captureLocalizedRegions() {
  REGION_NAMES.forEach(name => {
    const el = document.querySelector(`[data-ai-region="${name}"]`);
    if (el) state.zhRegions[name] = el.innerHTML;
  });
}
function enhanceEventLinks(root) {
  (root || document).querySelectorAll('[data-event-id]').forEach(el => {
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
  });
}
function renderLocalizedRegions() {
  REGION_NAMES.forEach(name => {
    const el = document.querySelector(`[data-ai-region="${name}"]`);
    if (!el) return;
    const english = state.en && state.en.regions && state.en.regions[name];
    el.innerHTML = sanitizeLocalizedHtml(isEnglish() && english != null ? english : (state.zhRegions[name] || ''));
    enhanceEventLinks(el);
  });
}
function renderUpdated() {
  const el = $('#last-updated'); if (!el) return;
  el.textContent = state.meta && state.meta.lastUpdated
    ? i18n('status.updated', { date: fmtDateTime(state.meta.lastUpdated) }, `更新于 ${fmtDateTime(state.meta.lastUpdated)}`)
    : i18n('status.never', null, '尚未更新');
}
function applyStaticTranslations() {
  document.documentElement.lang = state.locale;
  const dict = state.ui && state.ui[state.locale] || {};
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const v = dict[el.dataset.i18n]; if (v != null) el.textContent = v;
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const v = dict[el.dataset.i18nHtml]; if (v != null) el.innerHTML = sanitizeLocalizedHtml(v);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    const v = dict[el.dataset.i18nAriaLabel]; if (v != null) el.setAttribute('aria-label', v);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const v = dict[el.dataset.i18nTitle]; if (v != null) el.title = v;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const v = dict[el.dataset.i18nPlaceholder]; if (v != null) el.setAttribute('placeholder', v);
  });
  document.title = i18n('site.documentTitle', null, 'Pokémon GO 面板');
  const toggle = $('#lang-toggle');
  if (toggle) {
    toggle.textContent = i18n('lang.switch', null, isEnglish() ? '中文' : 'English');
    toggle.setAttribute('aria-label', i18n('lang.switchAria', null, isEnglish() ? '切换到中文' : 'Switch to English'));
    toggle.setAttribute('aria-pressed', isEnglish() ? 'true' : 'false');
  }
}
function applyLocale() {
  try { localStorage.setItem(LOCALE_KEY, state.locale); } catch (e) {}
  const drawer = $('#event-detail'), opened = drawer && !drawer.hidden;
  // Keep the actual textarea node (including IME/caret/draft) across languages.
  if (opened && !detailEvent) { flushReminderEditor(); drawer.hidden = true; detailReturnFocus = null; }
  applyStaticTranslations();
  renderUpdated();
  renderLocalizedRegions();
  renderCalendar();
  renderRotations();
  renderMega();
  renderWorldClock();
  renderSpots();
  if (opened && detailEvent) openDetail(detailEvent, detailReturnFocus, true);
  reminderScheduler?.wake();
  if (todoState) renderTodo();
  linkifySprites(document.body);
}
function setupLanguage() {
  const b = $('#lang-toggle'); if (!b) return;
  b.addEventListener('click', () => {
    state.locale = isEnglish() ? 'zh-CN' : 'en';
    applyLocale();
  });
}

/* ---------- wiring ---------- */
function setupTabs() {
  $('#main-tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#main-tabs button').forEach(x => x.classList.toggle('active', x === b));
    const v = b.dataset.view;
    document.querySelectorAll('.view').forEach(s => s.classList.toggle('active', s.id === `view-${v}`));
    if (v === 'calendar') reminderScheduler?.wake();
    if (v === 'clock') renderWorldClock();
    if (v === 'spots') renderSpots();
    if (v === 'todo') todoRefreshCds();   // refresh the per-account CD timers each time it's opened
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
  const close = () => {
    if (panel.hidden) return;
    flushReminderEditor(); detailEvent = null;
    panel.hidden = true;
    const back = detailReturnFocus; detailReturnFocus = null;
    if (back && back.isConnected && back.focus) back.focus();
  };
  $('#detail-close').addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if (panel.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && el.getClientRects().length);
    if (!focusable.length) { e.preventDefault(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  document.addEventListener('mousedown', e => {
    if (!panel.hidden && !panel.contains(e.target) && !e.target.closest('#lang-toggle')) close();
  });
}
// Generic hook: any element carrying data-event-id opens that event's detail drawer
// (the same popup the calendar day-icons use). Lets the daily agent make event
// mentions in the free-form 本月看点 region clickable — just wrap the name in
// <a class="event-link" data-event-id="<events.json id>">名称</a> (or a <span>).
// Delegated on document, so it keeps working for the agent-rewritten marker HTML.
function setupEventLinks() {
  const activate = t => {
    const ev = state.events.find(x => x.id === t.getAttribute('data-event-id'));
    if (ev) openDetail(ev, t);                // unknown id → element stays inert text
  };
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-event-id]');
    if (!t) return;
    e.preventDefault();                       // never let an href="#" jump the page
    activate(t);
  });
  document.addEventListener('keydown', e => {
    const t = e.target.closest && e.target.closest('[data-event-id]');
    if (!t || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault(); activate(t);
  });
}

/* ---------- Multi-account TODO (client-side only) ----------
 * A grid the user fills in: accounts = rows (each with a nickname), tasks =
 * columns (each with a custom label), cells = a checkbox. Everything lives in
 * localStorage under "pogo-todo". Checks are NEVER auto-cleared — they persist
 * until the user clicks 清空勾选, which also stamps data.day to that day; the
 * header date then holds unchanged until the next manual clear. No network, no
 * data contract with the daily agent — safe to live entirely in the frontend. */
const TODO_KEY = 'pogo-todo';
const todoId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const TODO_CD_MS = 2 * 60 * 60 * 1000; // per-account cooldown length: 2 hours
const todoCdRemain = a => (a && typeof a.cdStart === 'number') ? (a.cdStart + TODO_CD_MS - Date.now()) : 0;
function todoFmtRemain(ms) { // 7200000→"2h", 7140000→"1h59m", 300000→"5m"
  const min = Math.max(0, Math.ceil(ms / 60000)), h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h}h${m}m` : `${h}h`) : `${m}m`;
}
function todoCdLabel(a) { // hourglass badge text for the account's CD state
  const rem = todoCdRemain(a);
  if (rem <= 0) return '⏳✓';
  if (a.cdView === 'time') {
    const d = new Date(a.cdStart), p = n => String(n).padStart(2, '0');
    return '⏳' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  return '⏳' + todoFmtRemain(rem);
}
function todoToday() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;   // local calendar day
}
function todoDayLabel(dayStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayStr || '');
  if (!m) return dayStr || '';
  const date = new Date(+m[1], +m[2] - 1, +m[3]);
  const weekday = new Intl.DateTimeFormat(isEnglish() ? 'en-US' : 'zh-CN', { weekday:'long' }).format(date);
  return `${dayStr} ${weekday}`;
}
function todoLoad() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(TODO_KEY) || 'null'); } catch (e) {}
  if (!data || typeof data !== 'object') {
    // first run — seed a tiny visible grid so the row/column shape is obvious
    data = { v: 1, day: todoToday(),
      accounts: [{ id: todoId('a'), name: '' }],
      tasks: [{ id: todoId('t'), name: '' }, { id: todoId('t'), name: '' }],
      checks: {} };
  }
  if (typeof data.day !== 'string') data.day = todoToday();   // header date; only ever changes on manual clear
  data.accounts = Array.isArray(data.accounts) ? data.accounts : [];
  data.accounts.forEach(a => { // normalise per-account CD fields on both new and old saved shapes
    if (typeof a.cdStart !== 'number') a.cdStart = null;
    if (a.cdView !== 'time') a.cdView = 'dur';
  });
  data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
  data.checks = (data.checks && typeof data.checks === 'object') ? data.checks : {};
  return data;
}
function todoSave(data) { try { localStorage.setItem(TODO_KEY, JSON.stringify(data)); } catch (e) {} }

let todoState = null;
function renderTodo() {
  const mount = $('#todo-mount');
  if (!mount || !todoState) return;
  const data = todoState;

  const status = $('#todo-status');
  if (status) {
    status.textContent = '';
    const day = document.createElement('span');
    day.className = 'todo-day'; day.textContent = i18n('todo.today', null, '今天') + ' ' + todoDayLabel(data.day);
    const note = document.createElement('span');
    note.textContent = i18n('todo.manualNote', null, '勾选仅手动清空，清空后日期记为当天');
    status.append(day, note);
  }

  mount.textContent = '';
  const bar = document.createElement('div');
  bar.className = 'todo-toolbar';
  const mkBtn = (cls, label, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = label;
    b.addEventListener('click', fn); return b;
  };
  bar.appendChild(mkBtn('btn', i18n('todo.addAccount', null, '＋ 添加账号'), () => {
    data.accounts.push({ id: todoId('a'), name: '', cdStart: null, cdView: 'dur' }); todoSave(data); renderTodo();
    const last = mount.querySelector('tbody tr:last-child .todo-name'); if (last) last.focus();
  }));
  bar.appendChild(mkBtn('btn', i18n('todo.addTask', null, '＋ 添加任务'), () => {
    data.tasks.push({ id: todoId('t'), name: '' }); todoSave(data); renderTodo();
    const heads = mount.querySelectorAll('thead .todo-task .todo-name');
    if (heads.length) heads[heads.length - 1].focus();
  }));
  bar.appendChild(mkBtn('btn btn-ghost', i18n('todo.clear', null, '清空勾选'), () => {
    if (Object.keys(data.checks).length && !confirm(i18n('todo.confirmClear', null, '清空全部勾选？'))) return;
    data.checks = {};
    data.day = todoToday();   // manual clear stamps today → header date updates, then holds
    todoSave(data); renderTodo();
  }));
  mount.appendChild(bar);

  if (!data.accounts.length && !data.tasks.length) {
    const e = document.createElement('p');
    e.className = 'todo-empty';
    e.textContent = i18n('todo.empty', null, '还没有内容。点「＋ 添加账号」加一行账号（填昵称），点「＋ 添加任务」加一列任务（填自定义内容），再逐格勾选即可。');
    mount.appendChild(e);
    return;
  }

  const nameInput = (val, ph, onInput) => {
    const i = document.createElement('input');
    i.className = 'todo-name'; i.type = 'text'; i.value = val; i.placeholder = ph;
    i.size = 1;   // neutralise the input's default ~20ch intrinsic width (table-layout:auto)
    i.addEventListener('input', () => onInput(i.value));
    return i;
  };
  // Task-header input that grows its column to fit the label: a grid wrapper whose
  // hidden ::after mirror carries the live text (CJK-accurate) and drives the width.
  const sizerInput = (val, ph, onInput) => {
    const wrap = document.createElement('span');
    wrap.className = 'todo-sizer';
    wrap.dataset.value = val || ph;
    const i = nameInput(val, ph, v => { wrap.dataset.value = v || ph; onInput(v); });
    wrap.appendChild(i);
    return wrap;
  };
  const delBtn = (title, onClick) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'todo-del'; b.title = title; b.setAttribute('aria-label', title);
    b.textContent = '×'; b.addEventListener('click', onClick); return b;
  };
  // Per-account ⏳ cooldown: tap idle ⏳✓ to start a 2h CD; while running, a tap toggles
  // remaining ⇄ start-time; a long-press cancels. State lives in a.cdStart / a.cdView.
  const cdBtn = (a) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'todo-cd';
    const sync = () => {
      const active = todoCdRemain(a) > 0;
      b.classList.toggle('on-cd', active);
      b.textContent = todoCdLabel(a);
      b.title = active ? i18n('todo.cdActive', null, '点击切换显示（剩余 ⇄ 开始时间）· 长按取消') : i18n('todo.cdStart', null, '点击开始 2 小时 CD');
    };
    b.__sync = sync;
    let lp = false, timer = null;
    const press = (e) => {
      if (e && e.button) return; // primary button / touch only
      if (todoCdRemain(a) <= 0) return; // only a running CD can be long-press cancelled
      timer = setTimeout(() => { timer = null; lp = true; a.cdStart = null; a.cdView = 'dur'; todoSave(data); sync(); }, 500);
    };
    const release = () => { if (timer) { clearTimeout(timer); timer = null; } };
    b.addEventListener('pointerdown', press);
    b.addEventListener('pointerup', release);
    b.addEventListener('pointerleave', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('contextmenu', e => e.preventDefault());
    b.addEventListener('click', () => {
      if (lp) { lp = false; return; } // swallow the click that ends a long-press cancel
      if (todoCdRemain(a) > 0) a.cdView = (a.cdView === 'time') ? 'dur' : 'time';
      else { a.cdStart = Date.now(); a.cdView = 'dur'; }
      todoSave(data); sync();
    });
    sync();
    return b;
  };

  const table = document.createElement('table');
  table.className = 'todo-table';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'todo-corner'; corner.textContent = i18n('todo.corner', null, '账号 ＼ 任务');
  hr.appendChild(corner);
  data.tasks.forEach(t => {
    const th = document.createElement('th');
    th.className = 'todo-task';
    const wrap = document.createElement('div');
    wrap.className = 'todo-head-in';
    wrap.appendChild(sizerInput(t.name, i18n('todo.taskName', null, '任务名'), v => { t.name = v; todoSave(data); }));
    wrap.appendChild(delBtn(i18n('todo.deleteTask', null, '删除任务'), () => {
      if (!confirm(i18n('todo.confirmDeleteTask', null, '删除这一列任务？该列的勾选也会一起删除。'))) return;
      data.tasks = data.tasks.filter(x => x.id !== t.id);
      Object.keys(data.checks).forEach(k => { if (k.endsWith('|' + t.id)) delete data.checks[k]; });
      todoSave(data); renderTodo();
    }));
    th.appendChild(wrap);
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  data.accounts.forEach(a => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.className = 'todo-acct';
    const wrap = document.createElement('div');
    wrap.className = 'todo-head-in';
    wrap.appendChild(cdBtn(a)); // per-account ⏳ cooldown control, before the nickname
    wrap.appendChild(nameInput(a.name, i18n('todo.nickname', null, '昵称'), v => { a.name = v; todoSave(data); }));
    wrap.appendChild(delBtn(i18n('todo.deleteAccount', null, '删除账号'), () => {
      if (!confirm(i18n('todo.confirmDeleteAccount', null, '删除这个账号？该行的勾选也会一起删除。'))) return;
      data.accounts = data.accounts.filter(x => x.id !== a.id);
      Object.keys(data.checks).forEach(k => { if (k.startsWith(a.id + '|')) delete data.checks[k]; });
      todoSave(data); renderTodo();
    }));
    th.appendChild(wrap);
    tr.appendChild(th);
    data.tasks.forEach(t => {
      const td = document.createElement('td');
      td.className = 'todo-cell';
      const key = a.id + '|' + t.id;
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.className = 'todo-check'; cb.checked = !!data.checks[key];
      cb.addEventListener('change', () => {
        if (cb.checked) data.checks[key] = true; else delete data.checks[key];
        todoSave(data);
      });
      lab.appendChild(cb);
      td.appendChild(lab);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const scroll = document.createElement('div');
  scroll.className = 'todo-scroll';
  scroll.appendChild(table);
  mount.appendChild(scroll);
}

// Expire elapsed per-account CDs and refresh the ⏳ badges in place (no full re-render → keeps input focus).
function todoRefreshCds() {
  if (!todoState) return;
  let changed = false;
  todoState.accounts.forEach(a => {
    if (typeof a.cdStart === 'number' && Date.now() - a.cdStart >= TODO_CD_MS) { a.cdStart = null; a.cdView = 'dur'; changed = true; }
  });
  if (changed) todoSave(todoState);
  const mount = $('#todo-mount');
  if (mount) mount.querySelectorAll('.todo-cd').forEach(b => b.__sync && b.__sync());
}
function setupTodo() {
  todoState = todoLoad();
  todoSave(todoState);       // persist the seeded / normalised shape
  renderTodo();
  // checks are never auto-cleared now; just refresh elapsed per-account CDs on tab focus
  document.addEventListener('visibilitychange', () => { if (!document.hidden) todoRefreshCds(); });
  // keep the ⏳ countdowns live & expire them — only ticks while the TODO view is open
  setInterval(() => {
    const v = $('#view-todo');
    if (v && v.classList.contains('active')) todoRefreshCds();
  }, 30000);
}

async function init() {
  // Capture the daily agent's Chinese rich regions before a saved English
  // preference can replace them. Switching back restores these exact nodes.
  captureLocalizedRegions();
  setupTabs();
  setupCalNav();
  setupDetail();
  setupEventLinks();
  setupLanguage();
  await loadData();
  setupReminders();
  setupTodo();
  setupMega();
  setupWorldClock();
  setupSpots();
  applyLocale();
}

if (typeof module === 'object' && module.exports) {
  module.exports = {
    detectBrowserTimeZone, isValidIanaTimeZone, spotZonedParts, timeZoneOffsetMinutes,
    zonedWallTimeToInstant, nextLocalScheduleInstant, formatTargetForZone, wcInRange,
    parseEventTime, validateEventTiming, resolveEventTiming,
    REMINDER_PREFIX, REMINDER_NOTE_LIMIT, reminderNote, reminderTimeSnapshot, decodeReminder, deriveEventReminder,
    createEventReminderStore, createReminderNoteSaver, createReminderScheduler, findRaidEvent,
    spotCountryFlag, spotCoordinates, spotMapUrl, spotMatches, sortSpotViews, spotRatingStars, spotNoteBlock,
    spotLoadPreferences, spotSavePreferences, SPOT_KIND_OPTIONS, SPOT_SORT_VALUES,
  };
}
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => init().catch(error => {
  console.error('pogo-agent init failed', error);
  document.body.dataset.initError = error && (error.stack || error.message) || String(error);
}));
