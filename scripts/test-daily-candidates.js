#!/usr/bin/env node
// Actual selector checks, not claims about model behavior. The shell supplies an
// isolated repo/cache fixture; never invokes a model, network or publication.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { candidates } = require('./daily-candidates.js');
const { resolveEventTiming } = require('../public/app.js');
const crypto = require('node:crypto');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const url = id => `https://leekduck.com/events/${id}/`;
const event = (id, start, end = start, type = 'event') => ({ id, start, end, type, link: url(id) });
const now = '2026-09-10T12:00:00Z';
const events = [event('active', '2026-09-09', '2026-09-11'), event('near', '2026-09-17'),
  event('far', '2026-10-20'), event('ended', '2026-09-09'), event('pending', '2026-10-21')];
const rotations = { month: '2026-09', tracks: [{ key: 'max', segments: [
  { start: '2026-09-01', end: '2026-09-10', pokemon: [{ id: 1 }] },
  { start: '2026-09-11', end: '2026-09-30', pokemon: [{ id: 2 }] }
] }] };
const state = { lastUpdated: now, sources: { events: { sha256: 'unchanged-list' } },
  details: Object.fromEntries(events.map(e => [e.link, { sha256: 'old', checkedAt: now, pending: false }])) };
const cache = Object.fromEntries(events.map(e => [e.link, { sha256: 'old', lastFetch: now }]));
const input = { events, rotations, baseEvents: events, baseRotations: rotations, state, now, cache };
const run = overrides => candidates({ ...input, ...overrides });
let report = run();
assert.deepEqual(report.details.map(d => d.url), [url('active'), url('near')]);
assert(report.details.every(d => d.action === 'reuse' && !d.needsProcessing));
assert.deepEqual(report.dateChecks, { monthChanged: false, activeEventsChanged: false,
  bossesChanged: false, recommendationWindowChanged: false, pruneIds: [] });
assert.equal(report.dateChecksAreHints, true);
assert.deepEqual(report.uncertainTimingIds, ['active', 'near']); // legacy fixtures stay conservative
// Identical list input + changed detail bytes must enter downstream interpretation.
report = run({ cache: { ...cache, [url('active')]: { sha256: 'new', lastFetch: now } } });
assert(report.details.find(d => d.url === url('active')).needsProcessing);
assert(report.details[0].reasons.includes('unprocessed-body'));
assert.equal(report.details[0].processedHash, 'old');
assert.equal(report.details[0].action, 'reuse'); // fresh failed-run bytes still need processing
report = run({ cache: {} });
assert(report.details.every(d => d.action === 'refresh'));
report = run({ cache: { ...cache, [url('active')]: { sha256: 'old', lastFetch: '2026-09-09T12:00:00Z' } } });
assert.equal(report.details[0].action, 'refresh'); // exact 24h boundary
report = run({ force: ['ended', 'far'] });
assert.deepEqual(report.details.filter(d => d.action === 'force').map(d => d.url), [url('far'), url('ended')]);
assert(run({ changed: ['far'] }).details.find(d => d.url === url('far')).needsProcessing);
assert(run({ pending: ['pending'] }).details.some(d => d.url === url('pending')));
assert(!run({ pending: ['ended'] }).details.some(d => d.url === url('ended')));
assert(run({ baseEvents: events.filter(e => e.id !== 'far') }).details.find(d => d.url === url('far')).reasons.includes('new-event'));
// Shared URLs produce one read and all affected IDs, even distant references.
const shared = [...events, { ...event('shared-far', '2026-10-22'), link: url('active') }];
report = run({ events: shared });
assert.equal(report.details.filter(d => d.url === url('active')).length, 1);
assert.deepEqual(report.details[0].eventIds, ['active', 'shared-far']);
const monthly = 'https://pokemongohub.net/post/monthly/';
report = run({ monthlyUrls: [monthly] });
assert.equal(report.details.find(d => d.url === monthly).action, 'refresh');
// No state migration should force all distant/historical URLs to refetch daily.
assert.deepEqual(run({ state: { lastUpdated: now } }).details.map(d => d.url), [url('active'), url('near'), url('far'), url('ended'), url('pending')]);
assert.deepEqual(run({ state: { lastUpdated: now }, cache: {} }).details.map(d => d.url), [url('active'), url('near')]);
// Date advancement alone: ongoing→ended, upcoming→active, Max change, month change.
report = run({ now: '2026-09-11T12:00:00Z' });
assert.equal(report.dateChecks.bossesChanged, true);
report = run({ now: '2026-09-12T12:00:00Z' });
assert.equal(report.dateChecks.activeEventsChanged, true);
assert.equal(report.dateChecks.recommendationWindowChanged, true);
report = run({ now: '2026-09-17T12:00:00Z' });
assert.equal(report.dateChecks.activeEventsChanged, true);
report = run({ now: '2026-10-01T00:00:00Z' });
assert.equal(report.dateChecks.monthChanged, true);
report = run({ events: [...events, event('too-old', '2026-06-11'), event('boundary', '2026-06-12')] });
assert.deepEqual(report.dateChecks.pruneIds, ['too-old']);
// UTC date has advanced, but this global-local event remains open in UTC−12.
const global = { ...event('global-last-zone', '2026-10-11T14:00:00', '2026-10-11T17:00:00'),
  timing: { scope:'global', mode:'local', startPrecision:'exact', endPrecision:'exact' } };
