#!/usr/bin/env node
'use strict';
// Optional sandbox-only browser dependency; no runtime package/build step.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = path.join(__dirname, '..');
const artifacts = path.join(root, '.pi-tmp/reminder-browser');
fs.mkdirSync(artifacts, { recursive:true });
const timing = { scope:'global', mode:'local', startPrecision:'exact', endPrecision:'exact' };
function event(id, type, options = {}) {
  return { id, name:`测试 ${id}`, type, start:'2026-10-11T14:00:00', end:'2026-10-11T17:00:00', timing,
    pokemon:[], bonuses:[], counters:[], sections:[], links:[], ...options };
}
const events = [
  event('green', 'community-day', { highlight:true }),
  event('blue', 'event', { end:'2026-10-16T17:00:00', longTerm:false }),
  event('red', 'raid-day'),
  event('long', 'season', { end:'2026-10-31T17:00:00', longTerm:true }),
  event('pvp', 'go-battle-league', { end:'2026-10-31T17:00:00', pvp:true }),
  event('raid', 'raid-battles', { end:'2026-10-16T17:00:00', pokemon:[{id:150,name:'测试 Boss'}] }),
  event('raid-forms', 'raid-battles', { start:'2026-10-12T14:00:00',end:'2026-10-16T17:00:00',pokemon:[
    {id:6,name:'Test form X',hub:'6-Mega_X',sprite:'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10034.png'},
    {id:6,name:'Test form Y',hub:'6-Mega_Y',sprite:'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10035.png'},
  ] }),
  ...Array.from({length:6}, (_,i) => event(`chip-${i}`, 'max-mondays')),
  event('future', 'event', { start:'2026-11-11T14:00:00', end:'2026-11-11T17:00:00' }),
  event('unknown', 'event', { start:'2026-10-11', end:'2026-10-12', timing:{ ...timing,startPrecision:'date',endPrecision:'date' } }),
  event('partial', 'event', { end:null, timing:{ ...timing,endPrecision:'unknown' } }),
  event('regional', 'event', { start:'2026-10-11T14:00:00',end:'2026-10-11T17:00:00',timing:{ ...timing,scope:'regional',timeZone:'Asia/Tokyo' } }),
  event('absolute', 'event', { start:'2026-10-11T00:00:00Z',end:'2026-10-11T03:00:00Z',timing:{ ...timing,mode:'absolute' } }),
];
const originalEvents = JSON.stringify(events);
const englishRegions = JSON.parse(fs.readFileSync(path.join(root,'public/data/i18n/en.json'),'utf8')).regions;
const todoFixture = { v:1,day:'2026-10-09',
  accounts:[{id:'account-a',name:'已有账号 A',cdStart:null,cdView:'dur'}, {id:'account-b',name:'Existing account B',cdStart:null,cdView:'dur'}],
  tasks:[{id:'task-a',name:'原任务 A'}, {id:'task-b',name:'Existing task B'}],checks:{'account-a|task-a':true,'account-b|task-b':true} };
