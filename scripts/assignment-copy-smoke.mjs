import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1200,height:900}});
 page.setDefaultTimeout(6000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5190');
 await page.evaluate(()=>{const shortcut={key:'K',modifiers:['command']};localStorage.setItem('runes.profiles.v1',JSON.stringify({activeId:'a',profiles:[{id:'a',name:'Source',assignments:[{id:'tap-index',shortcut,enabled:true},{id:'combo-source',steps:[{gesture:'hold-index'},{gesture:'swipe-left'}],intervalMs:500,shortcut,enabled:true}]},{id:'b',name:'Destination',assignments:[{id:'combo-dest',steps:[{gesture:'hold-index'},{gesture:'swipe-left'}],intervalMs:1000,shortcut:{key:'J',modifiers:[]},enabled:true}]}]}));});
 await page.reload();
 const row=id=>page.locator(`[data-assignment-id="${id}"]`);
 const menu=()=>page.getByRole('menu',{name:'Gesture assignment actions'});
 await row('tap-index').click({button:'right'});await menu().getByRole('menuitem',{name:'Copy',exact:true}).click();
 await page.getByRole('button',{name:'Destination',exact:true}).click({button:'right'});await page.getByRole('menu',{name:'Profile actions'}).getByRole('menuitem',{name:'Paste',exact:true}).click();
 await page.getByRole('button',{name:'Destination',exact:true}).click();
 assert.deepEqual(await row('tap-index').locator('kbd').allTextContents(),['⌘','K']);
 await row('tap-index').click({button:'right'});await menu().getByRole('menuitem',{name:'Delete',exact:true}).click();assert.equal(await row('tap-index').getByRole('button',{name:'Remove Tap index shortcut',exact:true}).count(),0);
 await page.getByRole('button',{name:'Source',exact:true}).click();
 await row('combo-source').click({button:'right'});await menu().getByRole('menuitem',{name:'Copy',exact:true}).click();
 await page.getByRole('button',{name:'Destination',exact:true}).click();
 page.once('dialog',d=>d.dismiss());await row('combo-dest').click({button:'right'});await menu().getByRole('menuitem',{name:'Paste',exact:true}).click();assert.deepEqual(await row('combo-dest').locator('kbd').allTextContents(),['J']);
 page.once('dialog',d=>d.accept());await row('combo-dest').click({button:'right'});await menu().getByRole('menuitem',{name:'Paste',exact:true}).click();assert.deepEqual(await row('combo-dest').locator('kbd').allTextContents(),['⌘','K']);assert.equal(await page.locator('[data-assignment-id^="combo-"]').count(),1);
 await row('combo-dest').click({button:'right'});await menu().getByRole('menuitem',{name:'Delete',exact:true}).click();assert.equal(await row('combo-dest').count(),0);
 await page.getByRole('button',{name:'Edit Tap index shortcut',exact:true}).click();await page.getByRole('button',{name:'Runes actions',exact:true}).click();await page.getByRole('menuitem',{name:'Radial menu',exact:false}).click();await page.getByRole('button',{name:'Add radial item',exact:true}).click();await page.keyboard.press('Meta+k');await page.getByRole('textbox',{name:'Name for radial item 1'}).fill('Open library');
 await page.screenshot({path:'/tmp/named-radial-editor.png'});await page.getByRole('button',{name:'Save radial menu',exact:true}).click();await page.reload();await page.getByRole('button',{name:/^Edit Tap index shortcut/}).click();assert.equal(await page.getByRole('textbox',{name:'Name for radial item 1'}).inputValue(),'Open library');
 for(const width of [1200,768,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:`/tmp/named-radial-${width}.png`});const r=await page.getByRole('textbox',{name:'Name for radial item 1'}).boundingBox();assert.ok(r.x>=0&&r.x+r.width<=width);}
 assert.deepEqual(errors,[]);
 const overlay=await browser.newPage();await overlay.addInitScript(()=>{window.band={send(){},onMessage(fn){window.emitBand=fn;return()=>{};}};});await overlay.goto('http://127.0.0.1:5190/?combo-viewer');await overlay.getByRole('complementary').waitFor();await overlay.evaluate(()=>window.emitBand({kind:'radial_name',name:'Open library'}));await overlay.locator('.notch-radial-name').waitFor();assert.equal(await overlay.locator('.notch-radial-name').innerText(),'Open library');await overlay.evaluate(()=>window.emitBand({kind:'radial_name',name:''}));assert.equal(await overlay.locator('.notch-radial-name').count(),0);
 console.log('Assignment copy, replacement/cancel, combo matching, delete, radial names and notch display passed.');
}finally{await browser.close();}
