import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1200,height:900},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.band={send:c=>window.lastCommand=c,onMessage:cb=>{window.deliver=cb;return()=>{};},getSettings:async()=>({runInBackground:false,compactRadialMenus:localStorage.getItem('compact')==='true',loginAvailable:false,openAtLogin:false}),updateSettings:async s=>{localStorage.setItem('compact',String(s.compactRadialMenus));return {...s,runInBackground:false,loginAvailable:false,openAtLogin:false};}};
 });
 await page.goto('http://127.0.0.1:5190');
 await page.getByRole('button',{name:'Device settings',exact:true}).click();
 await page.locator('.radial-settings > summary').click();
 const toggle=page.getByRole('switch',{name:'Icons-only radial menus',exact:true});
 await toggle.click();await page.waitForFunction(()=>localStorage.getItem('compact')==='true');
 await page.reload();await page.getByRole('button',{name:'Device settings',exact:true}).click();
 await page.locator('.radial-settings > summary').click();
 assert.equal(await toggle.getAttribute('aria-checked'),'true');
 await page.goto('http://127.0.0.1:5190/?profile-picker');await page.setViewportSize({width:160,height:160});
 const profiles=[{id:'home',name:'Home',icon:'home'},{id:'work',name:'Work',icon:'work'}];
 const items=[{id:'key',output:{key:'K',modifiers:['command']}},{id:'volume',output:{type:'macos-action',action:'volume-up'}},{id:'profile',output:{type:'change-profile',profileId:'work'}}];
 await page.evaluate(({profiles,items})=>{window.deliver({kind:'picker_state',state:{compact:true,profiles,radialItems:items,selected:1,angle:0}});}, {profiles,items});
 await page.locator('.compact-picker').waitFor();
 assert.equal((await page.getByRole('dialog').innerText()).trim(),'');
 assert.equal(await page.locator('.picker-tile svg').count(),3);
 const tile=await page.locator('.picker-tile').first().boundingBox();assert.equal(tile.width,28);
 await page.screenshot({path:'/tmp/runes-compact-radial.png'});
 await page.locator('.picker-tile').first().click();assert.equal((await page.evaluate(()=>window.lastCommand)).profileId,'key');
 await page.evaluate(profiles=>window.deliver({kind:'picker_state',state:{compact:true,profiles,selected:0,angle:0}}),profiles);
 await page.getByRole('dialog',{name:'Desktop profile picker',exact:true}).waitFor();
 assert.equal((await page.getByRole('dialog').innerText()).trim(),'');
 assert.equal(await page.locator('.picker-help').count(),0);
 await page.evaluate(profiles=>window.deliver({kind:'picker_state',state:{compact:false,profiles,selected:0,angle:0}}),profiles);
 await page.locator('.picker-help').waitFor();
 assert.equal(await page.locator('.picker-help').count(),1);
 assert.deepEqual(errors,[]);
 console.log('Compact radial menus: settings persist, icons only, small tiles, selection, profile picker, and standard mode passed.');
}finally{await browser.close();}
