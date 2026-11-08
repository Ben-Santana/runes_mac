import {useLayoutEffect,useRef,useState} from 'react';
import {ArrowLeft,ChevronRight,Check} from 'lucide-react';
import {macActions,validMacAction,type AppAction,type MacAction} from './shortcuts';

export function MacActionMenu({initial,onSave,onCancel}:{initial?:AppAction;onSave:(action:MacAction)=>void;onCancel:()=>void}){
 const saved=initial?.type==='macos-action'?initial:undefined;
 const [enterApp,setEnterApp]=useState(false);
 const [app,setApp]=useState(saved?.app??'');
 const menu=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const element=menu.current;if(!element)return;
  const place=()=>{const anchor=element.parentElement?.getBoundingClientRect();if(!anchor)return;const width=Math.min(260,window.innerWidth-24);const below=window.innerHeight-anchor.bottom-20;const above=anchor.top-20;const height=Math.min(360,Math.max(below,above));element.style.position='fixed';element.style.width=`${width}px`;element.style.left=`${Math.max(12,Math.min(anchor.left,window.innerWidth-width-12))}px`;element.style.maxHeight=`${height}px`;element.style.top=below>=Math.min(360,element.scrollHeight)||below>=above?`${anchor.bottom+8}px`:`${Math.max(12,anchor.top-Math.min(height,element.scrollHeight)-8)}px`;};
  place();element.querySelector<HTMLElement>(enterApp?'input':'[role="menuitem"]')?.focus();
  window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
  return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
 },[enterApp]);
 return <div ref={menu} className="runes-action-menu mac-action-menu" role={enterApp?'group':'menu'} aria-label={enterApp?'Open an app':'macOS actions'} onKeyDown={e=>{
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onCancel();}
  if(!enterApp&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
   e.preventDefault();const items=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')??[]);const index=items.indexOf(document.activeElement as HTMLButtonElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();
  }
 }}>
 {enterApp?<form className="mac-app-entry" onSubmit={e=>{e.preventDefault();const value:MacAction={type:'macos-action',action:'open-app',app:app.trim()};if(validMacAction(value))onSave(value);}}>
 <button type="button" onClick={()=>setEnterApp(false)}><ArrowLeft size={14}/>Back</button>
 <label htmlFor="mac-app-name">Open an app</label>
 <input id="mac-app-name" required maxLength={256} value={app} onChange={e=>setApp(e.target.value)} placeholder="App name, e.g. Safari" autoComplete="off"/>
 <button className="mac-app-save" type="submit" disabled={!validMacAction({type:'macos-action',action:'open-app',app:app.trim()})}>Save app</button>
 </form>:['Mouse','Apps','Sound & display','Current app'].map(group=><div key={group} role="group" aria-label={group}><p className="mac-action-group">{group}</p>{macActions.filter(a=>a.group===group).map(a=><button key={a.id} role="menuitem" onClick={()=>a.id==='open-app'?setEnterApp(true):onSave({type:'macos-action',action:a.id})}><span>{a.label}</span>{a.id==='open-app'?<ChevronRight size={14}/>:saved?.action===a.id?<Check size={14}/>:null}</button>)}</div>)}
 </div>;
}
