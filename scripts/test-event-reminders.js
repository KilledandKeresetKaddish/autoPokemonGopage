#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const {
  REMINDER_PREFIX, reminderTimeSnapshot, decodeReminder, deriveEventReminder,
  createEventReminderStore, createReminderNoteSaver, createReminderScheduler, findRaidEvent,
} = require('../public/app.js');
const fixtures = require('./fixtures/event-timing.json');
const { TestLocks, run:concurrencyTests } = require('./test-reminder-concurrency.js');
class MemoryStorage {
  constructor() { this.data = new Map(); this.refuseRead = false; this.refuseWrite = false; this.writes = 0; }
  get length() { if (this.refuseRead) throw Error('read blocked'); return this.data.size; }
  key(i) { return [...this.data.keys()][i] ?? null; }
  getItem(k) { if (this.refuseRead) throw Error('read blocked'); return this.data.get(k) ?? null; }
  setItem(k, v) { if (this.refuseWrite) throw Error('quota'); this.data.set(k, v); this.writes++; }
  removeItem(k) { if (this.refuseWrite) throw Error('quota'); this.data.delete(k); this.writes++; }
}
function timers() {
  let id = 0;
  const pending = new Map();
  return { pending, setTimeout:(fn, delay) => { pending.set(++id, { fn, delay }); return id; },
    clearTimeout:i => pending.delete(i), fire() { const [i, timer] = pending.entries().next().value; pending.delete(i); return timer.fn(); } };
}
(async () => {
let current = Date.parse('2026-10-10T23:59:59.999Z'), zone = 'Asia/Hong_Kong', serial = 0;
const storage = new MemoryStorage();
const options = { storage, locks:new TestLocks(), now:() => current, viewerTimeZone:() => zone, token:() => `incarnation-${++serial}` };
const event = { ...fixtures.valid[0], name:'测试活动', type:'community-day', highlight:true, _featured:true };
const original = JSON.stringify(event), id = event.id, key = REMINDER_PREFIX + encodeURIComponent(id);
const open = Date.parse(event.openAt), close = Date.parse(event.closeAt);
const store = createEventReminderStore(options);
await store.setEvents([event], { [id]:{ name:'Test event' } });
assert.equal(store.view(id).flagged, false);
assert((await store.star(id)).persisted);
const token = store.get(id).token;
assert.equal(store.get(id).starredAt, current);
assert.equal(store.view(id).canComplete, false);
assert.equal((await store.complete(id, true, token)).ok, false);
await store.note(id, '<img src=x onerror=alert(1)>\n中文 English', token);
assert.equal(store.view(id).status, 'upcoming');
current = open;
assert.equal(store.view(id).active, true);
assert(store.view(id).viewerWindow.start.instant > current, 'global window precedes viewer local start');
assert((await store.complete(id, true, token)).persisted);
assert.equal(store.view(id).active, false);
assert.equal(store.get(id).completedAt, current);
const reload = createEventReminderStore(options); await reload.setEvents([event]);
assert.equal(reload.view(id).completed, true, 'reload must retain manual completion');
assert((await store.complete(id, false, token)).ok);
assert.equal(store.view(id).active, true);
current = open - 1;
assert.equal(store.view(id).canComplete, false, 'clock moved backwards');
current = open + 1;
assert.equal(store.view(id).canComplete, true);
current = close - 1;
assert.equal(store.view(id).active, true);
const noteTimers = timers(), saver = createReminderNoteSaver(store, noteTimers);
saver.input(id, token, '待删除的最后笔记');
current = close;
await store.refresh(); saver.cancelMissing();
assert.equal(store.get(id), null);
assert.equal(storage.getItem(key), null);
assert.equal(noteTimers.pending.size, 0, 'expiry cancels autosave');
assert.equal((await store.note(id, 'late callback', token)).ok, false, 'even an already queued callback cannot revive expiry');
assert.equal((await store.star(id)).ok, false, 'expired events cannot be restarred');
current = close + 1;
assert.equal(store.view(id).expired, true);
assert.equal(JSON.stringify(event), original, 'personal fields must never mutate canonical data');

// Reuse every task-3 valid fixture; each independent finite boundary is checked at ±1ms.
for (const f of fixtures.valid) {
  current = Date.parse(f.openAt || f.now) - (f.openAt ? 1 : 0); zone = f.viewerTimeZone;
  const s = createEventReminderStore({ ...options, storage:new MemoryStorage() }); await s.setEvents([f]);
  assert((await s.star(f.id)).ok, f.id);
  if (f.openAt) {
    assert.equal(s.view(f.id).canComplete, false, f.id + ' before open');
    current = Date.parse(f.openAt);
    assert.equal(s.view(f.id).active, true, f.id + ' exact open');
    current++;
    assert((await s.complete(f.id, true, s.get(f.id).token)).ok, f.id + ' after open');
    assert((await s.complete(f.id, false, s.get(f.id).token)).ok);
  } else assert.equal(s.view(f.id).canComplete, false, f.id + ' unknown start');
  if (f.closeAt) {
    current = Date.parse(f.closeAt) - 1; await s.refresh(); assert(s.get(f.id), f.id + ' before close');
    current++; await s.refresh(); assert.equal(s.get(f.id), null, f.id + ' exact close');
    current++; assert.equal((await s.star(f.id)).ok, false, f.id + ' after close');
  } else {
    current = Date.parse('2029-01-01T00:00:00Z'); await s.setEvents([]); await s.refresh();
    assert(s.get(f.id), f.id + ' no invented expiry after retention');
  }
}

current = open + 1; zone = 'Asia/Hong_Kong';
const updated = createEventReminderStore(options); await updated.setEvents([event]); await updated.star(id);
await updated.note(id, 'Keep my note', updated.get(id).token); await updated.complete(id, true, updated.get(id).token);
const completed = updated.get(id).completedAt;
const changed = { ...event, start:'2026-10-15T14:00:00', end:'2026-10-15T17:00:00' };
await updated.setEvents([changed]);
assert.equal(updated.get(id).note, 'Keep my note'); assert.equal(updated.get(id).completedAt, completed);
assert.equal(updated.view(id).status, 'upcoming');
assert.notEqual(updated.get(id).time.fingerprint, reminderTimeSnapshot(event).fingerprint);
// A precise time was explicitly withdrawn; neither open nor old close may survive.
const withdrawn = { ...changed, timing:{ ...changed.timing, startPrecision:'unknown', endPrecision:'unknown' } };
await updated.setEvents([withdrawn]);
assert.equal(updated.view(id).openAt, null); assert.equal(updated.view(id).closeAt, null);
current = Date.parse('2027-05-01'); await updated.refresh(); assert(updated.get(id));
await updated.setEvents(null); assert(updated.get(id), 'load failure is not expiry');
await updated.setEvents([]); await updated.refresh(); assert(updated.get(id), 'missing event with no reliable close is retained');
// A retained last confirmed close cleans up even after months away and canonical pruning.
current = open + 1;
const missing = createEventReminderStore({ ...options, storage:new MemoryStorage() }); await missing.setEvents([event]); await missing.star(id);
await missing.note(id, 'old note', missing.get(id).token); await missing.setEvents([]);
assert(missing.get(id)); current = Date.parse('2027-05-01'); await missing.refresh(); assert.equal(missing.get(id), null);
// An invalid successful row also withdraws authority instead of keeping a stale precise time.
current = open;
await missing.setEvents([event]); await missing.star(id); await missing.setEvents([{ ...event, timing:null }]);
assert.equal(missing.get(id).time, null);
current = close + 1; await missing.refresh(); assert(missing.get(id));

// A stale tab cannot revert a newer loaded time or expire a record early on a timer/note write.
current = open + 1;
const sharedSource = new MemoryStorage();
const stale = createEventReminderStore({ ...options, storage:sharedSource });
const newer = createEventReminderStore({ ...options, storage:sharedSource });
await stale.setEvents([event]); await stale.star(id); await newer.setEvents([changed]);
await stale.refresh(); assert.equal(stale.get(id).time.end, changed.end);
current = close + 1;
await stale.refresh(); assert(stale.get(id), 'old tab must not clean up against its superseded canonical end');
await stale.note(id, 'keep newer timing', stale.get(id).token); newer.sync();
assert.equal(newer.get(id).time.end, changed.end);
await newer.setEvents([withdrawn]); await stale.refresh();
assert.equal(stale.view(id).openAt, null); assert.equal(stale.view(id).closeAt, null);

// Two tabs change different events; same-entry note and completion patches keep each other's fields.
current = open + 1;
const a = createEventReminderStore(options), b = createEventReminderStore(options);
const second = { ...event, id:'second' }; await a.setEvents([event, second]); await b.setEvents([event, second]);
await a.star(id); await b.star('second'); await a.note(id, 'tab A', a.get(id).token); await b.note('second', 'tab B', b.get('second').token);
a.sync(); b.sync(); assert.equal(a.get('second').note, 'tab B'); assert.equal(b.get(id).note, 'tab A');
await b.complete(id, true, b.get(id).token); await a.note(id, 'last successful note', a.get(id).token); b.sync();
assert.equal(b.get(id).completedAt, current); assert.equal(b.get(id).note, 'last successful note');
await b.note(id, 'last B', b.get(id).token); a.sync(); assert.equal(a.get(id).note, 'last B');
const staleToken = a.get(id).token;
await b.remove(id, b.get(id).token); assert.equal((await a.note(id, 'stale draft', staleToken)).ok, false); assert.equal(storage.getItem(key), null);
await b.star(id); assert.notEqual(b.get(id).token, staleToken);
assert.equal((await a.note(id, 'stale draft after restar', staleToken)).ok, false); b.sync(); assert.equal(b.get(id).note, '');
assert.equal((await a.remove(id, staleToken)).ok, false);
// Per-key storage.clear / expiry sync cannot write an old whole-table snapshot back.
storage.data.clear(); await a.refresh(); await b.refresh(); assert.equal(a.entries().length, 0); assert.equal(b.entries().length, 0);

// A write interleaved between read and final check is merged, not lost or falsely acknowledged.
const racing = new MemoryStorage(), raced = createEventReminderStore({ ...options, storage:racing });
await raced.setEvents([event]); await raced.star(id);
const racingGet = racing.getItem.bind(racing); let reads = 0;
racing.getItem = k => {
  const raw = racingGet(k);
  if (k === key && ++reads === 2) {
    const concurrent = JSON.parse(raw); concurrent.completedAt = current;
    const changedRaw = JSON.stringify(concurrent); racing.data.set(k, changedRaw); return changedRaw;
  }
  return raw;
};
assert((await raced.note(id, 'merged note', raced.get(id).token)).persisted);
assert.equal(raced.get(id).completedAt, current); assert.equal(raced.get(id).note, 'merged note');
const conflictClock = timers();
const conflictSaver = createReminderNoteSaver({ note:()=>Promise.resolve({ ok:false, reason:'changed' }) }, conflictClock);
conflictSaver.input('conflict', 'token', 'keep this draft'); await conflictClock.fire();
assert.equal(conflictSaver.pending('conflict').note, 'keep this draft');

// Composition is held until compositionend; blur/close explicitly flushes it.
const composingTimers = timers(); await a.star(id);
const composition = createReminderNoteSaver(a, composingTimers);
composition.input(id, a.get(id).token, '中', true); assert.equal(composingTimers.pending.size, 0);
await a.refresh(); assert.equal(a.get(id).note, '');
composition.input(id, a.get(id).token, '中文 English 🟡', false); assert.equal(composingTimers.pending.size, 1);
await composition.flushAll(); assert.equal(composingTimers.pending.size, 0); assert.equal(a.get(id).note, '中文 English 🟡');
await a.note(id, '🟡'.repeat(501), a.get(id).token); assert.equal(Array.from(a.get(id).note).length, 500);

// Quota/private-mode writes keep a session overlay; a later successful tab deletion wins.
storage.refuseWrite = true; await a.note(id, 'session only', a.get(id).token);
assert.equal(a.get(id).note, 'session only'); assert.equal(a.status().unpersisted, true);
await a.refresh(); assert.equal(a.get(id).note, 'session only');
storage.refuseWrite = false; b.sync(); await b.remove(id, b.get(id).token); a.sync(); assert.equal(a.get(id), null);
assert.equal(a.status().unpersisted, false);
storage.refuseRead = true; await a.star('second'); assert(a.get('second')); assert(a.status().unpersisted);
storage.refuseRead = false;
const broken = new MemoryStorage(); broken.setItem(key, '{bad JSON'); broken.setItem('pogo-todo', 'unchanged');
const corrupt = createEventReminderStore({ ...options, storage:broken }); await corrupt.setEvents([event]);
assert.equal(corrupt.entries().length, 0); assert(corrupt.status().isolated);
await corrupt.star(id); assert(corrupt.get(id)); assert(corrupt.status().unpersisted);
assert.equal(broken.getItem(key), '{bad JSON'); assert.equal(broken.getItem('pogo-todo'), 'unchanged');
const old = new MemoryStorage(); old.setItem('pogo-event-reminders', JSON.stringify({ v:0, events:{ [id]:{
  starredAt:open - 1, completedAt:open, note:'legacy', name:'旧记录', time:event,
} } }));
const migrated = createEventReminderStore({ ...options, storage:old }); await migrated.ready;
assert.equal(migrated.get(id).note, 'legacy'); assert.equal(migrated.get(id).completedAt, open);
assert.equal(old.getItem('pogo-event-reminders'), null); assert(decodeReminder(old.getItem(key), id));
old.setItem('pogo-event-reminders', '{"v":99,"records":[]}');
const unknownLegacy = createEventReminderStore({ ...options, storage:old }); await unknownLegacy.ready;
assert(unknownLegacy.status().isolated);
assert.equal(old.getItem('pogo-event-reminders'), '{"v":99,"records":[]}');
// A v0 legacy naked closeAt is not trustworthy evidence and never used for cleanup.
const naked = new MemoryStorage(); naked.setItem('pogo-event-reminders', JSON.stringify({ v:0, events:{ naked:{ starredAt:open, note:'review me', time:{closeAt:close} } } }));
const uncertain = createEventReminderStore({ ...options, storage:naked }); current = close + 100000; await uncertain.refresh(); assert(uncertain.get('naked')); assert.equal(uncertain.view('naked').closeAt, null);

// A failed deletion is retried on storage recovery; it never archives the expired note.
current = open + 1;
const retryStorage = new MemoryStorage(), retry = createEventReminderStore({ ...options, storage:retryStorage });
await retry.setEvents([event]); await retry.star(id); await retry.note(id, 'delete me', retry.get(id).token);
retryStorage.refuseWrite = true; current = close; await retry.refresh();
assert.equal(retry.get(id), null); assert(retry.status().unpersisted);
retryStorage.refuseWrite = false; await retry.refresh();
assert.equal(retryStorage.getItem(key), null); assert.equal(retry.status().unpersisted, false);

// One scheduler: nearest boundary, 30s cap, visibility pause, large jumps/backwards clock.
current = open - 1; const clock = timers(); let refreshes = 0, hidden = false;
const scheduler = createReminderScheduler({ ...clock, now:() => current, isHidden:() => hidden,
  refresh:() => refreshes++, boundaries:() => [open, close, Number.MAX_SAFE_INTEGER] });
await scheduler.wake(); assert.equal(clock.pending.size, 1); assert.equal([...clock.pending.values()][0].delay, 1);
current = open; await clock.fire(); assert.equal(refreshes, 2); assert.equal(clock.pending.size, 1); assert.equal([...clock.pending.values()][0].delay, 30000);
current = close + 1; await scheduler.wake(); assert.equal([...clock.pending.values()][0].delay, 30000);
hidden = true; await scheduler.wake(); assert.equal(clock.pending.size, 0);
hidden = false; current = open - 1; await scheduler.wake(); assert.equal([...clock.pending.values()][0].delay, 1); scheduler.pause(); assert.equal(clock.pending.size, 0);

// If refresh work straddles a boundary, schedule an immediate follow-up rather than losing it for 30s.
current = open - 1; const slowClock = timers();
const slow = createReminderScheduler({ ...slowClock, now:() => current, refresh:() => { current = open; }, boundaries:() => [open, close] });
await slow.wake(); assert.equal([...slowClock.pending.values()][0].delay, 1); slow.pause();

// Canonical raid ID only: precise day/form matches; ambiguous pools and fallback have no identity.
const raid = { ...event, id:'raid', type:'raid-battles', pokemon:[{id:6,hub:'6-Mega_X'}] };
assert.equal(findRaidEvent({ day:'2026-10-11', mons:[{id:6,hub:'6-Mega_X'}] }, [raid]).id, 'raid');
assert.equal(findRaidEvent({ day:'2026-10-15', mons:[{id:6}] }, [raid]), null);
assert.equal(findRaidEvent({ day:'2026-10-11', mons:[{id:6,hub:'6-Mega_Y'}] }, [raid]), null);
const forms = [{id:6,hub:'6-Mega_X'}, {id:6,hub:'6-Mega_Y'}];
assert.equal(findRaidEvent({ day:'2026-10-11', mons:forms }, [raid]), null, 'both forms must be present in a pooled drawer');
assert.equal(findRaidEvent({ day:'2026-10-11', mons:forms }, [{...raid,pokemon:forms}]).id, 'raid');
assert.equal(findRaidEvent({ day:'2026-10-11', mons:[{id:6},{id:9}] }, [raid, {...raid,id:'other',pokemon:[{id:9}]}]), null);
assert.equal(findRaidEvent({ mons:[{id:150}] }, [raid]), null);
assert.equal(findRaidEvent({ day:'2026-10-11', mons:[{id:6}] }, [raid]), null, 'base sprite must not bind a Mega form');
const clean = createEventReminderStore({ ...options, storage:new MemoryStorage() });
assert.equal((await clean.star('invented-fallback')).ok, false);
assert.equal(deriveEventReminder(null, event, open, 'UTC').active, false);
await concurrencyTests();
console.log(`test-event-reminders: PASS (state cycle, ${fixtures.valid.length} timing fixtures ±1ms, snapshots/withdrawal/retention, multi-tab per-key merge, IME/autosave races, storage/migration, shared scheduler, raid identity)`);

})().catch(error => { console.error(error); process.exitCode = 1; });
