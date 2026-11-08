import {CheatSheetEditor} from './CheatSheetEditor';
import {copyAssignment,hasCopiedAssignment,pasteAssignment} from './assignmentClipboard';
import {AirGestureEditor,AirGestureShape} from './AirGestureEditor';
import {RadialEditor} from './RadialEditor';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {CSSProperties} from 'react';
import {Asterisk,Gauge,ArrowLeft,ArrowRight,ArrowUp,ArrowDown,ChevronDown,Check,Clock3,Move3D,Rotate3D,Keyboard,Plus,Workflow,X,Hand,Spline,ChevronRight,Globe} from 'lucide-react';
import {ShortcutPicker} from './ShortcutPicker';
import {MouseMovementEditor} from './MouseMovementEditor';
import {AdjustEditor} from './AdjustEditor';
import {MacActionMenu} from './MacActionMenu';
import {TypeTextDialog} from './TypeTextDialog';
import {ApiCallDialog} from './ApiCallDialog';
import {canAdjust,canReceiveOutput,macActionLabel,canOpenProfilePicker,activeHolds,holdSpans,validHoldOrder,availableKeys,comboTimes,keyNames,modifierKeys,motions,shortcutKeys,shortcutLabel,type ActionStep,type AppAction,type Assignment,type AirGesture,type GestureStep,type Shortcut} from './shortcuts';

// Hand-drawn variants of the brand hand: same palm, thumb, and rounded stroke.
function FingerIcon({finger,hold=false,double=false}:{finger:'index'|'middle';hold?:boolean;double?:boolean}){
 const outline=finger==='index'
  ?'M6 14V4a2 2 0 0 1 4 0v6a2 2 0 0 1 4 0v1a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v1a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15Z'
  :'M6 14v-3a2 2 0 0 1 4 0V3a2 2 0 0 1 4 0v8a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v1a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15Z';
 return <svg width="20" height="20" viewBox={double?'0 0 28 24':'0 0 24 24'} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  {double&&<defs><mask id={`double-tap-${finger}`} maskUnits="userSpaceOnUse" x="0" y="0" width="28" height="24"><rect width="28" height="24" fill="white"/><path d={outline} fill="black" stroke="black" strokeWidth="3.5"/></mask></defs>}
  {double&&<g mask={`url(#double-tap-${finger})`}><path d={outline} transform="translate(4 0)"/></g>}
  <path d={outline} fill={hold?'currentColor':'none'}/>
  {!hold&&<path d={finger==='index'?'M10 10v2m4-1v2m4 0v1':'M10 11v2m4-2v2m4 0v1'}/>}
 </svg>;
}

