// Optional Twilio SMS alert when a new mission report is saved.
// Enabled only when TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM and TWILIO_TO are set.
// Never blocks or fails the save: errors are logged without credentials.

const TIMEOUT_MS = 8000;

export function twilioConfig(env) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from, TWILIO_TO: to, PUBLIC_URL: publicUrl } = env;
  return sid && token && from && to ? { sid, token, from, to, publicUrl } : null;
}

export function alertText(saved, publicUrl) {
  const { report } = saved;
  const steps = report.tests.map(t => `Pad ${t.pad} soil ${t.soil}`).join(', ');
  const verdict = report.recommendation ? `Recommend Pad ${report.recommendation}.` : 'Neither pad qualifies.';
  const link = publicUrl ? ` ${publicUrl.replace(/\/$/, '')}/?mission=${saved.id}` : '';
  return `BaseScout mission saved: ${steps}. ${verdict}${link}`.slice(0, 320);
}

export async function sendMissionAlert(saved, config) {
  if (!config) return;
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.sid}:${config.token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: config.to, From: config.from, Body: alertText(saved, config.publicUrl) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      console.error('Twilio alert failed:', response.status, body.code ?? '', body.message ?? '');
    }
  } catch (error) {
    console.error('Twilio alert failed:', error.name);
  }
}
