// Knowwhere landing page: scroll story (Moon and Mars targets, Earth twins, Perseverance).
// Rover model: NASA/JPL-Caltech Perseverance (NASA 3D Resources), compressed with gltf-transform.
// Lighting: "Goegap" HDRI by Poly Haven (CC0).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x09090a);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = .55;
const camera = new THREE.PerspectiveCamera(30, 1, .05, 200);

const key = new THREE.DirectionalLight(0xfff0dc, 3.4); key.position.set(4, 7, 3); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: .5, far: 30 }); key.shadow.bias = -.0004; key.shadow.normalBias = .02;
scene.add(key);
const rim = new THREE.DirectionalLight(0xffb36b, 3.0); rim.position.set(-6, 4, -5); scene.add(rim);
const rim2 = new THREE.DirectionalLight(0xbcd2ff, 1.1); rim2.position.set(6, 2.5, -6); scene.add(rim2);
const fill = new THREE.DirectionalLight(0x9fb4ff, .35); fill.position.set(-3, 1, 5); scene.add(fill);

// ---- Act 1: particle planet -> Jezero -> Askja (Mars twin) -> Shackleton -> Mauna Kea (Moon twin) ----
const PN = 26000, PG = 160;
const relP = r => r <= 149 ? Math.max(0, (r - 61) / 88) * .5 : .5 + Math.min(1, (r - 149) / 94) * .5;
const loadH = src => new Promise(res => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = c.height = PG; const x = c.getContext('2d'); x.drawImage(im, 0, 0, PG, PG); const d = x.getImageData(0, 0, PG, PG).data; const h = new Float32Array(PG * PG); for (let i = 0; i < h.length; i++) h[i] = relP(d[i * 4]); res(h); }; im.src = src; });
const TERRAINS = [['jezero', 1.141], ['askja', .878], ['shackleton', 4.577], ['maunakea', 2.946]];
const HMAPS = await Promise.all(TERRAINS.map(([id]) => loadH(`/terrain/${id}.png`)));
const pSphere = new Float32Array(PN * 3), pSeed = new Float32Array(PN);
const pT = TERRAINS.map(() => new Float32Array(PN * 3)), pH = TERRAINS.map(() => new Float32Array(PN));
for (let i = 0; i < PN; i++) {
  const y = 1 - 2 * (i + .5) / PN, r = Math.sqrt(1 - y * y), th = i * 2.399963, n = .9 + .1 * Math.sin(th * 3.1 + y * 7) * Math.cos(y * 5.3);
  pSphere.set([Math.cos(th) * r * 9 * n, y * 9 * n, Math.sin(th) * r * 9 * n], i * 3);
  const gx = Math.random() * (PG - 1), gz = Math.random() * (PG - 1), k = (gz | 0) * PG + (gx | 0), x = (gx / (PG - 1) - .5) * 22, z = (gz / (PG - 1) - .5) * 22;
  TERRAINS.forEach(([, km], t) => { const h = HMAPS[t][k]; pH[t][i] = h; pT[t].set([x, h * Math.min(km * 3.6, 6.5) - 1.5, z], i * 3); });
  pSeed[i] = Math.random();
}
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pSphere, 3)); pGeo.setAttribute('aSeed', new THREE.BufferAttribute(pSeed, 1));
pT.forEach((arr, t) => { pGeo.setAttribute('aT' + t, new THREE.BufferAttribute(arr, 3)); pGeo.setAttribute('aH' + t, new THREE.BufferAttribute(pH[t], 1)); });
const VERT = [
  'attribute vec3 aT0;attribute vec3 aT1;attribute vec3 aT2;attribute vec3 aT3;attribute float aH0;attribute float aH1;attribute float aH2;attribute float aH3;attribute float aSeed;',
  'uniform float uA;uniform float uB;uniform float uC;uniform float uD;uniform float uTime;uniform float uPx;uniform float uFade;varying vec3 vCol;varying float vAlpha;uniform vec4 uMask0;uniform vec4 uMask1;uniform float uFeather;uniform float uGap;uniform vec2 uRes;',
  // Push particles sideways out of a text card's screen box (px, y up), squeezing them into a band beside it.
  'vec2 part(vec2 q,vec4 m,inout float dim){float D=(m.z-m.x)*.5;if(D<=0.)return q;float dy=max(m.y-q.y,q.y-m.w);float wy=1.-smoothstep(0.,uFeather,dy);if(wy<=0.)return q;bool l=q.x<(m.x+m.z)*.5;float s=l?m.x-q.x:q.x-m.z;if(s>=uFeather)return q;float k=(uFeather-uGap)/(D+uFeather);float s2=uGap+(s+D)*k;float sf=mix(s,s2,wy);dim*=mix(1.,min(1.,k*2.2),wy);q.x=l?m.x-sf:m.z+sf;return q;}',
  'float ease(float t){return t<.5?4.*t*t*t:1.-pow(-2.*t+2.,3.)/2.;}',
  'float stage(float u){return ease(clamp(u*1.35-aSeed*.35,0.,1.));}',
  'void main(){float a=stage(uA),b=stage(uB),c=stage(uC),d=stage(uD);',
  'vec3 p=mix(position,aT0,a);p=mix(p,aT1,b);p=mix(p,aT2,c);p=mix(p,aT3,d);',
  'float burst=sin(3.14159*a)*(1.-b)+sin(3.14159*b)*(1.-c)+sin(3.14159*c)*(1.-d)+sin(3.14159*d);',
  'vec3 sw=vec3(sin(aSeed*40.+uTime*.7),cos(aSeed*31.+uTime*.6),sin(aSeed*23.-uTime*.5));p+=sw*burst*2.2;',
  'vec3 mars=mix(vec3(.45,.16,.09),vec3(1.,.62,.38),mix(.55+.45*sin(aSeed*12.),aH0,a));',
  'vec3 askja=mix(vec3(.32,.31,.33),vec3(.86,.82,.76),aH1);vec3 moon=mix(vec3(.28,.28,.3),vec3(.92,.92,.95),aH2);vec3 kea=mix(vec3(.42,.2,.14),vec3(1.,.74,.56),aH3);',
  'vec3 col=mix(mars,askja,b);col=mix(col,moon,c);col=mix(col,kea,d);vCol=col;',
  'vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=uPx*(1.6+aSeed*1.6)*(26./-mv.z);vAlpha=(.55+.45*aSeed)*uFade;if(gl_Position.w>0.){vec2 q=(gl_Position.xy/gl_Position.w*.5+.5)*uRes;float dim=1.;q=part(q,uMask0,dim);q=part(q,uMask1,dim);gl_Position.xy=(q/uRes*2.-1.)*gl_Position.w;vAlpha*=dim;}}'].join('\n');
