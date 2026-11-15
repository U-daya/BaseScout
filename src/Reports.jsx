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

// Ask Mission Control: a visitor asks Grok about this saved mission. Answers are not stored.
const SUGGESTED = ['Why was this pad chosen?', 'What would a real crew need at this site?', 'How does this Earth site compare to the target?'];
function AskMissionControl({ id }) {
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function ask(text) {
    const q = text.trim();
    if (q.length < 3 || busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/missions/${encodeURIComponent(id)}/ask`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.answer) throw Error(body?.error ?? 'Mission Control could not answer right now. Try again.');
      setHistory(h => [...h, { q, a: body.answer }]); setQuestion('');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <section className="panel ask-mc">
    <div className="panel-head"><h2>Ask Mission Control</h2><span className="muted">Answered by Grok (xAI) from this report</span></div>
    {history.map((item, i) => <div className="ask-turn" key={i}><p className="ask-q">{item.q}</p><p className="ask-a">{item.a}</p></div>)}
    {busy && <p className="ask-a muted" role="status">Mission Control is thinking…</p>}
    {!history.length && !busy && <div className="ask-suggest">{SUGGESTED.map(s => <button key={s} type="button" onClick={() => ask(s)}>{s}</button>)}</div>}
    <form className="ask-form" onSubmit={e => { e.preventDefault(); ask(question); }}>
      <input value={question} onChange={e => setQuestion(e.target.value)} maxLength={300} placeholder="Ask about this mission, e.g. why not Pad B?" aria-label="Question for Mission Control" disabled={busy}/>
      <button type="submit" className="primary" disabled={busy || question.trim().length < 3}>Ask</button>
    </form>
    {error && <p role="alert" className="ask-error">{error}</p>}
    <small className="muted">Grok explains the result; it cannot change it. Soil results are simulated.</small>
  </section>;
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
      <a className="brand" href="/" title="Back to the BaseScout home page"><svg className="brand-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path className="lit" d="M10 2a8 8 0 0 0 0 16a4.6 8 0 0 1 0-16z"/><circle cx="13.2" cy="10" r="2.5"/><circle className="core" cx="13.2" cy="10" r=".95"/></svg>BaseScout<span className="brand-tag">Mission report</span></a>
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
        <AskMissionControl id={record.id}/>
        <p className="muted report-foot">The pad decision comes from fixed mission rules; the debrief only explains it. Generated by BaseScout · NASA Space Apps Challenge NYC 2026. <a href="/app?view=mission">Run another mission</a></p>
      </>}
    </main>
  </>;
}
