#!/usr/bin/env node
// Pure discovery report builder. Network/cache ownership stays in discover.sh/fetch.sh.
'use strict';

const fs = require('node:fs');

function fail(message) {
  throw new Error(message);
}

function args(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = rest[i + 1];
    if (!key?.startsWith('--') || value === undefined) fail(`usage: discovery-report.js <new|search|tsv> --option value`);
    values[key.slice(2)] = value;
  }
  return { command, values };
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function dateOf(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === match[1] ? match[1] : null;
}

function httpUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false;
  try { return Boolean(new URL(value).hostname); } catch { return false; }
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return String(value || '');
  }
}

function short(value) {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

function reportStatus(sources, usableNames) {
  const needed = Object.values(sources);
  const usable = usableNames.some(name => sources[name]?.availability === 'available');
  if (!usable) return 'failed';
  return needed.every(source => source.status === 'complete') ? 'complete' : 'partial';
}

function gapRows(sources) {
  return Object.entries(sources)
    .filter(([, source]) => source.status !== 'complete')
    .map(([source, value]) => ({ source, reason: value.reason || value.status }));
}

function verifyRecord(verify, name) {
  const rows = Array.isArray(verify?.sources) ? verify.sources : [];
  return rows.find(row => row?.name === name) || null;
}

function namedSource(verify, name) {
  const record = verifyRecord(verify, name);
  if (!record?.valid) {
    return { availability: 'unavailable', status: 'failed', reason: record?.reason || 'cache missing or failed minimum validation' };
  }
  if (!record.fresh) {
    return { availability: 'unavailable', status: 'failed', reason: record.reason || 'cache is stale' };
  }
  if (record.refreshFailed) {
    return { availability: 'available', status: 'partial', reason: 'refresh failed; retained validated last-good cache', path: record.path, ageSeconds: record.ageSeconds };
  }
  return { availability: 'available', status: 'complete', reason: null, path: record.path, ageSeconds: record.ageSeconds };
}

function calendarInfo(file) {
  try {
    const events = readJson(file);
    if (!Array.isArray(events) || !events.every(event => event && typeof event === 'object' && typeof event.id === 'string' && event.id)) {
      return { source: { availability: 'unavailable', status: 'failed', reason: 'calendar top-level or event identity is invalid' }, ids: new Set(), urls: new Set() };
    }
    const urls = new Set();
    for (const event of events) {
      for (const value of [event.link, ...(Array.isArray(event.links) ? event.links.map(link => link?.url) : [])]) {
        if (httpUrl(value)) urls.add(normalizeUrl(value));
      }
    }
    return { source: { availability: 'available', status: 'complete', reason: null }, ids: new Set(events.map(event => event.id)), urls };
  } catch (error) {
    return { source: { availability: 'unavailable', status: 'failed', reason: `calendar JSON read failed: ${error.message}` }, ids: new Set(), urls: new Set() };
  }
}

function articleLinks(text, host) {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const allowedPath = host === 'pokemongo.com' ? '(?:(?:[a-z]{2}/)?(?:news|post))' : 'post';
  const linkSource = `https?:\\/\\/(?:www\\.)?${escaped}\\/${allowedPath}\\/[^\\s)\\]}>"']+`;
  const linkPattern = new RegExp(linkSource, 'gi');
  const oneLink = new RegExp(`^${linkSource}$`, 'i');
  const markdown = /\[([^\]\r\n]+)\]\(([^)\s]+)\)/g;
  const found = new Map();
  let match;
  const add = (url, title = '-') => {
    let clean = url.replace(/[.,;:!?]+$/, '');
    if (clean.startsWith('//')) clean = `https:${clean}`;
    else if (clean.startsWith('/')) clean = `https://${host}${clean}`;
    if (!oneLink.test(clean)) return;
    const key = normalizeUrl(clean);
    if (!found.has(key)) found.set(key, { title: short(title) || '-', url: clean });
  };
  while ((match = markdown.exec(text))) add(match[2], match[1]);
  linkPattern.lastIndex = 0;
  while ((match = linkPattern.exec(text))) add(match[0]);
  return [...found.values()];
}

function dateReason(entry) {
  const start = dateOf(entry.start);
  const end = dateOf(entry.end);
  if (start && end && end < start) return 'date pending verification: end is before start';
  const missing = [];
  if (!start) missing.push('start');
  if (!end) missing.push('end');
  return `date pending verification: ${missing.join(', ')} is missing or invalid`;
}

