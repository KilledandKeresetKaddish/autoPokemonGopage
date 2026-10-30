#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {
  REMINDER_PREFIX, NOTIFY_PREFIX, NOTIFY_SETTINGS_KEY, NOTIFY_FIRED_PREFIX,
  reminderTimeSnapshot, deriveEventReminder, resolveEventTiming,
  dueReminderNotifications, createReminderNotifier, createEventReminderStore,
} = require('../public/app.js');
const { TestLocks, MemoryStorage } = require('./test-reminder-concurrency.js');
const fixtures = require('./fixtures/event-timing.json');
const ui = require('../public/data/i18n/ui.json');
const event = { ...fixtures.valid[0], name:'测试活动' };
const open = Date.parse(event.openAt), close = Date.parse(event.closeAt);
const local = Date.parse('2026-10-11T18:00:00Z'), zone = 'America/Toronto';
const config = { v:1, enabled:true, moments:'both' };
const firedKey = id => NOTIFY_FIRED_PREFIX + encodeURIComponent(id);
function timers() {
  let serial = 0;
  const pending = new Map();
  return { pending, setTimeout(fn, delay) { pending.set(++serial, { fn, delay }); return serial; },
    clearTimeout(id) { pending.delete(id); },
    fire() { const [id, job] = pending.entries().next().value; pending.delete(id); return job.fn(); },
    delay:() => [...pending.values()][0]?.delay };
}
class NotifyLocks extends TestLocks {
  constructor() { super(); this.names = []; this.active = null; }
  request(name, options, callback) {
    this.names.push(name);
    return super.request(name, options, () => {
      this.active = name;
      try { return callback(); } finally { this.active = null; }
    });
  }
}
function pure(at, { source = event, settings = config, sent = new Map(), starredAt = open - 1000,
  completedAt = null, viewerTimeZone = zone, baseline = false, token = 'pure' } = {}) {
  const record = { id:source.id, token, starredAt, completedAt, names:{ en:'Test event', 'zh-CN':source.name }, time:reminderTimeSnapshot(source) };
  return dueReminderNotifications({ entries:[[source.id, record]], fired:sent, settings, now:at, viewerTimeZone, baseline,
    view:(id, tz) => deriveEventReminder(record, null, at, tz) });
}
async function fixture(options = {}) {
  let current = options.starredAt ?? open - 86400000, storeZone = zone, browserZone = zone, locale = 'en', serial = 0;
  const storage = options.storage || new MemoryStorage(), writerLocks = new TestLocks();
  const locks = Object.hasOwn(options, 'locks') ? options.locks : new NotifyLocks();
  const events = options.events || [event];
  const store = createEventReminderStore({ storage, locks:writerLocks, now:() => current,
    viewerTimeZone:() => storeZone, token:() => 'notify-' + ++serial });
  await store.setEvents(events, Object.fromEntries(events.map((e, i) => [e.id, { name:i ? 'Event ' + i : 'Test event' }])));
  for (const e of events) assert((await store.star(e.id)).ok);
  current = options.at ?? open;
  if (options.settings !== null) storage.setItem(NOTIFY_SETTINGS_KEY, JSON.stringify(options.settings || config));
  const constructed = [], clicks = [];
  let throwing = false, reads = 0, syncs = 0;
  class NotificationMock {
    static permission = options.permission || 'granted';
    constructor(title, opts) {
      if (throwing) throw Error('notification rejected');
      if (locks?.active !== undefined && !locks.fail) assert.equal(locks.active, NOTIFY_PREFIX, 'constructor must be in the NOTIFY lock');
      this.title = title; this.options = opts; this.closed = false; constructed.push(this);
    }
    close() { this.closed = true; }
  }
  const translate = (key, vars) => ui[locale][key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
  function build(storeForTab = store) {
    return createReminderNotifier({ store:{
      sync:() => { syncs++; return storeForTab.sync(); }, entries:storeForTab.entries,
      view:id => { reads++; assert.equal(storeZone, browserZone, 'zone updated before view'); return storeForTab.view(id); },
      refresh:() => assert.fail('notifier must never call refresh'),
    }, storage, locks, now:() => current, ...clock,
    Notification:options.unsupported ? null : NotificationMock, isSecure:() => options.secure !== false,
    isHidden:() => true, render:() => assert.fail('no background rendering'),
    getViewerTimeZone:() => browserZone, onViewerTimeZone:z => { storeZone = z; }, getLocale:() => locale,
    getCanonicalName:id => events.find(e => e.id === id)?.name,
    translate, formatInstant:date => date.toISOString(), formatRemaining:ms => ms / 3600000 + 'h',
    onClick:id => clicks.push(id),
    });
  }
  const clock = timers(), notifier = build();
  return { store, storage, locks, clock, notifier, constructed, clicks, NotificationMock, build,
    now:value => { current = value; }, travel:value => { browserZone = value; }, language:value => { locale = value; },
    throwConstructor:value => { throwing = value; },
    counts:() => ({ reads, syncs }), sent:(id = event.id) => JSON.parse(storage.getItem(firedKey(id))),
    reminderBytes:() => JSON.stringify([...storage.data].filter(([key]) => key.startsWith(REMINDER_PREFIX))),
  };
}
async function run() {
  await followupTests();
  assert.equal(resolveEventTiming(event, open, zone).viewerWindow.start.instant.getTime(), local);
  const sentOpen = new Map([[event.id, { v:1, token:'pure', open, local:null }]]);
  for (const moments of ['both','open','local']) {
    const settings = { ...config, moments };
    assert.equal(pure(open - 1, { settings }).notify.length, 0);
    assert.deepEqual(pure(open, { settings }).notify.map(n => n.moment), moments === 'local' ? [] : ['open']);
    assert.equal(pure(open + 1, { settings, sent:sentOpen }).notify.length, 0);
    assert.equal(pure(local - 1, { settings, sent:sentOpen }).notify.length, 0);
    assert.deepEqual(pure(local, { settings, sent:sentOpen }).notify.map(n => n.moment), moments === 'open' ? [] : ['local']);
    const sentBoth = new Map([[event.id, { v:1, token:'pure', open, local }]]);
    assert.equal(pure(local + 1, { settings, sent:sentBoth }).notify.length, 0);
    // Regional/absolute and equal-instant global starts are always one actual start.
    for (const source of [fixtures.valid[2], fixtures.valid[3]]) {
      const at = Date.parse(source.openAt);
      assert.deepEqual(pure(at, { source, settings, starredAt:at - 1 }).notify.map(n => n.moment), ['open']);
    }
    assert.deepEqual(pure(open, { settings, viewerTimeZone:'Pacific/Kiritimati' }).notify.map(n => n.moment), ['open']);
  }
  for (const source of fixtures.valid.filter(f => !f.openAt)) {
    assert.deepEqual(pure(Date.parse(source.now), { source }).notify, [], source.id);
  }
  assert.equal(pure(open, { source:{ ...event, timing:null } }).notify.length, 0);
  assert.equal(pure(open, { settings:{ ...config, enabled:false } }).ledger.length, 0);
  assert.equal(pure(close).notify.length, 0);
  assert.equal(pure(open + 2 * 3600000).notify[0].catchUp, true);
  assert.equal(pure(open + 2 * 3600000).notify[0].ago, 2 * 3600000);
  assert.equal(pure(open, { starredAt:open }).ledger[0].silent, true);
  assert.equal(pure(open, { completedAt:open }).ledger.length, 0);
  assert.equal(pure(local + 1, { baseline:true, settings:{ ...config, moments:'open' } }).ledger.length, 2, 'baseline covers deselected past moments too');
  const immutable = Object.freeze({ v:1, token:'pure', open:null, local:null });
  const map = new Map([[event.id, immutable]]); pure(open, { sent:map }); assert.equal(map.get(event.id), immutable);

  // Production store, read-only notifier, hidden tab; independent timers and lock namespace.
  const h = await fixture({ at:open - 1 });
  const bytes = h.reminderBytes();
  await h.notifier.wake(); assert.equal(h.constructed.length, 0); assert.equal(h.clock.delay(), 1000);
  h.now(open); await h.clock.fire(); assert.equal(h.constructed.length, 1);
  assert.deepEqual(h.sent(), { v:1, token:h.store.get(event.id).token, open, local:null });
  const n = h.constructed[0];
  assert.match(n.title, /Test event has started worldwide/); assert.match(n.options.body, /Started in Kiritimati/);
  assert.match(n.options.body, /2026-10-11T18:00:00.000Z/);
  assert.deepEqual(n.options, { body:n.options.body, requireInteraction:true,
    tag:'pogo-event-notify:' + event.id + ':open', icon:'pokemongocalender.ico' });
  assert(!Object.hasOwn(n.options, 'silent'));
  assert.equal(h.clock.pending.size, 1); assert.equal(h.clock.delay(), 60000);
  h.now(local); await h.notifier.wake(); assert.equal(h.constructed.length, 2); assert.equal(h.sent().local, local);
  assert.match(h.constructed[1].title, /started where you are/); assert.match(h.constructed[1].options.body, /^Ends /);
  h.constructed[1].onclick(); assert.deepEqual(h.clicks, [event.id]); assert(h.constructed[1].closed);
  await h.notifier.wake(); assert.equal(h.constructed.length, 2);
  assert.equal(h.reminderBytes(), bytes, 'notifier never changes personal records');
  assert(h.locks.names.every(name => name === NOTIFY_PREFIX));
  assert(h.counts().syncs > 0 && h.counts().reads === h.counts().syncs);

  const catchup = await fixture({ at:open + 7200000 });
  await catchup.notifier.wake(); assert.equal(catchup.constructed.length, 1);
  assert.match(catchup.constructed[0].options.body, /^Started 2h ago · still ongoing/);
  const ended = await fixture({ at:close });
  await ended.notifier.wake(); assert.equal(ended.constructed.length, 0); assert.equal(ended.sent(), null);
  const late = await fixture({ at:open + 7200000, starredAt:open });
  await late.notifier.wake(); assert.equal(late.constructed.length, 0); assert.equal(late.sent().open, open);
  late.now(local); await late.notifier.wake(); assert.equal(late.constructed.length, 1, 'future local start still notifies');
  const done = await fixture(); await done.store.complete(event.id, true, done.store.get(event.id).token);
  await done.notifier.wake(); assert.equal(done.constructed.length, 0); assert.equal(done.sent(), null);
  // Removal and new incarnation cleanup; only the new incarnation's future local moment alerts.
  const incarnation = await fixture(); await incarnation.notifier.wake();
  const oldToken = incarnation.store.get(event.id).token;
  await incarnation.store.remove(event.id, oldToken); await incarnation.notifier.wake(); assert.equal(incarnation.sent(), null);
  incarnation.now(open + 7200000); await incarnation.store.star(event.id);
  assert.notEqual(incarnation.store.get(event.id).token, oldToken);
  incarnation.storage.setItem(firedKey(event.id), JSON.stringify({ v:1, token:oldToken, open, local }));
  await incarnation.notifier.wake(); assert.equal(incarnation.constructed.length, 1);
  assert.equal(incarnation.sent().token, incarnation.store.get(event.id).token); assert.equal(incarnation.sent().local, null);
  incarnation.now(local); await incarnation.notifier.wake(); assert.equal(incarnation.constructed.length, 2);
  const mismatch = await fixture({ at:open - 1 });
  mismatch.storage.setItem(firedKey(event.id), JSON.stringify({ v:1, token:'old', open, local }));
  await mismatch.notifier.wake(); assert.equal(mismatch.sent(), null, 'token mismatch is deleted even before a future start');
  const corrupt = await fixture(); corrupt.storage.setItem(firedKey(event.id), '{bad json');
  corrupt.storage.setItem('pogo-todo', 'untouched'); await corrupt.notifier.wake();
  assert.equal(corrupt.constructed.length, 1); assert.equal(corrupt.sent().open, open);
  assert.equal(corrupt.storage.getItem('pogo-todo'), 'untouched');

  const correction = await fixture(); await correction.notifier.wake();
  const postponed = { ...event, start:'2026-10-11T15:00:00' };
  await correction.store.setEvents([postponed]); await correction.notifier.wake(); assert.equal(correction.constructed.length, 1);
  correction.now(open + 3600000); await correction.notifier.wake(); assert.equal(correction.constructed.length, 2);
  assert.equal(correction.sent().open, open + 3600000);
  await correction.store.setEvents([{ ...event, start:'2026-10-11T14:30:00' }]);
  await correction.notifier.wake(); assert.equal(correction.constructed.length, 3); assert.equal(correction.sent().open, open + 1800000);
  assert.match(correction.constructed[2].options.body, /^Started 0.5h ago/);
  assert.equal(correction.constructed[0].options.tag, correction.constructed[2].options.tag);

  const travel = await fixture(); await travel.notifier.wake();
  travel.travel('Europe/London'); travel.now(Date.parse('2026-10-11T13:00:00Z'));
  await travel.notifier.wake(); assert.equal(travel.constructed.length, 2); assert.equal(travel.sent().local, Date.parse('2026-10-11T13:00:00Z'));
  travel.travel(zone); travel.now(local); await travel.notifier.wake(); assert.equal(travel.constructed.length, 3);

  // Two tabs queued concurrently: read ledger only AFTER acquiring the notify lock.
  const tabs = await fixture(); let tabNow = open;
  const tabStore = createEventReminderStore({ storage:tabs.storage, locks:new TestLocks(), now:() => tabNow, viewerTimeZone:() => zone });
  await tabStore.ready;
  const other = tabs.build(tabStore);
  const pa = tabs.notifier.wake(), pb = other.wake(); await Promise.all([pa, pb]);
  assert.equal(tabs.constructed.length, 1);
  tabs.now(local); tabNow = local; await Promise.all([tabs.notifier.wake(), other.wake()]); assert.equal(tabs.constructed.length, 2);
  other.pause();
  const waiting = await fixture(); let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const blocker = waiting.locks.request(NOTIFY_PREFIX, { signal:new AbortController().signal }, async () => {
    enter(); await new Promise(resolve => { release = resolve; });
  });
  await entered;
  const inFlight = waiting.notifier.wake(); assert.equal(waiting.notifier.wake(), inFlight);
  // Notification lock must not block personal note writes, even while queued.
  assert((await waiting.store.note(event.id, 'independent writer', waiting.store.get(event.id).token)).persisted);
  release(); await blocker; await inFlight; assert.equal(waiting.constructed.length, 1);
  assert.equal(waiting.clock.pending.size, 1);
  const failingLocks = new TestLocks(); failingLocks.fail = true;
  for (const locks of [null, failingLocks]) {
    const fallback = await fixture({ locks }); await fallback.notifier.wake();
    assert.equal(fallback.constructed.length, 1); assert.equal(fallback.sent().open, open);
    await fallback.notifier.wake(); assert.equal(fallback.constructed.length, 1); fallback.notifier.pause();
  }

  for (const options of [{ permission:'default' }, { permission:'denied' }, { unsupported:true }, { secure:false },
    { settings:{ ...config, enabled:false } }, { settings:null }]) {
    const unavailable = await fixture(options), before = JSON.stringify([...unavailable.storage.data]);
    await unavailable.notifier.wake(); assert.equal(unavailable.constructed.length, 0); assert.equal(unavailable.sent(), null);
    assert.equal(JSON.stringify([...unavailable.storage.data]), before, 'disabled/unsupported/permission gate writes nothing');
    assert.equal(unavailable.locks.calls, 0, 'disabled check takes no Web Lock');
    if (options.permission !== undefined || options.unsupported || options.secure === false) {
      await unavailable.notifier.configure({ enabled:true }); assert.equal(unavailable.sent(), null);
    }
    unavailable.notifier.pause();
  }
  const futureEnable = await fixture({ at:open - 1, settings:null });
  await futureEnable.notifier.configure({ enabled:true }); assert.equal(futureEnable.sent(), null);
  futureEnable.now(open); await futureEnable.notifier.wake(); assert.equal(futureEnable.constructed.length, 1);
  const enable = await fixture({ at:open + 7200000, settings:null, permission:'default' });
  assert.deepEqual(enable.notifier.settings(), { v:1, enabled:false, moments:'both' });
  await enable.notifier.wake(); enable.NotificationMock.permission = 'granted';
  await enable.notifier.configure({ enabled:true }); assert.equal(enable.constructed.length, 0); assert.equal(enable.sent().open, open);
  assert.equal(enable.sent().local, null);
  enable.now(local); await enable.notifier.wake(); assert.equal(enable.constructed.length, 1);
  await enable.notifier.configure({ enabled:false }); enable.storage.removeItem(firedKey(event.id));
  await enable.notifier.configure({ enabled:true }); assert.equal(enable.constructed.length, 1);
  assert.equal(enable.sent().open, open); assert.equal(enable.sent().local, local);
  // A background peer that first observes permission later must catch starts
  // AFTER the enabling tab's baseline, not establish a second baseline of its own.
  const peer = await fixture({ at:open + 7200000, settings:null, permission:'default' });
  const peerNotifier = peer.build(); await Promise.all([peer.notifier.wake(), peerNotifier.wake()]);
  peer.NotificationMock.permission = 'granted'; await peer.notifier.configure({ enabled:true });
  peer.notifier.pause(); peer.now(local); await peerNotifier.wake();
  assert.equal(peer.constructed.length, 1, 'late permission observation must not swallow a new local start');
  peerNotifier.pause();
  const enableAll = await fixture({ at:local + 1, settings:{ ...config, enabled:false, moments:'open' } });
  await enableAll.notifier.configure({ enabled:true }); assert.equal(enableAll.constructed.length, 0);
  assert.equal(enableAll.sent().local, local, 'baseline is independent of selector');
  await enableAll.notifier.configure({ moments:'both' }); assert.equal(enableAll.constructed.length, 0);

  const batch = await fixture({ events:Array.from({ length:5 }, (_, i) => ({ ...event, id:'batch/' + i, name:'活动 ' + i })) });
  await batch.notifier.wake(); assert.equal(batch.constructed.length, 1);
  assert.match(batch.constructed[0].title, /5 starred events/); assert.match(batch.constructed[0].options.body, /Test event\nEvent 1\nEvent 2\n\+2/);
  assert.equal(batch.constructed[0].options.tag, 'pogo-event-notify:summary');
  assert(batch.constructed[0].options.requireInteraction); batch.constructed[0].onclick(); assert.deepEqual(batch.clicks, [null]);
  assert(batch.constructed[0].closed);
  for (let i = 0; i < 5; i++) assert.equal(batch.sent('batch/' + i).open, open);
  await batch.notifier.wake(); assert.equal(batch.constructed.length, 1);
  const pair = await fixture({ events:[event, { ...event, id:'second' }] });
  await pair.notifier.wake(); assert.equal(pair.constructed.length, 2, 'below batch threshold');
  const unknown = await fixture({ events:[{ ...fixtures.valid[10], name:'Date only' }] });
  await unknown.notifier.wake(); assert.equal(unknown.constructed.length, 0);
  assert.equal(unknown.sent(fixtures.valid[10].id), null);

  const failure = await fixture(); failure.throwConstructor(true); await failure.notifier.wake(); assert.equal(failure.sent(), null);
  failure.throwConstructor(false); await failure.notifier.wake(); assert.equal(failure.constructed.length, 1);
  // Exact start without a known end still alerts; no invented end in the body.
  const noEndSource = { ...fixtures.valid[5], name:'No end' }, noEndOpen = Date.parse(noEndSource.openAt);
  const noEnd = await fixture({ events:[noEndSource], starredAt:noEndOpen - 1, at:noEndOpen });
  await noEnd.notifier.wake(); assert.equal(noEnd.constructed.length, 1); assert.equal(noEnd.constructed[0].options.body, '');
  const chinese = await fixture(); chinese.language('zh-CN'); await chinese.notifier.wake();
  assert.match(chinese.constructed[0].title, /测试活动 已在全球开始/);
  assert.match(chinese.constructed[0].options.body, /基里蒂马蒂/);

  // Pagehide cancels the separate timer/queued work; resume catches up. Hidden is NOT pause.
  const resume = await fixture({ at:open - 7200000 }); await resume.notifier.wake(); assert.equal(resume.clock.delay(), 60000);
  resume.notifier.pause(); assert.equal(resume.clock.pending.size, 0);
  resume.now(open + 7200000); await resume.notifier.wake(); assert.equal(resume.constructed.length, 1);
  const deferred = await fixture(); let unblock, deferredEnter;
  const deferredInside = new Promise(resolve => { deferredEnter = resolve; });
  const held = deferred.locks.request(NOTIFY_PREFIX, { signal:new AbortController().signal }, async () => {
    deferredEnter(); await new Promise(resolve => { unblock = resolve; });
  });
  await deferredInside; const pending = deferred.notifier.wake(); await Promise.resolve(); deferred.notifier.pause();
  unblock(); await held; await pending; assert.equal(deferred.constructed.length, 0); assert.equal(deferred.clock.pending.size, 0);

  await integration();
  for (const f of [h, catchup, ended, late, done, incarnation, mismatch, corrupt, correction, travel, tabs,
    waiting, futureEnable, enable, peer, enableAll, batch, pair, unknown, failure, noEnd, chinese, resume, deferred]) f.notifier.pause();
  console.log('test-reminder-notify: PASS (±1ms global/local/regional/absolute, preferences, hidden read-only timer, catch-up grace/expiry, transient error recovery, preference baselines, stars/completion/tokens, timing/travel corrections, multi-tab lock/tag dedupe, permission/enable baseline, batching, locale/options/clicks, production settings/lifecycle wiring)');
}
async function followupTests() {
  // Timer throttling within five minutes is still an on-time notification.
  for (const [delay, catchUp] of [[30000, false], [5 * 60000, false], [5 * 60000 + 1, true], [6 * 60000, true]]) {
    assert.equal(pure(open + delay).notify[0].catchUp, catchUp, `catch-up grace at +${delay}ms`);
    const f = await fixture({ at:open + delay });
    await f.notifier.wake(); assert.equal(f.constructed.length, 1);
    assert.equal(/ago · still ongoing/.test(f.constructed[0].options.body), catchUp, 'catch-up prefix follows grace');
    f.notifier.pause();
  }
  const recovery = await fixture(); recovery.throwConstructor(true);
  await recovery.notifier.wake(); assert.equal(recovery.notifier.status().failed, true);
  recovery.throwConstructor(false); await recovery.notifier.wake();
  assert.equal(recovery.notifier.status().failed, false, 'successful check clears prior constructor error');
  recovery.notifier.pause();

  const configureRecovery = await fixture(); configureRecovery.throwConstructor(true);
  await configureRecovery.notifier.wake(); assert.equal(configureRecovery.notifier.status().failed, true);
  configureRecovery.throwConstructor(false);
  const configuring = configureRecovery.notifier.configure({ moments:'open' });
  assert.equal(configureRecovery.notifier.status().failed, false, 'configure clears error before awaiting its lock');
  await configuring; assert.equal(configureRecovery.notifier.status().failed, false); configureRecovery.notifier.pause();

  const storageRecovery = await fixture({ at:open - 1 });
  const getItem = storageRecovery.storage.getItem.bind(storageRecovery.storage); let blocked = true;
  storageRecovery.storage.getItem = key => {
    if (blocked && key === NOTIFY_SETTINGS_KEY) throw Error('transient read failure');
    return getItem(key);
  };
  await storageRecovery.notifier.wake(); assert.equal(storageRecovery.notifier.status().failed, true);
  blocked = false; await storageRecovery.notifier.wake();
  assert.equal(storageRecovery.notifier.status().failed, false, 'successful check clears prior storage error');
  storageRecovery.notifier.pause();

  // Only newly selected, already-due moments are baselined, before publishing settings.
  for (const [from, to, added, at] of [
    ['open','both','local',local + 360000], ['open','local','local',local + 360000],
    ['local','both','open',open + 360000], ['local','open','open',open + 360000],
  ]) {
    const f = await fixture({ at, settings:{ ...config, moments:from } });
    await f.notifier.wake(); const before = f.constructed.length;
    let markedInsideLock = false;
    f.storage.beforeWrite = () => {
      assert.equal(f.locks.active, NOTIFY_PREFIX);
      assert.equal(f.notifier.settings().moments, from, 'baseline precedes the new preference');
      markedInsideLock = true;
    };
    await f.notifier.configure({ moments:to });
    assert(markedInsideLock); assert.equal(f.constructed.length, before, `${from} → ${to} does not catch up old starts`);
    assert.equal(f.sent()[added], added === 'open' ? open : local);
    const peer = f.build(); await peer.wake(); assert.equal(f.constructed.length, before, 'peer sees the same baseline');
    peer.pause(); f.notifier.pause();
  }
  const future = await fixture({ settings:{ ...config, moments:'open' } });
  await future.notifier.wake(); await future.notifier.configure({ moments:'both' });
  assert.equal(future.sent().local, null, 'newly selected future moment is not baselined');
  future.now(local); await future.notifier.wake(); assert.equal(future.constructed.length, 2); future.notifier.pause();

  for (const moments of ['both','open']) {
    const pending = await fixture({ at:local + 360000, settings:{ ...config, moments:'open' } });
    await pending.notifier.configure({ moments });
    assert.equal(pending.constructed.length, 1, 'already-selected pending open still catches up');
    assert.equal(pending.constructed[0].options.tag, 'pogo-event-notify:' + event.id + ':open');
    assert.equal(pending.sent().local, moments === 'both' ? local : null); pending.notifier.pause();
  }
  // A regional/absolute open was already eligible under local-only; do not swallow it.
  for (const source of [fixtures.valid[2], fixtures.valid[3]]) {
    const start = Date.parse(source.openAt);
    const single = await fixture({ events:[source], starredAt:start - 1, at:start + 360000, settings:{ ...config, moments:'local' } });
    await single.notifier.configure({ moments:'both' }); assert.equal(single.constructed.length, 1);
    assert.equal(single.sent(source.id).open, start); single.notifier.pause();
  }
}

// Small DOM host for the production settings handlers, formatters and lifecycle wiring.
// No browser permission is granted by the test runner; the native API is injected.
async function integration() {
  const storage = new MemoryStorage(), locks = new TestLocks(), clock = timers(), constructed = [], actions = [];
  let gesture = false, requests = 0, current = open + 7200000, renders = 0;
  const nodes = new Map(), documentHandlers = new Map(), windowHandlers = new Map();
  class Control {
    constructor() { this.nodes = new Map(); this.handlers = new Map(); this.hidden = false; this.dataset = {}; }
    querySelector(selector) { if (!this.nodes.has(selector)) this.nodes.set(selector, new Control()); return this.nodes.get(selector); }
    addEventListener(name, fn) { this.handlers.set(name, fn); }
    setAttribute(name, value) { this[name] = value; }
    prepend(node) { nodes.set('.reminder-notify', node); }
    focus() { actions.push('sidebar'); }
    click() {
      if (this.disabled) return;
      gesture = true;
      try { return this.handlers.get('click')?.({ currentTarget:this, target:this }); } finally { gesture = false; }
    }
    change() { return this.handlers.get('change')?.({ target:this }); }
  }
  const body = new Control(); body.classList = { toggle(){}, add(){} };
  const document = { hidden:false, body, activeElement:null,
    createElement:() => new Control(), querySelector:selector => nodes.get(selector) || null, querySelectorAll:() => [],
    addEventListener:(name, fn) => documentHandlers.set(name, fn) };
  for (const selector of ['.reminder-panel-body','#reminder-panel','#reminder-panel>summary','#main-tabs button[data-view="calendar"]']) nodes.set(selector, new Control());
  nodes.get('#main-tabs button[data-view="calendar"]').click = () => actions.push('calendar');
  class MockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [current])); }
    static now() { return current; }
  }
  class MockNotification {
    static permission = 'default';
    static fail = false;
    static requestPermission() {
      assert(gesture, 'requestPermission must be called directly in the click handler');
      requests++; this.permission = 'granted'; return Promise.resolve('granted');
    }
    constructor(title, options) {
      if (MockNotification.fail) throw Error('transient notification failure');
      this.title = title; this.options = options; constructed.push(this);
    }
    close() { actions.push('close'); }
  }
  const record = source => ({ v:1, id:source.id, token:'vm-' + source.id, starredAt:open - 1, completedAt:null, note:'',
    names:{ 'zh-CN':source.name, en:'VM event' }, time:reminderTimeSnapshot(source) });
  const uncertain = { ...fixtures.valid[10], name:'待确认' };
  for (const e of [event, uncertain]) storage.setItem(REMINDER_PREFIX + encodeURIComponent(e.id), JSON.stringify(record(e)));
  const window = { focus:() => actions.push('focus'), addEventListener:(name, fn) => windowHandlers.set(name, fn) };
  const context = vm.createContext({ document, window, localStorage:storage, navigator:{ locks }, isSecureContext:true,
    Notification:MockNotification, Date:MockDate, Intl, AbortController, console, setTimeout:clock.setTimeout,
    clearTimeout:clock.clearTimeout, ui, events:[event, uncertain], checkRender:() => { assert(!document.hidden); renders++; }, actions });
  const run = code => vm.runInContext(code, context);
  run(fs.readFileSync(require.resolve('../public/app.js'), 'utf8'));
  run(`state.ui=ui; state.locale='en'; state.events=events; state.en={events:{[events[0].id]:{name:'VM event'}}};
    detectBrowserTimeZone=()=>({timeZone:'America/Toronto'}); setupReminderPanel=()=>{};
    refreshReminderUi=async()=>{checkRender();await reminders.refresh();renderReminderNotificationSettings();};
    openDetail=event=>actions.push('detail:'+event.id);`);
  await run('setupReminders()'); await run('reminderScheduler.wake()'); await run('reminderNotifier.wake()');
  let box = nodes.get('.reminder-notify'); assert(box);
  assert.equal(requests, 0, 'initialization never requests permission');
  assert.equal(box.querySelector('.notify-enable').hidden, false);
  assert.equal(box.querySelector('.notify-hint').hidden, false); assert.match(box.querySelector('.notify-hint').textContent, /^1 starred events/);
  await box.querySelector('.notify-enable').click(); assert.equal(requests, 1); assert.equal(constructed.length, 0, 'enable baseline is silent');
  assert.equal(JSON.parse(storage.getItem(firedKey(event.id))).open, open);
  assert.equal(box.querySelector('.notify-status').textContent, 'System notifications on');
  assert.equal(box.querySelector('.notify-enable').hidden, true);
  box.querySelector('.notify-test').click();
  assert.equal(constructed.length, 1); assert.equal(constructed[0].options.requireInteraction, true);
  assert.equal(constructed[0].options.tag, 'pogo-event-notify:test');
  constructed[0].onclick(); assert.deepEqual(actions.splice(0), ['focus','calendar','sidebar','close']);
  const toggle = box.querySelector('.notify-toggle input'); toggle.checked = false; await toggle.change();
  assert.equal(box.querySelector('.notify-status').textContent, 'System notifications off'); assert(box.querySelector('.notify-test').disabled);
  toggle.checked = true; await toggle.change();
  box.querySelector('select').value = 'local'; await box.querySelector('select').change();
  assert.equal(JSON.parse(storage.getItem(NOTIFY_SETTINGS_KEY)).moments, 'local');
  current = local; await run('reminderNotifier.wake()'); assert.equal(constructed.length, 2);
  assert.match(constructed[1].options.body, /GMT-4 \(America\/Toronto\)/, 'uses production reminderInstant formatter');
  constructed[1].onclick(); assert.deepEqual(actions.splice(0), ['focus','calendar','detail:' + event.id,'close']);
  run("state.locale='zh-CN'; renderReminderNotificationSettings()");
  assert.equal(box.querySelector('.notify-status').textContent, ui['zh-CN']['notify.on']);
  run("state.locale='en'");
  // Exercise real catch-up text with the production reminderRemaining, not the stub formatter.
  await run("reminderNotifier.configure({moments:'open'})");
  storage.removeItem(firedKey(event.id)); current = open + 7200000;
  await run('reminderNotifier.wake()');
  assert.match(constructed[2].options.body, /^Started 2h ago|^Started 2 hours ago/);
  MockNotification.fail = true; box.querySelector('.notify-test').click();
  assert.equal(box.querySelector('.notify-error').textContent, ui.en['notify.failed']);
  MockNotification.fail = false; await run('reminderNotifier.wake();'); run('renderReminderNotificationSettings()');
  assert.equal(box.querySelector('.notify-error').textContent, '', 'recovery clears the sidebar warning');
  MockNotification.permission = 'denied'; run('renderReminderNotificationSettings()');
  assert(box.querySelector('.notify-controls').hidden); assert.match(box.querySelector('.notify-status').textContent, /permissions icon/);
  MockNotification.permission = 'granted';
  // Background lifecycle wakes notifier but keeps UI scheduler paused; no render/refresh.
  document.hidden = true; const beforeRender = renders;
  documentHandlers.get('visibilitychange')(); await run('reminderNotifier.wake()');
  windowHandlers.get('focus')(); windowHandlers.get('pageshow')();
  windowHandlers.get('storage')({ key:NOTIFY_SETTINGS_KEY }); windowHandlers.get('storage')({ key:REMINDER_PREFIX + event.id });
  await run('reminderNotifier.wake()'); assert.equal(renders, beforeRender);
  windowHandlers.get('pagehide')(); assert.equal(clock.pending.size, 0);
  document.hidden = false; windowHandlers.get('pageshow')(); await run('reminderScheduler.wake()'); await run('reminderNotifier.wake()');
  assert(renders > beforeRender);
  // Successful/failed data loading both wake the notifier; no canonical facts are inferred on failure.
  context.fetch = async () => { throw Error('offline fixture'); };
  let dataWakes = 0; context.onDataWake = () => { dataWakes++; };
  run('reminderScheduler.pause();reminderNotifier.pause();reminderNotifier={wake:onDataWake}');
  await run('loadData()'); assert.equal(dataWakes, 1);
  run('reminderScheduler.pause()');
  run('state.ui=ui');
  for (const options of [{ Notification:null, isSecure:true, key:'notify.unsupported' },
    { Notification:MockNotification, isSecure:false, key:'notify.insecure' }]) {
    context.notifierOptions = options;
    run('reminderNotifier=createReminderNotifier({store:reminders,storage:localStorage,...notifierOptions});renderReminderNotificationSettings()');
    assert(box.querySelector('.notify-controls').hidden); assert.equal(box.querySelector('.notify-status').textContent, ui.en[options.key]);
  }
  assert.deepEqual(Object.keys(ui.en).sort(), Object.keys(ui['zh-CN']).sort());
}
run().catch(error => { console.error(error); process.exitCode = 1; });