const FRAG = 'varying vec3 vCol;varying float vAlpha;void main(){vec2 d=gl_PointCoord-.5;float r=dot(d,d);if(r>.25)discard;gl_FragColor=vec4(vCol,vAlpha*(1.-r*3.2));}';
const pMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uA: { value: 0 }, uB: { value: 0 }, uC: { value: 0 }, uD: { value: 0 }, uTime: { value: 0 }, uPx: { value: 1 }, uFade: { value: 1 }, uMask0: { value: new THREE.Vector4(-9, -9, -9, -9) }, uMask1: { value: new THREE.Vector4(-9, -9, -9, -9) }, uFeather: { value: 110 }, uGap: { value: 14 }, uRes: { value: new THREE.Vector2(1, 1) } }, vertexShader: VERT, fragmentShader: FRAG });
const planet = new THREE.Points(pGeo, pMat); scene.add(planet);
const starGeo = new THREE.BufferGeometry(), starPos = new Float32Array(4000 * 3); for (let i = 0; i < 4000; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(140 + Math.random() * 120); starPos.set([v.x, v.y, v.z], i * 3); }
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3)); const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false, transparent: true, opacity: .6 })); scene.add(stars);
const smP = (a, b, v) => { const x = Math.min(1, Math.max(0, (v - a) / (b - a))); return x * x * (3 - 2 * x); };

