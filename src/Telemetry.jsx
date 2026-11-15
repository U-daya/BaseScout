import React from 'react';
import { useEffect, useRef, useState } from 'react';

const sensors = [
  ['uv','UV',''], ['light','Light',''], ['air_quality','Air quality',''],
  ['temp_c','Temperature',' °C'], ['pressure_hpa','Pressure',' hPa'],
  ['joystick_x','Joystick X',''], ['joystick_y','Joystick Y',''],
];
export const DEAD_ZONE = 0.12;
const numeric = value => Number.isFinite(value) ? value : null;
const axis = value => Math.abs(value) <= 1 ? (value ?? 0) : 0;

const stored = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };

// Browsers refuse plain ws:// connections from a page served over https:// (mixed content).
export function mixedContentBlocked(endpoint) {
  try { return window.location.protocol === 'https:' && new URL(endpoint).protocol === 'ws:'; }
  catch { return false; }
}

function JoystickCheck({ packet, invert, setInvert, rate }) {
  const x = packet?.joystick_x, y = packet?.joystick_y;
  const has = x != null && y != null;
  const dx = has ? x * (invert.x ? -1 : 1) : 0;
  const dy = has ? y * (invert.y ? -1 : 1) : 0;
  const moving = has && Math.hypot(dx, dy) >= DEAD_ZONE;
  const direction = !moving ? 'centered' : [dy > DEAD_ZONE ? 'forward' : dy < -DEAD_ZONE ? 'back' : '', dx > DEAD_ZONE ? 'right' : dx < -DEAD_ZONE ? 'left' : ''].filter(Boolean).join(' + ');
  return <div className="joy-check">
    <svg viewBox="-1.15 -1.15 2.3 2.3" role="img" aria-label={has ? `Joystick ${direction}` : 'No joystick data'}>
      <rect x="-1" y="-1" width="2" height="2" rx=".12" className="joy-frame"/>
      <line x1="-1" y1="0" x2="1" y2="0" className="joy-axis"/><line x1="0" y1="-1" x2="0" y2="1" className="joy-axis"/>
      <circle r={DEAD_ZONE} className="joy-dead"/>
      <text x="0" y="-.84" className="joy-tick">FWD</text><text x=".84" y=".05" className="joy-tick">R</text>
      {has && <circle cx={dx} cy={-dy} r=".11" className={moving ? 'joy-dot active' : 'joy-dot'}/>}
    </svg>
    <div className="joy-info">
      <strong>Joystick check</strong>
      <span className="muted">{has ? <>Reads <b>{direction}</b> · {rate} Hz</> : 'Waiting for joystick_x / joystick_y'}</span>
      <span className="muted">Push forward: the dot should go up. Push right: it should go right. If not, flip an axis.</span>
      <div className="joy-toggles">
        <label><input type="checkbox" checked={invert.x} onChange={e => setInvert({ ...invert, x: e.target.checked })}/> Invert X</label>
        <label><input type="checkbox" checked={invert.y} onChange={e => setInvert({ ...invert, y: e.target.checked })}/> Invert Y</label>
      </div>
    </div>
  </div>;
}

