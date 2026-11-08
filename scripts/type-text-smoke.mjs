import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto('http://127.0.0.1:5190');
 await page.evaluate(()=>localStorage.clear());await page.reload();
 const edit=()=>page.getByRole('button',{name:/^Edit Tap index shortcut/ }).click();
 const open=async()=>{await page.getByRole('button',{name:'Runes actions',exact:true}).click();await page.getByRole('menuitem',{name:'Type text',exact:true}).click();};
 await edit();await open();
 await page.getByRole('button',{name:'Save text',exact:true}).isDisabled().then(v=>assert(v));
 const text='  A longer message — café, 漢字, 👋\nSecond line\n\tIndented text\n'.repeat(200);
 await page.getByLabel('Text to type',{exact:true}).fill(text);
 await page.getByRole('button',{name:'Save text',exact:true}).click();
 await page.reload();
 assert.equal(await page.locator('.app-action-cap').first().innerText(),'Type text');
 await edit();await open();
 assert.equal(await page.getByLabel('Text to type',{exact:true}).inputValue(),text);
 await page.getByLabel('Text to type',{exact:true}).fill('unsaved');
 await page.keyboard.press('Escape');
 assert.equal(await page.getByRole('dialog').count(),0);
 await open();assert.equal(await page.getByLabel('Text to type',{exact:true}).inputValue(),text);
 for(const width of [1440,768,390]){
  await page.setViewportSize({width,height:1000});
  const box=await page.getByRole('dialog').boundingBox();assert(box.x>=0&&box.x+box.width<=width);
  await page.screenshot({path:`/tmp/type-text-${width}.png`});
 }
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.keyboard.press('Escape');
 console.log('Type text: long Unicode text, persistence, edit/cancel, keyboard input and responsive dialog passed.');
}finally{await browser.close();}
