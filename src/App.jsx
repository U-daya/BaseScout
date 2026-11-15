import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Scene, { parseTune } from './Scene';
import ModelTuner, { ModelStatus } from './ModelTuner';
import Terrain from './Terrain';
import Telemetry from './Telemetry';
import { SaveMission, MissionReport } from './Reports';
import { pads, slopeLimit, soilDecision } from './mission';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './style.css';

const SAMPLE_MS = 2600;

const initial = { target:'A', recommendation:null, message:'Pad A starts as the favorite. Drive into its ring to sample the soil.' };
const envModel = import.meta.env.VITE_ROVER_MODEL_URL;
const initialModel = envModel ? { url: envModel, label: envModel.split('/').pop() } : null;

function missionSteps(mission, arrived) {
  const aFailed = mission.target === 'B';
  const done = !!mission.recommendation;
  const current = done ? 5 : aFailed ? (arrived ? 4 : 3) : (arrived ? 2 : 1);
  const steps = [
    { n:1, label:'Drive to Pad A' },
    { n:2, label:'Test Pad A soil' },
    { n:3, label:'Reroute to Pad B', branch:true },
    { n:4, label:'Test Pad B soil', branch:true },
    { n:5, label: done ? `Recommend Pad ${mission.recommendation}` : 'Recommendation' },
  ];
  return steps.map(step => {
    let state = step.n < current ? 'done' : step.n === current ? (done ? 'done' : 'current') : 'todo';
    if (step.branch && done && !aFailed) state = 'skipped';
    if (step.branch && !aFailed && !done) state = 'branch';
    return { ...step, state };
  });
}

function StepTracker({ mission, arrived }) {
  return <ol className="steps" aria-label="Mission progress">
    {missionSteps(mission, arrived).map(step => <li key={step.n} className={step.state} aria-current={step.state === 'current' ? 'step' : undefined}>
      <span className="dot">{step.state === 'done' ? '✓' : step.n}</span>
      <span>{step.label}{step.state === 'branch' && <small> if A fails</small>}{step.state === 'skipped' && <small> not needed</small>}</span>
    </li>)}
  </ol>;
}

function Verdict({ mission, outcome }) {
  const tests = [{ pad:'A', soil: outcome }];
  if (mission.target === 'B') tests.push({ pad:'B', soil:'pass' });
  return <div className="verdict" role="status">
    <span className="eyebrow">MISSION RESULT</span>
    <strong>Recommend Pad {mission.recommendation}</strong>
    <ul>{tests.map(t => {
      const slopeOk = pads[t.pad].slope <= slopeLimit;
      return <li key={t.pad}><b>Pad {t.pad}</b>
        <span className={slopeOk ? 'ok' : 'bad'}>{slopeOk ? '✓' : '✗'} slope {pads[t.pad].slope}° ≤ {slopeLimit}°</span>
        <span className={t.soil === 'pass' ? 'ok' : 'bad'}>{t.soil === 'pass' ? '✓' : '✗'} soil {t.soil}</span>
      </li>;
    })}</ul>
  </div>;
}

function Credits() {
  return <footer className="credits">
    <p>Built at <b>NASA Space Apps Challenge · New York City 2026</b> by the BaseScout team.</p>
    <ul>
      <li><span>Hosting &amp; edge</span>Cloudflare Workers</li>
      <li><span>Mission API</span>Vultr</li>
      <li><span>Mission storage</span>TigerData (PostgreSQL)</li>
      <li><span>Mission debriefs</span>Google Gemini</li>
      <li><span>SMS alerts</span>Twilio</li>
      <li><span>Terrain data</span>NASA MGS MOLA · NASA SRTM via Mapzen</li>
    </ul>
  </footer>;
}

