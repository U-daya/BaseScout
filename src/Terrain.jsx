import React, { useEffect, useState } from 'react';

const root = import.meta.env.BASE_URL + 'terrain/';
const metrics = [['relief','Elevation range','m'],['median','Median slope','°'],['p90','90th percentile slope','°']];
const distance = (site, mars) => metrics.reduce((sum,[key]) => sum + Math.abs(site[key]-mars[key])/mars[key],0)/metrics.length;

export default function Terrain() {
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
    <div className="intro"><p className="eyebrow">TERRAIN COMPARISON</p><h1>Find a Mars analog</h1><p>Three 25 × 25 km elevation windows on a common 500 m grid.</p></div>
    <div className="panel result"><h2>Closest match among the two candidates</h2><strong>{closest.name}</strong><p>{ranked.map(site => `${site.name} ${site.score.toFixed(2)}`).join(' · ')}. Lower terrain distance is closer.</p></div>
    <div className="terrain-grid">{sites.map(site => <article className="panel terrain-card" key={site.id}>
      <div className="panel-head"><h2>{site.name}</h2><span className="muted">{site.planet}</span></div>
      <img src={root+site.id+'.png'} alt={`Relative elevation at ${site.name}. Light areas are higher within this window. North is up.`}/>
      <dl className="readings">{metrics.map(([key,label,unit]) => <div key={key}><dt>{label}</dt><dd>{site[key]} {unit}</dd></div>)}</dl>
      <p className="muted">Center {site.lat.toFixed(2)}°, {site.lon.toFixed(2)}° · <a href={site.url}>{site.source}</a></p>
    </article>)}</div>
    <p className="muted">Each image uses its own low-to-high color scale. The ranking averages the absolute differences from Jezero in relief, median slope, and 90th percentile slope, dividing each by Jezero’s value for that metric. This regional comparison cannot assess wheel-scale obstacles or soil.</p>
  </section>;
}
