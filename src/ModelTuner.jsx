import React, { useState } from 'react';
import { defaultTune, formatTune } from './Scene';

const sliders = [
  ['scale', 'Size', 0.25, 3, 0.05, '×'],
  ['rotX', 'Tilt (X)', -180, 180, 90, '°'],
  ['rotY', 'Heading (Y)', -180, 180, 15, '°'],
  ['rotZ', 'Roll (Z)', -180, 180, 90, '°'],
  ['lift', 'Lift', -1, 1, 0.02, ''],
];

const mb = bytes => `${(bytes / 1048576).toFixed(1)} MB`;

export default function ModelTuner({ tune, setTune, showBounds, setShowBounds, status, onFile, onClose }) {
  const [copied, setCopied] = useState(false);
  const line = `VITE_ROVER_MODEL_TUNE=${formatTune(tune)}`;
  async function copy() {
    try { await navigator.clipboard.writeText(line); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { setCopied(false); }
  }
  return <section className="panel tuner" aria-label="Rover model tuning">
    <div className="panel-head"><h2>Rover model</h2><button type="button" onClick={onClose}>Close</button></div>
    <ModelStatus status={status}/>
    <label className="file-pick">
      <span>Try a .glb from this computer</span>
      <input type="file" accept=".glb,.gltf,model/gltf-binary" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}/>
    </label>
    <p className="muted">Nose should point up the field (away from the camera). SolidWorks exports are often Z-up: try Tilt −90°.</p>
    {sliders.map(([key, label, min, max, step, unit]) => <label key={key} className="slider">
      <span>{label} <b>{+tune[key].toFixed(2)}{unit}</b></span>
      <input type="range" min={min} max={max} step={key.startsWith('rot') ? 1 : step} value={tune[key]}
        onChange={e => setTune({ ...tune, [key]: Number(e.target.value) })}/>
      {key.startsWith('rot') && <span className="snap">{[-90, 0, 90, 180].map(v =>
        <button type="button" key={v} onClick={() => setTune({ ...tune, [key]: v })}>{v}°</button>)}</span>}
    </label>)}
    <label className="check"><input type="checkbox" checked={showBounds} onChange={e => setShowBounds(e.target.checked)}/> Show bounding box</label>
    <div className="tune-out">
      <code>{line}</code>
      <div className="tune-actions">
        <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <button type="button" onClick={() => setTune(defaultTune)}>Reset</button>
      </div>
      <p className="muted">Paste this line into <code>.env.local</code> and restart <code>npm run dev</code> to keep these settings.</p>
    </div>
  </section>;
}

export function ModelStatus({ status }) {
  if (!status || status.state === 'none') return <p className="muted">No CAD model loaded. Showing the placeholder rover.</p>;
  if (status.state === 'loading') return <div className="model-loading">
    <span>Loading {status.label}… {status.progress != null ? `${Math.round(status.progress * 100)}%` : status.loaded ? mb(status.loaded) : ''}</span>
    <progress max="1" value={status.progress ?? undefined}/>
  </div>;
  if (status.state === 'error') return <p className="warn">{status.message}</p>;
  return <p className="live">Loaded {status.label} · {status.meshes} meshes · {status.triangles.toLocaleString()} triangles
    {status.triangles > 500000 && <span className="warn-inline"> · heavy model, consider compressing (see README)</span>}</p>;
}
