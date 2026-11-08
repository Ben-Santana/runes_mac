import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1450,height:1100}});
 await page.addInitScript(()=>{
  let saved=false;window.credentialActions=[];
  window.band={send:()=>{},onMessage:()=>()=>{},getSettings:async()=>({runInBackground:false,openAtLogin:false,loginAvailable:true}),metaCredentials:async request=>{window.credentialActions.push(request.action);if(request.action==='save')saved=true;if(request.action==='forget')saved=false;return {saved};}};
 });
 await page.goto('http://127.0.0.1:5190');
 await page.getByRole('button',{name:'Device settings',exact:true}).click();
 const toggle=page.getByRole('switch',{name:'Save Meta password on this Mac'});
 await toggle.waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'false');
 await toggle.click();
 await page.getByLabel('Meta email or phone number',{exact:true}).fill('test@example.invalid');
 await page.getByLabel('Meta password',{exact:true}).fill('fake-test-password');
 await page.getByRole('button',{name:'Save to Keychain',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-labelledby="meta-save-label"]').getAttribute('aria-checked')==='true');
 assert.equal(await page.locator('input[type=password]').count(),0);
 await page.screenshot({path:'/tmp/runes-meta-settings.png',fullPage:true});
 await page.getByRole('button',{name:'Forget Meta password',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-labelledby="meta-save-label"]').getAttribute('aria-checked')==='false');
 assert.deepEqual(await page.evaluate(()=>window.credentialActions.filter(a=>a!=='status')),['save','forget']);
 console.log('Meta settings passed: opt-in, save, input removal, forget.');
}finally{await browser.close();}
