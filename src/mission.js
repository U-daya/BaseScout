import { padSites } from './padSites.js';

// Pad slopes come from each site's real elevation data (scripts/pick_pads.py).
// x/z place the two pads in the 3D field; the field itself is a stylised scene.
export const defaultSite = 'mojave';
// Permanent-base targets the Earth rehearsal stands in for (terrain from NASA LOLA / MOLA).
export const baseTargets = {
  jezero: { name: 'Jezero Crater', planet: 'Mars' },
  shackleton: { name: 'Shackleton crater rim', planet: 'Moon' },
  malapert: { name: 'Malapert Massif', planet: 'Moon' },
};
export const defaultTarget = 'jezero';
export const siteIds = Object.keys(padSites);
export const slopeLimit = 8;
export const start = { x: 0, z: 7 };
const placement = { A: { x: -8, z: -6 }, B: { x: 8, z: -6 } };

export function siteName(siteId) {
  return padSites[siteId]?.name ?? siteId;
}

export function padsFor(siteId) {
  const site = padSites[siteId] ?? padSites[defaultSite];
  return { A: { ...placement.A, ...site.pads.A }, B: { ...placement.B, ...site.pads.B } };
}

export function nearPad(position, pad) {
  return Math.hypot(position.x - pad.x, position.z - pad.z) < 2;
}

export const padIds = ['A', 'B'];
export const newMission = () => ({ tests: [], recommendation: null, done: false,
  message: 'Drive into either pad ring and test its soil. If it fails, scout the other pad.' });

// Tests one pad (soil = simulated 'pass' or 'fail'). Pads can be tested in any order, each once.
// The first pad whose slope and soil both pass is recommended; if both fail, neither qualifies.
export function testPad(pads, mission, pad, soil) {
  if (mission.done || mission.tests.some(t => t.pad === pad)) return mission;
  const tests = [...mission.tests, { pad, slope: pads[pad].slope, soil }];
  const slopeOk = pads[pad].slope <= slopeLimit, soilOk = soil === 'pass';
  if (slopeOk && soilOk) return { tests, recommendation: pad, done: true, message: `Recommend Pad ${pad}. Slope and simulated soil both pass.` };
  const reason = !slopeOk ? `slope ${pads[pad].slope}° exceeds ${slopeLimit}°` : 'simulated soil failed';
  const other = padIds.find(id => !tests.some(t => t.pad === id));
  if (other) return { tests, recommendation: null, done: false, message: `Pad ${pad} rejected (${reason}). Drive to Pad ${other} to test it.` };
  return { tests, recommendation: null, done: true, message: `Pad ${pad} rejected (${reason}). Neither pad qualifies.` };
}

// Replays a mission from the pad order and soil results, so the server never trusts a client-made decision.
export function runMission(siteId, order, soils) {
  const pads = padsFor(siteId);
  let mission = newMission();
  for (const pad of order) mission = testPad(pads, mission, pad, soils[pad]);
  return { slopeLimit, order: mission.tests.map(t => t.pad), tests: mission.tests, recommendation: mission.recommendation };
}
