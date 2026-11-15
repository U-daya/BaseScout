// Optional Twilio SMS alert when a new mission report is saved.
// Enabled only when TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM and TWILIO_TO are set.
// Never blocks or fails the save: errors are logged without credentials.

const TIMEOUT_MS = 8000;

// Twilio trial accounts reject custom message bodies (error 572006) and only send
// pre-defined templates, chosen by passing the template name as Body.
// See https://www.twilio.com/docs/usage/trials/try-out-sms
const TRIAL_TEMPLATE_ERROR = 572006;
const DEFAULT_TRIAL_TEMPLATE = 'sms_internal_alerts';

export function twilioConfig(env) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from, TWILIO_TO: to, PUBLIC_URL: publicUrl } = env;
  const trialTemplate = env.TWILIO_TRIAL_TEMPLATE || DEFAULT_TRIAL_TEMPLATE;
  return sid && token && from && to ? { sid, token, from, to, publicUrl, trialTemplate } : null;
}

export function alertText(saved, publicUrl) {
  const { report } = saved;
  const steps = report.tests.map(t => `Pad ${t.pad} soil ${t.soil}`).join(', ');
  const verdict = report.recommendation ? `Recommend Pad ${report.recommendation}.` : 'Neither pad qualifies.';
  const link = publicUrl ? ` ${publicUrl.replace(/\/$/, '')}/app?mission=${saved.id}` : '';
  return `BaseScout mission saved: ${steps}. ${verdict}${link}`.slice(0, 320);
}

async function send(config, body) {
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.sid}:${config.token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: config.to, From: config.from, Body: body }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.ok) return { ok: true };
  const error = await response.json().catch(() => ({}));
  return { ok: false, status: response.status, code: error.code, message: error.message };
}

export async function sendMissionAlert(saved, config) {
  if (!config) return;
  try {
    let result = await send(config, alertText(saved, config.publicUrl));
    if (!result.ok && result.code === TRIAL_TEMPLATE_ERROR) {
      // Trial account: fall back to a pre-defined template. Upgrading the account restores the full message.
      result = await send(config, config.trialTemplate);
      if (result.ok) console.log(`Twilio trial account: sent pre-defined template "${config.trialTemplate}" instead of the mission summary`);
    }
    if (!result.ok) console.error('Twilio alert failed:', result.status, result.code ?? '', result.message ?? '');
  } catch (error) {
    console.error('Twilio alert failed:', error.name);
  }
}
