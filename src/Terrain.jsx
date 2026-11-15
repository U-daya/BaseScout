import React, { useEffect, useState } from 'react';

const root = import.meta.env.BASE_URL + 'terrain/';
const metrics = [['relief','Relief','m','Elevation range across the window'],['median','Median slope','°','Median terrain slope'],['p90','Steep slope','°','90th percentile slope']];
const gap = (site, mars, key) => Math.abs(site[key]-mars[key])/mars[key];
const distance = (site, mars) => metrics.reduce((sum,[key]) => sum + gap(site,mars,key),0)/metrics.length;
const format = (value, unit) => unit === 'm' ? `${Math.round(value).toLocaleString()} m` : `${value.toFixed(2)}°`;

function ScoreBreakdown({ ranked, mars }) {
  const max = Math.max(1, ...ranked.flatMap(site => metrics.map(([key]) => gap(site,mars,key))));
  return <div className="panel breakdown">
    <div className="panel-head"><h2>Why this ranking</h2><span className="muted">Difference from Jezero · shorter bar = more Mars-like</span></div>
    {ranked.map(site => <div className="breakdown-site" key={site.id}>
      <div className="breakdown-title"><strong>{site.name}</strong><span>score {site.score.toFixed(2)}</span></div>
      {metrics.map(([key,label,unit]) => {
        const g = gap(site,mars,key);
        return <div className="bar-row" key={key}>
          <span className="bar-label">{label}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width:`${(g/max)*100}%` }}/></span>
          <span className="bar-value">{Math.round(g*100)}% off <small>({format(site[key],unit)} vs {format(mars[key],unit)})</small></span>
        </div>;
      })}
    </div>)}
  </div>;
}

export default function Terrain({ onContinue }) {
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
  const [mars,...earth] = sites;
  const ranked = earth.map(site => ({...site,score:distance(site,mars)})).sort((a,b)=>a.score-b.score);
  const closest = ranked[0];
  return <section>
    <div className="intro"><p className="eyebrow">STEP 1 · TERRAIN COMPARISON</p><h1>Find a Mars analog</h1><p>Three 25 × 25 km elevation windows on a common 500 m grid, compared against Jezero Crater.</p></div>
    <div className="panel result closest">
      <div>
        <h2>Closest match among the two candidates</h2><strong>{closest.name}</strong>
        <p>{ranked.map(site => `${site.name} ${site.score.toFixed(2)}`).join(' · ')}. Lower terrain distance is closer.</p>
      </div>
      {onContinue && <button type="button" className="primary" onClick={onContinue}>Scout a base at {closest.name.split(',')[0]} →</button>}
    </div>
    <ScoreBreakdown ranked={ranked} mars={mars}/>
    <div className="terrain-grid">{sites.map(site => <article className={`panel terrain-card${site.id===closest.id ? ' best' : ''}`} key={site.id}>
      <div className="panel-head"><h2>{site.name}</h2><span className="muted">{site.id===closest.id ? 'Best Earth match' : site.planet}</span></div>
      <img src={root+site.id+'.png'} alt={`Relative elevation at ${site.name}. Light areas are higher within this window. North is up.`}/>
      <dl className="readings">{metrics.map(([key,label,unit,title]) => <div key={key} title={title}><dt>{label}</dt><dd>{format(site[key],unit)}</dd></div>)}</dl>
      <p className="muted">Center {site.lat.toFixed(2)}°, {site.lon.toFixed(2)}° · <a href={site.url}>{site.source}</a></p>
    </article>)}</div>
    <p className="muted">“Steep slope” is the 90th percentile slope. Each image uses its own low-to-high color scale. The ranking averages the absolute differences from Jezero in relief, median slope, and 90th percentile slope, dividing each by Jezero’s value for that metric. This regional comparison cannot assess wheel-scale obstacles or soil.</p>
  </section>;
}
