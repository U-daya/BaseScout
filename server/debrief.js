// Mission debrief: a short plain-English explanation of a saved mission report.
// The mission rules in src/mission.js choose the pad; Gemini only explains the result.
// If Gemini is not configured or fails, a rule-based debrief is used so saving never breaks.

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 8000;
const MAX_CHARS = 600;

export function ruleDebrief(report) {
  const { tests, slopeLimit, recommendation } = report;
  const parts = tests.map(test => {
    const slope = test.slope <= slopeLimit
      ? `its ${test.slope}° slope is within the ${slopeLimit}° limit`
      : `its ${test.slope}° slope exceeds the ${slopeLimit}° limit`;
    return `Pad ${test.pad} ${test.soil === 'pass' ? 'passed' : 'failed'} the simulated soil test and ${slope}.`;
  });
  parts.push(recommendation ? `BaseScout recommends Pad ${recommendation}.` : 'Neither pad qualifies.');
  return parts.join(' ');
}

function prompt(report) {
  return [
    'You are the mission debrief officer for BaseScout, a NASA Space Apps demo where a rover scouts two candidate crew base pads.',
    'Explain the outcome of this mission report in two short sentences for a general audience.',
    'Use only the facts in the report. Do not change or second-guess the recommendation.',
    'The soil tests and pad slopes are simulated demo values, not real measurements; do not imply otherwise.',
    'Plain text only, no markdown, no headings.',
    '',
    `Report: ${JSON.stringify(report)}`,
  ].join('\n');
}

async function geminiDebrief(report, apiKey, model) {
  const response = await fetch(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt(report) }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 200 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw Error(`Gemini HTTP ${response.status}`);
  const body = await response.json();
  const text = body?.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('').trim();
  if (!text) throw Error('Gemini returned no text');
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1).trimEnd()}…` : text;
}

export async function missionDebrief(report, { apiKey, model }) {
  if (apiKey) {
    try {
      return { text: await geminiDebrief(report, apiKey, model), source: 'gemini' };
    } catch (error) {
      // Never log the key or the full response; the status/message is enough to debug.
      console.error('Gemini debrief failed, using rule-based debrief:', error.message);
    }
  }
  return { text: ruleDebrief(report), source: 'rules' };
}
