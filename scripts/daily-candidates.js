#!/usr/bin/env node
// Read-only hints, not a scheduler or a completion marker. Pi interprets sources.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const day = value => String(value).slice(0, 10); // same date-prefix convention as preflight/retention
const shiftDay = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const links = e => [...new Set([e.link, ...(e.links || []).map(l => l.url)].filter(Boolean))];
const live = (e, date) => day(e.start) <= date && day(e.end || e.start) >= date;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ids = events => events.map(e => e.id).sort();
function bosses(events, rotations, date) {
  const rows = events.filter(e => live(e, date) && /raid|^max-|dynamax|gigantamax/.test(e.type))
    .map(e => [e.id, e.pokemon || []]);
  for (const t of rotations.tracks) for (const s of t.segments) {
    if (live(s, date)) rows.push([t.key, s.pokemon]);
  }
  return rows.map(row => JSON.stringify(row)).sort();
}

function candidates({ events, rotations, baseEvents, baseRotations, state, now,
  changed = [], pending = [], force = [], monthlyUrls = [], cache = {} }) {
  const today = day(now), previous = state.lastUpdated && day(state.lastUpdated);
  const nearEnd = shiftDay(today, 7), oldIds = new Set(ids(baseEvents));
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
      if (day(e.end || e.start) < today) continue;
      if (day(e.start) <= nearEnd) reasons.add('active-or-next-7-days');
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
      needsProcessing: forced || !fresh || unprocessed || !baseline ||
        reasons.has('new-event') || reasons.has('changed-entry'),
      cachedHash: material?.sha256 || null, processedHash: baseline?.sha256 || null });
  }
  const current = events.filter(e => live(e, today));
  const upcoming = (es, d) => ids(es.filter(e => day(e.end || e.start) >= d && day(e.start) <= shiftDay(d, 7)));
  return { baseline: 'committed state only', today, details,
    dateChecks: {
      monthChanged: rotations.month !== today.slice(0, 7) || !previous || previous.slice(0, 7) !== today.slice(0, 7),
      activeEventsChanged: !previous || !same(ids(current), ids(baseEvents.filter(e => live(e, previous)))),
      bossesChanged: !previous || !same(bosses(events, rotations, today), bosses(baseEvents, baseRotations, previous)),
      recommendationWindowChanged: !previous || !same(upcoming(events, today), upcoming(baseEvents, previous)),
      pruneIds: ids(events.filter(e => day(e.end || e.start) < shiftDay(today, -90)))
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
