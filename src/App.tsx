import {normalizeCheatSheetDescriptions} from './shortcuts';
import {hasCopiedAssignment,pasteAssignment} from './assignmentClipboard';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Activity,Radio,Layers3,SlidersHorizontal,ArrowUpRight,ChevronRight,ChevronDown,Download,Pause,Play,ScanLine,Battery,MoveUpRight,Rotate3D,Hand,ArrowLeft,X,RefreshCw,Check,Unplug,FileJson, Circle,Info,Plus,Home,Briefcase,Code2,Music,Gamepad2,Camera,PenTool,Globe,Star,Heart,Monitor,Headphones,Trash2,Pencil,Shapes} from 'lucide-react';
import type {Device,Message,Packet} from './types';
import {simulate} from './simulation';
import {MotionVisual,OrientationVisual} from './SensorVisuals';
import {GestureInspector} from './GestureInspector';
import {gestureMeaning} from './gestureLabels';
import {PairingScreen,PhoneSettings,phoneStatus,usePhoneLink} from './PhoneLink';
import {confirmPhoneOverlap,macBindings,newlySet,usePhoneBindings} from './linkedBindings';
import {AppSettings} from './AppSettings';
import {ModelTests} from './ModelTests';
import {AirGestureTest} from './AirGestureTest';
import {ComboTracker} from './ComboTracker';
import {MotionSettings} from './MotionSettings';
import {canReceiveOutput,loadAssignments,motions,normalizeAssignments,type Assignment} from './shortcuts';
import {noteComboOutcome, noteComboProgress, playAdjustTick, playConnectBell, playDisconnectBell} from './connectBell';

const profileIcons={home:Home,work:Briefcase,code:Code2,music:Music,game:Gamepad2,camera:Camera,design:PenTool,globe:Globe,star:Star,heart:Heart,monitor:Monitor,headphones:Headphones};
type ProfileIcon=keyof typeof profileIcons;
type MotionProfile={id:string;name:string;icon?:ProfileIcon;assignments:Assignment[];cheatSheetDescriptions?:Record<string,string>};
function loadProfiles():{profiles:MotionProfile[];activeId:string;sharedIds?:string[];sharedPicker?:Assignment}{
 try{const saved=JSON.parse(localStorage.getItem('runes.profiles.v1')||'null');if(Array.isArray(saved?.profiles)&&saved.profiles.length){const profiles:MotionProfile[]=saved.profiles.filter((p:any)=>p&&typeof p.id==='string'&&typeof p.name==='string'&&p.name.trim()).map((p:any)=>({...p,assignments:normalizeAssignments(p.assignments),cheatSheetDescriptions:normalizeCheatSheetDescriptions(p.cheatSheetDescriptions)}));if(profiles.length)return {profiles,sharedIds:Array.isArray(saved.sharedIds)?saved.sharedIds.filter((id:unknown)=>typeof id==='string'):saved.sharedPicker?[saved.sharedPicker.id]:[],sharedPicker:normalizeAssignments([saved.sharedPicker]).find(a=>a.appAction?.type==='open-profile-picker'),activeId:profiles.some(p=>p.id===saved.activeId)?saved.activeId:profiles[0].id};}}catch{}
 return {profiles:[{id:'main',name:'main',assignments:loadAssignments()}],activeId:'main'};
}

