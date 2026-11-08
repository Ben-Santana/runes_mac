import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:80,height:80}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const listeners=new Set();window.commands=[];window.airNotes=0;const Original=window.AudioContext;window.AudioContext=class extends Original{createOscillator(){window.airNotes++;return super.createOscillator();}};
  const defaults={runInBackground:false,airCursorOverlay:false,floatingComboViewer:false,compactRadialMenus:false,keepRadialMenuOpen:false,radialMenuFollowsMouse:false,notchComboViewerSides:'both',openAtLogin:false,loginAvailable:false};
  window.band={send:c=>window.commands.push(c),onMessage:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},getSettings:async()=>({...defaults,...JSON.parse(localStorage.getItem('test-settings')||'{}')}),updateSettings:async update=>{const next={...defaults,...JSON.parse(localStorage.getItem('test-settings')||'{}'),...update};localStorage.setItem('test-settings',JSON.stringify(next));return next;}};
  window.emitAir=m=>listeners.forEach(fn=>fn(m));
 });
 await page.goto('http://127.0.0.1:5190/?air-cursor');await page.waitForFunction(()=>window.commands.some(c=>c.action==='air_preview_ready'));
 const emit=message=>page.evaluate(message=>window.emitAir(message),message);
 assert.equal(await page.getByRole('img').count(),0);
 assert.equal(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
 await emit({kind:'air_preview',active:true,attemptId:'a',points:[[0,0],[.2,0],[.2,.2]]});
 const svg=page.getByRole('img',{name:'Live air gesture stroke'});await svg.waitFor();
 await page.locator('.air-cursor-motion').evaluate(async element=>{await Promise.all(element.getAnimations().map(animation=>animation.finished));});
 assert.equal(await page.locator('.air-cursor-motion').evaluate(element=>getComputedStyle(element).transform),'matrix(1, 0, 0, 1, 0, 0)');
 assert.equal(await svg.locator('circle').first().getAttribute('fill'),'#242424');
 assert.equal(await svg.locator('path').getAttribute('d'),'M120.00,120.00 L152.00,120.00 L152.00,152.00');
 assert.equal(await svg.evaluate(e=>getComputedStyle(e).pointerEvents),'none');
 // Native windows from before a renderer update can still be larger than 80px.
 // In every host size, the circle center must coincide with the window center.
 for(const size of [80,240,320]){
  await page.setViewportSize({width:size,height:size});
  const box=await svg.boundingBox();
  assert.equal(box.width,80);assert.equal(box.height,80);
  assert.ok(Math.abs(box.x+box.width/2-size/2)<.01);
  assert.ok(Math.abs(box.y+box.height/2-size/2)<.01);
 }
 await page.setViewportSize({width:80,height:80});

 await page.screenshot({path:'/tmp/air-cursor-preview.png',omitBackground:true});
 await emit({kind:'air_preview',active:true,attemptId:'a',points:[[0,0],[1,1]]});
 let d=await svg.locator('path').getAttribute('d');assert.match(d,/M120.00,120.00/);
 const end=d.split('L')[1].split(',').map(Number);assert.ok(Math.hypot(end[0]-120,end[1]-120)<88.02);
 await emit({kind:'air_preview',active:true,attemptId:'a',points:[[0,0],[.2,0]]});
 assert.notEqual(await svg.locator('path').getAttribute('d'),'M120.00,120.00 L152.00,120.00','View never zooms back in mid-attempt');
 await emit({kind:'air_preview',active:true,attemptId:'b',points:[[0,0],[.2,0]]});
 assert.equal(await svg.locator('path').getAttribute('d'),'M120.00,120.00 L152.00,120.00','New attempt resets initial scale');
 await emit({kind:'air_preview',active:false});await svg.locator('path').waitFor({state:'detached'});assert.equal(await svg.count(),1,'Keep only the circle mounted during retraction');
 assert.equal(await page.locator('.air-cursor-motion').evaluate(element=>element.tagName),'DIV','Composite the entire SVG as one HTML layer');
 await svg.waitFor({state:'hidden'});
 await emit({kind:'air_preview',active:true,attemptId:'c',points:[[0,0]]});await svg.waitFor();
 await emit({kind:'state',state:'disconnected'});await svg.waitFor({state:'hidden'});
 // Results fill from the center regardless of the sound preference.
 const result=page.getByRole('img',{name:'Air gesture succeeded'});
 await emit({kind:'air_preview',active:true,attemptId:'win',resultId:'win',result:'success',points:[[0,0],[.2,0]]});await result.waitFor();
 assert.equal(await result.getAttribute('width'),'80');assert.equal(await result.getAttribute('height'),'80');
 assert.equal(await result.locator('.air-cursor-fill').getAttribute('fill'),'#c57aee');
 assert.equal(await result.locator('path').count(),0,'Clear the stroke at the result, before the hold and retraction');
 assert.equal(await page.evaluate(()=>window.airNotes),2);
 await emit({kind:'air_preview',active:true,attemptId:'win',resultId:'win',result:'success',points:[[0,0],[.2,0]]});assert.equal(await page.evaluate(()=>window.airNotes),2,'One sound per result');
 await page.waitForTimeout(260);await page.screenshot({path:'/tmp/air-cursor-success.png',omitBackground:true});
 await emit({kind:'air_preview',active:true,attemptId:'fail',resultId:'fail',result:'failure',points:[[0,0],[.2,0]]});
 const failure=page.getByRole('img',{name:'Air gesture failed'});await failure.waitFor();assert.equal(await failure.locator('.air-cursor-fill').getAttribute('fill'),'#fff');assert.equal(await page.evaluate(()=>window.airNotes),4);
 await page.waitForTimeout(260);await page.screenshot({path:'/tmp/air-cursor-failure.png',omitBackground:true});
 await page.evaluate(()=>localStorage.setItem('runes.sounds.v1',JSON.stringify({airOn:false})));
 await emit({kind:'air_preview',active:true,attemptId:'muted',resultId:'muted',result:'success',points:[[0,0]]});await result.waitFor();assert.equal(await result.locator('.air-cursor-fill').getAttribute('fill'),'#c57aee');assert.equal(await page.evaluate(()=>window.airNotes),4);
 await page.evaluate(()=>localStorage.removeItem('runes.sounds.v1'));
 // Settings opt in persists; default remains off.
 await page.setViewportSize({width:1200,height:900});await page.goto('http://127.0.0.1:5190');
 await page.getByRole('button',{name:'Device settings',exact:true}).click();
 const toggle=page.getByRole('switch',{name:'Air gesture cursor preview',exact:true});await toggle.waitFor();
 assert.equal(await toggle.getAttribute('aria-checked'),'false');await toggle.click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test-settings')).airCursorOverlay===true);
 await page.reload();await page.getByRole('button',{name:'Device settings',exact:true}).click();assert.equal(await toggle.getAttribute('aria-checked'),'true');
 await toggle.click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test-settings')).airCursorOverlay===false);
 const sounds=page.getByRole('switch',{name:'Air gesture results',exact:true});assert.equal(await sounds.getAttribute('aria-checked'),'true');await sounds.click();await page.reload();await page.getByRole('button',{name:'Device settings',exact:true}).click();assert.equal(await sounds.getAttribute('aria-checked'),'false');
 assert.deepEqual(errors,[]);console.log('Air cursor UI passed: centered origin, solid circle, scale expansion/reset, click-through, hide/disconnect, and opt-in settings persistence.');
}finally{await browser.close();}
