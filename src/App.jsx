import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Scene from './Scene';
import Terrain from './Terrain';
import Telemetry from './Telemetry';
import { SaveMission, MissionReport } from './Reports';
import { pads, slopeLimit, soilDecision } from './mission';
import './style.css';

const initial = { target:'A', recommendation:null, message:'Pad A starts as the favorite. Drive into its ring to sample the soil.' };

function App() {
  const [tab,setTab] = useState('mission');
  const [mission,setMission] = useState(initial);
  const [outcome,setOutcome] = useState('pass');
  const [arrived,setArrived] = useState(false);
  const [run,setRun] = useState(0);
  const joystick = useRef({x:0,y:0,received:-Infinity});
  function reset() { setMission(initial); setArrived(false); setRun(n=>n+1); }

  return <>
    <header className="top"><div className="brand"><span className="brand-icon" aria-hidden="true">⬡</span> BaseScout</div>
    <nav aria-label="Main views">
      <button type="button" aria-pressed={tab==='mission'} onClick={()=>setTab('mission')}>Rover mission</button>
      <button type="button" aria-pressed={tab==='terrain'} onClick={()=>setTab('terrain')}>Terrain comparison</button>
    </nav></header>
    <main>
      <div hidden={tab!=='mission'}>
        <div className="intro"><p className="eyebrow">ROVER MISSION</p><h1>Scout a crew base</h1><p>Drive to the active pad. Check its slope and test the simulated soil.</p></div>
        <div className="mission-grid">
          <section className="panel field"><div className="panel-head"><h2>Scouting field</h2><span className="muted">Simulated terrain</span></div>
            <Scene key={run} target={mission.target} recommendation={mission.recommendation} paused={tab!=='mission'} onArrival={setArrived} joystick={joystick}/>
            <div className="controls"><span><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or arrow keys</span><span>Pi joystick supported</span></div>
          </section>
          <section className="panel plan">
            <div className="panel-head"><h2>Site decision</h2><button onClick={e=>{reset();e.currentTarget.blur();}}>Reset</button></div>
            <div className="pad-cards">{Object.entries(pads).map(([id,pad])=><div key={id} className={mission.target===id ? 'active-pad' : ''}><strong>Pad {id}</strong><span>{pad.slope}° slope</span></div>)}</div>
            <p className="muted">Demo slope limit ≤ {slopeLimit}°</p>
            <p className="decision" role="status">{mission.message}</p>
            <label htmlFor="soil">Simulated Pad A soil</label>
            <select id="soil" value={outcome} onChange={e=>setOutcome(e.target.value)} disabled={mission.target!=='A'||!!mission.recommendation}>
              <option value="pass">Pass</option><option value="fail">Fail</option>
            </select>
            <button className="primary" disabled={!arrived||!!mission.recommendation} onClick={e=>{setArrived(false);setMission(soilDecision(mission.target,outcome));e.currentTarget.blur();}}>Test Pad {mission.target} soil</button>
            <small className="muted">{mission.target==='B' ? 'Pad B simulates a passing soil sample.' : 'Reset to try the other outcome.'}</small>
            {mission.recommendation && <SaveMission key={run} padASoil={outcome}/>}
          </section>
        </div>
      </div>
      {tab==='terrain' && <Terrain/>}
      <Telemetry joystick={joystick}/>
    </main>
  </>;
}

const reportId = new URLSearchParams(window.location.search).get("mission");
createRoot(document.getElementById("root")).render(reportId ? <MissionReport id={reportId}/> : <App/>);
