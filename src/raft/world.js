import * as THREE from 'three';
import { seeded, mesh, material } from './models.js';
import { tropicalIsland, updateTropics } from './tropics.js';
import { createOcean } from './ocean.js';
import { ISLANDS } from './waves.js';

export function createWorld(renderer) {
  const scene = new THREE.Scene();
  const skyColors = { horizon: new THREE.Color('#abd5df'), zenith: new THREE.Color('#246eaa') };
  scene.background = skyColors.horizon;
  scene.fog = new THREE.FogExp2('#b7d6dc', .0033);
  const hemisphere = new THREE.HemisphereLight('#c6e7fc', '#7c8464', 1.6); scene.add(hemisphere);
  const sun = new THREE.DirectionalLight('#ffedca', 3.25);
  const sunDirection = new THREE.Vector3(-.49, .64, -.59).normalize();
  sun.target.position.set(-7, 0, -12); sun.position.copy(sunDirection).multiplyScalar(92).add(sun.target.position); scene.add(sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 1, far: 175 });
  sun.shadow.bias = -.00016; sun.shadow.normalBias = .024; sun.shadow.radius = 3; scene.add(sun);

  const ocean = createOcean(scene, sunDirection, skyColors);
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      uHorizon: { value: skyColors.horizon }, uZenith: { value: skyColors.zenith },
      uSun: { value: sunDirection }, uClouds: { value: ocean.textures.normal }, uTime: { value: 0 },
    },
    vertexShader: 'varying vec3 vDirection; void main(){ vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: /* glsl */`
      varying vec3 vDirection;
      uniform vec3 uHorizon, uZenith, uSun;
      uniform sampler2D uClouds; uniform float uTime;
      void main() {
        vec3 d = normalize(vDirection); float h = max(0., d.y);
        vec3 sky = mix(uHorizon, uZenith, pow(h, .38));
        vec2 uv = d.xz / (max(h, .018) + .16) * .14 + vec2(uTime * .0008, 0.);
        float n = texture2D(uClouds, uv).b * .66 + texture2D(uClouds, uv * 2.37).b * .24 + texture2D(uClouds, uv * 5.4).b * .1;
        float clouds = smoothstep(.49, .615, n) * smoothstep(.015, .13, h);
        vec3 cloud = mix(vec3(.52, .65, .73), vec3(1.15, 1.17, 1.09), smoothstep(.48, .67, n));
        sky = mix(sky, cloud, clouds * .93);
        float sun = max(0., dot(d, uSun));
        sky += vec3(1., .80, .53) * (pow(sun, 6500.) * 7. + pow(sun, 220.) * .22);
        gl_FragColor = vec4(sky, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(650, 32, 20), skyMaterial); sky.renderOrder = -100; sky.frustumCulled = false; scene.add(sky);
  const islands = ISLANDS.map(definition => {
    const model = tropicalIsland(definition); model.position.set(definition.x, 0, definition.z); scene.add(model);
    return { ...definition, model };
  });

  const birds = new THREE.Group(); scene.add(birds);
  const birdGeometry = new THREE.BufferGeometry();
  birdGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-.5, .07, 0, -.16, .14, 0, 0, 0, .045, 0, 0, .045, .16, .14, 0, .5, .07, 0], 3)); birdGeometry.computeVertexNormals();
  const rng = seeded(154);
  for (let i = 0; i < 10; i++) {
    const bird = mesh(birdGeometry, material('#364a4c', { side: THREE.DoubleSide }), birds, [-35 + rng() * 60, 10 + rng() * 8, -30 - rng() * 35]);
    bird.userData.phase = rng() * Math.PI * 2; bird.userData.origin = bird.position.clone(); bird.castShadow = false;
  }
  // A small lantern on the raft keeps its warm character in the brighter world.
  const lantern = new THREE.PointLight('#ffc078', .65, 5, 2); lantern.position.set(-2.6, 1.9, -2.8); scene.add(lantern);

  return {
    scene, sun, hemisphere, ocean, oceanMaterial: ocean.material, islands,
    get surface() { return ocean.boat; },
    sampleWater(x, z, out = {}) { return ocean.sample(x, z, out); },
    setRaftRadius(radius) { ocean.setRaftRadius(radius); },
    renderReflection(camera, quality) { ocean.renderReflection(renderer, camera, quality); },
    update(time, travel, quality, seaState = 'rolling') {
      ocean.update(time, travel, seaState); skyMaterial.uniforms.uTime.value = time;
      for (const island of islands) island.model.position.set(island.x - travel.x, 0, island.z - travel.z);
      updateTropics(time, islands);
      for (const bird of birds.children) {
        const phase = bird.userData.phase;
        bird.position.x = bird.userData.origin.x + Math.sin(time * .027 + phase) * 9 - travel.x;
        bird.position.y = bird.userData.origin.y + Math.sin(time * .8 + phase) * .12;
        bird.position.z = bird.userData.origin.z + Math.cos(time * .027 + phase) * 6 - travel.z;
        bird.rotation.z = Math.sin(time * 2 + phase) * .12;
      }
      renderer.shadowMap.enabled = quality !== 'low';
    },
  };
}
