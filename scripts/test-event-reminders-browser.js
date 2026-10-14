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
fs.rmSync(path.join(artifacts,'result.json'),{force:true});
const timing = { scope:'global', mode:'local', startPrecision:'exact', endPrecision:'exact' };
function event(id, type, options = {}) {
  return { id, name:`测试 ${id}`, type, start:'2026-10-11T14:00:00', end:'2026-10-11T17:00:00', timing,
    pokemon:[], bonuses:[], counters:[], sections:[], links:[], ...options };
}
const events = [
  event('green', 'community-day', { highlight:true, image:'https://raw.githubusercontent.com/PokeAPI/sprites/master/fixture.png',
    bonuses:Array.from({length:6},(_,i)=>`测试加成 ${i+1}`) }),
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
const overlays = Object.fromEntries(events.map(e => [e.id,{name:`Test ${e.id}`,heading:'Test fixture',summary:'',pokemon:e.pokemon.map(p=>p.name),bonuses:e.bonuses.map((_,i)=>`Test bonus ${i+1}`),counters:[],sections:[]}]));
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
}, 180000);
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
  const flag = async (p,id) => p.evaluate(async id=>{await reminders.star(id);await reminderScheduler.wake();},id);
  const view = (p,id) => p.evaluate(id=>({active:reminders.view(id).active,flagged:reminders.view(id).flagged,completed:reminders.view(id).completed,note:reminders.get(id)?.note}),id);
  const activeCopies = (p,id) => p.locator(`[data-reminder-event~="${id}"].reminder-active`).count();
  const rect = async locator => {
    const box=await locator.boundingBox(); assert(box,'target must be laid out'); return box;
  };
  const overlaps = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
  async function detailGeometry(p) {
    const tag=await rect(p.locator('#detail-body .detail-cat')), star=await rect(p.locator('.detail-reminder-actions .reminder-star'));
    const done=await rect(p.locator('.detail-reminder-actions .reminder-done'));
    assert(Math.abs(tag.y+tag.height/2-star.y-star.height/2)<1,'tag and star share a row');
    assert(Math.abs(star.y-done.y)<1,'both icons share a row');
    assert.equal(await p.locator('.detail-reminder-actions .reminder-star').innerText(),'⭐');
    assert.equal(await p.locator('.detail-reminder-actions .reminder-done').innerText(),'✔');
    for (const button of [star,done]) {
      assert(button.width>=44 && button.height>=44,'keep touch targets');
      for (const other of [tag,await rect(p.locator('#detail-close')),await rect(p.locator('#lang-toggle'))])
        assert(!overlaps(button,other),'icons cannot overlap category, close or language targets');
    }
    const image=p.locator('#detail-body .detail-img');
    if(await image.count()) assert((await rect(image)).y>=star.y+star.height,'image stays below the compact toolbar');
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  async function desktopLayout(width) {
    step='desktop-layout-'+width;
    await page.setViewportSize({width,height:1050}); await page.evaluate(()=>window.scrollTo(0,0));
    await page.locator('#cal-prev').focus(); await page.mouse.move(20,160);
    const body=page.locator('.reminder-panel-body'), entry=page.locator('#reminder-panel>summary');
    assert.equal(await body.isVisible(),false,'desktop defaults to the small edge tab');
    const before=await rect(page.locator('#calendar'));
    const columns=()=>page.locator('.cal-week').first().locator('.cal-day').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));
    const columnsBefore=await columns();
    assert.equal(await entry.getAttribute('aria-label'),'本地活动提醒 (15)','entry exposes the synchronized count to assistive tech');
    const available=await page.locator('main').evaluate(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {x:r.x+parseFloat(s.paddingLeft),width:r.width-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)};});
    assert(Math.abs(before.width-available.width)<1,'calendar must use the entire original container width (no reserved column)');
    assert(Math.abs(before.x-available.x)<1,'calendar stays at the original container left edge');
    const tab=await rect(entry); assert(tab.width<110,'no full-width desktop title bar');
    assert(Math.abs(tab.x+tab.width-width)<1,'tab touches the viewport right edge');
    // The invisible part of the fixed sidebar must not intercept calendar input.
    assert.equal(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('#calendar'),{x:before.x+before.width-45,y:before.y+90}),true);
    await page.screenshot({path:path.join(artifacts,`desktop-${width}-collapsed.png`)});
    await entry.hover(); assert.equal(await body.isVisible(),true,'entry hover opens panel');
    const panel=await rect(body); assert(panel.y+panel.height<=1050,'long list is bounded by viewport');
    const first=await rect(page.locator('#reminder-live .reminder-open').first());
    await page.mouse.move(first.x+first.width/2,first.y+first.height/2,{steps:12});
    assert.equal(await body.isVisible(),true,'crossing from entry to list must not collapse it');
    assert.deepEqual(await rect(page.locator('#calendar')),before,'hover expansion must not resize or move the calendar');
    assert.deepEqual(await columns(),columnsBefore,'all seven columns keep their widths and positions');
    const scrollBefore=await page.evaluate(()=>scrollY);
    await page.mouse.wheel(0,440); await page.waitForFunction(()=>document.querySelector('.reminder-panel-body').scrollTop>0);
    assert.equal(await page.evaluate(()=>scrollY),scrollBefore,'list scroll is internal');
    assert.equal(await body.isVisible(),true,'scrolling must not close panel');
    assert.equal(await body.evaluate(n=>n.scrollWidth<=n.clientWidth),true,'no horizontal scrollbar inside panel');
    await page.screenshot({path:path.join(artifacts,`desktop-${width}-expanded.png`)});
    await page.mouse.move(20,160); assert.equal(await body.isVisible(),false,'leaving the region closes panel');
    assert.deepEqual(await rect(page.locator('#calendar')),before,'collapse must not move the calendar either');
    await page.locator('.cal-main').locator('button,a[href]').last().focus(); await page.keyboard.press('Tab');
    assert.equal(await entry.evaluate(n=>document.activeElement===n),true,'edge entry is in native tab order');
    assert.equal(await body.isVisible(),true,'keyboard focus opens panel');
    await page.keyboard.press('Tab');
    assert.equal(await body.evaluate(n=>n.contains(document.activeElement)),true,'Tab enters panel actions');
    await page.mouse.move(20,160); assert.equal(await body.isVisible(),true,'focus keeps the panel open after mouse leaves');
    await page.locator('#cal-prev').focus(); assert.equal(await body.isVisible(),false,'focus and mouse both leaving closes it');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
  }
  await page.goto(origin); await ready(page);
  assert.equal(await page.locator('[data-init-error]').count(),0);
  assert.equal(await page.locator('.reminder-panel-body').isVisible(),false,'desktop initially collapsed');
  const todoBefore = await page.evaluate(()=>localStorage.getItem('pogo-todo'));
  assert.deepEqual(JSON.parse(todoBefore),todoFixture,'existing multi-account TODO must not be reseeded');
  const zhRegionText = await page.locator('[data-ai-region]').allTextContents();
  await page.locator('.cal-bar[data-reminder-event="green"]').click();
  await detailGeometry(page);
  assert.equal(await page.locator('.reminder-note-editor').isVisible(),false,'unstarred detail has no empty note card');
  await page.locator('.detail-reminder-actions .reminder-star').hover();
  assert.equal(await page.locator('#reminder-star-tip').innerText(),'标星');
  assert.equal(await page.locator('#reminder-star-tip').isVisible(),true);
  await page.locator('.detail-reminder-actions .reminder-star').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.locator('#reminder-done-tip').innerText(),'请先标星');
  assert.equal(await page.locator('#reminder-done-tip').isVisible(),true,'disabled reason is focus-accessible');
  assert.equal(await page.locator('#reminder-star-tip').isVisible(),false,'only one tooltip at a time');
  await page.keyboard.press('Enter'); await settle(page);
  assert.equal((await view(page,'green')).flagged,false,'unavailable completion cannot bypass the star gate');
  await page.locator('.detail-reminder-actions .reminder-star').click();
  await settle(page);
  assert.equal(await page.locator('.reminder-note-editor').isVisible(),true);
  await page.locator('.detail-reminder-actions .reminder-star').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.locator('#reminder-done-tip').innerText(),'尚未开始');
  await page.keyboard.press('Space'); await settle(page);
  assert.equal((await view(page,'green')).completed,false,'focusable disabled control cannot bypass the time gate');
  assert.equal(await page.locator('.detail-reminder-actions .reminder-done').isDisabled(),true);
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
  assert.equal(await page.locator('.detail-reminder-actions .reminder-done').isDisabled(),false);
  assert.match(await page.locator('.detail-reminder .reminder-time').innerText(),/全球已开始[\s\S]*本地还有[\s\S]*UTC−12[\s\S]*GMT\+8[\s\S]*Asia\/Hong_Kong/);
  await page.locator('.detail-reminder-actions .reminder-done').click();
  await settle(page);
  assert.equal(await activeCopies(page,'green'),0); assert.equal((await view(page,'green')).completed,true);
  assert.equal(await page.locator('.detail-reminder-actions .reminder-done').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.detail-reminder-actions .reminder-done').getAttribute('aria-label'),'撤销完成');
  assert.equal(await input.inputValue(),note,'completion must not delete the note');
  await page.reload(); await ready(page); await tick(page,open+1);
  assert.equal((await view(page,'green')).completed,true); assert.equal(await activeCopies(page,'green'),0);
  await page.locator('#reminder-panel>summary').hover();
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
  await page.locator('.detail-reminder-actions .reminder-star').click();
  await settle(page);
  assert.equal((await view(page,'raid-forms')).flagged,true);
  assert.equal(await page.locator('.detail-reminder-actions .reminder-done').isDisabled(),true);
  await page.locator('#detail-close').click();
  await desktopLayout(1440); await desktopLayout(1920);
  await page.setViewportSize({width:1440,height:1050});
  // Real device-capability changes must not leave a hover-only drawer on a touch desktop.
  // Chromium's CDP cannot restore a fine pointer after disabling touch (it
  // reports pointer:none), so isolate this real capability switch to its own page.
  const touchPage=await context.newPage(); await touchPage.emulateMedia({reducedMotion:'reduce'});
  await touchPage.goto(origin);await ready(touchPage);await tick(touchPage,open+1);
  const touchSession=await context.newCDPSession(touchPage);
  await touchPage.locator('#reminder-panel>summary').hover();
  await touchSession.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await touchPage.waitForFunction(()=>matchMedia('(hover:none) and (pointer:coarse)').matches);
  await touchPage.waitForFunction(()=>!document.querySelector('#reminder-panel').open);
  assert.equal(await touchPage.locator('.reminder-panel-body').isVisible(),false,'capability switch resets open state');
  const tap=async locator=>{const r=await rect(locator);await touchSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height/2}]});await touchSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
  await tap(touchPage.locator('#reminder-panel>summary')); assert.equal(await touchPage.locator('.reminder-panel-body').isVisible(),true,'large touch device can tap to expand');
  await tap(touchPage.locator('#reminder-panel>summary')); assert.equal(await touchPage.locator('.reminder-panel-body').isVisible(),false,'touch device can tap to collapse');
  await tap(touchPage.locator('#reminder-panel>summary'));
  await touchPage.setViewportSize({width:390,height:844});
  await touchPage.waitForFunction(()=>!document.querySelector('#reminder-panel').open);
  await tap(touchPage.locator('#reminder-panel>summary'));
  assert.equal(await touchPage.locator('.reminder-sidebar').evaluate(n=>getComputedStyle(n).position),'static');
  const touchLayout=await touchPage.evaluate(()=>({panel:document.querySelector('.reminder-sidebar').getBoundingClientRect().bottom,calendar:document.querySelector('#calendar').getBoundingClientRect().top}));
  assert(touchLayout.calendar>touchLayout.panel,'touch phone panel stays in flow');
  await touchPage.screenshot({path:path.join(artifacts,'phone-touch-panel.png')});
  await tap(touchPage.locator('.reminder-item[data-id="green"] .reminder-open'));
  await detailGeometry(touchPage);
  await tap(touchPage.locator('.detail-reminder-actions .reminder-done'));await settle(touchPage);
  assert.equal((await view(touchPage,'green')).completed,true,'real touch completion works');
  await tap(touchPage.locator('.detail-reminder-actions .reminder-done'));await settle(touchPage);
  assert.equal((await view(touchPage,'green')).completed,false,'real touch undo works');
  await tap(touchPage.locator('#detail-close'));
  await touchPage.evaluate(()=>openDetail(state.events.find(e=>e.id==='unknown')));
  await tap(touchPage.locator('.detail-reminder-actions .reminder-done'));
  assert.equal(await touchPage.locator('#reminder-done-tip').isVisible(),true,'touch exposes the unavailable reason without hover');
  assert.equal(await touchPage.locator('#reminder-done-tip').innerText(),'开始时间待确认');
  assert.equal((await view(touchPage,'unknown')).completed,false);
  await tap(touchPage.locator('#detail-close'));
  await touchPage.setViewportSize({width:1440,height:1050});
  await touchPage.waitForFunction(()=>!document.querySelector('#reminder-panel').open);
  await touchPage.close();
  await page.locator('#cal-prev').focus(); await page.mouse.move(20,160);
  await page.evaluate(()=>openDetail(state.events.find(e=>e.id==='unknown')));
  await page.locator('.detail-reminder-actions .reminder-star').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.locator('#reminder-done-tip').innerText(),'开始时间待确认');
  assert.equal(await page.locator('#reminder-done-tip').isVisible(),true);
  await page.keyboard.press('Enter');await settle(page);
  assert.equal((await view(page,'unknown')).completed,false,'unknown start still cannot complete');
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
  await page.evaluate(()=>{window.__editorNode=document.querySelector('.detail-reminder textarea');window.__editorNode.setSelectionRange(2,4);});
  for (const locale of ['en','zh-CN']) {
    await page.evaluate(locale=>{state.locale=locale;applyLocale();},locale);
    assert.equal(await input.evaluate(n=>n===window.__editorNode && n===document.activeElement),true,'locale reconstruction retains the focused IME editor');
    assert.deepEqual(await input.evaluate(n=>[n.selectionStart,n.selectionEnd]),[2,4],'locale reconstruction retains caret/selection');
    assert.equal(await input.inputValue(),'中文 composing');
  }
  await page.locator('#lang-toggle').click();
  assert.equal(await page.evaluate(()=>window.__editorNode===document.querySelector('.detail-reminder textarea')),true);
  assert.equal(await input.inputValue(),'中文 composing');
  await detailGeometry(page);
  await page.locator('.detail-reminder-actions .reminder-star').hover();
  assert.equal(await page.locator('#reminder-star-tip').innerText(),'Unstar');
  await page.locator('.detail-reminder-actions .reminder-star').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.locator('#reminder-done-tip').innerText(),'Complete');
  assert.equal(await page.locator('#reminder-done-tip').isVisible(),true);
  assert.equal(await page.locator('#reminder-star-tip').isVisible(),false,'keyboard hint is not overlapped by a stale hover hint');
  await page.screenshot({path:path.join(artifacts,'desktop-detail-icons.png')});
  assert.equal(await page.evaluate(()=>Object.hasOwn(state.ui.en,'reminder.intro') || Object.hasOwn(state.ui['zh-CN'],'reminder.intro')),false);
  assert.equal(await page.locator('.reminder-intro,.reminder-title').count(),0);
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
  page.once('dialog',d=>d.dismiss()); await page.locator('.detail-reminder-actions .reminder-star').click();
  await settle(page);
  assert.equal((await view(page,'green')).flagged,true);
  await page.locator('#detail-close').click();
  // Viewer IANA changes do not change reminder boundaries.
  await session.send('Emulation.setTimezoneOverride',{timezoneId:'America/Los_Angeles'}); await tick(page,open+1);
  await page.locator('#reminder-panel>summary').hover();
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
  await page.locator('#reminder-panel>summary').hover(); // cross breakpoint while actually expanded
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>!document.querySelector('#reminder-panel').open);
  assert.equal(await page.locator('.reminder-panel-body').isVisible(),false,'crossing to mobile resets the desktop panel');
  await page.evaluate(()=>window.scrollTo(0,0));
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
  await page.locator('.cal-bar[data-reminder-event="green"]').click();
  await detailGeometry(page);
  await page.screenshot({path:path.join(artifacts,'phone-detail-icons.png')});
  await page.locator('.detail-reminder-actions .reminder-done').click(); await settle(page);
  assert.equal((await view(page,'green')).completed,true);
  assert.equal(await input.inputValue(),'中文 composing','mobile completion retains notes');
  await page.locator('.detail-reminder-actions .reminder-done').click(); await settle(page);
  assert.equal((await view(page,'green')).completed,false,'mobile can undo');
  await page.locator('#lang-toggle').click(); await detailGeometry(page);
  assert.equal(await page.locator('.detail-reminder-actions .reminder-star').getAttribute('aria-label'),'取消标星');
  await page.locator('#lang-toggle').click();
  await input.focus(); await input.evaluate(n=>n.setSelectionRange(2,4));
  await page.locator('#event-detail').evaluate(n=>n.scrollTop=180);
  assert((await page.locator('#event-detail').evaluate(n=>n.scrollTop))>0,'phone detail still scrolls');
  await page.screenshot({path:path.join(artifacts,'phone-detail-scrolled.png')});
  await page.locator('#detail-close').click(); assert.equal(await page.locator('#event-detail').isVisible(),false,'phone close remains clickable after scrolling');
  await page.evaluate(()=>window.scrollTo(0,0));
  const collapsedCalendar=await rect(page.locator('#calendar'));
  await page.locator('#reminder-panel>summary').click();
  const layout = await page.evaluate(()=>({panel:document.querySelector('.reminder-sidebar').getBoundingClientRect().bottom,calendar:document.querySelector('#calendar').getBoundingClientRect().top}));
  assert(layout.calendar>layout.panel,'expanded panel must push the dates down rather than cover them');
  assert(layout.calendar>collapsedCalendar.y+100,'mobile expansion really changes document flow');
  assert.equal(await page.locator('.reminder-panel-body').evaluate(n=>n.scrollWidth<=n.clientWidth),true,'mobile list has no horizontal scrollbar');
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
  // Do not park a frozen browser clock 1ms from close either: pure fixtures cover ±1ms.
  await page.evaluate(time=>window.__testNow=time,close-60000);
  await page.evaluate(()=>{window.__testHidden=false;document.dispatchEvent(new Event('visibilitychange'));return reminderScheduler.wake();});
  assert.equal((await view(page,'green')).flagged,true);
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await tick(page,close-60000);
  assert.equal(await page.locator('body.reminders-paused').count(),0,'pageshow resumes CSS even without visibilitychange');
  await tick(page,close);
  assert.equal(await page.evaluate(()=>reminders.get('green')),null);
  assert.equal(await page.evaluate(prefix=>localStorage.getItem(prefix+'green'),prefix),null);
  assert.equal(await page.locator('.reminder-item[data-id="green"]').count(),0);
  await page.locator('.cal-bar[data-reminder-event="green"]').click();
  assert.equal(await page.locator('.detail-reminder-actions .reminder-star').isDisabled(),true);
  await page.locator('#detail-close').click();
  step = 'storage-sync';
  // Visual cycles above are already measured. Keep multi-page logic fixtures
  // static on the sandbox's single CPU; this does not change their active classes.
  await page.emulateMedia({reducedMotion:'reduce'});
  // Same-origin storage events: delete while another tab has a pending note, and no whole-table loss.
  await page.setViewportSize({width:1440,height:1050});
  await page.waitForFunction(()=>!document.querySelector('#reminder-panel').open);
  assert.equal(await page.locator('.reminder-panel-body').isVisible(),false,'mobile-to-desktop transition resets the in-flow open state');
  await tick(page,open+1);
  await flag(page,'green');
  const other = await context.newPage(); await other.emulateMedia({reducedMotion:'reduce'}); await other.goto(origin); await ready(other); await tick(other,open+1);
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
  const holder = await context.newPage(); await holder.emulateMedia({reducedMotion:'reduce'}); await holder.goto(origin); await ready(holder);
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
  const unsupported = await context.newPage(); await unsupported.emulateMedia({reducedMotion:'reduce'});
  await unsupported.addInitScript(()=>Object.defineProperty(navigator,'locks',{value:undefined}));
  await unsupported.goto(origin); await ready(unsupported);
  assert.equal((await unsupported.evaluate(()=>reminders.star('green'))).ok,false);
  await unsupported.locator('#reminder-panel>summary').hover();
  assert.match(await unsupported.locator('#reminder-notice').innerText(),/Web Locks/);
  assert.equal(await unsupported.evaluate(prefix=>localStorage.getItem(prefix+'green'),prefix),null);
  await unsupported.close();
  async function uiRegressions() {
    step='ui-regressions';const a=page, b=other;
    for (const p of [a,b]) {
      p.on('dialog',dialog=>dialog.accept());
      // Keep unrelated focus/storage calibration from consuming the precise action barrier.
      await p.evaluate(()=>{reminderScheduler.pause();window.__uiWake=reminderScheduler.wake;reminderScheduler.wake=async()=>{};});
    }
    const show=(p,id)=>p.evaluate(id=>openDetail(state.events.find(e=>e.id===id)),id);
    const sync=async()=>{for(const p of [a,b]) await p.evaluate(()=>refreshReminderUi());};
    async function reset(initial='starred') {
      await a.evaluate(async initial=>{
        const r=reminders.get('green');if(r) await reminders.remove('green',r.token);
        if(initial!=='absent') await reminders.star('green');
        if(initial==='completed') await reminders.complete('green',true,reminders.get('green').token);
      },initial);
      await sync(); await show(a,'green'); await show(b,'green'); await sync();
      await b.evaluate(()=>document.querySelector('#reminder-completed').open=true);
      if(initial!=='absent') await b.locator('#detail-close').click();
    }
    for(const [name,initial,kind,expected] of [
      ['complete','starred','done','completed'],['remove','starred','star','absent'],
      ['undo','completed','done','starred'],['star','absent','star','starred'],
    ]) {
      if(process.env.REMINDER_BROWSER_CASE && process.env.REMINDER_BROWSER_CASE!==name) continue;
      step='ui-'+name;await reset(initial);
      // Gate A's mutation AFTER its refresh. B clicks the unchanged control while
      // A's mutation is queued, so B's refresh necessarily observes A's commit.
      await a.evaluate(prefix=>{
        const manager=navigator.locks;let calls=0;
        window.__gateHeld=false;window.__mutationQueued=false;
        window.__realUiLocks=manager;
        Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(name,options,callback)=>{
          if(++calls===2){
            window.__gate=manager.request(prefix,async()=>{window.__gateHeld=true;await new Promise(resolve=>window.__releaseGate=resolve);});
            window.__mutationQueued=true;
          }
          return manager.request(name,options,callback);
        }}});
      },prefix);
      await a.locator(`.detail-reminder-actions .reminder-${kind}`).click();
      await a.waitForFunction(()=>window.__gateHeld && window.__mutationQueued);
      assert.equal(await a.evaluate(prefix=>{const r=JSON.parse(localStorage.getItem(prefix+'green'));return r?r.completedAt===null?'starred':'completed':'absent';},prefix),initial);
      const selector=initial==='absent'?`.detail-reminder-actions .reminder-${kind}`:`.reminder-item[data-id="green"] .reminder-${kind}`;
      if (initial!=='absent') await b.locator('#reminder-panel>summary').hover();
      await b.locator(selector).click(); await b.waitForFunction(()=>reminderActions.has('green'));
      await a.evaluate(()=>window.__releaseGate());
      for(const p of [a,b]) await p.waitForFunction(()=>reminderActions.size===0);
      await a.evaluate(()=>Object.defineProperty(navigator,'locks',{configurable:true,value:window.__realUiLocks}));
      await sync();
      for(const p of [a,b]) {
        assert.equal(await p.evaluate(prefix=>{const r=JSON.parse(localStorage.getItem(prefix+'green'));return r?r.completedAt===null?'starred':'completed':'absent';},prefix),expected,`${name}/${name} cannot reverse intent`);
        assert.equal((await view(p,'green')).active,expected==='starred');
        assert.equal((await activeCopies(p,'green'))>0,expected==='starred');
        assert.equal(await p.locator('.reminder-item[data-id="green"].reminder-active').count(),expected==='starred'?1:0);
        assert.equal(await p.locator('.detail-reminder-actions .reminder-star').getAttribute('aria-pressed'),String(expected!=='absent'));
      }
    }
    if(!process.env.REMINDER_BROWSER_CASE || process.env.REMINDER_BROWSER_CASE==='token') {
      for(const kind of ['done','star']) {
        step='ui-stale-'+kind;await reset();
        const old=await a.evaluate(()=>reminders.get('green').token);
        await b.evaluate(prefix=>{window.__replaceHeld=false;window.__replaceGate=navigator.locks.request(prefix,async()=>{window.__replaceHeld=true;await new Promise(resolve=>window.__releaseReplace=resolve);});},prefix);
        await b.waitForFunction(()=>window.__replaceHeld);
        await b.evaluate(()=>{window.__removeOld=reminders.remove('green',reminders.get('green').token);window.__starNew=reminders.star('green');});
        await a.locator(`.detail-reminder-actions .reminder-${kind}`).click();await a.waitForFunction(()=>reminderActions.has('green'));
        await b.evaluate(()=>window.__releaseReplace());await b.evaluate(()=>Promise.all([window.__removeOld,window.__starNew]));
        await a.waitForFunction(()=>reminderActions.size===0);await sync();
        const r=await a.evaluate(()=>reminders.get('green'));
        assert.notEqual(r.token,old);assert.equal(r.completedAt,null);assert.equal(r.note,'');
        assert.equal((await view(b,'green')).flagged,true);
      }
      step='ui-expiry';await reset();
      await a.evaluate(time=>{window.__testNow=time;return refreshReminderUi();},close-60000);
      await b.evaluate(prefix=>{window.__expiryHeld=false;window.__expiryGate=navigator.locks.request(prefix,async()=>{window.__expiryHeld=true;await new Promise(resolve=>window.__releaseExpiry=resolve);});},prefix);
      await b.waitForFunction(()=>window.__expiryHeld);
      await a.locator('.detail-reminder-actions .reminder-done').click();await a.waitForFunction(()=>reminderActions.has('green'));
      await a.evaluate(time=>window.__testNow=time,close);await b.evaluate(()=>window.__releaseExpiry());
      await a.waitForFunction(()=>reminderActions.size===0);await sync();
      assert.equal(await a.evaluate(prefix=>localStorage.getItem(prefix+'green'),prefix),null);
      assert.equal(await a.locator('.detail-reminder-actions .reminder-star').isDisabled(),true);
      await a.evaluate(time=>window.__testNow=time,open+1);
    }
    if(!process.env.REMINDER_BROWSER_CASE || process.env.REMINDER_BROWSER_CASE==='draft') {
      step='ui-draft';await reset();
      await a.evaluate(()=>reminders.note('green','saved note',reminders.get('green').token)); await sync();
      await a.evaluate(()=>{
        window.__realUiLocks=navigator.locks;
        Object.defineProperty(navigator,'locks',{configurable:true,value:{request:()=>Promise.reject(Error('lock denied'))}});
      });
      const editor=a.locator('.detail-reminder textarea');
      await editor.fill('unsaved new draft'); await editor.blur(); await a.evaluate(()=>reminderSaver.flushAll());
      assert.equal(await a.evaluate(prefix=>JSON.parse(localStorage.getItem(prefix+'green')).note,prefix),'saved note');
      await show(a,'blue'); await show(a,'green'); await a.evaluate(()=>reminderSaver.flushAll());
      assert.equal(await editor.inputValue(),'unsaved new draft','E→F→E must restore failed draft, not saved note');
      await a.locator('.detail-reminder-actions .reminder-star').click(); await a.waitForFunction(()=>reminderActions.size===0);
      assert.equal(await a.evaluate(()=>reminderSaver.pending('green').note),'unsaved new draft','rejected delete keeps draft');
      await a.evaluate(()=>Object.defineProperty(navigator,'locks',{configurable:true,value:window.__realUiLocks}));
      await editor.focus(); await editor.blur(); await a.evaluate(async()=>{await reminderSaver.flushAll();await refreshReminderUi();});
      assert.equal(await a.evaluate(prefix=>JSON.parse(localStorage.getItem(prefix+'green')).note,prefix),'unsaved new draft');
      assert.match(await a.locator('.reminder-save').innerText(),/Saved/);
      // A real pending flight survives drawer reconstruction; blur must not create a second save.
      await a.evaluate(async()=>{await reminders.note('green','saved note',reminders.get('green').token);await refreshReminderUi();window.__noteCalls=0;const note=reminders.note;window.__baseNote=note;reminders.note=(...args)=>{window.__noteCalls++;return note(...args);};});
      await b.evaluate(prefix=>{window.__draftHeld=false;window.__draftGate=navigator.locks.request(prefix,async()=>{window.__draftHeld=true;await new Promise(resolve=>window.__releaseDraft=resolve);});},prefix);
      await b.waitForFunction(()=>window.__draftHeld);
      await editor.fill('flight new draft'); await editor.blur(); await a.waitForFunction(()=>!!reminderSaver.pending('green')?.flight);
      await show(a,'blue'); await show(a,'green');
      assert.equal(await editor.inputValue(),'flight new draft');
      await editor.focus(); await editor.blur();
      assert.equal(await a.evaluate(()=>window.__noteCalls),1,'drawer/blur reuses the single pending flight');
      assert.doesNotMatch(await a.locator('.reminder-save').innerText(),/Saved/);
      await b.evaluate(()=>window.__releaseDraft());
      await a.evaluate(async()=>{await reminderSaver.flushAll();await refreshReminderUi();});
      assert.equal(await a.evaluate(prefix=>JSON.parse(localStorage.getItem(prefix+'green')).note,prefix),'flight new draft');
      // Cancel/re-star in another page invalidates the failed old-token input.
      await a.evaluate(()=>Object.defineProperty(navigator,'locks',{configurable:true,value:{request:()=>Promise.reject(Error('lock denied'))}}));
      await editor.fill('obsolete token draft'); await editor.blur(); await a.evaluate(()=>reminderSaver.flushAll());
      const oldToken=await a.evaluate(()=>reminders.get('green').token);
      await b.evaluate(async()=>{await reminders.remove('green',reminders.get('green').token);await reminders.star('green');});
      await a.evaluate(()=>Object.defineProperty(navigator,'locks',{configurable:true,value:window.__realUiLocks}));
      await sync(); await show(a,'blue'); await show(a,'green');
      assert.notEqual(await a.evaluate(()=>reminders.get('green').token),oldToken);
      assert.equal(await editor.inputValue(),'');assert.equal(await a.evaluate(()=>!!reminderSaver.pending('green')),false);
      await editor.focus();await editor.blur();await a.evaluate(()=>reminderSaver.flushAll());
      assert.equal(await a.evaluate(prefix=>JSON.parse(localStorage.getItem(prefix+'green')).note,prefix),'');
    }
    await a.evaluate(()=>reminders.remove('green',reminders.get('green')?.token));
    for(const p of [a,b]) await p.evaluate(()=>{reminderScheduler.wake=window.__uiWake;if(window.__baseNote) reminders.note=window.__baseNote;});
    await page.locator('#detail-close').click(); await page.evaluate(()=>reminderScheduler.wake());
  }
  await uiRegressions();
  await other.evaluate(async()=>{await reminders.note('blue','other-tab note',reminders.get('blue').token);await reminderScheduler.wake();});
  await page.waitForFunction(()=>reminders.get('blue')?.note==='other-tab note');
  await page.locator('#reminder-panel>summary').hover();
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
  await page.locator('#reminder-panel>summary').hover();
  assert.match(await page.locator('#reminder-notice').innerText(),/not persisted/);
  assert.equal(await page.evaluate(prefix=>localStorage.getItem(prefix+'green'),prefix),null);
  assert.equal(await page.evaluate(()=>localStorage.getItem('pogo-todo')),todoBefore);
  await page.reload(); await ready(page); assert.equal((await view(page,'green')).flagged,false);
  step = 'existing-views';
  // Existing TODO clicks, Atlas, World Clock and shiny/admin markers still operate.
  await page.locator('#main-tabs [data-view="todo"]').click();
  assert.equal(await page.locator('.reminder-sidebar').isVisible(),false,'sidebar only exists in the calendar view');
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
  fs.writeFileSync(path.join(artifacts,'result.json'),JSON.stringify({status:'PASS',viewports:['1440x1050','1920x1050','390x844'],cycles:'desktop >6s / mobile calendar+sidebar >6s',pageErrors:errors},null,2)+'\n');
  console.log('test-event-reminders-browser: PASS (Chromium 1440/1920/390px, full-width hover/keyboard/touch panel+breakpoints, compact accessible icons, aurora cycles+geometry, all calendar entrances, completion/reload/locale/IME/focus, hidden +N, fallback, same-direction UI clicks/stale commands, failed/in-flight drawer drafts, real same-origin Web Locks contention/holder-close/unsupported, storage sync, expiry/failure/retention, TODO/Atlas/Clock)');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{clearTimeout(deadline);if(browser) await browser.close();server.close();});
