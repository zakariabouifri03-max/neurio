import * as THREE from "three";
import {
  Batch,
  material,
  mesh,
  box,
  forestMaterials,
  buildPine,
  rockGeometry,
  buildFern,
  buildLog,
  buildCampfire,
  buildShelter,
  buildDeer,
  buildWolf,
} from "./models.js";
import {
  random,
  heightAt,
  shoreX,
  CAMP,
  FIRE_SITE,
  SHELTER_SITE,
  WATER_SITE,
  RESOURCE_DEFS,
  TREE_DEFS,
  distance,
  clamp,
} from "./rules.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
function terrainTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d"),
    r = random(77);
  g.fillStyle = "#bbb49a";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 15000; i++) {
    const v = r() > 0.45 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${r() * 0.15})`;
    g.fillRect(r() * 256, r() * 256, 0.5 + r() * 2, 0.5 + r() * 2);
  }
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = "#5b5c3527";
    g.lineWidth = 0.5;
    const x = r() * 256,
      y = r() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + r() * 15, y + r() * 8);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(65, 65);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function addInstances(scene, template, placements) {
  const meshes = [];
  template.updateMatrixWorld(true);
  template.traverse((child) => {
    if (!child.isMesh) return;
    const inst = new THREE.InstancedMesh(
      child.geometry,
      child.material,
      placements.length,
    );
    inst.castShadow = true;
    inst.receiveShadow = true;
    placements.forEach((p, i) => {
      const mat = new THREE.Matrix4().compose(
        V(p.x, p.y ?? heightAt(p.x, p.z), p.z),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, p.angle || 0, 0),
        ),
        V(p.scale || 1, p.scale || 1, p.scale || 1),
      );
      mat.multiply(child.matrixWorld);
      inst.setMatrixAt(i, mat);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    scene.add(inst);
    meshes.push(inst);
  });
  return meshes;
}
function grassGeometry() {
  const b = new Batch(new THREE.Group()),
    r = random(71),
    m = forestMaterials().grass;
  for (let i = 0; i < 8; i++) {
    const a = r() * 7,
      x = (r() - 0.5) * 0.4,
      z = (r() - 0.5) * 0.4,
      h = 0.25 + r() * 0.4,
      w = 0.03 + r() * 0.025;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, 0.09, h, 0], 3),
    );
    geo.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2),
    );
    geo.computeVertexNormals();
    geo.rotateY(a);
    b.add(geo, m, x, 0, z);
  }
  b.finish();
  return b.parent;
}
function makeResource(def) {
  const root = new THREE.Group(),
    m = forestMaterials(),
    r = random(def.x * 71 + def.z * 321),
    b = new Batch(root);
  root.name = def.name;
  if (def.type === "wood") {
    const log = buildLog(0.95 + r() * 0.45, 0.075);
    log.rotation.y = r() * 6;
    root.add(log);
    const twig = buildLog(0.64, 0.045);
    twig.rotation.y = 2;
    twig.position.set(0.25, 0.015, 0.19);
    root.add(twig);
  }
  if (def.type === "stone") {
    for (let i = 0; i < 3; i++)
      b.add(
        rockGeometry(0.15 + i * 0.035, i + 3),
        m.rock,
        Math.sin(i * 2) * 0.21,
        0.09,
        Math.cos(i * 2) * 0.18,
      );
  }
  if (def.type === "fiber") {
    const fern = buildFern(0.65, def.x);
    root.add(fern);
    for (let i = 0; i < 4; i++) {
      b.cylinder(
        m.woodDark,
        0.012,
        0.65 + i * 0.06,
        Math.sin(i * 2) * 0.13,
        0.32,
        Math.cos(i * 2) * 0.13,
      );
      b.add(
        new THREE.IcosahedronGeometry(0.045, 0),
        material("#d0ccb0"),
        Math.sin(i * 2) * 0.13,
        0.67 + i * 0.05,
        Math.cos(i * 2) * 0.13,
      );
    }
  }
  if (def.type === "berries") {
    for (let i = 0; i < 5; i++) {
      const a = i * 2.4;
      b.add(
        new THREE.IcosahedronGeometry(0.23, 1),
        m.pineMid,
        Math.cos(a) * 0.22,
        0.4 + (i % 2) * 0.1,
        Math.sin(a) * 0.22,
      );
    }
    const red = material("#9b5952");
    for (let i = 0; i < 14; i++) {
      const a = i * 2.4;
      b.add(
        new THREE.SphereGeometry(0.033, 6, 5),
        red,
        Math.cos(a) * (0.24 + r() * 0.13),
        0.43 + r() * 0.2,
        Math.sin(a) * (0.24 + r() * 0.13),
      );
    }
  }
  b.finish();
  root.position.set(def.x, heightAt(def.x, def.z), def.z);
  return root;
}
export function buildWorld(scene) {
  const world = new THREE.Group();
  world.name = "Blackwater_woods";
  scene.add(world);
  const m = forestMaterials(),
    rng = random(48625),
    obstacles = [],
    mapTrees = [],
    farMeshes = [],
    nearMeshes = [];
  // A continuous height field, with a dirt path and a gently eroded lakeshore.
  const terrain = new THREE.PlaneGeometry(220, 220, 110, 110);
  terrain.rotateX(-Math.PI / 2);
  const positions = terrain.attributes.position,
    colors = new Float32Array(positions.count * 3),
    green = new THREE.Color("#5d7058"),
    soil = new THREE.Color("#94846a"),
    temp = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      z = positions.getZ(i),
      y = heightAt(x, z);
    positions.setY(i, y);
    const path = -1 + Math.sin(z * 0.115) * 2.6,
      blend = Math.exp(-Math.pow((x - path) / 2.1, 2));
    temp
      .copy(green)
      .lerp(soil, blend * 0.9)
      .multiplyScalar(0.82 + rng() * 0.23);
    colors.set([temp.r, temp.g, temp.b], i * 3);
  }
  terrain.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  terrain.computeVertexNormals();
  const ground = mesh(
    world,
    terrain,
    material("#ffffff", {
      map: terrainTexture(),
      vertexColors: true,
      roughness: 1,
    }),
  );
  ground.castShadow = false;

  // Real 3D branch-and-needle pines in the near field; lighter silhouettes in the distance.
  const near = [],
    far = [];
  const manual = [
    [-8, 27, 1.18],
    [11, 24, 1.2],
    [-15, 23, 1.03],
    [-15, -8, 1.2],
    [12, -1, 1.14],
    [-22, -5, 1.2],
    [-20, 33, 1.05],
    [17, -28, 1.3],
    [-8, -23, 1.15],
  ];
  for (const [x, z, scale] of manual) {
    near.push({ x, z, scale, angle: rng() * 6 });
    obstacles.push({ x, z, radius: 0.35 * scale });
    mapTrees.push({ x, z });
  }
  for (let i = 0; i < 680; i++) {
    const x = -96 + rng() * 121,
      z = -98 + rng() * 195;
    if (x > shoreX(z) - 3) continue;
    const clearing = ((x + 2) / 12) ** 2 + ((z - 11) / 20) ** 2;
    if (
      clearing < 1 ||
      RESOURCE_DEFS.some((r) => distance({ x, z }, r) < 2.6) ||
      TREE_DEFS.some((t) => distance({ x, z }, t) < 3)
    )
      continue;
    if (
      near.some((p) => distance(p, { x, z }) < 4.6) ||
      far.some((p) => distance(p, { x, z }) < 4.8)
    )
      continue;
    const p = { x, z, scale: 0.76 + rng() * 0.66, angle: rng() * 6 };
    if (x > -43 && z > -46 && z < 62) {
      near.push(p);
      obstacles.push({ x, z, radius: 0.32 * p.scale });
    } else far.push(p);
    mapTrees.push({ x, z });
  }
  nearMeshes.push(...addInstances(world, buildPine(15, 72, true), near));
  farMeshes.push(...addInstances(world, buildPine(19, 9, false), far));
  // The harvestable trees retain individual pivots so they can actually fall.
  const trees = TREE_DEFS.map((def, i) => {
    const root = buildPine(def.height, 129 + i * 19, true);
    root.position.set(def.x, heightAt(def.x, def.z), def.z);
    world.add(root);
    const stump = mesh(
      world,
      new THREE.CylinderGeometry(
        def.height * 0.022,
        def.height * 0.025,
        0.36,
        9,
      ),
      m.bark,
      def.x,
      heightAt(def.x, def.z) + 0.18,
      def.z,
    );
    stump.visible = false;
    const cap = mesh(
      world,
      new THREE.CircleGeometry(def.height * 0.022, 9),
      m.cut,
      def.x,
      heightAt(def.x, def.z) + 0.363,
      def.z,
    );
    cap.rotation.x = -Math.PI / 2;
    cap.visible = false;
    obstacles.push({ x: def.x, z: def.z, radius: def.height * 0.024 });
    mapTrees.push(def);
    return { ...def, root, stump, cap, fall: null };
  });
  const resources = RESOURCE_DEFS.map((def) => {
    const root = makeResource(def);
    world.add(root);
    return { ...def, root };
  });

  const props = new Batch(world),
    rockPoints = [];
  for (let i = 0; i < 60; i++) {
    const x = -48 + rng() * 69,
      z = -50 + rng() * 108;
    if (
      x > shoreX(z) - 1 ||
      distance({ x, z }, CAMP) < 7 ||
      RESOURCE_DEFS.some((r) => distance({ x, z }, r) < 2.1) ||
      Math.abs(x - (-1 + Math.sin(z * 0.115) * 2.6)) < 3
    )
      continue;
    const radius = 0.35 + rng() * 0.9;
    props.add(
      rockGeometry(radius, i),
      i % 4 === 0 ? m.moss : m.rock,
      x,
      heightAt(x, z) + radius * 0.24,
      z,
      0,
      rng() * 6,
    );
    obstacles.push({ x, z, radius: radius * 0.7 });
    rockPoints.push({ x, z, radius });
  }
  // Two larger mossy rocks frame the clearing.
  for (const [x, z, r] of [
    [8.8, 5.2, 1.8],
    [-9, -0.5, 1.55],
    [-9, 26, 1.1],
  ]) {
    props.add(rockGeometry(r, 5), m.rock, x, heightAt(x, z) + r * 0.15, z);
    obstacles.push({ x, z, radius: r * 0.7 });
    rockPoints.push({ x, z, radius: r });
  }
  props.finish();
  const fernPlaces = [
    { x: -5.5, z: 24, scale: 1.1, angle: 2 },
    { x: 6, z: 24, scale: 1.2, angle: 0 },
    { x: 8, z: 17, scale: 0.9, angle: 1 },
    { x: -7, z: 18, scale: 0.9, angle: 3 },
  ];
  for (let i = 0; i < 190; i++) {
    const x = -39 + rng() * 65,
      z = -48 + rng() * 108;
    if (
      x > shoreX(z) - 1.7 ||
      distance({ x, z }, CAMP) < 5.5 ||
      Math.abs(x - (-1 + Math.sin(z * 0.115) * 2.6)) < 2
    )
      continue;
    fernPlaces.push({ x, z, scale: 0.5 + rng() * 0.8, angle: rng() * 6 });
  }
  const fernMeshes = addInstances(world, buildFern(1, 40), fernPlaces);
  const grassPlaces = [];
  for (let i = 0; i < 3600; i++) {
    const x = -58 + rng() * 88,
      z = -67 + rng() * 140;
    if (
      x > shoreX(z) - 0.6 ||
      distance({ x, z }, CAMP) < 4 ||
      Math.abs(x - (-1 + Math.sin(z * 0.115) * 2.6)) < 1.75
    )
      continue;
    grassPlaces.push({ x, z, scale: 0.55 + rng() * 0.95, angle: rng() * 6 });
  }
  const grassMeshes = addInstances(world, grassGeometry(), grassPlaces);
  // Fallen timber, a hand-made trail sign, and a narrow jetty.
  for (const [x, z, a] of [
    [-8, -5, 0.7],
    [13, -11, 0.9],
    [-18, 24, -0.5],
  ]) {
    const log = buildLog(3, 0.24);
    log.position.set(x, heightAt(x, z), z);
    log.rotation.y = a;
    world.add(log);
  }
  const furniture = new Batch(world);
  const signX = -6.8,
    signZ = 21.5,
    signY = heightAt(signX, signZ);
  furniture.cylinder(m.woodDark, 0.075, 1.55, signX, signY + 0.75, signZ);
  furniture.box(m.wood, 1.12, 0.22, 0.09, signX, signY + 1.35, signZ, -0.12);
  const label = document.createElement("canvas");
  label.width = 512;
  label.height = 128;
  const lg = label.getContext("2d");
  lg.fillStyle = "#d0c7a6";
  lg.font = "500 42px Space";
  lg.textAlign = "center";
  lg.fillText("BLACKWATER  →", 256, 78);
  const lt = new THREE.CanvasTexture(label);
  lt.colorSpace = THREE.SRGBColorSpace;
  const labelMesh = mesh(
    world,
    new THREE.PlaneGeometry(1.06, 0.26),
    new THREE.MeshStandardMaterial({
      map: lt,
      transparent: true,
      roughness: 1,
    }),
    signX,
    signY + 1.35,
    signZ + 0.051,
  );
  labelMesh.rotation.y = -0.12;
  for (let x = 22; x < 30; x += 0.3)
    furniture.box(m.wood, 0.28, 0.09, 1.5, x, -0.18, 12);
  for (const x of [22, 25, 28])
    for (const z of [11.4, 12.6])
      furniture.cylinder(m.woodDark, 0.07, 1.5, x, -0.8, z);
  furniture.finish();

  const waterMat = new THREE.ShaderMaterial({
    transparent: false,
    side: THREE.DoubleSide,
    uniforms: {
      time: { value: 0 },
      night: { value: 0 },
      fogColor: { value: new THREE.Color("#91a18c") },
    },
    vertexShader: `uniform float time;varying vec3 vWorld;varying vec3 vPos;void main(){vec3 p=position;p.y+=sin(p.x*.4+time*.6)*.025+sin(p.z*.28+time*.5)*.035;vPos=p;vWorld=(modelMatrix*vec4(p,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}`,
    fragmentShader: `uniform float time;uniform float night;uniform vec3 fogColor;varying vec3 vWorld;varying vec3 vPos;
      void main(){float wave=sin(vPos.x*1.7+vPos.z*.8+time*.8)*sin(vPos.z*2.6-vPos.x*.4+time*.5);float broad=sin(vPos.z*.045+sin(vPos.x*.05)*2.);vec3 col=mix(vec3(.16,.24,.21),vec3(.46,.53,.43),broad*.35+.35);vec3 view=normalize(cameraPosition-vWorld);float fres=pow(1.-abs(view.y),3.);col=mix(col,vec3(.64,.66,.52),fres*.50);col+=vec3(.24,.22,.14)*pow(max(0.,wave),13.)*.20;col*=1.-night*.77;float fog=1.-exp(-length(cameraPosition-vWorld)*.009);col=mix(col,fogColor,fog*.58);gl_FragColor=vec4(col,1.);}`,
  });
  const waterGeo = new THREE.PlaneGeometry(160, 270, 35, 55);
  waterGeo.rotateX(-Math.PI / 2);
  const water = mesh(world, waterGeo, waterMat, 87, -0.47, 0);
  water.castShadow = false;
  water.receiveShadow = false;
  // Distant ridges soften the skyline beyond the lake.
  const mountainMat = material("#657d70", { roughness: 1 });
  const ridge = new Batch(world);
  for (let i = 0; i < 12; i++) {
    const x = -100 + i * 22,
      h = 20 + rng() * 38;
    ridge.add(
      new THREE.ConeGeometry(29 + rng() * 15, h, 7),
      mountainMat,
      x,
      h / 2 - 6,
      -118 - rng() * 30,
      0,
      rng() * 3,
    );
  }
  ridge.finish();

  const campfire = buildCampfire(false);
  campfire.root.position.set(
    FIRE_SITE.x,
    heightAt(FIRE_SITE.x, FIRE_SITE.z),
    FIRE_SITE.z,
  );
  campfire.root.visible = false;
  world.add(campfire.root);
  const shelter = buildShelter();
  shelter.position.set(
    SHELTER_SITE.x,
    heightAt(SHELTER_SITE.x, SHELTER_SITE.z),
    SHELTER_SITE.z,
  );
  shelter.visible = false;
  world.add(shelter);
  const ghost = new THREE.Group();
  ghost.position.copy(shelter.position);
  world.add(ghost);
  const ghostLines = [
    V(-1.4, 0, 1.1),
    V(-1.4, 1.9, -0.8),
    V(1.4, 1.9, -0.8),
    V(1.4, 0, 1.1),
    V(-1.4, 0, 1.1),
  ];
  ghost.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ghostLines),
      new THREE.LineDashedMaterial({
        color: "#e0c591",
        transparent: true,
        opacity: 0.3,
        dashSize: 0.15,
        gapSize: 0.15,
      }),
    ),
  );
  ghost.children[0].computeLineDistances();
  const fireGhost = mesh(
    world,
    new THREE.RingGeometry(0.85, 0.88, 48),
    new THREE.MeshBasicMaterial({
      color: "#dac296",
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
    }),
    FIRE_SITE.x,
    heightAt(FIRE_SITE.x, FIRE_SITE.z) + 0.025,
    FIRE_SITE.z,
  );
  fireGhost.rotation.x = -Math.PI / 2;
  fireGhost.castShadow = false;
  const fireLight = new THREE.PointLight("#ffad52", 0, 20, 2);
  fireLight.position.copy(campfire.root.position).add(V(0, 0.9, 0));
  scene.add(fireLight);
  const torchLight = new THREE.PointLight("#ffd58b", 0, 11, 1);
  scene.add(torchLight);

  const deer = [
    [-16, -17],
    [-27, -4],
  ].map(([x, z], i) => {
    const d = buildDeer();
    d.origin = { x, z };
    d.root.position.set(x, heightAt(x, z), z);
    world.add(d.root);
    return d;
  });
  const wolves = [
    [-22, -24],
    [1, -37],
  ].map(([x, z], i) => {
    const w = buildWolf();
    w.origin = { x, z };
    w.root.position.set(x, heightAt(x, z), z);
    w.index = i;
    world.add(w.root);
    return w;
  });
  const particleGeo = new THREE.BufferGeometry(),
    particlePos = new Float32Array(180 * 3);
  for (let i = 0; i < 180; i++)
    particlePos.set(
      [(rng() - 0.5) * 55, rng() * 11, (rng() - 0.5) * 55],
      i * 3,
    );
  particleGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(particlePos, 3),
  );
  const particles = new THREE.Points(
    particleGeo,
    new THREE.PointsMaterial({
      color: "#f1dfb0",
      size: 0.035,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
  );
  particles.frustumCulled = false;
  world.add(particles);
  const chipGeometry = new THREE.BoxGeometry(0.065, 0.035, 0.045),
    chipMaterial = material("#b59d6b");
  const chips = [];
  function burst(pos, type = "wood") {
    for (let i = 0; i < 12; i++) {
      const p = new THREE.Mesh(chipGeometry, chipMaterial);
      p.position.set(
        pos.x,
        heightAt(pos.x, pos.z) + (type === "wood" ? 1 : 0.25),
        pos.z,
      );
      world.add(p);
      chips.push({
        mesh: p,
        v: V((rng() - 0.5) * 3.4, 1.4 + rng() * 2.2, (rng() - 0.5) * 3.4),
        age: 0,
      });
    }
  }
  function fallTree(id, animate = true) {
    const tree = trees.find((t) => t.id === id);
    if (!tree) return;
    tree.stump.visible = tree.cap.visible = true;
    if (animate) {
      tree.fall = { age: 0 };
      burst(tree);
    } else tree.root.visible = false;
  }
  function sync(state, animate = false) {
    resources.forEach((r) => (r.root.visible = !state.collected.has(r.id)));
    trees.forEach((t) => {
      if (state.felled.has(t.id) && t.root.visible && !t.fall)
        fallTree(t.id, animate);
    });
    campfire.root.visible = state.built.fire;
    campfire.flames.visible = state.fireLit;
    shelter.visible = state.built.shelter;
    ghost.visible = !state.built.shelter;
    fireGhost.visible = !state.built.fire;
  }
  const windShaders = new Set();
  m.needles.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = { value: 0 };
    shader.vertexShader = "uniform float windTime;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\ntransformed.x += sin(windTime*.8 + position.y*.45)*.065*smoothstep(2.,12.,position.y);",
    );
    windShaders.add(shader);
  };
  m.needles.customProgramCacheKey = () => "hollowpine-needles-v1";
  function update(dt, time, player, state, options = {}) {
    waterMat.uniforms.time.value = time;
    for (const shader of windShaders)
      shader.uniforms.windTime.value = options.reducedMotion ? 0 : time;
    particles.position.set(player.x, 0, player.z);
    particles.rotation.y = time * 0.004;
    if (!options.paused) {
      trees.forEach((t) => {
        if (t.fall) {
          t.fall.age += dt;
          const k = Math.min(1, t.fall.age / 1.5);
          t.root.rotation.z = (-k * k * Math.PI) / 2;
          t.root.position.y = heightAt(t.x, t.z) - k * 0.1;
          if (k >= 1) {
            t.root.visible = false;
            t.fall = null;
          }
        }
      });
      for (let i = chips.length - 1; i >= 0; i--) {
        const c = chips[i];
        c.age += dt;
        c.v.y -= dt * 6;
        c.mesh.position.addScaledVector(c.v, dt);
        c.mesh.rotation.x += dt * 3;
        if (c.age > 1.2) {
          world.remove(c.mesh);
          chips.splice(i, 1);
        }
      }
      deer.forEach((d, i) => {
        const x = d.origin.x + Math.sin(time * 0.07 + i) * 2.4,
          z = d.origin.z + Math.cos(time * 0.06 + i) * 1.2;
        d.root.rotation.y = Math.atan2(
          -(x - d.root.position.x),
          -(z - d.root.position.z),
        );
        d.root.position.set(x, heightAt(x, z), z);
        d.animate(time, 0.5);
      });
      wolves.forEach((w, i) => {
        const afraid =
          options.torch || (state.fireLit && distance(player, FIRE_SITE) < 8);
        const hunting =
          state.night &&
          options.threats &&
          state.active &&
          !afraid &&
          distance(player, w.root.position) < 24;
        const target = hunting
          ? player
          : {
              x: w.origin.x + Math.sin(time * 0.1 + i) * 5,
              z: w.origin.z + Math.cos(time * 0.08 + i) * 4,
            };
        const dx = target.x - w.root.position.x,
          dz = target.z - w.root.position.z,
          len = Math.hypot(dx, dz),
          speed = hunting ? 1.95 : 0.6;
        if (len > 0.8) {
          w.root.position.x += (dx / len) * dt * speed;
          w.root.position.z += (dz / len) * dt * speed;
          w.root.rotation.y = Math.atan2(-dx, -dz);
          w.animate(time * speed);
        }
        w.root.position.y = heightAt(w.root.position.x, w.root.position.z);
      });
    }
    campfire.animate(time);
    campfire.flames.visible = state.fireLit;
    fireLight.intensity = state.fireLit ? 27 + Math.sin(time * 8) * 4 : 0;
    torchLight.intensity = options.torch ? 6 + Math.sin(time * 11) * 0.5 : 0;
    torchLight.position.set(
      player.x - Math.sin(player.angle) * 0.55 + Math.cos(player.angle) * 0.33,
      player.y + 1.45,
      player.z - Math.cos(player.angle) * 0.55 - Math.sin(player.angle) * 0.33,
    );
    return wolves.some(
      (w) =>
        state.night &&
        options.threats &&
        !options.torch &&
        !(state.fireLit && distance(player, FIRE_SITE) < 8) &&
        distance(w.root.position, player) < 1.2,
    );
  }
  function quality(low) {
    grassMeshes.forEach(
      (g) =>
        (g.count = low
          ? Math.floor(grassPlaces.length * 0.5)
          : grassPlaces.length),
    );
    fernMeshes.forEach(
      (g) =>
        (g.count = low
          ? Math.floor(fernPlaces.length * 0.65)
          : fernPlaces.length),
    );
    particles.visible = !low;
  }
  return {
    root: world,
    ground,
    obstacles,
    mapTrees,
    rockPoints,
    trees,
    resources,
    campfire,
    shelter,
    fireLight,
    torchLight,
    deer,
    wolves,
    waterMat,
    burst,
    fallTree,
    sync,
    update,
    quality,
  };
}

export function createAtmosphere(scene) {
  scene.fog = new THREE.FogExp2("#95a58f", 0.012);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { night: { value: 0 } },
    vertexShader:
      "varying vec3 vPos;void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader: `uniform float night;varying vec3 vPos;void main(){vec3 p=normalize(vPos);float h=max(0.,p.y);vec3 day=mix(vec3(.74,.74,.59),vec3(.38,.52,.52),pow(h,.45));vec3 dark=mix(vec3(.085,.13,.16),vec3(.025,.05,.09),pow(h,.4));float sun=pow(max(0.,dot(p,normalize(vec3(-.6,.32,-.8)))),160.);gl_FragColor=vec4(mix(day,dark,night)+vec3(.9,.6,.25)*sun*(1.-night),1.);}`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 24, 16), skyMat);
  scene.add(sky);
  const hemi = new THREE.HemisphereLight("#e8ead6", "#3b4932", 2.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#ffe0a5", 3);
  sun.position.set(-32, 42, -35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -38,
    right: 38,
    top: 40,
    bottom: -40,
    near: 1,
    far: 150,
  });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.12;
  scene.add(sun);
  scene.add(sun.target);
  const fill = new THREE.DirectionalLight("#b4cec3", 0.5);
  fill.position.set(30, 15, 15);
  scene.add(fill);
  const shafts = new THREE.Group();
  scene.add(shafts);
  for (const [x, z] of [
    [-9, -9],
    [-6, -24],
  ]) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(3, 19, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: "#eddb9f",
        transparent: true,
        opacity: 0.018,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    cone.position.set(x, 11, z);
    cone.rotation.z = -0.55;
    shafts.add(cone);
  }
  const dawn = new THREE.Color("#95a58f"),
    nightColor = new THREE.Color("#1d3038");
  function update(hour, world) {
    let night =
      hour >= 18
        ? clamp((hour - 18) / 2.7, 0, 1)
        : hour < 5
          ? 1
          : 1 - clamp((hour - 5) / 2, 0, 1);
    night = night * night * (3 - 2 * night);
    skyMat.uniforms.night.value = night;
    hemi.intensity = 2.05 - night * 1.67;
    sun.intensity = 3 - night * 2.72;
    fill.intensity = 0.5 - night * 0.28;
    sun.color.set(night > 0.7 ? "#b0cbd9" : "#ffe0a5");
    scene.fog.color.copy(dawn).lerp(nightColor, night);
    scene.fog.density = 0.012 + night * 0.004;
    shafts.visible = night < 0.4;
    world.waterMat.uniforms.night.value = night;
    world.waterMat.uniforms.fogColor.value.copy(scene.fog.color);
    return night;
  }
  return { sun, hemi, sky, update };
}
