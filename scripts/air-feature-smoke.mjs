import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
page.setDefaultTimeout(6000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.airListeners=[];window.airCommands=[];window.band={send:c=>window.airCommands.push(c),onMessage:fn=>{window.airListeners.push(fn);return()=>{window.airListeners=window.airListeners.filter(f=>f!==fn);};}};window.airEmit=m=>window.airListeners.slice().forEach(f=>f(m));});
try{
 await page.goto('http://127.0.0.1:5190');
 await page.getByRole('button',{name:'Add gesture combo',exact:true}).click();
 const second=()=>page.getByRole('button',{name:'Combo 1 gesture 2:',exact:false});
 await second().click();await page.getByRole('menuitemradio',{name:'Air gesture',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Air gesture editor'});
 await dialog.waitFor();assert.equal(await page.getByRole('button',{name:'Save air gesture'}).isEnabled(),false);
 assert.equal(await dialog.getByRole('textbox').count(),0);
 const pad=dialog.getByRole('img',{name:'Air gesture drawing'});
 let r=await pad.boundingBox();
 await page.mouse.move(r.x+r.width*.2,r.y+r.height*.25);await page.mouse.down();
 await page.mouse.move(r.x+r.width*.75,r.y+r.height*.25,{steps:15});await page.mouse.move(r.x+r.width*.75,r.y+r.height*.75,{steps:15});await page.mouse.up();
 await page.getByRole('slider',{name:'Minimum similarity'}).fill('83');await page.getByRole('slider',{name:'Time to perform'}).fill('2500');
 for(const width of [1440,768,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:`/tmp/air-editor-${width}.png`});const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y>=0&&bounds.y+bounds.height<=900);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await page.getByRole('button',{name:'Save air gesture',exact:true}).click();
 await page.reload();assert.equal(await page.getByRole('button',{name:'Edit Combo 1 air gesture 2'}).count(),1);
 let assignments=await page.evaluate(()=>JSON.parse(localStorage.getItem('runes.assignments.v1')));
 let combo=assignments.find(a=>a.steps);assert.equal(combo.steps[1].air.minSimilarity,83);assert.equal('name' in combo.steps[1].air,false);assert.equal(combo.steps[1].air.durationMs,2500);assert.ok(combo.steps[1].air.points.length===64);
 // Air cannot be first or immediately follow another air gesture.
 await page.getByRole('button',{name:'Combo 1 gesture 1:',exact:false}).click();assert.equal(await page.getByRole('menuitemradio',{name:'Air gesture',exact:true}).count(),0);await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Add gesture to Combo 1',exact:true}).click();assert.equal(await page.getByRole('menuitemradio',{name:'Air gesture',exact:true}).count(),0);await page.keyboard.press('Escape');
 // Band capture: realistic orientation samples, no real hardware required.
 await page.getByRole('button',{name:'Edit Combo 1 air gesture 2'}).click();await page.getByRole('button',{name:'Use band',exact:true}).click();
 await page.getByRole('slider',{name:'Time to perform'}).fill('600');
 await page.evaluate(()=>window.airEmit({kind:'events',events:[{type:'Orientation',values:[1,0,0,0]}]}));
 await page.getByRole('button',{name:'Start recording',exact:true}).click();
 for(let i=0;i<16;i++){const a=i/15*.6;await page.evaluate(a=>window.airEmit({kind:'events',events:[{type:'Orientation',values:[Math.cos(a/2),Math.sin(a/2),0,0]}]}),a);await page.waitForTimeout(22);}
 await page.getByRole('button',{name:/Stop ·/}).click();await page.getByRole('button',{name:'Save air gesture',exact:true}).click();
 assignments=await page.evaluate(()=>JSON.parse(localStorage.getItem('runes.assignments.v1')));combo=assignments.find(a=>a.steps);assert.equal(combo.steps[1].air.durationMs,600);
 // Cancel edits retains saved settings, restores the parent focus and suspension.
 await page.getByRole('button',{name:'Edit Combo 1 air gesture 2'}).click();await page.getByRole('slider',{name:'Minimum similarity'}).fill('40');await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);assert.equal(await page.getByRole('button',{name:'Edit Combo 1 air gesture 2'}).count(),1);
 await page.getByRole('button',{name:'Edit Combo 1 air gesture 2'}).click();await page.getByRole('button',{name:'Save air gesture'}).focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Time to perform');await page.keyboard.press('Escape');
 // An interrupted capture cannot save a partial stroke.
 await page.getByRole('button',{name:'Edit Combo 1 air gesture 2'}).click();await page.getByRole('button',{name:'Use band',exact:true}).click();
 await page.evaluate(()=>window.airEmit({kind:'events',events:[{type:'Orientation',values:[1,0,0,0]}]}));
 await page.getByRole('button',{name:'Start recording',exact:true}).click();await page.waitForTimeout(650);
 assert.equal(await page.getByRole('button',{name:'Save air gesture'}).isEnabled(),false);
 assert.match(await dialog.locator('.air-editor-status').innerText(),/interrupted/);await page.keyboard.press('Escape');
 // The notch presents competing shapes separately and displays the winning shape.
 await page.goto('http://127.0.0.1:5190/?combo-viewer');await page.emulateMedia({reducedMotion:'reduce'});
 await page.getByRole('complementary',{name:'Notch combo viewer'}).waitFor();
 const other={...combo,id:'combo-other',enabled:true,steps:[combo.steps[0],{gesture:'air',air:{...combo.steps[1].air,points:[[0,0],[1,0],[1,1],[0,0]]}}]};
 await page.evaluate(assignments=>window.airEmit({kind:'combo_viewer_config',assignments}),[{...combo,enabled:true},other]);
 await page.evaluate(ids=>{window.airEmit({kind:'gesture_input',input:{id:1,gesture:'tap-index'}});window.airEmit({kind:'combo_progress',candidates:ids.map(id=>({id,attemptId:id+':1',matched:1,inputIds:[1],remainingMs:600}))});},[combo.id,other.id]);
 await page.getByRole('list',{name:'Possible next gestures'}).getByRole('listitem',{name:'Air gesture',exact:true}).first().waitFor();assert.equal(await page.locator('.notch-option').count(),2);
 await page.evaluate(air=>window.airEmit({kind:'gesture_input',input:{id:2,gesture:'air',air}}),other.steps[1].air);
 await page.getByRole('list',{name:'Gestures performed'}).getByRole('listitem',{name:'Air gesture',exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('Air gesture feature passed: manual drawing, band recording, persistence, settings, required predecessor, cancel/focus, and 1440/768/390 layouts.');
}finally{await browser.close();}
