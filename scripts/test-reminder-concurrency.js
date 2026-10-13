#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { createEventReminderStore, createReminderNoteSaver, REMINDER_PREFIX } = require('../public/app.js');

// One shared lock manager for both simulated tabs. A queued contender never
// runs inside its predecessor; barriers are released by the test, not the lock holder.
class TestLocks {
  constructor() { this.tails = new Map(); this.fail = false; this.calls = 0; }
  request(name, options, callback) {
    this.calls++;
    if (this.fail) return Promise.reject(Error('locks unavailable'));
    const before = this.tails.get(name) || Promise.resolve();
    const result = before.then(() => {
      if (options.signal.aborted) throw Error('aborted');
      return callback();
    });
    this.tails.set(name, result.catch(() => {}));
    return result;
  }
}
class MemoryStorage {
  constructor() { this.data = new Map(); this.beforeWrite = null; this.refuse = false; }
  get length() { return this.data.size; }
  key(i) { return [...this.data.keys()][i] ?? null; }
  getItem(k) { return this.data.get(k) ?? null; }
  setItem(k, v) {
    if (this.refuse) throw Error('quota');
    const hook = this.beforeWrite; this.beforeWrite = null;
    if (hook) hook(); // precisely AFTER production's final getItem, before setItem
    this.data.set(k, v);
  }
  removeItem(k) { if (this.refuse) throw Error('quota'); this.data.delete(k); }
}
const event = { id:'race', name:'竞争活动', start:'2026-10-11T00:00:00Z', end:'2026-10-12T00:00:00Z',
  timing:{scope:'global',mode:'absolute',startPrecision:'exact',endPrecision:'exact'} };