export default function Telemetry({ joystick, onStatus }) {
  const [url,setUrl] = useState(import.meta.env.VITE_TELEMETRY_URL ?? '');
  const [endpoint,setEndpoint] = useState(import.meta.env.VITE_TELEMETRY_URL ?? '');
  const [status,setStatus] = useState('Pi disconnected');
  const [packet,setPacket] = useState(null);
  const [attempt,setAttempt] = useState(0);
  const [invert,setInvertState] = useState(() => stored('basescout.invert', { x:false, y:false }));
  const [rate,setRate] = useState(0);
  const invertRef = useRef(invert);
  invertRef.current = invert;
  const setInvert = value => { setInvertState(value); store('basescout.invert', value); };

  useEffect(() => { onStatus?.(packet ? 'live' : status.startsWith('Connecting') ? 'connecting' : 'off'); }, [packet, status, onStatus]);

  useEffect(() => {
    const clear = () => { joystick.current = { x:0,y:0,received:-Infinity }; };
    clear();
    setPacket(null);
    setRate(0);
    if (!endpoint) { setStatus('Pi disconnected'); return; }
    if (mixedContentBlocked(endpoint)) {
      setStatus('Blocked: this https:// page cannot open ws://. Use wss:// or run the app locally.');
      return;
    }
    let ws;
    let timer;
    let count = 0;
    const meter = setInterval(() => { setRate(count); count = 0; }, 1000);
    const disconnected = () => {
      clearTimeout(timer);
      clear();
      setPacket(null);
      setStatus('Pi disconnected');
    };
    const expire = () => {
      clear();
      setPacket(null);
      setStatus('Pi connected · no fresh readings');
    };
    try {
      const address = new URL(endpoint);
      if (!['ws:','wss:'].includes(address.protocol) || address.pathname !== '/telemetry') throw Error();
      ws = new WebSocket(address);
    } catch {
      clearInterval(meter);
      setStatus('Pi disconnected · enter a ws:// or wss:// URL ending in /telemetry');
      return;
    }
    setStatus('Connecting to Pi…');
    ws.onopen = expire;
    ws.onclose = disconnected;
    ws.onerror = disconnected;
    ws.onmessage = ({ data }) => {
      let message;
      try { message = JSON.parse(data); } catch { return; }
      if (!message || typeof message !== 'object' || Array.isArray(message) ||
          !sensors.some(([key]) => Object.hasOwn(message,key))) return;
      const normalized = Object.fromEntries(sensors.map(([key]) => [key,numeric(message[key])]));
      normalized.timestamp = typeof message.timestamp === 'string' && Number.isFinite(Date.parse(message.timestamp))
        ? message.timestamp : null;
      for (const key of ['joystick_x','joystick_y']) if (Math.abs(normalized[key]) > 1) normalized[key] = null;
      const flip = invertRef.current;
      joystick.current = {
        x: axis(normalized.joystick_x) * (flip.x ? -1 : 1),
        y: axis(normalized.joystick_y) * (flip.y ? -1 : 1),
        received: performance.now(),
      };
      count++;
      setPacket(normalized);
      setStatus('Pi connected');
      clearTimeout(timer);
      timer = setTimeout(expire,2000);
    };
    return () => {
      clear();
      clearTimeout(timer);
      clearInterval(meter);
      ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
      ws.close();
    };
  },[endpoint,attempt,joystick]);

  const blocked = mixedContentBlocked(url);
  return <section className="panel telemetry" id="telemetry">
    <div className="panel-head"><h2>Live Earth demo telemetry</h2><span role="status" className={packet ? 'live' : 'muted'}>{status}</span></div>
    <form onSubmit={event => {event.preventDefault();setEndpoint(url.trim());setAttempt(n=>n+1);}}>
      <input aria-label="Pi WebSocket URL" value={url} onChange={e=>setUrl(e.target.value)} placeholder="ws://PI-IP:8765/telemetry"/>
      <button>Connect</button>
      {endpoint && <button type="button" onClick={()=>setEndpoint('')}>Disconnect</button>}
    </form>
    {blocked && <p className="warn" role="note">
      This page is served over <b>https://</b>, so the browser will block a plain <b>ws://</b> Pi address.
      Either give the Pi a <b>wss://</b> address (for example through Cloudflare Tunnel), or run BaseScout on the demo laptop
      with <code>npm run dev</code> and open <code>http://127.0.0.1:5173</code>. See “Pi demo setup” in the README.
    </p>}
    <div className="telemetry-body">
      <dl className="readings">{sensors.map(([key,label,unit]) => <div key={key}><dt>{label}</dt><dd>{packet?.[key] == null ? '—' : `${packet[key]}${unit}`}</dd></div>)}</dl>
      <JoystickCheck packet={packet} invert={invert} setInvert={setInvert} rate={rate}/>
    </div>
    <p className="muted">Sample time {packet?.timestamp ?? '—'}. UV, light, and air quality use raw values pending unit confirmation. Keyboard always overrides the joystick.</p>
  </section>;
}
