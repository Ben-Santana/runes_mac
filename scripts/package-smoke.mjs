import {_electron as electron} from 'playwright-core';
import assert from 'node:assert/strict';
const app=await electron.launch({executablePath:'release/dmg/Runes.app/Contents/MacOS/Runes',args:[]});
try {
 const page=await app.firstWindow();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:'Runes home'}).waitFor();
 assert.equal(await page.locator('.brand svg.lucide-hand').count(),1);
 assert.equal(await page.locator('.brand').innerText(),'');
 await page.waitForTimeout(8000);
 await page.screenshot({path:'docs/packaged-hand-logo.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('Packaged UI loaded with hand logo.');
 const text=await page.locator('body').innerText(); assert.ok(!text.includes('ModuleNotFoundError'),text); console.log(text);
} finally {await app.close();}
