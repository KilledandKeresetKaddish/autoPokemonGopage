'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  detectBrowserTimeZone,
  isValidIanaTimeZone,
  timeZoneOffsetMinutes,
  zonedWallTimeToInstant,
  nextLocalScheduleInstant,
  formatTargetForZone,
  wcInRange,
  spotMapUrl,
  spotMatches,
  sortSpotViews,
  spotRatingStars,
  spotNoteBlock,
  spotLoadPreferences,
  spotSavePreferences,
  SPOT_KIND_OPTIONS,
  SPOT_SORT_VALUES,
} = require('../public/app.js');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const locations = JSON.parse(fs.readFileSync(path.join(root, 'public/data/locations.json'), 'utf8'));
const ui = JSON.parse(fs.readFileSync(path.join(root, 'public/data/i18n/ui.json'), 'utf8'));

const wall = { year:2026, month:8, day:18, hour:20, minute:0 };
const stamp = (sourceZone, displayZone) => {
  const instant = zonedWallTimeToInstant(wall, sourceZone);
  const shown = formatTargetForZone(instant, displayZone, 'en');
  return `${shown.date} ${shown.time}`;
};

const shanghai = {
  'Asia/Kuala_Lumpur':'2026-08-18 20:00',
  'Asia/Bangkok':'2026-08-18 21:00',
  'Asia/Dhaka':'2026-08-18 22:00',
  'Asia/Kolkata':'2026-08-18 22:30',
  'Europe/Paris':'2026-08-19 02:00',
  'America/New_York':'2026-08-19 08:00',
  'America/Los_Angeles':'2026-08-19 11:00',
};
for (const [source, expected] of Object.entries(shanghai)) {
  assert.equal(stamp(source, 'Asia/Shanghai'), expected, `${source} -> Asia/Shanghai`);
}

const toronto = {
  'Asia/Kolkata':'2026-08-18 10:30',
  'Europe/Paris':'2026-08-18 14:00',
  'America/Phoenix':'2026-08-18 23:00',
  'America/Los_Angeles':'2026-08-18 23:00',
};
for (const [source, expected] of Object.entries(toronto)) {
  assert.equal(stamp(source, 'America/Toronto'), expected, `${source} -> America/Toronto`);
}

for (const zone of ['Asia/Shanghai','America/Toronto','Europe/London']) {
  assert.deepEqual(detectBrowserTimeZone(() => zone), { timeZone:zone, fallback:false });
}
assert.deepEqual(detectBrowserTimeZone(() => { throw new Error('blocked'); }), { timeZone:'UTC', fallback:true });
assert.deepEqual(detectBrowserTimeZone(() => ''), { timeZone:'UTC', fallback:true });
assert.deepEqual(detectBrowserTimeZone(() => 'Not/A_Zone'), { timeZone:'UTC', fallback:true });
assert.equal(isValidIanaTimeZone('Asia/Kolkata'), true);
assert.equal(isValidIanaTimeZone('Not/A_Zone'), false);

const schedule = { isoWeekday:2, hour:20, minute:0 };
const exact = zonedWallTimeToInstant(wall, 'Asia/Bangkok');
assert.equal(nextLocalScheduleInstant(exact, 'Asia/Bangkok', schedule).toISOString(), exact.toISOString());
const nextWeek = nextLocalScheduleInstant(new Date(exact.getTime() + 1), 'Asia/Bangkok', schedule);
assert.equal(formatTargetForZone(nextWeek, 'Asia/Bangkok', 'en').date, '2026-08-25');
assert.equal(formatTargetForZone(nextWeek, 'Asia/Bangkok', 'en').time, '20:00');

// Half-hour offsets and DST/no-DST behavior.
assert.equal(timeZoneOffsetMinutes(new Date('2026-08-18T12:00:00Z'), 'Asia/Kolkata'), 330);
assert.equal(stamp('Asia/Kolkata', 'Asia/Shanghai'), '2026-08-18 22:30');
assert.equal(timeZoneOffsetMinutes(new Date('2026-01-20T12:00:00Z'), 'Europe/London'), 0);
assert.equal(timeZoneOffsetMinutes(new Date('2026-08-18T12:00:00Z'), 'Europe/London'), 60);
assert.equal(timeZoneOffsetMinutes(new Date('2026-01-20T12:00:00Z'), 'America/Toronto'), -300);
assert.equal(timeZoneOffsetMinutes(new Date('2026-08-18T12:00:00Z'), 'America/Toronto'), -240);
assert.equal(timeZoneOffsetMinutes(new Date('2026-01-20T12:00:00Z'), 'America/Phoenix'), -420);
assert.equal(timeZoneOffsetMinutes(new Date('2026-08-18T12:00:00Z'), 'America/Phoenix'), -420);

