import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';

export function IdentityQR({deviceId,onClose}:{deviceId:string;onClose:()=>void}) {
 const [image,setImage]=useState(''),[error,setError]=useState('');
 const [attempt,setAttempt]=useState(0);
 const close=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement;
  close.current?.focus();
  const hide=()=>onClose();
  const visibility=()=>{if(document.hidden)hide();};
  const timer=setTimeout(hide,60000);
  document.addEventListener('visibilitychange',visibility);
  return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);previous?.focus();};
 },[deviceId,onClose]);
 useEffect(()=>{
  let active=true;
  setImage('');setError('');
  if(window.band?.identityQR) {
   window.band.identityQR(deviceId).then(value=>{if(active)setImage(value);}).catch((reason:unknown)=>{if(active){const message=reason instanceof Error?reason.message:'';setError(message.replace(/^Error invoking remote method 'band:identity-qr': (?:Error: )?/, '')||'Could not export the band identity. Try again.');}});
  } else setError('Open the macOS app to display your band identity.');
  return()=>{active=false;};
 },[deviceId,attempt]);
 useEffect(()=>{
  if(!image)return;
  window.addEventListener('blur',onClose);
  return()=>window.removeEventListener('blur',onClose);
 },[image,onClose]);
 return createPortal(<div className="modal-scrim identity-qr-scrim" onPointerDown={event=>{if(event.target===event.currentTarget)onClose();}} onKeyDown={event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}
  if(event.key==='Tab'){const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));const first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
 }}><section className="modal identity-qr-modal" role="dialog" aria-modal="true" aria-labelledby="identity-qr-title" aria-describedby="identity-qr-help">
  <button ref={close} className="modal-close" aria-label="Hide identity QR code" onClick={onClose}><X size={18}/></button>
  <h2 id="identity-qr-title">Connect your iPhone</h2>
  <p id="identity-qr-help">Disconnect the band on this Mac first. On iPhone, select the same band, tap Import Mac identity, and scan this code.</p>
  <div className="identity-qr-image" aria-busy={!image&&!error}>{image?<img src={image} alt="Band identity QR code" draggable={false}/>:<p role={error?'alert':'status'}>{error||'Reading the saved identity from Keychain…'}</p>}</div>
  {error&&<button className="button primary" onClick={()=>setAttempt(value=>value+1)}>Retry Keychain access</button>}
  <p className="identity-qr-warning">This code contains your private band key. Keep it out of photos and screen sharing. Hides after 60 seconds; copies remain usable.</p>
 </section></div>,document.body);
}
