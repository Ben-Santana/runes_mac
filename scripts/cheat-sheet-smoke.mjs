import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5190');
 await page.evaluate(()=>localStorage.clear());await page.reload();
 await page.getByRole('button',{name:/^Edit Tap index shortcut/}).click();
 await page.getByRole('button',{name:'Runes actions',exact:true}).click();
 await page.getByRole('menuitem',{name:'Profile cheat sheet',exact:true}).click();
 await page.reload();
 assert.equal(await page.locator('.app-action-cap').first().innerText(),'Profile cheat sheet');
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('runes.profiles.v1')));
 assert.equal(saved.profiles[0].assignments.find(a=>a.id==='tap-index').appAction.type,'show-cheat-sheet');
 // Customize through the action cap, save per profile, then reload.
 await page.evaluate(()=>{const saved=JSON.parse(localStorage.getItem('runes.profiles.v1'));saved.profiles[0].assignments.find(a=>a.id==='tap-middle').shortcut={key:'C',modifiers:['command']};saved.profiles[0].assignments.find(a=>a.id==='tap-middle').enabled=true;saved.profiles.push({id:'other',name:'Other',assignments:saved.profiles[0].assignments});localStorage.setItem('runes.profiles.v1',JSON.stringify(saved));});
 await page.reload();
 const openEditor=()=>page.getByRole('button',{name:/^Edit Tap index shortcut/}).click();
 await openEditor();
 await page.getByRole('dialog',{name:'Profile cheat sheet',exact:true}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:/^Description for/}).count(),1);
 await page.getByRole('textbox',{name:'Description for Tap middle',exact:true}).fill('Copy selection');
 await page.getByRole('button',{name:'Preview cheat sheet',exact:true}).click();
 assert.equal(await page.getByRole('dialog').getByRole('textbox').count(),0);
 assert.match(await page.locator('.cheat-sheet-editor-preview').innerText(),/Copy selection/);
 await page.getByRole('button',{name:'Edit descriptions',exact:true}).click();
 await page.getByRole('button',{name:'Reset descriptions',exact:true}).click();
 assert.equal(await page.getByRole('textbox',{name:'Description for Tap middle',exact:true}).inputValue(),'');
 await page.getByRole('textbox',{name:'Description for Tap middle',exact:true}).fill('Copy selection');
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});const box=await page.getByRole('dialog').boundingBox();assert(box.x>=0&&box.x+box.width<=width);await page.screenshot({path:`/tmp/cheat-sheet-editor-${width}.png`});}
 await page.getByRole('button',{name:'Save descriptions',exact:true}).click();
 await page.reload();await openEditor();
 assert.equal(await page.getByRole('textbox',{name:'Description for Tap middle',exact:true}).inputValue(),'Copy selection');
 await page.getByRole('textbox',{name:'Description for Tap middle',exact:true}).fill('Unsaved');
 await page.keyboard.press('Escape');await openEditor();
 assert.equal(await page.getByRole('textbox',{name:'Description for Tap middle',exact:true}).inputValue(),'Copy selection');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 const customized=await page.evaluate(()=>JSON.parse(localStorage.getItem('runes.profiles.v1')));
 assert.equal(customized.profiles[0].cheatSheetDescriptions['tap-middle'],'Copy selection');
 assert.equal(customized.profiles[1].cheatSheetDescriptions?.['tap-middle'],undefined);
 await openEditor();await page.getByRole('textbox',{name:'Description for Tap middle',exact:true}).fill('');await page.getByRole('button',{name:'Save descriptions',exact:true}).click();
 await openEditor();assert.equal(await page.getByRole('textbox',{name:'Description for Tap middle',exact:true}).inputValue(),'');
 await page.getByRole('button',{name:'Change shortcut',exact:true}).click();
 assert.equal(await page.getByRole('dialog').count(),0);await page.keyboard.press('Escape');
 await page.addInitScript(()=>{const listeners=new Set();window.commands=[];window.band={send(c){window.commands.push(c);if(c.action==='cheat_sheet_present'){const panel=document.querySelector('.cheat-sheet');window.presentedSurface={top:panel.getBoundingClientRect().top,clip:getComputedStyle(panel).clipPath};queueMicrotask(()=>listeners.forEach(fn=>fn({kind:'cheat_sheet_open'})));}if(c.action==='cheat_sheet_close')queueMicrotask(()=>listeners.forEach(fn=>fn({kind:'cheat_sheet_dismiss'})));},onMessage(fn){listeners.add(fn);return()=>listeners.delete(fn);}};window.emitBand=m=>listeners.forEach(fn=>fn(m));});
 await page.goto('http://127.0.0.1:5190/?cheat-sheet');
 const emit=m=>page.evaluate(m=>window.emitBand(m),m);
 const assignments=[{id:'tap-index',enabled:true,appAction:{type:'show-cheat-sheet'}},{id:'combo-one',enabled:true,steps:[{gesture:'hold-index'},{gesture:'rotation',axis:'y',direction:'left'},{gesture:'release-index'}],shortcut:{key:'C',modifiers:['command']}},{id:'tap-middle',enabled:false,appAction:{type:'type-text',text:'hello'}}];
 await emit({kind:'cheat_sheet_state',profileName:'Work',profiles:[],notchHeight:32,assignments});
 await page.waitForFunction(()=>window.presentedSurface);
 const painted=await page.evaluate(()=>window.presentedSurface);
 assert.equal(painted.top,0);assert.match(painted.clip,/^path\(/);
 assert.equal(await page.getByRole('listitem').count(),2);
 await page.getByRole('heading',{name:'Work',exact:true}).waitFor();
 assert.match(await page.locator('.cheat-sheet-gestures').first().innerText(),/Y left/);
 assert.equal(await page.getByText('Disabled',{exact:true}).count(),1);
 await emit({kind:'cheat_sheet_state',profileName:'Work',profiles:[],notchHeight:32,assignments,descriptions:{'combo-one':'Copy selection'}});
 await page.getByText('Copy selection',{exact:true}).waitFor();
 assert.equal(await page.locator('.cheat-sheet-original-output .keycaps').count(),1);

 for(const width of [680,390]){
  await page.setViewportSize({width,height:600});
  await page.locator('.cheat-sheet').evaluate(async e=>{while(e.getAnimations().some(a=>a.playState==='running')){await Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{})));await new Promise(requestAnimationFrame);}});
  await page.screenshot({path:`/tmp/cheat-sheet-${width}.png`});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await emit({kind:'cheat_sheet_state',profileName:'Personal',profiles:[],notchHeight:32,assignments:Array.from({length:40},(_,i)=>({...assignments[1],id:`combo-${i}`}))});
 assert.equal(await page.getByRole('listitem').count(),40);
 assert(await page.locator('.cheat-sheet-rows').evaluate(e=>e.scrollHeight>e.clientHeight));
 await emit({kind:'cheat_sheet_state',profileName:'Empty',profiles:[],notchHeight:32,assignments:[assignments[0]]});
 await page.getByText('No other shortcuts configured for this profile.').waitFor();
 await page.getByRole('button',{name:'Close cheat sheet'}).click();
 await page.waitForFunction(()=>window.commands.at(-1).action==='cheat_sheet_closed');
 const collapsed=await page.locator('.cheat-sheet').evaluate(e=>getComputedStyle(e).clipPath);
 assert.notEqual(collapsed,'inset(0px round 0px 0px 22px 22px)');
 // A native repeat gesture uses the same animated dismissal path.
 await page.reload();
 await emit({kind:'cheat_sheet_state',profileName:'Work',profiles:[],notchHeight:32,notchWidth:200,notchCenter:195,assignments});
 await page.locator('.cheat-sheet').evaluate(async e=>{while(e.getAnimations().some(a=>a.playState==='running')){await Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{})));await new Promise(requestAnimationFrame);}});
 await emit({kind:'cheat_sheet_dismiss'});
 await page.waitForFunction(()=>window.commands.at(-1).action==='cheat_sheet_closed');
 await page.reload();
 await emit({kind:'cheat_sheet_state',profileName:'Work',profiles:[],notchHeight:32,assignments});
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>window.commands.at(-1).action==='cheat_sheet_closed');

 assert.deepEqual(errors,[]);
 console.log('Cheat sheet: action persistence, profile updates, filtering, disabled mappings, scrolling, empty state, dismissal and responsive layout passed.');
}finally{await browser.close();}
