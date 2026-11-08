import {spaceRadialItems} from '../electron/radial-layout';
import {RadialSurface,RadialCursor,radialPosition,radialLabel} from './RadialEditor';
import {playRadialClick} from './connectBell';
import type {RadialAction} from './shortcuts';
import {useEffect,useRef,useState} from 'react';
import type {CSSProperties} from 'react';
import {Home,RotateCw,Pointer} from 'lucide-react';
import {OutputIcon,profileIcons as icons} from './MenuIcons';
type PickerState={condensed?:boolean;pointer?:{x:number;y:number};compact?:boolean;radialItems?:RadialAction['items'];profiles:{id:string;name:string;icon?:string;angle?:number}[];selected:number;angle:number};
export function ProfilePicker(){
 const [phase,setPhase]=useState('entering');
 const [entrance,setEntrance]=useState(0);
 const [state,setState]=useState<PickerState>({profiles:[],selected:0,angle:0});
 const [position,setPosition]=useState(0);
 const motion=useRef({position:0,target:0,velocity:0,ready:false});
 const heard=useRef<number|null>(null);
 useEffect(()=>{
  document.documentElement.classList.add('picker-window');
  const unsubscribe=window.band?.onMessage(m=>{
   if(m.kind==='picker_state'){
    const next=m.state as PickerState;
    if(!Array.isArray(next.profiles)||!Number.isFinite(next.angle))return;
    // The backend supplies an unwrapped, continuous angle in radians.
    // Preserve full turns instead of snapping the cursor to the selected slot.
    const target=next.angle;
    motion.current.target=target;
    if(!motion.current.ready){motion.current.position=target;motion.current.ready=true;setPosition(target);}
    const count=Array.isArray(next.radialItems)?next.radialItems.length:next.profiles.length;
    if(heard.current!==null&&next.selected!==heard.current)playRadialClick(next.selected,count);
    heard.current=next.selected;
    setState(next.radialItems?{...next,radialItems:spaceRadialItems(next.radialItems)}:next);
   }
   if(m.kind==='picker_condensed')setState(previous=>({...previous,condensed:m.condensed===true}));
   if(m.kind==='picker_open'){
    heard.current=null;
    motion.current.position=motion.current.target;motion.current.velocity=0;setPosition(motion.current.target);
    setEntrance(n=>n+1);setPhase('entering');
   }
   if(m.kind==='picker_close'){
    const pointer=m.pointer as PickerState['pointer'];
    if(pointer&&Number.isFinite(pointer.x)&&Number.isFinite(pointer.y))setState(previous=>({...previous,pointer}));
    setPhase('leaving');
   }
  });
  window.band?.send({action:'picker_ready'});
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0,last=0;
  const tick=(now:number)=>{
   const dt=Math.min((now-(last||now))/1000,0.032);last=now;
   const m=motion.current;
   if(reduced.matches){m.position=m.target;m.velocity=0;}
   else {
    // Critically damped spring: continuous velocity, no packet-rate dependence or overshoot.
    // omega 45 trails a steady turn by ~44 ms (2/omega) while still hiding packet steps.
    const omega=45,delta=m.position-m.target,decay=Math.exp(-omega*dt);
    const step=(m.velocity+omega*delta)*dt;
    m.position=m.target+(delta+step)*decay;
    m.velocity=(m.velocity-omega*step)*decay;
    if(Math.abs(m.position-m.target)<0.0001&&Math.abs(m.velocity)<0.001){m.position=m.target;m.velocity=0;}
   }
   setPosition(previous=>previous===m.position?previous:m.position);
   frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);
  return ()=>{unsubscribe?.();cancelAnimationFrame(frame);document.documentElement.classList.remove('picker-window');};
 },[]);
 const pointerStyle={'--pointer-x':`${state.pointer?.x??80}px`,'--pointer-y':`${state.pointer?.y??80}px`} as CSSProperties;
 if(state.radialItems)return <div key={entrance} className={`desktop-picker ${phase} ${state.compact?'compact-picker':''} ${state.condensed?'picker-condensed':''}`} style={pointerStyle} role="dialog" aria-label="Radial menu"><span className="picker-follow-ball" aria-hidden="true"/><RadialSurface center={null}>
 {!!state.radialItems.length&&<RadialCursor angle={position}/>}
 {state.radialItems.map((item,index)=><button key={item.id} className={`picker-tile radial-runtime-item ${index===state.selected?'selected':''}`} style={radialPosition(index,state.radialItems!.length,item.angle)} aria-label={item.name?.trim()||radialLabel(item.output,state.profiles)} onClick={()=>window.band?.send({action:'picker_select',profileId:item.id})}><span className="picker-paper"><OutputIcon value={item.output} profiles={state.profiles} icon={item.icon}/></span>{!state.compact&&<span className="radial-item-tooltip" role="tooltip">{item.name?.trim()||radialLabel(item.output,state.profiles)}</span>}</button>)}
 </RadialSurface></div>;
 const count=state.profiles.length;
 return <div key={entrance} className={`desktop-picker ${phase} ${state.compact?'compact-picker':''} ${state.condensed?'picker-condensed':''}`} style={pointerStyle} role="dialog" aria-label="Desktop profile picker" aria-describedby={state.compact?undefined:"picker-help"}>
  <span className="picker-follow-ball" aria-hidden="true"/>
  <div className="picker-panel">
   <div className="picker-orbit">
    <div className="picker-track" aria-hidden="true"/>
    {!state.compact&&<div className="picker-center"><p className="picker-selection" aria-live="polite" aria-atomic="true">{state.profiles[state.selected]?.name??'No profiles'}</p><div className="picker-help" id="picker-help"><span><RotateCw size={22} strokeWidth={1.5} aria-hidden="true"/><span>Choose</span></span><span><span className="picker-double-tap" aria-hidden="true"><Pointer size={22} strokeWidth={1.5}/><i>2</i></span><span>Select</span></span></div></div>}
    {!!count&&<div className="picker-cursor-arm" style={{transform:`rotate(${position}rad)`}} aria-hidden="true"><span className="picker-cursor"/></div>}
    {state.profiles.map((p,i)=>{
     const angle=p.angle??i/count*Math.PI*2;
     const centered=i===state.selected;
     const Icon=icons[p.icon as keyof typeof icons]??Home;
     return <button key={p.id} className={`picker-tile ${centered?'selected':''}`} style={{'--x':`${Math.sin(angle)*37}%`,'--y':`${-Math.cos(angle)*37}%`,'--tile-size':`${Math.min(76,Math.max(40,760/Math.max(count,1)))}px`} as CSSProperties} aria-label={`Select ${p.name}`} aria-pressed={centered} onClick={()=>window.band?.send({action:'picker_select',profileId:p.id})}>
      <span className="picker-paper"><Icon size={26} strokeWidth={1.5}/></span>
     </button>;
    })}
   </div>

  </div>
 </div>;
}
