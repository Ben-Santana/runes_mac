import {moveRadialItem,spaceRadialItems} from '../electron/radial-layout';
import {menuIcons,OutputIcon} from './MenuIcons';
import {useEffect,useLayoutEffect,useRef,useState,type CSSProperties,type ReactNode,type PointerEvent} from 'react';
import {createPortal} from 'react-dom';
import {Check,Smile,X,RotateCcw} from 'lucide-react';
import {AdjustActionSlot} from './AdjustActionSlot';
import {macActionLabel,shortcutLabel,type AppAction,type AdjustOutput,type RadialAction} from './shortcuts';

export function radialLabel(value:AdjustOutput,profiles:{id:string;name:string}[]=[]):string{
 if(!('type' in value))return shortcutLabel(value);
 if(value.type==='show-cheat-sheet')return 'Profile cheat sheet';
 if(value.type==='shortcut')return shortcutLabel(value.shortcut);
 if(value.type==='macos-action')return macActionLabel(value);
 if(value.type==='api-call')return `${value.method} ${new URL(value.url).host}`;
 if(value.type==='sequence')return value.actions.map(v=>radialLabel(v,profiles)).join(' → ');
 if(value.type==='change-profile')return profiles.find(p=>p.id===value.profileId)?.name??'Profile';
 if(value.type==='move-profile')return `Profile ${value.direction}`;
 return 'Desktop profile picker';
}
export function RadialCursor({angle}:{angle:number}){return <div className="picker-cursor-arm" style={{transform:`rotate(${angle}rad)`}} aria-hidden="true"><span className="picker-cursor"/></div>;}
export function RadialSurface({children,center,onPointerMove}:{children:ReactNode;center:ReactNode;onPointerMove?:(event:PointerEvent<HTMLDivElement>)=>void}){
 return <div className="picker-panel radial-panel"><div className="picker-orbit radial-orbit" onPointerMove={onPointerMove}><div className="picker-track" aria-hidden="true"/><div className="picker-center">{center}</div>{children}</div></div>;
}
export function radialAngle(item:{angle?:number},index:number,count:number){return item.angle??index/Math.max(1,count)*Math.PI*2;}
export function radialPosition(index:number,count:number,customAngle?:number):CSSProperties{const angle=customAngle??index/Math.max(1,count)*Math.PI*2;return {'--x':`${Math.sin(angle)*38}%`,'--y':`${-Math.cos(angle)*38}%`,'--tile-size':'82px'} as CSSProperties;}
function IconLibrary({selected,onSelect,onClose}:{selected?:string;onSelect:(icon:string)=>void;onClose:()=>void}){
 const root=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{const el=root.current;if(!el)return;const place=()=>{const anchor=el.parentElement!.getBoundingClientRect();const height=el.offsetHeight;el.style.left=`${Math.max(12,Math.min(anchor.left+anchor.width/2-118,window.innerWidth-248))}px`;el.style.top=`${Math.max(12,Math.min(anchor.bottom+12+height<window.innerHeight?anchor.bottom+12:anchor.top-height-12,window.innerHeight-height-12))}px`;};place();el.querySelector<HTMLButtonElement>('[aria-pressed="true"],button')?.focus();window.addEventListener('resize',place);return()=>window.removeEventListener('resize',place);},[]);
 return <div ref={root} className="radial-icon-library profile-icon-picker" role="dialog" aria-label="Choose shortcut icon" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const buttons=Array.from(root.current!.querySelectorAll<HTMLButtonElement>('button'));const index=buttons.indexOf(document.activeElement as HTMLButtonElement);const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-6,ArrowDown:6}[event.key]!;buttons[(index+delta+buttons.length)%buttons.length]?.focus();}}}><div>{Object.entries(menuIcons).map(([name,Icon])=><button key={name} aria-label={`Use ${name} icon`} aria-pressed={selected===name} onClick={()=>onSelect(name)}><Icon size={19} strokeWidth={1.5}/></button>)}</div></div>;
}
export function RadialEditor({initial,profiles,onSave,onCancel,fixedProfiles=false}:{fixedProfiles?:boolean;initial?:AppAction;profiles:{id:string;name:string}[];onSave:(value:RadialAction)=>void;onCancel:()=>void}){
 const [items,setItems]=useState<RadialAction['items']>(initial?.type==='radial-menu'?spaceRadialItems(initial.items):[]);
 const [adding,setAdding]=useState(false);
 const [iconItem,setIconItem]=useState<string|null>(null);
 const root=useRef<HTMLDivElement>(null);
 const previous=useRef<HTMLElement|null>(null);
 useEffect(()=>{const appRoot=document.getElementById('root');const wasInert=appRoot?.inert??false;if(appRoot)appRoot.inert=true;previous.current=document.activeElement as HTMLElement;root.current?.querySelector<HTMLButtonElement>('.radial-done')?.focus();return()=>{if(appRoot)appRoot.inert=wasInert;previous.current?.focus();};},[]);
 useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&!adding){event.preventDefault();onCancel();}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[adding,onCancel]);
 const [autoAngles,setAutoAngles]=useState<Record<string,number>|null>(null);
 const autoFrame=useRef(0);
 useEffect(()=>()=>cancelAnimationFrame(autoFrame.current),[]);
 function displayedAngle(item:RadialAction['items'][number],index:number){return autoAngles?.[item.id]??radialAngle(item,index,items.length);}
 function autoSpace(){
  cancelAnimationFrame(autoFrame.current);
  const first=radialAngle(items[0],0,items.length);
  const ordered=items.map((item,index)=>({item,angle:first+((radialAngle(item,index,items.length)-first+Math.PI*2)%(Math.PI*2))})).sort((a,b)=>a.angle-b.angle);
  const next=ordered.map(({item:{angle,...item}})=>item);
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){setAutoAngles(null);setItems(next);return;}
  const rotation=Math.round(first/(Math.PI*2))*Math.PI*2;
  setAutoAngles(Object.fromEntries(ordered.map(({item,angle})=>[item.id,angle])));
  setItems(next);
  const began=performance.now();
  const tick=(now:number)=>{
   const progress=Math.min(1,(now-began)/360),ease=1-Math.pow(1-progress,3);
   if(progress===1){setAutoAngles(null);return;}
   setAutoAngles(Object.fromEntries(ordered.map(({item,angle},index)=>[item.id,angle+(rotation+index/ordered.length*Math.PI*2-angle)*ease])));
   autoFrame.current=requestAnimationFrame(tick);
  };
  autoFrame.current=requestAnimationFrame(tick);
 }
 const [dragging,setDragging]=useState<string|null>(null);
 const dragStart=useRef<RadialAction['items']|null>(null);
 function moveItem(id:string,event:PointerEvent<HTMLButtonElement>){
  const orbit=root.current?.querySelector('.radial-orbit')?.getBoundingClientRect();
  if(!orbit)return;
  const x=event.clientX-orbit.left-orbit.width/2,y=event.clientY-orbit.top-orbit.height/2;
  if(Math.hypot(x,y)<20)return;
  const angle=(Math.atan2(x,-y)+Math.PI*2)%(Math.PI*2);
  setItems(current=>moveRadialItem(current,id,angle));
 }
 const angles=items.map((item,index)=>radialAngle(item,index,items.length)).sort((a,b)=>a-b);
 const gap=angles.map((angle,index)=>({angle,size:(angles[index+1]??angles[0]+Math.PI*2)-angle})).sort((a,b)=>b.size-a.size)[0];
 const addAngle=gap?(gap.angle+gap.size/2)%(Math.PI*2):0;
 function commit(next:RadialAction['items']){setItems(spaceRadialItems(next));}
 return createPortal(<div className="modal-scrim radial-scrim" onClick={onCancel} onKeyDown={event=>{
 if(event.key==='Escape'&&iconItem){event.preventDefault();event.stopPropagation();setIconItem(null);return;}
 if(event.key==='Escape'&&!adding){event.preventDefault();event.stopPropagation();onCancel();}
 if(event.key==='Tab'){const buttons=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea')??[]).filter(el=>el.getClientRects().length);const first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
 }}><div ref={root} className="radial-editor" data-autospacing={!!autoAngles} role="dialog" aria-modal="true" aria-label={fixedProfiles?"Desktop profile picker editor":"Radial menu editor"} onPointerDown={event=>{if(iconItem&&event.target instanceof Element&&!event.target.closest('.radial-icon-library,.radial-icon-trigger'))setIconItem(null);}} onClick={e=>e.stopPropagation()}>
 <RadialSurface center={<><button className="radial-done" aria-label="Save radial menu" title="Save radial menu" disabled={!items.length||adding} onClick={()=>onSave({type:'radial-menu',items})}><Check size={22}/></button><button className="radial-close" aria-label="Cancel radial menu" title="Cancel" onClick={onCancel}><X size={15}/></button></>}>
 {items.map((item,index)=><div className={`radial-slot ${iconItem===item.id?'is-picking-icon':''} ${dragging===item.id?'is-positioning':''}`} key={item.id} style={radialPosition(index,items.length,displayedAngle(item,index))}>
 <button className="radial-position-handle" disabled={!!autoAngles} aria-label={`Move radial item ${index+1}`} title="Drag to reposition · arrow keys to rotate" style={{'--handle-angle':`${displayedAngle(item,index)}rad`} as CSSProperties}
 onPointerDown={event=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);dragStart.current=items;setDragging(item.id);setIconItem(null);}}
 onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))moveItem(item.id,event);}}
 onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);setDragging(null);dragStart.current=null;}}
 onPointerCancel={()=>{if(dragStart.current)setItems(dragStart.current);setDragging(null);dragStart.current=null;}}
 onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();const delta=(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)*Math.PI/(event.shiftKey?36:18);commit(moveRadialItem(items,item.id,radialAngle(item,index,items.length)+delta));}}><svg viewBox="0 0 112 112" aria-hidden="true"><path className="radial-drag-hit" d="M 21.352 21.352 A 49 49 0 0 1 90.648 21.352"/><path className="radial-drag-line" d="M 21.352 21.352 A 49 49 0 0 1 90.648 21.352"/></svg></button>
 {fixedProfiles?<div className="picker-tile" style={{'--x':'0%','--y':'0%'} as CSSProperties}><span className="picker-paper"><OutputIcon value={item.output} profiles={profiles}/></span></div>:<AdjustActionSlot direction="right" sequenceControls itemMenu={<><label className="radial-item-menu-name">Name<input aria-label={`Name for radial item ${index+1}`} placeholder="Name (optional)" maxLength={80} value={item.name??''} onChange={event=>commit(items.map(i=>i.id===item.id?{...i,name:event.target.value}:i))}/></label>
 <button className="radial-item-menu-action radial-icon-trigger" aria-label={`Choose icon for radial item ${index+1}`} aria-expanded={iconItem===item.id} aria-haspopup="dialog" onClick={()=>setIconItem(iconItem===item.id?null:item.id)}><Smile size={14}/>Change icon</button>
 {iconItem===item.id&&<IconLibrary selected={item.icon} onSelect={name=>{commit(items.map(i=>i.id===item.id?{...i,icon:name}:i));setIconItem(null);}} onClose={()=>setIconItem(null)}/>}</>} addLabel={`Add action to radial item ${index+1}`} ariaLabel={`Edit radial item ${index+1}`} removeLabel={`Remove radial item ${index+1}`} value={item.output} display={<OutputIcon value={item.output} profiles={profiles} icon={item.icon}/>} profiles={profiles} onEditingChange={editing=>{setAdding(editing);if(editing)setIconItem(null);}} onChange={output=>commit(items.map(i=>i.id===item.id?{...i,output}:i))} onRemove={()=>commit(items.filter(i=>i.id!==item.id))}/>}
 <span className="radial-item-tooltip" role="tooltip">{item.name?.trim()||radialLabel(item.output,profiles)}</span>
 </div>)}
 </RadialSurface>
 {!fixedProfiles&&items.length<8&&<div className="radial-slot radial-add-slot">
 <AdjustActionSlot key={`add-${items.length}`} direction="right" ariaLabel="Add radial item" profiles={profiles} onEditingChange={editing=>{setAdding(editing);if(editing)setIconItem(null);}} onChange={output=>{commit([...items,{id:crypto.randomUUID(),output,...(items.some(i=>i.angle!==undefined)?{angle:addAngle}:{})}]);setAdding(false);}} onRemove={()=>{}}/>
 </div>}
 <button className="radial-auto-space" disabled={!items.some(item=>item.angle!==undefined)} onClick={autoSpace}><RotateCcw size={14}/>Auto-space options</button>
 </div></div>,document.body);
}
