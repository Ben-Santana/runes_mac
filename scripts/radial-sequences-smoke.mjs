import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1200,height:900},reducedMotion:'reduce'});
 page.setDefaultTimeout(6000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:5190');
 await page.getByRole('button',{name:/^Edit Tap index shortcut/}).click();
 await page.getByRole('button',{name:'Runes actions',exact:true}).click();
 await page.getByRole('menuitem',{name:/Radial menu/}).click();
 const dialog=page.getByRole('dialog',{name:'Radial menu editor',exact:true});
 const button=name=>dialog.getByRole('button',{name,exact:true});
 const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('runes.assignments.v1')).find(a=>a.id==='tap-index').appAction.items[0].output);
 await button('Add radial item').click();
 await page.keyboard.press('Meta+k');
 await button('Add action to radial item 1').click();
 await page.keyboard.press('Meta+c');
 await button('Add action to radial item 1').click();
 await button('macOS actions').click();
 await page.getByRole('menuitem',{name:'Volume up',exact:true}).click();
 await button('Save radial menu').click();
 assert.deepEqual((await saved()).actions.map(step=>step.type),['shortcut','shortcut','macos-action']);
 await page.reload();
 await page.getByRole('button',{name:/^Edit Tap index shortcut/}).click();
 await button('Edit radial item 1').click();
 await button('Edit sequence step 2').click();
 await page.keyboard.press('Meta+v');
 await button('Edit radial item 1').click();
 await button('Edit sequence step 3').click();
 await button('Move sequence step earlier').click();
 for(const width of [1200,768,390]){
  await page.setViewportSize({width,height:900});
  const rect=await dialog.locator('.adjust-action-toolbar').boundingBox();
  assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width&&rect.y+rect.height<=900,JSON.stringify({width,rect}));
  await page.screenshot({path:`/tmp/radial-sequence-${width}.png`});
 }
 await button('Cancel right action').click();
 await button('Save radial menu').click();
 const output=await saved();
 assert.equal(output.actions[0].shortcut.key,'K');
 assert.equal(output.actions[1].action,'volume-up');
 assert.equal(output.actions[2].shortcut.key,'V');
 await page.getByRole('button',{name:/^Edit Tap index shortcut/}).click();
 await button('Edit radial item 1').click();
 await button('Remove sequence step').click();
 await button('Remove sequence step').click();
 await button('Cancel right action').click();
 await button('Save radial menu').click();
 assert.equal((await saved()).type,'shortcut');
 assert.equal((await saved()).shortcut.key,'V');
 assert.deepEqual(errors,[]);
 console.log('Radial sequences: mixed steps, persistence, individual editing, reordering, removal, and responsive layout passed.');
}catch(error){const page=browser.contexts()[0]?.pages()[0];if(page)await page.screenshot({path:'/tmp/radial-sequence-failure.png'});throw error;}finally{await browser.close();}