function canvasTex(size, draw) { const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
// NASA/JPL-Caltech Perseverance model (public 3D resource), lit by a CC0 studio HDRI.
const rover = new THREE.Group(); scene.add(rover);
const parts = {}, allParts = [], wheels = [], bogies = [];
let head = new THREE.Group();
new RGBELoader().load('/landing/desert.hdr', hdr => { hdr.mapping = THREE.EquirectangularReflectionMapping; scene.environment = pmrem.fromEquirectangular(hdr).texture; scene.environmentIntensity = .75; scene.environmentRotation.y = 1.2; hdr.dispose(); });
const loaded = new Promise(resolve => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load('/landing/rover.glb', ({ scene: model }) => {
  model.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (o.material) { o.material.envMapIntensity = 1; } } });
  const box3 = new THREE.Box3().setFromObject(model), size = box3.getSize(new THREE.Vector3());
  const scale = 3 / Math.max(size.x, size.z); model.scale.setScalar(scale);
  const b2 = new THREE.Box3().setFromObject(model), c2 = b2.getCenter(new THREE.Vector3());
  model.position.set(-c2.x, -b2.min.y, -c2.z);
  rover.add(model); rover.updateMatrixWorld(true);
  const centre = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  for (const child of [...model.children]) {
    const cb = new THREE.Box3().setFromObject(child); if (cb.isEmpty()) continue;
    const cc = cb.getCenter(new THREE.Vector3()), dir = cc.clone().sub(centre); dir.y = Math.max(dir.y, 0) + .15;
    const dist = dir.length(); dir.normalize().multiplyScalar(.55 + dist * .9);
    child.userData.home = child.position.clone();
    child.userData.explodeWorld = dir;
    allParts.push(child); parts[child.name] = child;
  }
  model.traverse(o => { if (o.name === 'head') head = o; if (o.isMesh || o.isGroup) parts[o.name] = parts[o.name] || o; });
  resolve(model);
}));
const modelRoot = await loaded;
const toLocal = new THREE.Matrix4().copy(modelRoot.matrixWorld).invert();

// soft contact shadow + studio floor
const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.ShadowMaterial({ opacity: .55 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const glow = new THREE.Mesh(new THREE.CircleGeometry(5, 64), new THREE.MeshBasicMaterial({ map: canvasTex(256, (g, s) => { const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(255,184,107,.10)'); r.addColorStop(1, 'rgba(255,184,107,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); }), transparent: true, depthWrite: false }));
glow.rotation.x = -Math.PI / 2; glow.position.y = .002; scene.add(glow);
const ring = new THREE.Mesh(new THREE.RingGeometry(3.0, 3.015, 160), new THREE.MeshBasicMaterial({ color: 0xffb86b, transparent: true, opacity: .35 })); ring.rotation.x = -Math.PI / 2; ring.position.y = .003; scene.add(ring);

// Jezero terrain that fades in for touchdown
const rel = r => r <= 149 ? Math.max(0, (r - 61) / 88) * .5 : .5 + Math.min(1, (r - 149) / 94) * .5;
const terrain = new THREE.Mesh(new THREE.PlaneGeometry(40, 40, 160, 160), new THREE.MeshStandardMaterial({ color: 0x6e4433, roughness: 1, envMapIntensity: .35, transparent: true, opacity: 0 }));
terrain.rotation.x = -Math.PI / 2; terrain.receiveShadow = true; scene.add(terrain);
{ const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 161; const x = c.getContext('2d'); x.drawImage(im, 0, 0, 161, 161); const d = x.getImageData(0, 0, 161, 161).data; const p = terrain.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const gx = i % 161, gy = i / 161 | 0; const r = Math.hypot(gx - 80, gy - 80), f0 = Math.min(1, Math.max(0, (r - 10) / 30)), fall = f0 * f0 * (3 - 2 * f0); p.setZ(i, rel(d[i * 4]) * 1.6 * fall - .01); } p.needsUpdate = true; terrain.geometry.computeVertexNormals(); }; im.src = '/terrain/maunakea.png'; }

// dust ring for the landing
const dustN = 600, dustGeo = new THREE.BufferGeometry(), dustPos = new Float32Array(dustN * 3), dustDir = [];
for (let i = 0; i < dustN; i++) { const a = Math.random() * Math.PI * 2; dustDir.push([Math.cos(a), Math.sin(a), .6 + Math.random() * .8]); }
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xd59a6c, size: .035, transparent: true, opacity: 0, depthWrite: false })); scene.add(dust);