export function GestureIcon({gesture,air}:{gesture:GestureStep['gesture'];air?:AirGesture}){
 if(gesture==='air'&&air)return <AirGestureShape points={air.points}/>;
 if(gesture==='air')return <Spline size={20} strokeWidth={1.4}/>;
 if(gesture.startsWith('release-'))return <FingerIcon finger={gesture.endsWith('index')?'index':'middle'}/>;
 const motion=motions.find(m=>m.id===gesture);
 if(motion?.icon==='index'||motion?.icon==='middle')return <FingerIcon finger={motion.icon} hold={gesture.startsWith('hold-')} double={gesture.startsWith('double-tap-')}/>;
 const Icon=gesture==='swipe-left'?ArrowLeft:gesture==='swipe-right'?ArrowRight:gesture==='swipe-up'?ArrowUp:gesture==='swipe-down'?ArrowDown:gesture==='rotation'?Rotate3D:Move3D;
 return <Icon size={20} strokeWidth={1.4}/>;
}
const gestureOptions=[...motions.map(m=>({value:m.id,label:m.name})),{value:'rotation',label:'Rotation'},{value:'movement',label:'Movement'},{value:'air',label:'Air gesture'},{value:'release-index',label:'Index release'},{value:'release-middle',label:'Middle release'}];
function optionsAt(steps:GestureStep[],index:number){
 const held=activeHolds(steps.slice(0,index));
 return gestureOptions.filter(o=>{
  if(o.value.startsWith('release-')&&!held.has(o.value.slice(8)))return false;
  if(o.value.startsWith('hold-')&&held.has(o.value.slice(5)))return false;
  return validHoldOrder([...steps.slice(0,index),{gesture:o.value as GestureStep['gesture']},...steps.slice(index+1)]);
 });
}
export function ComboDropdown({label,value,options,onChange,children,className='',initialOpen=false,placement='side',disabled=false,id,describedBy}:{label:string;value?:string;options:{value:string;label:string}[];onChange:(value:string)=>void;children:React.ReactNode;className?:string;initialOpen?:boolean;placement?:'side'|'below';disabled?:boolean;id?:string;describedBy?:string}){
 const [open,setOpen]=useState(initialOpen);
 const root=useRef<HTMLDivElement>(null);
 const menu=useRef<HTMLDivElement>(null);
 const [position,setPosition]=useState<CSSProperties>({});
 useLayoutEffect(()=>{
  if(!open)return;
  const place=()=>{
   const trigger=root.current?.getBoundingClientRect();
   const popup=menu.current;
   if(!trigger||!popup)return;
   if(placement==='below'){
    const width=Math.min(210,window.innerWidth-24);
    const below=window.innerHeight-trigger.bottom-16;
    const above=trigger.top-16;
    const opensBelow=below>=Math.min(320,popup.scrollHeight)||below>=above;
    const maxHeight=Math.max(40,Math.min(320,opensBelow?below:above));
    popup.style.width=`${width}px`;
    const height=Math.min(popup.scrollHeight,maxHeight);
    setPosition({position:'fixed',left:Math.max(12,Math.min(trigger.right-width,window.innerWidth-width-12)),width,top:opensBelow?trigger.bottom+4:Math.max(12,trigger.top-height-4),maxHeight,overflowY:'auto'});
    return;
   }
   const boundary=document.querySelector('.combo-scroll-space')?.getBoundingClientRect().bottom??window.innerHeight;
   const bottom=Math.min(window.innerHeight-12,boundary-12);
   const maxHeight=Math.max(40,bottom-12);
   popup.style.width=`${Math.max(40,Math.min(190,window.innerWidth-trigger.right-20))}px`;
   const height=Math.min(popup.scrollHeight,maxHeight);
   setPosition({position:'fixed',left:trigger.right+8,width:Math.max(40,Math.min(190,window.innerWidth-trigger.right-20)),top:Math.max(12,Math.min(trigger.top,bottom-height)),maxHeight,overflowY:'auto'});
  };
  place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
  return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
 },[open,placement]);
 useEffect(()=>{
  if(!open)return;
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node)&&!menu.current?.contains(e.target as Node))setOpen(false);};
  window.addEventListener('pointerdown',outside);
  return()=>window.removeEventListener('pointerdown',outside);
 },[open]);
 return <div className={`combo-dropdown ${className}`} ref={root} onKeyDown={e=>{
  if(e.key==='Escape'){e.stopPropagation();setOpen(false);root.current?.querySelector('button')?.focus();}
  if(!disabled&&(e.key==='ArrowDown'||e.key==='ArrowUp')){
   e.preventDefault();if(!open){setOpen(true);requestAnimationFrame(()=>menu.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus());return;}
   const items=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')??[]);
   const index=items.indexOf(document.activeElement as HTMLButtonElement);
   items[(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();
  }
 }}>
  <button id={id} className="combo-dropdown-trigger" aria-label={label} aria-describedby={describedBy} aria-haspopup="menu" aria-expanded={open&&!disabled} disabled={disabled} onClick={()=>setOpen(!open)}>{children}</button>
  {open&&!disabled&&createPortal(<div ref={menu} style={position} className="combo-menu" role="menu" aria-label={label}>{options.map(option=><button key={option.value} role="menuitemradio" aria-checked={value===option.value} onClick={()=>{onChange(option.value);setOpen(false);root.current?.querySelector('button')?.focus();}}>{gestureOptions.some(g=>g.value===option.value)&&<GestureIcon gesture={option.value as GestureStep['gesture']}/>}<span>{option.label}</span>{value===option.value&&<Check size={14}/>}</button>)}</div>,document.body)}
 </div>;
}

// Each recognition gets its own dot, so quick repeats can finish independently.
function GestureIndicators({motion}:{motion:string}){
 const [dots,setDots]=useState<{id:number;hue:number}[]>([]);
 const next=useRef(0);
 useEffect(()=>window.band?.onMessage(message=>{
  if(message.kind!=='motion'||message.motion!==motion||document.hidden)return;
  const dot={id:next.current++,hue:285};
  setDots(current=>[...current.slice(-7),dot]);
 }),[motion]);
 return <span className="gesture-indicators" aria-hidden="true">{dots.map(dot=><span key={dot.id} className="gesture-indicator" style={{'--dot-color':`hsl(${dot.hue} 82% 72%)`} as CSSProperties} onAnimationEnd={()=>setDots(current=>current.filter(item=>item.id!==dot.id))}/>)}</span>;
}

export function Keycaps({shortcut}:{shortcut:Shortcut}){
 return <span className="keycaps" aria-label={shortcutLabel(shortcut)}>{modifierKeys.filter(m=>shortcut.modifiers.includes(m.id)).map(m=><kbd key={m.id} title={m.name}>{m.symbol}</kbd>)}{shortcutKeys(shortcut).map(key=><kbd key={key} className={key==='Space'?'wide':''}>{keyNames[key]||key}</kbd>)}</span>;
}

// Physical positions keep Option and Shift from turning the recorded base key into a symbol.
function recordedKey(event:KeyboardEvent){
 if(/^Key[A-Z]$/.test(event.code))return event.code.slice(3);
 if(/^Digit[0-9]$/.test(event.code))return event.code.slice(5);
 const punctuation:Record<string,string>={Minus:'-',Equal:'=',BracketLeft:'[',BracketRight:']',Semicolon:';',Quote:"'",Comma:',',Period:'.',Slash:'/',Backslash:'\\',Backquote:'`',Space:'Space'};
 return punctuation[event.code]||event.key;
}

function ActionChain({label,children,drag}:{label:string;children:React.ReactNode;drag?:React.HTMLAttributes<HTMLDivElement>}){
 const root=useRef<HTMLDivElement>(null);
 const [overflow,setOverflow]=useState(false);
 const [tooltip,setTooltip]=useState<{text:string;x:number;y:number}|null>(null);
 const measure=()=>{const el=root.current;if(el)setOverflow(el.scrollWidth-el.clientWidth-el.scrollLeft>1);};
 useLayoutEffect(()=>{const el=root.current;if(!el)return;measure();const observer=new ResizeObserver(measure);observer.observe(el);for(const child of el.children)observer.observe(child);return()=>observer.disconnect();},[children]);
 function show(target:EventTarget|null){const cap=target instanceof Element?target.closest<HTMLElement>('[data-tooltip]'):null;if(!cap){setTooltip(null);return;}const rect=cap.getBoundingClientRect();setTooltip({text:cap.dataset.tooltip??'',x:Math.max(80,Math.min(window.innerWidth-80,rect.left+rect.width/2)),y:rect.top-8});}
 return <><div ref={root} {...drag} className={`action-chain ${overflow?'has-overflow':''} ${drag?.className??''}`} aria-label={label} onScroll={()=>{measure();setTooltip(null);}} onWheel={event=>{const el=root.current;if(!el||el.scrollWidth<=el.clientWidth||Math.abs(event.deltaX)>Math.abs(event.deltaY))return;el.scrollLeft+=event.deltaY;}} onMouseOver={event=>show(event.target)} onMouseLeave={()=>setTooltip(null)} onFocus={event=>show(event.target)} onBlur={()=>setTooltip(null)}>{children}</div>{tooltip&&createPortal(<span className="action-chain-tooltip" role="tooltip" style={{left:tooltip.x,top:tooltip.y}}>{tooltip.text}</span>,document.body)}</>;
}

export function MotionSettings({cheatSheetDescriptions={},profileName,onCheatSheetDescriptionsChange,assignments,sharedIds=[],onToggleShared,onChange,onEditing,profiles=[],shortcutDrag,onRelocate}:{cheatSheetDescriptions?:Record<string,string>;profileName?:string;onCheatSheetDescriptionsChange:(v:Record<string,string>)=>void;assignments:Assignment[];sharedIds?:string[];onToggleShared:(id:string)=>void;onChange:(v:Assignment[])=>void;onEditing:(v:boolean)=>void;profiles?:{id:string;name:string}[];shortcutDrag:React.MutableRefObject<string|null>;onRelocate:(fromId:string,toProfileId:string|null,toId:string)=>void}){
 const [cheatSheetEditingIndex,setCheatSheetEditingIndex]=useState<number|null>(null);
 const [cheatSheetEditing,setCheatSheetEditing]=useState<string|null>(null);
 function closeCheatSheetEditor(){setCheatSheetEditing(null);onEditing(false);}
 const [context,setContext]=useState<{id?:string;x:number;y:number}|null>(null);
 const contextRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!context)return;
  contextRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  const dismiss=(event:PointerEvent)=>{if(!contextRef.current?.contains(event.target as Node))setContext(null);};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setContext(null);};
  window.addEventListener('pointerdown',dismiss);window.addEventListener('keydown',escape);
  return()=>{window.removeEventListener('pointerdown',dismiss);window.removeEventListener('keydown',escape);};
 },[context]);
 const [airEditing,setAirEditing]=useState<{id:string;index:number;initial?:AirGesture}|null>(null);
 function openAir(id:string,index:number,initial?:AirGesture){setAirEditing({id,index,initial});onEditing(true);}
 function closeAir(){setAirEditing(null);onEditing(false);}
 const [radialOpen,setRadialOpen]=useState(false);
 const [adjustOpen,setAdjustOpen]=useState(false);
 const [mouseOpen,setMouseOpen]=useState(false);
 const [typeOpen,setTypeOpen]=useState(false);
 const [apiOpen,setApiOpen]=useState(false);
 const [macOpen,setMacOpen]=useState(false);
 const [actionMenu,setActionMenu]=useState<'root'|'move'|'profile'|'picker'|null>(null);
 const [actionIndex,setActionIndex]=useState<number|null>(null);
 const actionDrag=useRef<number|null>(null);
 const actionLabel=(action:AppAction):string=>action.type==='show-cheat-sheet'?'Profile cheat sheet':action.type==='type-text'?'Type text':action.type==='radial-menu'?'Radial menu':action.type==='mouse-movement'?`Mouse · ${action.right.inverted?'Left':'Right'}: ${action.right.movement} ${action.right.axis.toUpperCase()} · ${action.up.inverted?'Down':'Up'}: ${action.up.movement} ${action.up.axis.toUpperCase()}`:action.type==='adjust'?'Adjust':action.type==='sequence'?action.actions.map(step=>step.type==='shortcut'?shortcutLabel(step.shortcut):actionLabel(step)).join(' → '):action.type==='macos-action'?macActionLabel(action):action.type==='api-call'?`${action.method} ${new URL(action.url).host}`:action.type==='open-profile-picker'?'Desktop profile picker':action.type==='move-profile'?`Profile ${action.direction}`:`${profiles.find(p=>p.id===action.profileId)?.name??'Missing profile'}`;
 function chain(a:Assignment):ActionStep[]{return a.appAction?.type==='sequence'?[...a.appAction.actions]:a.appAction&&a.appAction.type!=='radial-menu'&&a.appAction.type!=='open-profile-picker'&&a.appAction.type!=='adjust'&&a.appAction.type!=='mouse-movement'?[a.appAction]:a.shortcut?[{type:'shortcut',shortcut:a.shortcut}]:[];}
 function saveStep(step:ActionStep){onChange(assignments.map(a=>{if(a.id!==editing)return a;const actions=chain(a);if(actionIndex===null)return step.type==='shortcut'?{...a,shortcut:step.shortcut,appAction:undefined,enabled:true}:{...a,shortcut:null,appAction:step,enabled:true};actions.splice(actionIndex,actionIndex<actions.length?1:0,step);return {...a,shortcut:null,appAction:{type:'sequence',actions},enabled:true};}));close();}
 function assignAction(action:AppAction){if(action.type==='sequence')return;if(action.type==='radial-menu'||action.type==='adjust'||action.type==='mouse-movement'){onChange(assignments.map(a=>a.id===editing?{...a,shortcut:null,appAction:action,enabled:true}:a));close();return;}if(action.type!=='open-profile-picker'){saveStep(action);return;}if(actionIndex!==null||!editing||!canOpenProfilePicker(editing))return;onChange(assignments.map(a=>a.id===editing?{...a,shortcut:null,appAction:action,enabled:true}:a.appAction?.type==='open-profile-picker'?{...a,shortcut:null,appAction:undefined,enabled:false}:a));close();}
 function setChain(a:Assignment,actions:ActionStep[]){const only=actions[0];update(a.id,actions.length>1?{appAction:{type:'sequence',actions},shortcut:null}:only?.type==='shortcut'?{appAction:undefined,shortcut:only.shortcut}:{appAction:only,shortcut:null,enabled:!!only&&a.enabled});}
 const [dragging,setDragging]=useState<{id:string;index:number}|null>(null);
 const [preview,setPreview]=useState<{id:string;steps:GestureStep[]}|null>(null);
 const previewRef=useRef<{id:string;steps:GestureStep[]}|null>(null);
 const stepKeys=useRef(new WeakMap<GestureStep,number>());
 const nextStepKey=useRef(0);
 const previousRects=useRef(new Map<number,DOMRect>());
 function stepKey(step:GestureStep){
  if(!stepKeys.current.has(step))stepKeys.current.set(step,nextStepKey.current++);
  return stepKeys.current.get(step)!;
 }
 useLayoutEffect(()=>{
  const next=new Map<number,DOMRect>();
  document.querySelectorAll<HTMLElement>('[data-gesture-key]').forEach(element=>{
   const key=Number(element.dataset.gestureKey),rect=element.getBoundingClientRect();
   next.set(key,rect);
   const before=previousRects.current.get(key);
   if(before&&!element.classList.contains('is-dragging')&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    const x=before.left-rect.left,y=before.top-rect.top;
    if(x||y)element.animate([{translate:`${x}px ${y}px`},{translate:'0px 0px'}],{duration:160,easing:'ease-out'});
   }
  });
  previousRects.current=next;
 },[preview,assignments]);
 const [reorderNotice,setReorderNotice]=useState('');
 const dragSource=useRef<{id:string;index:number}|null>(null);
 const [editing,setEditing]=useState<string|null>(null);
 const [held,setHeld]=useState<string[]>([]);
 const [keys,setKeys]=useState<string[]>([]);
 const recorder=useRef<HTMLDivElement>(null);
 const clickedModifiers=useRef(new Set<string>());
 const capturedModifierRef=useRef(new Set<string>());
 const captureRef=useRef({pressed:new Set<string>(),keys:new Set<string>()});
 function resetCapture(){captureRef.current.pressed.clear();captureRef.current.keys.clear();}
 function toggleModifier(id:string){
  const selected=clickedModifiers.current;
  if(held.includes(id)){selected.delete(id);capturedModifierRef.current.delete(id);}
  else{selected.add(id);capturedModifierRef.current.add(id);}
  setHeld([...capturedModifierRef.current]);
 }
 function close(){setRadialOpen(false);setMouseOpen(false);setAdjustOpen(false);resetCapture();setActionIndex(null);setMacOpen(false);setApiOpen(false);setTypeOpen(false);setActionMenu(null);setEditing(null);clickedModifiers.current.clear();capturedModifierRef.current.clear();setHeld([]);setKeys([]);onEditing(false);}
 function edit(id:string,index:number|null=null){resetCapture();setActionIndex(index);setActionMenu(null);setEditing(id);clickedModifiers.current.clear();capturedModifierRef.current.clear();setHeld([]);setKeys([]);onEditing(true);}
 useEffect(()=>()=>onEditing(false),[onEditing]);
 useEffect(()=>{
  if(!editing)return;
  // Parent telemetry renders can reattach listeners while a chord is held.
  // Keep the capture alive until release, save, or cancellation.
  const pressed=captureRef.current.pressed;
  const capturedKeys=captureRef.current.keys;
  const capturedModifiers=capturedModifierRef.current;
  const modifiersFor=(event:KeyboardEvent)=>modifierKeys.filter(m=>({command:event.metaKey,option:event.altKey,control:event.ctrlKey,shift:event.shiftKey}[m.id])).map(m=>m.id);
  const keydown=(event:KeyboardEvent)=>{
   if(event.target instanceof Element&&event.target.closest('.runes-action-controls'))return;
   if(radialOpen||actionMenu||typeOpen||apiOpen||macOpen||adjustOpen||mouseOpen)return;
   if(event.target instanceof Element&&event.target.closest('.recorder-modifier')&&['Enter',' '].includes(event.key))return;
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
   event.preventDefault();event.stopPropagation();
   modifiersFor(event).forEach(m=>capturedModifiers.add(m));
   setHeld([...capturedModifiers]);
   if(event.repeat)return;
   pressed.add(event.code||event.key);
   if(['Meta','Control','Alt','Shift'].includes(event.key))return;
   const key=recordedKey(event);
   if(!availableKeys.includes(key))return;
   capturedKeys.add(key);
   setKeys([...capturedKeys]);
  };
  const keyup=(event:KeyboardEvent)=>{
   if(event.target instanceof Element&&event.target.closest('.runes-action-controls'))return;
   if(radialOpen||actionMenu||typeOpen||apiOpen||macOpen||adjustOpen||mouseOpen)return;
   if(event.target instanceof Element&&event.target.closest('.recorder-modifier')&&['Enter',' '].includes(event.key))return;
   event.preventDefault();event.stopPropagation();
   pressed.delete(event.code||event.key);
   // macOS can omit letter keyup events while Command is held.
   if(event.key==='Meta'&&!event.metaKey)pressed.clear();
   if(pressed.size||modifiersFor(event).length)return;
   if(!capturedKeys.size){capturedModifiers.clear();clickedModifiers.current.forEach(m=>capturedModifiers.add(m));setHeld([...capturedModifiers]);return;}
   const keys=[...capturedKeys];
   saveStep({type:'shortcut',shortcut:{key:keys[0],keys,modifiers:[...capturedModifiers]}});
  };
  const outside=(event:PointerEvent)=>{if(radialOpen)return;if((adjustOpen||mouseOpen)&&event.target instanceof Element&&event.target.closest('.combo-menu,.api-call-scrim'))return;if(!typeOpen&&!apiOpen&&!recorder.current?.contains(event.target as Node))close();};
  window.addEventListener('keydown',keydown,true);
  window.addEventListener('keyup',keyup,true);
  window.addEventListener('pointerdown',outside,true);
  if(!adjustOpen&&!mouseOpen&&!macOpen&&!typeOpen&&!apiOpen)window.addEventListener('blur',close);
  return()=>{window.removeEventListener('keydown',keydown,true);window.removeEventListener('keyup',keyup,true);window.removeEventListener('pointerdown',outside,true);window.removeEventListener('blur',close);};
 },[radialOpen,editing,assignments,onChange,onEditing,actionMenu,typeOpen,apiOpen,macOpen,adjustOpen,mouseOpen,actionIndex]);
 function update(id:string,change:Partial<Assignment>){onChange(assignments.map(a=>{if(a.id!==id)return a;const next={...a,...change};return next.appAction?.type==='adjust'&&!canAdjust(next)?{...next,appAction:undefined,enabled:false}:next;}));}
 function reorder(a:Assignment,from:number,boundary:number){
  const steps=[...a.steps!];
  const to=boundary>from?boundary-1:boundary;
  if(to===from)return;
  const [step]=steps.splice(from,1);steps.splice(to,0,step);
  if(!validHoldOrder(steps))return;
  update(a.id,{steps});
  setReorderNotice(`Gesture moved to position ${to+1} of ${steps.length}.`);
 }
 function finishDrag(){dragSource.current=null;setDragging(null);setPreview(null);previewRef.current=null;}
 const [dropRow,setDropRow]=useState<string|null>(null);
 function acceptsShortcut(fromId:string,onto:Assignment){
  const moving=assignments.find(a=>a.id===fromId);
  return !!moving&&fromId!==onto.id&&(!!moving.shortcut||!!moving.appAction)&&canReceiveOutput(moving,onto)&&!(moving.appAction?.type==='open-profile-picker'&&onto.appAction?.type==='open-profile-picker');
 }
 function beginShortcutDrag(id:string,event:React.DragEvent){
  if((event.target as Element).closest?.('.reorderable-gesture,.clear-shortcut,.remove-gesture,.adjust-remove,input,.combo-dropdown'))return;
  shortcutDrag.current=id;
  event.dataTransfer.effectAllowed='move';
  event.dataTransfer.setData('text/plain',`shortcut:${id}`);
 }
 function endShortcutDrag(){shortcutDrag.current=null;setDropRow(null);}
 function updateStep(a:Assignment,index:number,step:GestureStep){if(step.gesture==='air'){openAir(a.id,index,a.steps?.[index]?.air);return;}update(a.id,{steps:a.steps!.map((s,i)=>i===index?step:s)});}
 return <div className="motions-home" onContextMenu={event=>{if(editing)return;event.preventDefault();const row=(event.target as Element).closest<HTMLElement>('[data-assignment-id]');setContext({id:row?.dataset.assignmentId,x:Math.max(8,Math.min(event.clientX,window.innerWidth-188)),y:Math.max(8,Math.min(event.clientY,window.innerHeight-140))});}}>
 {context&&createPortal(<div ref={contextRef} className="profile-context-menu" role="menu" aria-label="Gesture assignment actions" style={{left:context.x,top:context.y}} onKeyDown={event=>{if(!['ArrowDown','ArrowUp'].includes(event.key))return;event.preventDefault();const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}}>
 {context.id&&<button role="menuitem" disabled={!assignments.find(a=>a.id===context.id)?.shortcut&&!assignments.find(a=>a.id===context.id)?.appAction} onClick={()=>{onToggleShared(context.id!);setContext(null);}}>{sharedIds.includes(context.id)?'Remove All profiles setting':'Use in all profiles'}</button>}
 {context.id&&<button role="menuitem" disabled={!assignments.find(a=>a.id===context.id)?.shortcut&&!assignments.find(a=>a.id===context.id)?.appAction} onClick={()=>{copyAssignment(assignments.find(a=>a.id===context.id)!);setContext(null);setReorderNotice('Gesture and shortcut copied.');}}>Copy</button>}
 <button role="menuitem" disabled={!hasCopiedAssignment()} onClick={()=>{const next=pasteAssignment(assignments);if(next)onChange(next);setContext(null);}}>Paste</button>
 {context.id&&<button role="menuitem" className="profile-context-delete" onClick={()=>{onChange(assignments.flatMap(a=>a.id!==context.id?[a]:a.steps?[]:[{...a,shortcut:null,appAction:undefined,enabled:false}]));setContext(null);}}>Delete</button>}
 </div>,document.body)}<section className="assignment-panel" aria-label="Motion assignments">
  <div className="assignment-heading"><span>Motion</span><span>Shortcut</span><span>Enabled</span></div>
  {assignments.map((savedAssignment)=>{
   const assignment=preview?.id===savedAssignment.id?{...savedAssignment,steps:preview.steps}:savedAssignment;
   const motion=motions.find(m=>m.id===assignment.id)??{id:assignment.id,name:`Combo ${assignments.filter(a=>a.steps).findIndex(a=>a.id===assignment.id)+1}`,icon:'combo'};
   const active=editing===motion.id;
   const Icon=motion.icon==='left'?ArrowLeft:motion.icon==='right'?ArrowRight:motion.icon==='up'?ArrowUp:motion.icon==='down'?ArrowDown:Workflow;
   const draggableOutput=!active&&(!!assignment.shortcut||!!assignment.appAction);
   return <div className={`assignment-row ${active?'is-recording':''} ${dropRow===motion.id?'shortcut-drop':''}`} key={motion.id} data-assignment-id={assignment.id}
    onDragOver={e=>{const from=shortcutDrag.current;if(!from||dragSource.current||!acceptsShortcut(from,assignment))return;e.preventDefault();e.dataTransfer.dropEffect='move';setDropRow(motion.id);}}
    onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDropRow(current=>current===motion.id?null:current);}}
    onDrop={e=>{const from=shortcutDrag.current;if(!from||!acceptsShortcut(from,assignment))return;e.preventDefault();e.stopPropagation();onRelocate(from,null,assignment.id);setReorderNotice(`Shortcut moved to ${motion.name}.`);endShortcutDrag();}}>
    {sharedIds.includes(assignment.id)&&<span className="assignment-shared-marker" role="img" aria-label="Present in all profiles" title="Present in all current and future profiles"><Asterisk size={14} strokeWidth={2} aria-hidden="true"/></span>}
    <GestureIndicators motion={motion.id}/>{assignment.steps?<div className="combo-editor" aria-label={`${motion.name} gestures`}>
     <div className={`combo-chain ${dragging?.id===assignment.id?'is-reordering':''}`} onDragOver={e=>{if(dragSource.current?.id===assignment.id)e.preventDefault();}} onDrop={e=>{if(dragSource.current?.id!==assignment.id)return;e.preventDefault();if(previewRef.current)update(assignment.id,{steps:previewRef.current.steps});finishDrag();}}>{assignment.steps.map((step,index)=>{
      const name=step.gesture==='air'?'Air gesture':gestureOptions.find(g=>g.value===step.gesture)?.label??step.gesture;
      return <div className={`combo-chain-item reorderable-gesture ${dragging?.id===assignment.id&&dragging.index===index?'is-dragging':''}`} key={stepKey(step)} data-gesture-key={stepKey(step)}
       draggable={!active} aria-label={`${name}, position ${index+1} of ${assignment.steps!.length}. Drag to reorder, or use Alt and arrow keys.`}
       onDragStart={e=>{
        dragSource.current={id:assignment.id,index};setDragging(dragSource.current);
        previewRef.current={id:assignment.id,steps:[...assignment.steps!]};setPreview(previewRef.current);
        (document.activeElement as HTMLElement)?.blur();
        e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(index));
       }}
       onDragOver={e=>{
        if(dragSource.current?.id!==assignment.id)return;
        e.preventDefault();e.dataTransfer.dropEffect='move';
        const rect=e.currentTarget.getBoundingClientRect();
        const from=dragSource.current.index;
        const boundary=index+(e.clientX>rect.left+rect.width/2?1:0);
        const to=boundary>from?boundary-1:boundary;
        if(to===from)return;
        const steps=[...(previewRef.current?.steps??assignment.steps!)];
        const [moved]=steps.splice(from,1);steps.splice(to,0,moved);
        if(!validHoldOrder(steps))return;
        dragSource.current={id:assignment.id,index:to};setDragging(dragSource.current);
        previewRef.current={id:assignment.id,steps};setPreview(previewRef.current);
       }}
       onDrop={e=>{
        if(dragSource.current?.id!==assignment.id)return;
        e.preventDefault();
        if(previewRef.current)update(assignment.id,{steps:previewRef.current.steps});
        setReorderNotice(`Gesture moved to position ${dragSource.current.index+1} of ${assignment.steps!.length}.`);
        finishDrag();
       }} onDragEnd={finishDrag}
       onKeyDownCapture={e=>{
        if(!e.altKey||!['ArrowLeft','ArrowRight'].includes(e.key))return;
        e.preventDefault();e.stopPropagation();
        const to=Math.max(0,Math.min(assignment.steps!.length-1,index+(e.key==='ArrowRight'?1:-1)));
        reorder(assignment,index,to>index?to+1:to);
        const row=e.currentTarget.parentElement;
        requestAnimationFrame(()=>row?.querySelectorAll<HTMLElement>('.reorderable-gesture')[to]?.querySelector<HTMLButtonElement>('button')?.focus());
       }}>
       {holdSpans(assignment.steps!).filter(span=>index>=span.start&&index<=span.end).map(span=><span key={`${span.finger}-${span.start}`} aria-hidden="true" className={`hold-band ${index===span.start?'hold-start':''} ${index===span.end?'hold-end':''}`} style={{'--hold-color':`hsl(285 82% 72%)`,top:span.finger==='index'?0:4,bottom:span.finger==='index'?0:-4} as CSSProperties}/>)}
       <div className="gesture-cap" data-tooltip={`${name}${step.axis?` · ${step.axis.toUpperCase()} axis`:''}`}>
        <ComboDropdown label={`${motion.name} gesture ${index+1}: ${name}`} value={step.gesture} options={optionsAt(assignment.steps!,index)} onChange={value=>updateStep(assignment,index,{gesture:value as GestureStep['gesture'],...(['rotation','movement'].includes(value)?{axis:'x' as const}:{})})}>{step.gesture==='air'&&step.air?<AirGestureShape points={step.air.points}/>:<GestureIcon gesture={step.gesture}/>}</ComboDropdown>
        {step.gesture==='air'&&step.air&&<button className="air-shape-button" aria-label={`Edit ${motion.name} air gesture ${index+1}`} title={`Edit ${name} · ${step.air.minSimilarity}% · ${step.air.durationMs/1000} s`} onClick={()=>openAir(assignment.id,index,step.air)}><Spline size={12}/></button>}
        {step.axis&&<ComboDropdown className="axis-dropdown" label={`${motion.name} gesture ${index+1} axis`} value={step.axis} options={['x','y','z'].map(axis=>({value:axis,label:`${axis.toUpperCase()} axis`}))} onChange={axis=>updateStep(assignment,index,{...step,axis:axis as GestureStep['axis']})}>{step.axis.toUpperCase()}</ComboDropdown>}
        {step.gesture==='rotation'&&<ComboDropdown className="axis-dropdown direction-dropdown" label={`${motion.name} gesture ${index+1} direction`} value={step.direction??'any'} options={[{value:'left',label:'←'},{value:'right',label:'→'},{value:'any',label:'↔'}]} onChange={direction=>updateStep(assignment,index,{...step,direction:direction as GestureStep['direction']})}>{step.direction==='left'?'←':step.direction==='right'?'→':'↔'}</ComboDropdown>}
        {assignment.steps!.length>2&&<button className="remove-gesture" aria-label={`Remove ${motion.name} gesture ${index+1}`} onClick={()=>{const span=holdSpans(assignment.steps!).find(s=>s.start===index);const steps=assignment.steps!.filter((s,i)=>i!==index&&!(span&&i===span.end&&s.gesture===`release-${span.finger}`));if(steps.length>=2&&validHoldOrder(steps))update(assignment.id,{steps});}}><X size={10}/></button>}
       </div>
      </div>;
     })}{assignment.steps.length<8&&<ComboDropdown className="add-gesture" label={`Add gesture to ${motion.name}`} options={optionsAt(assignment.steps!,assignment.steps!.length)} onChange={value=>{if(value==='air'){openAir(assignment.id,assignment.steps!.length);return;}if(assignment.steps!.length<8)update(assignment.id,{steps:[...assignment.steps!,{gesture:value as GestureStep['gesture'],...(['rotation','movement'].includes(value)?{axis:'x' as const}:{})}]});}}><Plus size={16}/></ComboDropdown>}

     </div><button className="delete-combo" aria-label={`Delete ${motion.name}`} onClick={()=>{if(active)close();onChange(assignments.filter(a=>a.id!==assignment.id));}}><X size={14}/></button>
    </div>:<div className="motion-name">{motion.icon==='index'||motion.icon==='middle'?<FingerIcon finger={motion.icon} hold={motion.id.startsWith('hold-')} double={motion.id.startsWith('double-tap-')}/>:<Icon size={20} strokeWidth={1.4}/>}<h3>{motion.name}</h3></div>}
    <div className="inline-recorder" ref={active?recorder:undefined}>
     {active&&!adjustOpen&&!mouseOpen&&<ShortcutPicker mouse={{enabled:actionIndex===null,open:mouseOpen,onClick:()=>{setMacOpen(false);setActionMenu(null);setMouseOpen(true);}}} held={held} onModifier={toggleModifier} onMac={()=>{setActionMenu(null);setMacOpen(!macOpen);}} onApi={()=>{setMacOpen(false);setActionMenu(null);setApiOpen(true);}} onRunes={()=>{setMacOpen(false);setActionMenu(actionMenu?null:'root');}} macOpen={macOpen} runesOpen={!!actionMenu} adjust={{enabled:actionIndex===null&&canAdjust(assignment),onClick:()=>{setMacOpen(false);setActionMenu(null);setAdjustOpen(true);}}} macMenu={macOpen&&<MacActionMenu initial={actionIndex!==null?chain(assignment)[actionIndex] as AppAction:assignment.appAction} onCancel={()=>{setMacOpen(false);recorder.current?.querySelector<HTMLButtonElement>('.shortcut-button')?.focus();}} onSave={assignAction}/>} runesMenu={actionMenu&&<div className={`runes-action-menu ${actionMenu==='picker'?'picker-setup-menu':''}`} role="menu" aria-label="Runes actions">{actionMenu==='picker'?<div className="picker-setup"><p>Open profiles on your desktop</p><p>This gesture will replace its mapping in all current and future profiles. Changing it asks you to remove the All profiles setting first.</p><p>Rotate your hand on the Y axis. Double tap index to select; repeat this gesture to cancel. Other shortcuts pause while the picker is open.</p><button role="menuitem" onClick={()=>assignAction({type:'open-profile-picker'})}>Use in all profiles</button><button role="menuitem" onClick={()=>setActionMenu('root')}>Back</button></div>:actionMenu==='root'?<><button role="menuitem" onClick={()=>assignAction({type:'show-cheat-sheet'})}>Profile cheat sheet</button><button role="menuitem" onClick={()=>{setActionMenu(null);setTypeOpen(true);}}>Type text</button><button role="menuitem" disabled={actionIndex!==null} onClick={()=>{setActionMenu(null);setRadialOpen(true);}}>Radial menu <ChevronRight size={14}/></button><button role="menuitem" disabled={actionIndex!==null} onClick={()=>{setActionMenu(null);setMouseOpen(true);}}>Mouse movement <ChevronRight size={14}/></button><button role="menuitem" disabled={actionIndex!==null||!canOpenProfilePicker(editing!)} title={!canOpenProfilePicker(editing!)?'Tap and double tap cannot open the picker':undefined} onClick={()=>setActionMenu('picker')}>Desktop profile picker <ChevronRight size={14}/></button><button role="menuitem" onClick={()=>setActionMenu('move')}>Move profile selector <ChevronRight size={14}/></button><button role="menuitem" onClick={()=>setActionMenu('profile')}>Change to profile <ChevronRight size={14}/></button></>:<>{actionMenu==='move'?(['up','down'] as const).map(direction=><button role="menuitem" key={direction} onClick={()=>assignAction({type:'move-profile',direction})}>{direction==='up'?<ArrowUp size={15}/>:<ArrowDown size={15}/>} {direction==='up'?'Up':'Down'}</button>):profiles.map(profile=><button role="menuitem" key={profile.id} onClick={()=>assignAction({type:'change-profile',profileId:profile.id})}>{profile.name}</button>)}</>}</div>}/>}

     {!active&&assignment.appAction?.type==='sequence'&&<ActionChain label={`${motion.name} action sequence`} drag={{className:'shortcut-draggable',draggable:true,title:'Drag to another gesture or profile',onDragStart:e=>{if((e.target as Element).closest('.action-step'))return;beginShortcutDrag(assignment.id,e);},onDragEnd:endShortcutDrag}}>{assignment.appAction.actions.map((step,index)=><div className="gesture-cap action-step" key={index} draggable onDragStart={e=>{actionDrag.current=index;beginShortcutDrag(assignment.id,e);}} onDragOver={e=>{if(shortcutDrag.current===assignment.id)e.preventDefault();}} onDrop={e=>{if(shortcutDrag.current!==assignment.id)return;e.preventDefault();e.stopPropagation();const from=actionDrag.current;if(from===null||from===index)return;const actions=chain(assignment);const [moved]=actions.splice(from,1);actions.splice(index,0,moved);setChain(assignment,actions);actionDrag.current=null;}} onDragEnd={()=>{actionDrag.current=null;endShortcutDrag();}} onKeyDown={e=>{if(!e.altKey||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const to=index+(e.key==='ArrowRight'?1:-1);const actions=chain(assignment);if(to<0||to>=actions.length)return;[actions[index],actions[to]]=[actions[to],actions[index]];setChain(assignment,actions);}} data-tooltip={step.type==='shortcut'?shortcutLabel(step.shortcut):actionLabel(step)}><button className={`shortcut-button ${step.type!=='shortcut'?'function-keycap':''}`} aria-label={`Edit ${motion.name} action ${index+1}: ${step.type==='shortcut'?shortcutLabel(step.shortcut):actionLabel(step)}. Drag to another gesture or profile.`} onClick={()=>{if(step.type==='show-cheat-sheet'){setCheatSheetEditingIndex(index);setCheatSheetEditing(assignment.id);onEditing(true);}else edit(motion.id,index);}}>{step.type==='shortcut'?<Keycaps shortcut={step.shortcut}/>:step.type==='api-call'?<Globe size={18}/>:<Hand size={18}/>}</button><button className="remove-gesture" aria-label={`Remove ${motion.name} action ${index+1}`} onClick={()=>setChain(assignment,chain(assignment).filter((_,i)=>i!==index))}><X size={10}/></button></div>)}</ActionChain>}
     {(assignment.appAction?.type==='adjust'||active&&adjustOpen)&&<AdjustEditor initial={assignment.appAction} profiles={profiles} autoOpen={assignment.appAction?.type!=='adjust'} onActivate={()=>{if(!active){edit(motion.id);setAdjustOpen(true);}}} onSave={action=>update(assignment.id,{appAction:action,shortcut:null,enabled:!!(action.increase||action.decrease)&&(assignment.appAction?.type==='adjust'?assignment.enabled||!assignment.appAction.increase&&!assignment.appAction.decrease:true)})} onCancel={close} onRemove={()=>{update(assignment.id,{appAction:undefined,shortcut:null,enabled:false});close();}} dragHandle={draggableOutput?{onDragStart:e=>beginShortcutDrag(assignment.id,e),onDragEnd:endShortcutDrag}:undefined}/>}
     {(assignment.appAction?.type==='mouse-movement'||active&&mouseOpen)&&<MouseMovementEditor initial={assignment.appAction} autoOpen={assignment.appAction?.type!=='mouse-movement'} onActivate={()=>{if(!active){edit(motion.id);setMouseOpen(true);}}} onSave={action=>update(assignment.id,{appAction:action,shortcut:null,enabled:assignment.appAction?.type==='mouse-movement'?assignment.enabled:true})} onCancel={close} onRemove={()=>{update(assignment.id,{appAction:undefined,shortcut:null,enabled:false});close();}} dragHandle={draggableOutput?{onDragStart:e=>beginShortcutDrag(assignment.id,e),onDragEnd:endShortcutDrag}:undefined}/>}
     <div className={`single-action ${active?'is-capturing':''}`}>{(assignment.appAction?.type!=='adjust'&&assignment.appAction?.type!=='mouse-movement'&&(!active||!adjustOpen&&!mouseOpen)&&(active||assignment.appAction?.type!=='sequence'))&&<button className={`shortcut-button ${active?'recording':''} ${draggableOutput?'shortcut-draggable':''}`} draggable={draggableOutput} title={draggableOutput?'Drag to another gesture or profile':undefined} onDragStart={e=>beginShortcutDrag(assignment.id,e)} onDragEnd={endShortcutDrag} aria-label={`${active?'Recording':'Edit'} ${motion.name} shortcut${draggableOutput?'. Drag to another gesture or profile.':''}`} aria-pressed={active} onClick={()=>{if(active){close();return;}if(assignment.appAction?.type==='show-cheat-sheet'){setCheatSheetEditingIndex(null);setCheatSheetEditing(assignment.id);onEditing(true);return;}edit(motion.id);setAdjustOpen(assignment.appAction?.type==='adjust');setRadialOpen(assignment.appAction?.type==='radial-menu'||assignment.appAction?.type==='open-profile-picker');}}>
      {active?<span className="keycaps">{keys.length?keys.map(key=><kbd key={key} className={`recording-key ${key==='Space'?'wide':''}`}>{keyNames[key]||key}</kbd>):<kbd className="recording-key"><Keyboard size={17} strokeWidth={1.5}/></kbd>}</span>:assignment.appAction?<span className="app-action-cap"><Hand size={16} strokeWidth={1.5}/> {actionLabel(assignment.appAction)}</span>:assignment.shortcut?<Keycaps shortcut={assignment.shortcut}/>:<span className="keycaps"><kbd className="empty-key"><Plus size={16} strokeWidth={1.4}/></kbd></span>}
     </button>}

     {(assignment.appAction?.type!=='adjust'&&assignment.appAction?.type!=='mouse-movement'&&(!active||!adjustOpen&&!mouseOpen)&&(active||assignment.shortcut||(assignment.appAction&&assignment.appAction.type!=='sequence')))&&<button className="clear-shortcut" aria-label={`${active?'Cancel recording for':'Remove'} ${motion.name}${active?'':' shortcut'}`} onClick={()=>{if(!active)onChange(assignments.map(a=>a.id===motion.id?{...a,shortcut:null,appAction:undefined,enabled:false}:a));close();}}><X size={13}/></button>}</div>
     {!active&&chain(assignment).length>0&&chain(assignment).length<16&&<button className="add-action" aria-label={`Add action to ${motion.name}`} title="Add next action" onClick={()=>edit(motion.id,chain(assignment).length)}><Plus size={16}/></button>}
    </div>
    {assignment.steps?<div className="combo-controls"><ComboDropdown className="combo-time" label={`${motion.name} time between gestures`} value={String(assignment.intervalMs)} options={comboTimes.map(ms=>({value:String(ms),label:`Within ${ms<1000?`${ms} ms`:`${ms/1000} s`}`}))} onChange={value=>update(assignment.id,{intervalMs:Number(value)})}><Clock3 size={13}/><span>{assignment.intervalMs!<1000?`${assignment.intervalMs} ms`:`${assignment.intervalMs!/1000} s`}</span><ChevronDown size={12}/></ComboDropdown><button className="motion-toggle" role="switch" aria-label={`Enable ${motion.name}`} aria-checked={assignment.enabled} onClick={()=>(assignment.shortcut||assignment.appAction)?onChange(assignments.map(a=>a.id===motion.id?{...a,enabled:!a.enabled}:a)):edit(motion.id)}><span/></button></div>:<button className="motion-toggle" role="switch" aria-label={`Enable ${motion.name}`} aria-checked={assignment.enabled} onClick={()=>(assignment.shortcut||assignment.appAction)?onChange(assignments.map(a=>a.id===motion.id?{...a,enabled:!a.enabled}:a)):edit(motion.id)}><span/></button>}

   </div>;
  })}
  <button className="add-combo" onClick={()=>onChange([...assignments,{id:`combo-${crypto.randomUUID()}`,enabled:false,shortcut:null,steps:[{gesture:'tap-index'},{gesture:'tap-middle'}],intervalMs:500}])}><Plus size={16}/>Add gesture combo</button>
 </section>{cheatSheetEditing&&<CheatSheetEditor assignments={assignments} initial={cheatSheetDescriptions} profileName={profileName} actionLabel={actionLabel} onCancel={closeCheatSheetEditor} onSave={descriptions=>{onCheatSheetDescriptionsChange(descriptions);closeCheatSheetEditor();}} onChangeShortcut={()=>{const id=cheatSheetEditing;closeCheatSheetEditor();edit(id,cheatSheetEditingIndex);}}/>}{airEditing&&<AirGestureEditor initial={airEditing.initial} onCancel={closeAir} onSave={air=>{const a=assignments.find(a=>a.id===airEditing.id);if(a?.steps){const steps=[...a.steps];steps.splice(airEditing.index,airEditing.index<steps.length?1:0,{gesture:'air',air});if(validHoldOrder(steps))update(a.id,{steps});}closeAir();}}/>}{radialOpen&&(()=>{const action=assignments.find(a=>a.id===editing)?.appAction;const picker=action?.type==='open-profile-picker';return <RadialEditor fixedProfiles={picker} initial={picker?{type:'radial-menu',items:profiles.map(p=>({id:p.id,name:p.name,angle:action.positions?.[p.id],output:{type:'change-profile',profileId:p.id}}))}:action} profiles={profiles} onSave={value=>assignAction(picker?{type:'open-profile-picker',positions:Object.fromEntries(value.items.filter(item=>item.angle!==undefined).map(item=>[item.id,item.angle!]))}:value)} onCancel={close}/>;})()} {typeOpen&&<TypeTextDialog initial={actionIndex!==null?chain(assignments.find(a=>a.id===editing)!)[actionIndex] as AppAction:assignments.find(a=>a.id===editing)?.appAction} onCancel={()=>setTypeOpen(false)} onSave={assignAction}/>} {apiOpen&&<ApiCallDialog initial={actionIndex!==null?chain(assignments.find(a=>a.id===editing)!)[actionIndex] as AppAction:assignments.find(a=>a.id===editing)?.appAction} onCancel={()=>setApiOpen(false)} onSave={assignAction}/>}<div className="combo-scroll-space" aria-hidden="true"/><span className="sr-only" role="status">{editing?'Recording shortcut. Press a key combination. Escape cancels.':reorderNotice}</span></div>;
}
