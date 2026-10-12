#!/usr/bin/env node
// Read-only planning hints. Never marks any source or detail as processed.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
let base = 'HEAD', report = null, now = new Date().toISOString();
const selected = {changed: [], pending: [], force: [], monthly: []};
for (let i = 0; i < args.length; i += 2) {
  if (args[i] === '--base-ref') base = args[i + 1];
  else if (args[i] === '--discovery') report = args[i + 1];
  else if (args[i] === '--now') now = args[i + 1];
  else if (args[i] === '--changed') selected.changed.push(args[i + 1]);
  else if (args[i] === '--pending') selected.pending.push(args[i + 1]);
  else if (args[i] === '--force') selected.force.push(args[i + 1]);
  else if (args[i] === '--monthly-url') selected.monthly.push(args[i + 1]);
  else { console.error('usage: daily-worklist.js [--base-ref REF] [--discovery REPORT] [--now ISO]'); process.exit(2); }
}
try {
  const extra = Object.entries(selected).flatMap(([key, values]) => values.flatMap(value => [`--${key === 'monthly' ? 'monthly-url' : key}`, value]));
  const candidate = JSON.parse(execFileSync('node', [path.join(__dirname, 'daily-candidates.js'), '--base-ref', base, '--now', now, ...extra], { cwd: root, encoding: 'utf8' }));
  const state = JSON.parse(execFileSync('git', ['show', `${candidate.baseRef}:data/state.json`], { cwd: root, encoding: 'utf8' }));
  const names = ['events', 'raids', 'gamemaster', 'tiers-attackers', 'tiers-defenders', 'tiers-pokebase', 'events-hub', 'events-pokebase', 'events-official'];
  const sources = Object.fromEntries(names.map(name => {
    const ext = /^(events|raids|gamemaster)$/.test(name) ? 'json' : 'txt';
    const file = path.join(root, 'data/raw', `${name}.${ext}`);
    let modified = null, cachedHash = null;
    try {
      modified = fs.statSync(file).mtime.toISOString();
      cachedHash = createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
    } catch { /* no cache */ }
    const processedHash = state.sources?.[name]?.sha256 ?? null;
    return [name, { cachedAt: modified, cachedHash, processedHash,
      status: !modified ? 'missing' : cachedHash === processedHash ? 'same bytes (age/coverage still need checking)' : 'unprocessed bytes or unknown baseline' }];
  }));
  let discovery = null;
  if (report) discovery = JSON.parse(fs.readFileSync(report, 'utf8'));
  const leads = discovery?.candidates ?? [];
  console.log(JSON.stringify({ baseRef: candidate.baseRef, generatedAt: now, advisoryOnly: true,
    sources, changedIds: selected.changed.length ? selected.changed : null, // unknown until Scout interprets list deltas
    newIds: [...new Set(leads.map(row => row.id).filter(Boolean))],
    leads: leads.map(({source, id, title, url, reason}) => ({source, id, title, url, reason})),
    detailUrls: candidate.details.map(({url, eventIds, reasons, action}) => ({url, eventIds, reasons, action})),
    dateChanges: candidate.dateChecks, discoveryStatus: discovery?.status ?? 'not-run',
    pendingDate: discovery?.pendingDate ?? [], exceptions: discovery?.exceptions ?? [],
    gaps: discovery?.gaps ?? ['discovery not yet run; source coverage unknown'] }));
} catch (error) { console.error(`daily-worklist: incomplete — ${error.message}`); process.exit(1); }
