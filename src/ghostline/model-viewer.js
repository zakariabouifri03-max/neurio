import * as THREE from 'three';
import { buildOperative } from './operative.js';

export class ModelViewer {
  constructor(container, palette, reducedMotion = false) {
    this.container = container; this.scene = new THREE.Scene(); this.reducedMotion = reducedMotion;
    this.camera = new THREE.PerspectiveCamera(34, 1, .1, 30); this.camera.position.set(-3, 1.95, -4.4); this.camera.lookAt(0, 1.03, 0);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6)); this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.2;
    this.renderer.setClearColor('#000000', 0); container.appendChild(this.renderer.domElement);
    this.model = buildOperative(palette); this.scene.add(this.model.root);
    this.scene.add(new THREE.HemisphereLight('#dae7d2', '#40574a', 2.6));
    const key = new THREE.DirectionalLight('#fff1d7', 3.1); key.position.set(-3, 5, -4); this.scene.add(key);
    const rim = new THREE.DirectionalLight('#afecbc', 3.2); rim.position.set(2, 3, 3); this.scene.add(rim);
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(.94, 1.03, .10, 64), new THREE.MeshStandardMaterial({ color: '#304d45', roughness: .7, metalness: .35 })); platform.position.y = -.08; this.scene.add(platform);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, .009, 6, 80), new THREE.MeshBasicMaterial({ color: '#bfd889', transparent: true, opacity: .7 })); ring.rotation.x = -Math.PI / 2; ring.position.y = -.02; this.scene.add(ring);
    const grid = new THREE.GridHelper(10, 30, '#8eb18c', '#638b75'); grid.position.y = -.14; grid.material.transparent = true; grid.material.opacity = .13; this.scene.add(grid);
    this.dragging = false; this.rotation = 0; this.wasDragged = false;
    const c = this.renderer.domElement;
    c.addEventListener('pointerdown', e => { this.dragging = true; this.wasDragged = true; this.lastX = e.clientX; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', e => { if (this.dragging) { this.rotation += (e.clientX - this.lastX) * .012; this.lastX = e.clientX; } });
    const end = () => { this.dragging = false; }; c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end); c.addEventListener('lostpointercapture', end);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container); this.resize();
  }
  resize() { const w = this.container.clientWidth, h = this.container.clientHeight; if (!w || !h) return; this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  update(dt, time) { if (!this.wasDragged && !this.reducedMotion) this.rotation += dt * .12; this.model.root.rotation.y = this.rotation; this.model.animate(time, 0); this.renderer.render(this.scene, this.camera); }
  setPalette(palette) { this.model.setPalette(palette); }
}

export async function exportOperative(palette) {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const model = buildOperative(palette); model.animate(0, 0);
  model.root.updateMatrixWorld(true);
  try { return await new GLTFExporter().parseAsync(model.root, { binary: true, onlyVisible: true }); }
  finally {
    const materials = new Set(), geometries = new Set();
    model.root.traverse(o => { if (o.isMesh) { geometries.add(o.geometry); materials.add(o.material); } });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
  }
}
