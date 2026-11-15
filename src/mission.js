export const pads = {
  A: { x: -8, z: -6, slope: 3.2 },
  B: { x: 8, z: -6, slope: 5.6 },
};
export const start = { x: 0, z: 7 };
export const slopeLimit = 8;

export function nearPad(position, pad) {
  return Math.hypot(position.x - pad.x, position.z - pad.z) < 2;
}

export function soilDecision(target, outcome) {
  const passes = pads[target].slope <= slopeLimit && (target === 'B' || outcome === 'pass');
  if (passes) return { target, recommendation: target, message: `Recommend Pad ${target}. Slope and simulated soil both pass.` };
  if (target === 'A') return { target: 'B', recommendation: null, message: 'Pad A rejected. Drive to Pad B to run the backup soil test.' };
  return { target, recommendation: null, message: 'Pad B rejected. Neither pad qualifies.' };
}