// camera choreography: [t, camPos, target, fov, roverYaw, hover, explode, flex]
const YAW0 = 0;
const headWorld = new THREE.Vector3(0, 2, 0);
const K = () => [
  [0.00, [5.6, 2.4, 6.6], [-1.1, 1.15, .4], 30, YAW0 + 2.55, .45, 0, 0],
  [0.17, [7.6, 1.3, .6], [0, .85, -1.0], 26, YAW0 + Math.PI, .4, 0, 1],
  [0.34, [.4, 13.5, 2.2], [0, .8, 0], 30, YAW0 + 4.0, .38, 0, 0],
  [0.50, [headWorld.x + .5, headWorld.y + .15, headWorld.z + 1.5], [headWorld.x, headWorld.y, headWorld.z], 24, YAW0 + Math.PI, .42, 0, 0],
  [0.68, [8.6, 5.0, 9.2], [-.6, 1.4, 0], 30, YAW0 + 2.3, .6, 1, 0],
  [0.86, [10.6, 3.6, 10.2], [0, 1.0, 0], 30, YAW0 + 2.75, 0, 0, 0],
  [1.00, [9.0, 2.9, 8.8], [0, .9, 1], 32, YAW0 + 2.75, 0, 0, 0],
];
const ease = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
function sample(t) { const KK = K(); let i = 0; while (i < KK.length - 2 && t > KK[i + 1][0]) i++; const a = KK[i], b = KK[i + 1]; const f = ease(Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])))); const L = (u, v) => u + (v - u) * f; const V = (u, v) => u.map((x, k) => L(x, v[k])); return { cam: V(a[1], b[1]), tgt: V(a[2], b[2]), fov: L(a[3], b[3]), yaw: L(a[4], b[4]), hover: L(a[5], b[5]), explode: L(a[6], b[6]), flex: L(a[7], b[7]) }; }

// callouts anchored to parts
const CALLOUTS = [
  { part: 'Wheels_objs', text: ['Mobility', '6 aluminium wheels'], show: [.12, .26], dx: 70, dy: 70 },
  { part: 'suspension', text: ['Rocker-bogie', 'Passive suspension'], show: [.12, .26], dx: -180, dy: -80 },
  { part: 'rtg', text: ['RTG', 'Power day and night'], show: [.29, .42], dx: 90, dy: 50 },
  { part: 'antenna_hg', text: ['High-gain antenna', 'Direct to Earth'], show: [.29, .42], dx: -190, dy: -50 },
  { part: 'head', text: ['Mast cameras', 'Stereo route planning'], show: [.45, .58], dx: 110, dy: -50 },
  { part: 'head', text: ['Navigation', 'Mast and cameras'], show: [.62, .76], dx: 90, dy: -40 },
  { part: 'Body', text: ['Body', 'Electronics and Pi link'], show: [.62, .76], dx: -200, dy: -30 },
  { part: 'Wheels_objs', text: ['Mobility', 'Wheels and drive'], show: [.62, .76], dx: -170, dy: 70 },
  { part: 'rtg', text: ['Power', 'Radioisotope unit'], show: [.62, .76], dx: 100, dy: 40 },
  { part: 'antenna_hg', text: ['Comms', 'High-gain dish'], show: [.62, .76], dx: -180, dy: -80 },
  { part: 'arm_01_joint', text: ['Sampling', 'Robotic arm'], show: [.62, .76], dx: 100, dy: 70 },
];
const labelsEl = document.getElementById('labels'), leaders = document.getElementById('leaders');
for (const c of CALLOUTS) { c.el = document.createElement('div'); c.el.className = 'callout'; c.el.innerHTML = `<b>${c.text[0]}</b>${c.text[1]}`; labelsEl.appendChild(c.el); c.line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); c.line.setAttribute('fill', 'none'); c.line.setAttribute('stroke', 'rgba(255,184,107,.75)'); c.line.setAttribute('stroke-width', '1'); leaders.appendChild(c.line); c.dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.dot.setAttribute('r', '3'); c.dot.setAttribute('fill', '#ffb86b'); leaders.appendChild(c.dot); }

