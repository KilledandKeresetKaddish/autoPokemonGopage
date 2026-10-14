#!/usr/bin/env node
// Read-only hints, not a scheduler or a completion marker. Pi interprets sources.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { resolveEventTiming, parseEventTime } = require('../public/app.js');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const day = value => String(value).slice(0, 10); // same date-prefix convention as preflight/retention
const shiftDay = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const links = e => [...new Set([e.link, ...(e.links || []).map(l => l.url)].filter(Boolean))];
// Pure timing is authoritative for known instants; unknown/date/legacy windows
// remain conservative hints. Last possible end on a calendar date is UTC−12
// next day 12:00Z, independent of the server's TZ. Never use parseDay here.
const boundaryDay = value => parseEventTime(value).error ? null : day(value);
function possible(e, now) {
  const resolved = resolveEventTiming(e, now, 'UTC');
  if (resolved.status === 'error' && e.timing) return false; // gate will report invalid data
  const startDay = boundaryDay(e.start);
  const endDay = e.end == null && e.timing?.endPrecision === 'unknown' ? null : boundaryDay(e.end || e.start);
  const earliest = startDay ? Date.parse(`${startDay}T00:00:00Z`) - 14 * 3600000 : -Infinity;
  const latest = endDay ? Date.parse(`${endDay}T00:00:00Z`) + 36 * 3600000 : Infinity;
  return { start:resolved.openAt?.getTime() ?? earliest, end:resolved.closeAt?.getTime() ?? latest };
}
const live = (e, now) => {
  const bounds = possible(e, now);
  return bounds && bounds.start <= Date.parse(now) && Date.parse(now) < bounds.end;
};
const segmentLive = (seg, now) => day(seg.start) <= day(now) && day(seg.end || seg.start) >= day(now);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ids = events => events.map(e => e.id).sort();
function bosses(events, rotations, now) {
  const rows = events.filter(e => live(e, now) && /raid|^max-|dynamax|gigantamax/.test(e.type))
    .map(e => [e.id, e.pokemon || []]);
  for (const t of rotations.tracks) for (const s of t.segments) {
    if (segmentLive(s, now)) rows.push([t.key, s.pokemon]);
  }
  return rows.map(row => JSON.stringify(row)).sort();
}

