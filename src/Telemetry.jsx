import React from 'react';
import { useEffect, useState } from 'react';

const sensors = [
  ['uv','UV',''], ['light','Light',''], ['air_quality','Air quality',''],
  ['temp_c','Temperature',' °C'], ['pressure_hpa','Pressure',' hPa'],
  ['joystick_x','Joystick X',''], ['joystick_y','Joystick Y',''],
];
const numeric = value => Number.isFinite(value) ? value : null;
const axis = value => Math.abs(value) <= 1 ? (value ?? 0) : 0;

export default function Telemetry({ joystick }) {
  const [url,setUrl] = useState(import.meta.env.VITE_TELEMETRY_URL ?? '');
  const [endpoint,setEndpoint] = useState(import.meta.env.VITE_TELEMETRY_URL ?? '');
  const [status,setStatus] = useState('Pi disconnected');
  const [packet,setPacket] = useState(null);
  const [attempt,setAttempt] = useState(0);

  useEffect(() => {
    const clear = () => { joystick.current = { x:0,y:0,received:-Infinity }; };
    clear();
    setPacket(null);
    if (!endpoint) { setStatus('Pi disconnected'); return; }
    let ws;
    let timer;
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
      joystick.current = { x:axis(normalized.joystick_x), y:axis(normalized.joystick_y), received:performance.now() };
      setPacket(normalized);
      setStatus('Pi connected');
      clearTimeout(timer);
      timer = setTimeout(expire,2000);
    };
    return () => {
      clear();
      clearTimeout(timer);
      ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
      ws.close();
    };
  },[endpoint,attempt,joystick]);

  return <section className="panel telemetry">
    <div className="panel-head"><h2>Live Earth demo telemetry</h2><span role="status" className={packet ? 'live' : 'muted'}>{status}</span></div>
    <form onSubmit={event => {event.preventDefault();setEndpoint(url.trim());setAttempt(n=>n+1);}}>
      <input aria-label="Pi WebSocket URL" value={url} onChange={e=>setUrl(e.target.value)} placeholder="ws://PI-IP:8765/telemetry"/>
      <button>Connect</button>
      {endpoint && <button type="button" onClick={()=>setEndpoint('')}>Disconnect</button>}
    </form>
    <dl className="readings">{sensors.map(([key,label,unit]) => <div key={key}><dt>{label}</dt><dd>{packet?.[key] == null ? '—' : `${packet[key]}${unit}`}</dd></div>)}</dl>
    <p className="muted">Sample time {packet?.timestamp ?? '—'}. UV, light, and air quality use raw values pending unit confirmation.</p>
  </section>;
}