const beforeClose = '2026-10-12T04:59:59Z', atClose = '2026-10-12T05:00:00Z';
assert.equal(resolveEventTiming(global, beforeClose, 'UTC').status, 'active');
const evening = candidates({ ...input, events:[global], baseEvents:[global], now:beforeClose,
  state:{ ...state, lastUpdated:'2026-10-11T23:00:00Z' }, cache:{} });
assert(evening.details.some(d => d.url === global.link && d.reasons.includes('active-or-next-7-days')));
assert.equal(evening.dateChecks.activeEventsChanged, false); // same live window across UTC midnight
const closed = candidates({ ...input, events:[global], baseEvents:[global], now:atClose,
  state:{ ...state, lastUpdated:beforeClose }, cache:{} });
assert(!closed.details.some(d => d.url === global.link));
assert.equal(closed.dateChecks.activeEventsChanged, true);
// Date-only windows are not fabricated as exact instants, and their pending
// details remain candidates even beyond the next seven days.
const dateOnly = { ...event('announced-date', '2027-02-27', '2027-02-28'),
  timing: { scope:'global', mode:'local', startPrecision:'date', endPrecision:'date' } };
const pendingDate = candidates({ ...input, events:[dateOnly], baseEvents:[dateOnly], cache:{},
  now:'2026-10-12T12:00:00Z' });
assert(pendingDate.details.find(d => d.url === dateOnly.link).reasons.includes('pending-timing'));
const settledPending = candidates({ ...input, events:[dateOnly], baseEvents:[dateOnly],
  now:'2026-10-12T12:00:00Z', state:{ lastUpdated:now,
    details:{ [dateOnly.link]:{ sha256:'same', checkedAt:now, pending:true } } },
  cache:{ [dateOnly.link]:{ sha256:'same', lastFetch:'2026-10-11T00:00:00Z' } } });
assert.equal(settledPending.details[0].action, 'refresh');
assert.equal(settledPending.details[0].needsProcessing, false); // same processed bytes need no re-interpretation
assert.deepEqual(pendingDate.uncertainTimingIds, []); // far-future, outside recommendation window
// End absent means no automatic expiry or historical-prune decision.
const openEnd = { ...event('open-ended', '2026-10-11T14:00:00', null), end:null,
  timing: { scope:'global', mode:'local', startPrecision:'exact', endPrecision:'unknown' } };
const openEnded = candidates({ ...input, events:[openEnd], baseEvents:[openEnd], cache:{},
  state:{ ...state, lastUpdated:'2026-10-19T12:00:00Z' }, now:'2026-10-20T00:00:00Z' });
assert.equal(openEnded.dateChecks.activeEventsChanged, false);
assert(openEnded.details.some(d => d.url === openEnd.link && d.reasons.includes('pending-timing')));
assert(!candidates({ ...input, events:[openEnd], baseEvents:[openEnd], cache:{},
  now:'2027-03-20T00:00:00Z' }).dateChecks.pruneIds.includes(openEnd.id));

// Exercise the CLI's committed baseline choice in a temporary Git repo with a
// contradictory draft state and a fresh last-failed-run raw cache.
const dir = process.argv[2];
assert(dir, 'run through scripts/test-daily-reuse.sh for an isolated fixture');
const write = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
write('public/data/events.json', events);
write('public/data/rotations.json', rotations);
write('data/state.json', state);
fs.writeFileSync(path.join(dir, '.gitignore'), 'data/raw/\n');
const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
git('init', '-q'); git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@example.invalid');
git('add', 'public/data/events.json', 'public/data/rotations.json', 'data/state.json', '.gitignore');
git('commit', '-qm', 'committed successful baseline');
const base = git('rev-parse', 'HEAD');
const body = 'changed rewards from failed run', bodyHash = hash(body), key = hash(url('active'));
write(`data/raw/details/${key}.json`, { url: url('active'), lastFetch: now, sha256: bodyHash });
fs.writeFileSync(path.join(dir, `data/raw/details/${key}.${bodyHash}.txt`), body);
const draft = structuredClone(state);
draft.lastUpdated = '2026-09-12T12:00:00Z';
draft.details[url('active')].sha256 = bodyHash;
write('data/state.json', draft);
const before = fs.readFileSync(path.join(dir, 'data/state.json'), 'utf8');
const cli = JSON.parse(execFileSync('node', ['scripts/daily-candidates.js', '--base-ref', base,
  '--now', '2026-09-12T12:00:00Z'], { cwd: dir, encoding: 'utf8' }));
assert.equal(cli.baseRef, base);
assert.equal(cli.details.find(d => d.url === url('active')).processedHash, 'old');
assert.equal(cli.details.find(d => d.url === url('active')).needsProcessing, true);
assert.equal(cli.dateChecks.activeEventsChanged, true);
assert.equal(fs.readFileSync(path.join(dir, 'data/state.json'), 'utf8'), before, 'selector must not write state');
assert.throws(() => execFileSync('node', ['scripts/daily-candidates.js', '--base-ref', 'missing-ref'],
  { cwd: dir, stdio: 'pipe' }), 'bad committed baseline must not fall back to draft state');
console.log('test-daily-candidates: PASS (selection/date hints + committed recovery baseline; no model inference tested)');