function distinctiveTokens(value) {
  const stop = new Set(['raid', 'raids', 'battle', 'battles', 'hour', 'hours', 'event', 'events', 'pokemon', 'community', 'week', 'weekend', 'league', 'research', 'spotlight', 'special', 'super', 'mega', 'shadow', 'primal', 'with', 'into', 'from', 'this', 'that', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);
  return [...new Set(String(value).toLowerCase().match(/[a-z0-9]+/g) || [])].filter(token => token.length >= 4 && !stop.has(token) && !/^\d+$/.test(token));
}

function sourceMentions(text, title) {
  const tokens = distinctiveTokens(title);
  return tokens.length > 0 && tokens.every(token => text.toLowerCase().includes(token));
}

function buildNewReport({ verify, feedFile, hubFile, officialFile, calendarFile, today, upper, generatedAt }) {
  const calendar = calendarInfo(calendarFile);
  const sources = {
    calendar: calendar.source,
    leekduck: namedSource(verify, 'events'),
    hub: namedSource(verify, 'events-hub'),
    official: namedSource(verify, 'events-official')
  };
  const candidates = [];
  const pendingDate = [];
  const exceptions = [];
  let hubText = '';
  let officialText = '';

  if (sources.hub.availability === 'available') {
    try { hubText = readText(hubFile); } catch (error) { sources.hub = { availability: 'unavailable', status: 'failed', reason: `Hub index read failed: ${error.message}` }; }
  }
  if (sources.official.availability === 'available') {
    try { officialText = readText(officialFile); } catch (error) { sources.official = { availability: 'unavailable', status: 'failed', reason: `official news index read failed: ${error.message}` }; }
  }

  if (sources.leekduck.availability === 'available') {
    let feed;
    try { feed = readJson(feedFile); } catch (error) { sources.leekduck = { availability: 'unavailable', status: 'failed', reason: `events feed JSON read failed: ${error.message}` }; }
    if (sources.leekduck.availability === 'available') {
      if (!Array.isArray(feed)) {
        sources.leekduck = { availability: 'unavailable', status: 'failed', reason: 'events feed top-level must be an array' };
      } else {
        for (let index = 0; index < feed.length; index += 1) {
          const entry = feed[index];
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            exceptions.push({ source: 'leekduck', index, reason: 'event entry is not an object' });
            continue;
          }
          const missing = [];
          if (typeof entry.eventID !== 'string' || !entry.eventID.trim()) missing.push('eventID');
          if (typeof entry.name !== 'string' || !entry.name.trim()) missing.push('name');
          if (!httpUrl(entry.link)) missing.push('link');
          if (missing.length) {
            exceptions.push({ source: 'leekduck', index, reason: `missing required identity/source field(s): ${missing.join(', ')}`, eventID: short(entry.eventID), title: short(entry.name), url: short(entry.link) });
            continue;
          }
          const start = dateOf(entry.start);
          const end = dateOf(entry.end);
          if (!start || !end || end < start) {
            pendingDate.push({ kind: 'date-pending', source: 'leekduck', id: entry.eventID, title: entry.name, url: entry.link, reason: dateReason(entry) });
            continue;
          }
          if (end < today || start >= upper || calendar.ids.has(entry.eventID)) continue;
          const corroboration = ['LeekDuck'];
          // This is only a corroboration hint. URL identity remains the sole
          // suppression rule for independent Hub/official leads below.
          if (hubText && sourceMentions(hubText, entry.name)) corroboration.push('Hub');
          if (officialText && sourceMentions(officialText, entry.name)) corroboration.push('官方');
          candidates.push({ kind: 'new', source: 'leekduck', id: entry.eventID, title: entry.name, url: entry.link, start, end, corroboration });
        }
        if (pendingDate.length || exceptions.length) {
          sources.leekduck.status = 'partial';
          sources.leekduck.reason = `${pendingDate.length} date-pending lead(s), ${exceptions.length} malformed entry/entries`;
        }
      }
    }
  }

  const appendIndependent = (name, host, text) => {
    if (sources[name].availability !== 'available') return;
    const articles = articleLinks(text, host);
    if (!articles.length) {
      sources[name].status = 'partial';
      sources[name].reason = name === 'official' ? 'news index had no verified news/article entries' : 'index had no verified article entries';
      return;
    }
    for (const article of articles) {
      // Do not use a fuzzy title/calendar-text comparison here: a same-named
      // later period must remain a lead until its identity and dates are checked.
      if (calendar.urls.has(normalizeUrl(article.url))) continue;
      candidates.push({ kind: `${name}-lead`, source: name, title: article.title, url: article.url,
        reason: 'unmatched source URL; verify event identity, period and dates' });
    }
  };
  appendIndependent('hub', 'pokemongohub.net', hubText);
  appendIndependent('official', 'pokemongo.com', officialText);

  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${normalizeUrl(candidate.url)}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(candidate); }
  }
  const status = reportStatus(sources, ['leekduck', 'hub', 'official']);
  return {
    version: 1,
    mode: 'new',
    generatedAt,
    status,
    complete: status === 'complete',
    completeNoNew: status === 'complete' && !deduped.length && !pendingDate.length && !exceptions.length,
    sources,
    candidates: deduped,
    pendingDate,
    exceptions,
    gaps: gapRows(sources)
  };
}

function sourceInput(input, name) {
  const value = input?.sources?.[name];
  if (!value?.available || !value.path) {
    return { availability: 'unavailable', status: 'failed', reason: value?.reason || 'source unavailable' };
  }
  return { availability: 'available', status: 'complete', reason: null, path: value.path };
}

function queryTokens(query) {
  return String(query).toLowerCase().split(/\s+/).filter(Boolean);
}

