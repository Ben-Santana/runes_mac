import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright-core';
import {MIN_RADIAL_GAP,moveRadialItem,spaceRadialItems,radialAngles} from '../dist-electron/radial-layout.js';
const assertGaps=items=>{const angles=radialAngles(items).sort((a,b)=>a-b);if(angles.length>1)angles.forEach((angle,index)=>assert.ok((angles[index+1]??angles[0]+Math.PI*2)-angle>=MIN_RADIAL_GAP-1e-7));};
for(let count=2;count<=8;count++){let items=spaceRadialItems(Array.from({length:count},(_,index)=>({id:String(index),angle:0})));assertGaps(items);for(let step=0;step<300;step++){items=moveRadialItem(items,String(step%count),step*1.173);assertGaps(items);}}
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1200,height:900}});page.setDefaultTimeout(6000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 // Serve the production build inside Playwright; no listening development server.
 await page.route('http://radial.test/**',async route=>{const pathname=new URL(route.request().url()).pathname;const path=resolve('dist',pathname==='/'?'index.html':pathname.slice(1));if(!path.startsWith(resolve('dist')+'/'))return route.abort();try{await route.fulfill({body:await readFile(path),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.woff':'font/woff','.svg':'image/svg+xml'})[extname(path)]??'application/octet-stream'});}catch{await route.abort();}});
 await page.addInitScript(()=>{if(localStorage.getItem('runes.profiles.v1'))return;localStorage.setItem('runes.profiles.v1',JSON.stringify({activeId:'a',profiles:[{id:'a',name:'Test',assignments:[{id:'tap-index',enabled:true,shortcut:null,appAction:{type:'radial-menu',items:['A','B','C'].map((key,index)=>({id:String(index),output:{type:'shortcut',shortcut:{key,modifiers:[]}}}))}}]}]}));});
 await page.goto('http://radial.test/');
 const open=async()=>page.getByRole('button',{name:/^Edit Tap index shortcut/}).click();await open();
 const position=async index=>page.getByRole('button',{name:`Edit radial item ${index}`,exact:true}).evaluate(el=>{const r=el.getBoundingClientRect(),orbit=document.querySelector('.radial-orbit').getBoundingClientRect();return {x:r.x+r.width/2-orbit.x-orbit.width/2,y:r.y+r.height/2-orbit.y-orbit.height/2};});
 await page.getByRole('button',{name:'Edit radial item 1',exact:true}).click();
 const options=page.getByRole('dialog',{name:'Radial item options'});await options.waitFor();
 await options.getByRole('textbox',{name:'Name for radial item 1'}).fill('Library');
 await options.getByRole('button',{name:'Choose icon for radial item 1'}).click();await page.getByRole('button',{name:'Use star icon',exact:true}).click();
 for(const width of [1200,768,390]){await page.setViewportSize({width,height:900});await page.waitForFunction(()=>{const r=document.querySelector('.radial-item-menu').getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight;});await page.screenshot({path:`/tmp/radial-dropdown-${width}.png`});}
 await page.setViewportSize({width:1200,height:900});
 await options.getByRole('button',{name:'Edit action',exact:true}).click();await page.keyboard.press('Meta+k');
 await page.getByRole('button',{name:'Edit radial item 1',exact:true}).click();await options.getByRole('button',{name:'Add action',exact:true}).click();await page.keyboard.press('Meta+j');
 await page.getByRole('button',{name:'Edit radial item 1',exact:true}).click();assert.equal(await options.getByRole('textbox').inputValue(),'Library');await page.keyboard.press('Escape');assert.equal(await options.count(),0);assert.equal(await page.getByRole('dialog',{name:'Radial menu editor',exact:true}).count(),1);
 const first=await position(1),second=await position(2),third=await position(3);assert.ok(Math.abs(first.x)<1&&first.y<0);assert.ok(second.x>0&&third.x<0&&Math.abs(second.y-third.y)<1);
 const arcLength=await page.locator('.radial-drag-line').first().evaluate(path=>path.getTotalLength());assert.ok(Math.abs(arcLength/49-Math.PI/2)<.01);
 const handle=page.getByRole('button',{name:'Move radial item 1',exact:true});const bounds=await handle.locator('.radial-drag-line').boundingBox();const grip=await handle.locator('.radial-drag-line').evaluate(path=>{const point=path.getPointAtLength(path.getTotalLength()/2).matrixTransform(path.getScreenCTM());return {x:point.x,y:point.y};});const orbit=await page.locator('.radial-orbit').boundingBox();
 assert.ok(Math.abs(Math.hypot(grip.x-(orbit.x+orbit.width/2+first.x),grip.y-(orbit.y+orbit.height/2+first.y))-49)<1,'Arc sits 8px outside its option');
 await page.mouse.move(grip.x,grip.y);await page.mouse.down();await page.mouse.move(orbit.x+orbit.width,orbit.y+orbit.height/2,{steps:12});await page.mouse.up();
 const moved=await position(1);assert.ok(moved.x>100&&moved.y<0);assert.ok(Math.hypot(moved.x-second.x,moved.y-second.y)>94);
 await page.getByRole('button',{name:'Save radial menu',exact:true}).click();await page.reload();await open();const restored=await position(1);assert.ok(Math.abs(restored.x-moved.x)<1&&Math.abs(restored.y-moved.y)<1);
 await page.getByRole('button',{name:'Move radial item 1',exact:true}).focus();await page.keyboard.press('ArrowRight');const keyboard=await position(1);assert.ok(Math.hypot(keyboard.x-second.x,keyboard.y-second.y)>94);
 for(const width of [1200,768,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:`/tmp/radial-position-${width}.png`});const circles=await page.getByRole('button',{name:/^Edit radial item/}).evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width};}));for(let i=0;i<circles.length;i++)for(let j=i+1;j<circles.length;j++)assert.ok(Math.hypot(circles[i].x-circles[j].x,circles[i].y-circles[j].y)>(circles[i].width+circles[j].width)/2+10);for(const h of await page.getByRole('button',{name:/^Move radial item/}).all()){const points=await h.locator('.radial-drag-line').evaluate(path=>Array.from({length:21},(_,i)=>{const p=path.getPointAtLength(path.getTotalLength()*i/20).matrixTransform(path.getScreenCTM());return p.x;}));assert.ok(points.every(x=>x>=2&&x<=width-2),JSON.stringify({width,points}));}}
 await page.getByRole('button',{name:'Auto-space options',exact:true}).click();assert.equal(await page.locator('.radial-editor').getAttribute('data-autospacing'),'true');await page.waitForFunction(()=>document.querySelector('.radial-editor').dataset.autospacing==='false');const reset=await position(1);assert.ok(Math.abs(reset.x)<1&&reset.y<0);await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Move radial item 1',exact:true}).focus();await page.keyboard.press('ArrowRight');await page.getByRole('button',{name:'Auto-space options',exact:true}).click();assert.equal(await page.locator('.radial-editor').getAttribute('data-autospacing'),'false');await page.emulateMedia({reducedMotion:'no-preference'});await page.getByRole('button',{name:'Save radial menu',exact:true}).click();
 await open();await page.getByRole('button',{name:'Edit radial item 3',exact:true}).click();await options.getByRole('button',{name:'Delete option',exact:true}).click();assert.equal(await page.getByRole('button',{name:/^Edit radial item/}).count(),2);await page.getByRole('button',{name:'Save radial menu',exact:true}).click();
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('runes.profiles.v1')).profiles[0].assignments.find(a=>a.id==='tap-index').appAction.items);assert.ok(saved.every(i=>i.angle===undefined));assert.deepEqual(errors,[]);
 await page.addInitScript(()=>{window.band={send(){},onMessage(fn){window.emitBand=fn;return()=>{};}};});
 await page.goto('http://radial.test/?profile-picker');await page.getByRole('dialog',{name:'Desktop profile picker'}).waitFor();
 await page.evaluate(()=>window.emitBand({kind:'picker_state',state:{profiles:[],radialItems:[{id:'right',angle:Math.PI/2,output:{type:'shortcut',shortcut:{key:'A',modifiers:[]}}},{id:'top',angle:0,output:{type:'shortcut',shortcut:{key:'B',modifiers:[]}}}],selected:0,angle:Math.PI/2}}));
 const runtime=page.getByRole('dialog',{name:'Radial menu'});await runtime.waitFor();
 const runtimePosition=await runtime.getByRole('button',{name:'A',exact:true}).evaluate(el=>({x:el.style.getPropertyValue('--x'),y:el.style.getPropertyValue('--y')}));assert.ok(parseFloat(runtimePosition.x)>37&&Math.abs(parseFloat(runtimePosition.y))<.01);
 console.log('Passed: minimum gaps for 2–8 options, wraparound, repeated moves, legacy overlap repair, pointer/keyboard constraints, saved positions, responsive bounds, runtime layout and auto-space reset.');
}finally{await browser.close();}
