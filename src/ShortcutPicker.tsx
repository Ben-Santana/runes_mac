import type {CSSProperties,ReactNode} from 'react';
import {Gauge,Globe,Hand,MousePointer2} from 'lucide-react';
import {modifierKeys} from './shortcuts';

// Shared action buttons and modifier keycaps for every inline shortcut recorder.
export function ShortcutPicker({label='Shortcut modifiers',className='',held,onModifier,onMac,onApi,onRunes,macOpen=false,runesOpen=false,macMenu,runesMenu,adjust,mouse}:{label?:string;className?:string;held:string[];onModifier:(id:string)=>void;onMac:()=>void;onApi:()=>void;onRunes:()=>void;macOpen?:boolean;runesOpen?:boolean;macMenu?:ReactNode;runesMenu?:ReactNode;adjust?:{enabled:boolean;onClick:()=>void};mouse?:{enabled:boolean;open:boolean;onClick:()=>void}}){
 return <div className={`recorder-modifiers ${className}`} role="group" aria-label={label}>
  <div className="runes-action-controls"><button className="recorder-modifier runes-action-button" aria-label="macOS actions" title="macOS actions" aria-haspopup="menu" aria-expanded={macOpen} onClick={onMac}><svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.7 1.2c.2 1.5-.4 2.8-1.2 3.8-.9 1-2.2 1.6-3.5 1.5-.2-1.4.5-2.8 1.3-3.7.9-1 2.3-1.6 3.4-1.6ZM20.6 17.3c-.5 1.2-.8 1.8-1.5 2.8-1 1.4-2.3 3.1-3.9 3.1-1.4 0-1.8-.9-3.7-.9-1.8 0-2.3.9-3.7.9-1.6.1-2.8-1.5-3.8-2.9C1.3 16.4.8 11.6 2.5 9c1.2-1.8 3-2.8 4.7-2.8 1.5 0 2.5.9 3.8.9 1.3 0 2.1-.9 3.8-.9 1.5 0 3 .8 4.2 2.1-3.7 2-3.1 7.2 1.6 9Z"/></svg></button>{macMenu}</div>
  {adjust&&<button className="recorder-modifier" aria-label="Configure adjust" disabled={!adjust.enabled} title={adjust.enabled?'Adjust while holding':'End this combo with a hold to adjust'} onClick={adjust.onClick}><Gauge size={19} strokeWidth={1.5}/></button>}
  {mouse&&<button className="recorder-modifier" aria-label="Configure mouse movement" title="Mouse movement" aria-haspopup="menu" aria-expanded={mouse.open} disabled={!mouse.enabled} onClick={mouse.onClick}><MousePointer2 size={19} strokeWidth={1.5}/></button>}
  <button className="recorder-modifier" aria-label="Configure API call" title="API call" onClick={onApi}><Globe size={19} strokeWidth={1.5}/></button>
  <div className="runes-action-controls" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();onRunes();}}}><button className="recorder-modifier runes-action-button" aria-label="Runes actions" aria-expanded={runesOpen} onClick={onRunes}><Hand size={19} strokeWidth={1.5}/></button>{runesMenu}</div>
  <span className="recorder-divider" aria-hidden="true"/>{modifierKeys.map((m,index)=><button key={m.id} className="recorder-modifier" style={{'--modifier-index':index} as CSSProperties} aria-label={m.name} title={m.name} aria-pressed={held.includes(m.id)} onClick={e=>{onModifier(m.id);e.currentTarget.blur();}}><span>{m.symbol}</span></button>)}
 </div>;
}