function buildSearchReport(input) {
  const query = String(input.query || '');
  const tokens = queryTokens(query);
  const sources = {
    leekduck: sourceInput(input, 'leekduck'),
    hub: sourceInput(input, 'hub'),
    official: sourceInput(input, 'official'),
    fandom: sourceInput(input, 'fandom')
  };
  const candidates = [];
  const add = (source, title, url) => {
    if (httpUrl(url)) candidates.push({ source, title: short(title) || '-', url });
  };
  const parse = (name, fn) => {
    if (sources[name].availability !== 'available') return;
    try {
      const countBefore = candidates.length;
      fn();
      sources[name].resultCount = candidates.length - countBefore;
    } catch (error) {
      sources[name] = { availability: 'unavailable', status: 'failed', reason: `parse failed: ${error.message}` };
    }
  };

  parse('leekduck', () => {
    const events = readJson(sources.leekduck.path);
    if (!Array.isArray(events)) fail('events feed top-level must be an array');
    const need = Math.floor((tokens.length + 1) / 2);
    let malformed = 0;
    for (const entry of events) {
      if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !entry.name || !httpUrl(entry.link)) {
        malformed += 1;
        continue;
      }
      const name = entry.name.toLowerCase();
      const hits = tokens.filter(token => name.includes(token)).length;
      if (hits && hits >= need) add('leekduck', entry.name, entry.link);
    }
    if (malformed) {
      sources.leekduck.status = 'partial';
      sources.leekduck.reason = `${malformed} malformed event-search row(s)`;
    }
  });
  parse('hub', () => {
    for (const article of articleLinks(readText(sources.hub.path), 'pokemongohub.net')) add('hub', article.title, article.url);
  });
  parse('official', () => {
    const articles = articleLinks(readText(sources.official.path), 'pokemongo.com');
    if (!articles.length) {
      sources.official.status = 'partial';
      sources.official.reason = 'news index had no verified news/article entries';
    }
    for (const article of articles) {
      const haystack = `${article.title} ${article.url}`.toLowerCase();
      if (tokens.every(token => haystack.includes(token))) add('official', article.title, article.url);
    }
  });
  parse('fandom', () => {
    const response = readJson(sources.fandom.path);
    if (!Array.isArray(response?.query?.search)) fail('MediaWiki search result is not an array');
    for (const row of response.query.search) {
      if (typeof row?.title !== 'string' || !row.title) continue;
      add('fandom', row.title, `https://pokemongo.fandom.com/wiki/${encodeURIComponent(row.title.replace(/ /g, '_'))}`);
    }
  });

  const seen = new Set();
  const deduped = candidates.filter(candidate => {
    const key = normalizeUrl(candidate.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const status = reportStatus(sources, ['leekduck', 'hub', 'official', 'fandom']);
  return {
    version: 1,
    mode: 'search',
    query,
    status,
    complete: status === 'complete',
    completeNoCandidates: status === 'complete' && !deduped.length,
    sources,
    candidates: deduped,
    gaps: gapRows(sources)
  };
}

function tsv(report) {
  const rows = [];
  if (report.mode === 'new') {
    for (const candidate of report.candidates) {
      if (candidate.kind === 'new') {
        rows.push(['NEW', candidate.title, candidate.url, `${candidate.start}→${candidate.end}`, `佐证:${candidate.corroboration.join('+')}`]);
      } else {
        rows.push([candidate.kind === 'hub-lead' ? 'HUB-LEAD' : 'OFFICIAL-LEAD', candidate.title, candidate.url, candidate.reason]);
      }
    }
    for (const lead of report.pendingDate) rows.push(['DATE-PENDING', lead.title, lead.url, lead.reason]);
    for (const exception of report.exceptions) rows.push(['EXCEPTION', exception.source, exception.eventID || '-', exception.reason]);
  } else {
    for (const candidate of report.candidates) rows.push([candidate.source === 'hub' ? 'gohub' : candidate.source, candidate.title, candidate.url]);
  }
  return rows.map(row => row.map(short).join('\t')).join(rows.length ? '\n' : '');
}

function main() {
  const { command, values } = args(process.argv.slice(2));
  if (command === 'tsv') {
    const report = readJson(values.input || fail('tsv requires --input FILE'));
    const output = tsv(report);
    if (output) process.stdout.write(`${output}\n`);
    return;
  }
  if (command === 'new') {
    const required = ['verify', 'feed', 'hub', 'official', 'calendar', 'today', 'upper', 'generated-at'];
    for (const key of required) if (!values[key]) fail(`new requires --${key}`);
    const report = buildNewReport({ verify: readJson(values.verify), feedFile: values.feed, hubFile: values.hub,
      officialFile: values.official, calendarFile: values.calendar, today: values.today, upper: values.upper,
      generatedAt: values['generated-at'] });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  if (command === 'search') {
    const input = readJson(values.input || fail('search requires --input FILE'));
    process.stdout.write(`${JSON.stringify(buildSearchReport(input), null, 2)}\n`);
    return;
  }
  fail('usage: discovery-report.js <new|search|tsv> ...');
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(`discovery-report: ${error.message}`); process.exitCode = 2; }
}

module.exports = { buildNewReport, buildSearchReport, tsv, dateOf, normalizeUrl };
