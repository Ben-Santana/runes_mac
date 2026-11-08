import {useEffect,useRef,useState} from 'react';
import type {PointerEvent} from 'react';
import {normalizeQuaternion} from './SensorVisuals';
import {normalizePath,pathData,pathLength,rankAirGestures,rotatePath,wristPoint} from './airGesture';
import type {AirTemplate,Point2} from './airGesture';
const storageKey='runes.air-gestures.v1';
function loadTemplates():AirTemplate[]{
 try{const data=JSON.parse(localStorage.getItem(storageKey)||'[]');return Array.isArray(data)?data.filter(t=>typeof t?.id==='string'&&typeof t?.name==='string'&&Array.isArray(t.points)&&t.points.length<=4096&&t.points.every((p:unknown)=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))&&normalizePath(t.points).length):[];}catch{return [];}
}
const displayPath=(points:Point2[])=>normalizePath(points).map(([x,y])=>[200+x*220,140+y*220] as Point2);
type Ranked=ReturnType<typeof rankAirGestures>;
type Capture={reference:number[];templates:AirTemplate[];points:Point2[];deadline:number};
export function AirGestureEngine({connected,demo}:{connected:boolean;demo:boolean}){
 const [templates,setTemplates]=useState(loadTemplates),[draft,setDraft]=useState<Point2[]>([]),[name,setName]=useState(''),[reference,setReference]=useState<number[]>([]),[fresh,setFresh]=useState(false),[recording,setRecording]=useState(false),[remaining,setRemaining]=useState(2),[trace,setTrace]=useState<Point2[]>([]),[ranks,setRanks]=useState<Ranked>([]),[threshold,setThreshold]=useState(75),[message,setMessage]=useState('Add drawings, center your forearm palm down and forward, then double-tap your index finger.'),[saveError,setSaveError]=useState('');
 const latest=useRef<{q:number[];at:number}|null>(null),capture=useRef<Capture|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),drawing=useRef<number|null>(null),lastTrigger=useRef(-Infinity);
 useEffect(()=>{try{localStorage.setItem(storageKey,JSON.stringify(templates));setSaveError('');}catch{setSaveError('Could not save the gesture library. These changes will last only in this session.');}},[templates]);
 function cancel(){capture.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;setRecording(false);}
 function finish(){
  const c=capture.current;if(!c)return;cancel();setTrace(c.points);
  const x=c.points.map(p=>p[0]),y=c.points.map(p=>p[1]);
  if(c.points.length<10||Math.max(Math.max(...x)-Math.min(...x),Math.max(...y)-Math.min(...y))<1/30||pathLength(c.points)<2/30){setRanks([]);setMessage('No gesture recognized. Too little motion in the two-second recording.');return;}
  setRanks(rankAirGestures(c.templates,c.points));setMessage('Compared the two-second recording with every saved gesture. Double index tap to try again.');
 }
 useEffect(()=>window.band?.onMessage(m=>{
  if(m.kind!=='events'||!connected||demo)return;
  for(const packet of m.events){
   const now=performance.now();
   if(capture.current&&now>=capture.current.deadline)finish();
   if(packet.type==='Orientation'&&Array.isArray(packet.values)&&normalizeQuaternion(packet.values)){
    latest.current={q:[...packet.values],at:now};const c=capture.current;
    if(c&&c.points.length<4096){const point=wristPoint(packet.values,c.reference);if(point)c.points.push(point);}
   }
   if(packet.type==='Gesture'&&packet.finger==='index'&&(packet.action==='doubletap'||packet.derived_action==='doubleTap')){
    if(capture.current||now-lastTrigger.current<600)continue;lastTrigger.current=now;
    if(!templates.length){setMessage('Add at least one gesture drawing before recording.');continue;}
    if(reference.length!==4||!latest.current||now-latest.current.at>=1000){setMessage('Wait for orientation, then center your forearm before recording.');continue;}
    capture.current={reference:[...reference],templates:[...templates],points:[],deadline:now+2000};setTrace([]);setRanks([]);setRemaining(2);setRecording(true);setMessage('Recording for two seconds. Keep your elbow still and draw the gesture now.');timer.current=setTimeout(finish,2000);
   }
  }
 }),[connected,demo,templates,reference]);
 useEffect(()=>{const interval=setInterval(()=>{const now=performance.now(),valid=Boolean(connected&&!demo&&latest.current&&now-latest.current.at<1000);setFresh(valid);const c=capture.current;if(c){setTrace([...c.points]);setRemaining(Math.max(0,(c.deadline-now)/1000));if(!valid){cancel();setTrace([]);setRanks([]);setReference([]);setMessage('No gesture recognized. Orientation stream interrupted; center again.');}}},100);return()=>clearInterval(interval);},[connected,demo]);
 useEffect(()=>{cancel();latest.current=null;lastTrigger.current=-Infinity;setFresh(false);setReference([]);setTrace([]);setRanks([]);return()=>{capture.current=null;if(timer.current)clearTimeout(timer.current);};},[connected,demo]);
 function pointer(e:PointerEvent<SVGSVGElement>):Point2{const r=e.currentTarget.getBoundingClientRect();return [Math.max(0,Math.min(400,(e.clientX-r.left)*400/r.width)),Math.max(0,Math.min(280,(e.clientY-r.top)*280/r.height))];}
 function add(){if(!name.trim()||!normalizePath(draft).length)return;setTemplates(t=>[...t,{id:crypto.randomUUID(),name:name.trim(),points:draft}]);setName('');setDraft([]);setRanks([]);}
 const best=ranks[0],recognized=best&&best.score>=threshold;
 return <section className="model-tests air-test" aria-label="Air gesture engine">
  <div className="model-intro"><h2>Air gesture engine</h2><p>Save several drawings. Double-tap your index finger to record two seconds of motion and find the closest gesture.</p></div>
  <div className="air-workspace">
   <section><div className="air-heading"><h3>Add a gesture</h3><button className="button" disabled={recording||!draft.length} onClick={()=>setDraft([])}>Clear drawing</button></div>
    <svg className="air-pad" viewBox="0 0 400 280" role="img" aria-label="Draw engine gesture" onPointerDown={e=>{if(recording||drawing.current!==null)return;drawing.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);setDraft([pointer(e)]);}} onPointerMove={e=>{if(drawing.current===e.pointerId){const p=pointer(e);setDraft(current=>current.length<4096?[...current,p]:current);}}} onPointerUp={e=>{if(drawing.current===e.pointerId){drawing.current=null;e.currentTarget.releasePointerCapture(e.pointerId);}}} onPointerCancel={()=>{drawing.current=null;setDraft([]);}}><path d={pathData(draft)} className="air-target"/>{!draft.length&&<text x="200" y="140" textAnchor="middle">Draw one continuous stroke</text>}{draft[0]&&<circle cx={draft[0][0]} cy={draft[0][1]} r="5" fill="#777"/>}</svg>
    <label className="model-field"><span>Gesture name</span><input aria-label="Gesture name" value={name} maxLength={60} disabled={recording} placeholder="e.g. Circle" onChange={e=>setName(e.target.value)}/></label><div className="model-actions"><button className="button" disabled={recording||!name.trim()||!normalizePath(draft).length} onClick={add}>Add gesture</button></div>
    <h3 className="air-setup-title">Saved gestures · {templates.length}</h3><p>Drawings are saved on this Mac. Each recording is compared against all of them.</p>{saveError&&<p role="alert">{saveError}</p>}
    <ul className="air-library">{templates.map(t=><li key={t.id}><svg viewBox="0 0 400 280" aria-label={`${t.name} drawing`} role="img"><path d={pathData(displayPath(t.points))}/></svg><span>{t.name}</span><button className="button" aria-label={`Remove ${t.name}`} disabled={recording} onClick={()=>{setTemplates(all=>all.filter(g=>g.id!==t.id));setRanks([]);}}>Remove</button></li>)}</ul>{!templates.length&&<p>Add your first drawing to enable recognition.</p>}
   </section>
   <section><h3>Recognition test</h3><p>Rest your elbow in one place. Hold your hand palm down and forward, then center. Double index tap starts each two-second recording; taps during recording are ignored.</p><div className="model-actions"><button className="button" disabled={!fresh||recording} onClick={()=>{if(!latest.current)return;setReference([...latest.current.q]);setTrace([]);setRanks([]);setMessage('Centered. Double-tap your index finger, then draw a gesture in the air for two seconds.');}}>Center forearm</button></div>
    <p>{demo?'Connect a real band; demo signals cannot trigger recognition.':!connected?'Connect your band to begin.':!fresh?'Waiting for fresh orientation…':reference.length?'Centered · listening for double index tap':'Orientation streaming · center your forearm'}</p>
    <svg className="air-pad air-result" viewBox="0 0 400 280" role="img" aria-label="Engine recognition overlay">{best?<><path className="air-target" d={pathData(displayPath(best.points))}/><path className="air-actual" d={pathData(displayPath(rotatePath(trace,best.rotation)))}/></>:<path className="air-actual" d={pathData(trace.map(([x,y])=>[200+x*120,140+y*120]))}/>}</svg>
    <div className="air-verdict" role="status" aria-live="polite">{recording?<strong>Recording · {remaining.toFixed(1)} s remaining</strong>:best?<strong>{recognized?`Recognized: ${best.name}`:'No gesture recognized'} · {best.score}% similarity</strong>:null}<span>{message}</span>{best&&<span>Closest: {best.name} · rotation {best.rotation}° · allowed −100° to +100°</span>}</div>
    <label className="model-field"><span>Minimum similarity: {threshold}%</span><input aria-label="Minimum similarity" type="range" min="0" max="100" value={threshold} onChange={e=>setThreshold(Number(e.target.value))}/></label>
    {ranks.length>0&&<><h3 className="air-setup-title">All matches</h3><ol className="air-ranking">{ranks.map(r=><li key={r.id}><span>{r.name}</span><span>{r.score}% · {r.rotation}°</span></li>)}</ol><p>Gray: closest saved drawing. Green: recorded motion at its best allowed rotation. Scores are experimental similarity estimates.</p></>}
   </section>
  </div>
 </section>;
}