const key = REMINDER_PREFIX + 'race', close = Date.parse(event.end);
async function run() {
  let now = Date.parse(event.start) + 1, serial = 0;
  const storage = new MemoryStorage(), locks = new TestLocks();
  const options = {storage, locks, now:()=>now, viewerTimeZone:()=>'UTC',token:()=>`race-${++serial}`};
  const a = createEventReminderStore(options), b = createEventReminderStore(options);
  await a.setEvents([event, {...event,id:'other'}]); await b.setEvents([event, {...event,id:'other'}]);
  await a.star(event.id); b.sync();
  const oldToken = a.get(event.id).token;
  let removal;
  storage.beforeWrite = () => { removal = b.remove(event.id, oldToken); };
  const note = await a.note(event.id, 'old draft', oldToken);
  assert(note.persisted);
  assert((await removal).persisted);
  b.sync();
  // The old implementation returns success for both but leaves old token/note here.
  assert.equal(storage.getItem(key), null, 'delete in final-read/write gap must not resurrect');
  assert.equal(b.view(event.id).flagged, false);

  await b.star(event.id); const newToken = b.get(event.id).token;
  await b.note(event.id, 'new incarnation note', newToken);
  assert.notEqual(newToken, oldToken);
  assert.equal((await a.note(event.id, 'stale autosave', oldToken)).ok, false);
  assert.equal((await a.remove(event.id, oldToken)).ok, false);
  b.sync(); assert.equal(b.get(event.id).note, 'new incarnation note');
  await Promise.all([a.complete(event.id, true, newToken), b.note(event.id, 'concurrent note', newToken), a.star('other')]);
  b.sync(); assert.equal(b.get(event.id).completedAt, now); assert.equal(b.get(event.id).note, 'concurrent note');
  assert(b.get('other'), 'different event is independent');

  // Expiry queues while the old note is at its final write: deletion must be last.
  let expiry;
  storage.beforeWrite = () => { now = close; expiry = b.refresh(); };
  await a.note(event.id, 'at deadline', newToken); await expiry;
  assert.equal(storage.getItem(key), null);
  assert.equal((await a.note(event.id, 'after deadline', newToken)).ok, false);
  assert.equal((await a.star(event.id)).ok, false);

  // A queued operation checks the time AFTER lock acquisition, never before waiting.
  now = close - 1; await a.star(event.id);
  let release, entered;
  const inside = new Promise(resolve => { entered = resolve; });
  const blocker = locks.request(REMINDER_PREFIX, {signal:new AbortController().signal}, async () => {
    entered(); await new Promise(resolve => { release = resolve; });
  });
  await inside;
  const waiting = a.note(event.id, 'queued before close', a.get(event.id).token);
  now = close; release(); await blocker;
  assert.equal((await waiting).reason, 'expired'); assert.equal(storage.getItem(key), null);

  now = close - 1000;
  locks.fail = true;
  const before = JSON.stringify([...storage.data]);
  assert.equal((await b.star(event.id)).ok, false, 'lock failure must fail closed');
  assert.equal(JSON.stringify([...storage.data]), before, 'no unsafe fallback writer');
  assert(b.status().lockingUnavailable);
  for (const result of await Promise.all([a.refresh(), a.setEvents([{...event,end:'2026-11-01T00:00:00Z'}]),
    a.note('other','not written',a.get('other')?.token), a.complete('other',true,a.get('other')?.token)])) {
    assert.equal(result.reason, 'locking'); assert.equal(result.persisted, false);
  }
  assert.equal(JSON.stringify([...storage.data]), before);
  locks.fail = false; assert((await b.star(event.id)).persisted);
  assert.equal(b.status().lockingUnavailable, false);
  const unsupported = createEventReminderStore({...options,locks:null});
  await unsupported.ready;
  const unchanged = storage.getItem(key);
  assert.equal((await unsupported.remove(event.id, b.get(event.id).token)).ok, false);
  assert.equal(storage.getItem(key), unchanged); assert(unsupported.status().lockingUnavailable);

  // Session-only delete retry respects a newer incarnation under the same lock.
  const t = b.get(event.id).token; storage.refuse = true;
  assert.equal((await b.remove(event.id,t)).persisted, false);
  storage.refuse = false; await a.remove(event.id,t); await a.star(event.id);
  const restored = a.get(event.id).token;
  await b.refresh(); assert.equal(b.get(event.id).token, restored);
  assert.equal(b.get(event.id).note, '');
  // A verified withdrawal blocked by lock failure is applied on recovery BEFORE
  // cleanup/note mutation; the obsolete end cannot delete the pending new snapshot.
  const sourceStorage=new MemoryStorage(), sourceStore=createEventReminderStore({...options,storage:sourceStorage});
  await sourceStore.setEvents([event]); await sourceStore.star('race');
  await sourceStore.note('race','keep through withdrawal',sourceStore.get('race').token);
  locks.fail=true;
  assert.equal((await sourceStore.setEvents([{...event,timing:{...event.timing,endPrecision:'unknown'}}])).reason,'locking');
  now=close+1; locks.fail=false; await sourceStore.refresh();
  assert.equal(sourceStore.get('race').note,'keep through withdrawal'); assert.equal(sourceStore.view('race').closeAt,null);
  now=close-1000;

  // Two constructors migrate under that same lock. Partially migrated legacy rows
  // cannot reappear after deletion, even when a malformed sibling preserves v0.
  const legacy = new MemoryStorage();
  legacy.setItem('pogo-event-reminders',JSON.stringify({v:0,events:{race:{starredAt:now,note:'legacy kept',time:event},bad:null}}));
  const m1=createEventReminderStore({...options,storage:legacy}), m2=createEventReminderStore({...options,storage:legacy});
  await Promise.all([m1.ready,m2.ready]); m1.sync(); m2.sync();
  assert.equal(m1.get('race').token,m2.get('race').token); assert.equal(m1.get('race').note,'legacy kept');
  assert((await m1.remove('race',m1.get('race').token)).persisted);
  const m3=createEventReminderStore({...options,storage:legacy}); await m3.ready;
  assert.equal(m3.get('race'),null); assert.equal(legacy.getItem(key),null);
  const noMigration=createEventReminderStore({...options,storage:legacy,locks:null});
  const legacyBefore=legacy.getItem('pogo-event-reminders'); await noMigration.ready;
  assert.equal(legacy.getItem('pogo-event-reminders'),legacyBefore);

  // A save stays pending until its Promise resolves. Duplicate flushes share one
  // flight, and old completion/rejection never reattaches canceled/replaced drafts.
  let finish, calls=0;
  const saves=[];
  const saver=createReminderNoteSaver({note:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}},
    {setTimeout:()=>1,clearTimeout:()=>{},onSave:(id,r)=>saves.push(r.record)});
  saver.input('race','token','first'); const flight=saver.flush('race');
  assert.equal(saver.flush('race'),flight); await Promise.resolve();
  assert.equal(calls,1); assert(saver.pending('race').flight);
  saver.input('race','token','new draft'); finish({ok:true,persisted:true,record:'first'}); await flight;
  assert.equal(saver.pending('race').note,'new draft'); assert.equal(saves.length,0);
  const newerFlight=saver.flush('race'); await Promise.resolve();
  finish({ok:true,persisted:true,record:'new draft'}); await newerFlight;
  assert.equal(saver.pending('race'),undefined); assert.deepEqual(saves,['new draft']);
  saver.input('race','token','canceled'); const canceled=saver.flush('race'); await Promise.resolve();
  saver.cancel('race'); finish({ok:true,persisted:true,record:'canceled'}); await canceled;
  assert.equal(saver.pending('race'),undefined); assert.deepEqual(saves,['new draft']);
  const rejected=createReminderNoteSaver({note:()=>Promise.reject(Error('denied'))},{setTimeout:()=>1,clearTimeout:()=>{}});
  rejected.input('race','token','unsaved'); assert.equal((await rejected.flush('race')).ok,false);
  assert.equal(rejected.pending('race').note,'unsaved'); assert(rejected.pending('race').failed);
  console.log('test-reminder-concurrency: PASS (final-read/write deletion, restar tokens, expiry/barrier, note+completion, independent IDs, locks unavailable/recovery)');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { TestLocks, MemoryStorage, run };
