#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { parseEventTime, validateEventTiming, resolveEventTiming } = require('../public/app.js');
const fixtures = require('./fixtures/event-timing.json');
const defaultTiming = { scope:'global', mode:'local', startPrecision:'exact', endPrecision:'exact' };
for (const entry of fixtures.valid) {
  const { now, viewerTimeZone, openAt, closeAt, viewerStart, viewerEnd, status, ...event } = entry;
  assert.deepEqual(validateEventTiming(event), [], entry.id);
  const result = resolveEventTiming(event, now, viewerTimeZone);
  assert.equal(result.status, status, entry.id + ': ' + result.reason);
  for (const [name, actual, expected] of [
    ['openAt',result.openAt,openAt], ['closeAt',result.closeAt,closeAt],
    ['viewer start',result.viewerWindow.start?.instant || null,viewerStart],
    ['viewer end',result.viewerWindow.end?.instant || null,viewerEnd]]) {
    assert.equal(actual?.toISOString() || null, expected, `${entry.id}: ${name}`);
  }
}
for (const entry of fixtures.invalid) {
  const event = { ...entry, timing: entry.timing === undefined ? defaultTiming : entry.timing };
  assert(validateEventTiming(event).length, `${entry.id} must fail validation`);
  assert.equal(resolveEventTiming(event, '2026-10-12T00:00:00Z', 'UTC').status, 'error', entry.id);
}
assert.equal(validateEventTiming({ start:'2026-01-01' }, { allowLegacy:true }).length, 0);
assert(validateEventTiming({ start:'2026-01-01' }).length);
assert.equal(parseEventTime('2028-02-29T12:00:00.123Z').instant.toISOString(), '2028-02-29T12:00:00.123Z');
// A verified boundary crosses a host UTC date; no future timezone guess may
// truncate the last UTC−12 window. The actual close instant is exclusive.
const global = fixtures.valid[0];
assert.equal(resolveEventTiming(global, '2026-10-12T05:00:00Z', 'UTC').status, 'expired');
for (const zone of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
  assert.equal(resolveEventTiming(global, global.now, zone).openAt.toISOString(), global.openAt);
  assert.equal(resolveEventTiming(global, global.now, zone).closeAt.toISOString(), global.closeAt);
}
// CLI gate rejects incomplete/invalid rows, but allows a separately valid
// date-only event. All scratch files stay inside the mounted workspace.
const root = path.join(__dirname, '../.pi-tmp');
fs.mkdirSync(root, { recursive:true });
const dir = fs.mkdtempSync(path.join(root, 'event-timing-'));
const temp = path.join(dir, 'fixture.json');
try {
  fs.writeFileSync(temp, JSON.stringify([{ ...global, id:'gate-valid' }]));
  assert.equal(spawnSync(process.execPath, ['scripts/check-event-timing.js',temp], { encoding:'utf8' }).status, 0);
  fs.writeFileSync(temp, JSON.stringify([{ ...global, id:'gate-invalid', timing:null }]));
  assert.equal(spawnSync(process.execPath, ['scripts/check-event-timing.js',temp], { encoding:'utf8' }).status, 1);
} finally { fs.rmSync(dir, { recursive:true, force:true }); }
// Contract results must not depend on the Node server process timezone.
const program = `const t=require('./public/app.js').resolveEventTiming(${JSON.stringify(global)},${JSON.stringify(global.now)},'UTC');process.stdout.write(t.openAt.toISOString()+' '+t.closeAt.toISOString());`;
const values = ['UTC','Pacific/Honolulu','Europe/Berlin'].map(TZ =>
  execFileSync(process.execPath, ['-e',program], { cwd:path.join(__dirname,'..'), encoding:'utf8', env:{ ...process.env,TZ } }));
assert.equal(new Set(values).size, 1);
console.log(`test-event-timing: PASS (${fixtures.valid.length} valid / ${fixtures.invalid.length} invalid fixtures, CLI gate, host TZ)`);
