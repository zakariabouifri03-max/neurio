import * as THREE from 'three';
import { WAVE_GLSL, ISLANDS, SEA_STATES, raftSurface, surfaceAt } from './waves.js';
import { waterTextures } from './textures.js';

const vertex = /* glsl */`
  ${WAVE_GLSL}
  varying vec3 vWorld;
  varying vec2 vSlope;
  varying float vCrest;
  void main() {
    vec3 p = position;
    vec4 wave = surface(p.xz);
    p.y += wave.x;
    vWorld = (modelMatrix * vec4(p, 1.)).xyz;
    vSlope = wave.yz;
    vCrest = wave.w;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
  }
`;
const fragment = /* glsl */`
  ${WAVE_GLSL}
  uniform sampler2D uNormals;
  uniform sampler2D uCaustics;
  uniform sampler2D uReflection;
  uniform mat4 uReflectionMatrix;
  uniform float uReflectionReady;
  uniform vec3 uSunDirection;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  varying vec3 vWorld;
  varying vec2 vSlope;
  varying float vCrest;
  vec3 reflectedSky(vec3 direction) {
    float h = max(0., direction.y);
    vec3 sky = mix(uHorizon, uZenith, pow(h, .45));
    vec2 uv = direction.xz / (max(direction.y, .045) + .18) * .08;
    float n = texture2D(uNormals, uv + vec2(uTime * .0007, 0.)).b;
    float clouds = smoothstep(.50, .70, n) * smoothstep(.02, .22, h);
    return mix(sky, vec3(.83, .89, .85), clouds * .8);
  }
  void main() {
    vec2 local = vWorld.xz;
    #ifdef FAR_WATER
      if (abs(local.x) < 67. && abs(local.y) < 67.) discard;
    #endif
    vec2 p = local + uTravel;
    vec4 a = texture2D(uNormals, p * .062 + vec2(uTime * .008, -uTime * .010));
    vec4 b = texture2D(uNormals, vec2(p.y, -p.x) * .104 + vec2(-uTime * .012, uTime * .006));
    vec2 ripples = (a.rg * 2. - 1.) * .29 + (b.rg * 2. - 1.) * .16;
    vec3 normal = normalize(vec3(-vSlope.x + ripples.x, 1., -vSlope.y + ripples.y));
    vec3 view = normalize(cameraPosition - vWorld);
    float facing = clamp(dot(normal, view), .015, 1.);
    vec3 reflectionDirection = reflect(-view, normal);
    float shore = shoreDistance(p);
    float depth = clamp(shore * .31 + .7, .12, 28.);
    float clarity = exp(-depth * .15);
    vec3 deepWater = vec3(.003, .085, .135);
    vec3 lagoon = vec3(.008, .38, .30);
    vec3 water = mix(deepWater, lagoon, clarity);
    water *= .77 + a.b * .24 + max(0., dot(normal, uSunDirection)) * .16;
    // Sand illuminated through moving water, confined to the shallow coastal shelf.
    vec2 refracted = p + ripples * depth * .3;
    float c1 = texture2D(uCaustics, refracted * .055 + uTime * .006).r;
    float c2 = texture2D(uCaustics, refracted.yx * .069 - uTime * .009).r;
    float caustics = pow(min(c1, c2), .65) * exp(-depth * .26);
    water += vec3(.31, .42, .24) * caustics * .85;
    water += vec3(.025, .12, .10) * max(0., vWorld.y + .25) * (.35 + .65 * (1. - facing));
    vec3 sky = reflectedSky(reflectionDirection);
    vec4 mirror = uReflectionMatrix * vec4(vWorld, 1.);
    vec2 uv = mirror.xy / max(mirror.w, .001) + ripples * .018;
    float inFrame = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.) * step(0., mirror.w);
    vec3 reflected = texture2D(uReflection, clamp(uv, .001, .999)).rgb;
    sky = mix(sky, reflected, uReflectionReady * inFrame * .85);
    float fresnel = .025 + .975 * pow(1. - facing, 5.);
    vec3 color = mix(water, sky, fresnel);
    // Broad sun reflection plus small, bright glints on the micro-wave normals.
    vec3 halfVector = normalize(uSunDirection + view);
    float highlight = max(0., dot(normal, halfVector));
    float glint = pow(highlight, 1000.) * 3.4 + pow(highlight, 2400.) * .8 + pow(highlight, 85.) * .10;
    color += vec3(1., .91, .70) * glint;
    float broken = smoothstep(.37, .66, a.b) * smoothstep(.31, .66, b.b);
    float crest = smoothstep(.79, .98, vCrest + (a.b - .5) * .20);
    float whitecaps = crest * broken * smoothstep(.25, 1.2, uStrength);
    float shoreWave = sin(shore * 1.7 - uTime * 1.6 + a.b * 3.);
    float shoreFoam = (1. - smoothstep(.2, 3.8, abs(shore))) * smoothstep(.25, .85, shoreWave) * (.3 + .7 * a.b);
    float foam = clamp(whitecaps * .88 + shoreFoam * .85, 0., .91);
    color = mix(color, vec3(.8, .9, .84), foam);
    // Contact darkening is anchored to the actual raft, not painted into the water.
    float underRaft = (1. - smoothstep(2.5, 5., length(local))) * .18;
    color *= 1. - underRaft;
    float distanceFog = 1. - exp(-pow(distance(cameraPosition, vWorld) * .0033, 1.8));
    color = mix(color, uHorizon, distanceFog);
    gl_FragColor = vec4(color, 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createOcean(scene, sunDirection, skyColors) {
  const textures = waterTextures();
  const reflection = new THREE.WebGLRenderTarget(512, 320, { depthBuffer: true });
  reflection.texture.name = 'Ocean planar reflection';
  const uniforms = {
    uTime: { value: 0 }, uStrength: { value: .85 }, uTravel: { value: new THREE.Vector2() },
    uRaft: { value: new THREE.Vector4(0, 0, 0, 4.5) },
    uIslands: { value: ISLANDS.map(island => new THREE.Vector4(island.x, island.z, island.radius, island.seed)) },
    uNormals: { value: textures.normal }, uCaustics: { value: textures.caustic },
    uReflection: { value: reflection.texture }, uReflectionMatrix: { value: new THREE.Matrix4() }, uReflectionReady: { value: 0 },
    uSunDirection: { value: sunDirection.clone().normalize() }, uHorizon: { value: skyColors.horizon }, uZenith: { value: skyColors.zenith },
  };
  const nearGeometry = new THREE.PlaneGeometry(144, 144, 208, 208); nearGeometry.rotateX(-Math.PI / 2);
  const farGeometry = new THREE.PlaneGeometry(1800, 1800, 60, 60); farGeometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms, side: THREE.DoubleSide });
  const farMaterial = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: '#define FAR_WATER\n' + fragment, uniforms, side: THREE.DoubleSide });
  const near = new THREE.Mesh(nearGeometry, material), far = new THREE.Mesh(farGeometry, farMaterial);
  // Overlap the meshes safely below the dense local surface. The far shader skips its center.
  far.position.y = -.72; far.frustumCulled = near.frustumCulled = false;
  scene.add(far, near);
  const reflectionCamera = new THREE.PerspectiveCamera();
  const clip = new THREE.Vector4(), q = new THREE.Vector4(), plane = new THREE.Plane();
  const target = new THREE.Vector3(), direction = new THREE.Vector3(), bufferSize = new THREE.Vector2();
  const bias = new THREE.Matrix4().set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
  const boat = { height: 0, dx: 0, dz: 0 };
  const travel = { x: 0, z: 0 }; let time = 0, strength = .85, radius = 4.5, renderFrame = 0;
  return {
    material, uniforms, boat, textures,
    setRaftRadius(value) { radius = Math.max(4.5, Math.min(27, value)); },
    sample(x, z, out = {}) { return surfaceAt(x, z, time, travel, strength, boat, radius, out); },
    update(t, position, seaState) {
      time = t; travel.x = position.x; travel.z = position.z;
      strength = (SEA_STATES[seaState] || SEA_STATES.rolling).strength;
      raftSurface(travel.x, travel.z, time, strength, boat);
      uniforms.uTime.value = time; uniforms.uStrength.value = strength;
      uniforms.uTravel.value.set(travel.x, travel.z); uniforms.uRaft.value.set(boat.height, boat.dx, boat.dz, radius);
    },
    renderReflection(renderer, camera, quality) {
      if (quality === 'low') { uniforms.uReflectionReady.value = 0; return; }
      if (renderFrame++ % 3 !== 0 && uniforms.uReflectionReady.value) return;
      renderer.getDrawingBufferSize(bufferSize);
      const w = Math.max(160, Math.min(768, Math.round(bufferSize.x * .45)));
      const h = Math.max(128, Math.min(480, Math.round(w / camera.aspect)));
      if (reflection.width !== w || reflection.height !== h) reflection.setSize(w, h);
      reflectionCamera.copy(camera, false);
      reflectionCamera.position.y = -camera.position.y;
      camera.getWorldDirection(direction); target.copy(camera.position).add(direction); target.y = -target.y;
      reflectionCamera.up.set(0, -1, 0); reflectionCamera.lookAt(target); reflectionCamera.updateMatrixWorld();
      uniforms.uReflectionMatrix.value.copy(bias).multiply(reflectionCamera.projectionMatrix).multiply(reflectionCamera.matrixWorldInverse);
      // Oblique near clipping: underwater terrain must not appear above its reflection.
      plane.set(new THREE.Vector3(0, 1, 0), 0).applyMatrix4(reflectionCamera.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const p = reflectionCamera.projectionMatrix.elements;
      q.set((Math.sign(clip.x) + p[8]) / p[0], (Math.sign(clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
      clip.multiplyScalar(2 / clip.dot(q)); p[2] = clip.x; p[6] = clip.y; p[10] = clip.z + 1 - .003; p[14] = clip.w;
      const current = renderer.getRenderTarget(), shadowUpdate = renderer.shadowMap.needsUpdate, xrEnabled = renderer.xr.enabled;
      near.visible = far.visible = false; renderer.xr.enabled = false; renderer.shadowMap.needsUpdate = false;
      try { renderer.setRenderTarget(reflection); renderer.clear(); renderer.render(scene, reflectionCamera); uniforms.uReflectionReady.value = 1; }
      finally { renderer.setRenderTarget(current); renderer.xr.enabled = xrEnabled; renderer.shadowMap.needsUpdate = shadowUpdate; near.visible = far.visible = true; }
    },
  };
}
