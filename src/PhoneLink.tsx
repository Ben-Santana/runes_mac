import {useEffect,useState} from 'react';
import {Hand,Settings,Smartphone} from 'lucide-react';
import type {Message} from './types';

export type PhoneLinkState={state:string;phone?:string|null;phones:{id:string;name:string}[]};
export type PhonePairing={text:string|null;image?:string|null;expires?:number};

const statusText:Record<string,string>={connected:'Connected to iPhone',away:'iPhone not nearby',open_app:'Open Runes on iPhone once',sleeping:'iPhone not nearby',searching:'Connecting to iPhone…',unpaired:'Pair your iPhone',unavailable:'iPhone link unavailable',starting:'Starting…'};
export const phoneStatus=(link:PhoneLinkState)=>statusText[link.state]??'Starting…';

/** The Mac's only gesture source is Runes on a paired iPhone. */
export function usePhoneLink(){
 const [link,setLink]=useState<PhoneLinkState>({state:'starting',phones:[]});
 const [pairing,setPairing]=useState<PhonePairing>({text:null});
 const [bluetooth,setBluetooth]=useState<string|null>(null);
 useEffect(()=>{
  const off=window.band?.onMessage((m:Message)=>{
   if(m.kind==='phone_link')setLink({state:String(m.state),phone:m.phone??null,phones:Array.isArray(m.phones)?m.phones:[]});
   if(m.kind==='phone_pairing')setPairing({text:m.text??null,image:m.image??null,expires:m.expires});
   if(m.kind==='phone_bluetooth')setBluetooth(m.state);
  });
  window.band?.send({action:'phone_status'});
  return off;
 },[]);
 return {link,pairing,bluetooth};
}

function BluetoothNote({bluetooth}:{bluetooth:string|null}){
 if(bluetooth==='unauthorized')return <p className="pairing-note" role="alert">Allow Runes to use Bluetooth in System Settings → Privacy &amp; Security → Bluetooth.</p>;
 if(bluetooth==='off')return <p className="pairing-note" role="alert">Turn on Bluetooth on this Mac.</p>;
 return null;
}

function Code({pairing}:{pairing:PhonePairing}){
 return <div className="pairing-code">{pairing.image?<><img src={pairing.image} alt="Pairing code for Runes on iPhone" width={240} height={240}/><span className="pairing-logo" aria-hidden="true"><Hand size={30} strokeWidth={2}/></span></>:<div className="pairing-code-wait" aria-live="polite">Preparing a code…</div>}</div>;
}

function Steps(){
 return <ol className="pairing-steps">
  <li><span>1</span><p>Open <b>Runes</b> on your iPhone.</p></li>
  <li><span>2</span><p>Tap <b>Settings</b> <Settings size={14} strokeWidth={1.8} aria-label="gear icon"/> at the top right.</p></li>
  <li><span>3</span><p>Under <b>Mac</b>, tap <b>Pair Mac</b> and point the camera at this code.</p></li>
 </ol>;
}

/** First run. Shown until an iPhone is paired; afterwards pairing never appears again. */
export function PairingScreen({pairing,bluetooth}:{pairing:PhonePairing;bluetooth:string|null}){
 return <div className="pairing-screen" role="dialog" aria-modal="true" aria-labelledby="pairing-title">
  <section className="pairing-card">
   <Code pairing={pairing}/>
   <div className="pairing-heading">
    <Smartphone size={26} strokeWidth={1.4} aria-hidden="true"/>
    <h2 id="pairing-title">Open Runes on your iPhone and scan this code.</h2>
   </div>
   <Steps/>
   <BluetoothNote bluetooth={bluetooth}/>
  </section>
 </div>;
}

/** Device settings: which iPhone, and the rare actions. */
export function PhoneSettings({link,pairing,bluetooth}:{link:PhoneLinkState;pairing:PhonePairing;bluetooth:string|null}){
 const [adding,setAdding]=useState(false);
 useEffect(()=>{if(link.state==='connected')setAdding(false);},[link.state,link.phones.length]);
 function add(show:boolean){setAdding(show);window.band?.send({action:'phone_pair',show});}
 function remove(id:string,name:string){if(window.confirm(`Remove ${name}? Gestures from it will stop until you pair again.`))window.band?.send({action:'phone_forget',id});}
 return <>
  <section><h2>iPhone</h2><p>Runes on your iPhone receives gestures from your band and sends them to this Mac.{link.state==='away'?' If your iPhone is nearby, open Runes on it once.':''}</p></section>
  <section className="panel settings-panel">
   <div className="setting-row"><span>Status</span><span>{phoneStatus(link)}</span></div>
   {link.phones.map(phone=><div className="setting-row" key={phone.id}><span>{phone.name}</span><button className="button" onClick={()=>remove(phone.id,phone.name)}>Remove</button></div>)}
   <BluetoothNote bluetooth={bluetooth}/>
   {adding&&pairing.text?<div className="settings-pairing"><Code pairing={pairing}/><p>On the other iPhone, open Runes, tap <b>Settings</b> at the top right, then <b>Pair another Mac</b> or <b>Pair Mac</b>.</p><button className="button" onClick={()=>add(false)}>Done</button></div>
    :link.phones.length>0&&<div className="settings-actions"><button className="button" onClick={()=>add(true)}>Pair another iPhone</button></div>}
  </section>
 </>;
}
