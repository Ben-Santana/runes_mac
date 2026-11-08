import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto('http://127.0.0.1:5190');await page.evaluate(()=>localStorage.clear());await page.reload();
 // Hold across telemetry renders: a single release must save the first press.
 await page.getByRole('button',{name:'Edit Swipe left shortcut',exact:true}).click();
 await page.keyboard.down('s');await page.waitForTimeout(1200);await page.keyboard.up('s');
 assert.equal(await page.locator('.is-recording').count(),0);
 assert.deepEqual(await page.locator('.assignment-row').filter({has:page.getByRole('heading',{name:'Swipe left',exact:true})}).locator('kbd').allTextContents(),['S']);
 await page.getByRole('button',{name:'Edit Swipe right shortcut',exact:true}).click();
 await page.keyboard.down('Meta');await page.keyboard.down('a');await page.waitForTimeout(1200);
 await page.keyboard.up('a');assert.equal(await page.locator('.is-recording').count(),1);
 await page.keyboard.up('Meta');assert.equal(await page.locator('.is-recording').count(),0);
 await page.getByRole('button',{name:'Edit Tap index shortcut',exact:true}).click();await page.keyboard.press('Meta+a');
 await page.getByRole('button',{name:'Add action to Tap index',exact:true}).click();await page.keyboard.press('Meta+c');
 await page.getByRole('button',{name:'Add action to Tap index',exact:true}).click();await page.keyboard.press('Backspace');
 const row=page.locator('.assignment-row').filter({has:page.getByRole('heading',{name:'Tap index',exact:true})});
 assert.equal(await row.locator('.action-step').count(),3);
 await page.reload();assert.equal(await row.locator('.action-step').count(),3);
 await row.locator('.action-step button').first().focus();await page.keyboard.press('Alt+ArrowRight');
 assert.equal(await row.locator('.action-step').first().getAttribute('data-tooltip'),'Command + C');
 await page.getByRole('button',{name:'Add action to Tap index',exact:true}).click();
 await page.getByRole('button',{name:'Runes actions',exact:true}).click();
 assert.equal(await page.getByRole('menuitem',{name:'Desktop profile picker',exact:false}).isDisabled(),true);
 await page.locator('h1').click();
 await page.getByRole('button',{name:'Add action to Tap index',exact:true}).click();
 await page.getByRole('button',{name:'macOS actions',exact:true}).click();await page.getByRole('menuitem',{name:'Toggle mute',exact:true}).click();
 assert.equal(await row.locator('.action-step').count(),4);
 assert.equal(await row.locator('.action-step').last().innerText(),'');
 await row.locator('.action-step').last().hover();
 await page.screenshot({path:'/tmp/action-sequence.png'});
 await page.getByRole('button',{name:'Remove Tap index action 4',exact:true}).click();
 assert.equal(await row.locator('.action-step').count(),3);
 console.log('Sequence creation, persistence, reordering, mixed functions, picker exclusion, and removal passed.');
}finally{await browser.close();}
