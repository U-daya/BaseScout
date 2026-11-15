// "Ask Mission Control": answers a visitor's question about one saved mission report with xAI's Grok.
// Grok only explains; the pad decision always comes from the fixed mission rules in src/mission.js.
// Uses xAI's OpenAI-compatible chat completions API. Enabled only when XAI_API_KEY is set.

const XAI_URL = 'https://api.x.ai/v1/chat/completions';
const TIMEOUT_MS = 25000;
export const MAX_QUESTION = 300;
const MAX_ANSWER = 1200;

const SYSTEM = [
  'You are Mission Control for BaseScout, a NASA Space Apps Challenge project.',
  'BaseScout ranks real places on Earth by how closely their terrain matches a permanent base target on the Moon or Mars, using NASA LRO LOLA (Moon), NASA MGS MOLA (Mars) and SRTM (Earth) elevation data on a common 25 x 25 km, 500 m grid.',
  'A rover then rehearses the base-site survey at the Earth twin: it tests two candidate pads. Pad slopes are measured from the real elevation data; soil results are simulated demo values, never real measurements.',
  'Answer the visitor\'s question about the mission report below in at most four short sentences, for a general audience.',
  'Ground every fact in the report. If the report does not contain the answer, say so briefly, then add general, clearly labelled context about lunar or Martian base planning.',
  'Never change, second-guess or invent the recommendation, slopes or soil results. Plain text only: no markdown, lists or headings.',
].join(' ');

// Only the mission facts go to xAI: no telemetry, IDs or timestamps.
function missionFacts(report) {
  const { site, target, slopeLimit, order, tests, recommendation } = report;
  return { earthTestSite: site, baseTarget: target, slopeLimitDegrees: slopeLimit, padOrder: order, tests, recommendation: recommendation ?? 'none' };
}

export function cleanQuestion(input) {
  if (typeof input !== 'string') return null;
  const text = input.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length >= 3 && text.length <= MAX_QUESTION ? text : null;
}

export async function askGrok(report, question, { apiKey, model }) {
  const response = await fetch(XAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 600,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Mission report: ${JSON.stringify(missionFacts(report))}\n\nQuestion: ${question}` },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw Error(`xAI HTTP ${response.status}`);
  const body = await response.json();
  const text = body?.choices?.[0]?.message?.content?.trim();
  if (!text) throw Error('xAI returned no answer');
  return text.length > MAX_ANSWER ? `${text.slice(0, MAX_ANSWER - 1).trimEnd()}…` : text;
}
