import React, { useEffect, useState } from 'react';
import Terrain3D from './Terrain3D';
import MiniPlanet from './MiniPlanet';

const root = import.meta.env.BASE_URL + 'terrain/';
const metrics = [['relief','Relief','m','Elevation range across the window'],['median','Median slope','°','Median terrain slope'],['p90','Steep slope','°','90th percentile slope']];
const gap = (site, target, key) => Math.abs(site[key]-target[key])/target[key];
const distance = (site, target) => metrics.reduce((sum,[key]) => sum + gap(site,target,key),0)/metrics.length;
const format = (value, unit) => unit === 'm' ? `${Math.round(value).toLocaleString()} m` : `${value.toFixed(2)}°`;
const short = name => name.split(',')[0];
// Earth sites ranked by terrain distance to a Moon or Mars target (lower is closer).
export const rankSites = (sites, targetId) => {
  const target = sites.find(s => s.id === targetId);
  return target ? sites.filter(s => s.planet === 'Earth').map(s => ({ ...s, score: distance(s, target) })).sort((a, b) => a.score - b.score) : [];
};

function ScoreBreakdown({ ranked, target }) {
  const max = Math.max(1, ...ranked.flatMap(site => metrics.map(([key]) => gap(site,target,key))));
  return <div className="panel breakdown">
    <div className="panel-head"><h2>Why this ranking</h2><span className="muted">Difference from {short(target.name)} · shorter bar = more {target.planet}-like</span></div>
    {ranked.map(site => <div className="breakdown-site" key={site.id}>
      <div className="breakdown-title"><strong>{site.name}</strong><span>score {site.score.toFixed(2)}</span></div>
      {metrics.map(([key,label,unit]) => {
        const g = gap(site,target,key);
        return <div className="bar-row" key={key}>
          <span className="bar-label">{label}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width:`${(g/max)*100}%` }}/></span>
          <span className="bar-value">{Math.round(g*100)}% off <small>({format(site[key],unit)} vs {format(target[key],unit)})</small></span>
        </div>;
      })}
    </div>)}
  </div>;
}

// Step 1: choose a permanent-base target on the Moon or Mars, then rank Earth analogs against it.
export default function Terrain({ onContinue, targetId, onTarget }) {
  const [sites,setSites] = useState(null);
  const [error,setError] = useState(false);
  useEffect(() => {
    const request = new AbortController();
    fetch(root+'sites.json',{signal:request.signal}).then(response => {
      if (!response.ok) throw Error('Terrain data unavailable');
      return response.json();
    }).then(setSites).catch(error => {if(error.name !== 'AbortError')setError(true);});
    return () => request.abort();
  },[]);
  if (!sites) return <p role="status">{error ? 'Terrain data unavailable.' : 'Loading terrain comparison…'}</p>;
  const targets = sites.filter(site => site.planet !== 'Earth');
  const earth = sites.filter(site => site.planet === 'Earth');
  const target = targets.find(t => t.id === targetId) ?? targets[0];
  const ranked = earth.map(site => ({...site,score:distance(site,target)})).sort((a,b)=>a.score-b.score);
  const closest = ranked[0];
  const shown = [target, ...ranked];
  return <section>
    <div className="intro"><p className="eyebrow">STEP 1 · TERRAIN COMPARISON</p><h1>Find the Earth twin of a {target.planet} base site</h1>
      <p>Pick a permanent base target on the Moon or Mars. BaseScout ranks {earth.length} real Earth analog sites against it, using 25 × 25 km elevation windows on a common 500 m grid from NASA and SRTM data.</p></div>
    <div className="target-picker" role="tablist" aria-label="Base target">
      {targets.map(t => <button key={t.id} type="button" role="tab" aria-selected={t.id === target.id} onClick={() => onTarget?.(t.id)}>
        <MiniPlanet kind={t.planet.toLowerCase()}/><span>{t.planet}</span><b>{short(t.name)}</b>
      </button>)}
    </div>
    {target.note && <p className="target-note">{target.note}</p>}
    <div className="panel result closest">
      <div>
        <h2>Closest Earth twin for {target.name}</h2><strong>{closest.name}</strong>
        <p>{ranked.slice(0, 4).map(site => `${short(site.name)} ${site.score.toFixed(2)}`).join(' · ')}. Lower terrain distance is closer.</p>
      </div>
      {onContinue && <button type="button" className="primary" onClick={() => onContinue(closest.id, target.id)}>Rehearse at {short(closest.name)} →</button>}
    </div>
    <Terrain3D sites={shown} root={root} key={target.id}/>
    <ScoreBreakdown ranked={ranked} target={target}/>
    <div className="terrain-grid">{shown.map(site => <article className={`panel terrain-card${site.id===closest.id ? ' best' : ''}${site.id===target.id ? ' target' : ''}`} key={site.id}>
      <div className="panel-head"><h2>{site.name}</h2><span className="muted">{site.id===target.id ? `${site.planet} target` : site.id===closest.id ? 'Best Earth twin' : `Earth · ${site.score.toFixed(2)}`}</span></div>
      <img src={root+site.id+'.png'} alt={`Relative elevation at ${site.name}. Light areas are higher within this window.`}/>
      <dl className="readings">{metrics.map(([key,label,unit,title]) => <div key={key} title={title}><dt>{label}</dt><dd>{format(site[key],unit)}</dd></div>)}</dl>
      {site.note && <p className="site-note">{site.note}</p>}
      {onContinue && site.planet === 'Earth' && <button type="button" className="card-cta" onClick={() => onContinue(site.id, target.id)}>Rehearse the mission here →</button>}
      <p className="muted">Window centre {site.lat.toFixed(2)}°, {site.lon.toFixed(2)}° · <a href={site.url}>{site.source}</a></p>
    </article>)}</div>
    <p className="muted">“Steep slope” is the 90th percentile slope. Each image uses its own low-to-high color scale. The ranking averages the absolute differences from the selected target in relief, median slope, and 90th percentile slope, dividing each by the target’s value. Moon targets come from NASA LRO LOLA polar topography; Mars from NASA MGS MOLA; Earth from SRTM via Mapzen. This regional comparison cannot assess wheel-scale obstacles or soil.</p>
  </section>;
}