// One instant, three explicit browser display zones; no host-timezone dependency.
const shared = new Date('2026-08-18T12:00:00Z');
assert.equal(formatTargetForZone(shared, 'Asia/Shanghai', 'en').time, '20:00');
assert.equal(formatTargetForZone(shared, 'America/Toronto', 'en').time, '08:00');
assert.equal(formatTargetForZone(shared, 'Europe/London', 'en').time, '13:00');

// World Clock remains half-open and keeps one lifecycle ticker/listener set.
assert.equal(wcInRange(6 + 59 / 60, 4, 7), true);
assert.equal(wcInRange(7, 4, 7), false);
assert.match(appSource, /if \(v === 'clock'\) renderWorldClock\(\);/);
assert.match(appSource, /document\.addEventListener\('visibilitychange',[\s\S]*?refreshWorldClockIfActive\(\)/);
assert.match(appSource, /window\.addEventListener\('pageshow', refreshWorldClockIfActive\);/);
assert.equal((appSource.match(/setInterval\(refreshWorldClockIfActive, 30000\);/g) || []).length, 1);
assert.match(appSource, /if \(!isFinite\(uo\)\) uo = 8;/);

function locationErrors(data) {
  const errors = [];
  const bad = message => errors.push(message);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const topKeys = ['schedule','schemaVersion','spots'];
  const scheduleKeys = ['hour','isoWeekday','minute'];
  const spotKeys = ['countryCode','group','id','kind','lat','lng','name','needsReview','note','rating','status','timeZone'];
  const forbidden = ['nameZh','nameEn','displayTimeZone','flag','utcOffset','browserTime','displayTime','chinaTime','nextTuesday','mapUrl'];
  const kinds = new Set(['gym','showcase','both']);
  const statuses = new Set(['tested','candidate','mixed']);

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    bad('top level must be an object');
    return errors;
  }
  if (JSON.stringify(Object.keys(data).sort()) !== JSON.stringify(topKeys)) {
    bad('top-level keys must be exactly schemaVersion/schedule/spots');
  }
  if (data.schemaVersion !== 1) bad('schemaVersion must equal 1');
  const configured = data.schedule;
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    bad('schedule must be an object');
  } else {
    if (JSON.stringify(Object.keys(configured).sort()) !== JSON.stringify(scheduleKeys)) {
      bad('schedule keys must be exactly isoWeekday/hour/minute');
    }
    if (!Number.isInteger(configured.isoWeekday) || configured.isoWeekday < 1 || configured.isoWeekday > 7) bad('schedule.isoWeekday must be 1..7');
    if (!Number.isInteger(configured.hour) || configured.hour < 0 || configured.hour > 23) bad('schedule.hour must be 0..23');
    if (!Number.isInteger(configured.minute) || configured.minute < 0 || configured.minute > 59) bad('schedule.minute must be 0..59');
    if (own(configured, 'displayTimeZone')) bad('schedule.displayTimeZone is forbidden');
  }
  if (!Array.isArray(data.spots) || !data.spots.length) {
    bad('spots must be a non-empty array');
    return errors;
  }

  const ids = new Set();
  const coordinates = new Set();
  data.spots.forEach((spot, index) => {
    const at = `spots[${index}]`;
    if (!spot || typeof spot !== 'object' || Array.isArray(spot)) {
      bad(`${at} must be an object`);
      return;
    }
    if (JSON.stringify(Object.keys(spot).sort()) !== JSON.stringify(spotKeys)) bad(`${at} keys do not match the schema`);
    if (typeof spot.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(spot.id)) bad(`${at}.id is invalid`);
    else if (ids.has(spot.id)) bad(`${at}.id duplicates ${spot.id}`);
    else ids.add(spot.id);
    if (typeof spot.countryCode !== 'string' || !/^[A-Z]{2}$/.test(spot.countryCode)) bad(`${at}.countryCode is invalid`);
    if (typeof spot.name !== 'string' || !spot.name.trim()) bad(`${at}.name must be non-empty`);
    const validLat = typeof spot.lat === 'number' && Number.isFinite(spot.lat) && spot.lat >= -90 && spot.lat <= 90;
    const validLng = typeof spot.lng === 'number' && Number.isFinite(spot.lng) && spot.lng >= -180 && spot.lng <= 180;
    if (!validLat) bad(`${at}.lat is invalid`);
    if (!validLng) bad(`${at}.lng is invalid`);
    if (validLat && validLng) {
      const coordinate = `${spot.lat === 0 ? 0 : spot.lat},${spot.lng === 0 ? 0 : spot.lng}`;
      if (coordinates.has(coordinate)) bad(`${at} duplicates coordinates ${coordinate}`);
      else coordinates.add(coordinate);
    }
    if (typeof spot.timeZone !== 'string' || !isValidIanaTimeZone(spot.timeZone)) bad(`${at}.timeZone is invalid`);
    if (!kinds.has(spot.kind)) bad(`${at}.kind must be gym/showcase/both`);
    if (!statuses.has(spot.status)) bad(`${at}.status must be tested/candidate/mixed`);
    if (spot.group !== null && (typeof spot.group !== 'string' || !spot.group.trim())) bad(`${at}.group must be null or non-empty`);
    if (spot.rating !== null && ![1,2,3].includes(spot.rating)) bad(`${at}.rating must be null/1/2/3`);
    if (typeof spot.needsReview !== 'boolean') bad(`${at}.needsReview must be boolean`);
    if (typeof spot.note !== 'string') bad(`${at}.note must be a string`);
    for (const key of forbidden) if (own(spot, key)) bad(`${at}.${key} is forbidden`);
  });
  return errors;
}

