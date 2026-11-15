// Optional Twilio alerts when a new mission report is saved:
//   - SMS with the result and report link (needs TWILIO_FROM, a Twilio number)
//   - "Mission Control" voice call that reads the go / no-go result aloud
//     (TWILIO_VOICE=1; calls from TWILIO_VOICE_FROM, which may be a Verified Caller ID, else TWILIO_FROM)
// Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_TO. Trial accounts can only reach verified numbers.
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
  const voice = env.TWILIO_VOICE === '1' || env.TWILIO_VOICE === 'true';
  const voiceFrom = env.TWILIO_VOICE_FROM || from;
  const sms = !!from;
  const call = voice && !!voiceFrom;
  return sid && token && to && (sms || call) ? { sid, token, from, to, publicUrl, trialTemplate, sms, call, voiceFrom } : null;
}

export function alertText(saved, publicUrl) {
  const { report } = saved;
  const steps = report.tests.map(t => `Pad ${t.pad} soil ${t.soil}`).join(', ');
  const verdict = report.recommendation ? `Recommend Pad ${report.recommendation}.` : 'Neither pad qualifies.';
  const link = publicUrl ? ` ${publicUrl.replace(/\/$/, '')}/app?mission=${saved.id}` : '';
  return `Knowwhere mission saved: ${steps}. ${verdict}${link}`.slice(0, 320);
}

const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// What Mission Control says on the call: a go / no-go poll for each pad, then the decision and the debrief.
export function missionCallScript(saved) {
  const { report } = saved;
  const where = report.target
    ? `Landing rehearsal for ${report.target.name} on the ${report.target.planet}, at ${report.site}.`
    : `Landing rehearsal at ${report.site ?? 'the Earth test site'}.`;
  const polls = report.tests.map(t => {
    const slopeOk = t.slope <= report.slopeLimit, go = slopeOk && t.soil === 'pass';
    return `Pad ${t.pad}. Slope ${t.slope} degrees, ${slopeOk ? 'within' : 'over'} the ${report.slopeLimit} degree limit. Soil ${t.soil}. Pad ${t.pad} is ${go ? 'go' : 'no go'}.`;
  });
  const decision = report.recommendation
    ? `Mission Control recommends building at Pad ${report.recommendation}.`
    : 'Neither pad qualifies. Mission Control recommends scouting a new site.';
  const debrief = report.debrief?.text ? `Debrief. ${report.debrief.text}` : '';
  return [`This is Knowwhere Mission Control.`, where, ...polls, decision, debrief, 'Full report at knowwhere dot N Y C. Mission Control out.'].filter(Boolean);
}

export function missionCallTwiml(saved) {
  const say = line => `<Say voice="Polly.Matthew">${xml(line)}</Say><Pause length="1"/>`;
  return `<Response>${missionCallScript(saved).map(say).join('')}</Response>`;
}

async function twilioPost(config, resource, params) {
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.sid)}/${resource}.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.sid}:${config.token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.ok) return { ok: true };
  const error = await response.json().catch(() => ({}));
  return { ok: false, status: response.status, code: error.code, message: error.message };
}

const send = (config, body) => twilioPost(config, 'Messages', { To: config.to, From: config.from, Body: body });

async function sendSms(saved, config) {
  let result = await send(config, alertText(saved, config.publicUrl));
  if (!result.ok && result.code === TRIAL_TEMPLATE_ERROR) {
    // Trial account: fall back to a pre-defined template. Upgrading the account restores the full message.
    result = await send(config, config.trialTemplate);
    if (result.ok) console.log(`Twilio trial account: sent pre-defined template "${config.trialTemplate}" instead of the mission summary`);
  }
  if (!result.ok) console.error('Twilio SMS failed:', result.status, result.code ?? '', result.message ?? '');
}

async function placeCall(saved, config) {
  // Inline TwiML: no webhook or public callback URL needed.
  const result = await twilioPost(config, 'Calls', { To: config.to, From: config.voiceFrom, Twiml: missionCallTwiml(saved) });
  if (result.ok) console.log('Twilio Mission Control call placed');
  else console.error('Twilio call failed:', result.status, result.code ?? '', result.message ?? '');
}

export async function sendMissionAlert(saved, config) {
  if (!config) return;
  const jobs = [];
  if (config.sms) jobs.push(sendSms(saved, config));
  if (config.call) jobs.push(placeCall(saved, config));
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === 'rejected') console.error('Twilio alert failed:', r.reason?.name ?? 'error');
}
