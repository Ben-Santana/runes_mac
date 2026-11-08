import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
// Startup asks the bridge for iPhone link status and never scans for, or connects to, the band.
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const state of ['unpaired','searching','connected','away']){
  const page=await browser.newPage();
  await page.addInitScript(()=>{
   window.commands=[];window.listeners=[];
   window.band={send:command=>window.commands.push(command),onMessage:callback=>{window.listeners.push(callback);return()=>{};}};
  });
  await page.goto(process.env.PREVIEW_URL||'http://127.0.0.1:5190');
  await page.waitForFunction(()=>window.commands.some(c=>c.action==='phone_status'));
  await page.evaluate(state=>window.listeners.forEach(cb=>cb({kind:'phone_link',state,phone:state==='unpaired'?null:'iPhone',phones:state==='unpaired'?[]:[{id:'a',name:'iPhone'}]})),state);
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(()=>window.commands.filter(c=>['discover','connect','enroll','identities'].includes(c.action)).length),0,'No band scan or connection');
  assert.equal(await page.getByRole('dialog').count(),state==='unpaired'?1:0,'Only first run shows the pairing code');
  await page.close();
 }
 console.log('Startup passed: status request only, no band discovery, pairing code only when unpaired.');
} finally {await browser.close();}
