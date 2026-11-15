import React from 'react';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { pads, start, nearPad } from './mission';

function box(group, color, size, position) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color }));
  mesh.position.set(...position);
  group.add(mesh);
  return mesh;
}

const keysByAxis = { KeyW: [0,1], ArrowUp: [0,1], KeyS: [0,-1], ArrowDown: [0,-1], KeyA: [-1,0], ArrowLeft: [-1,0], KeyD: [1,0], ArrowRight: [1,0] };

export default function Scene({ target, recommendation, joystick, onArrival, paused }) {
  const mount = useRef(null);
  const state = useRef({});
  state.current = { target, recommendation, joystick, onArrival, paused };
  const [error, setError] = useState(false);
  useEffect(() => {
    const host = mount.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { setError(true); return; }
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#22171b');
    const camera = new THREE.OrthographicCamera(-18,18,12,-12,0.1,100);
    camera.position.set(0,27,23);
    camera.lookAt(0,0,-1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.append(renderer.domElement);
    const resize = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = host;
      if (!w || !h) return;
      const aspect = w / h;
      camera.top = Math.max(10.8, 16.5 / aspect);
      camera.bottom = -camera.top;
      camera.right = camera.top * aspect;
      camera.left = -camera.right;
      camera.updateProjectionMatrix();
      renderer.setSize(w,h);
    });
    resize.observe(host);
    scene.add(new THREE.HemisphereLight('#ffe6c2','#783d32',2.2));
    const sun = new THREE.DirectionalLight('#ffcc90',2.7);
    sun.position.set(-8,12,9);
    scene.add(sun);

    const ground = new THREE.PlaneGeometry(38,32,76,64);
    ground.rotateX(-Math.PI/2);
    const points = ground.attributes.position;
    const colors = [];
    for (let i=0;i<points.count;i++) {
      const x=points.getX(i), z=points.getZ(i);
      const shape = Math.sin(x*.52+z*.2)*Math.cos(z*.53) + .4*Math.sin(x*2+z*1.7);
      const edge = Math.min(1, Math.max(0,(Math.abs(x)-11)/5) + Math.max(0,(Math.abs(z)-9)/5));
      points.setY(i, shape * (.055 + edge * .85) - .11);
      colors.push(...new THREE.Color().setHSL(.042 + shape*.008,.43,.27 + shape*.056).toArray());
    }
    ground.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    ground.computeVertexNormals();
    scene.add(new THREE.Mesh(ground, new THREE.MeshStandardMaterial({vertexColors:true, roughness:1, flatShading:true})));
    const grid = new THREE.GridHelper(30, 30, '#aa7053', '#784a3c');
    grid.position.y = .005;
    grid.material.transparent = true;
    grid.material.opacity = .23;
    scene.add(grid);

    const rings = {};
    const labels = {};
    for (const [name,pad] of Object.entries(pads)) {
      const disk = new THREE.Mesh(new THREE.CylinderGeometry(2.1,2.1,.10,48),new THREE.MeshStandardMaterial({color:'#312e33'}));
      disk.position.set(pad.x,.02,pad.z);
      scene.add(disk);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.01,.055,8,64),new THREE.MeshBasicMaterial());
      ring.rotation.x = -Math.PI/2;
      ring.position.set(pad.x,.09,pad.z);
      scene.add(ring);
      rings[name] = ring;
      const label = document.createElement('span');
      label.className = 'pad-label';
      label.textContent = `PAD ${name}`;
      host.append(label);
      labels[name] = label;
    }
    const rover = new THREE.Group();
    rover.position.set(start.x,0,start.z);
    scene.add(rover);
    const placeholder = new THREE.Group();
    rover.add(placeholder);
    box(placeholder, '#e9b47f',[1.35,.35,1.8],[0,.55,0]);
    box(placeholder, '#e7e7e1',[.85,.45,1.03],[0,.78,.04]);
    box(placeholder, '#d68b51',[.13,.63,.13],[0,1.1,-.38]);
    box(placeholder, '#f5e2c8',[.48,.24,.29],[0,1.47,-.44]);
    box(placeholder, '#19252c',[.38,.1,.025],[0,1.47,-.60]);
    for (const x of [-.76,.76]) for (const z of [-.66,0,.66]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.3,.3,.28,16),new THREE.MeshStandardMaterial({color:'#29262a'}));
      wheel.rotation.z = Math.PI/2;
      wheel.position.set(x,.31,z);
      placeholder.add(wheel);
    }
    let active = true;
    const modelUrl = import.meta.env.VITE_ROVER_MODEL_URL;
    if (modelUrl) new GLTFLoader().load(modelUrl, ({scene:model}) => {
      if (!active) { dispose(model); return; }
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const scale = 1.8 / Math.max(size.x,size.z);
      if (!Number.isFinite(scale) || scale <= 0) { dispose(model); return; }
      model.scale.multiplyScalar(scale);
      const scaled = new THREE.Box3().setFromObject(model);
      model.position.sub(scaled.getCenter(new THREE.Vector3()));
      model.position.y += (scaled.max.y-scaled.min.y)/2;
      placeholder.visible = false;
      rover.add(model);
    }, undefined, () => { console.warn('Rover model could not be loaded.'); });

    const keys = new Set();
    const clear = () => keys.clear();
    const keydown = (event) => {
      if (!keysByAxis[event.code] || event.ctrlKey || event.altKey || event.metaKey ||
          event.target.closest?.('input, select, textarea, [contenteditable]')) return;
      event.preventDefault();
      keys.add(event.code);
    };
    const keyup = event => keys.delete(event.code);
    window.addEventListener('keydown',keydown);
    window.addEventListener('keyup',keyup);
    window.addEventListener('blur',clear);
    document.addEventListener('visibilitychange',clear);

    const vector = new THREE.Vector2();
    const marker = new THREE.Vector3();
    let lastTime = 0;
    let previousArrival;
    renderer.setAnimationLoop(time => {
      const dt = Math.min((time-lastTime)/1000,.05);
      lastTime = time;
      const { target, recommendation, joystick, onArrival, paused } = state.current;
      if (paused) { clear(); return; }
      vector.set(0,0);
      if (keys.size) {
        for(const key of keys) {
          vector.x += keysByAxis[key][0];
          vector.y += keysByAxis[key][1];
        }
        vector.set(Math.sign(vector.x),Math.sign(vector.y));
      } else if (performance.now()-joystick.current.received < 1000) {
        vector.set(joystick.current.x,joystick.current.y);
        if (vector.length() < .12) vector.set(0,0);
      }
      vector.clampLength(0,1);
      if (vector.lengthSq()) {
        rover.rotation.y = Math.atan2(-vector.x,vector.y);
        rover.position.x = THREE.MathUtils.clamp(rover.position.x + vector.x*6*dt,-15,15);
        rover.position.z = THREE.MathUtils.clamp(rover.position.z - vector.y*6*dt,-11,11);
      }
      const arrived = nearPad(rover.position,pads[target]);
      if (previousArrival !== arrived) { previousArrival = arrived; onArrival(arrived); }
      for (const [id,pad] of Object.entries(pads)) {
        const color = id === recommendation ? '#9fefb8' : id === target ? '#ffbc78' : '#abbccb';
        rings[id].material.color.set(color);
        marker.set(pad.x,0,pad.z-2.9).project(camera);
        labels[id].style.left = `${(marker.x+1)*50}%`;
        labels[id].style.top = `${(1-marker.y)*50}%`;
        labels[id].style.color = color;
      }
      renderer.render(scene,camera);
    });
    return () => {
      active = false;
      resize.disconnect();
      window.removeEventListener('keydown',keydown);
      window.removeEventListener('keyup',keyup);
      window.removeEventListener('blur',clear);
      document.removeEventListener('visibilitychange',clear);
      renderer.setAnimationLoop(null);
      dispose(scene);
      renderer.dispose();
      host.replaceChildren();
    };
  }, []);
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