function candidates({ events, rotations, baseEvents, baseRotations, state, now,
  changed = [], pending = [], force = [], monthlyUrls = [], cache = {} }) {
  const today = day(now), previous = state.lastUpdated || null;
  const oldIds = new Set(ids(baseEvents));
  const byUrl = new Map();
  for (const e of events) for (const url of links(e)) {
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(e);
  }
  for (const url of monthlyUrls) if (!byUrl.has(url)) byUrl.set(url, []);
  const details = [];
  for (const [url, refs] of byUrl) {
    const baseline = state.details?.[url];
    const material = cache[url];
    const reasons = new Set();
    if (monthlyUrls.includes(url)) reasons.add('monthly-article');
    for (const e of refs) {
      if (force.includes(e.id)) reasons.add('operator-force');
      if (!oldIds.has(e.id)) reasons.add('new-event');
      if (changed.includes(e.id)) reasons.add('changed-entry');
      const bounds = possible(e, now);
      if (!bounds || bounds.end <= Date.parse(now)) continue;
      if (bounds.start < Date.parse(`${shiftDay(today, 8)}T00:00:00Z`)) reasons.add('active-or-next-7-days');
      if (e.timing && (e.timing.scope === 'unknown' || e.timing.mode === 'unknown' ||
          e.timing.startPrecision !== 'exact' || e.timing.endPrecision !== 'exact'))
        reasons.add('pending-timing');
      // Explicit IDs cover pending facts not recognizable in prose. The marker
      // is a conservative hint, never proof an event is complete/incomplete.
      if (pending.includes(e.id) || baseline?.pending || /待公布|待补|待定|TBD|to be announced/i.test(JSON.stringify(e))) {
        reasons.add('pending-details');
      }
    }
    // Failed-run cache bytes can be fresh yet never processed by the last
    // successful publication. Do not compare a cache hash with itself/draft state.
    const unprocessed = !!material && material.sha256 !== baseline?.sha256;
    if (unprocessed) reasons.add('unprocessed-body');
    if (!reasons.size) continue;
    const age = material ? (Date.parse(now) - Date.parse(material.lastFetch)) / 1000 : Infinity;
    const forced = reasons.has('operator-force');
    const fresh = age >= 0 && age < 86400;
    details.push({ url, eventIds: ids(refs), reasons: [...reasons],
      action: forced ? 'force' : fresh ? 'reuse' : 'refresh',
      // A pending fact still triggers a body check, not a re-derivation of
      // identical bytes that were already processed successfully.
      needsProcessing: forced || unprocessed || !baseline ||
        reasons.has('new-event') || reasons.has('changed-entry'),
      cachedHash: material?.sha256 || null, processedHash: baseline?.sha256 || null });
  }
  const current = events.filter(e => live(e, now));
  const upcoming = (es, at) => ids(es.filter(e => { const b = possible(e, at);
    return b && b.end > Date.parse(at) && b.start < Date.parse(`${shiftDay(day(at), 8)}T00:00:00Z`); }));
  return { baseline: 'committed state only', today, details,
    dateChecksAreHints: true,
    uncertainTimingIds: ids(events.filter(e => { const b = possible(e, now);
      return b && (e.timing?.scope === 'unknown' || e.timing?.mode === 'unknown' ||
        e.timing?.startPrecision !== 'exact' || e.timing?.endPrecision !== 'exact') &&
        b.end > Date.parse(now) && b.start < Date.parse(`${shiftDay(today, 8)}T00:00:00Z`); })),
    dateChecks: {
      monthChanged: rotations.month !== today.slice(0, 7) || !previous || day(previous).slice(0, 7) !== today.slice(0, 7),
      activeEventsChanged: !previous || !same(ids(current), ids(baseEvents.filter(e => live(e, previous)))),
      bossesChanged: !previous || !same(bosses(events, rotations, now), bosses(baseEvents, baseRotations, previous)),
      recommendationWindowChanged: !previous || !same(upcoming(events, now), upcoming(baseEvents, previous)),
      // Retention uses the calendar end date, not reminder closeAt. With no
      // recorded end, do not manufacture expiry from start.
      pruneIds: ids(events.filter(e => e.end != null && day(e.end) < shiftDay(today, -90)))
    } };
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    const opts = { baseRef: 'HEAD', now: new Date().toISOString(), changed: [], pending: [], force: [], monthlyUrls: [] };
    const flags = { '--base-ref': 'baseRef', '--now': 'now', '--changed': 'changed', '--pending': 'pending', '--force': 'force', '--monthly-url': 'monthlyUrls' };
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) {
      const key = flags[args[i]], value = args[i + 1];
      if (!key || !value) throw new Error('usage: daily-candidates.js [--base-ref REF] [--now ISO] [--changed ID] [--pending ID] [--force ID] [--monthly-url URL] (ID/URL flags repeatable)');
      if (Array.isArray(opts[key])) opts[key].push(value); else opts[key] = value;
    }
    if (!Number.isFinite(Date.parse(opts.now))) throw new Error('invalid --now');
    opts.now = new Date(opts.now).toISOString();
    // Always resolve/read committed objects, including in recovered-draft runs.
    const ref = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${opts.baseRef}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
    const committed = file => JSON.parse(execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8' }));
    const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    const events = read('public/data/events.json'), rotations = read('public/data/rotations.json');
    const cache = {};
    for (const url of new Set([...events.flatMap(links), ...opts.monthlyUrls])) {
      try {
        const key = hash(url), dir = path.join(root, 'data/raw/details');
        const meta = JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), 'utf8'));
        if (meta.url !== url || !/^[a-f0-9]{64}$/.test(meta.sha256) || !Number.isFinite(Date.parse(meta.lastFetch))) continue;
        const body = fs.readFileSync(path.join(dir, `${key}.${meta.sha256}.txt`));
        if (body.length && hash(body) === meta.sha256) cache[url] = meta;
      } catch { /* missing/damaged cache is not a freshness/completion proof */ }
    }
    console.log(JSON.stringify({ baseRef: ref, ...candidates({ ...opts, events, rotations, cache,
      state: committed('data/state.json'), baseEvents: committed('public/data/events.json'),
      baseRotations: committed('public/data/rotations.json') }) }, null, 2));
  } catch (error) { console.error(`daily-candidates: INCOMPLETE — ${error.message}`); process.exitCode = 1; }
}
module.exports = { candidates };
