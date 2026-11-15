import React from 'react';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { pads, start, nearPad } from './mission';

function box(group, color, size, position) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: .42, metalness: .15 }));
  mesh.position.set(...position);
  group.add(mesh);
  return mesh;
}

const keysByAxis = { KeyW: [0,1], ArrowUp: [0,1], KeyS: [0,-1], ArrowDown: [0,-1], KeyA: [-1,0], ArrowLeft: [-1,0], KeyD: [1,0], ArrowRight: [1,0] };
const ROVER_LENGTH = 1.8;
const MAX_SPEED = 6;
const HAZE = '#c9c3b9';

// Model tuning: "scale,rotX,rotY,rotZ,lift" (degrees for rotations). Set VITE_ROVER_MODEL_TUNE in .env.local.
export const defaultTune = { scale: 1, rotX: 0, rotY: 0, rotZ: 0, lift: 0 };
export function parseTune(text) {
  const [scale, rotX, rotY, rotZ, lift] = String(text ?? '').split(',').map(Number);
  const tune = { scale, rotX, rotY, rotZ, lift };
  for (const key of Object.keys(defaultTune)) if (!Number.isFinite(tune[key])) tune[key] = defaultTune[key];
  if (tune.scale <= 0) tune.scale = 1;
  return tune;
}
export const formatTune = t => [t.scale, t.rotX, t.rotY, t.rotZ, t.lift].map(n => +n.toFixed(3)).join(',');

// Each pad is a flat plane tilted by its slope. The second value is the downhill direction (x, z).
const padTilt = { A: [1, 0], B: [0, 1] };
const padPlane = (name, x, z) => {
  const pad = pads[name], [dx, dz] = padTilt[name];
  return Math.tan(THREE.MathUtils.degToRad(pad.slope)) * ((x - pad.x) * dx + (z - pad.z) * dz);
};

