import React, { useEffect, useState } from 'react';

async function requestReport(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.report) throw Object.assign(Error(body?.error ?? 'Mission API unavailable. Retry shortly.'), { status: response.status });
  return body;
}

export function SaveMission({ siteId, targetId, order, padASoil, padBSoil, getTelemetry }) {
  const [id, setId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setSaving(true);
    setError('');
    const post = missionId => requestReport('/api/missions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: missionId, siteId, targetId, order, padASoil, padBSoil, telemetry: getTelemetry?.() ?? undefined }),
    });
    try {
      try {
        await post(id);
      } catch (failure) {
        // An earlier attempt with this ID was stored with other results: save under a fresh ID instead.
        if (failure.status !== 409) throw failure;
        const fresh = crypto.randomUUID();
        await post(fresh);
        setId(fresh);
      }
      setSaved(true);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }
  return <div className="save-mission">
    {saved ? <a href={`/app?mission=${id}`}>Open shareable mission report</a>
      : <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save mission'}</button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function MissionReport({ id }) {
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    requestReport(`/api/missions/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(setRecord).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [id]);
  const report = record?.report;
  const [copied, setCopied] = useState(false);
  async function copyLink() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { setCopied(false); }
  }
  const saved = record ? new Date(record.created_at) : null;
  return <>
    <header className="top">
      <a className="brand" href="/app"><svg className="brand-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><circle cx="10" cy="10" r="2.2" className="core"/><path d="M10 0v4M10 16v4M0 10h4M16 10h4"/></svg>BaseScout<span className="brand-tag">Mission report</span></a>
      <div className="report-actions">
        <button type="button" onClick={copyLink}>{copied ? 'Link copied' : 'Copy link'}</button>
        <button type="button" onClick={() => window.print()}>Print</button>
      </div>
    </header>
    <main className="report">
      {!report ? <p className="panel" role="status">{error || 'Loading mission report…'}</p> : <>
        <div className="intro">
          <p className="eyebrow">{report.target ? `${report.target.planet.toUpperCase()} BASE` : 'CREW BASE'} SITE SELECTION · EARTH REHEARSAL</p>
          <h1>{report.recommendation ? `Recommend Pad ${report.recommendation}` : 'Neither pad qualifies'}</h1>
          <p>{report.target ? <>Rehearsing for <b>{report.target.name}</b> ({report.target.planet}) · </> : null}Earth test site: {report.site ?? 'Hanksville, Utah'} · slope limit ≤ {report.slopeLimit}° · slopes from real elevation data, soil results simulated</p>
        </div>
        <dl className="report-meta">
          <div><dt>Mission ID</dt><dd>{record.id.slice(0, 8)}</dd></div>
          <div><dt>Saved</dt><dd><time dateTime={record.created_at}>{saved.toLocaleString()}</time></dd></div>
          <div><dt>Pads tested</dt><dd>{report.tests.length}</dd></div>
          <div><dt>Result</dt><dd className={report.recommendation ? 'ok' : 'bad'}>{report.recommendation ? `Pad ${report.recommendation}` : 'None'}</dd></div>
        </dl>
        <section className="panel">
          <div className="panel-head"><h2>Test sequence</h2><span className="muted">Measured slope · simulated soil</span></div>
          <table className="report-table">
            <thead><tr><th>Step</th><th>Pad</th><th>Slope</th><th>Soil sample</th><th>Outcome</th></tr></thead>
            <tbody>{report.tests.map((test, index) => {
              const slopeOk = test.slope <= report.slopeLimit, pass = slopeOk && test.soil === 'pass';
              return <tr key={test.pad}>
                <td>{index + 1}</td>
                <td>Pad {test.pad}</td>
                <td className={slopeOk ? 'ok' : 'bad'}>{slopeOk ? '✓' : '✗'} {test.slope}°</td>
                <td className={test.soil === 'pass' ? 'ok' : 'bad'}>{test.soil === 'pass' ? '✓ pass' : '✗ fail'}</td>
                <td>{pass ? (test.pad === report.recommendation ? 'Selected' : 'Qualified') : 'Rejected'}</td>
              </tr>;
            })}</tbody>
          </table>
        </section>
        {report.telemetry && <section className="panel">
          <div className="panel-head"><h2>Field telemetry at save time</h2><span className="muted">{report.telemetry.source}</span></div>
          <dl className="report-meta">
            <div><dt>Temperature</dt><dd>{report.telemetry.temp_c ?? '—'}{report.telemetry.temp_c != null && ' °C'}</dd></div>
            <div><dt>Pressure</dt><dd>{report.telemetry.pressure_hpa ?? '—'}{report.telemetry.pressure_hpa != null && ' hPa'}</dd></div>
            <div><dt>Light (raw)</dt><dd>{report.telemetry.light ?? '—'}</dd></div>
            <div><dt>Air quality (raw)</dt><dd>{report.telemetry.air_quality ?? '—'}</dd></div>
          </dl>
          {report.telemetry.timestamp && <p className="muted" style={{marginTop:'.6rem'}}>Sample time {new Date(report.telemetry.timestamp).toLocaleString()}</p>}
        </section>}
        {report.debrief?.text && <section className="panel debrief">
          <h2>Mission debrief</h2>
          <p>{report.debrief.text}</p>
          <span className="muted">{report.debrief.source === 'gemini' ? 'Written by Gemini from the simulated results' : 'Generated from the mission rules'}</span>
        </section>}
        <p className="muted report-foot">The pad decision comes from fixed mission rules; the debrief only explains it. Generated by BaseScout · NASA Space Apps Challenge NYC 2026. <a href="/app?view=mission">Run another mission</a></p>
      </>}
    </main>
  </>;
}
