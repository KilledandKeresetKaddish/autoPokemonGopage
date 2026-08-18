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
} = require('../public/app.js');

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

// Half-hour offsets must survive both wall-clock conversion and display formatting.
assert.equal(timeZoneOffsetMinutes(new Date('2026-08-18T12:00:00Z'), 'Asia/Kolkata'), 330);
assert.equal(stamp('Asia/Kolkata', 'Asia/Shanghai'), '2026-08-18 22:30');

// Europe and North America both change offsets between winter and summer.
assert.equal(timeZoneOffsetMinutes(new Date('2026-01-20T12:00:00Z'), 'Europe/London'), 0);
assert.equal(timeZoneOffsetMinutes(new Date('2026-08-18T12:00:00Z'), 'Europe/London'), 60);
assert.equal(timeZoneOffsetMinutes(new Date('2026-01-20T12:00:00Z'), 'America/Toronto'), -300);
assert.equal(timeZoneOffsetMinutes(new Date('2026-08-18T12:00:00Z'), 'America/Toronto'), -240);

// One instant, three explicit browser display zones; no host-timezone dependency.
const shared = new Date('2026-08-18T12:00:00Z');
assert.equal(formatTargetForZone(shared, 'Asia/Shanghai', 'en').time, '20:00');
assert.equal(formatTargetForZone(shared, 'America/Toronto', 'en').time, '08:00');
assert.equal(formatTargetForZone(shared, 'Europe/London', 'en').time, '13:00');

// The canonical location data owns one untranslated name per row and no derived fields.
const root = path.resolve(__dirname, '..');
const locations = JSON.parse(fs.readFileSync(path.join(root, 'public/data/locations.json'), 'utf8'));
const ui = JSON.parse(fs.readFileSync(path.join(root, 'public/data/i18n/ui.json'), 'utf8'));
assert.ok(locations.spots.length > 0);
assert.deepEqual(locations.schedule, schedule);
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
for (const locale of ['zh-CN','en']) {
  const nameKeys = Object.keys(ui[locale]).filter(key => /^spots\.(?:name|names|locationName)(?:\.|$)/.test(key));
  assert.deepEqual(nameKeys, [], `${locale} contains location-name translation keys`);
}

console.log(`spot-atlas-time: OK (${Object.keys(shanghai).length + Object.keys(toronto).length} conversion fixtures, DST/boundary/fallback/data checks)`);
