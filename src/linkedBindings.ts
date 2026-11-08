import {useEffect,useState} from 'react';
import {macActionLabel,motions,shortcutLabel,type AppAction,type Assignment,type GestureStep} from './shortcuts';
import type {Message} from './types';

/** One assigned gesture or combo, in the format both apps share over the iPhone link (RelayWire.Binding). */
export type LinkedBinding={trigger:string;profile:string;action:string};

/** A gesture id, or a combo's steps joined by spaces (`gesture[:axis[:direction]]`), the same on iPhone. */
function stepKey(s:GestureStep){
 if(s.gesture==='rotation')return `rotation:${s.axis??'x'}:${s.direction??'any'}`;
 if(s.gesture==='movement')return `movement:${s.axis??'x'}`;
 return s.gesture;
}
export function triggerKey(a:Pick<Assignment,'id'|'steps'>){return a.steps?a.steps.map(stepKey).join(' '):a.id;}

const stepNames:Record<string,string>={'release-index':'Release index','release-middle':'Release middle',air:'Air gesture',...Object.fromEntries(motions.map(m=>[m.id,m.name]))};
export function triggerName(trigger:string){
 const parts=trigger.split(' ').map(p=>{const [g,axis,dir]=p.split(':');if(g==='rotation')return `Rotate ${axis.toUpperCase()}${dir&&dir!=='any'?` ${dir}`:''}`;if(g==='movement')return `Move ${axis.toUpperCase()}`;return stepNames[g]??g;});
 return parts.length>1?`the combo ${parts.join(' → ')}`:parts[0];
}

function appActionLabel(a:AppAction,profiles:{id:string;name:string}[]):string{
 switch(a.type){
  case 'show-cheat-sheet':return 'Profile cheat sheet';
  case 'macos-action':return macActionLabel(a);
  case 'type-text':return 'Type text';
  case 'api-call':try{return `${a.method} ${new URL(a.url).host}`;}catch{return 'API call';}
  case 'change-profile':return `Switch to ${profiles.find(p=>p.id===a.profileId)?.name??'a profile'}`;
  case 'move-profile':return a.direction==='down'?'Next profile':'Previous profile';
  case 'open-profile-picker':return 'Profile picker';
  case 'radial-menu':return 'Radial menu';
  case 'mouse-movement':return 'Mouse movement';
  case 'adjust':return 'Adjust';
  case 'sequence':return a.actions.map(s=>s.type==='shortcut'?shortcutLabel(s.shortcut):appActionLabel(s,profiles)).join(' → ');
 }
}
export function assignmentLabel(a:Assignment,profiles:{id:string;name:string}[]){
 return a.appAction?appActionLabel(a.appAction,profiles):a.shortcut?shortcutLabel(a.shortcut):'';
}
const isSet=(a:Assignment)=>a.enabled&&!!(a.shortcut||a.appAction);

export function macBindings(profiles:{id:string;name:string;assignments:Assignment[]}[]):LinkedBinding[]{
 return profiles.flatMap(p=>p.assignments.filter(isSet).map(a=>({trigger:triggerKey(a),profile:p.name,action:assignmentLabel(a,profiles)})));
}

/** Assignments in `next` that newly do something, or now do something else, compared with `previous`. */
export function newlySet(previous:Assignment[],next:Assignment[]){
 return next.filter(a=>{if(!isSet(a))return false;const old=previous.find(p=>p.id===a.id);return !old||!isSet(old)||triggerKey(old)!==triggerKey(a)||JSON.stringify([old.shortcut,old.appAction])!==JSON.stringify([a.shortcut,a.appAction]);});
}

/** Asks before using a gesture the iPhone already uses. True when the change may go ahead. */
export function confirmPhoneOverlap(changed:Assignment[],phone:LinkedBinding[]){
 const lines=changed.flatMap(a=>{const key=triggerKey(a);return phone.filter(b=>b.trigger===key).map(b=>`${triggerName(key)[0].toUpperCase()+triggerName(key).slice(1)} is set to “${b.action}” in the ${b.profile} profile.`);});
 if(!lines.length)return true;
 return window.confirm(`On your iPhone:\n${[...new Set(lines)].join('\n')}\n\nBoth will run when you make it. Set it here anyway?`);
}

export function usePhoneBindings(){
 const [bindings,setBindings]=useState<LinkedBinding[]>([]);
 useEffect(()=>window.band?.onMessage((m:Message)=>{if(m.kind==='phone_bindings')setBindings(Array.isArray(m.entries)?m.entries.filter((e:any)=>e&&typeof e.trigger==='string'):[]);}),[]);
 return bindings;
}
