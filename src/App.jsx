import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Scene, { parseTune } from './Scene';
import ModelTuner, { ModelStatus } from './ModelTuner';
import Terrain from './Terrain';
import Telemetry from './Telemetry';
import { SaveMission, MissionReport } from './Reports';
import { padsFor, slopeLimit, testPad, newMission, padIds, defaultSite, siteIds, siteName, baseTargets, defaultTarget } from './mission';

const coord = (lat, lon) => `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;
const shortName = id => siteName(id).split(',')[0].replace(' Crater', '').replace(' lava field', '');
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './style.css';

const SAMPLE_MS = 2600;

const envModel = import.meta.env.VITE_ROVER_MODEL_URL;
const initialModel = envModel ? { url: envModel, label: envModel.split('/').pop() } : null;

// Steps for a mission where either pad can be tested first.
function missionSteps(mission, atPad) {
  const [first, second] = mission.tests;
  const other = first ? padIds.find(id => id !== first.pad) : null;
  const needSecond = first && !mission.recommendation;
  const steps = [
    { n:1, label: first ? `Drive to Pad ${first.pad}` : 'Drive to a pad', state: first || atPad ? 'done' : 'current' },
    { n:2, label: first ? `Test Pad ${first.pad} soil` : 'Test its soil', state: first ? 'done' : atPad ? 'current' : 'todo' },
    { n:3, label: other ? `Drive to Pad ${other}` : 'Drive to the other pad', branch: true,
      state: !first ? 'branch' : !needSecond ? 'skipped' : second || atPad ? 'done' : 'current' },
    { n:4, label: other ? `Test Pad ${other} soil` : 'Test its soil', branch: true,
      state: !first ? 'branch' : !needSecond ? 'skipped' : second ? 'done' : atPad ? 'current' : 'todo' },
    { n:5, label: mission.done ? (mission.recommendation ? `Recommend Pad ${mission.recommendation}` : 'No pad qualifies') : 'Recommendation',
      state: mission.done ? 'done' : 'todo' },
  ];
  return steps;
}

function StepTracker({ mission, atPad }) {
  return <ol className="steps" aria-label="Mission progress">
    {missionSteps(mission, atPad).map(step => <li key={step.n} className={step.state} aria-current={step.state === 'current' ? 'step' : undefined}>
      <span className="dot">{step.state === 'done' ? '✓' : step.n}</span>
      <span>{step.label}{step.state === 'branch' && <small> if the first fails</small>}{step.state === 'skipped' && <small> not needed</small>}</span>
    </li>)}
  </ol>;
}

function Verdict({ mission, pads }) {
  return <div className={`verdict${mission.recommendation ? '' : ' none'}`} role="status">
    <span className="eyebrow">MISSION RESULT</span>
    <strong>{mission.recommendation ? `Recommend Pad ${mission.recommendation}` : 'Neither pad qualifies'}</strong>
    <ul>{mission.tests.map(t => {
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
  // /app?view=mission opens the rover mission directly (used by the landing page).
  const [tab,setTab] = useState(() => new URLSearchParams(window.location.search).get('view') === 'mission' ? 'mission' : 'terrain');
  const [mission,setMission] = useState(newMission);
  const [site,setSite] = useState(defaultSite);
  const [targetId,setTargetId] = useState(defaultTarget);
  const target = baseTargets[targetId];
  const pads = padsFor(site);
  const [soilA,setSoilA] = useState('pass');
  const [soilB,setSoilB] = useState('pass');
  const telemetry = useRef(null);
  const onPacket = useCallback(p => { telemetry.current = p; }, []);
  const [atPad,setAtPad] = useState(null);
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
  function reset() { clearTimeout(sampleTimer.current); setSampling(false); setMission(newMission()); setAtPad(null); setRun(n=>n+1); }
  function runTest() {
    const pad = atPad; if (!pad) return; const soil = pad === 'A' ? soilA : soilB;
    setSampling(true);
    sampleTimer.current = setTimeout(() => { setSampling(false); setAtPad(null); setMission(m => testPad(pads, m, pad, soil)); }, SAMPLE_MS);
  }
  useEffect(() => () => clearTimeout(sampleTimer.current), []);
  function changeSite(id) { if (id === site) return; setSite(id); reset(); }
  const goMission = (id, tgt) => { if (tgt) setTargetId(tgt); if (id) changeSite(id); setTab('mission'); window.scrollTo({ top:0, behavior:'smooth' }); };
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
          <p>The rover rehearses a permanent-base survey for <b>{target.name}</b> ({target.planet}) at <b>{siteName(site)}</b>, a real analog site on Earth. Drive to the active pad, check its slope, and test the soil. Pad slopes are measured from this site's real elevation data; the 3D field and soil results are simulated.</p></div>
        <div className="site-picker" role="tablist" aria-label="Test site">
          <span>Test site</span>
          {siteIds.map(id => <button key={id} type="button" role="tab" aria-selected={id === site} disabled={sampling} onClick={() => changeSite(id)}>{shortName(id)}</button>)}
        </div>
        <StepTracker mission={mission} atPad={atPad}/>
        <div className="mission-grid">
          <section className="panel field"><div className="panel-head"><h2>Scouting field</h2><span className="muted">Simulated terrain</span></div>
            <Scene key={`${site}-${run}`} site={site} testable={mission.done ? [] : padIds.filter(id => !mission.tests.some(t => t.pad === id))} failed={mission.tests.filter(t => t.pad !== mission.recommendation).map(t => t.pad)} done={mission.done} recommendation={mission.recommendation} paused={tab!=='mission'} onArrival={setAtPad} joystick={joystick} locked={sampling}
              modelUrl={model} tune={tune} showBounds={showBounds} onModelStatus={onModelStatus}/>
            <div className="controls"><span><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or arrow keys · Pi joystick</span>
              <button type="button" className="link-button" onClick={()=>setTuning(t=>!t)}>{tuning ? 'Hide rover model' : 'Rover model…'}</button></div>
            {!tuning && modelStatus && modelStatus.state !== 'none' && modelStatus.state !== 'ready' && <ModelStatus status={modelStatus}/>}
          </section>
          <section className="panel plan">
            <div className="panel-head"><h2>Site decision</h2><button onClick={e=>{reset();e.currentTarget.blur();}}>Reset</button></div>
            <div className="pad-cards">{Object.entries(pads).map(([id,pad])=><div key={id} className={mission.recommendation===id ? 'chosen-pad' : mission.tests.some(t => t.pad === id) ? 'failed-pad' : atPad===id ? 'active-pad' : ''}><strong>Pad {id}</strong><span>{pad.slope}° slope · measured</span><small>{coord(pad.lat, pad.lon)} · {pad.elevationM.toLocaleString()} m</small></div>)}</div>
            <p className="muted">Slope limit ≤ {slopeLimit}° · slopes from the {shortName(site)} 500 m elevation grid</p>
            {mission.done ? <Verdict mission={mission} pads={pads}/> : <p className="decision" role="status">{sampling ? `Sampling soil at Pad ${atPad}…` : mission.message}</p>}
            <button className={`primary${sampling ? ' sampling' : ''}`} style={{'--sample-ms':`${SAMPLE_MS}ms`}} disabled={!atPad||mission.done||sampling} onClick={e=>{runTest();e.currentTarget.blur();}}>{sampling ? `Sampling Pad ${atPad} soil…` : atPad ? `Test Pad ${atPad} soil` : 'Test soil'}</button>
            {!mission.done && <small className="muted">{sampling ? 'Sampling in progress. Rover holding position.' : atPad ? `Rover is in the Pad ${atPad} ring. Run the test.` : 'Drive into a pad ring you have not tested yet to enable the test.'}</small>}
            {mission.done && <SaveMission key={`${site}-${run}`} siteId={site} targetId={targetId} order={mission.tests.map(t => t.pad)} padASoil={soilA} padBSoil={soilB} getTelemetry={() => telemetry.current}/>}
            <div className="scenario">
              <span className="scenario-title">Demo scenario · simulated soil results</span>
              <div className="scenario-row">
                <label htmlFor="soilA">Pad A soil</label>
                <select id="soilA" value={soilA} onChange={e=>setSoilA(e.target.value)} disabled={mission.done||sampling||mission.tests.some(t => t.pad === 'A')}>
                  <option value="pass">Pass</option><option value="fail">Fail</option>
                </select>
                <label htmlFor="soilB">Pad B soil</label>
                <select id="soilB" value={soilB} onChange={e=>setSoilB(e.target.value)} disabled={mission.done||sampling||mission.tests.some(t => t.pad === 'B')}>
                  <option value="pass">Pass</option><option value="fail">Fail</option>
                </select>
              </div>
              <small className="muted">Reset to try another outcome. If both fail, neither pad qualifies.</small>
            </div>
          </section>
        </div>
        {tuning && <ModelTuner tune={tune} setTune={setTune} showBounds={showBounds} setShowBounds={setShowBounds}
          status={modelStatus} onFile={loadFile} onClose={()=>setTuning(false)}/>}
      </div>
      {tab==='terrain' && <Terrain onContinue={goMission} targetId={targetId} onTarget={setTargetId}/>}
      <Telemetry joystick={joystick} onStatus={setPiStatus} onPacket={onPacket}/>
      <Credits/>
    </main>
  </>;
}

const reportId = new URLSearchParams(window.location.search).get("mission");
createRoot(document.getElementById("root")).render(reportId ? <MissionReport id={reportId}/> : <App/>);
