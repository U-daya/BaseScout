import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 3D relief of each 25 x 25 km elevation window, rebuilt from the bundled maps.
// build_terrain.py colours relative height with a three-stop ramp whose red channel
// rises monotonically (61 -> 149 -> 243), so red maps back to 0..1 exactly; multiplying
// by each site's measured relief gives metres. All sites share one vertical scale.
const WINDOW_KM = 25;
const GRID = 136;
const EXAGGERATION = 3;

function relativeFromRed(r) {
  return r <= 149 ? Math.max(0, (r - 61) / 88) * .5 : .5 + Math.min(1, (r - 149) / 94) * .5;
}

function loadHeights(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = GRID + 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, GRID + 1, GRID + 1);
      const { data } = context.getImageData(0, 0, GRID + 1, GRID + 1);
      const heights = new Float32Array((GRID + 1) ** 2);
      for (let i = 0; i < heights.length; i++) heights[i] = relativeFromRed(data[i * 4]);
      resolve({ heights, image });
    };
    image.onerror = reject;
    image.src = url;
  });
}

export default function Terrain3D({ sites, root }) {
  const mount = useRef(null);
  const api = useRef(null);
  const [active, setActive] = useState(sites[1]?.id ?? sites[0].id);
  const [error, setError] = useState(false);

  useEffect(() => {
    const host = mount.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { setError(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .95;
    host.append(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#151416');
    const camera = new THREE.PerspectiveCamera(35, 1.6, .1, 400);
    camera.position.set(19, 17, 25);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.enableDamping = false;
    controls.enablePan = false;
    controls.minDistance = 18;
    controls.maxDistance = 70;
    controls.maxPolarAngle = Math.PI * .47;
    scene.add(new THREE.HemisphereLight('#f5ede4', '#3a2b26', .9));
    const sun = new THREE.DirectionalLight('#fff2df', 2.6);
    sun.position.set(-20, 18, -10); // low sun from the north-west, like a classic hillshade
    scene.add(sun);
    const base = new THREE.Mesh(new THREE.BoxGeometry(WINDOW_KM, .2, WINDOW_KM), new THREE.MeshStandardMaterial({ color: '#242226', roughness: 1 }));
    base.position.y = -.1;
    scene.add(base);
    const grid = new THREE.GridHelper(WINDOW_KM, 5, '#3c373a', '#3c373a');
    grid.position.y = .001;
    scene.add(grid);
    let mesh = null;
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    const resize = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = host;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      render();
    });
    resize.observe(host);
    api.current = (heights, image, reliefMetres) => {
      if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.map?.dispose(); mesh.material.dispose(); }
      const geometry = new THREE.PlaneGeometry(WINDOW_KM, WINDOW_KM, GRID, GRID);
      geometry.rotateX(-Math.PI / 2);
      const position = geometry.attributes.position;
      const scale = reliefMetres / 1000 * EXAGGERATION;
      for (let i = 0; i < position.count; i++) position.setY(i, heights[i] * scale);
      geometry.computeVertexNormals();
      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      texture.needsUpdate = true;
      mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: texture, roughness: .95 }));
      scene.add(mesh);
      render();
    };
    return () => {
      api.current = null;
      resize.disconnect();
      controls.dispose();
      scene.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); });
      renderer.dispose();
      host.replaceChildren();
    };
  }, []);

  useEffect(() => {
    const site = sites.find(s => s.id === active);
    if (!site) return;
    let cancelled = false;
    loadHeights(root + site.id + '.png')
      .then(({ heights, image }) => { if (!cancelled) api.current?.(heights, image, site.relief); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [active, sites, root]);

  const site = sites.find(s => s.id === active);
  return <section className="panel relief">
    <div className="panel-head">
      <h2>3D relief</h2>
      <div className="segmented" role="tablist" aria-label="Site">
        {sites.map(s => <button key={s.id} type="button" role="tab" aria-selected={s.id === active} onClick={() => setActive(s.id)}>{s.name.split(',')[0]}</button>)}
      </div>
    </div>
    <div className="relief-view" ref={mount} aria-label={`3D relief of ${site?.name}. Drag to rotate, scroll to zoom.`}>
      {error && <p>3D view unavailable in this browser.</p>}
      <span className="relief-tag">{site?.name} · {site?.planet} · relief {Math.round(site?.relief ?? 0).toLocaleString()} m</span>
    </div>
    <p className="muted">25 × 25 km window · vertical exaggeration ×{EXAGGERATION}, identical for all three sites so their relief compares directly · drag to rotate, scroll to zoom.</p>
  </section>;
}
