import {spaceRadialItems} from './radial-layout.js';
import { app, BrowserWindow, ipcMain, systemPreferences, shell, Tray, Menu, nativeImage, screen, session } from 'electron';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {metaLogin, type Credentials} from './meta-login.js';
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let worker: ChildProcessWithoutNullStreams | undefined;
let window: BrowserWindow;
const isLiveWindow = (target: BrowserWindow | undefined): target is BrowserWindow => !!target && !target.isDestroyed();
let tray: Tray | undefined;
let picker: BrowserWindow | undefined;
let comboViewer: BrowserWindow | undefined;
let airCursorOverlay = false;
let airCursor: BrowserWindow | undefined;
let airCursorReady=false;
let airCursorUpdatedAt=0;
let airCursorResultTimer:ReturnType<typeof setTimeout>|undefined;
let airCursorExitTimer:ReturnType<typeof setTimeout>|undefined;
let airCursorHideTimer:ReturnType<typeof setTimeout>|undefined;
let airCursorState:any={active:false};
let airCursorTimer:ReturnType<typeof setInterval>|undefined;
function positionAirCursor(){
 if(!airCursor||airCursor.isDestroyed())return;
 if(airCursorState.active&&Date.now()-airCursorUpdatedAt>650){hideAirCursor();return;}
 const cursor=screen.getCursorScreenPoint();
 const x=Math.round(cursor.x-40),y=Math.round(cursor.y-40);
 const bounds=airCursor.getBounds();
 if(bounds.x!==x||bounds.y!==y)airCursor.setBounds({x,y,width:80,height:80});
}
function presentAirCursor(){
 if(!isLiveWindow(airCursor)||!airCursorReady)return;
 if(airCursorState.active&&Date.now()-airCursorUpdatedAt>650)airCursorState={active:false};
 airCursor.webContents.send('band:message',{kind:'air_preview',...airCursorState});
 if(airCursorOverlay&&airCursorState.active){
  clearTimeout(airCursorExitTimer);airCursorExitTimer=undefined;
  positionAirCursor();
  if(!airCursor.isVisible())airCursor.showInactive();
  if(!airCursorTimer)airCursorTimer=setInterval(positionAirCursor,16);
 }else{
  if(airCursor.isVisible()&&airCursorOverlay){
   if(!airCursorExitTimer)airCursorExitTimer=setTimeout(()=>{airCursorExitTimer=undefined;clearInterval(airCursorTimer);airCursorTimer=undefined;if(airCursor&&!airCursor.isDestroyed())airCursor.hide();},200);
  }else{clearInterval(airCursorTimer);airCursorTimer=undefined;airCursor.hide();}
 }
}
function hideAirCursor(){clearTimeout(airCursorResultTimer);airCursorResultTimer=undefined;clearTimeout(airCursorHideTimer);airCursorHideTimer=undefined;airCursorState={active:false};presentAirCursor();}
function syncAirCursor(){
 workerCommand({action:'air_preview',enabled:airCursorOverlay});
 if(!airCursorOverlay){hideAirCursor();clearTimeout(airCursorExitTimer);airCursorExitTimer=undefined;airCursor?.destroy();airCursor=undefined;airCursorReady=false;return;}
 if(airCursor)return;
 airCursorReady=false;
 airCursor=new BrowserWindow({...(process.platform==='darwin'?{type:'panel' as const}:{}),width:80,height:80,show:false,frame:false,transparent:true,resizable:false,focusable:false,skipTaskbar:true,hasShadow:false,alwaysOnTop:true,enableLargerThanScreen:true,webPreferences:{preload:path.join(root,'dist-electron/preload.cjs'),backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,sandbox:true}});
 airCursor.setAlwaysOnTop(true,'screen-saver');airCursor.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});airCursor.setIgnoreMouseEvents(true);
 airCursor.webContents.setWindowOpenHandler(()=>({action:'deny'}));airCursor.webContents.on('will-navigate',event=>event.preventDefault());
 if(process.argv.includes('--dev')||!fs.existsSync(path.join(root,'dist/index.html')))void airCursor.loadURL('http://127.0.0.1:5190/?air-cursor');
 else void airCursor.loadFile(path.join(root,'dist/index.html'),{query:{'air-cursor':'1'}});
}
function airCursorMessage(message:any){
 if(message.kind==='air_result'&&airCursorOverlay){
  clearTimeout(airCursorHideTimer);airCursorHideTimer=undefined;
  clearTimeout(airCursorResultTimer);
  airCursorUpdatedAt=Date.now();airCursorState={...message,kind:'air_preview',active:true};presentAirCursor();
  airCursorResultTimer=setTimeout(hideAirCursor,580);
 }
 if(message.kind==='air_preview'){
  if(!message.active){
   if(!airCursorResultTimer){clearTimeout(airCursorHideTimer);airCursorHideTimer=setTimeout(hideAirCursor,80);}
  }else{
   clearTimeout(airCursorResultTimer);airCursorResultTimer=undefined;clearTimeout(airCursorHideTimer);airCursorHideTimer=undefined;
   airCursorUpdatedAt=Date.now();airCursorState=airCursorOverlay?message:{active:false};presentAirCursor();
  }
 }
 if(message.kind==='state'&&message.state!=='connected')hideAirCursor();
}
let floatingComboViewer = false;
let notchMenuNames=true;
let notchComboViewerSides:'both'|'left'|'right'='both';
const validNotchSides=(value:unknown):value is typeof notchComboViewerSides=>value==='both'||value==='left'||value==='right';
let notchGeometry={displayId:0,width:200,height:32,offset:0};
function comboViewerGeometry(){comboViewer?.webContents.send('band:message',{kind:'combo_viewer_geometry',width:notchGeometry.width,height:notchGeometry.height,offset:notchGeometry.offset});}
function comboViewerState(){comboViewer?.webContents.send('band:message',{kind:'combo_viewer_config',assignments:configuredAssignments,sides:notchComboViewerSides});comboViewerGeometry();sendPickerName();}
function positionComboViewer(){
 cheatSheetState();
 if(!comboViewer||comboViewer.isDestroyed())return;
 const displays=screen.getAllDisplays();
 const display=displays.find(d=>d.id===notchGeometry.displayId)??displays.find(d=>d.internal)??screen.getPrimaryDisplay();
 // Use screen bounds: the work area starts below the menu bar and camera notch.
 comboViewer.setBounds({x:display.bounds.x,y:display.bounds.y,width:display.bounds.width,height:440});
 comboViewerGeometry();
}
let comboViewerShape={left:0,right:0};
let cheatSheetOpeningShape={left:0,right:0};
let cheatSheet: BrowserWindow | undefined;
let cheatSheetDescriptions:Record<string,string>={};
let cheatSheetClosing=false;
let cheatSheetCloseTimer:ReturnType<typeof setTimeout>|undefined;
function dismissCheatSheet(){
 if(!cheatSheet||cheatSheet.isDestroyed()||cheatSheetClosing)return;
 cheatSheetClosing=true;
 cheatSheet.webContents.send('band:message',{kind:'cheat_sheet_dismiss',...cheatSheetOrigin(comboViewerShape)});
 cheatSheetCloseTimer=setTimeout(()=>cheatSheet?.destroy(),700);
}
function cheatSheetOrigin(shape:{left:number;right:number}){
 const width=cheatSheet?.getBounds().width??680;
 const display=screen.getAllDisplays().find(d=>d.id===notchGeometry.displayId)??screen.getAllDisplays().find(d=>d.internal)??screen.getPrimaryDisplay();
 const center=display.bounds.x+display.bounds.width/2+notchGeometry.offset-(cheatSheet?.getBounds().x??0);
 return {originLeft:Math.max(6,center-notchGeometry.width/2-shape.left),originRight:Math.min(width-6,center+notchGeometry.width/2+shape.right)};
}
function cheatSheetState(){
 if(!cheatSheet||cheatSheet.isDestroyed())return;
 const display=screen.getAllDisplays().find(d=>d.id===notchGeometry.displayId)??screen.getAllDisplays().find(d=>d.internal)??screen.getPrimaryDisplay();
 // Transparent side gutters keep macOS window corners away from the visible shoulders.
 const width=Math.min(Math.max(712,notchGeometry.width+2*Math.max(cheatSheetOpeningShape.left,cheatSheetOpeningShape.right)+44),display.bounds.width);
 const x=Math.max(display.bounds.x,Math.min(display.bounds.x+display.bounds.width-width,Math.round(display.bounds.x+display.bounds.width/2+notchGeometry.offset-width/2)));
 cheatSheet.setBounds({x,y:display.bounds.y,width,height:Math.min(600,display.bounds.height)});
 cheatSheet.webContents.send('band:message',{kind:'cheat_sheet_state',...cheatSheetOrigin(cheatSheetOpeningShape),descriptions:cheatSheetDescriptions,assignments:configuredAssignments,profiles:pickerProfiles,profileName:pickerProfiles.find(p=>p.id===pickerActive)?.name??'Current profile',notchHeight:notchGeometry.height,notchWidth:notchGeometry.width,notchCenter:display.bounds.x+display.bounds.width/2+notchGeometry.offset-x});
}
function toggleCheatSheet(){
 if(cheatSheet&&!cheatSheet.isDestroyed()){dismissCheatSheet();return;}
 cheatSheetClosing=false;
 cheatSheetOpeningShape={...comboViewerShape};
 comboViewer?.webContents.send('band:message',{kind:'cheat_sheet_visibility',open:true});
 cheatSheet=new BrowserWindow({roundedCorners:false,width:680,height:600,show:false,frame:false,transparent:true,resizable:false,skipTaskbar:true,hasShadow:false,alwaysOnTop:true,enableLargerThanScreen:true,webPreferences:{backgroundThrottling:false,preload:path.join(root,'dist-electron/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 cheatSheet.setAlwaysOnTop(true,'screen-saver');cheatSheet.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
 cheatSheet.on('focus',()=>comboViewer?.moveTop());
 cheatSheet.on('close',event=>{if(!quitting){event.preventDefault();dismissCheatSheet();}});
 cheatSheet.on('closed',()=>{comboViewer?.webContents.send('band:message',{kind:'cheat_sheet_visibility',open:false});clearTimeout(cheatSheetCloseTimer);cheatSheetCloseTimer=undefined;cheatSheetClosing=false;cheatSheet=undefined;});
 cheatSheet.webContents.setWindowOpenHandler(()=>({action:'deny'}));cheatSheet.webContents.on('will-navigate',event=>event.preventDefault());
 if(!comboViewer)refreshNotchGeometry();cheatSheetState();
 if(process.argv.includes('--dev')||!fs.existsSync(path.join(root,'dist/index.html')))void cheatSheet.loadURL('http://127.0.0.1:5190/?cheat-sheet');
 else void cheatSheet.loadFile(path.join(root,'dist/index.html'),{query:{'cheat-sheet':'1'}});
}
let notchQuery=0;
function refreshNotchGeometry(){
 const query=++notchQuery;
 notchGeometry={displayId:0,width:200,height:32,offset:0};positionComboViewer();
 if(process.platform!=='darwin')return;
 // AppKit exposes the actual camera cutout in logical points, including on scaled displays.
 const script=`ObjC.import('AppKit'); var screens=$.NSScreen.screens; var result=[];
 for(var i=0;i<screens.count;i++){var s=screens.objectAtIndex(i);var top=s.safeAreaInsets.top;
 if(top>0){var left=s.auxiliaryTopLeftArea;var right=s.auxiliaryTopRightArea;
 result.push({displayId:Number(ObjC.unwrap(s.deviceDescription.objectForKey('NSScreenNumber'))),width:right.origin.x-left.origin.x-left.size.width,height:top,offset:(left.origin.x+left.size.width+right.origin.x)/2-s.frame.origin.x-s.frame.size.width/2});}}
 JSON.stringify(result);`;
 execFile('/usr/bin/osascript',['-l','JavaScript','-e',script],{timeout:5000},(error,stdout)=>{
  if(error||query!==notchQuery)return;
  try{
   const entries=JSON.parse(stdout) as typeof notchGeometry[];
   const found=entries.find(entry=>Number.isFinite(entry.displayId)&&Number.isFinite(entry.offset)&&entry.width>0&&entry.width<600&&entry.height>0&&entry.height<100&&screen.getAllDisplays().some(d=>d.id===entry.displayId));
   if(found){notchGeometry=found;positionComboViewer();}
  }catch{/* Keep the top-center fallback when AppKit is unavailable. */}
 });
}
function syncComboViewer(){
 if(!floatingComboViewer){comboViewer?.destroy();comboViewer=undefined;comboViewerShape={left:0,right:0};return;}
 if(comboViewer)return;
 comboViewer=new BrowserWindow({width:800,height:440,show:false,frame:false,transparent:true,resizable:false,focusable:false,skipTaskbar:true,hasShadow:false,alwaysOnTop:true,enableLargerThanScreen:true,webPreferences:{preload:path.join(root,'dist-electron/preload.cjs'),backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,sandbox:true}});
 refreshNotchGeometry();
 comboViewer.setAlwaysOnTop(true,'screen-saver');comboViewer.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});comboViewer.setIgnoreMouseEvents(true);
 comboViewer.webContents.setWindowOpenHandler(()=>({action:'deny'}));comboViewer.webContents.on('will-navigate',event=>event.preventDefault());
 if(process.argv.includes('--dev')||!fs.existsSync(path.join(root,'dist/index.html')))void comboViewer.loadURL('http://127.0.0.1:5190/?combo-viewer');
 else void comboViewer.loadFile(path.join(root,'dist/index.html'),{query:{'combo-viewer':'1'}});
}
let pickerProfiles: {id:string;name:string;icon?:string;angle?:number}[] = [];
let pickerActive = '';
let radialItems: {id:string;name?:string;angle?:number;output:any}[] | undefined;
let radialOpener: string | undefined;
let configuredAssignments: any[] = [];
const pickerEntries=()=>radialItems??pickerProfiles;
let pickerOpen = false;
let pickerReady=false;
let pickerPointer={x:80,y:80};
let pickerCondensed=false;
let pickerFollowPosition:{x:number;y:number}|undefined;
let pickerLastMouse:{x:number;y:number}|undefined;
let pickerLastMouseMove=0;
let pickerFollowAt=0;
let pickerExpandedUntil=0;
let pickerOpener: string | undefined;
let pickerSelected = 0;
let pickerAngle = 0;
let pickerOrigin: number[] | undefined;
let pickerLastDelta = 0;
let pickerRotation = 0;
let pickerSlot = 0;
let lastOrientation: number[] | undefined;
let pickerHideTimer: ReturnType<typeof setTimeout> | undefined;
let pickerTimer: ReturnType<typeof setTimeout> | undefined;
let pickerFollowTimer: ReturnType<typeof setInterval> | undefined;
const workerCommand = (command:unknown) => worker?.stdin.write(JSON.stringify(command)+'\n');
function positionedProfiles(){
 const action=configuredAssignments.find(a=>a.id===pickerOpener)?.appAction;
 return spaceRadialItems(pickerProfiles.map(p=>({...p,angle:action?.type==='open-profile-picker'&&Number.isFinite(action.positions?.[p.id])?action.positions![p.id]:undefined})));
}
function sendPickerName(){comboViewer?.webContents.send('band:message',{kind:'radial_name',name:pickerOpen&&notchMenuNames?(radialItems?radialItems[pickerSelected]?.name?.trim():pickerProfiles[pickerSelected]?.name)??'':''});}
function pickerState(){sendPickerName();picker?.webContents.send('band:message',{kind:'picker_state',state:{compact:compactRadialMenus,condensed:pickerCondensed,pointer:pickerPointer,profiles:positionedProfiles(),radialItems,selected:pickerSelected,angle:pickerAngle}});}
function closePicker(select=false){
 if(!pickerOpen)return;
 if(select&&radialItems&&keepRadialMenuOpen){const chosen=radialItems[pickerSelected];if(chosen)workerCommand({action:'radial_execute',output:chosen.output});return;}
 pickerOpen=false;comboViewer?.webContents.send('band:message',{kind:'radial_name',name:''});clearTimeout(pickerTimer);
 clearInterval(pickerFollowTimer);pickerFollowTimer=undefined;
 const cursor=screen.getCursorScreenPoint();
 const bounds=picker?.getBounds();
 const pointer=bounds?{x:cursor.x+6-bounds.x,y:cursor.y+10-bounds.y}:pickerPointer;
 picker?.webContents.send('band:message',{kind:'picker_close',pointer});
 clearTimeout(pickerHideTimer);pickerHideTimer=setTimeout(()=>{if(!pickerOpen)picker?.hide();},320);
 const chosen=radialItems?.[pickerSelected];
 if(select&&chosen)workerCommand({action:'radial_execute',output:chosen.output});
 if(select&&!radialItems&&pickerProfiles[pickerSelected]){publish({kind:'app_action',action:{type:'change-profile',profileId:pickerProfiles[pickerSelected].id}});publish({kind:'action_fired'});}
 workerCommand({action:'profile_picker',open:false});
}
function openPicker(items?:{id:string;name?:string;angle?:number;output:any}[],opener?:string){
 if(pickerOpen){closePicker();return;}
 radialItems=items?spaceRadialItems(items):undefined;radialOpener=opener;
 if(!pickerEntries().length){workerCommand({action:'profile_picker',open:false});return;}
 clearTimeout(pickerHideTimer);pickerOpen=true;pickerSelected=radialItems?0:Math.max(0,pickerProfiles.findIndex(p=>p.id===pickerActive));
 pickerAngle=(radialItems??positionedProfiles())[pickerSelected]?.angle??pickerSelected/pickerEntries().length*Math.PI*2;pickerOrigin=lastOrientation;pickerLastDelta=0;pickerRotation=0;pickerSlot=pickerSelected;
 workerCommand({action:'profile_picker',open:true});
 if(!picker){
  pickerReady=false;
  picker=new BrowserWindow({...(process.platform==='darwin'?{type:'panel' as const}:{}),fullscreenable:false,width:520,height:640,show:false,frame:false,transparent:true,resizable:false,focusable:false,skipTaskbar:true,hasShadow:false,alwaysOnTop:true,webPreferences:{preload:path.join(root,'dist-electron/preload.cjs'),backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,sandbox:true}});
  picker.setAlwaysOnTop(true,'screen-saver');picker.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
  picker.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  picker.webContents.on('will-navigate',event=>event.preventDefault());
  picker.webContents.on('did-start-loading',()=>{pickerReady=false;});
  const failed=()=>{closePicker();picker?.destroy();picker=undefined;pickerReady=false;};
  picker.webContents.on('render-process-gone',failed);
  picker.webContents.on('did-fail-load',(_event,code)=>{if(code!==-3)failed();});
  if(process.argv.includes('--dev')||!fs.existsSync(path.join(root,'dist/index.html')))picker.loadURL('http://127.0.0.1:5190/?profile-picker');
  else picker.loadFile(path.join(root,'dist/index.html'),{query:{'profile-picker':'1'}});
 }
 pickerCondensed=false;pickerFollowPosition=undefined;pickerLastMouse=undefined;
 pickerExpandedUntil=0;
 positionPickerAtMouse();
 picker.setIgnoreMouseEvents(radialMenuFollowsMouse);
 clearInterval(pickerFollowTimer);
 if(radialMenuFollowsMouse)pickerFollowTimer=setInterval(()=>{
  if(!pickerOpen||!picker)return;
  positionPickerAtMouse(true);
 },16);
 presentPicker();
 if(!(radialItems&&keepRadialMenuOpen))pickerTimer=setTimeout(()=>closePicker(),30000);
}
function positionPickerAtMouse(smooth=false){
 if(!picker)return;
 const cursor=screen.getCursorScreenPoint();
 const area=screen.getDisplayNearestPoint(cursor).workArea;
 // Screen coordinates mark the arrow tip; offset to the visual center of the cursor.
 const cursorCenter={x:cursor.x+6,y:cursor.y+10};
 const width=compactRadialMenus?160:520,height=compactRadialMenus?160:640;
 const target={x:Math.max(area.x,Math.min(cursorCenter.x-width/2,area.x+area.width-width)),y:Math.max(area.y,Math.min(cursorCenter.y-height/2,area.y+area.height-height))};
 const now=performance.now();
 if(!smooth||!pickerFollowPosition){pickerFollowPosition={...target};pickerLastMouseMove=-Infinity;}
 else {
  const dt=Math.min(Math.max((now-pickerFollowAt)/1000,0),.05);
  const distance=Math.hypot(target.x-pickerFollowPosition.x,target.y-pickerFollowPosition.y);
  // Exponential pursuit: a longer gap produces faster travel and stronger catch-up.
  const blend=1-Math.exp(-(8+Math.min(distance/35,18))*dt);
  pickerFollowPosition.x+=(target.x-pickerFollowPosition.x)*blend;
  pickerFollowPosition.y+=(target.y-pickerFollowPosition.y)*blend;
  if(distance<.5)pickerFollowPosition={...target};
 }
 pickerFollowAt=now;
 if(pickerLastMouse&&(cursor.x!==pickerLastMouse.x||cursor.y!==pickerLastMouse.y))pickerLastMouseMove=now;
 pickerLastMouse={...cursor};
 const condensed=smooth&&now-pickerLastMouseMove<800&&now>=pickerExpandedUntil;
 if(condensed!==pickerCondensed){pickerCondensed=condensed;picker.webContents.send('band:message',{kind:'picker_condensed',condensed});}
 const x=Math.round(pickerFollowPosition.x),y=Math.round(pickerFollowPosition.y);
 pickerPointer={x:cursorCenter.x-x,y:cursorCenter.y-y};
 const bounds=picker.getBounds();
 if(bounds.x!==x||bounds.y!==y||bounds.width!==width||bounds.height!==height)picker.setBounds({width,height,x,y});
}
function presentPicker(){
 if(!pickerOpen||!pickerReady||!picker)return;
 pickerState();picker.webContents.send('band:message',{kind:'picker_open'});
 picker.showInactive();picker.moveTop();
}
function pickerMessage(message:any){
 if(message.kind==='events')for(const event of message.events??[]){
  const q=event.values;
  if(event.type!=='Orientation'||!Array.isArray(q)||q.length!==4||!q.every(Number.isFinite))continue;
  const norm=Math.hypot(...q);if(norm<1e-8)continue;
  lastOrientation=q.map((v:number)=>v/norm);
  if(!pickerOpen)continue;
  if(!pickerOrigin){pickerOrigin=lastOrientation;continue;}
  const [w,x,y,z]=pickerOrigin,[a,b,c,d]=lastOrientation!;
  const scalar=w*a+x*b+y*c+z*d,axis=w*c+x*d-y*a-z*b;
  let delta=2*Math.atan2(axis,scalar);delta=Math.atan2(Math.sin(delta),Math.cos(delta));
  const base=radialItems?(radialItems[0]?.angle??0):(positionedProfiles().find(p=>p.id===pickerActive)?.angle??Math.max(0,pickerProfiles.findIndex(p=>p.id===pickerActive))/pickerEntries().length*Math.PI*2);
  // Unwrap orientation at ±π, then use a Schmitt threshold to prevent boundary chatter.
  pickerRotation+=Math.atan2(Math.sin(delta-pickerLastDelta),Math.cos(delta-pickerLastDelta));
  pickerLastDelta=delta;
  pickerAngle=base+pickerRotation*2;
  const slot=pickerAngle/(Math.PI*2)*pickerEntries().length;
  if(Math.abs(slot-pickerSlot)>0.64){
   pickerSlot=Math.round(slot);
   if(pickerCondensed){
    pickerCondensed=false;pickerExpandedUntil=performance.now()+800;
    picker?.webContents.send('band:message',{kind:'picker_condensed',condensed:false});
   }
  }
  const positioned=radialItems??positionedProfiles();
  if(positioned.some(item=>item.angle!==undefined)){
   const distance=(index:number)=>{const angle=positioned[index].angle??index/positioned.length*Math.PI*2;return Math.abs(Math.atan2(Math.sin(pickerAngle-angle),Math.cos(pickerAngle-angle)));};
   const nearest=positioned.reduce((best,_,index)=>distance(index)<distance(best)?index:best,0);
   if(distance(pickerSelected)-distance(nearest)>.04)pickerSelected=nearest;
  }else pickerSelected=((pickerSlot%pickerEntries().length)+pickerEntries().length)%pickerEntries().length;
  pickerState();
 }
 if(message.kind==='app_action'&&message.action?.type==='radial-menu'){const opener=configuredAssignments.find(a=>a.enabled&&JSON.stringify(a.appAction)===JSON.stringify(message.action))?.id;openPicker(message.action.items,opener);}
 else if(message.kind==='app_action'&&message.action?.type==='show-cheat-sheet')toggleCheatSheet();
 else if(message.kind==='app_action'&&message.action?.type==='open-profile-picker')openPicker();
 else if(pickerOpen&&message.kind==='motion'){
  if(message.motion==='double-tap-index')closePicker(true);
  else if(message.motion===(radialItems?radialOpener:pickerOpener))closePicker();
 }
 if(message.kind==='state'&&message.state==='disconnected')closePicker();
}
let quitting = false;
let runInBackground = true;
let compactRadialMenus = false;
let keepRadialMenuOpen=false;
let radialMenuFollowsMouse=false;
const preferencesPath = () => path.join(app.getPath('userData'), 'app-settings.json');
function settings() {
  const login = process.platform === 'darwin' ? app.getLoginItemSettings() : undefined;
  return {runInBackground, compactRadialMenus, keepRadialMenuOpen, radialMenuFollowsMouse, floatingComboViewer, airCursorOverlay, notchComboViewerSides, notchMenuNames, openAtLogin: login?.openAtLogin ?? false, loginAvailable: process.platform === 'darwin' && app.isPackaged, loginStatus: login?.status};
}
function showWindow() {
  app.dock?.show();
  window.show();
  window.focus();
}
function hideWindow() {
  window.hide();
  app.dock?.hide();
}
// The Mac's only gesture source is Neural on iPhone. Its status lives in the menu bar.
let phoneLink:{state:string;phone?:string|null}={state:'starting'};
const phoneStatusText=()=>({connected:'Connected to iPhone',away:'iPhone not nearby',open_app:'Open Neural on iPhone once',unpaired:'Pair your iPhone',searching:'Connecting to iPhone…',sleeping:'iPhone not nearby',unavailable:'iPhone link unavailable'} as Record<string,string>)[phoneLink.state]??'Starting…';
function refreshTray(){
  if(!tray)return;
  tray.setToolTip(`Neural — ${phoneStatusText()}`);
  tray.setContextMenu(Menu.buildFromTemplate([{label:phoneStatusText(),enabled:false},{type:'separator'},{label:'Open Neural',click:showWindow},{type:'separator'},{label:'Quit Neural',click:()=>app.quit()}]));
}
function phoneLinkMessage(message:any){
  if(message?.kind!=='phone_link'||typeof message.state!=='string')return;
  const changed=message.state!==phoneLink.state;
  phoneLink={state:message.state,phone:message.phone};
  if(changed)refreshTray();
  // First run: bring the pairing code forward.
  if(message.state==='unpaired'&&isLiveWindow(window)&&!window.isVisible())showWindow();
}
function ensureTray() {
  if (tray) { refreshTray(); return; }
  const pixels = Buffer.alloc(18 * 18 * 4);
  const points = [[2,10],[5,10],[7,3],[11,15],[13,8],[16,8]];
  for (let segment = 1; segment < points.length; segment++) {
    const [x0,y0] = points[segment-1], [x1,y1] = points[segment];
    const steps = Math.max(Math.abs(x1-x0), Math.abs(y1-y0)) * 3;
    for (let step = 0; step <= steps; step++) {
      const x = Math.round(x0+(x1-x0)*step/steps), y = Math.round(y0+(y1-y0)*step/steps);
      pixels[(y*18+x)*4+3] = 255;
      if (x+1 < 18) pixels[(y*18+x+1)*4+3] = 255;
    }
  }
  const icon = nativeImage.createFromBitmap(pixels, {width:18,height:18,scaleFactor:1});
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.on('click', ()=>tray?.popUpContextMenu());
  refreshTray();
}
ipcMain.handle('app:settings', (event, update) => {
  if (quitting || !isLiveWindow(window) || event.sender !== window.webContents) throw new Error('Unknown settings sender');
  if (update) {
    if (typeof update.openAtLogin === 'boolean') {
      if (!settings().loginAvailable) throw new Error('Install the packaged macOS app to enable launch at login.');
      app.setLoginItemSettings({openAtLogin:update.openAtLogin});
      const login = app.getLoginItemSettings();
      if (update.openAtLogin && !login.openAtLogin && login.status !== 'requires-approval') throw new Error('macOS could not enable launch at login. Check System Settings → General → Login Items.');
    }
    if (typeof update.notchMenuNames === 'boolean' || typeof update.airCursorOverlay === 'boolean' || typeof update.runInBackground === 'boolean' || typeof update.compactRadialMenus === 'boolean' || typeof update.floatingComboViewer === 'boolean' || typeof update.keepRadialMenuOpen === 'boolean' || typeof update.radialMenuFollowsMouse === 'boolean' || validNotchSides(update.notchComboViewerSides)) {
      const nextBackground=typeof update.runInBackground==='boolean'?update.runInBackground:runInBackground;
      const nextCompact=typeof update.compactRadialMenus==='boolean'?update.compactRadialMenus:compactRadialMenus;
      const nextFollow=typeof update.radialMenuFollowsMouse==='boolean'?update.radialMenuFollowsMouse:radialMenuFollowsMouse;
      const nextKeep=typeof update.keepRadialMenuOpen==='boolean'?update.keepRadialMenuOpen:keepRadialMenuOpen;
      const nextAir=typeof update.airCursorOverlay==='boolean'?update.airCursorOverlay:airCursorOverlay;
      const nextFloating=typeof update.floatingComboViewer==='boolean'?update.floatingComboViewer:floatingComboViewer;
      const nextNames=typeof update.notchMenuNames==='boolean'?update.notchMenuNames:notchMenuNames;
      const nextSides=validNotchSides(update.notchComboViewerSides)?update.notchComboViewerSides:notchComboViewerSides;
      const sidesChanged=nextSides!==notchComboViewerSides;
      fs.mkdirSync(app.getPath('userData'), {recursive:true});
      fs.writeFileSync(preferencesPath(), JSON.stringify({runInBackground:nextBackground,compactRadialMenus:nextCompact,keepRadialMenuOpen:nextKeep,radialMenuFollowsMouse:nextFollow,floatingComboViewer:nextFloating,airCursorOverlay:nextAir,notchComboViewerSides:nextSides,notchMenuNames:nextNames}));
      if(compactRadialMenus!==nextCompact||keepRadialMenuOpen!==nextKeep||radialMenuFollowsMouse!==nextFollow)closePicker();
      keepRadialMenuOpen=nextKeep;radialMenuFollowsMouse=nextFollow;
      compactRadialMenus=nextCompact;floatingComboViewer=nextFloating;notchComboViewerSides=nextSides;notchMenuNames=nextNames;syncComboViewer();sendPickerName();
      if(airCursorOverlay!==nextAir){airCursorOverlay=nextAir;syncAirCursor();}
      if(sidesChanged)comboViewer?.webContents.send('band:message',{kind:'combo_viewer_preferences',sides:notchComboViewerSides});
    }
    if (typeof update.runInBackground === 'boolean') {
      runInBackground = update.runInBackground;
      if (runInBackground) ensureTray();
      else if (!window.isVisible()) showWindow();
    }
  }
  return settings();
});
function credentialsCommand(request:object):Promise<any> {
  return new Promise((resolve,reject)=>{
    const executable=app.isPackaged?path.join(process.resourcesPath,'runtime/bin/python3.12'):path.join(root,'.venv/bin/python');
    const child=spawn(executable,[path.join(root,'python/meta_credentials.py')],{env:{...process.env,PYTHONHOME:app.isPackaged?path.join(process.resourcesPath,'runtime'):process.env.PYTHONHOME,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','ignore']});
    let output='';const timeout=setTimeout(()=>{child.kill();reject(new Error('Keychain request timed out.'));},30000);
    child.stdout.on('data',data=>{output+=data.toString();});
    child.on('error',()=>{clearTimeout(timeout);reject(new Error('Could not access macOS Keychain.'));});
    child.on('close',()=>{clearTimeout(timeout);try{const response=JSON.parse(output);if(!response.ok)throw Error();resolve(response.value);}catch{reject(new Error('Could not access macOS Keychain. Allow access and try again.'));}});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request)+'\n');
  });
}
ipcMain.handle('meta:credentials',async(event,request)=>{
  if(quitting || !isLiveWindow(window) || event.sender!==window.webContents)throw new Error('Unknown settings sender');
  if(!['status','save','forget'].includes(request?.action))throw new Error('Invalid credential action');
  const result=await credentialsCommand({action:request.action,username:request.username,password:request.password});
  if(request.action==='forget'){loginRequest=undefined;activeLogin?.cancel();await session.fromPartition('neural-meta-login').clearStorageData();}
  return result;
});
let activeLogin:ReturnType<typeof metaLogin>|undefined;
let loginRequest:string|undefined;
async function handleMetaLogin(message:any){
  try{
    activeLogin?.cancel();
    loginRequest=message.request_id;
    let credentials:Credentials|null=null;
    try{credentials=await credentialsCommand({action:'load'});}catch{/* Interactive login remains available if Keychain is locked. */}
    if(loginRequest!==message.request_id)return;
    activeLogin=metaLogin(message.url,credentials);
    const callback=await activeLogin.result;
    workerCommand({action:'meta_login_result',request_id:message.request_id,callback});
  }catch{workerCommand({action:'meta_login_result',request_id:message.request_id});}
  finally{if(loginRequest===message.request_id){activeLogin=undefined;loginRequest=undefined;}}
}
const publish = (message: unknown) => { if(quitting || !isLiveWindow(window))return; airCursorMessage(message); pickerMessage(message); if(comboViewer&&!comboViewer.isDestroyed()&&['gesture_input','combo_progress','combo_outcome','state'].includes((message as any)?.kind))comboViewer.webContents.send('band:message',message); if (window && !window.isDestroyed()) window.webContents.send('band:message', message); };
function startWorker() {
  if (worker) return;
  const localPython = path.join(root, '.venv/bin/python');
  const bundledPython = path.join(process.resourcesPath, 'runtime/bin/python3.12');
  const executable = app.isPackaged ? bundledPython : (process.env.BAND_PYTHON || (fs.existsSync(localPython) ? localPython : 'python3'));
  worker = spawn(executable, ['-u', path.join(root, 'python/bridge.py')], { cwd: app.isPackaged ? app.getPath('userData') : root, env: {...process.env, PYTHONHOME: app.isPackaged ? path.join(process.resourcesPath, 'runtime') : process.env.PYTHONHOME, PYTHONNOUSERSITE:'1', PYTHONDONTWRITEBYTECODE:'1', NEURAL_MODEL_HOME:path.join(app.getPath('userData'),'model-lab'), NEURAL_IDENTITY_MAP:path.join(app.getPath('userData'),'band-identities.json'),NEURAL_PHONE_LINK:path.join(root,'dist-electron/neural-phone-link'),NEURAL_PHONE_LINK_STATE:path.join(app.getPath('userData'),'phone-link.json')} });
  workerCommand({action:'air_preview',enabled:airCursorOverlay});
  createInterface({input:worker.stdout}).on('line', line => { try { const message=JSON.parse(line);if(message.kind==='meta_login')void handleMetaLogin(message);else if(message.kind==='meta_login_cancel'){if(loginRequest===message.request_id){loginRequest=undefined;activeLogin?.cancel();}}else{phoneLinkMessage(message);publish(message);} } catch { publish({kind:'error',message:'Invalid bridge response'}); } });
  worker.stderr.on('data', data => publish({kind:'log',message:data.toString().slice(0,2000)}));
  worker.on('error', error => publish({kind:'error',message:error.message}));
  worker.on('exit', code => {loginRequest=undefined;activeLogin?.cancel();worker=undefined; publish({kind:'state',state:'disconnected'}); if(code) publish({kind:'error',message:`Python bridge exited (${code}). Check the Python environment.`});
    // The bridge holds the iPhone link; bring it back without user action.
    if(!quitting)setTimeout(()=>{if(!quitting)startWorker();},2000);});
}
ipcMain.on('band:command', (event, command) => {
  if(quitting || !command)return;
  if(isLiveWindow(cheatSheet) && event.sender===cheatSheet.webContents){
    if(command.action==='cheat_sheet_ready'){cheatSheetState();}
    if(command.action==='cheat_sheet_present'&&!cheatSheetClosing){cheatSheet?.showInactive();comboViewer?.moveTop();cheatSheet?.webContents.send('band:message',{kind:'cheat_sheet_open'});}
    if(command.action==='cheat_sheet_close')dismissCheatSheet();
    if(command.action==='cheat_sheet_closed')cheatSheet?.destroy();
    return;
  }
  if(isLiveWindow(airCursor) && event.sender===airCursor.webContents){
    if(command.action==='air_preview_ready'){airCursorReady=true;presentAirCursor();}
    return;
  }
  if(isLiveWindow(comboViewer) && event.sender===comboViewer.webContents){
    if(command.action==='combo_viewer_shape'&&Number.isFinite(command.left)&&Number.isFinite(command.right)&&command.left>=0&&command.right>=0){
      comboViewerShape={left:Math.min(command.left,2000),right:Math.min(command.right,2000)};
      cheatSheet?.webContents.send('band:message',{kind:'cheat_sheet_origin',...cheatSheetOrigin(comboViewerShape)});
    }
    if(command.action==='combo_viewer_ready'){comboViewerState();if(cheatSheet)comboViewer?.webContents.send('band:message',{kind:'cheat_sheet_visibility',open:true});comboViewer?.showInactive();if(cheatSheet)comboViewer?.moveTop();}
    return;
  }
  if(isLiveWindow(picker) && event.sender===picker.webContents){
    if(command.action==='picker_ready'){pickerReady=true;presentPicker();}
    if(command.action==='picker_cancel')closePicker();
    if(command.action==='picker_select'){const index=pickerEntries().findIndex(p=>p.id===command.profileId);if(index>=0){if(index!==pickerSelected){pickerSelected=index;const count=pickerEntries().length||1;pickerAngle=radialItems?.[index]?.angle??index/count*Math.PI*2;pickerSlot=index;pickerState();}closePicker(true);}}
    return;
  }
  if(!isLiveWindow(window) || event.sender !== window.webContents)return;
  if(command.action==='cheat_sheet_descriptions'){
    const value=command.descriptions;
    cheatSheetDescriptions=value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).filter((entry):entry is [string,string]=>typeof entry[1]==='string').map(([id,text])=>[id,text.trim().slice(0,200)])):{};
    cheatSheetState();return;
  }
  if(command.action==='configure_shortcuts'||command.action==='suspend_shortcuts'&&command.suspended!==false)hideAirCursor();
  if(command.action==='configure_shortcuts'){
    cheatSheetDescriptions=command.cheatSheetDescriptions&&typeof command.cheatSheetDescriptions==='object'&&!Array.isArray(command.cheatSheetDescriptions)?Object.fromEntries(Object.entries(command.cheatSheetDescriptions).filter((entry):entry is [string,string]=>typeof entry[1]==='string').map(([id,text])=>[id,text.slice(0,200)])):{};
    configuredAssignments=Array.isArray(command.assignments)?command.assignments:[];comboViewerState();cheatSheetState();
    if(pickerOpen)closePicker();
    const opener=Array.isArray(command.assignments)?command.assignments.find((a:any)=>a?.enabled&&a.appAction?.type==='open-profile-picker'&&typeof a.id==='string'&&!a.id.startsWith('tap-')&&!a.id.startsWith('double-tap-')):undefined;
    pickerOpener=opener?.id;
  }
  if(command.action==='picker_profiles'){
    if(Array.isArray(command.profiles))pickerProfiles=command.profiles.filter((p:any)=>p&&typeof p.id==='string'&&typeof p.name==='string');
    pickerActive=command.activeId;cheatSheetState();
    if(pickerOpen)closePicker();
    return;
  }
  if(command.action === 'accessibility') {
    if(process.platform === 'darwin') { systemPreferences.isTrustedAccessibilityClient(true); shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'); }
    return;
  }
  // Direct band commands are not forwarded: the Mac receives gestures only from iPhone.
  if(!['configure_shortcuts','suspend_shortcuts','phone_status','phone_pair','phone_forget','motion_view','shutdown','native_handwriting_status','native_handwriting_start','native_handwriting_stop','native_handwriting_clear','model_status','model_leave','model_install','model_cancel','model_capture_start','model_capture_stop','model_run'].includes(command.action)) return;
  startWorker(); worker?.stdin.write(JSON.stringify(command)+'\n');
});
if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', () => { if (window) showWindow(); });
app.whenReady().then(() => {
  try { const saved=JSON.parse(fs.readFileSync(preferencesPath(), 'utf8')); runInBackground=saved.runInBackground!==false; compactRadialMenus=saved.compactRadialMenus===true;keepRadialMenuOpen=saved.keepRadialMenuOpen===true;radialMenuFollowsMouse=saved.radialMenuFollowsMouse===true;floatingComboViewer=saved.floatingComboViewer===true;airCursorOverlay=saved.airCursorOverlay===true;notchMenuNames=saved.notchMenuNames!==false;notchComboViewerSides=validNotchSides(saved.notchComboViewerSides)?saved.notchComboViewerSides:'both'; } catch { /* First launch uses defaults. */ }
  // Defaults: open at login once (the user can turn it off), run in the background, menu bar status always.
  const firstRunPath=path.join(app.getPath('userData'),'login-default-applied');
  if(process.platform==='darwin'&&app.isPackaged&&!fs.existsSync(firstRunPath)){try{app.setLoginItemSettings({openAtLogin:true});fs.mkdirSync(app.getPath('userData'),{recursive:true});fs.writeFileSync(firstRunPath,'1');}catch{/* Login Items may need approval in System Settings. */}}
  const backgroundLaunch = process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin;
  ensureTray();
  window = new BrowserWindow({show:!backgroundLaunch,width:1450,height:950,minWidth:860,minHeight:680,title:'Neural — Motions',backgroundColor:'#ffffff',titleBarStyle:'hiddenInset',webPreferences:{preload:path.join(root,'dist-electron/preload.cjs'),backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,sandbox:true}});
  syncComboViewer();syncAirCursor();startWorker();
  screen.on('display-added',refreshNotchGeometry);
  screen.on('display-removed',refreshNotchGeometry);
  screen.on('display-metrics-changed',refreshNotchGeometry);
  window.on('closed',()=>{
    clearTimeout(airCursorResultTimer);clearTimeout(airCursorExitTimer);clearTimeout(airCursorHideTimer);clearInterval(airCursorTimer);
    clearTimeout(pickerTimer);clearTimeout(pickerHideTimer);clearInterval(pickerFollowTimer);
    airCursorResultTimer=airCursorExitTimer=airCursorHideTimer=airCursorTimer=undefined;
    pickerTimer=pickerHideTimer=pickerFollowTimer=undefined;
    pickerOpen=false;pickerReady=false;airCursorReady=false;
    for(const overlay of [airCursor,comboViewer,picker])if(isLiveWindow(overlay))overlay.destroy();
    airCursor=comboViewer=picker=undefined;
  });
  window.on('close', event => {
    if (!quitting && runInBackground) { event.preventDefault(); hideWindow(); }
  });
  if (backgroundLaunch) app.dock?.hide();
  app.on('activate', showWindow);
  window.webContents.setWindowOpenHandler(({url})=>{if(['https://github.com/facebookresearch/emg2pose','https://github.com/facebookresearch/generic-neuromotor-interface'].includes(url))void shell.openExternal(url);return {action:'deny'};});
  window.webContents.on('will-navigate',(event,url)=>{ if(!url.startsWith('http://127.0.0.1:5190/') && !url.startsWith('file://')) event.preventDefault(); });
  if(process.argv.includes('--dev') || !fs.existsSync(path.join(root,'dist/index.html'))) window.loadURL('http://127.0.0.1:5190');
  else window.loadFile(path.join(root,'dist/index.html'));
});
app.on('before-quit', event => {activeLogin?.cancel();const alreadyQuitting=quitting;quitting=true;if(worker && !alreadyQuitting){event.preventDefault();worker.stdin.write('{"action":"shutdown"}\n');const timeout=setTimeout(()=>{worker?.kill();app.quit();},5000);worker.once('exit',()=>{clearTimeout(timeout);app.quit();});}});
app.on('window-all-closed',()=>app.quit());
