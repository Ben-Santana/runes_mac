import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1100,height:850}});
 await page.goto('http://127.0.0.1:5190');
 await page.evaluate(()=>localStorage.setItem('runes.profiles.v1',JSON.stringify({activeId:'a',profiles:[{id:'a',name:'Source',assignments:[{id:'tap-index',shortcut:{key:'K',modifiers:['command']},enabled:true},{id:'combo-shared',steps:[{gesture:'hold-index'},{gesture:'swipe-left'}],intervalMs:500,shortcut:{key:'J',modifiers:[]},enabled:true}]},{id:'b',name:'Other',assignments:[]}]})));
 await page.reload();
 const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('runes.profiles.v1')));
 const share=async(id)=>{await page.locator(`[data-assignment-id="${id}"]`).click({button:'right'});await page.getByRole('menuitem',{name:'Use in all profiles',exact:true}).click();};
 page.once('dialog',d=>d.accept());await share('tap-index');
 let state=await saved();assert.deepEqual(state.sharedIds,['tap-index']);assert.ok(state.profiles.every(p=>p.assignments.find(a=>a.id==='tap-index').shortcut.key==='K'));
 await page.getByRole('button',{name:'Add profile',exact:true}).click();await page.getByRole('button',{name:'Use music icon',exact:true}).click();
 await page.reload();assert.equal(await page.locator('[data-assignment-id="tap-index"]').getByRole('img',{name:'Present in all profiles'}).count(),1);
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Remove Tap index shortcut',exact:true}).click();
 assert.equal((await saved()).sharedIds.length,1);
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Remove Tap index shortcut',exact:true}).click();
 state=await saved();assert.equal(state.sharedIds.length,0);assert.equal(state.profiles.find(p=>p.id===state.activeId).assignments.find(a=>a.id==='tap-index').shortcut,null);assert.ok(state.profiles.filter(p=>p.id!==state.activeId).every(p=>p.assignments.find(a=>a.id==='tap-index').shortcut.key==='K'));
 await page.getByRole('button',{name:'Source',exact:true}).click();
 page.once('dialog',d=>d.accept());await share('combo-shared');
 state=await saved();assert.ok(state.profiles.every(p=>p.assignments.some(a=>a.id==='combo-shared')));
 await page.screenshot({path:'/tmp/shared-profiles.png'});
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Delete Combo 1',exact:true}).click();assert.ok((await saved()).sharedIds.includes('combo-shared'));
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Delete Combo 1',exact:true}).click();state=await saved();assert.ok(!state.sharedIds.includes('combo-shared'));assert.ok(state.profiles.filter(p=>p.id!=='a').every(p=>p.assignments.some(a=>a.id==='combo-shared')));
 console.log('Shared profiles: assignment propagation, new profiles, persistence, cancel/confirm, and combos passed.');
}finally{await browser.close();}
