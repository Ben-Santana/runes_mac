import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const count of [0,1,2]){
  const page=await browser.newPage();
  await page.addInitScript(()=>{
   window.commands=[];
   window.band={send:command=>window.commands.push(command),onMessage:callback=>{window.emitBand=callback;return()=>{window.emitBand=null;};}};
  });
  await page.goto(process.env.PREVIEW_URL||'http://127.0.0.1:5190');
  await page.waitForFunction(()=>window.commands.some(c=>c.action==='discover'));
  const scans=await page.evaluate(()=>window.commands.filter(c=>c.action==='discover'));
  assert.equal(scans.length,1,'StrictMode must not scan twice');
  assert.match(scans[0].request_id,/^watch:/);
  assert.equal(scans[0].timeout,3);
  assert.equal(scans[0].quiet,true);
  await page.evaluate(({count,requestId})=>window.emitBand({kind:'devices',request_id:requestId,devices:Array.from({length:count},(_,i)=>({id:`band-${i}`,name:`Meta Band ${i}`}))}),{count,requestId:scans[0].request_id});
  const connects=await page.evaluate(()=>window.commands.filter(c=>c.action==='connect'));
  assert.equal(connects.length,count===1?1:0);
  if(count===1){assert.equal(connects[0].device_id,'band-0');assert.equal(connects[0].quiet,true);await page.evaluate(()=>window.emitBand({kind:'state',state:'connected'}));assert.equal(await page.getByRole('dialog').count(),0);}
  if(count===2)assert.equal(await page.getByRole('dialog').count(),1);
  // A delayed scan result must never override an explicit choice to explore the demo.
  await page.reload();await page.waitForFunction(()=>window.commands.some(c=>c.action==='discover'));
  await page.getByRole('button',{name:'Manage connection'}).click();
  await page.getByRole('dialog').waitFor();
  await page.getByText('More options',{exact:true}).click();
  await page.getByRole('button',{name:'Explore the demo'}).click();
  await page.evaluate(()=>window.emitBand({kind:'devices',request_id:'watch:1',devices:[{id:'late-band',name:'Meta Band'}]}));
  assert.equal(await page.evaluate(()=>window.commands.filter(c=>c.action==='connect').length),0);
  await page.close();
 }
 console.log('Startup passed: one scan, zero/one/multiple bands, auto-connect, selection dialog, and stale-result cancellation.');
} finally {await browser.close();}