function App() {
  const [tab,setTab] = useState('terrain');
  const [mission,setMission] = useState(initial);
  const [outcome,setOutcome] = useState('pass');
  const [arrived,setArrived] = useState(false);
  const [run,setRun] = useState(0);
  const [piStatus,setPiStatus] = useState('off');
  const [model,setModel] = useState(initialModel);
  const [modelStatus,setModelStatus] = useState(null);
  const [tune,setTune] = useState(() => parseTune(import.meta.env.VITE_ROVER_MODEL_TUNE));
  const [showBounds,setShowBounds] = useState(false);
  const [tuning,setTuning] = useState(false);
  const joystick = useRef({x:0,y:0,received:-Infinity});
  const objectUrl = useRef(null);
  const [sampling,setSampling] = useState(false);
  const sampleTimer = useRef(null);
  function reset() { clearTimeout(sampleTimer.current); setSampling(false); setMission(initial); setArrived(false); setRun(n=>n+1); }
  function runTest() {
    const pad = mission.target, soil = outcome;
    setSampling(true);
    sampleTimer.current = setTimeout(() => { setSampling(false); setArrived(false); setMission(soilDecision(pad, soil)); }, SAMPLE_MS);
  }
  useEffect(() => () => clearTimeout(sampleTimer.current), []);
  const goMission = () => { setTab('mission'); window.scrollTo({ top:0, behavior:'smooth' }); };
  const onModelStatus = useCallback(s => setModelStatus(s), []);
  function loadFile(file) {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setModel({ url: objectUrl.current, label: file.name });
  }
  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);

  const chip = { live:'Pi connected', connecting:'Pi connecting…', off:'Pi disconnected' }[piStatus];
  return <>
    <header className="top"><div className="brand"><svg className="brand-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><circle cx="10" cy="10" r="2.2" className="core"/><path d="M10 0v4M10 16v4M0 10h4M16 10h4"/></svg>BaseScout<span className="brand-tag">Space Apps NYC 2026</span></div>
    <nav aria-label="Main views">
      <button type="button" aria-pressed={tab==='terrain'} onClick={()=>setTab('terrain')}><span className="step-num">1</span> Find an analog</button>
      <button type="button" aria-pressed={tab==='mission'} onClick={()=>setTab('mission')}><span className="step-num">2</span> Scout a base</button>
    </nav>
    <button type="button" className={`pi-chip ${piStatus}`} onClick={()=>document.getElementById('telemetry')?.scrollIntoView({behavior:'smooth'})}>
      <span className="pi-dot" aria-hidden="true"/>{chip}
    </button></header>
    <main>
      <div hidden={tab!=='mission'}>
        <div className="intro"><p className="eyebrow">STEP 2 · ROVER MISSION</p><h1>Scout a crew base</h1>
          <p>Rover test site: <b>Hanksville, Utah</b>, the closest Mars analog from step 1. Drive to the active pad, check its slope, and test the soil. Field, pad slopes, and soil results are simulated.</p></div>
        <StepTracker mission={mission} arrived={arrived}/>
        <div className="mission-grid">
          <section className="panel field"><div className="panel-head"><h2>Scouting field</h2><span className="muted">Simulated terrain</span></div>
            <Scene key={run} target={mission.target} recommendation={mission.recommendation} paused={tab!=='mission'} onArrival={setArrived} joystick={joystick} locked={sampling}
              modelUrl={model} tune={tune} showBounds={showBounds} onModelStatus={onModelStatus}/>
            <div className="controls"><span><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or arrow keys · Pi joystick</span>
              <button type="button" className="link-button" onClick={()=>setTuning(t=>!t)}>{tuning ? 'Hide rover model' : 'Rover model…'}</button></div>
            {!tuning && modelStatus && modelStatus.state !== 'none' && modelStatus.state !== 'ready' && <ModelStatus status={modelStatus}/>}
          </section>
          <section className="panel plan">
            <div className="panel-head"><h2>Site decision</h2><button onClick={e=>{reset();e.currentTarget.blur();}}>Reset</button></div>
            <div className="pad-cards">{Object.entries(pads).map(([id,pad])=><div key={id} className={mission.recommendation===id ? 'chosen-pad' : mission.target===id ? 'active-pad' : ''}><strong>Pad {id}</strong><span>{pad.slope}° slope</span></div>)}</div>
            <p className="muted">Demo slope limit ≤ {slopeLimit}°</p>
            {mission.recommendation ? <Verdict mission={mission} outcome={outcome}/> : <p className="decision" role="status">{sampling ? `Sampling soil at Pad ${mission.target}…` : mission.message}</p>}
            <button className={`primary${sampling ? ' sampling' : ''}`} style={{'--sample-ms':`${SAMPLE_MS}ms`}} disabled={!arrived||!!mission.recommendation||sampling} onClick={e=>{runTest();e.currentTarget.blur();}}>{sampling ? `Sampling Pad ${mission.target} soil…` : `Test Pad ${mission.target} soil`}</button>
            {!mission.recommendation && <small className="muted">{sampling ? 'Sampling in progress. Rover holding position.' : arrived ? 'Rover is in the ring. Run the test.' : `Drive into the Pad ${mission.target} ring to enable the test.`}</small>}
            {mission.recommendation && <SaveMission key={run} padASoil={outcome}/>}
            <div className="scenario">
              <label htmlFor="soil">Demo scenario · Pad A soil</label>
              <select id="soil" value={outcome} onChange={e=>setOutcome(e.target.value)} disabled={mission.target!=='A'||!!mission.recommendation||sampling}>
                <option value="pass">Pass</option><option value="fail">Fail</option>
              </select>
              <small className="muted">{mission.target==='B' ? 'Pad B simulates a passing soil sample.' : 'Reset to try the other outcome.'}</small>
            </div>
          </section>
        </div>
        {tuning && <ModelTuner tune={tune} setTune={setTune} showBounds={showBounds} setShowBounds={setShowBounds}
          status={modelStatus} onFile={loadFile} onClose={()=>setTuning(false)}/>}
      </div>
      {tab==='terrain' && <Terrain onContinue={goMission}/>}
      <Telemetry joystick={joystick} onStatus={setPiStatus}/>
      <Credits/>
    </main>
  </>;
}

const reportId = new URLSearchParams(window.location.search).get("mission");
createRoot(document.getElementById("root")).render(reportId ? <MissionReport id={reportId}/> : <App/>);
