#!/usr/bin/env node
// Machine-only, atomic ignored-log summary. Never modifies tracked state.json.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const [directory, status, exitCode, startMillis] = process.argv.slice(2);
if (!directory || !status || !/^(published|failed|unconfirmed)$/.test(status)) process.exit(2);
function lines(file) {
  try { return fs.readFileSync(path.join(directory, file), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function atomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally { try { fs.unlinkSync(temp); } catch { /* renamed */ } }
}
try {
  const events = lines('events.jsonl') || [];
  const fetch = fs.existsSync(path.join(directory, 'fetch.jsonl.error')) ? null : lines('fetch.jsonl');
  const discover = fs.existsSync(path.join(directory, 'discover.jsonl.error')) ? null : lines('discover.jsonl');
  const result = (() => { try { return JSON.parse(fs.readFileSync(path.join(directory, 'agent-result.json'))); } catch { return null; } })();
  const end = new Date().toISOString();
  const latest = discover?.filter(e => e.kind === 'coverage').at(-1);
  const summary = { runId: path.basename(directory), startedAt: new Date(Number(startMillis)).toISOString(), endedAt: end,
    elapsedSeconds: Math.max(0, Math.round((Date.now() - Number(startMillis)) / 1000)), status, exitCode: Number(exitCode),
    gates: Object.fromEntries(events.filter(e => e.kind === 'gate').map(e => [e.name, e.exitCode])),
    outcomes: events.filter(e => e.kind !== 'gate'), agent: result,
    network: fetch === null && discover === null ? null : {
      requests: fetch === null || discover === null ? null : [...fetch, ...discover].filter(e => e.network === true).length,
      cacheHits: fetch === null || discover === null ? null : [...fetch, ...discover].filter(e => e.reused === true).length,
      failures: fetch === null || discover === null ? null : [...fetch, ...discover].filter(e => e.outcome === 'failed').length,
      retries: fetch === null || discover === null ? null : [...fetch, ...discover].filter(e => e.kind === 'retry').length,
      sourceCoverage: latest ? { status: latest.status, sources: latest.sources } : null
    }, usage: null }; // -p has no verified token stream; no inferred prices or token counts.
  const root = path.resolve(directory, '../..');
  atomic(path.join(directory, 'summary.json'), summary);
  atomic(path.join(root, 'lastAttempt.json'), {runId: summary.runId, status, summary: path.relative(root, path.join(directory, 'summary.json'))});
  if (status === 'published') atomic(path.join(root, 'lastSuccess.json'), {runId: summary.runId, endedAt: end, summary: path.relative(root, path.join(directory, 'summary.json'))});
} catch (error) { console.error(`daily metrics: FAILED (${error.message})`); process.exit(1); }