type Snapshot={channels:number[][];gyro:number[];orientation:number[];gestures:Packet[];gestureCount:number;packets:Packet[];count:number;samples:number;stats:Record<string,any>};
const empty=():Snapshot=>({channels:Array.from({length:8},()=>[]),gyro:[],orientation:[],gestures:[],gestureCount:0,packets:[],count:0,samples:0,stats:{}});
const connectionBusy=(state:string)=>['connecting','enrolling','reconnecting','disconnecting'].includes(state);
function connectionPaused(){try{return localStorage.getItem('runes.connectionPaused.v1')==='true';}catch{return false;}}
const names=['Live signals','Event inspector','Device settings','Gesture inspector','Motions','Model experiments','Air gestures'];
function download(data:unknown,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
function Trace({data,height=42,range=1500,center=32768,windowSize=data.length}:{data:number[];height?:number;range?:number;center?:number;windowSize?:number}){
 const w=800;
 // A short moving average only affects the display; acquired samples stay untouched.
 let sum=0;const smooth=data.map((v,i)=>{sum+=v;if(i>=5)sum-=data[i-5];return sum/Math.min(i+1,5);});
 const stride=Math.max(1,Math.floor(windowSize/w));
 const points=smooth.flatMap((v,i)=>i%stride===0||i===data.length-1?[`${(windowSize-data.length+i)/Math.max(1,windowSize-1)*w},${height/2-(v-center)/range*(height*.42)}`]:[]).join(' ');
 return <svg className="trace" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-label="Signal waveform"><line x1="0" x2={w} y1={height/2} y2={height/2} stroke="#ebebeb"/>{data.length>0&&<polyline points={points} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke"/>}</svg>;
}
function App(){
 const [identityChoices,setIdentityChoices]=useState<any[]>([]),[identityChoice,setIdentityChoice]=useState(''),[activeIdentityAccount,setActiveIdentityAccount]=useState(''),[identityError,setIdentityError]=useState(''),[confirmEnrollment,setConfirmEnrollment]=useState(false);
 const phone=usePhoneLink();
 const phoneBindings=usePhoneBindings();
 const [page,setPage]=useState(4),[demo,setDemo]=useState(false),[state,setState]=useState('disconnected'),[snapshot,setSnapshot]=useState<Snapshot>(empty),[paused,setPaused]=useState(false),[devices,setDevices]=useState<Device[]>([]),[selected,setSelected]=useState(()=>{try{return localStorage.getItem('runes.band.v1')||'';}catch{return '';}}),[dialog,setDialog]=useState(false),[scanning,setScanning]=useState(false),[autoWatch,setAutoWatch]=useState(()=>!connectionPaused()),[connectedNote,setConnectedNote]=useState(0),[error,setError]=useState(''),[battery,setBattery]=useState<number|null>(null),[hand,setHand]=useState('—'),[verified,setVerified]=useState(false),[info,setInfo]=useState<unknown>(null),[elapsed,setElapsed]=useState(0),[windowSize,setWindowSize]=useState(4096),[gain,setGain]=useState(1),[channels,setChannels]=useState(Array.from({length:8},(_,i)=>i===0)),[chosenPacket,setChosenPacket]=useState<Packet|null>(null),[filter,setFilter]=useState('All events'),[notice,setNotice]=useState(''),[chosenGesture,setChosenGesture]=useState<Packet|null>(null);
 useEffect(()=>{if(dialog){setIdentityError('');window.band?.send({action:'identities'});}},[dialog]);
 useEffect(()=>{setIdentityChoice('');setActiveIdentityAccount('');},[selected]);
 useEffect(()=>{if(!dialog)return;const previous=document.activeElement as HTMLElement;const handler=(e:KeyboardEvent)=>{if(e.key==='Escape')setDialog(false);if(e.key==='Tab'){const controls=Array.from(document.querySelectorAll<HTMLElement>('.modal button:not(:disabled),.modal select,.modal input,.modal summary'));const visible=controls.filter(control=>control.getClientRects().length>0);const first=visible[0],last=visible[visible.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};document.addEventListener('keydown',handler);document.querySelector<HTMLElement>('.modal-close')?.focus();return()=>{document.removeEventListener('keydown',handler);previous?.focus();};},[dialog]);
 const [profileState,setProfileState]=useState(loadProfiles),[editingShortcut,setEditingShortcut]=useState(false),[iconPicker,setIconPicker]=useState<'add'|'edit'|null>(null),[renamingProfile,setRenamingProfile]=useState(false);
 const [profileMenu,setProfileMenu]=useState<{id:string;x:number;y:number}|null>(null);
 const profileMenuRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!profileMenu)return;
  profileMenuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  const dismiss=(event:PointerEvent)=>{if(!profileMenuRef.current?.contains(event.target as Node))setProfileMenu(null);};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setProfileMenu(null);profileRail.current?.querySelector<HTMLButtonElement>(`button[data-profile-id="${profileMenu.id}"]`)?.focus();}if(event.key==='Tab')setProfileMenu(null);};
  const close=()=>setProfileMenu(null);
  document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',escape);window.addEventListener('resize',close);window.addEventListener('scroll',close,true);
  return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape);window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true);};
 },[profileMenu]);
 function editProfile(id:string,action:'rename'|'icon'){
  setProfileMenu(null);setEditingShortcut(false);setRenamingProfile(false);
  setProfileState(current=>({...current,activeId:id}));setIconPicker(action==='icon'?'edit':null);
  if(action==='rename')requestAnimationFrame(()=>{const heading=document.querySelector<HTMLElement>('.profile-heading');if(heading){heading.focus();const range=document.createRange();range.selectNodeContents(heading);const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);}});
 }
 const activeProfile=profileState.profiles.find(p=>p.id===profileState.activeId)!;
 const profileRail=useRef<HTMLElement>(null);
 const shortcutDrag=useRef<string|null>(null);
 const [shortcutHover,setShortcutHover]=useState<string|null>(null);
 useEffect(()=>{if(!iconPicker)return;const dismiss=(event:PointerEvent)=>{if(!profileRail.current?.contains(event.target as Node))setIconPicker(null);};const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setIconPicker(null);};document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape);};},[iconPicker]);
 const assignments=profileState.profiles.find(p=>p.id===profileState.activeId)!.assignments;
 const assignmentsRef=useRef(assignments);
 assignmentsRef.current=assignments;
 function confirmUnshare(ids:string[]){return !ids.length||window.confirm('Remove “All profiles” for this gesture assignment? Your change will apply only to this profile. Existing mappings in other profiles will stay as they are.');}
 function setAssignments(assignments:Assignment[],profileId=profileState.activeId){
  const previous=profileState.profiles.find(p=>p.id===profileId)?.assignments??[];
  const layoutEdit=assignments.find(a=>{const old=previous.find(p=>p.id===a.id);return a.appAction?.type==='open-profile-picker'&&old?.appAction?.type==='open-profile-picker'&&JSON.stringify({...a,appAction:{type:'open-profile-picker'}})===JSON.stringify({...old,appAction:{type:'open-profile-picker'}})&&JSON.stringify(a.appAction)!==JSON.stringify(old.appAction);});
  const removed=(profileState.sharedIds??[]).filter(id=>id!==layoutEdit?.id&&JSON.stringify(previous.find(a=>a.id===id))!==JSON.stringify(assignments.find(a=>a.id===id)));
  if(!confirmUnshare(removed))return;
  if(!confirmPhoneOverlap(newlySet(previous,assignments),phoneBindings))return;
  setProfileState(current=>{
   let sharedIds=(current.sharedIds??[]).filter(id=>!removed.includes(id));
   // The picker setup explicitly opts into sharing, just like the row control.
   const picker=assignments.find(a=>a.appAction?.type==='open-profile-picker'&&previous.find(old=>old.id===a.id)?.appAction?.type!=='open-profile-picker');
   if(picker&&!sharedIds.includes(picker.id))sharedIds=[...sharedIds,picker.id];
   const profiles=current.profiles.map(p=>{
    let next=p.id===profileId?assignments:p.assignments;
    if(picker)next=[...next.filter(a=>a.id!==picker.id),picker];
    if(layoutEdit&&sharedIds.includes(layoutEdit.id))next=next.map(a=>a.id===layoutEdit.id?layoutEdit:a);
    return {...p,assignments:normalizeAssignments(next)};
   });
   return {...current,profiles,sharedIds,sharedPicker:undefined};
  });
 }
 function toggleShared(id:string){
  const shared=(profileState.sharedIds??[]).includes(id);
  if(shared&&!confirmUnshare([id]))return;
  if(!shared&&!window.confirm('Use this gesture assignment in all current and future profiles? It will replace the mapping for this gesture in every profile.'))return;
  setProfileState(current=>{
   const assignment=current.profiles.find(p=>p.id===current.activeId)?.assignments.find(a=>a.id===id);
   if(!assignment)return current;
   return {...current,sharedPicker:undefined,sharedIds:shared?(current.sharedIds??[]).filter(value=>value!==id):[...(current.sharedIds??[]),id],profiles:shared?current.profiles:current.profiles.map(p=>({...p,assignments:normalizeAssignments([...p.assignments.filter(a=>a.id!==id),assignment])}))};
  });
 }
 function relocateShortcut(fromId:string,toProfileId:string|null,toId:string){
  if((toProfileId===null||toProfileId===profileState.activeId)&&fromId===toId)return;
  const removed=(profileState.sharedIds??[]).filter(id=>id===fromId||id===toId);
  if(!confirmUnshare(removed))return;
  setProfileState(current=>{
  const profileId=toProfileId??current.activeId;
  if(profileId===current.activeId&&toId===fromId)return current;
  const profiles=current.profiles.map(p=>({...p,assignments:p.assignments.map(a=>({...a,steps:a.steps?.map(step=>({...step}))}))}));
  const source=profiles.find(p=>p.id===current.activeId)?.assignments.find(a=>a.id===fromId);
  const destProfile=profiles.find(p=>p.id===profileId);
  if(!source||!destProfile||(!source.shortcut&&!source.appAction))return current;
  let dest=destProfile.assignments.find(a=>a.id===toId);
  if(!dest&&toId.startsWith('combo-')&&source.steps){dest={id:source.id,enabled:false,shortcut:null,steps:source.steps.map(step=>({...step})),intervalMs:source.intervalMs};destProfile.assignments=[...destProfile.assignments,dest];}
  if(!dest||!canReceiveOutput(source,dest)||(source.appAction?.type==='open-profile-picker'&&dest.appAction?.type==='open-profile-picker'))return current;
  const moved={shortcut:source.shortcut,appAction:source.appAction,enabled:source.enabled};
  const displaced={shortcut:dest.shortcut,appAction:dest.appAction,enabled:dest.enabled};
  source.shortcut=displaced.shortcut??null;source.appAction=displaced.shortcut||displaced.appAction?displaced.appAction:undefined;source.enabled=!!(displaced.shortcut||displaced.appAction)&&displaced.enabled;
  dest.shortcut=moved.shortcut;dest.appAction=moved.appAction;dest.enabled=moved.enabled;
  return {...current,profiles,sharedPicker:undefined,sharedIds:(current.sharedIds??[]).filter(id=>!removed.includes(id))};
 });setShortcutHover(null);}
 function selectProfile(id:string){setRenamingProfile(false);setEditingShortcut(false);setIconPicker(id===profileState.activeId?(iconPicker==='edit'?null:'edit'):null);setProfileState(current=>({...current,activeId:id}));}
 function chooseProfileIcon(icon:ProfileIcon){if(iconPicker==='add'){const id=crypto.randomUUID();setEditingShortcut(false);setProfileState(current=>({...current,profiles:[...current.profiles,{id,name:`Profile ${current.profiles.length+1}`,icon,assignments:normalizeAssignments(current.profiles.find(p=>p.id===current.activeId)!.assignments.filter(a=>(current.sharedIds??[]).includes(a.id)))}],activeId:id}));}else{setProfileState(current=>({...current,profiles:current.profiles.map(p=>p.id===current.activeId?{...p,icon}:p)}));}setIconPicker(null);}
 function deleteProfile(id=profileState.activeId){
  setProfileState(current=>{
   if(current.profiles.length<=1||!current.profiles.some(p=>p.id===id))return current;
   const index=current.profiles.findIndex(p=>p.id===id);
   const profiles=current.profiles.filter(p=>p.id!==id);
   return {...current,profiles,activeId:current.activeId===id?profiles[Math.min(index,profiles.length-1)].id:current.activeId};
  });
  setProfileMenu(null);setIconPicker(null);setEditingShortcut(false);setRenamingProfile(false);
 }
 function renameProfile(element:HTMLElement){const name=(element.textContent||'').trim().slice(0,32)||activeProfile.name;element.textContent=name;setProfileState(current=>({...current,profiles:current.profiles.map(p=>p.id===current.activeId?{...p,name}:p)}));setRenamingProfile(false);}

 useEffect(()=>{try{localStorage.setItem('runes.profiles.v1',JSON.stringify(profileState));}catch{setError('Could not save profiles on this Mac. Check available storage.');}},[profileState]);
 useEffect(()=>{window.band?.send({action:'phone_bindings',entries:macBindings(profileState.profiles)});},[profileState.profiles]);
 useEffect(()=>{try{localStorage.setItem('runes.assignments.v1',JSON.stringify(assignments));}catch{setError('Could not save shortcuts on this Mac. Check available storage.');}window.band?.send({action:'configure_shortcuts',assignments,cheatSheetDescriptions:activeProfile.cheatSheetDescriptions});},[assignments]);
 useEffect(()=>{window.band?.send({action:'cheat_sheet_descriptions',descriptions:activeProfile.cheatSheetDescriptions});},[activeProfile.id,activeProfile.cheatSheetDescriptions]);
 useEffect(()=>{window.band?.send({action:'picker_profiles',profiles:profileState.profiles.map(({id,name,icon})=>({id,name,icon})),activeId:profileState.activeId});},[profileState]);
 useEffect(()=>window.band?.onMessage(message=>{if(message.kind!=='app_action')return;const action=message.action;if(action?.type==='change-profile'){setProfileState(current=>current.profiles.some(p=>p.id===action.profileId)?{...current,activeId:action.profileId}:current);}else if(action?.type==='move-profile'&&['up','down'].includes(action.direction)){setProfileState(current=>{const index=current.profiles.findIndex(p=>p.id===current.activeId);const next=Math.max(0,Math.min(current.profiles.length-1,index+(action.direction==='up'?-1:1)));return {...current,activeId:current.profiles[next].id};});}}),[]);
 const [windowHidden,setWindowHidden]=useState(document.hidden);
 useEffect(()=>{const changed=()=>setWindowHidden(document.hidden);document.addEventListener('visibilitychange',changed);return()=>document.removeEventListener('visibilitychange',changed);},[]);
 useEffect(()=>{window.band?.send({action:'suspend_shortcuts',suspended:!windowHidden&&(editingShortcut||renamingProfile||iconPicker!==null||profileMenu!==null||page!==4||dialog)});},[editingShortcut,renamingProfile,iconPicker,profileMenu,page,dialog,windowHidden]);
 const bandFrame=useRef<HTMLIFrameElement>(null);
 function toggleChannel(i:number){setChannels(v=>v[i]&&v.filter(Boolean).length===1?v:v.map((x,j)=>j===i?!x:x));}
 function syncBand(){bandFrame.current?.contentWindow?.postMessage({type:'band-selection',channels},window.location.protocol==='file:'?'*':window.location.origin);}
 useEffect(()=>{syncBand();},[channels,page]);
 useEffect(()=>{const receive=(event:MessageEvent)=>{if(event.origin!==(window.location.protocol==='file:'?'null':window.location.origin)||event.source!==bandFrame.current?.contentWindow)return;const i=event.data?.electrode;if(event.data?.type==='band-toggle'&&Number.isInteger(i)&&i>=0&&i<8)toggleChannel(i);};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[]);
 const [connectionFeedback,setConnectionFeedback]=useState(''),[feedbackVisible,setFeedbackVisible]=useState(false);
 const connectionFeedbackTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 function showConnectionFeedback(message:string){if(connectionFeedbackTimer.current)clearTimeout(connectionFeedbackTimer.current);setConnectionFeedback(message);setFeedbackVisible(true);connectionFeedbackTimer.current=setTimeout(()=>setFeedbackVisible(false),3500);}
 useEffect(()=>()=>{if(connectionFeedbackTimer.current)clearTimeout(connectionFeedbackTimer.current);},[]);
 const autoConnect=useRef(!connectionPaused()),blockConnect=useRef(false),watchGen=useRef(0),preferredRef=useRef(selected),stateRef=useRef('disconnected'),choicePrompt=useRef('');
 const [watchTick,setWatchTick]=useState(0);
 const data=useRef(empty()),pauseRef=useRef(false),demoRef=useRef(false);
 function setConnection(next:string | ((current:string)=>string)){const value=typeof next==='function'?next(stateRef.current):next;stateRef.current=value;setState(value);}
 function rememberBand(id:string){preferredRef.current=id;try{localStorage.setItem('runes.band.v1',id);}catch{/* The next launch can scan without a preference. */}}
 function pauseWatch(){try{localStorage.setItem('runes.connectionPaused.v1','true');}catch{}autoConnect.current=false;watchGen.current+=1;setAutoWatch(false);}
 function resumeWatch(){try{localStorage.setItem('runes.connectionPaused.v1','false');}catch{}blockConnect.current=false;autoConnect.current=true;setAutoWatch(true);setWatchTick(tick=>tick+1);}
 function announceConnected(){playConnectBell();setConnectedNote(note=>note+1);}
 function beginConnect(id:string,quiet:boolean,choice=''){if(!id||!window.band||blockConnect.current||connectionBusy(stateRef.current)||stateRef.current==='connected')return;try{localStorage.setItem('runes.connectionPaused.v1','false');}catch{}watchGen.current+=1;autoConnect.current=true;setAutoWatch(true);setDemo(false);demoRef.current=false;rememberBand(id);setSelected(id);reset();setError('');setScanning(false);setConnection('connecting');window.band.send({action:'connect',device_id:id,...(quiet?{quiet:true}:{}),...(choice?{identity_account:choice.split(':')[0],pending:choice.endsWith(':pending')}:{})});}
 const connected=demo||state==='connected';
 function reset(){data.current=empty();setSnapshot(empty());setElapsed(0);setChosenPacket(null);setChosenGesture(null);}
 function ingest(events:Packet[],stats?:Record<string,any>){const s=data.current;for(const p of events){s.count++;s.packets.unshift(p);s.packets=s.packets.slice(0,100);if(p.type==='EMGBatch'&&p.values){for(const row of p.values as number[][]){row.forEach((v,c)=>{s.channels[c]?.push(v);});s.samples++;}s.channels=s.channels.map(c=>c.slice(-8192));}if(p.type==='Gyroscope')s.gyro=p.values as number[];if(p.type==='Orientation')s.orientation=p.values as number[];if(p.type==='Gesture'){s.gestureCount++;s.gestures=[p,...s.gestures].slice(0,200);}}if(stats)s.stats=stats;}
 useEffect(()=>{pauseRef.current=paused;},[paused]);
 useEffect(()=>{demoRef.current=demo;},[demo]);
 useEffect(()=>window.band?.onMessage((m:Message)=>{if(m.kind==='adjust_tick')playAdjustTick();if(m.kind==='combo_progress')noteComboProgress(m.candidates,id=>assignmentsRef.current.find(a=>a.id===id&&a.enabled&&a.steps)?.steps?.length??0);if(m.kind==='combo_outcome'&&m.status==='success'&&assignmentsRef.current.some(a=>a.id===m.id&&a.enabled&&!!a.steps))noteComboOutcome(m.attemptId,assignmentsRef.current.find(a=>a.id===m.id)?.steps?.length);if(m.kind==='events'){ingest(m.events,m.stats);if(m.events.some((event:Packet)=>event.type==='Gesture'))setPage(current=>current===2?4:current);}if(m.kind==='devices'){
  const found:Device[]=Array.from(new Map<string,Device>((Array.isArray(m.devices)?m.devices:[]).filter(d=>d&&typeof d.id==='string').map(d=>[d.id,d])).values());
  const watchId=typeof m.request_id==='string'&&m.request_id.startsWith('watch:')?Number(m.request_id.slice(6)):null;
  const watching=watchId!==null;
  if(watching&&(watchId!==watchGen.current||!autoConnect.current||demoRef.current)){if(autoConnect.current&&!demoRef.current&&stateRef.current==='disconnected')setWatchTick(tick=>tick+1);return;}
  setDevices(found);
  if(found.length){const preferred=found.find(d=>d.id===preferredRef.current);setSelected((preferred||found[0]).id);}
  const target=found.length===1?found[0]:found.find(d=>d.id===preferredRef.current);
  if(target&&autoConnect.current&&!demoRef.current&&stateRef.current==='disconnected'){beginConnect(target.id,watching);return;}
  if(!watching){showConnectionFeedback(found.length?found.length===1?'Band found. Ready to connect.':'Bands found. Choose a band to connect.':'No bands found.');setScanning(false);}
  if(found.length>1&&!target){const key=found.map(d=>d.id).sort().join('\n');if(choicePrompt.current!==key){choicePrompt.current=key;setDialog(true);}}
  if(autoConnect.current&&!demoRef.current&&stateRef.current==='disconnected')setWatchTick(tick=>tick+1);
 }if(m.kind==='state'){if(m.state==='connected'&&blockConnect.current){window.band?.send({action:'disconnect'});return;}const previous=stateRef.current;setConnection(m.state);if(m.state==='connected'){if(previous!=='connected'&&!demoRef.current)announceConnected();showConnectionFeedback('Band connected');setElapsed(0);setDialog(false);setError('');}else if(m.state==='disconnected'){setBattery(null);if(previous==='connected'&&!demoRef.current){playDisconnectBell();showConnectionFeedback('Band disconnected');}}}if(m.kind==='device'){setInfo(m.info);setVerified(m.verified);setHand(m.hand);setBattery(m.battery?.level??null);}if(m.kind==='battery')setBattery(m.battery?.level??null);if(m.kind==='api_result'&&!m.ok){setError(m.message);}if(m.kind==='error'){setError(m.message);setScanning(false);showConnectionFeedback('Could not connect. Try again.');setConnection(current=>current==='connecting'||current==='enrolling'?'disconnected':current);}if(m.kind==='connection_progress'){setNotice(m.message);}if(m.kind==='identities'){setIdentityChoices(m.identities);setIdentityError('');}if(m.kind==='identity_selected'){setActiveIdentityAccount(m.account);}if(m.kind==='identity_catalog_error'){setIdentityError(m.message);}if((m.kind==='handoff_ready'||m.kind==='handoff_unconfirmed')&&!demoRef.current){setNotice(m.message);setDialog(true);}if(m.kind==='connection_recovery'){pauseWatch();blockConnect.current=true;setConfirmEnrollment(false);if(typeof m.device_id==='string'){setSelected(m.device_id);rememberBand(m.device_id);}setNotice(m.message);setDialog(true);setError(m.detail||'');}if(m.kind==='enrolled')setNotice('Meta sign-in complete. Reconnecting your band…');}),[]);
 // The Mac never looks for the band itself; gestures arrive from Runes on iPhone.
 useEffect(()=>{window.band?.send({action:'motion_view',enabled:[1,3,6].includes(page)});},[page]);
 useEffect(()=>{const id=setInterval(()=>{if(!pauseRef.current){const s=data.current;setSnapshot({...s,channels:s.channels.map(c=>[...c]),packets:[...s.packets],gestures:[...s.gestures]});}},100);return()=>clearInterval(id);},[]);
 useEffect(()=>{if(!demo)return;let tick=0;const id=setInterval(()=>{for(let n=0;n<4;n++)ingest(simulate(tick++));},31.25);return()=>clearInterval(id);},[demo]);
 useEffect(()=>{if(!connected)return;const id=setInterval(()=>setElapsed(v=>v+1),1000);return()=>clearInterval(id);},[connected]);
 function scan(){if(connectionBusy(stateRef.current))return;try{localStorage.setItem('runes.connectionPaused.v1','false');}catch{}blockConnect.current=false;watchGen.current+=1;autoConnect.current=true;setAutoWatch(true);setError('');setDevices([]);setScanning(true);if(!window.band){setScanning(false);showConnectionFeedback('Bluetooth is available in the desktop app.');setError('Bluetooth discovery is available in the Electron app. Run npm run desktop, or explore the demo here.');return;}window.band.send({action:'discover',request_id:'manual'});}
 function startDemo(){if(stateRef.current==='connected')playDisconnectBell();blockConnect.current=true;pauseWatch();setScanning(false);window.band?.send({action:'disconnect'});reset();setDemo(true);demoRef.current=true;setConnection('disconnected');setDialog(false);setError('');setBattery(null);setHand('—');setInfo(null);}
 function exitDemo(){setDemo(false);demoRef.current=false;resumeWatch();}
 function disconnect(){blockConnect.current=true;pauseWatch();setConfirmEnrollment(false);setScanning(false);setDemo(false);demoRef.current=false;setNotice('Stopping streams and closing the local connection…');setConnection('disconnecting');setDialog(true);window.band?.send({action:'disconnect'});}
 function enrollAgain(){pauseWatch();setConfirmEnrollment(true);setDialog(true);}
 function submitEnrollment(){setConfirmEnrollment(false);blockConnect.current=false;pauseWatch();setScanning(false);setDemo(false);demoRef.current=false;setError('');setNotice('Explicit ownership enrollment in progress. Canceling pauses connection attempts.');setConnection('enrolling');window.band?.send({action:'enroll',device_id:selected,allow_missing_band_key:true});}
 function connect(){if(connectionBusy(stateRef.current))return;blockConnect.current=false;if(stateRef.current==='connected'){window.band?.send({action:'connect',device_id:selected});setConnection('connecting');return;}beginConnect(selected,false,identityChoice);}
 const duration=`${Math.floor(elapsed/3600).toString().padStart(2,'0')}:${Math.floor(elapsed/60%60).toString().padStart(2,'0')}:${(elapsed%60).toString().padStart(2,'0')}`;
 const stateLabel=demo?'Demo stream':window.band?phoneStatus(phone.link):state==='connected'?'Band connected':state==='connecting'?'Connecting…':state==='enrolling'?'Enrolling…':state==='reconnecting'?'Reconnecting…':state==='disconnecting'?'Releasing band…':scanning?'Scanning for bands…':autoWatch&&window.band?'Looking for your band…':'No band connected';
 function openAccessibility(){window.band?window.band.send({action:'accessibility'}):setNotice('Open the desktop app to enable macOS Accessibility.');}
 const accessibilityAction=/accessibility/i.test(error)&&<button className="button" onClick={openAccessibility}>Open Accessibility settings <ArrowUpRight size={14}/></button>;
 const visible=snapshot.packets.filter(p=>filter==='All events'||p.type===filter);
 const gyroHistory=snapshot.packets.filter(p=>p.type==='Gyroscope').reverse();
 const connectionCopy=connected?(demo?'You’re exploring the demo.':'Ready when you are.'):state==='connecting'?'Connecting to your band…':state==='enrolling'?'Signing in with Meta…':state==='disconnecting'?'Wait for local stream and transport cleanup before connecting on iPhone.':state==='reconnecting'?'Retrying the same saved identity with a bounded delay.':!autoWatch?'Automatic connection is paused. Look for your band when you want Runes to keep trying.':scanning?'Looking for your band nearby…':devices.length>1?'More than one band is nearby. Choose the one Runes should connect.':'Put your band on. Runes keeps looking while the app is open, including in the background.';
 return <div className="app-shell">
  <div className="sr-only" role="status">{connectedNote?`Your band is connected. ${connectedNote}`:''}</div>
  <div className="app-navigation"><div className="navigation-inner"><div className="connection-mark"><button className={`brand ${state==='connected'&&!demo?'band-connected':''}${autoWatch&&!demo&&state==='disconnected'?' band-searching':''}`} aria-label={`${stateLabel}. iPhone settings`} aria-describedby="connection-feedback" onClick={()=>setPage(2)}><span className="connection-hand"><svg className="hand-fill" width="32" height="32" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14V6a2 2 0 0 1 4 0V4a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15Z" fill="currentColor"/></svg><Hand size={32} strokeWidth={1.5} aria-hidden="true"/></span></button><div id="connection-feedback" className={`connection-tooltip ${scanning||connectionBusy(state)||feedbackVisible?'visible':''}`} role="status">{stateLabel}</div></div><nav aria-label="Main navigation"><button className={page===4?'current':''} aria-current={page===4?'page':undefined} onClick={()=>setPage(4)}>Motions</button><button className={page===2?'current':''} aria-current={page===2?'page':undefined} onClick={()=>setPage(2)}>Device settings</button></nav><div className="nav-live"><ComboTracker assignments={assignments}/></div></div></div>
  <div className="main-shell">
   <main>
    <header className={`page-header ${page===4?'motions-header':''}`}><div>{page===4?<h1 key={activeProfile.id} className="profile-heading" contentEditable suppressContentEditableWarning role="textbox" aria-label="Profile name" aria-multiline="false" spellCheck={false} onFocus={()=>setRenamingProfile(true)} onBlur={event=>renameProfile(event.currentTarget)} onPaste={event=>{event.preventDefault();const text=event.clipboardData.getData('text/plain').replace(/[\r\n]+/g,' ').slice(0,32);document.execCommand('insertText',false,text);}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}if(event.key==='Escape'){event.currentTarget.textContent=activeProfile.name;event.currentTarget.blur();}}}>{activeProfile.name}</h1>:<h1>{page===2?'Device settings':'Device test'}</h1>}{page!==4&&<p>{page===0?'A closer look at what moves you.':page===1?'Every event, exactly as it arrives.':page===2?'Your iPhone and this Mac.':page===5?'On-band handwriting and research model tests.':page===6?'Trace and compare a gesture in the air.':'Finger events, with room for a closer look.'}</p>}</div><div className="header-actions">{page!==4&&connected&&<button className="button" onClick={()=>download({source:demo?'simulation':'hardware',...snapshot},'runes-snapshot.json')}><Download size={14}/> Export snapshot</button>}</div></header>
    {error&&<div className="message" role="alert"><Info size={16}/><span>{error}</span>{accessibilityAction}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={14}/></button></div>}
    {connected&&!demo&&elapsed>=30&&snapshot.count>0&&snapshot.gestureCount===0&&<div className="message" role="status"><Info size={16}/><span>No gestures received yet. Check that the band fits snugly and try an index or middle tap. Runes on iPhone shows whether the band is connected.</span></div>}
    {notice&&<div className="message"><Check size={15}/><span>{notice}</span><button onClick={()=>setNotice('')} aria-label="Dismiss notice"><X size={14}/></button></div>}
    {demo&&page!==4&&<div className="demo-notice"><span><Circle size={10}/> Demo mode <span className="muted">· Simulated signals. No band data is being collected.</span></span><button onClick={exitDemo}>Exit demo <X size={12}/></button></div>}
    {page===4&&<div className="motions-workspace"><aside ref={profileRail} className="profile-rail" aria-label="Motion profiles"><div className="profile-list" role="group" aria-label="Select profile">{profileState.profiles.map(profile=>{const Icon=profileIcons[profile.icon??'home']??Home;return <button key={profile.id} className={`profile-button keycaps${shortcutHover===profile.id?' shortcut-drop':''}`} aria-label={profile.name} aria-pressed={profile.id===profileState.activeId} data-profile-id={profile.id} aria-haspopup="menu" onContextMenu={event=>{event.preventDefault();setIconPicker(null);setProfileMenu({id:profile.id,x:Math.max(8,Math.min(event.clientX,window.innerWidth-188)),y:Math.max(8,Math.min(event.clientY,window.innerHeight-180))});}} onDragOver={event=>{const from=shortcutDrag.current;const moving=assignments.find(a=>a.id===from);const onto=profile.assignments.find(a=>a.id===from)||(from?.startsWith('combo-')?moving:undefined);if(!from||profile.id===profileState.activeId||!moving||!onto||!canReceiveOutput(moving,onto)||(moving.appAction?.type==='open-profile-picker'&&onto.appAction?.type==='open-profile-picker'))return;event.preventDefault();event.dataTransfer.dropEffect='move';setShortcutHover(profile.id);}} onDragLeave={()=>setShortcutHover(current=>current===profile.id?null:current)} onDrop={event=>{event.preventDefault();const from=shortcutDrag.current;shortcutDrag.current=null;setShortcutHover(null);if(from)relocateShortcut(from,profile.id,from);}} onClick={()=>selectProfile(profile.id)}><kbd><Icon size={19} strokeWidth={1.4}/></kbd><span className="profile-tooltip" role="tooltip">{profile.name}</span></button>;})}</div><button className="profile-button profile-add keycaps" aria-label="Add profile" aria-expanded={iconPicker==='add'} onClick={()=>setIconPicker(iconPicker==='add'?null:'add')}><kbd><Plus size={18}/></kbd></button>{iconPicker&&<div className="profile-icon-picker" role="dialog" aria-label={iconPicker==='add'?'Choose an icon for your new profile':'Choose profile icon'}><p>{iconPicker==='add'?'New profile':'Profile icon'}</p><div>{Object.entries(profileIcons).map(([name,Icon])=><button key={name} aria-label={`Use ${name} icon`} aria-pressed={iconPicker==='edit'&&(activeProfile.icon??'home')===name} onClick={()=>chooseProfileIcon(name as ProfileIcon)}><Icon size={19} strokeWidth={1.4}/></button>)}</div>{iconPicker==='edit'&&<button className="profile-delete" disabled={profileState.profiles.length<=1} title={profileState.profiles.length<=1?'Keep at least one profile':`Delete ${activeProfile.name}`} onClick={()=>deleteProfile()}><Trash2 size={14}/> Delete profile</button>}</div>}{profileMenu&&<div ref={profileMenuRef} className="profile-context-menu" role="menu" aria-label="Profile actions" style={{left:profileMenu.x,top:profileMenu.y}} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const items=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));const index=items.indexOf(document.activeElement as HTMLButtonElement);items[(index+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}}}><button role="menuitem" disabled={!hasCopiedAssignment()} onClick={()=>{const target=profileState.profiles.find(p=>p.id===profileMenu.id);if(target){const next=pasteAssignment(target.assignments);if(next)setAssignments(next,target.id);}setProfileMenu(null);}}>Paste</button><button role="menuitem" onClick={()=>editProfile(profileMenu.id,'rename')}><Pencil size={14} aria-hidden="true"/>Rename</button><button role="menuitem" onClick={()=>editProfile(profileMenu.id,'icon')}><Shapes size={14} aria-hidden="true"/>Change icon</button><button role="menuitem" className="profile-context-delete" disabled={profileState.profiles.length<=1} title={profileState.profiles.length<=1?'Keep at least one profile':undefined} onClick={()=>deleteProfile(profileMenu.id)}><Trash2 size={14}/> Delete profile</button></div>}</aside><div className="motions-content"><MotionSettings cheatSheetDescriptions={activeProfile.cheatSheetDescriptions} profileName={activeProfile.name} onCheatSheetDescriptionsChange={descriptions=>setProfileState(current=>({...current,profiles:current.profiles.map(p=>p.id===current.activeId?{...p,cheatSheetDescriptions:descriptions}:p)}))} key={profileState.activeId} assignments={assignments} sharedIds={profileState.sharedIds??[]} onToggleShared={toggleShared} onChange={setAssignments} onEditing={setEditingShortcut} profiles={profileState.profiles} shortcutDrag={shortcutDrag} onRelocate={relocateShortcut}/></div></div>}

    {[1,3,6].includes(page)&&<div className="test-navigation"><button className="test-back" aria-label="Back to device settings" onClick={()=>setPage(2)}><ArrowLeft size={14}/> Device settings</button><div className="test-tabs" role="tablist" aria-label="Device tests">{[1,3,6].map(i=><button role="tab" aria-selected={page===i} className={page===i?'selected':''} key={i} onClick={()=>setPage(i)}>{names[i]}</button>)}</div><p>Shortcuts are paused while testing your device. Live EMG signals and model experiments need a direct band connection and are hidden for now.</p></div>}
    {false&&page===0&&<>
     <div className="session-strip"><div><span className={connected?'status-dot on':'status-dot'}/><span>{stateLabel}</span>{connected&&<span className="muted">/ {demo?'Virtual band':devices.find(d=>d.id===selected)?.name||'Meta Neural Band'}</span>}</div><div className="session-right"><span className="muted">Session</span><span className="num">{duration}</span><span className="vertical-rule"/><button disabled={!connected} onClick={()=>setPaused(v=>!v)}>{paused?<Play size={13}/>:<Pause size={13}/>} {paused?'Resume view':'Pause view'}</button></div></div>
     <div className="instrument-grid">
      <section className="panel signal-panel"><div className="panel-heading"><div><h2>Electromyography <span className="small-badge">{channels.filter(Boolean).length} of 8 selected</span></h2><p>Smoothed muscle activity <span>·</span> unsigned 16-bit ADC</p></div><Activity size={18} strokeWidth={1}/></div>
       <div className="plot-controls"><div className="segmented">{[2048,4096,8192].map(n=><button className={windowSize===n?'selected':''} onClick={()=>setWindowSize(n)} key={n}>{n/2048} s</button>)}</div><label>Gain <select aria-label="Signal gain" value={gain} onChange={e=>setGain(Number(e.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label></div>
       <div className="waveforms">{snapshot.channels.map((c,i)=>channels[i]&&<div className={`channel-row ${!channels[i]?'channel-off':''}`} key={i}><button aria-label={`Toggle channel ${i+1}`} title={`Toggle channel ${i+1}`} aria-pressed={channels[i]} onClick={()=>toggleChannel(i)}><span className="channel-indicator"/>CH {String(i+1).padStart(2,'0')}</button><div className="channel-plot">{channels[i]&&<Trace data={c.slice(-windowSize)} range={1500/gain} windowSize={windowSize} height={240/ channels.filter(Boolean).length}/>}</div><span className="channel-value num">{c.length&&channels[i]?c[c.length-1].toLocaleString():'—'}</span></div>)}</div>
       {!connected&&snapshot.count===0&&<div className="empty-overlay"><span>Waiting for a signal.</span><p>Connect your band to see your selected electrodes.</p><button onClick={startDemo}>Explore demo <ArrowUpRight size={13}/></button></div>}
       <div className="plot-axis"><span>−{windowSize/2048} s</span><span>−{windowSize/2048*.75} s</span><span>−{windowSize/2048*.5} s</span><span>−{windowSize/2048*.25} s</span><span>Now</span></div>
       <div className="signal-foot"><span><span className="tiny-dot"/> {connected?'2,048 samples / s / channel':'2,048 Hz supported'}</span><span>{paused?'Display paused · acquisition continues':'ADC midpoint 32,768 · ±1,500 / gain'}</span></div>
      </section>
      <section className="panel device-panel"><div className="panel-heading"><h2>The band</h2><ScanLine size={16} strokeWidth={1.2}/></div><iframe ref={bandFrame} onLoad={syncBand} className="band-figure" src="./hairline/embed.html" title="Interactive Hairline drawing of the band electrodes"/><p className="electrode-hint">Click electrodes to select · click again to deselect</p><div className="band-caption">Meta Neural Band <span>{demo?'Virtual device':connected?'Live device':'Awaiting connection'}</span></div><div className="device-facts"><div><span><Battery size={14}/> Battery</span><span>{battery===null?'—':`${battery}%`}</span></div><div><span><Hand size={14}/> Hand</span><span>{demo?'Simulated':hand}</span></div><div><span><Radio size={14}/> Transport</span><span>{demo?'Simulation':connected?'Bluetooth LE':'—'}</span></div><div><span><Check size={14}/> Band proof</span><span>{demo||!connected?'—':verified?'Verified':'Unverified'}</span></div></div><button className="device-detail" onClick={()=>setPage(2)}>Device details <ArrowUpRight size={14}/></button></section>
     </div>
     <div className="secondary-grid">
      <section className="panel motion-panel"><div className="panel-heading"><div><h2>Motion</h2><p>Movement across three axes</p></div><MoveUpRight size={17} strokeWidth={1}/></div><MotionVisual history={gyroHistory} values={snapshot.gyro}/><div className="panel-bottom">{snapshot.gyro.length?'Live angular movement · relative scale':'Waiting for movement'}</div></section>
      <section className="panel orientation-panel"><div className="panel-heading"><div><h2>Orientation</h2><p>Hand rotation from the wrist</p></div><Rotate3D size={17} strokeWidth={1}/></div><OrientationVisual values={snapshot.orientation} latest={()=>data.current.orientation}/><div className="panel-bottom">{snapshot.orientation.length?'Live rotation · right hand':'Waiting for orientation'}</div></section>
      <section className="panel gesture-panel"><div className="panel-heading"><div><h2>Gestures <span className="small-badge">{snapshot.gestures.length}</span></h2><p>Recent finger events</p></div><Hand size={17} strokeWidth={1}/></div><div className="gesture-list">{snapshot.gestures.slice(0,3).map((g,i)=><button key={`${g.sequence}-${i}`} onClick={()=>{setChosenGesture(g);setPage(3);}}><span className="gesture-mark"><Hand size={16} strokeWidth={1}/></span><span>{g.finger} <span className="muted">{gestureMeaning(g).title}</span></span><span className="num muted">#{g.sequence}</span></button>)}{!snapshot.gestures.length&&<p className="quiet-empty">{connected?'Listening for your next gesture.':'Finger events will appear here.'}</p>}</div><button className="panel-bottom link" onClick={()=>setPage(3)}>Open gesture inspector <ArrowUpRight size={13}/></button></section>
     </div>
    </>}
    {page===1&&<div className="inspector-grid"><section className="panel"><div className="panel-heading"><h2>Incoming events <span className="small-badge">{snapshot.count.toLocaleString()}</span></h2><select value={filter} onChange={e=>setFilter(e.target.value)} aria-label="Filter event type">{['All events','EMGBatch','Gyroscope','Orientation','Gesture','Discontinuity','ConnectionState'].map(x=><option key={x}>{x}</option>)}</select></div><div className="event-table"><div className="event-row table-heading"><span>Type</span><span>Sequence</span><span>Device time</span></div>{visible.slice(0,40).map((p,i)=><button className={`event-row ${chosenPacket===p?'picked':''}`} key={i} onClick={()=>setChosenPacket(p)}><span>{p.type}</span><span className="num">{p.sequence??'—'}</span><span className="num">{p.timestamp??'—'}</span></button>)}{!visible.length&&<p className="quiet-empty">No events in this view. Start a stream or change the filter.</p>}</div></section><section className="panel packet-detail"><div className="panel-heading"><h2>Packet detail</h2><FileJson size={16}/></div><p className="detail-caption">Full fields, including raw enum codes and source clocks. EMG payload bytes use hex encoding.</p><pre>{chosenPacket?JSON.stringify(chosenPacket,null,2):'Select an event to inspect its fields.'}</pre></section></div>}
    {page===6&&<AirGestureTest connected={state==='connected'} demo={demo}/>}
    {false&&page===5&&<ModelTests connected={state==='connected'} demo={demo}/>}
    {page===3&&<GestureInspector gestures={snapshot.gestures} total={snapshot.gestureCount} selected={chosenGesture} onSelect={setChosenGesture}/>}
    {page===2&&<div className="settings-layout"><AppSettings/><PhoneSettings link={phone.link} pairing={phone.pairing} bluetooth={phone.bluetooth}/><section><h2>Mac permissions</h2><p>Allow Runes and its Python helper to control your Mac in System Settings → Privacy &amp; Security → Accessibility.</p></section><section className="panel settings-panel"><div className="setting-row"><span>Keyboard shortcuts</span><span>macOS only</span></div><div className="settings-actions"><button className="button" onClick={openAccessibility}>Open Accessibility settings <ArrowUpRight size={14}/></button></div></section><section><h2>Streams</h2><p>Your iPhone sends gestures, and motion only while an assignment or test uses it.</p></section><section className="panel settings-panel">{[['Gestures','Finger, action and derived action'],['Gyroscope','x, y, z · when used'],['Orientation','w, x, y, z · when used'],['EMG','Needs a direct band connection']].map(([a,b])=><div className="setting-row" key={a}><span>{a}</span><span>{b}</span></div>)}</section><section><h2>Device test</h2><p>A closer look at your band’s signals and gestures.</p></section><button className="device-test-entry" onClick={()=>setPage(1)}><span><span>Open device test</span><small>Events, gesture inspector and air gestures</small></span><ChevronRight size={18}/></button></div>}
    {page!==4&&<footer className={`main-footer ${page===4?'home-footer':''}`}><span><span className="tiny-dot"/> {demo?'Simulation':stateLabel} <span className="footer-divider">/</span> {paused?'View paused':connected?'Streaming':'Standby'}</span><span className="num">{snapshot.count.toLocaleString()} events</span><span>All data stays on your machine <ArrowUpRight size={12}/></span></footer>}
   </main>
  </div>
  {window.band&&phone.link.state==='unpaired'&&<PairingScreen pairing={phone.pairing} bluetooth={phone.bluetooth}/>}
 </div>;
}
export default App;
