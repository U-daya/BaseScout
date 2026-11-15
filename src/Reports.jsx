import React, { useEffect, useState } from 'react';

async function requestReport(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.report) throw Error(body?.error ?? 'Mission API unavailable. Retry shortly.');
  return body;
}

export function SaveMission({ padASoil }) {
  const [id] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setSaving(true);
    setError('');
    try {
      await requestReport('/api/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, padASoil }),
      });
      setSaved(true);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }
  return <div className="save-mission">
    {saved ? <a href={`/?mission=${id}`}>Open shareable mission report</a>
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
  return <main>
    <div className="intro"><a href="/">Back to BaseScout</a><h1>Mission report</h1></div>
    <section className="panel result">
      {!report ? <p role="status">{error || 'Loading mission report…'}</p> : <>
        <strong>{report.recommendation ? `Recommend Pad ${report.recommendation}` : 'Neither pad qualifies'}</strong>
        <p>Simulated slope and soil tests · demo slope limit ≤ {report.slopeLimit}°</p>
        <ol>{report.tests.map(test => <li key={test.pad}>Pad {test.pad} · {test.slope}° slope · soil {test.soil}</li>)}</ol>
        <p>Saved <time dateTime={record.created_at}>{new Date(record.created_at).toLocaleString()}</time></p>
      </>}
    </section>
  </main>;
}
