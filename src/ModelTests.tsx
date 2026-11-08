import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowUpRight,ChevronRight,Download,Play,Square} from 'lucide-react';
import type {Message} from './types';
import './model-tests.css';
import {NativeHandwriting} from './NativeHandwriting';
import {PoseHand} from './PoseHand';

type ModelId='handwriting'|'pose';
type Result={text?:string;angles?:number[][];landmarks?:number[][][];frames:number;seconds:number;playback_seconds?:number;offset_seconds?:number;mapping:string;calibration:string;experimental:boolean};
type Status={installed:boolean;phase:string;message:string;samples?:number;result?:Result};
const initial=():Record<ModelId,Status>=>({handwriting:{installed:false,phase:'idle',message:'Not installed'},pose:{installed:false,phase:'idle',message:'Not installed'}});
const models={handwriting:{name:'Handwriting',description:'Trace letters on a surface and inspect decoded text.',repo:'generic-neuromotor-interface',license:'CC BY-NC 4.0',download:'13 MiB weights'},pose:{name:'Hand pose',description:'Move your fingers and inspect 20 predicted joint angles.',repo:'emg2pose',license:'CC BY-NC-SA 4.0',download:'240 MiB checkpoint archive'}};
const jointLabels=['CMC flexion','CMC spread','MCP flexion','IP flexion','MCP spread','MCP flexion','PIP flexion','DIP flexion'];
function errorRate(expected:string,actual:string){let previous=Array.from({length:actual.length+1},(_,i)=>i);for(let i=1;i<=expected.length;i++){const row=[i];for(let j=1;j<=actual.length;j++)row[j]=Math.min(row[j-1]+1,previous[j]+1,previous[j-1]+(expected[i-1]===actual[j-1]?0:1));previous=row;}return Math.round(previous[actual.length]/expected.length*100);}
function exportResult(model:ModelId,result:Result,reference:string){const url=URL.createObjectURL(new Blob([JSON.stringify({model,reference,...result},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`runes-${model}-experiment.json`;a.click();URL.revokeObjectURL(url);}

export function ModelTests({connected,demo}:{connected:boolean;demo:boolean}){
 const [selected,setSelected]=useState<ModelId|null>(null),[statuses,setStatuses]=useState(initial),[mapping,setMapping]=useState('interpolate'),[reference,setReference]=useState(''),[error,setError]=useState(''),[frame,setFrame]=useState(0),[playing,setPlaying]=useState(false);
 const [research,setResearch]=useState(false);
 const desktop=Boolean(window.band);
 useEffect(()=>{
  const off=window.band?.onMessage((message:Message)=>{
   if(!['handwriting','pose'].includes(message.model))return;
   const model=message.model as ModelId;
   if(message.kind==='model_status')setStatuses(current=>({...current,[model]:{...current[model],...message}}));
   if(message.kind==='model_result'){setStatuses(current=>({...current,[model]:{...current[model],result:message.result}}));setFrame(0);}
   if(message.kind==='model_error')setError(message.message);
  });
  window.band?.send({action:'model_status'});
  return()=>{off?.();window.band?.send({action:'model_leave'});};
 },[]);
 const status=selected?statuses[selected]:null,result=status?.result;
 const busy=Object.values(statuses).some(s=>['installing','capturing','running'].includes(s.phase));
 useEffect(()=>{if(!playing||!result?.angles)return;const timer=setInterval(()=>setFrame(value=>(value+1)%result.angles!.length),(result.playback_seconds??result.seconds)*1000/result.angles.length);return()=>clearInterval(timer);},[playing,result]);
 function command(action:string){if(!selected)return;setError('');if(action==='model_capture_start'){setPlaying(false);setStatuses(current=>({...current,[selected]:{...current[selected],result:undefined}}));}window.band?.send({action,model:selected,mapping});}
 function choose(model:ModelId){setResearch(false);if(model==='handwriting')setMapping('interpolate');setSelected(model);setFrame(0);setPlaying(false);setError('');}
 return <section className="model-tests" aria-label="Model experiments">
  {!selected?<>
   <div className="model-intro"><h2>Model experiments</h2><p>Try live handwriting from your band, or install a research checkpoint for hand pose.</p></div>
   <div className="model-list">{(Object.keys(models) as ModelId[]).map(id=><button className="model-entry" key={id} onClick={()=>choose(id)}><span><strong>{models[id].name}</strong><span>{models[id].description}</span></span><span className="model-entry-status">{id==='handwriting'?'On-band model':statuses[id].phase==='installing'?'Installing…':statuses[id].installed?'Installed':'Not installed'}<ChevronRight size={17}/></span></button>)}</div>
   <div className="model-compatibility"><h3>Research checkpoints: eight channels, experimental results</h3><p>The published models expect 16 channels on one wrist. These tests expand your eight channels using duplication or interpolation. They do not recover missing measurements, and the weights have not been trained for your band.</p><p>Installations download Python dependencies, Meta source and weights. Inference runs locally on CPU. No recordings are uploaded.</p></div>
  </>:<>
   <button className="test-back" onClick={()=>{setSelected(null);setPlaying(false);}}><ArrowLeft size={14}/> All model experiments</button>
   <div className="model-title"><div><h2>{models[selected].name}</h2><p>{models[selected].description}</p></div><span>{selected==='handwriting'&&!research?'On-band mode':status?.installed?'Installed on this Mac':'Optional download'}</span></div>
   {selected==='handwriting'&&!research?<NativeHandwriting connected={connected} demo={demo} onResearch={()=>setResearch(true)}/>:<div className="model-workspace">
    <section className="model-controls" aria-label="Experiment setup">
     <h3>Model installation</h3><p>{models[selected].download}, plus a shared Python runtime and dependencies. Allow around 2 GB free for both tests.</p>
     <p className="model-license">{models[selected].license} · Noncommercial research</p>
     <div className="model-actions"><button className="button" disabled={!desktop||busy} onClick={()=>command('model_install')}><Download size={14}/>{status?.installed?'Reinstall model':'Install model'}</button>{status?.phase==='installing'&&<button className="button" onClick={()=>command('model_cancel')}>Cancel installation</button>}</div>
     {!desktop&&<p className="model-hint">Open the desktop app to install and run models.</p>}
     <h3>Channel mapping</h3><label className="model-field"><span>Expand eight inputs to sixteen</span><select aria-label="Channel mapping" value={mapping} disabled={busy} onChange={e=>setMapping(e.target.value)}><option value="interpolate">Interleave neighboring averages</option>{selected!=='handwriting'&&<option value="repeat">Repeat each channel twice</option>}</select></label>
     <p>The model expects signed floating-point EMG from 16 ordered differential channels on one wrist. Our eight channel locations and polarities have not been matched to that layout.</p>
     {selected==='handwriting'&&<p>Repeating channels is disabled: identical channels make this model’s matrix-log features singular. Interpolation is still an unvalidated baseline.</p>}
     <p>Resampled to 2,000 Hz and high-pass filtered at 40 Hz. ADC scaling uses an unverified 0.2008 µV/count estimate.</p>
     <h3>Record and test</h3><p>{selected==='handwriting'?'Rest briefly, then write a short word. Try holding your fingers together as if holding an imaginary pen, matching the research protocol.':'Rest briefly, then slowly open and close your hand or bend one finger at a time.'} Record between 3 and 12 seconds.</p>
     {selected==='handwriting'&&<label className="model-field"><span>Reference text (optional)</span><input aria-label="Reference text" placeholder="What you plan to write" value={reference} maxLength={200} onChange={e=>setReference(e.target.value)}/></label>}
     <div className="model-actions"><button className="button" disabled={!desktop||!connected||demo||busy} onClick={()=>command('model_capture_start')}><span className="record-dot"/> Record EMG</button>{status?.phase==='capturing'&&<button className="button" onClick={()=>command('model_capture_stop')}><Square size={13}/> Finish recording</button>}<button className="button primary" disabled={!status?.installed||busy||!status?.samples||status.phase==='error'||demo} onClick={()=>command('model_run')}><Play size={13}/> Run model</button></div>
     {(!connected||demo)&&<p className="model-hint">Connect a real band to record. Demo signals cannot be used for inference.</p>}
     <p className="model-hint">Leaving model tests discards the raw recording. Keyboard and mouse shortcuts stay paused while this page is open.</p>
    </section>
    <section className="model-output" aria-label="Model output">
     <div className="model-output-heading"><h3>{selected==='handwriting'?'Decoded text':'Predicted joint angles'}</h3>{result&&<button className="button" onClick={()=>exportResult(selected,result,reference)}><Download size={13}/> Export result</button>}</div>
     <div className="model-status" role="status" aria-live="polite"><span className={['installing','running','capturing'].includes(status!.phase)?'model-working':''}/><span>{status?.message}{status?.phase==='capturing'&&status.samples?` · ${(status.samples/2048).toFixed(1)} s`:''}</span></div>
     {error&&<p className="model-error" role="alert">{error}</p>}
     {status?.phase==='error'&&<p className="model-hint">You can retry installation or record a new sample. Downloads require internet access.</p>}
     {!result?<div className="model-empty"><span>{selected==='handwriting'?'Your words will appear here.':'Your finger movements will appear here.'}</span><p>Install the model, record your band, then run the experiment.</p></div>:selected==='handwriting'?<><div className="model-text" aria-label="Decoded handwriting">{result.text||<span>No characters decoded.</span>}</div>{reference&&<p className="model-score">Character error rate: {errorRate(reference,result.text??'')}% <span>Compared with your reference, including case and spaces.</span></p>}</>:<>
      {result.landmarks?.length?<PoseHand landmarks={result.landmarks} frame={frame}/>:<p className="model-hint">Run the model again to generate the animated hand geometry.</p>}
      <div className="pose-playback"><button className="button" aria-label={playing?'Pause pose playback':'Play pose playback'} onClick={()=>setPlaying(!playing)}>{playing?<Square size={13}/>:<Play size={13}/>}</button><input type="range" aria-label="Pose frame" min={0} max={Math.max(0,(result.angles?.length??1)-1)} value={Math.min(frame,(result.angles?.length??1)-1)} onChange={e=>{setPlaying(false);setFrame(Number(e.target.value));}}/><span>Frame {frame+1} / {result.angles?.length}</span></div>
      <div className="pose-fingers">{['Thumb','Index','Middle','Ring','Pinky'].map((finger,f)=><div key={finger}><h4>{finger}</h4>{(result.angles?.[frame]??[]).slice(f*4,f*4+4).map((angle,j)=><div className="pose-joint" key={j}><span>{jointLabels[(f===0?0:4)+j]}</span><strong>{(angle*180/Math.PI).toFixed(1)}°</strong><svg viewBox="0 0 100 8" aria-hidden="true"><path d="M0 4H100" stroke="#e8e8e8"/><path d={`M50 4H${50+Math.max(-50,Math.min(50,angle/Math.PI*50))}`} stroke="#292929" strokeWidth="4"/></svg></div>)}</div>)}</div>
     </>}
     {result&&<p className="model-result-note">{result.seconds.toFixed(1)} s recording · {result.mapping==='repeat'?'Repeated channels':'Interpolated channels'} · Experimental output; no accuracy guarantee.</p>}
     <details className="model-details"><summary>What this test measures</summary><p>{selected==='handwriting'?'The model predicts a character sequence directly from muscle signals. It does not trace your fingertip path.':'This uses regression_vemg2pose to predict 20 articulation angles without a measured initial pose. It does not locate your hand in a room.'}</p><p>This is a baseline with published 16-channel weights. A trained eight-channel version requires adapting the sensor-facing layers and validating with labeled recordings from this band.</p><p>Raw recordings stay on this Mac temporarily. Only exported results are retained when you leave.</p><a href={`https://github.com/facebookresearch/${models[selected].repo}`} target="_blank" rel="noreferrer">Meta research source <ArrowUpRight size={12}/></a></details>
    </section>
   </div>}
  </>}
 </section>;
}
