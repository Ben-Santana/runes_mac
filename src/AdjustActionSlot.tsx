import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {Apple,Globe,Hand,Keyboard,Plus,ChevronRight,ArrowLeft,ArrowRight,X} from 'lucide-react';
import {ShortcutPicker} from './ShortcutPicker';
import {Keycaps} from './MotionSettings';
import {MacActionMenu} from './MacActionMenu';
import {TypeTextDialog} from './TypeTextDialog';
import {ApiCallDialog} from './ApiCallDialog';
import {availableKeys,modifierKeys,macActionLabel,type AdjustOutput,type AppAction,type ActionStep,type Shortcut} from './shortcuts';

function label(value:Exclude<AdjustOutput,Shortcut>):string{
 if(value.type==='show-cheat-sheet')return 'Profile cheat sheet';
 if(value.type==='shortcut')return '';
 if(value.type==='type-text')return 'Type text';
 if(value.type==='sequence')return 'Sequence';
 if(value.type==='macos-action')return macActionLabel(value);
 if(value.type==='api-call')return `${value.method} ${new URL(value.url).host}`;
 if(value.type==='open-profile-picker')return 'Desktop profile picker';
 if(value.type==='move-profile')return `Profile ${value.direction}`;
 return 'Change profile';
}
export function Output({value,profiles}:{value:AdjustOutput;profiles:{id:string;name:string}[]}){
 if(!('type' in value))return <Keycaps shortcut={value}/>;
 if(value.type==='shortcut')return <Keycaps shortcut={value.shortcut}/>;
 if(value.type==='sequence')return <span className="adjust-output-sequence">{value.actions.map((step,i)=><span key={i}><Output value={step} profiles={profiles}/></span>)}</span>;
 return <span className="keycaps"><kbd className="adjust-action-key">{value.type==='api-call'?<Globe size={15}/>:value.type==='macos-action'?<Apple size={15}/>:<Hand size={15}/>}<span>{value.type==='change-profile'?(profiles.find(p=>p.id===value.profileId)?.name??'Missing profile'):label(value)}</span></kbd></span>;
}
export function AdjustActionSlot({itemMenu,direction,value,onChange,profiles,onEditingChange,onRemove,autoOpen=false,ariaLabel,removeLabel,addLabel,sequenceControls=false,display,dragHandle}:{itemMenu?:ReactNode;display?:ReactNode;removeLabel?:string;ariaLabel?:string;addLabel?:string;sequenceControls?:boolean;autoOpen?:boolean;direction:'left'|'right';value?:AdjustOutput;onChange:(value:AdjustOutput)=>void;profiles:{id:string;name:string}[];onEditingChange:(editing:boolean)=>void;onRemove:()=>void;dragHandle?:{onDragStart:(event:React.DragEvent)=>void;onDragEnd:()=>void}}){
 const [editing,setEditing]=useState(autoOpen);
 const [menuOpen,setMenuOpen]=useState(false);
 const menuRef=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  if(!menuOpen)return;
  const place=()=>{const anchor=root.current?.getBoundingClientRect(),menu=menuRef.current;if(!anchor||!menu)return;menu.style.left=`${Math.max(12,Math.min(anchor.left,window.innerWidth-menu.offsetWidth-12))}px`;menu.style.top=`${Math.max(12,Math.min(anchor.bottom+8,window.innerHeight-menu.offsetHeight-12))}px`;};
  place();const observer=new ResizeObserver(place);if(menuRef.current)observer.observe(menuRef.current);
  menuRef.current?.querySelector<HTMLInputElement>('input')?.focus();
  const dismiss=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setMenuOpen(false);};
  window.addEventListener('pointerdown',dismiss);window.addEventListener('resize',place);
  return()=>{observer.disconnect();window.removeEventListener('pointerdown',dismiss);window.removeEventListener('resize',place);};
 },[menuOpen]);
 const editingRef=useRef(onEditingChange);editingRef.current=onEditingChange;
 useEffect(()=>{editingRef.current(editing);return()=>editingRef.current(false);},[editing]);
 const [mode,setMode]=useState<'keys'|'mac'|'api'|'type'|'runes'|'move'|'profile'>('keys');
 const [append,setAppend]=useState(false);
 const [stepIndex,setStepIndex]=useState(0);
 const sequence=sequenceControls&&value&&'type' in value&&value.type==='sequence'?value.actions:null;
 const [preview,setPreview]=useState<Shortcut|null>(null);
 const [held,setHeld]=useState<string[]>([]);
 const root=useRef<HTMLDivElement>(null);
 const saveRef=useRef(onChange);saveRef.current=onChange;
 const valueRef=useRef(value);valueRef.current=value;
 const clicked=useRef(new Set<string>());
 function finish(output:AdjustOutput){
  const current=valueRef.current;
  if(append&&current){
   const step=(v:AdjustOutput):ActionStep|null=>!('type' in v)?{type:'shortcut',shortcut:v}:v.type==='sequence'||v.type==='open-profile-picker'?null:v;
   const actions:ActionStep[]='type' in current&&current.type==='sequence'?[...current.actions]:step(current)?[step(current)!]:[];
   const next=step(output);if(next&&actions.length&&actions.length<16){actions.push(next);saveRef.current({type:'sequence',actions});}
  }else if(sequence){
   const step:ActionStep|null=!('type' in output)?{type:'shortcut',shortcut:output}:output.type==='sequence'||output.type==='open-profile-picker'?null:output;
   if(step){const actions=[...sequence];actions[stepIndex]=step;saveRef.current({type:'sequence',actions});}
  }else saveRef.current(output);
  setEditing(false);setMode('keys');clicked.current.clear();
 }
 const finishRef=useRef(finish);finishRef.current=finish;
 useEffect(()=>{
  if(!editing)return;
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node)&&!(e.target instanceof Element&&e.target.closest('.api-call-scrim')))setEditing(false);};
  const blur=()=>{if(mode==='keys')setEditing(false);};
  window.addEventListener('pointerdown',outside,true);window.addEventListener('blur',blur);
  return()=>{window.removeEventListener('pointerdown',outside,true);window.removeEventListener('blur',blur);};
 },[editing,mode]);
 useEffect(()=>{
  if(!editing||mode!=='keys')return;
  const pressed=new Set<string>(),keys=new Set<string>(),modifiers=new Set<string>(clicked.current);
  const down=(e:KeyboardEvent)=>{
   if(e.target instanceof Element&&e.target.closest('.adjust-picker-options'))return;
   e.preventDefault();e.stopPropagation();
   if(e.key==='Escape'){setEditing(false);return;}
   modifierKeys.filter(m=>({command:e.metaKey,option:e.altKey,control:e.ctrlKey,shift:e.shiftKey}[m.id])).forEach(m=>modifiers.add(m.id));
   clicked.current.forEach(m=>modifiers.add(m));setHeld([...modifiers]);
   pressed.add(e.code||e.key);
   const punctuation:Record<string,string>={Minus:'-',Equal:'=',BracketLeft:'[',BracketRight:']',Semicolon:';',Quote:"'",Comma:',',Period:'.',Slash:'/',Backslash:'\\',Backquote:'`',Space:'Space'};
   const key=/^Key[A-Z]$/.test(e.code)?e.code.slice(3):/^Digit\d$/.test(e.code)?e.code.slice(5):punctuation[e.code]??e.key;
   if(availableKeys.includes(key))keys.add(key);
   setPreview(keys.size?{key:[...keys][0],keys:[...keys],modifiers:[...modifiers]}:null);
  };
  const up=(e:KeyboardEvent)=>{
   if(e.target instanceof Element&&e.target.closest('.adjust-picker-options'))return;
   e.preventDefault();e.stopPropagation();pressed.delete(e.code||e.key);
   if(e.key==='Meta'&&!e.metaKey)pressed.clear();
   if(pressed.size||e.metaKey||e.ctrlKey||e.altKey||e.shiftKey||!keys.size)return;
   finishRef.current({type:'shortcut',shortcut:{key:[...keys][0],keys:[...keys],modifiers:[...modifiers]}});
  };
  window.addEventListener('keydown',down,true);window.addEventListener('keyup',up,true);
  return()=>{window.removeEventListener('keydown',down,true);window.removeEventListener('keyup',up,true);};
 },[editing,mode]);
 function start(add=false){setMenuOpen(false);setAppend(add);setStepIndex(0);setPreview(null);setHeld([]);clicked.current.clear();setMode('keys');setEditing(true);}
 function updateSequence(actions:ActionStep[],selected=stepIndex){
  saveRef.current(actions.length>1?{type:'sequence',actions}:actions[0]);
  setStepIndex(Math.max(0,Math.min(selected,actions.length-1)));
 }
 const selected=sequence&&!append?sequence[stepIndex]:value;
 const initial=!append&&selected&&'type' in selected&&selected.type!=='shortcut'?selected as AppAction:undefined;
 return <div className={`adjust-action-slot ${editing?'is-choosing':''}`} ref={root} onKeyDown={e=>{if(e.key==='Escape'&&menuOpen){e.preventDefault();e.stopPropagation();setMenuOpen(false);root.current?.querySelector<HTMLButtonElement>('.adjust-capture')?.focus();return;}if(e.key==='Escape'&&editing){e.stopPropagation();setEditing(false);}}}>
  {menuOpen&&itemMenu&&<div ref={menuRef} className="radial-item-menu" role="dialog" aria-label="Radial item options" onClick={event=>event.stopPropagation()}>
   {itemMenu}
   <button className="radial-item-menu-action" onClick={()=>start()}>Edit action</button>
   {value&&(!('type' in value)||value.type!=='open-profile-picker'&&(value.type!=='sequence'||value.actions.length<16))&&<button className="radial-item-menu-action" onClick={()=>start(true)}>Add action</button>}
   <button className="radial-item-menu-action radial-item-menu-delete" onClick={()=>{setMenuOpen(false);onRemove();}}>Delete option</button>
  </div>}
  {editing&&<div className="adjust-action-toolbar" role="group" aria-label={`${direction} action options`}>
   {sequence&&!append&&<div className="adjust-picker-options radial-sequence-controls" role="group" aria-label="Radial item action sequence">
    <span>Actions run in order. Select a step to edit.</span>
    <div className="radial-sequence-steps">{sequence.map((step,index)=><button key={index} aria-label={`Edit sequence step ${index+1}`} aria-pressed={stepIndex===index} onClick={event=>{event.currentTarget.blur();setStepIndex(index);setPreview(null);setHeld([]);clicked.current.clear();setMode('keys');}}><span>{index+1}.</span><Output value={step} profiles={profiles}/></button>)}</div>
    <button aria-label="Move sequence step earlier" disabled={stepIndex===0} onClick={()=>{const actions=[...sequence];[actions[stepIndex-1],actions[stepIndex]]=[actions[stepIndex],actions[stepIndex-1]];updateSequence(actions,stepIndex-1);}}><ArrowLeft size={14}/></button>
    <button aria-label="Move sequence step later" disabled={stepIndex===sequence.length-1} onClick={()=>{const actions=[...sequence];[actions[stepIndex+1],actions[stepIndex]]=[actions[stepIndex],actions[stepIndex+1]];updateSequence(actions,stepIndex+1);}}><ArrowRight size={14}/></button>
    <button aria-label="Remove sequence step" onClick={()=>updateSequence(sequence.filter((_,index)=>index!==stepIndex))}><X size={14}/></button>
   </div>}
   <ShortcutPicker className="adjust-picker-options" held={held} onModifier={id=>{clicked.current.has(id)?clicked.current.delete(id):clicked.current.add(id);setHeld([...clicked.current]);}} onMac={()=>setMode(mode==='mac'?'keys':'mac')} onApi={()=>setMode('api')} onRunes={()=>setMode(mode==='runes'?'keys':'runes')} macOpen={mode==='mac'} runesOpen={['runes','move','profile'].includes(mode)} macMenu={mode==='mac'&&<MacActionMenu initial={initial} onSave={finish} onCancel={()=>setMode('keys')}/>} runesMenu={['runes','move','profile'].includes(mode)&&<div className="runes-action-menu" role="menu" aria-label={`${direction} Runes actions`}>
     {mode==='runes'?<><button role="menuitem" onClick={()=>setMode('type')}>Type text</button><button role="menuitem" disabled={append||!!sequence} onClick={()=>finish({type:'open-profile-picker'})}>Desktop profile picker</button><button role="menuitem" onClick={()=>setMode('move')}>Move profile selector <ChevronRight size={14}/></button><button role="menuitem" onClick={()=>setMode('profile')}>Change to profile <ChevronRight size={14}/></button></>:mode==='move'?(['up','down'] as const).map(d=><button key={d} role="menuitem" onClick={()=>finish({type:'move-profile',direction:d})}>{d==='up'?'Up':'Down'}</button>):profiles.map(p=><button key={p.id} role="menuitem" onClick={()=>finish({type:'change-profile',profileId:p.id})}>{p.name}</button>)}
    </div>}/>
   <div className="single-action is-capturing"><span className="keycaps">{preview?<Keycaps shortcut={preview}/>:<kbd className="recording-key"><Keyboard size={17} strokeWidth={1.5}/></kbd>}</span><button className="clear-shortcut" aria-label={`Cancel ${direction} action`} onClick={()=>setEditing(false)}><X size={16}/></button></div>
  </div>}
  <button className={`shortcut-button adjust-capture ${editing?'recording':''} ${dragHandle&&!editing&&value?'shortcut-draggable':''}`} draggable={!!dragHandle&&!editing&&!!value} title={dragHandle&&!editing&&value?'Drag to another gesture or profile':undefined} onDragStart={event=>{event.stopPropagation();dragHandle?.onDragStart(event);}} onDragEnd={()=>dragHandle?.onDragEnd()} aria-label={`${ariaLabel??`Edit ${direction} action`}${dragHandle&&!editing&&value?'. Drag to another gesture or profile.':''}`} aria-pressed={editing} tabIndex={editing?-1:0} aria-haspopup={itemMenu?'dialog':undefined} aria-expanded={itemMenu?menuOpen:undefined} onClick={()=>editing?setEditing(false):itemMenu?setMenuOpen(!menuOpen):start()}>
   {editing?(preview?<Keycaps shortcut={preview}/>:<span className="keycaps"><kbd className="recording-key"><Keyboard size={17}/></kbd></span>):value?(display??<Output value={value} profiles={profiles}/>):<span className="keycaps"><kbd className="empty-key"><Plus size={16}/></kbd></span>}
  </button>
  {!itemMenu&&!editing&&value&&<button className="adjust-slot-remove" aria-label={removeLabel??`Remove ${direction==='left'?'decrease':'increase'} action`} onClick={onRemove}><X size={10}/></button>}
  {!itemMenu&&!editing&&value&&(!('type' in value)||value.type!=='open-profile-picker'&&(value.type!=='sequence'||value.actions.length<16))&&<button className="adjust-add-action" aria-label={addLabel??`Add ${direction} action`} title={addLabel??`Add ${direction} action`} onClick={()=>start(true)}><Plus size={12}/></button>}
  {editing&&mode==='type'&&<TypeTextDialog initial={initial} onSave={finish} onCancel={()=>setMode('keys')}/>}
  {editing&&mode==='api'&&<ApiCallDialog initial={initial} onSave={finish} onCancel={()=>setMode('keys')}/>}
 </div>;
}