function mulberry32(seed) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Smooth value noise on a 256-cell lattice (wraps every 256 units, so power-of-two periods tile).
function valueNoise(seed) {
  const random = mulberry32(seed), grid = new Float32Array(65536);
  for (let i = 0; i < grid.length; i++) grid[i] = random();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const r0 = (yi & 255) << 8, r1 = ((yi + 1) & 255) << 8, c0 = xi & 255, c1 = (xi + 1) & 255;
    const a = grid[r0 | c0], b = grid[r0 | c1], c = grid[r1 | c0], d = grid[r1 | c1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
function fbm(noise, x, y, octaves) {
  let sum = 0, amplitude = .5, frequency = 1;
  for (let o = 0; o < octaves; o++) { sum += amplitude * noise(x * frequency, y * frequency); amplitude *= .5; frequency *= 2; }
  return sum;
}
const smooth = (a, b, v) => { const t = THREE.MathUtils.clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const terrainNoise = valueNoise(7);

// Simulated ground height in metres. Rolling desert floor, low hills past the drive area, mesas on the horizon, tilted flats at the pads.
export function groundHeight(x, z) {
  let h = Math.sin(x*.21 + z*.13)*.5 + Math.sin(x*.47 - z*.31)*.2 + Math.sin(x*1.3 + z*1.1)*.045 + Math.cos(z*.9 - x*.6)*.06;
  h += (fbm(terrainNoise, x*.3 + 40, z*.3 + 40, 3) - .44) * .22;
  const edge = Math.max(0, (Math.abs(x) - 14) / 6) + Math.max(0, (Math.abs(z) - 10.5) / 6);
  h += 3.2 * (1 - Math.exp(-edge * edge * .6)) * (.65 + .35 * Math.sin(x*.8 + z*.5));
  const r = Math.hypot(x, z * 1.15);
  if (r > 42) {
    const m = fbm(terrainNoise, x*.014 + 9, z*.014 + 3, 4);
    h += smooth(42, 75, r) * (smooth(.47, .53, m) * 16 + smooth(.56, .6, m) * 9 + (m - .4) * 10);
  }
  for (const name of Object.keys(pads)) {
    const d = Math.hypot(x - pads[name].x, z - pads[name].z);
    if (d < 5) {
      const t = THREE.MathUtils.clamp((d - 2.8) / 2.2, 0, 1);
      const s = t * t * (3 - 2 * t);
      h = padPlane(name, x, z) * (1 - s) + h * s;
    }
  }
  return h;
}

function groundNormal(x, z, out) {
  const e = .35;
  return out.set(groundHeight(x - e, z) - groundHeight(x + e, z), 2 * e, groundHeight(x, z - e) - groundHeight(x, z + e)).normalize();
}

// Procedural soil: tileable albedo + normal map built from fractal noise (no image downloads).
function soilTextures(size, anisotropy) {
  const noise = valueNoise(31), speck = valueNoise(77);
  const height = new Float32Array(size * size);
  const albedo = new ImageData(size, size), normal = new ImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const broad = fbm(noise, u * 8, v * 8, 6);
    const grit = speck(u * 256, v * 256);
    const pebble = smooth(.78, .9, fbm(speck, u * 64 + 5, v * 64 + 5, 2) * 1.6);
    height[y * size + x] = broad * 1.2 + grit * .1 + pebble * .5;
    const shade = .62 + broad * .62 + (grit - .5) * .16 - pebble * .12;
    const warm = fbm(noise, u * 4 + 17, v * 4 + 17, 3);
    const i = (y * size + x) * 4;
    albedo.data[i] = 255 * Math.min(1, shade * (.62 + warm * .1));
    albedo.data[i + 1] = 255 * Math.min(1, shade * (.44 + warm * .05));
    albedo.data[i + 2] = 255 * Math.min(1, shade * (.31 - warm * .03));
    albedo.data[i + 3] = 255;
  }
  const at = (x, y) => height[((y + size) % size) * size + (x + size) % size];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = (at(x - 1, y) - at(x + 1, y)) * 2.6, ny = (at(x, y - 1) - at(x, y + 1)) * 2.6;
    const length = Math.hypot(nx, ny, 1), i = (y * size + x) * 4;
    normal.data[i] = 127.5 * (nx / length + 1);
    normal.data[i + 1] = 127.5 * (ny / length + 1);
    normal.data[i + 2] = 127.5 * (1 / length + 1);
    normal.data[i + 3] = 255;
  }
  return [albedo, normal].map((image, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    canvas.getContext('2d').putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
    if (index === 0) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

const signed = (value, digits = 1) => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(digits).padStart(digits + 3, '0')}`;
const clock = seconds => [seconds / 3600, seconds / 60 % 60, seconds % 60].map(n => String(Math.floor(n)).padStart(2, '0')).join(':');

export default function Scene({ target, recommendation, joystick, onArrival, paused, locked, modelUrl, tune, showBounds, onModelStatus }) {
  const mount = useRef(null);
  const state = useRef({});
  const loader = useRef(null);
  state.current = { target, recommendation, joystick, onArrival, paused, locked, tune, showBounds, onModelStatus };
  const [error, setError] = useState(false);
  useEffect(() => {
    const host = mount.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { setError(true); return; }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .4;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(HAZE, 70, 380);
    const camera = new THREE.PerspectiveCamera(40, 1.6, .1, 1500);
    host.append(renderer.domElement);
    const resize = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = host;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.fov = w / h < 1.2 ? 52 : 40;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resize.observe(host);

    // Physical sky; the same sky lights the scene through an environment map.
    const sunDirection = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(56), THREE.MathUtils.degToRad(-58));
    const sky = new Sky();
    sky.scale.setScalar(1000);
    sky.material.uniforms.turbidity.value = 4.5;
    sky.material.uniforms.rayleigh.value = 1.3;
    sky.material.uniforms.mieCoefficient.value = .004;
    sky.material.uniforms.mieDirectionalG.value = .82;
    sky.material.uniforms.sunPosition.value.copy(sunDirection);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyOnly = new THREE.Scene();
    skyOnly.add(sky);
    const environment = pmrem.fromScene(skyOnly);
    pmrem.dispose();
    scene.environment = environment.texture;
    scene.environmentIntensity = .9;
    scene.add(sky);
    const sun = new THREE.DirectionalLight('#fff1dc', 5.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 140 });
    sun.shadow.bias = -.0004;
    sun.shadow.normalBias = .04;
    scene.add(sun, sun.target);
    const [soilMap, soilNormal] = soilTextures(1024, renderer.capabilities.getMaxAnisotropy());

    // Ground
    // One grid, dense under the rover (about 0.2 m) and stretched toward the horizon.
    const ground = new THREE.PlaneGeometry(2, 2, 320, 320);
    ground.rotateX(-Math.PI / 2);
    const points = ground.attributes.position, uvs = ground.attributes.uv;
    const colors = [];
    const tint = new THREE.Color();
    const spread = u => 32 * u + 420 * u ** 5;
    for (let i = 0; i < points.count; i++) {
      const x = spread(points.getX(i)), z = spread(points.getZ(i));
      const y = groundHeight(x, z);
      points.setXYZ(i, x, y, z);
      uvs.setXY(i, x / 6.5, z / 6.5);
      const patch = fbm(terrainNoise, x * .06 + 70, z * .06 + 70, 4);
      const strata = y > 2.5 ? .5 + .5 * Math.sin(y * 1.9 + patch * 3) : .5;
      const light = .78 + patch * .5 + (strata - .5) * .28;
      tint.setRGB(light * (1.02 + (strata - .5) * .12), light * (.98 - (patch - .5) * .1), light * (.94 - (strata - .5) * .16));
      colors.push(tint.r, tint.g, tint.b);
    }
    ground.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    ground.computeVertexNormals();
    ground.computeBoundingSphere();
    const groundMesh = new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ map: soilMap, normalMap: soilNormal, normalScale: new THREE.Vector2(1, 1), vertexColors: true, roughness: .96, metalness: 0 }));
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    // Rocks: pebbles inside the drive area, boulders outside it
    const random = mulberry32(20261114);
    const rockCount = 520;
    // Rock shape: a welded sphere pushed around by fractal noise, smooth-shaded.
    const rockBase = new THREE.IcosahedronGeometry(1, 3);
    rockBase.deleteAttribute('normal');
    rockBase.deleteAttribute('uv');
    const rockGeometry = mergeVertices(rockBase);
    const rockPoints = rockGeometry.attributes.position;
    const rockUv = [];
    for (let i = 0; i < rockPoints.count; i++) {
      const x = rockPoints.getX(i), y = rockPoints.getY(i), z = rockPoints.getZ(i);
      const bump = .72 + .75 * fbm(terrainNoise, x * 1.4 + y * .9 + 20, z * 1.4 - y * .7 + 20, 4);
      rockPoints.setXYZ(i, x * bump, y * bump, z * bump);
      rockUv.push(Math.atan2(z, x) / 3.1416 * 1.5, y * .75);
    }
    rockGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(rockUv, 2));
    rockGeometry.computeVertexNormals();
    const rocks = new THREE.InstancedMesh(rockGeometry, new THREE.MeshStandardMaterial({ map: soilMap, normalMap: soilNormal, normalScale: new THREE.Vector2(1.6, 1.6), roughness: .9 }), rockCount);
    rocks.castShadow = rocks.receiveShadow = true;
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(), euler = new THREE.Euler();
    let placed = 0;
    while (placed < rockCount) {
      const x = (random() - .5) * 120, z = (random() - .5) * 100 - 8;
      const inside = Math.abs(x) < 16 && Math.abs(z) < 12;
      const size = inside ? .04 + random() * .09 : .12 + random() * random() * 1.3;
      if (Object.values(pads).some(pad => Math.hypot(x - pad.x, z - pad.z) < 2.8) || Math.hypot(x - start.x, z - start.z) < 1.6) { random(); continue; }
      position.set(x, groundHeight(x, z) + size * .12, z);
      quaternion.setFromEuler(euler.set(random() * 6.28, random() * 6.28, random() * 6.28));
      scale.set(size * (.7 + random() * .6), size * (.45 + random() * .4), size * (.7 + random() * .6));
      rocks.setMatrixAt(placed, matrix.compose(position, quaternion, scale));
      rocks.setColorAt(placed, tint.setHSL(.05 + random() * .03, .12 + random() * .14, .5 + random() * .3));
      placed++;
    }
    scene.add(rocks);

    // Pads
    const up = new THREE.Vector3(0, 1, 0);
    const rings = {};
    const labels = {};
    for (const [name, pad] of Object.entries(pads)) {
      const [dx, dz] = padTilt[name];
      const grade = Math.tan(THREE.MathUtils.degToRad(pad.slope));
      const normal = new THREE.Vector3(-grade * dx, 1, -grade * dz).normalize();
      const disk = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, .1, 64), new THREE.MeshStandardMaterial({ map: soilMap, normalMap: soilNormal, color: '#8f8378', roughness: .85 }));
      disk.quaternion.setFromUnitVectors(up, normal);
      disk.position.set(pad.x, .04, pad.z);
      disk.receiveShadow = true;
      scene.add(disk);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.04, .035, 8, 128), new THREE.MeshBasicMaterial({ toneMapped: false }));
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      ring.position.set(pad.x, .12, pad.z);
      scene.add(ring);
      rings[name] = ring;
      const label = document.createElement('span');
      label.className = 'pad-label';
      label.textContent = `PAD ${name} · ${pad.slope}°`;
      host.append(label);
      labels[name] = label;
    }

    // Rover
    const rover = new THREE.Group();
    rover.position.set(start.x, groundHeight(start.x, start.z), start.z);
    scene.add(rover);
    const placeholder = new THREE.Group();
    rover.add(placeholder);
    box(placeholder, '#b9b4a8', [1.35, .35, 1.8], [0, .55, 0]);
    box(placeholder, '#c9c6be', [.85, .45, 1.03], [0, .78, .04]);
    box(placeholder, '#8d8a84', [.13, .63, .13], [0, 1.1, -.38]);
    box(placeholder, '#c9c6be', [.48, .24, .29], [0, 1.47, -.44]);
    box(placeholder, '#10181d', [.38, .1, .025], [0, 1.47, -.60]);
    const wheels = [];
    for (const x of [-.76, .76]) for (const z of [-.66, 0, .66]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, .28, 28), new THREE.MeshStandardMaterial({ color: '#1f1e20', roughness: .85, normalMap: soilNormal }));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, .31, z);
      placeholder.add(wheel);
      wheels.push(wheel);
    }
    placeholder.traverse(o => { if (o.isMesh) o.castShadow = true; });

    // Wheel tracks
    const MAX_TRACKS = 700;
    const trackGeometry = new THREE.PlaneGeometry(.2, .34);
    trackGeometry.rotateX(-Math.PI / 2);
    const tracks = new THREE.InstancedMesh(trackGeometry, new THREE.MeshBasicMaterial({ color: '#2a1810', transparent: true, opacity: .26, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), MAX_TRACKS);
    tracks.count = 0;
    tracks.frustumCulled = false;
    scene.add(tracks);
    let trackIndex = 0, sinceTrack = 0;

    // CAD model: rover > fit (scale + position) > spin (rotation) > model
    const fit = new THREE.Group();
    const spin = new THREE.Group();
    fit.add(spin);
    rover.add(fit);
    const bounds = new THREE.Box3Helper(new THREE.Box3(), '#9fefb8');
    bounds.visible = false;
    rover.add(bounds);
    let model = null;
    let appliedTune = '';
    let active = true;
    let generation = 0;
    const status = s => state.current.onModelStatus?.(s);
    const savedPose = new THREE.Quaternion(), savedPosition = new THREE.Vector3();

    // Measure the model with the rover upright at the origin so heading and terrain tilt do not skew the fit.
    function applyTune(t) {
      if (!model) return;
      savedPose.copy(rover.quaternion);
      savedPosition.copy(rover.position);
      rover.quaternion.identity();
      rover.position.set(0, 0, 0);
      spin.rotation.set(THREE.MathUtils.degToRad(t.rotX), THREE.MathUtils.degToRad(t.rotY), THREE.MathUtils.degToRad(t.rotZ));
      fit.scale.setScalar(1);
      fit.position.set(0, 0, 0);
      rover.updateMatrixWorld(true);
      const raw = new THREE.Box3().setFromObject(spin);
      const size = raw.getSize(new THREE.Vector3());
      const factor = ROVER_LENGTH * t.scale / Math.max(size.x, size.z);
      if (Number.isFinite(factor) && factor > 0) {
        fit.scale.setScalar(factor);
        rover.updateMatrixWorld(true);
        const fitted = new THREE.Box3().setFromObject(spin);
        const center = fitted.getCenter(new THREE.Vector3());
        fit.position.set(-center.x, -fitted.min.y + t.lift, -center.z);
        rover.updateMatrixWorld(true);
        bounds.box.setFromObject(spin);
      }
      rover.quaternion.copy(savedPose);
      rover.position.copy(savedPosition);
    }

    function clearModel() {
      if (model) { spin.remove(model); dispose(model); model = null; }
      placeholder.visible = true;
      appliedTune = '';
    }

    const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    loader.current = (url, label) => {
      const mine = ++generation;
      clearModel();
      if (!url) { status({ state: 'none' }); return; }
      status({ state: 'loading', progress: 0, label });
      gltf.load(url, ({ scene: loaded }) => {
        if (!active || mine !== generation) { dispose(loaded); return; }
        let meshes = 0, triangles = 0;
        loaded.traverse(o => { if (o.isMesh) { o.castShadow = true; meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; } });
        model = loaded;
        spin.add(model);
        placeholder.visible = false;
        applyTune(state.current.tune ?? defaultTune);
        appliedTune = JSON.stringify(state.current.tune ?? defaultTune);
        status({ state: 'ready', label, meshes, triangles: Math.round(triangles) });
      }, event => {
        if (mine !== generation) return;
        status({ state: 'loading', label, progress: event.total ? event.loaded / event.total : null, loaded: event.loaded });
      }, failure => {
        if (mine !== generation) return;
        console.warn('Rover model could not be loaded.', failure);
        clearModel();
        status({ state: 'error', label, message: 'Could not load this model. Check the path and that it is a .glb/.gltf file. The placeholder rover is shown.' });
      });
    };

    // Camera-feed readouts
    const hud = name => { const el = document.createElement('div'); el.className = `hud ${name}`; host.append(el); return el; };
    const hudTitle = hud('tl'), hudClock = hud('tr'), hudPose = hud('bl'), hudTarget = hud('br');
    hudTitle.textContent = 'SIM · HANKSVILLE TEST FIELD\nNAV CAM · 1 UNIT = 1 M';

    const keys = new Set();
    const clear = () => keys.clear();
    const keydown = (event) => {
      if (!keysByAxis[event.code] || event.ctrlKey || event.altKey || event.metaKey ||
          event.target.closest?.('input, select, textarea, [contenteditable]')) return;
      event.preventDefault();
      keys.add(event.code);
    };
    const keyup = event => keys.delete(event.code);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);

    const input = new THREE.Vector2(), velocity = new THREE.Vector2();
    const marker = new THREE.Vector3(), normal = new THREE.Vector3(), tilt = new THREE.Quaternion(), turn = new THREE.Quaternion();
    const look = new THREE.Vector3(rover.position.x * .72, .6, rover.position.z * .72 - 2);
    const wanted = new THREE.Vector3();
    const CAMERA_OFFSET = new THREE.Vector3(0, 8.2, 17.5);
    camera.position.copy(look).add(CAMERA_OFFSET);
    camera.lookAt(look);
    let heading = 0, lastTime = 0, elapsed = 0, hudAt = -1, previousArrival, source = 'IDLE';

    renderer.setAnimationLoop(time => {
      const real = lastTime ? (time - lastTime) / 1000 : 0;
      const dt = Math.min(real, .05);
      lastTime = time;
      const { target, recommendation, joystick, onArrival, paused, locked, tune, showBounds } = state.current;
      if (paused) { clear(); return; }
      elapsed += Math.min(real, 1);
      const tuneKey = JSON.stringify(tune ?? defaultTune);
      if (model && tuneKey !== appliedTune) { applyTune(tune ?? defaultTune); appliedTune = tuneKey; }
      bounds.visible = !!(model && showBounds);

      input.set(0, 0);
      source = 'IDLE';
      if (locked) {
        source = 'HOLD · SAMPLING';
      } else if (keys.size) {
        for (const key of keys) { input.x += keysByAxis[key][0]; input.y += keysByAxis[key][1]; }
        input.set(Math.sign(input.x), Math.sign(input.y));
        source = 'KEYBOARD';
      } else if (performance.now() - joystick.current.received < 1000) {
        input.set(joystick.current.x, joystick.current.y);
        if (input.length() < .12) input.set(0, 0); else source = 'JOYSTICK';
      }
      input.clampLength(0, 1);

      // Ease toward the commanded velocity so starts and stops have weight.
      const ease = 1 - Math.exp(-dt * (input.lengthSq() ? 5 : 8));
      velocity.x += (input.x * MAX_SPEED - velocity.x) * ease;
      velocity.y += (input.y * MAX_SPEED - velocity.y) * ease;
      const speed = velocity.length();
      if (speed > .02) {
        const step = speed * dt;
        rover.position.x = THREE.MathUtils.clamp(rover.position.x + velocity.x * dt, -15, 15);
        rover.position.z = THREE.MathUtils.clamp(rover.position.z - velocity.y * dt, -11, 11);
        if (input.lengthSq()) {
          const goal = Math.atan2(-input.x, input.y);
          const delta = Math.atan2(Math.sin(goal - heading), Math.cos(goal - heading));
          heading += delta * (1 - Math.exp(-dt * 9));
        }
        for (const wheel of wheels) wheel.rotation.x -= step / .3;
        sinceTrack += step;
      } else {
        velocity.set(0, 0);
      }
      rover.position.y = groundHeight(rover.position.x, rover.position.z);
      groundNormal(rover.position.x, rover.position.z, normal);
      tilt.setFromUnitVectors(up, normal);
      turn.setFromAxisAngle(up, heading);
      rover.quaternion.copy(tilt).multiply(turn);

      if (sinceTrack > .3) {
        sinceTrack = 0;
        for (const side of [-.66, .66]) {
          position.set(side, .03, .2).applyQuaternion(rover.quaternion).add(rover.position);
          tracks.setMatrixAt(trackIndex % MAX_TRACKS, matrix.compose(position, rover.quaternion, scale.set(1, 1, 1)));
          trackIndex++;
        }
        tracks.count = Math.min(trackIndex, MAX_TRACKS);
        tracks.instanceMatrix.needsUpdate = true;
      }

      // Camera drifts after the rover while keeping both pads in frame.
      wanted.set(rover.position.x * .72, .6, rover.position.z * .72 - 2);
      look.lerp(wanted, 1 - Math.exp(-dt * 2.2));
      camera.position.copy(look).add(CAMERA_OFFSET);
      camera.lookAt(look);
      sun.target.position.copy(look);
      sun.position.copy(look).addScaledVector(sunDirection, 60);

      const arrived = nearPad(rover.position, pads[target]);
      if (previousArrival !== arrived) { previousArrival = arrived; onArrival(arrived); }
      for (const [id, pad] of Object.entries(pads)) {
        const color = id === recommendation ? '#8fe6aa' : id === target ? '#ffb86b' : '#c9d3dc';
        rings[id].material.color.set(color);
        rings[id].scale.setScalar(locked && id === target ? 1 + .035 * Math.sin(time / 110) : 1);
        marker.set(pad.x, .4, pad.z - 2.7).project(camera);
        labels[id].style.display = marker.z > 1 ? 'none' : '';
        labels[id].style.left = `${(marker.x + 1) * 50}%`;
        labels[id].style.top = `${(1 - marker.y) * 50}%`;
        labels[id].style.color = color;
      }

      if (time - hudAt > 100) {
        hudAt = time;
        const pad = pads[target];
        const range = Math.hypot(rover.position.x - pad.x, rover.position.z - pad.z);
        const compass = ((THREE.MathUtils.radToDeg(-heading) % 360) + 360) % 360;
        const slope = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, normal.y)));
        hudClock.textContent = `MET ${clock(elapsed)}\nINPUT ${source}`;
        hudPose.textContent = `E ${signed(rover.position.x)} m   N ${signed(-rover.position.z)} m\nHDG ${String(Math.round(compass) % 360).padStart(3, '0')}°   SPD ${speed.toFixed(1)} m/s`;
        hudTarget.textContent = recommendation
          ? `SITE SELECTED · PAD ${recommendation}\nGROUND SLOPE ${slope.toFixed(1)}°`
          : `TARGET PAD ${target} · RANGE ${range.toFixed(1)} m${arrived ? ' · IN RING' : ''}\nGROUND SLOPE ${slope.toFixed(1)}°`;
      }
      renderer.render(scene, camera);
    });
    return () => {
      active = false;
      loader.current = null;
      resize.disconnect();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', clear);
      renderer.setAnimationLoop(null);
      environment.dispose();
      dispose(scene);
      renderer.dispose();
      host.replaceChildren();
    };
  }, []);

  useEffect(() => { loader.current?.(modelUrl?.url, modelUrl?.label); }, [modelUrl]);

  return <div className="scene" ref={mount} aria-label="3D rover scouting field">{error && <p>WebGL is unavailable. Enable graphics acceleration or try another browser.</p>}</div>;
}

function dispose(group) {
  group.traverse(object => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials.filter(Boolean)) {
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose();
    }
  });
}
