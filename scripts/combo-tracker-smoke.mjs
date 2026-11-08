import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const listeners=new Set();
  window.band={send(){},onMessage(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
  window.emitBand=message=>listeners.forEach(fn=>fn(message));
  localStorage.setItem('runes.assignments.v1',JSON.stringify([{id:'combo-live',enabled:false,shortcut:null,intervalMs:500,steps:[{gesture:'hold-index'},{gesture:'release-index'},{gesture:'swipe-left'}]}]));
 });
 await page.goto('http://127.0.0.1:5190');
 await page.getByText('Make a gesture',{exact:true}).waitFor();
 const emit=message=>page.evaluate(message=>window.emitBand(message),message);
 for(const [index,gesture] of ['swipe-up','tap-middle','rotation','movement','hold-index','release-index'].entries()){
  await emit({kind:'gesture_input',input:{id:index+1,gesture,...(['rotation','movement'].includes(gesture)?{axis:'x'}:{})}});
 }
 assert.equal(await page.getByRole('listitem').count(),5);
 assert.deepEqual(await page.getByRole('listitem').allTextContents().then(()=>page.getByRole('listitem').evaluateAll(items=>items.map(i=>i.getAttribute('aria-label')))),['Tap middle','rotation','movement','Tap and hold index','release index']);
 await emit({kind:'combo_progress',candidates:[{id:'combo-live',attemptId:'combo-live:5',inputIds:[5,6],holding:false,remainingMs:400}]});
 await page.getByText('Combo 1 · considering',{exact:true}).waitFor();
 assert.equal(await page.locator('.stream-input.considered').count(),2);
 await page.locator('.input-stream').evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})));});
 await page.screenshot({path:'docs/combo-stream.png'});
 const before=await page.locator('.stream-slot').last().getAttribute('style');
 await emit({kind:'gesture_input',input:{id:7,gesture:'swipe-left'}});
 assert.equal(await page.getByRole('listitem').count(),5);
 assert.notEqual(await page.locator('.stream-slot').nth(3).getAttribute('style'),before);
 await emit({kind:'combo_outcome',id:'combo-live',attemptId:'combo-live:5',inputIds:[5,6,7],status:'success',reason:'Combo complete'});
 await page.getByText('Combo 1 complete',{exact:true}).waitFor();
 assert.equal(await page.locator('.stream-input.success').count(),3);
 await page.locator('.input-stream').evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})));});
 await page.screenshot({path:'docs/combo-stream-success.png'});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'docs/combo-stream-mobile.png'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await emit({kind:'gesture_input',input:{id:8,gesture:'hold-index'}});
 await emit({kind:'combo_progress',candidates:[{id:'combo-live',attemptId:'combo-live:8',inputIds:[8],holding:true,remainingMs:null}]});
 await page.getByText('Combo 1 · holding',{exact:true}).waitFor();
 await emit({kind:'combo_outcome',id:'combo-live',attemptId:'combo-live:8',inputIds:[8],status:'failure',reason:'Released early'});
 await page.getByText('Combo 1 · Released early',{exact:true}).waitFor();
 assert.equal(await page.locator('.stream-input.failure').count(),1);
 await emit({kind:'state',state:'disconnected'});
 await page.getByText('Make a gesture',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('Passed: last five inputs, stream movement, exact attempt highlights, success/failure, hold, disconnect, mobile layout.');
}finally{await browser.close();}
