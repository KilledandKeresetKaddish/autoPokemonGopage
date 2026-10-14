#!/usr/bin/env node
'use strict';
// Two independent production page-state contexts, one storage/LockManager.
// Tiny DOM only hosts the real controls/listeners; Chromium covers full drawers/calendar.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
class Control {
  constructor() { this.dataset={}; this.nodes=new Map(); this.handlers=new Map(); this.value=''; }
  querySelector(selector) {
    if (selector === '.reminder-note-editor') {
      if (!this.nodes.has(selector)) { const label=new Control(); label.nodes.set('textarea',this.querySelector('textarea')); this.nodes.set(selector,label); }
    }
    if (!this.nodes.has(selector)) this.nodes.set(selector,new Control());
    return this.nodes.get(selector);
  }
  addEventListener(name, fn) { this.handlers.set(name,fn); }
  setAttribute() {}
  click() { if (!this.disabled) this.handlers.get('click')?.({stopPropagation(){},currentTarget:this}); }
  dispatch(name) { this.handlers.get(name)?.(); }
}
function page(options, events) {
  const document={box:null,activeElement:null,createElement:()=>new Control(),addEventListener(){},
    querySelector:()=>document.box,querySelectorAll:()=>[]};
  const context=vm.createContext({document,options,events,console,Intl,Date,AbortController,setTimeout,clearTimeout,
    confirm:()=>context.allowConfirm,allowConfirm:true});
  const run=code=>vm.runInContext(code,context);
  run(source);
  run(`
    reminders=createEventReminderStore(options); state.events=events; reminderViewerZone='UTC';
    reminderSaver=createReminderNoteSaver(reminders,{setTimeout:()=>1,clearTimeout:()=>{}});
    syncReminderUi=()=>{if(document.box) syncReminderControls(document.box);};
    reminderScheduler={wake:async()=>{await reminders.refresh();reminderSaver.cancelMissing();syncReminderUi();}};
    const productionAction=reminderAction;
    reminderAction=(...args)=>{lastAction=productionAction(...args);return lastAction;};
  `);
  return {context,run,
    show(id='E') { context.id=id; document.box=run('createReminderControls(id)'); return document.box; },
    click(selector) { document.box.querySelector(selector).click(); return context.lastAction; },
  };
}
async function run({TestLocks,MemoryStorage}) {
  const event={id:'E',name:'UI fixture',start:'2026-10-11T00:00:00Z',end:'2026-10-12T00:00:00Z',
    timing:{scope:'global',mode:'absolute',startPrecision:'exact',endPrecision:'exact'}};
  const key='pogo-event-reminders:v1:E';
  let now=Date.parse(event.start)+1, serial=0;
  async function pair(initial) {
    const storage=new MemoryStorage(), locks=new TestLocks();
    const options={storage,locks,now:()=>now,viewerTimeZone:()=>'UTC',token:()=>`ui-${++serial}`};
    const a=page(options,[event,{...event,id:'F'}]), b=page(options,[event,{...event,id:'F'}]);
    await a.run('reminders.setEvents(state.events)'); await b.run('reminders.setEvents(state.events)');
    if (initial !== 'absent') await a.run('reminders.star("E")');
    if (initial === 'completed') await a.run('reminders.complete("E",true,reminders.get("E").token)');
    b.run('reminders.sync()'); a.show(); b.show();
    return {a,b,storage,locks};
  }
  for (const [name,initial,selector,expected] of [
    ['complete','starred','.reminder-done','completed'],['remove','starred','.reminder-star','absent'],
    ['undo','completed','.reminder-done','starred'],['star','absent','.reminder-star','starred'],
  ]) {
    if (process.env.REMINDER_UI_CASE && process.env.REMINDER_UI_CASE !== name) continue;
    const {a,b,storage}=await pair(initial); let other;
    storage.beforeWrite=()=>{other=b.click(selector);}; // start only; NEVER await a contender in the holder
    await a.click(selector); assert(other,'fixture must start second click in the final write gap'); await other;
    b.run('reminders.sync()');
    const r=JSON.parse(storage.getItem(key));
    assert.equal(r ? r.completedAt !== null ? 'completed' : 'starred' : 'absent',expected,
      `${initial}: two same-direction production button clicks must not toggle back`);
  }
  if (process.env.REMINDER_UI_CASE && process.env.REMINDER_UI_CASE !== 'draft') return;
  const {a,b,storage,locks}=await pair('starred');
  await a.run('reminders.note("E","saved note",reminders.get("E").token)'); a.show();
  a.context.allowConfirm=false; await a.click('.reminder-star');
  assert(storage.getItem(key),'declining cancellation does not delete');
  a.context.allowConfirm=true;
  const input=a.context.document.box.querySelector('textarea'); input.value='unsaved new draft'; input.dispatch('input');
  locks.fail=true; await a.run('reminderSaver.flush("E")');
  a.show('F'); a.show('E');
  assert.equal(a.context.document.box.querySelector('textarea').value,'unsaved new draft','rebuilt control restores failed draft');
  locks.fail=false; a.context.document.box.querySelector('textarea').dispatch('blur'); await a.run('reminderSaver.flush("E")');
  assert.equal(JSON.parse(storage.getItem(key)).note,'unsaved new draft');
  // Drawer reconstruction/blur while the real store is queued reuses one flight.
  let releaseFlight, flightEntered;
  const flightInside=new Promise(resolve=>flightEntered=resolve);
  const flightBlocker=locks.request('pogo-event-reminders:v1:',{signal:new AbortController().signal},async()=>{
    flightEntered();await new Promise(resolve=>releaseFlight=resolve);
  });
  await flightInside;
  const flightInput=a.context.document.box.querySelector('textarea');flightInput.value='in-flight draft';flightInput.dispatch('input');
  const flight=a.run('reminderSaver.flush("E")');await Promise.resolve();
  a.show('F');a.show('E');
  const recreated=a.context.document.box.querySelector('textarea');assert.equal(recreated.value,'in-flight draft');
  recreated.dispatch('blur');assert.equal(a.run('reminderSaver.flush("E")'),flight,'recreated blur cannot duplicate the save');
  releaseFlight();await flightBlocker;await flight;
  assert.equal(JSON.parse(storage.getItem(key)).note,'in-flight draft');
  const rebuilt=a.context.document.box.querySelector('textarea');rebuilt.value='keep through failed remove';rebuilt.dispatch('input');
  locks.fail=true; await a.run('reminderSaver.flush("E")'); await a.click('.reminder-star');
  assert.equal(a.run('reminderSaver.pending("E").note'),'keep through failed remove','failed remove retains applicable draft');
  locks.fail=false; await a.run('reminderSaver.flush("E")');
  // Displayed old-token commands wait while another page deletes and re-stars.
  for(const selector of ['.reminder-done','.reminder-star']) {
    a.show();let release,entered;const inside=new Promise(resolve=>entered=resolve);
    const blocker=locks.request('pogo-event-reminders:v1:',{signal:new AbortController().signal},async()=>{
      entered();await new Promise(resolve=>release=resolve);
    });
    await inside;
    b.run('reminders.sync()');const oldToken=a.run('reminders.get("E").token');
    const remove=b.run('reminders.remove("E",reminders.get("E").token)');const star=b.run('reminders.star("E")');
    const oldButton=a.click(selector);
    release();await blocker;await Promise.all([remove,star]);await oldButton;
    const r=JSON.parse(storage.getItem(key));assert.notEqual(r.token,oldToken);assert.equal(r.completedAt,null);
  }
  // Normal one-page completion/undo/removal still uses refreshed button commands.
  a.show(); await a.click('.reminder-done'); assert.notEqual(JSON.parse(storage.getItem(key)).completedAt,null);
  await a.click('.reminder-done'); assert.equal(JSON.parse(storage.getItem(key)).completedAt,null);
  await a.click('.reminder-star'); assert.equal(storage.getItem(key),null);
  now=Date.parse(event.end)-1;
  const expiry=await pair('starred');let releaseExpiry, expiryEntered;
  const expiryInside=new Promise(resolve=>expiryEntered=resolve);
  const expiryBlocker=expiry.locks.request('pogo-event-reminders:v1:',{signal:new AbortController().signal},async()=>{
    expiryEntered();await new Promise(resolve=>releaseExpiry=resolve);
  });
  await expiryInside;const expires=expiry.a.click('.reminder-done');now++;
  releaseExpiry();await expiryBlocker;await expires;
  assert.equal(expiry.storage.getItem(key),null,'queued completion cannot restore an expired reminder');
  console.log('test-reminder-ui: PASS (production controls/actions, same-direction gap races, stale buttons, confirmation, failed/in-flight draft reconstruction/blur, queued expiry)');
}
if (require.main === module) run(require('./test-reminder-concurrency.js')).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run};