let canonical = events, failEvents = false;
const overlays = Object.fromEntries(events.map(e => [e.id,{name:`Test ${e.id}`,heading:'Test fixture',summary:'',pokemon:e.pokemon.map(p=>p.name),bonuses:[],counters:[],sections:[]}]));
const rotations = {month:'2026-10',note:'fixture',tracks:[
  {key:'5star',label:'5★',segments:[{start:'2026-10-11',end:'2026-10-16',cn:'Test raid',pokemon:[{id:150,name:'Test Boss'}]}]},
  {key:'mega',label:'Mega',segments:[{start:'2026-10-11',end:'2026-10-11',cn:'Fallback',pokemon:[{id:6,name:'Fallback',hub:'6-Mega_X'}]},
    {start:'2026-10-12',end:'2026-10-16',cn:'Test form X / Y',pokemon:events.find(e=>e.id==='raid-forms').pokemon}]},
]};
const open = Date.parse('2026-10-11T00:00:00Z'), close = Date.parse('2026-10-12T05:00:00Z');
const prefix = 'pogo-event-reminders:v1:';
const server = http.createServer((req, res) => {
  const file = path.join(root, 'public', new URL(req.url,'http://localhost').pathname === '/' ? 'index.html' : new URL(req.url,'http://localhost').pathname);
  if (!file.startsWith(path.join(root,'public/'))) { res.writeHead(403).end(); return; }
  fs.readFile(file,(error,body) => {
    if (error) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : file.endsWith('.png') ? 'image/png' : 'text/html');
    res.end(body);
  });
});
let browser, step = 'init';
const deadline = setTimeout(async () => {
  console.error('test-event-reminders-browser: timed out at ' + step);
  process.exitCode = 1; if (browser) await browser.close(); server.close();
}, 90000);
(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const context = await browser.newContext({viewport:{width:1440,height:1050}});
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><circle cx="25" cy="25" r="15" fill="#e8cb8c"/></svg>'});
    if (url.pathname === '/data/events.json') return route.fulfill({status:failEvents ? 503 : 200,json:failEvents ? {} : canonical});
    if (url.pathname === '/data/rotations.json') return route.fulfill({json:rotations});
    if (url.pathname === '/data/featured.json') return route.fulfill({json:['red']});
    if (url.pathname === '/data/i18n/en.json') return route.fulfill({json:{events:overlays,regions:englishRegions,categories:{},rotations:{tracks:{}}}});
    return route.continue();
  });
  await context.addInitScript(({start,todo}) => {
    try { if (localStorage.getItem('pogo-todo') === null) localStorage.setItem('pogo-todo',JSON.stringify(todo)); } catch { /* opaque initial document */ }
    window.__testNow = start;
    const RealDate = Date;
    window.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [window.__testNow])); }
      static now() { return window.__testNow; }
    };
    window.__testHidden = false;
    Object.defineProperty(document,'hidden',{get:()=>window.__testHidden});
  // Hold a minute before open, not 1ms, so real timers don't spin against a
  // frozen browser wall clock. The pure scheduler fixtures cover every ±1ms.
  }, {start:open-60000,todo:todoFixture});
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Hong_Kong'});
  const errors = []; context.on('page',p=>p.on('pageerror',error=>errors.push(error.message)));
  const ready = async p => { await p.waitForSelector('#calendar .cal-week'); await p.waitForFunction(()=>typeof reminders!=='undefined' && !!reminders && !!todoState); };
  const tick = async (p, time, eventName='pageshow') => p.evaluate(({time,eventName}) => {
    window.__testNow = time;
    if (eventName==='visibilitychange') document.dispatchEvent(new Event(eventName));
    else window.dispatchEvent(new Event(eventName));
    return reminderScheduler.wake();
  }, {time,eventName});
  const settle = async p => {
    await p.waitForFunction(()=>reminderActions.size === 0);
    await p.evaluate(async()=>{await reminderSaver.flushAll(); await reminderScheduler.wake();});
  };
  const flag = async (p,id) => p.evaluate(id=>reminderAction(id,'star'),id);
  const view = (p,id) => p.evaluate(id=>({active:reminders.view(id).active,flagged:reminders.view(id).flagged,completed:reminders.view(id).completed,note:reminders.get(id)?.note}),id);
  const activeCopies = (p,id) => p.locator(`[data-reminder-event~="${id}"].reminder-active`).count();
  await page.goto(origin); await ready(page);
  assert.equal(await page.locator('[data-init-error]').count(),0);
  const todoBefore = await page.evaluate(()=>localStorage.getItem('pogo-todo'));
  assert.deepEqual(JSON.parse(todoBefore),todoFixture,'existing multi-account TODO must not be reseeded');
  const zhRegionText = await page.locator('[data-ai-region]').allTextContents();
  await page.locator('.cal-bar[data-reminder-event="green"]').click();
  await page.locator('.detail-reminder .reminder-star').click();
  await settle(page);
  assert.equal(await page.locator('.detail-reminder .reminder-done').isDisabled(),true);
  assert.equal(await activeCopies(page,'green'),0);
  assert.match(await page.locator('.detail-reminder .reminder-time').innerText(),/提醒开始后才能完成/);
  const input = page.locator('.detail-reminder textarea');
  const note = '<img src=x onerror="window.NOTE_EXECUTED=1">\n中文 English';
  await input.fill(note); await input.blur(); await settle(page);
  assert.equal((await view(page,'green')).note,note);
  assert.equal(await page.locator('.reminder-note-preview img').count(),0);
  assert.equal(await page.evaluate(()=>window.NOTE_EXECUTED),undefined);
  await tick(page,open);
  assert((await activeCopies(page,'green'))>0);
  assert.equal(await page.locator('#reminder-live .reminder-item[data-id="green"].reminder-active').count(),1);
  assert.equal(await page.locator('.detail-reminder .reminder-done').isDisabled(),false);
  assert.match(await page.locator('.detail-reminder .reminder-time').innerText(),/全球已开始[\s\S]*本地还有[\s\S]*UTC−12[\s\S]*GMT\+8[\s\S]*Asia\/Hong_Kong/);
  await page.locator('.detail-reminder .reminder-done').click();
  await settle(page);
  assert.equal(await activeCopies(page,'green'),0); assert.equal((await view(page,'green')).completed,true);
  await page.reload(); await ready(page); await tick(page,open+1);
  assert.equal((await view(page,'green')).completed,true); assert.equal(await activeCopies(page,'green'),0);
  await page.locator('#reminder-completed>summary').click();
  await page.locator('#reminder-completed .reminder-done').click();
  await settle(page);
  assert((await activeCopies(page,'green'))>0);
  for (const id of ['blue','red','long','pvp','raid','chip-3','chip-4','chip-5','future','unknown','partial','regional','absolute']) await flag(page,id);
  assert.equal((await view(page,'unknown')).active,false); assert.equal((await view(page,'regional')).active,false);
  assert.equal((await view(page,'absolute')).active,true); assert.equal((await view(page,'partial')).active,true);
  assert((await activeCopies(page,'blue'))>=2,'cross-week copies');
  assert.equal(await page.locator('#long-term .reminder-active').count(),1);
  assert.equal(await page.locator('#pvp-band .reminder-active').count(),1);
  assert((await page.locator('.raid-ico[data-reminder-event="raid"].reminder-active').count())>=6);
  assert.equal(await page.locator('.cal-more.reminder-active').count(),1,'hidden chip reminders must glow');
  await page.locator('.cal-more').click();
  assert.equal(await page.locator('#detail-body .raid-day-option').count(),6);
  assert.equal(await page.locator('#detail-body .raid-day-option.reminder-active').count(),3);
  await page.locator('#detail-close').click();
  await page.locator('.raid-ico.mega:not([data-reminder-event])').click();
  assert.equal(await page.locator('.detail-reminder').count(),0,'unmapped raid fallback cannot create reminders');
  await page.locator('#detail-close').click();
  // Same base dex, distinct forms: the pooled badge must open the complete
  // canonical drawer, not a link-less fallback or a partial form match.
  const formsBadge = page.locator('.raid-ico.mega[data-reminder-event="raid-forms"]');
  assert.equal(await formsBadge.count(),5);
  await formsBadge.first().click();
  assert.equal(await page.locator('.detail-reminder').getAttribute('data-id'),'raid-forms');
  assert.equal(await page.locator('#detail-body .mon-row img').count(),2);
  await page.locator('.detail-reminder .reminder-star').click();
  await settle(page);
  assert.equal((await view(page,'raid-forms')).flagged,true);
  assert.equal(await page.locator('.detail-reminder .reminder-done').isDisabled(),true);
  await page.locator('#detail-close').click();
  const cardCount = await page.locator('.reminder-item').count();
  await page.locator('#cal-next').click(); assert.equal(await page.locator('.reminder-item').count(),cardCount);
  await page.locator('#cal-prev').click(); assert((await activeCopies(page,'blue'))>=2);
  const backgrounds = await page.locator('.cal-bar.reminder-active').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).backgroundImage));
  assert(backgrounds.every(bg=>bg.includes('152, 99, 255') && bg.includes('111, 255, 238')),'aurora not category dependent');
  assert.equal(await page.locator('.cal-bar[data-reminder-event="red"]').evaluate(n=>n.classList.contains('ft')),true);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:path.join(artifacts,'desktop-aurora-0.png'),fullPage:true});
  const animationTarget = page.locator('.cal-bar[data-reminder-event="red"]');
  const animationBefore = await animationTarget.evaluate(n=>({pos:getComputedStyle(n).backgroundPosition,shadow:getComputedStyle(n).boxShadow,animation:getComputedStyle(n).animationName,box:n.getBoundingClientRect().toJSON()}));
  await page.waitForTimeout(1200);
  const animationAfter = await animationTarget.evaluate(n=>({pos:getComputedStyle(n).backgroundPosition,shadow:getComputedStyle(n).boxShadow,box:n.getBoundingClientRect().toJSON()}));
  assert.notEqual(animationBefore.pos,animationAfter.pos); assert.notEqual(animationBefore.shadow,animationAfter.shadow);
  assert.match(animationBefore.animation,/aurora-flow, aurora-glow/); assert.deepEqual(animationBefore.box,animationAfter.box,'animation must not shift layout');
  await page.screenshot({path:path.join(artifacts,'desktop-aurora-1.png'),fullPage:true});
  await page.waitForTimeout(5000); // >2 complete flow cycles, not a one-shot pulse
  await page.screenshot({path:path.join(artifacts,'desktop-aurora-6.png'),fullPage:true});
  assert.equal(await page.locator('.reminder-item[data-id="red"]').evaluate(n=>getComputedStyle(n).animationName),'aurora-flow, aurora-glow');
  // IME and language preserve the actual editor node, text, focus/caret, and scroll on calibration.
  await page.locator('.cal-bar[data-reminder-event="green"]').click();
  await input.focus(); await input.fill('中文 composing');
  await input.dispatchEvent('compositionstart');
  await page.evaluate(()=>window.__editorNode=document.querySelector('.detail-reminder textarea'));
  await page.locator('#lang-toggle').click();
  assert.equal(await page.evaluate(()=>window.__editorNode===document.querySelector('.detail-reminder textarea')),true);
  assert.equal(await input.inputValue(),'中文 composing');
  await input.dispatchEvent('compositionend'); await input.blur(); await settle(page);
  assert.equal((await view(page,'green')).note,'中文 composing');
  assert.match(await page.locator('.detail-reminder .reminder-time').innerText(),/Started globally/);
  assert.equal(await page.locator('[data-ai-region]').count(),5);
  assert((await page.locator('[data-ai-region]').allTextContents()).every(s=>!/[\u3400-\u9fff]/.test(s)),'all five rich regions use the real English overlay');
  await page.locator('#lang-toggle').click();
  assert.deepEqual(await page.locator('[data-ai-region]').allTextContents(),zhRegionText);
  await page.locator('#lang-toggle').click();
  assert.equal(await input.inputValue(),'中文 composing','personal notes are not translated');
  await input.focus(); await input.evaluate(n=>n.setSelectionRange(2,4));
  await page.locator('#event-detail').evaluate(n=>n.scrollTop=140);
  const scroll = await page.locator('#event-detail').evaluate(n=>n.scrollTop);
  await tick(page,open+1);
  assert.equal(await input.evaluate(n=>document.activeElement===n),true);
  assert.deepEqual(await input.evaluate(n=>[n.selectionStart,n.selectionEnd]),[2,4]);
  assert.equal(await page.locator('#event-detail').evaluate(n=>n.scrollTop),scroll);
  // Explicit cancellation warns about note deletion; rejecting retains it.
  page.once('dialog',d=>d.dismiss()); await page.locator('.detail-reminder .reminder-star').click();
  await settle(page);
  assert.equal((await view(page,'green')).flagged,true);
  await page.locator('#detail-close').click();
  // Viewer IANA changes do not change reminder boundaries.
  await session.send('Emulation.setTimezoneOverride',{timezoneId:'America/Los_Angeles'}); await tick(page,open+1);
  assert.match(await page.locator('.reminder-item[data-id="green"] .reminder-time').innerText(),/America\/Los_Angeles/);
  assert.equal((await view(page,'green')).active,true);
  await session.send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Hong_Kong'});
  // Reduced motion remains loud/static, with no movement.
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await animationTarget.evaluate(n=>getComputedStyle(n).animationName),'none');
  assert.match(await animationTarget.evaluate(n=>getComputedStyle(n).backgroundImage),/linear-gradient/);
  await page.screenshot({path:path.join(artifacts,'reduced-motion.png'),fullPage:true});
  await page.emulateMedia({reducedMotion:'no-preference'});
  // Narrow-screen panel expands in flow, track chooser/fallback remains safe, controls clickable.
  await page.setViewportSize({width:390,height:844});
  await page.locator('#reminder-panel').evaluate(n=>n.open=false); await page.evaluate(()=>window.scrollTo(0,0));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(artifacts,'phone-calendar-0.png'),fullPage:true});
  await page.waitForTimeout(3200); await page.screenshot({path:path.join(artifacts,'phone-calendar-3.png'),fullPage:true});
  await page.locator('.raid-day-trigger[data-reminder-event="raid"]').first().click();
  assert.equal(await page.locator('.raid-day-option').count(),2); assert.equal(await page.locator('.raid-day-option.reminder-active').count(),1);
  await page.locator('.raid-day-option').last().click(); assert.equal(await page.locator('.detail-reminder').count(),0);
  await page.locator('#detail-close').click();
  await page.locator('.raid-day-trigger[data-reminder-event~="raid-forms"]').first().click();
  await page.locator('.raid-day-option[data-reminder-event="raid-forms"]').click();
  assert.equal(await page.locator('.detail-reminder').getAttribute('data-id'),'raid-forms');
  assert.equal(await page.locator('#detail-body .mon-row img').count(),2);
  await page.locator('#detail-close').click();
  await page.evaluate(()=>window.scrollTo(0,0)); await page.locator('#reminder-panel>summary').click();
  const layout = await page.evaluate(()=>({panel:document.querySelector('.reminder-sidebar').getBoundingClientRect().bottom,calendar:document.querySelector('#calendar').getBoundingClientRect().top}));
  assert(layout.calendar>layout.panel,'expanded panel must push the dates down rather than cover them');
  await page.screenshot({path:path.join(artifacts,'phone-panel-0.png')});
  await page.evaluate(()=>window.scrollBy(0,250));
  assert.equal(await page.locator('.reminder-sidebar').evaluate(n=>getComputedStyle(n).position),'static','expanded mobile panel must not stick over dates');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.waitForTimeout(3200); await page.screenshot({path:path.join(artifacts,'phone-panel-3.png')});
  assert.equal(await page.locator('#reminder-live .reminder-item').first().evaluate(n=>getComputedStyle(n).animationName),'aurora-flow, aurora-glow');
  await page.locator('#reminder-live .reminder-item[data-id="red"] .reminder-done').click();
  await settle(page);
  assert.equal((await view(page,'red')).completed,true); assert.equal(await activeCopies(page,'red'),0);
  assert.equal(await animationTarget.evaluate(n=>getComputedStyle(n).animationName),'none');
  assert.equal(await animationTarget.evaluate(n=>n.classList.contains('ft')),true,'admin featured styling is preserved');
  assert.equal(await animationTarget.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(200, 93, 78)','restore original category background');
  // Background pause and a forward jump cleans up on foreground, not via tick accumulation.
  await page.evaluate(()=>{window.__testHidden=true;document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await page.locator('body.reminders-paused').count(),1);
  assert((await page.locator('.reminder-item.reminder-active').first().evaluate(n=>getComputedStyle(n).animationPlayState)).split(',').every(s=>s.trim()==='paused'));
  await page.evaluate(time=>window.__testNow=time,close-1);
  await page.evaluate(()=>{window.__testHidden=false;document.dispatchEvent(new Event('visibilitychange'));return reminderScheduler.wake();});
  assert.equal((await view(page,'green')).flagged,true);
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await tick(page,close-1);
  assert.equal(await page.locator('body.reminders-paused').count(),0,'pageshow resumes CSS even without visibilitychange');
  await tick(page,close);
  assert.equal(await page.evaluate(()=>reminders.get('green')),null);
  assert.equal(await page.evaluate(prefix=>localStorage.getItem(prefix+'green'),prefix),null);
  assert.equal(await page.locator('.reminder-item[data-id="green"]').count(),0);
  await page.locator('.cal-bar[data-reminder-event="green"]').click();
  assert.equal(await page.locator('.detail-reminder .reminder-star').isDisabled(),true);
  await page.locator('#detail-close').click();
  step = 'storage-sync';
  // Same-origin storage events: delete while another tab has a pending note, and no whole-table loss.
  await page.setViewportSize({width:1440,height:1050}); await tick(page,open+1);
  await flag(page,'green');
  const other = await context.newPage(); await other.goto(origin); await ready(other); await tick(other,open+1);
  assert.equal((await view(other,'green')).flagged,true);
  await page.locator('.cal-bar[data-reminder-event="green"]').click();
  await input.fill('draft that must not revive');
  await other.evaluate(async()=>{const r=reminders.get('green');await reminders.remove('green',r.token);await reminderScheduler.wake();});
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>reminders.get('green')),null);
  assert.equal(await page.evaluate(prefix=>localStorage.getItem(prefix+'green'),prefix),null);
  await page.locator('#detail-close').click();
  step = 'real-web-lock-contention';
  // Real same-origin pages share localStorage AND the browser's LockManager.
  // Queue both operations behind a third page, then release externally (no lock-holder deadlock).
  await flag(page,'green');
  await other.evaluate(()=>reminderScheduler.wake());
  const raceToken = await page.evaluate(()=>reminders.get('green').token);
  const holder = await context.newPage(); await holder.goto(origin); await ready(holder);
  const hold = async () => {
    await holder.evaluate(prefix=>{
      window.__held=false;
      window.__holding=navigator.locks.request(prefix,async()=>{
        window.__held=true; await new Promise(resolve=>window.__release=resolve);
      });
    },prefix);
    await holder.waitForFunction(()=>window.__held);
  };
  await hold();
  await page.evaluate(token=>{
    window.__raceDone=false;
    window.__race=reminders.note('green','contending old note',token).then(r=>{window.__raceDone=true;return r;});
  },raceToken);
  await holder.waitForFunction(async prefix=>(await navigator.locks.query()).pending.length >= 1,prefix);
  await other.evaluate(token=>{
    window.__deleteDone=false;
    window.__delete=reminders.remove('green',token).then(r=>{window.__deleteDone=true;return r;});
  },raceToken);
  await holder.waitForFunction(async()=>(await navigator.locks.query()).pending.length >= 2);
  assert.equal(await page.evaluate(()=>window.__raceDone),false);
  assert.equal(await other.evaluate(()=>window.__deleteDone),false);
  await holder.evaluate(()=>window.__release());
  assert((await page.evaluate(()=>window.__race)).persisted);
  assert((await other.evaluate(()=>window.__delete)).persisted);
  await page.evaluate(()=>reminderScheduler.wake()); await other.evaluate(()=>reminderScheduler.wake());
  assert.equal(await page.evaluate(prefix=>localStorage.getItem(prefix+'green'),prefix),null);
  assert.equal((await view(page,'green')).flagged,false);
  await other.evaluate(async()=>{await reminders.star('green');await reminders.note('green','new token note',reminders.get('green').token);});
  assert.equal((await page.evaluate(token=>reminders.note('green','obsolete autosave',token),raceToken)).ok,false);
  assert.equal(await page.evaluate(()=>reminders.get('green').note),'new token note');
  // Closing the lock holder releases it; no lease/stale lock file to recover.
  await hold();
  await page.evaluate(()=>{window.__afterClose=reminders.note('green','after holder closes',reminders.get('green').token);});
  await holder.waitForFunction(async()=>(await navigator.locks.query()).pending.length >= 1);
  await holder.close();
  assert((await page.evaluate(()=>window.__afterClose)).persisted);
  // Browser AbortSignal bounds a queued acquisition; releasing later cannot run the canceled write.
  await other.evaluate(prefix=>{
    window.__timeoutHeld=false;
    window.__timeoutHolding=navigator.locks.request(prefix,async()=>{
      window.__timeoutHeld=true; await new Promise(resolve=>window.__timeoutRelease=resolve);
    });
  },prefix);
  await other.waitForFunction(()=>window.__timeoutHeld);
  const timedOut = await page.evaluate(()=>reminders.note('green','must not write after timeout',reminders.get('green').token));
  assert.equal(timedOut.reason,'locking'); assert.equal(timedOut.persisted,false);
  await other.evaluate(()=>window.__timeoutRelease());
  await page.evaluate(()=>reminderScheduler.wake());
  assert.equal(await page.evaluate(()=>reminders.get('green').note),'after holder closes');
  // A held lock must not make a note look saved; failure keeps the editor draft and retry is explicit.
  await page.locator('.cal-bar[data-reminder-event="green"]').click();
  await page.evaluate(()=>{
    window.__realLocks=navigator.locks;
    Object.defineProperty(navigator,'locks',{configurable:true,value:{request:()=>Promise.reject(new Error('mock lock denial'))}});
  });
  await input.fill('retained after lock failure'); await input.blur(); await settle(page);
  assert.match(await page.locator('.reminder-save').innerText(),/Not saved/);
  assert.match(await page.locator('.detail-reminder .reminder-warning').innerText(),/cross-tab storage lock/);
  assert.notEqual(await page.evaluate(()=>reminders.get('green').note),'retained after lock failure');
  await page.evaluate(()=>Object.defineProperty(navigator,'locks',{configurable:true,value:window.__realLocks}));
  await input.focus(); await input.blur(); await settle(page);
  assert.equal(await page.evaluate(()=>reminders.get('green').note),'retained after lock failure');
  await page.locator('#detail-close').click();
  await other.evaluate(()=>reminders.remove('green',reminders.get('green').token));
  await page.evaluate(()=>reminderScheduler.wake());
  // An unsupported environment is read-only and explicitly warns, not an unsafe fallback.
  const unsupported = await context.newPage();
  await unsupported.addInitScript(()=>Object.defineProperty(navigator,'locks',{value:undefined}));
  await unsupported.goto(origin); await ready(unsupported);
  assert.equal((await unsupported.evaluate(()=>reminders.star('green'))).ok,false);
  assert.match(await unsupported.locator('#reminder-notice').innerText(),/Web Locks/);
  assert.equal(await unsupported.evaluate(prefix=>localStorage.getItem(prefix+'green'),prefix),null);
  await unsupported.close();
  await other.evaluate(async()=>{await reminders.note('blue','other-tab note',reminders.get('blue').token);await reminderScheduler.wake();});
  await page.waitForFunction(()=>reminders.get('blue')?.note==='other-tab note');
  assert.equal(await page.locator('.reminder-item[data-id="blue"] .reminder-note-preview').innerText(),'other-tab note');
  await other.evaluate(()=>reminders.setEvents(state.events.map(e=>e.id==='blue' ? {...e,end:'2026-10-25T17:00:00'} : e),state.en.events));
  await page.waitForFunction(()=>reminders.get('blue')?.time.end==='2026-10-25T17:00:00');
  await other.close();
  step = 'canonical-reloads';
  // Failed reload must not redeclare this old tab's times over the newer successful snapshot.
  failEvents=true; await page.evaluate(()=>loadData()); failEvents=false;
  assert.equal(await page.evaluate(()=>reminders.get('blue').time.end),'2026-10-25T17:00:00');
  assert.equal((await view(page,'blue')).active,true);
  canonical=[]; await page.evaluate(()=>loadData());
  assert.equal((await view(page,'blue')).active,true);
  await tick(page,Date.parse('2027-05-01T00:00:00Z'));
  assert.equal(await page.evaluate(()=>reminders.get('blue')),null);
  assert.equal(await page.evaluate(()=>reminders.get('partial')?.note),'');
  assert.equal(await page.evaluate(()=>reminders.get('unknown')?.note),'');
  canonical=events;
  step = 'storage-rejection';
  // Storage rejection is isolated from TODO and still works in this session.
  await tick(page,open+1); await page.evaluate(()=>loadData());
  await page.evaluate(prefix=>{
    const real=Storage.prototype.setItem;
    Storage.prototype.setItem=function(k,v){if(k.startsWith(prefix)) throw new DOMException('quota','QuotaExceededError');return real.call(this,k,v);};
  },prefix);
  await flag(page,'green'); assert.equal((await view(page,'green')).active,true);
  assert.match(await page.locator('#reminder-notice').innerText(),/not persisted/);
  assert.equal(await page.evaluate(prefix=>localStorage.getItem(prefix+'green'),prefix),null);
  assert.equal(await page.evaluate(()=>localStorage.getItem('pogo-todo')),todoBefore);
  await page.reload(); await ready(page); assert.equal((await view(page,'green')).flagged,false);
  step = 'existing-views';
  // Existing TODO clicks, Atlas, World Clock and shiny/admin markers still operate.
  await page.locator('#main-tabs [data-view="todo"]').click();
  assert.equal(await page.locator('.todo-acct input').count(),2);
  assert.equal(await page.locator('.todo-acct input').nth(1).inputValue(),todoFixture.accounts[1].name);
  assert.equal(await page.locator('.todo-check').last().isChecked(),true);
  const checkbox=page.locator('.todo-check').first(); await checkbox.check();
  await page.locator('.todo-acct input').first().fill('Fixture account');
  assert.equal(await checkbox.isChecked(),true);
  await page.locator('#main-tabs [data-view="spots"]').click(); assert((await page.locator('.spots-card').count())>0);
  await page.locator('#main-tabs [data-view="clock"]').click(); assert((await page.locator('.wc-list').first().innerText()).length>0);
  await page.locator('#main-tabs [data-view="calendar"]').click();
  assert.equal(await page.locator('.cal-bar[data-reminder-event="red"].ft').count(),1);
  assert.equal(await page.locator('.cal-bar[data-reminder-event="green"] .hl-star').count(),1);
  assert.equal(await page.locator('button button').count(),0);
  assert.deepEqual(errors,[]);
  assert.equal(JSON.stringify(events),originalEvents,'UI must not mutate canonical fixture');
  fs.writeFileSync(path.join(artifacts,'result.json'),JSON.stringify({status:'PASS',viewports:['1440x1050','390x844'],cycles:'desktop >6s / mobile calendar+sidebar >6s',pageErrors:errors},null,2)+'\n');
  console.log('test-event-reminders-browser: PASS (Chromium desktop/390px, aurora cycles+geometry, all calendar entrances, completion/reload/locale/IME/focus, hidden +N, fallback, real same-origin Web Locks contention/holder-close/unsupported, storage sync, expiry/failure/retention, TODO/Atlas/Clock)');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{clearTimeout(deadline);if(browser) await browser.close();server.close();});