const SIDES = ['l', 'r', 'l', 'r', 'l', 'l', 'r', 'l', 'r', 'l', 'r'];
const view = { x: 0, y: 0 };
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight); gtao.updateGtaoMaterial({ radius: .45, distanceExponent: 1.2, thickness: 1.2, scale: 1.1 }); gtao.blendIntensity = .9; composer.addPass(gtao);
const bokeh = new BokehPass(scene, camera, { focus: 2.0, aperture: .004, maxblur: .008 }); bokeh.enabled = false; composer.addPass(bokeh);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .45, .5, .92); composer.addPass(bloom);
composer.addPass(new OutputPass());
function resize() { composer.setSize(innerWidth, innerHeight); composer.setPixelRatio(renderer.getPixelRatio()); renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); pMat.uniforms.uPx.value = renderer.getPixelRatio(); }
addEventListener('resize', resize); resize();
const secs = [...document.querySelectorAll('section')]; const io = new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle('on', e.isIntersecting)), { threshold: .3 }); secs.forEach(s => io.observe(s));
let target = 0, T = 0; const sc = () => { const m = document.documentElement.scrollHeight - innerHeight; target = m > 0 ? scrollY / m : 0; }; addEventListener('scroll', sc, { passive: true }); sc();
let mx = 0, my = 0; addEventListener('pointermove', e => { mx = e.clientX / innerWidth - .5; my = e.clientY / innerHeight - .5; });
const prog = document.getElementById('prog'); const names = ['Moon and Mars', 'Jezero', 'Askja', 'Shackleton', 'Mauna Kea', 'Rover', 'Mobility', 'Power', 'Navigation', 'Systems', 'Touchdown'];
// Keep particles out from behind text: they part around the boxes of the cards currently on screen.
const cards = [...document.querySelectorAll('section .card')];
const NONE = [-9, -9, -9, -9];
function updateTextMask() {
  const dpr = renderer.getPixelRatio(), pad = 18, lead = 80, H = innerHeight;
  const boxes = cards.map(c => c.getBoundingClientRect()).filter(r => r.bottom > 0 && r.top < H && r.width > 0)
    .sort((a, b) => Math.abs(a.top + a.height / 2 - H / 2) - Math.abs(b.top + b.height / 2 - H / 2)).slice(0, 2)
    .map(r => [(r.left - pad) * dpr, (H - r.bottom - lead) * dpr, (r.right + pad) * dpr, (H - r.top + lead) * dpr]);
  pMat.uniforms.uMask0.value.set(...(boxes[0] ?? NONE)); pMat.uniforms.uMask1.value.set(...(boxes[1] ?? NONE));
  pMat.uniforms.uFeather.value = 110 * dpr; pMat.uniforms.uGap.value = 14 * dpr; pMat.uniforms.uRes.value.set(innerWidth * dpr, innerHeight * dpr);
}
const clock = new THREE.Clock(); const v = new THREE.Vector3(); let landedAt = -1;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), .05), time = clock.elapsedTime;
  T += (target - T) * (1 - Math.exp(-dt * 3.4));
  const t = Math.min(1, Math.max(0, (T - .44) / .56));
  const A = smP(.04, .12, T), B = smP(.13, .21, T), C = smP(.22, .3, T), D = smP(.31, .39, T), pf = 1 - smP(.4, .46, T);
  pMat.uniforms.uA.value = A; pMat.uniforms.uB.value = B; pMat.uniforms.uC.value = C; pMat.uniforms.uD.value = D;
  updateTextMask();
  pMat.uniforms.uTime.value = time; pMat.uniforms.uFade.value = pf; planet.visible = pf > 0; stars.material.opacity = .6 * (1 - smP(.44, .52, T) * .6);
  document.getElementById('scoreMars').textContent = (.28 * smP(.14, .21, T)).toFixed(2);
  document.getElementById('scoreMoon').textContent = (.46 * smP(.32, .39, T)).toFixed(2);
  const place = document.getElementById('place'); place.style.opacity = pf;
  place.innerHTML = D > .5 ? 'Earth · <b>Mauna Kea, Hawaii</b> · twin of Shackleton' : C > .5 ? 'Moon · <b>Shackleton crater rim</b> · 89.67°S 129.78°E'
    : B > .5 ? 'Earth · <b>Askja, Iceland</b> · twin of Jezero' : A > .5 ? 'Mars · <b>Jezero Crater</b> · 18.45°N 77.45°E' : 'Moon and Mars · <b>real elevation data</b>';
  const A_ = Math.max(A, B, C, D);
  if (head) new THREE.Box3().setFromObject(head).getCenter(headWorld);
  const s = sample(t);
  const bob = Math.sin(time * 1.6) * .035 * Math.min(1, s.hover / .3);
  const arrive = smP(.42, .5, T), landF = Math.min(1, Math.max(0, (t - .74) / .1)); rover.visible = arrive > 0; rover.position.y = s.hover + bob + (1 - arrive) * 7;
  rover.rotation.y = s.yaw + Math.sin(time * .5) * .04 * (1 - s.explode);
  rover.rotation.z = Math.sin(time * 1.1) * .012 * Math.min(1, s.hover / .3);
  const ex = ease(s.explode);
  for (const p of allParts) { const w = p.userData.explodeWorld.clone().multiplyScalar(ex).applyMatrix3(new THREE.Matrix3().setFromMatrix4(toLocal)); p.position.copy(p.userData.home).add(w); }
  const drive = Math.max(0, (t - .9) / .1);
  rover.position.x = -Math.sin(s.yaw) * drive * 1.8; rover.position.z = -Math.cos(s.yaw) * drive * 1.8;
  camera.position.set(s.cam[0] + mx * .5, s.cam[1] - my * .3, s.cam[2]);
  const pang = time * .08 + mx * .5, pd = 34 - A_ * 6, ph = 4 + A_ * 12 + my * 3, blend = smP(.41, .5, T);
  const pc = [Math.sin(pang) * pd, ph, Math.cos(pang) * pd];
  camera.position.set(pc[0] + (camera.position.x - pc[0]) * blend, pc[1] + (camera.position.y - pc[1]) * blend, pc[2] + (camera.position.z - pc[2]) * blend);
  camera.fov = 40 + (s.fov - 40) * blend; camera.updateProjectionMatrix();
  camera.lookAt(s.tgt[0] * blend, A_ * .5 * (1 - blend) + s.tgt[1] * blend, s.tgt[2] * blend);
  const land = Math.min(1, Math.max(0, (t - .74) / .1));
  terrain.material.opacity = land; terrain.material.transparent = land < 1; terrain.visible = land > 0; floor.visible = land < .5 && arrive > .2; glow.material.opacity = arrive * (1 - landF); ring.material.opacity = .35 * arrive * (1 - landF); floor.material.opacity = .55; 
  terrain.position.y = -.02;
  if (land >= 1 && s.hover < .02 && landedAt < 0) landedAt = time; if (s.hover > .05) landedAt = -1;
  const dk = landedAt > 0 ? Math.min(1, (time - landedAt) / 1.6) : 0;
  for (let i = 0; i < dustN; i++) { const d = dustDir[i]; const r = 1 + dk * 2.4 * d[2]; dustPos.set([d[0] * r, .05 + Math.sin(dk * Math.PI) * .25 * d[2], d[1] * r], i * 3); }
  dustGeo.attributes.position.needsUpdate = true; dust.material.opacity = landedAt > 0 ? (1 - dk) * .8 : 0;
  rover.updateMatrixWorld(true);
  for (const c of CALLOUTS) {
    const on = t > c.show[0] && t < c.show[1]; c.el.style.opacity = on ? 1 : 0; c.line.style.opacity = c.dot.style.opacity = on ? 1 : 0; if (!on) continue;
    const obj = parts[c.part]; if (!obj) continue; new THREE.Box3().setFromObject(obj).getCenter(v); v.project(camera);
    const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight, lx = x + c.dx, ly = y + c.dy;
    c.dot.setAttribute('cx', x); c.dot.setAttribute('cy', y);
    c.line.setAttribute('points', `${x},${y} ${lx},${ly} ${lx + (c.dx > 0 ? 40 : -40)},${ly}`);
    c.el.style.left = (c.dx > 0 ? lx + 46 : lx - 46 - c.el.offsetWidth) + 'px'; c.el.style.top = (ly - 14) + 'px';
  }
  const idx = Math.min(names.length - 1, Math.floor(T * names.length * .999));
  prog.innerHTML = `0${idx + 1} / 0${names.length} · <b>${names[idx]}</b><i style="--p:${T.toFixed(3)}"></i>`;
  const close = smP(.4, .48, t) * (1 - smP(.54, .6, t));
  bokeh.enabled = close > .02; bokeh.uniforms.focus.value = camera.position.distanceTo(headWorld); bokeh.uniforms.aperture.value = .0035 * close;
  gtao.enabled = arrive > .05; bloom.strength = .5 - .38 * arrive; bloom.threshold = .7 + .25 * arrive;
  const scrim = document.getElementById('scrim'); const sec = Math.min(10, Math.floor(T * 11 * .999)); const side = SIDES[sec]; scrim.className = 'scrim ' + (side === 'l' ? '' : side);
  // Keep graphics out of the text column: shift the rendered view to the empty side.
  const narrow = innerWidth < 900;
  const wantX = narrow ? 0 : (side === 'l' ? -.27 : side === 'r' ? .27 : 0) * innerWidth;
  const wantY = narrow ? .24 * innerHeight : 0;
  view.x += (wantX - view.x) * (1 - Math.exp(-dt * 4)); view.y += (wantY - view.y) * (1 - Math.exp(-dt * 4));
  camera.setViewOffset(innerWidth, innerHeight, view.x, view.y, innerWidth, innerHeight);
  composer.render();
});