const canonicalErrors = locationErrors(locations);
for (const error of canonicalErrors) console.error('locations.json: ' + error);
assert.deepEqual(canonicalErrors, []);
assert.deepEqual(locations.schedule, schedule);
// Migration regression only: future intentional additions update this fixture, not the schema.
assert.equal(locations.spots.length, 23, 'initial authoritative dataset size');
const spots = Object.fromEntries(locations.spots.map(spot => [spot.id, spot]));
assert.equal(Object.keys(spots).length, 23);
assert.equal(spots['in-mysuru'].lat, 12.2804841721832);
assert.equal(spots['in-mysuru'].lng, 76.6243600845337);
assert.equal(spots['in-mysuru'].kind, 'both');
assert.match(spots['in-mysuru'].note, /Showcase参加人数特别少/);
assert.equal(spots['mx-sonora-candidate'].lat, 31.304716794288);
assert.equal(spots['mx-sonora-candidate'].lng, -109.5490711927414);
assert.equal(spots['mx-sonora-candidate'].note, 'showcase不行但是没人打gym的样子');
assert.equal(spots['bd-chattogram-02'].lat, 22.3662090301514);
assert.equal(spots['bd-chattogram-02'].lng, 91.7963943481445);
assert.equal(spots['bd-chattogram-02'].note, '卧槽吉大港这里');
assert.equal(spots['us-or-redmond-candidate'].lat, 44.2626044);
assert.equal(spots['us-or-redmond-candidate'].lng, -121.304635);

const cloneLocations = () => JSON.parse(JSON.stringify(locations));
for (const [field, value] of [['kind','other'], ['status','other'], ['rating',0], ['rating',4], ['rating',1.5]]) {
  const changed = cloneLocations();
  changed.spots[0][field] = value;
  assert.ok(locationErrors(changed).some(error => error.includes(`.${field}`)), `${field}=${value} must fail`);
}
const duplicateCoordinates = cloneLocations();
duplicateCoordinates.spots[1].lat = duplicateCoordinates.spots[0].lat;
duplicateCoordinates.spots[1].lng = duplicateCoordinates.spots[0].lng;
assert.ok(locationErrors(duplicateCoordinates).some(error => error.includes('duplicates coordinates')));

// Required filter semantics and primary sorts.
assert.deepEqual(SPOT_KIND_OPTIONS, ['gym','showcase','both']);
assert.ok(SPOT_SORT_VALUES.includes('next'));
assert.ok(SPOT_SORT_VALUES.includes('timezone'));
const mysuruView = { spot:spots['in-mysuru'], country:'India' };
const filters = kind => ({ search:'', country:'', kind, status:'', review:'' });
assert.equal(spotMatches(mysuruView, filters('gym')), false);
assert.equal(spotMatches(mysuruView, filters('both')), true);

