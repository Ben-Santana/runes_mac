import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import fs from 'node:fs';
// iPhone link UI with a mocked bridge: first-run pairing, menu-style status, removal. Never a direct band connection.
const url=process.env.PREVIEW_URL||'http://127.0.0.1:5190';
const output=process.env.SMOKE_OUTPUT||'/private/tmp/runes-phone-link-ui';
fs.mkdirSync(output,{recursive:true});
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.commands=[];window.listeners=[];
  window.emitBand=m=>window.listeners.forEach(cb=>cb(m));
  window.band={send:c=>window.commands.push(c),onMessage:cb=>{window.listeners.push(cb);return()=>{window.listeners=window.listeners.filter(x=>x!==cb);};},getSettings:async()=>({runInBackground:true,openAtLogin:true,loginAvailable:true}),metaCredentials:async()=>({saved:false})};
  window.confirm=()=>true;
 });
 await page.goto(url);
 await page.waitForFunction(()=>window.commands.some(c=>c.action==='phone_status'));
 const emit=m=>page.evaluate(m=>window.emitBand(m),m);
 // First run: the pairing code, with one instruction.
 await emit({kind:'phone_link',state:'unpaired',phone:null,phones:[]});
 await emit({kind:'phone_pairing',text:'RUNESMAC1:x',image:pixel,expires:Date.now()/1000+120});
 const pairing=page.getByRole('dialog');
 await pairing.getByText('Open Runes on your iPhone and scan this code.').waitFor();
 assert.equal(await pairing.locator('img').count(),1);
 for(const width of [1440,768,390]){
  await page.setViewportSize({width,height:900});await page.waitForTimeout(100);
  const box=await pairing.locator('img').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width,'Code fits the window');
  await page.screenshot({path:`${output}/pairing-${width}.png`});
 }
 await page.setViewportSize({width:1440,height:1000});
 // Paired and connected: pairing never shows again.
 const phones=[{id:'11111111-1111-1111-1111-111111111111',name:'Ben’s iPhone'}];
 await emit({kind:'phone_pairing',text:null});
 await emit({kind:'phone_link',state:'connected',phone:'Ben’s iPhone',phones});
 await emit({kind:'state',state:'connected'});
 await pairing.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Device settings',exact:true}).click();
 await page.getByText('Connected to iPhone').first().waitFor();
 for(const gone of ['Show iPhone QR code','Sign in with Meta again','Manage connection','Disconnect','Scan again','Reconnect band'])
  assert.equal(await page.getByRole('button',{name:gone,exact:true}).count(),0,`${gone} is gone`);
 for(const [state,text] of [['away','iPhone not nearby'],['open_app','Open Runes on iPhone once'],['connected','Connected to iPhone']]){
  await emit({kind:'phone_link',state,phone:'Ben’s iPhone',phones});
  await page.locator('.settings-panel').getByText(text,{exact:true}).waitFor();
 }
 await page.screenshot({path:`${output}/settings-connected.png`});
 await page.getByRole('button',{name:'Pair another iPhone'}).click();
 assert.deepEqual(await page.evaluate(()=>window.commands.filter(c=>c.action==='phone_pair').at(-1)),{action:'phone_pair',show:true});
 await page.getByRole('button',{name:'Remove',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.commands.filter(c=>c.action==='phone_forget').at(-1)),{action:'phone_forget',id:phones[0].id});
 // EMG and raw-data features are hidden and say why.
 await page.getByRole('button',{name:/Open device test/}).click();
 const tabs=await page.getByRole('tab').allTextContents();
 assert.deepEqual(tabs,['Event inspector','Gesture inspector','Air gestures']);
 await page.getByText(/need a direct band connection/).waitFor();
 assert.ok(await page.evaluate(()=>window.commands.some(c=>c.action==='motion_view'&&c.enabled===true)),'Test views ask for motion');
 assert.equal(await page.evaluate(()=>window.commands.filter(c=>['discover','connect','enroll','identities'].includes(c.action)).length),0,'The Mac never contacts the band');
 assert.deepEqual(errors,[]);
 console.log('Phone link UI passed: first-run code, status texts, no band controls, add/remove iPhone, EMG views hidden; screenshots in '+output);
}finally{await browser.close();}
