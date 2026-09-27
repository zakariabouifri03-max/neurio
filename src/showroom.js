import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

/**
 * Builds the dark-studio showroom: gradient backdrop, polished mirror floor,
 * accent light rig and the scrolling "speed grid" used in drive mode.
 */
export function createShowroom(scene, renderer) {
  // ---------------------------------------------------------
  // Backdrop — vertical gradient dome
  // ---------------------------------------------------------
  const backdropMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x0b0f1a) },
      horizonColor: { value: new THREE.Color(0x06080e) },
      bottomColor: { value: new THREE.Color(0x020203) },
      glowColor: { value: new THREE.Color(0x101a30) }
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      uniform vec3 glowColor;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y;
        vec3 col = mix(horizonColor, topColor, smoothstep(0.0, 0.65, h));
        col = mix(bottomColor, col, smoothstep(-0.35, 0.0, h));
        // soft horizon band
        float band = exp(-abs(h) * 14.0) * 0.28;
        col += glowColor * band;
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
  const backdrop = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 32), backdropMat);
  backdrop.name = 'backdrop';
  scene.add(backdrop);

  scene.fog = new THREE.Fog(0x05060a, 14, 52);

  // ---------------------------------------------------------
  // Floor — real mirror (Reflector) dimmed by a dark overlay
  // ---------------------------------------------------------
  const mirror = new Reflector(new THREE.CircleGeometry(30, 72), {
    clipBias: 0.003,
    textureWidth: Math.min(1024, window.innerWidth),
    textureHeight: Math.min(1024, window.innerHeight),
    color: 0x4a5058
  });
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.y = 0;
  mirror.name = 'mirror-floor';
  scene.add(mirror);

  // Polished-concrete look: the mirror below provides the reflections, the
  // overlay only dims them. Kept off the IBL — a bright studio HDR at grazing
  // incidence otherwise washes the whole floor white.
  const overlayMat = new THREE.MeshStandardMaterial({
    color: 0x04050a,
    metalness: 0.08,
    roughness: 0.5,
    envMapIntensity: 0.0, // no IBL on the floor — grazing fresnel blows it out
    transparent: true,
    opacity: 0.7,
    depthWrite: false
  });
  const overlay = new THREE.Mesh(new THREE.CircleGeometry(30, 72), overlayMat);
  overlay.rotation.x = -Math.PI / 2;
  overlay.position.y = 0.01;
  overlay.receiveShadow = true;
  overlay.renderOrder = 1;
  overlay.name = 'floor-overlay';
  scene.add(overlay);

  // radial fade so the mirror dissolves into darkness at the edges
  // NOTE: CircleGeometry UVs only span radius 0.5 from centre → gradient
  // must reach full opacity at half the canvas size.
  const fadeCanvas = document.createElement('canvas');
  fadeCanvas.width = fadeCanvas.height = 256;
  const fctx = fadeCanvas.getContext('2d');
  const grad = fctx.createRadialGradient(128, 128, 26, 128, 128, 64);
  grad.addColorStop(0, 'rgba(3,4,7,0)');
  grad.addColorStop(0.55, 'rgba(3,4,7,0.4)');
  grad.addColorStop(1, 'rgba(3,4,7,1)');
  fctx.fillStyle = grad;
  fctx.fillRect(0, 0, 256, 256);
  const fadeTex = new THREE.CanvasTexture(fadeCanvas);
  const fade = new THREE.Mesh(
    new THREE.CircleGeometry(30, 72),
    new THREE.MeshBasicMaterial({
      map: fadeTex,
      transparent: true,
      depthWrite: false,
      fog: false
    })
  );
  fade.rotation.x = -Math.PI / 2;
  fade.position.y = 0.02;
  fade.renderOrder = 2;
  scene.add(fade);

  // ---------------------------------------------------------
  // Speed grid — invisible until IGNITE, then it scrolls
  // ---------------------------------------------------------
  const grid = new THREE.GridHelper(64, 64, 0x2f8fff, 0x14396b);
  grid.material.transparent = true;
  grid.material.opacity = 0;
  grid.material.depthWrite = false;
  grid.position.y = 0.03;
  scene.add(grid);

  // ---------------------------------------------------------
  // Light rig — studio key + two colored rims
  // ---------------------------------------------------------
  const key = new THREE.SpotLight(0xffffff, 180, 44, 0.62, 0.8, 1.8);
  key.position.set(4.5, 10, -3.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.00035;
  key.shadow.camera.near = 3;
  key.shadow.camera.far = 30;
  key.target.position.set(0, 0.5, 0);
  scene.add(key, key.target);

  const rimBlue = new THREE.SpotLight(0x3f8dff, 95, 40, 0.5, 0.9, 1.8);
  rimBlue.position.set(-5.5, 6, 4.5);
  rimBlue.target.position.set(0, 0.6, 0);
  scene.add(rimBlue, rimBlue.target);

  const rimWarm = new THREE.SpotLight(0xff6a2f, 80, 40, 0.5, 0.9, 1.8);
  rimWarm.position.set(6, 5.5, 4.8);
  rimWarm.target.position.set(0, 0.6, 0);
  scene.add(rimWarm, rimWarm.target);

  const fill = new THREE.HemisphereLight(0x8fb4ff, 0x0a0b10, 0.22);
  scene.add(fill);

  // ---------------------------------------------------------
  // update loop hooks
  // ---------------------------------------------------------
  const tmpColor = new THREE.Color();
  function update(dt, drive) {
    // scroll the grid with vehicle speed
    const speed = drive.speed01;
    grid.material.opacity = THREE.MathUtils.damp(
      grid.material.opacity,
      speed > 0.02 ? 0.5 : 0,
      4,
      dt
    );
    if (speed > 0.02) {
      grid.position.z += speed * 46 * dt;
      if (grid.position.z > 1) grid.position.z -= 1;
      // cool the rig down / heat it up with speed
      rimBlue.intensity = 95 + speed * 300;
      rimWarm.intensity = 80 + speed * 240;
      tmpColor.setHSL(0.62 - speed * 0.08, 0.85, 0.6);
    } else {
      rimBlue.intensity = THREE.MathUtils.damp(rimBlue.intensity, 95, 3, dt);
      rimWarm.intensity = THREE.MathUtils.damp(rimWarm.intensity, 80, 3, dt);
    }
  }

  return { update, mirror, grid, backdrop, floorMaterial: overlayMat };
}