const synthetic = (id, country, name, target, currentOffset) => ({
  spot:{ id, name, rating:null }, country, target:new Date(target), currentOffset,
});
const nextSorted = sortSpotViews([
  synthetic('z','B','A','2026-01-01T00:00:00Z',0),
  synthetic('b','A','A','2026-01-01T00:00:00Z',0),
  synthetic('a','A','A','2026-01-01T00:00:00Z',0),
  synthetic('early','Z','Z','2025-12-31T23:00:00Z',-60),
], 'next');
assert.deepEqual(nextSorted.map(view => view.spot.id), ['early','a','b','z']);
const zoneSorted = sortSpotViews([
  synthetic('minus','Z','Z','2026-01-01T00:00:00Z',-300),
  synthetic('tie-b','A','A','2026-01-01T00:00:00Z',330),
  synthetic('plus','Z','Z','2026-01-01T00:00:00Z',840),
  synthetic('tie-a','A','A','2026-01-01T00:00:00Z',330),
], 'timezone');
assert.deepEqual(zoneSorted.map(view => view.spot.id), ['plus','tie-a','tie-b','minus']);

// Persistence degrades safely, empty notes vanish, ratings are stars, map query is exact.
const memory = new Map();
const storage = { getItem:key => memory.has(key) ? memory.get(key) : null, setItem:(key, value) => memory.set(key, value) };
spotSavePreferences({ kind:'both', sort:'timezone' }, storage);
assert.deepEqual(spotLoadPreferences(storage), { kind:'both', sort:'timezone' });
memory.set('pogo-spot-filter', 'invalid');
memory.set('pogo-spot-sort', 'invalid');
assert.deepEqual(spotLoadPreferences(storage), { kind:'', sort:'next' });
const brokenStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
assert.deepEqual(spotLoadPreferences(brokenStorage), { kind:'', sort:'next' });
assert.doesNotThrow(() => spotSavePreferences({ kind:'both', sort:'timezone' }, brokenStorage));
assert.equal(spotNoteBlock(''), '');
assert.match(spotNoteBlock('原样<&'), /原样&lt;&amp;/);
assert.equal(spotRatingStars(null), '');
assert.equal(spotRatingStars(1), '⭐');
assert.equal(spotRatingStars(2), '⭐⭐');
assert.equal(spotRatingStars(3), '⭐⭐⭐');
const map = new URL(spotMapUrl({ lat:22.363407, lng:114.331268 }));
assert.equal(map.origin + map.pathname, 'https://pokemongo.com/map');
assert.deepEqual(Object.fromEntries(map.searchParams), { is_login_event:'1', lat:'22.363407', lng:'114.331268' });
assert.equal(map.searchParams.has('zoom'), false);
assert.match(html, /<option value="next"[^>]*data-i18n="spots\.sortNext"/);
assert.match(html, /<option value="timezone"[^>]*data-i18n="spots\.sortTimezone"/);

// One canonical name/note, symmetric UI keys, and no fixed display-zone fields.
const forbidden = ['nameZh','nameEn','displayTimeZone','flag','utcOffset','browserTime','displayTime','chinaTime','nextTuesday','mapUrl'];
for (const spot of locations.spots) {
  assert.equal(typeof spot.name, 'string');
  assert.ok(spot.name.trim());
  assert.equal(isValidIanaTimeZone(spot.timeZone), true, spot.timeZone);
  for (const key of forbidden) assert.equal(Object.hasOwn(spot, key), false, `${spot.id}.${key}`);
}
assert.equal(Object.hasOwn(locations.schedule, 'displayTimeZone'), false);
assert.equal(Object.hasOwn(ui['zh-CN'], 'spots.chinaTime'), false);
assert.equal(Object.hasOwn(ui.en, 'spots.chinaTime'), false);
assert.equal(ui['zh-CN']['spots.browserTime'], '我的时间');
assert.equal(ui.en['spots.browserTime'], 'My Local Time');
assert.equal(ui.en['spots.kind.gym'], 'Gym');
assert.equal(ui.en['spots.kind.showcase'], 'Showcase');
assert.equal(ui.en['spots.kind.both'], 'Gym + Showcase');
assert.equal(ui.en['spots.sortNext'], 'Upcoming Tuesday 20:00');
assert.match(ui.en['spots.sortTimezone'], /^Timezone Order/);
for (const locale of ['zh-CN','en']) {
  const nameKeys = Object.keys(ui[locale]).filter(key => /^spots\.(?:name|names|locationName)(?:\.|$)/.test(key));
  assert.deepEqual(nameKeys, [], `${locale} contains location-name translation keys`);
}

console.log(`spot-atlas-time: OK (${locations.spots.length} authoritative spots; timezone, schema, UI, sort, persistence, map, and World Clock lifecycle/range checks)`);
