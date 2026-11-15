import { timingSafeEqual } from 'node:crypto';
import { soilDecision, pads, slopeLimit } from '../src/mission.js';
import { missionDebrief } from './debrief.js';
import { sendMissionAlert } from './notify.js';

export const missionIdPattern = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const pathPattern = new RegExp(`^/api/missions(?:/(?<id>${missionIdPattern}))?$`);
const headers = { 'Cache-Control': 'no-store' };

function reply(body, status = 200) {
  return Response.json(body, { status, headers });
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
    if (!data || typeof data.id !== 'string' || !new RegExp(`^${missionIdPattern}$`).test(data.id)
        || !['pass', 'fail'].includes(data.padASoil)) {
      return reply({ error: 'Expected a mission ID and a Pad A soil result of pass or fail.' }, 400);
    }
    const first = soilDecision('A', data.padASoil);
    const second = first.recommendation ? null : soilDecision('B', data.padASoil);
    const tests = [{ pad: 'A', slope: pads.A.slope, soil: data.padASoil }];
    if (second) tests.push({ pad: 'B', slope: pads.B.slope, soil: 'pass' });
    const report = { simulated: true, slopeLimit, tests, recommendation: second ? second.recommendation : first.recommendation };
    // Skip the Gemini call when this mission ID was already saved (e.g. a retried request).
    const { rows: [existing] } = await db.query('SELECT 1 FROM missions WHERE id = $1', [data.id]);
    if (!existing) report.debrief = await missionDebrief(report, gemini);
    await db.query('INSERT INTO missions (id, report) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [data.id, report]);
    const { rows: [saved] } = await db.query('SELECT id, created_at, report FROM missions WHERE id = $1', [data.id]);
    if (saved.report.tests[0].soil !== data.padASoil) return reply({ error: 'This mission ID already has a different result.' }, 409);
    if (!existing) sendMissionAlert(saved, twilio); // fire-and-forget; never delays or fails the save
    return reply(saved, 201);
  };
}
