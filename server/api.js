import { timingSafeEqual } from 'node:crypto';
import { runMission, siteIds, siteName, baseTargets } from '../src/mission.js';
import { missionDebrief } from './debrief.js';
import { sendMissionAlert } from './notify.js';

export const missionIdPattern = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const pathPattern = new RegExp(`^/api/missions(?:/(?<id>${missionIdPattern}))?$`);
const headers = { 'Cache-Control': 'no-store' };

function reply(body, status = 200) {
  return Response.json(body, { status, headers });
}

// Live Earth demo readings sent with the save. Unknown, non-numeric or out-of-range values become null.
const TELEMETRY_LIMITS = { temp_c: [-60, 100], pressure_hpa: [300, 1200], light: [0, 65535], air_quality: [0, 65535], uv: [0, 100] };
export function cleanTelemetry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  for (const [key, [min, max]] of Object.entries(TELEMETRY_LIMITS)) {
    const value = input[key];
    out[key] = typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? Math.round(value * 100) / 100 : null;
  }
  if (Object.values(out).every(value => value === null)) return null;
  const time = typeof input.timestamp === 'string' && input.timestamp.length <= 40 ? Date.parse(input.timestamp) : NaN;
  out.timestamp = Number.isFinite(time) ? new Date(time).toISOString() : null;
  out.source = 'Raspberry Pi 5 · Grove sensors';
  return out;
}

function authorized(request, token) {
  if (!token) return true;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function missionApi(db, token, gemini = {}, twilio = null) {
  return async request => {
    const route = new URL(request.url).pathname.match(pathPattern);
    if (!route) return reply({ error: 'Route not found.' }, 404);
    if (!authorized(request, token)) return reply({ error: 'Unauthorized.' }, 401);
    const { id } = route.groups;
    if (id && request.method === 'GET') {
      const { rows: [row] } = await db.query('SELECT id, created_at, report FROM missions WHERE id = $1', [id]);
      return row ? reply(row) : reply({ error: 'Mission report not found.' }, 404);
    }
    if (id || request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);

    let data;
    try { data = await request.json(); }
    catch { return reply({ error: 'Expected JSON.' }, 400); }
    // Older clients send only Pad A's result (Pad A first, Pad B passes) and ran Hanksville.
    const siteId = data?.siteId ?? 'utah';
    const targetId = data?.targetId ?? 'jezero';
    const order = Array.isArray(data?.order) ? data.order : ['A', 'B'];
    const soils = { A: data?.padASoil, B: data?.padBSoil ?? (Array.isArray(data?.order) ? undefined : 'pass') };
    const validOrder = order.length >= 1 && order.length <= 2 && new Set(order).size === order.length && order.every(p => p === 'A' || p === 'B');
    if (!data || typeof data.id !== 'string' || !new RegExp(`^${missionIdPattern}$`).test(data.id) || !siteIds.includes(siteId) || !Object.hasOwn(baseTargets, targetId)
        || !validOrder || !order.every(p => ['pass', 'fail'].includes(soils[p]))) {
      return reply({ error: 'Expected a mission ID, a known test site, the pad order, and soil results of pass or fail.' }, 400);
    }
    const report = { simulated: true, siteId, site: siteName(siteId), target: { id: targetId, ...baseTargets[targetId] }, ...runMission(siteId, order, soils) };
    const telemetry = cleanTelemetry(data.telemetry);
    // Skip the Gemini call when this mission ID was already saved (e.g. a retried request).
    const { rows: [existing] } = await db.query('SELECT 1 FROM missions WHERE id = $1', [data.id]);
    if (!existing) report.debrief = await missionDebrief(report, gemini); // decision only; sensor readings are not sent to Gemini
    if (telemetry) report.telemetry = telemetry;
    await db.query('INSERT INTO missions (id, report) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [data.id, report]);
    const { rows: [saved] } = await db.query('SELECT id, created_at, report FROM missions WHERE id = $1', [data.id]);
    // jsonb reorders object keys, so compare the test fields explicitly rather than JSON text.
    const testKey = tests => JSON.stringify((tests ?? []).map(t => [t.pad, t.slope, t.soil]));
    if (testKey(saved.report.tests) !== testKey(report.tests)) return reply({ error: 'This mission ID already has a different result.' }, 409);
    if (!existing) sendMissionAlert(saved, twilio); // fire-and-forget; never delays or fails the save
    return reply(saved, 201);
  };
}
