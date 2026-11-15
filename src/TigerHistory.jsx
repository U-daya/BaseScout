import React, { useEffect, useState } from 'react';

// Per-minute Pi telemetry history from Tiger Data (TimescaleDB continuous aggregate on a hypertable).
const METRICS = [
  ['temp_c', 'Temperature', ' °C', 1],
  ['pressure_hpa', 'Pressure', ' hPa', 1],
  ['air_quality', 'Air quality (raw)', '', 0],
  ['light', 'Light (raw)', '', 0],
];
const REFRESH_MS = 30000;

function Chart({ buckets, metric, unit, digits }) {
  const pts = buckets.filter(b => b[metric] != null);
  if (pts.length < 2) return <p className="muted tiger-empty">Collecting…</p>;
  const t0 = Date.parse(pts[0].t), t1 = Date.parse(pts[pts.length - 1].t) || t0 + 1;
  const vals = pts.map(p => p[metric]);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (max - min < 1e-6) { min -= 1; max += 1; }
  const path = pts.map(p => `${((Date.parse(p.t) - t0) / Math.max(1, t1 - t0)) * 100},${38 - ((p[metric] - min) / (max - min)) * 34}`).join(' ');
  const last = vals[vals.length - 1];
  return <>
    <svg className="tiger-chart" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={path} vectorEffect="non-scaling-stroke"/>
    </svg>
    <p className="tiger-range"><span>{min.toFixed(digits)}–{max.toFixed(digits)}{unit}</span><b>{last.toFixed(digits)}{unit}</b></p>
  </>;
}

export default function TigerHistory() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stop = false, timer;
    const load = () => fetch('/api/telemetry/history?minutes=60')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(body => { if (!stop) { setData(body); setFailed(false); } })
      .catch(() => { if (!stop) setFailed(true); })
      .finally(() => { if (!stop) timer = setTimeout(load, REFRESH_MS); });
    load();
    return () => { stop = true; clearTimeout(timer); };
  }, []);
  if (failed && !data) return null; // storage not set up (e.g. local dev without the API)
  if (!data) return null;
  const latest = data.latest ? new Date(data.latest).toLocaleTimeString() : '—';
  return <div className="tiger">
    <div className="panel-head"><h3>Stored in Tiger Data · last hour</h3>
      <span className="muted">{data.total.toLocaleString()} samples stored · newest {latest}</span></div>
    {data.buckets.length ? <div className="tiger-grid">
      {METRICS.map(([key, label, unit, digits]) => <div key={key} className="tiger-cell">
        <span className="tiger-label">{label}</span>
        <Chart buckets={data.buckets} metric={key} unit={unit} digits={digits}/>
      </div>)}
    </div> : <p className="muted">No readings stored in the last hour. Turn on the Pi and they appear here within a minute.</p>}
    <p className="muted tiger-note">Every Pi sample goes through the Cloudflare relay into a TimescaleDB hypertable (compressed after a day). These charts read per-minute averages from a real-time continuous aggregate, refreshed every 30 s.</p>
  </div>;
}
