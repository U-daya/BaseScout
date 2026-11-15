import React, { useEffect, useRef } from 'react';

// Tiny sunlit planet: a procedural surface map wrapped on a sphere and shaded per pixel.
// Moon: highlands, dark maria and craters. Mars: rust plains, dark albedo regions, polar caps.

const TW = 256, TH = 128;
const textures = {};

function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
function hash(x, y, z) { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }
function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const s = t => t * t * (3 - 2 * t), u = s(xf), v = s(yf), w = s(zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz);
  return L(L(L(c(0,0,0), c(1,0,0), u), L(c(0,1,0), c(1,1,0), u), v), L(L(c(0,0,1), c(1,0,1), u), L(c(0,1,1), c(1,1,1), u), v), w);
}
function fbm(x, y, z, oct = 5) { let a = .5, f = 1, t = 0; for (let i = 0; i < oct; i++) { t += a * noise(x * f, y * f, z * f); a *= .5; f *= 2.03; } return t; }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function craters(seed, n, rMin, rMax) {
  const r = rng(seed), list = [];
  for (let i = 0; i < n; i++) {
    const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
    list.push({ x: s * Math.cos(a), y: z, z: s * Math.sin(a), r: rMin + (rMax - rMin) * Math.pow(r(), 2.2) });
  }
  return list;
}

function buildTexture(kind) {
  const tex = new Float32Array(TW * TH * 3);
  const pits = kind === 'moon' ? craters(7, 70, .03, .2) : craters(11, 18, .02, .09);
  for (let j = 0; j < TH; j++) {
    const lat = (.5 - (j + .5) / TH) * Math.PI;
    for (let i = 0; i < TW; i++) {
      const lon = ((i + .5) / TW) * Math.PI * 2;
      const x = Math.cos(lat) * Math.sin(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.cos(lon);
      let crater = 0;
      for (const c of pits) {
        const d = Math.acos(Math.min(1, x * c.x + y * c.y + z * c.z));
        if (d < c.r * 1.4) crater += d < c.r ? -.1 * (1 - d / c.r) : 0;
        crater += (kind === "moon" ? .075 : .1) * Math.exp(-(((d - c.r) / (c.r * .18)) ** 2));
      }
      let r, g, b;
      if (kind === 'moon') {
        const maria = smooth(.52, .66, fbm(x * 1.5 + 3, y * 1.5, z * 1.5, 4));
        const v = .56 + .16 * (fbm(x * 5, y * 5, z * 5) - .5) - .27 * maria + crater * (1 - maria * .6);
        r = v; g = v * .995; b = v * 1.02;
      } else {
        const dark = smooth(.5, .7, fbm(x * 1.7 + 9, y * 1.7, z * 1.7, 4));
        const h = fbm(x * 4, y * 4, z * 4);
        const k = (.82 + .36 * (h - .5)) + crater * .6;
        r = (.78 - .36 * dark) * k; g = (.43 - .21 * dark) * k; b = (.25 - .12 * dark) * k;
        const cap = smooth(.86, .92, Math.abs(y) + .05 * (fbm(x * 6, y * 6, z * 6) - .5));
        r += (.95 - r) * cap; g += (.93 - g) * cap; b += (.9 - b) * cap;
      }
      const o = (j * TW + i) * 3; tex[o] = r; tex[o + 1] = g; tex[o + 2] = b;
    }
  }
  return tex;
}

function sample(tex, u, v) {
  const x = ((u % 1) + 1) % 1 * TW - .5, y = Math.min(TH - 1, Math.max(0, v * TH - .5));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, y1 = Math.min(TH - 1, y0 + 1);
  const a = ((x0 % TW) + TW) % TW, b = (a + 1) % TW, out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const t = tex[(y0 * TW + a) * 3 + c] * (1 - fx) + tex[(y0 * TW + b) * 3 + c] * fx;
    const btm = tex[(y1 * TW + a) * 3 + c] * (1 - fx) + tex[(y1 * TW + b) * 3 + c] * fx;
    out[c] = t * (1 - fy) + btm * fy;
  }
  return out;
}

const SUN = (() => { const l = [-.55, .35, .76], n = Math.hypot(...l); return l.map(v => v / n); })();

function draw(ctx, size, tex, rot, kind) {
  const img = ctx.createImageData(size, size), d = img.data, R = size / 2 - (kind === 'mars' ? 1.5 : .5);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const nx = (px + .5 - size / 2) / R, ny = -(py + .5 - size / 2) / R, rr = nx * nx + ny * ny, o = (py * size + px) * 4;
      if (rr > 1) {
        if (kind === 'mars') { // thin dusty atmosphere on the lit limb
          const rad = Math.sqrt(rr), halo = Math.max(0, 1 - (rad - 1) * R / 1.6);
          const lit = Math.max(0, (nx * SUN[0] + ny * SUN[1]) / rad);
          const a = halo * lit * 120;
          if (a > 0) { d[o] = 255; d[o + 1] = 170; d[o + 2] = 120; d[o + 3] = a; }
        }
        continue;
      }
      const nz = Math.sqrt(1 - rr);
      const lon = Math.atan2(nx, nz) + rot, lat = Math.asin(ny);
      const c = sample(tex, lon / (Math.PI * 2), .5 - lat / Math.PI);
      const ndl = nx * SUN[0] + ny * SUN[1] + nz * SUN[2];
      const light = .035 + 1.05 * smooth(-.06, .45, ndl) * (kind === 'moon' ? 1 : .9 + .1 * nz);
      const edge = Math.min(1, (1 - Math.sqrt(rr)) * R * 1.2);
      d[o] = Math.min(255, c[0] * light * 255); d[o + 1] = Math.min(255, c[1] * light * 255); d[o + 2] = Math.min(255, c[2] * light * 255); d[o + 3] = 255 * edge;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export default function MiniPlanet({ kind, size = 26, period = kind === 'moon' ? 40 : 28 }) {
  const canvas = useRef(null);
  useEffect(() => {
    const el = canvas.current, ctx = el.getContext('2d');
    const px = Math.round(size * Math.min(2, window.devicePixelRatio || 1));
    el.width = el.height = px;
    textures[kind] ??= buildTexture(kind);
    const tex = textures[kind], still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let frame = 0, last = 0, start = performance.now() - Math.random() * period * 1000;
    const tick = now => {
      if (now - last > 33) { last = now; draw(ctx, px, tex, ((now - start) / 1000 / period) * Math.PI * 2, kind); }
      if (!still) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [kind, size, period]);
  return <canvas ref={canvas} className={`mini-planet ${kind}`} style={{ width: size, height: size }} aria-hidden="true"/>;
}
