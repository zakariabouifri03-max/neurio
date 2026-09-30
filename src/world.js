// ── Infinite Streaming Desert Highway, POIs, Loot & Day/Night Manager ────────
import * as THREE from 'three';
import {
  CAR_ARCHETYPES,
  CAR_BY_ID,
  POI_TYPES,
  PAINT_COLORS,
  createItemInstance,
} from './data.js';
import {
  highwayTexture,
  highwayBumpTexture,
  sandTexture,
  sandBumpTexture,
  starsTexture,
  glowTexture,
} from './tex.js';
import {
  buildStarterCompound,
  buildRoadsidePOI,
  buildTelephonePole,
  buildMilepost,
  buildCactus,
  buildBoulder,
} from './builders.js';
import {
  mulberry32,
  clamp,
  lerp,
  rand,
  pick,
  roadX,
  roadY,
  roadHeading,
  terrainHeight,
} from './util.js';

export const CHUNK_LEN = 160; // meters per highway chunk

export class DesertWorld {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;

    this.chunks = new Map(); // chunkIdx -> { group, colliders, rocks, poiInfo }
    this.visitedChunks = new Set();
    this.drawChunksBehind = 6;
    this.drawChunksAhead = 9;

    // Pre-computed deterministic set of long-distance random POI chunks
    this._poiChunksPos = new Map(); // chunkIdx -> poiTypeIndex
    this._poiChunksNeg = new Map();
    this._maxGeneratedPos = 0;
    this._maxGeneratedNeg = 0;

    // Shared materials for road & sand with high-res procedural bump maps
    const roadTex = highwayTexture();
    const roadBump = highwayBumpTexture();
    this.roadMat = new THREE.MeshStandardMaterial({
      map: roadTex,
      bumpMap: roadBump,
      bumpScale: 0.08,
      roughness: 0.84,
      metalness: 0.07,
    });

    const sandTex = sandTexture();
    sandTex.repeat.set(20, 11);
    const sandBump = sandBumpTexture();
    sandBump.repeat.set(20, 11);
    this.sandMat = new THREE.MeshStandardMaterial({
      map: sandTex,
      bumpMap: sandBump,
      bumpScale: 0.22,
      roughness: 0.94,
      metalness: 0.02,
    });

    this.wireMat = new THREE.LineBasicMaterial({ color: 0x18181b });

    this._initSkyAndLights();
  }

  _initSkyAndLights() {
    // Long desert horizon fog & sky background
    this.scene.background = new THREE.Color(0x7cc4f8);
    this.scene.fog = new THREE.FogExp2(0xd8b88c, 0.0011);

    // Hemisphere + Directional Sun Light
    this.hemiLight = new THREE.HemisphereLight(0xbae6fd, 0xc29b61, 0.78);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff4d6, 2.1);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 180;
    const d = 52;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0006;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Star dome (follows player)
    const starGeo = new THREE.SphereGeometry(1100, 24, 16);
    this.starMat = new THREE.MeshBasicMaterial({
      map: starsTexture(),
      side: THREE.BackSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.starDome = new THREE.Mesh(starGeo, this.starMat);
    this.scene.add(this.starDome);

    // Sun & Moon Billboards
    this.sunSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture('rgba(255,252,225,1)', 'rgba(255,180,60,0)'),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.sunSprite.scale.set(140, 140, 1);
    this.scene.add(this.sunSprite);

    this.moonSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture('rgba(225,240,255,0.95)', 'rgba(120,170,255,0)'),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.moonSprite.scale.set(80, 80, 1);
    this.scene.add(this.moonSprite);
  }

  updateAtmosphere(focusPos, timeOfDay) {
    const sunAngle = ((timeOfDay - 6) / 24) * Math.PI * 2;
    const sunElev = Math.sin(sunAngle);
    const sunHoriz = Math.cos(sunAngle);

    const sunVec = new THREE.Vector3(-sunHoriz * 0.65, sunElev, 0.45).normalize();
    this.sunSprite.position.copy(focusPos).addScaledVector(sunVec, 820);
    this.moonSprite.position.copy(focusPos).addScaledVector(sunVec, -820);
    this.starDome.position.copy(focusPos);

    const lightDir = sunElev >= -0.08 ? sunVec : sunVec.clone().negate();
    this.sunLight.position.copy(focusPos).addScaledVector(lightDir, 68);
    this.sunLight.target.position.copy(focusPos);

    const dayFactor = clamp((sunElev + 0.12) / 0.45, 0, 1);
    const sunsetFactor = clamp(1 - Math.abs(sunElev - 0.05) / 0.25, 0, 1);
    const nightFactor = clamp((-sunElev - 0.02) / 0.28, 0, 1);

    const skyDay = new THREE.Color(0x68b5f0);
    const skySunset = new THREE.Color(0xd96b38);
    const skyNight = new THREE.Color(0x060913);

    const fogDay = new THREE.Color(0xdcc096);
    const fogSunset = new THREE.Color(0xc2593f);
    const fogNight = new THREE.Color(0x080c17);

    const skyCol = skyNight.clone().lerp(skyDay, dayFactor).lerp(skySunset, sunsetFactor * 0.75);
    const fogCol = fogNight.clone().lerp(fogDay, dayFactor).lerp(fogSunset, sunsetFactor * 0.8);

    this.scene.background.copy(skyCol);
    this.scene.fog.color.copy(fogCol);

    this.sunLight.intensity = lerp(0.18, 2.2, dayFactor);
    if (sunsetFactor > 0.2) {
      this.sunLight.color.setHex(0xff9e5e);
    } else if (nightFactor > 0.5) {
      this.sunLight.color.setHex(0x6488b8);
    } else {
      this.sunLight.color.setHex(0xfff4d6);
    }

    this.hemiLight.intensity = lerp(0.18, 0.84, dayFactor);
    this.starMat.opacity = nightFactor * 0.92;
    this.sunSprite.visible = sunElev > -0.15;
    this.moonSprite.visible = sunElev < 0.15;
  }

  // Determine if a chunk has a Roadside Landmark (Palace, House, Kasbah, Bus Depot, or Gas Station)
  // separated by VERY LONG, RANDOMIZED distances (6 to 14 chunks = ~1.0 KM to ~2.25 KM apart!)
  _getPoiTypeForChunk(chunkIdx) {
    if (Math.abs(chunkIdx) < 5) return null;
    if (chunkIdx > 0) {
      if (!this._poiCursorPosRng) {
        this._poiCursorPosRng = mulberry32(739153);
        this._poiCursorPos = 0;
        this._poiLastTypePos = -1;
      }
      while (this._poiCursorPos <= chunkIdx + 20) {
        // Random long distance between landmarks: 6 to 14 chunks (960m to 2,240m)
        const gap = this._poiCursorPos === 0
          ? 5 + Math.floor(this._poiCursorPosRng() * 4) // First landmark between 0.8 KM and 1.3 KM
          : 6 + Math.floor(this._poiCursorPosRng() * 9); // Subsequent landmarks 1.0 KM to 2.25 KM apart
        this._poiCursorPos += gap;
        let typeIdx = Math.floor(this._poiCursorPosRng() * POI_TYPES.length);
        if (typeIdx === this._poiLastTypePos) {
          typeIdx = (typeIdx + 1) % POI_TYPES.length;
        }
        this._poiLastTypePos = typeIdx;
        this._poiChunksPos.set(this._poiCursorPos, POI_TYPES[typeIdx]);
      }
      return this._poiChunksPos.get(chunkIdx) || null;
    } else {
      const absIdx = Math.abs(chunkIdx);
      if (!this._poiCursorNegRng) {
        this._poiCursorNegRng = mulberry32(482719);
        this._poiCursorNeg = 0;
        this._poiLastTypeNeg = -1;
      }
      while (this._poiCursorNeg <= absIdx + 20) {
        const gap = this._poiCursorNeg === 0
          ? 5 + Math.floor(this._poiCursorNegRng() * 4)
          : 6 + Math.floor(this._poiCursorNegRng() * 9);
        this._poiCursorNeg += gap;
        let typeIdx = Math.floor(this._poiCursorNegRng() * POI_TYPES.length);
        if (typeIdx === this._poiLastTypeNeg) {
          typeIdx = (typeIdx + 1) % POI_TYPES.length;
        }
        this._poiLastTypeNeg = typeIdx;
        this._poiChunksNeg.set(-this._poiCursorNeg, POI_TYPES[typeIdx]);
      }
      return this._poiChunksNeg.get(chunkIdx) || null;
    }
  }

  // Stream chunks infinitely in BOTH directions (-Z and +Z) with configurable draw distance!
  updateChunks(centerZ) {
    const curIdx = Math.floor(centerZ / CHUNK_LEN);
    const minIdx = curIdx - (this.drawChunksBehind || 6);
    const maxIdx = curIdx + (this.drawChunksAhead || 9);

    for (let idx = minIdx; idx <= maxIdx; idx++) {
      if (!this.chunks.has(idx)) {
        this._buildChunk(idx);
      }
    }

    for (const [idx, ch] of this.chunks.entries()) {
      if (idx < minIdx - 1 || idx > maxIdx + 1) {
        this.scene.remove(ch.group);
        this.chunks.delete(idx);
      }
    }
  }

  getGroundHeight(x, z) {
    const idx = Math.floor(z / CHUNK_LEN);
    const ch = this.chunks.get(idx);
    if (ch && ch.poiInfo) {
      const dx = Math.abs(x - ch.poiInfo.x);
      const dz = Math.abs(z - ch.poiInfo.z);
      if (dx < 13 && dz < 15) {
        return ch.poiInfo.y + 0.08;
      }
    }
    if (x > -29 && x < -3 && z > -2 && z < 22) {
      return 0.08;
    }
    return terrainHeight(x, z);
  }

  _buildChunk(chunkIdx) {
    const z0 = chunkIdx * CHUNK_LEN;
    const z1 = z0 + CHUNK_LEN;
    const group = new THREE.Group();
    const colliders = [];
    const rocks = [];
    let poiInfo = null;

    // ── 1. Road Ribbon Mesh ──
    const segsZ = 24;
    const roadHalfW = 4.6;
    const rPos = [];
    const rNorm = [];
    const rUv = [];
    const rIndices = [];

    for (let i = 0; i <= segsZ; i++) {
      const f = i / segsZ;
      const z = lerp(z0, z1, f);
      const rx = roadX(z);
      const ry = roadY(z) + 0.06;
      const hdg = roadHeading(z);
      const px = Math.cos(hdg);
      const pz = -Math.sin(hdg);

      rPos.push(rx - px * roadHalfW, ry, z - pz * roadHalfW);
      rPos.push(rx + px * roadHalfW, ry, z + pz * roadHalfW);
      rNorm.push(0, 1, 0, 0, 1, 0);
      const v = z / 14;
      rUv.push(0, v, 1, v);

      if (i < segsZ) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        rIndices.push(a, c, b, b, c, d);
      }
    }
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
    roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(rNorm, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(rUv, 2));
    roadGeo.setIndex(rIndices);
    const roadMesh = new THREE.Mesh(roadGeo, this.roadMat);
    roadMesh.receiveShadow = true;
    group.add(roadMesh);

    // ── 2. Desert Terrain Grid Mesh ──
    const gridX = 34, gridZ = 18;
    const halfSpanX = 210;
    const tPos = [];
    const tUv = [];
    const tIndices = [];

    // Roadside Landmarks (Palaces "9osssor", Houses "Dyor", Kasbahs, Bus Depots, Gas Stations)
    // spawn at VERY LONG, RANDOMIZED intervals along the endless highway!
    const poiDef = this._getPoiTypeForChunk(chunkIdx);
    const hasPOI = Boolean(poiDef);
    const poiSeed = (9001 + chunkIdx * 1337) >>> 0;
    const rngPoi = mulberry32(poiSeed);
    const poiSide = rngPoi() > 0.48 ? 1 : -1;
    const poiZ = z0 + CHUNK_LEN * (0.28 + rngPoi() * 0.44);
    const poiRoadX = roadX(poiZ);
    const poiRoadY = roadY(poiZ);
    const poiX = poiRoadX + poiSide * (poiDef && poiDef.archStyle === 'palace' ? 18.5 : 16.0);

    for (let iz = 0; iz <= gridZ; iz++) {
      const fz = iz / gridZ;
      const z = lerp(z0, z1, fz);
      const centerRx = roadX(z);
      for (let ix = 0; ix <= gridX; ix++) {
        const fx = ix / gridX;
        const x = centerRx + lerp(-halfSpanX, halfSpanX, fx);
        let y = terrainHeight(x, z);

        if (hasPOI) {
          const dPoi = Math.hypot(x - poiX, z - poiZ);
          if (dPoi < 24) {
            const blend = clamp((dPoi - 14) / 10, 0, 1);
            y = lerp(poiRoadY, y, blend);
          }
        }
        if (Math.abs(x - centerRx) < roadHalfW + 0.4) {
          y = roadY(z) - 0.02;
        }
        tPos.push(x, y, z);
        tUv.push(fx * 20, (z / CHUNK_LEN) * 10);
      }
    }

    for (let iz = 0; iz < gridZ; iz++) {
      for (let ix = 0; ix < gridX; ix++) {
        const row1 = iz * (gridX + 1);
        const row2 = (iz + 1) * (gridX + 1);
        const a = row1 + ix, b = row1 + ix + 1, c = row2 + ix, d = row2 + ix + 1;
        tIndices.push(a, c, b, b, c, d);
      }
    }

    const terrGeo = new THREE.BufferGeometry();
    terrGeo.setAttribute('position', new THREE.Float32BufferAttribute(tPos, 3));
    terrGeo.setAttribute('uv', new THREE.Float32BufferAttribute(tUv, 2));
    terrGeo.setIndex(tIndices);
    terrGeo.computeVertexNormals();
    const terrMesh = new THREE.Mesh(terrGeo, this.sandMat);
    terrMesh.receiveShadow = true;
    group.add(terrMesh);

    // ── 3. Telephone Poles & Overhead Sagging Wires (Every 40m) ──
    const poleSpacing = 40;
    const poleCount = CHUNK_LEN / poleSpacing;
    for (let p = 0; p < poleCount; p++) {
      const pz1 = z0 + p * poleSpacing;
      const pz2 = pz1 + poleSpacing;
      const px1 = roadX(pz1) + 7.2;
      const py1 = roadY(pz1);
      const px2 = roadX(pz2) + 7.2;
      const py2 = roadY(pz2);

      const pole = buildTelephonePole();
      pole.position.set(px1, py1, pz1);
      pole.rotation.y = roadHeading(pz1);
      group.add(pole);

      const wirePts = [];
      for (let s = 0; s <= 6; s++) {
        const t = s / 6;
        const sag = Math.sin(t * Math.PI) * 0.55;
        wirePts.push(
          new THREE.Vector3(
            lerp(px1, px2, t),
            lerp(py1, py2, t) + 7.25 - sag,
            lerp(pz1, pz2, t)
          )
        );
      }
      const wireGeo = new THREE.BufferGeometry().setFromPoints(wirePts);
      group.add(new THREE.Line(wireGeo, this.wireMat));
    }

    // ── 4. Milepost Signs (Every 500m) ──
    for (let mz = Math.ceil(z0 / 500) * 500; mz < z1; mz += 500) {
      if (mz !== 0) {
        const kmVal = Math.abs(mz) / 1000;
        const kmStr = kmVal.toFixed(Math.abs(mz) % 1000 === 0 ? 0 : 1);
        const mp = buildMilepost(kmStr);
        mp.position.set(roadX(mz) - 5.6, roadY(mz), mz);
        mp.rotation.y = Math.PI;
        group.add(mp);
      }
    }

    const firstVisit = !this.visitedChunks.has(chunkIdx);
    this.visitedChunks.add(chunkIdx);

    // ── 5. Chunk 0: Starter House & Garage Compound ──
    if (chunkIdx === 0) {
      const home = buildStarterCompound();
      group.add(home.group);
      colliders.push(...home.colliders);

      if (firstVisit && !this.game._loadedFromSave) {
        this._populateStarterCompound();
      }
    }

    // ── 6. Roadside Palaces, Houses, Kasbahs, Bus Depots & Stations (Long Random Intervals) ──
    if (hasPOI && poiDef) {
      const built = buildRoadsidePOI(poiDef, poiSeed);
      built.group.position.set(poiX, poiRoadY, poiZ);
      const rotY = poiSide > 0 ? 0 : Math.PI;
      built.group.rotation.y = rotY;
      group.add(built.group);

      poiInfo = {
        x: poiX,
        y: poiRoadY,
        z: poiZ,
        name: poiDef.name,
        signText: poiDef.signText,
      };

      for (const c of built.colliders) {
        if (poiSide > 0) {
          colliders.push({
            minX: poiX + c.minX,
            maxX: poiX + c.maxX,
            minZ: poiZ + c.minZ,
            maxZ: poiZ + c.maxZ,
          });
        } else {
          colliders.push({
            minX: poiX - c.maxX,
            maxX: poiX - c.minX,
            minZ: poiZ - c.maxZ,
            maxZ: poiZ - c.minZ,
          });
        }
      }

      if (firstVisit) {
        this._populatePOILoot(poiDef, built.lootSpots, poiX, poiRoadY, poiZ, poiSide, rngPoi, chunkIdx);
      }
    }

    // ── 7. Desert Cacti & Boulders ──
    const decRng = mulberry32((777 + chunkIdx * 997) >>> 0);
    for (let i = 0; i < 26; i++) {
      const dz = rand(decRng, z0 + 4, z1 - 4);
      const rx = roadX(dz);
      const side = decRng() > 0.5 ? 1 : -1;
      const dist = rand(decRng, 12, 165);
      const dx = rx + side * dist;

      if (chunkIdx === 0 && dx < -2 && dx > -32 && dz > -5 && dz < 26) continue;
      if (hasPOI && Math.hypot(dx - poiX, dz - poiZ) < 19) continue;

      const dy = terrainHeight(dx, dz);
      if (decRng() < 0.55) {
        const cac = buildCactus((chunkIdx * 100 + i) | 0);
        cac.position.set(dx, dy, dz);
        cac.rotation.y = decRng() * Math.PI * 2;
        group.add(cac);
        rocks.push({ x: dx, z: dz, radius: 0.45 });
      } else {
        const b = buildBoulder((chunkIdx * 100 + i) | 0);
        b.mesh.position.set(dx, dy + b.radius * 0.25, dz);
        group.add(b.mesh);
        rocks.push({ x: dx, z: dz, radius: b.radius });
      }
    }

    this.scene.add(group);
    this.chunks.set(chunkIdx, { group, colliders, rocks, poiInfo });
  }

  // Spawn parts, fluids & tools in Starter Garage so the player builds their broken starter car!
  _populateStarterCompound() {
    const g = this.game;

    // ── Disassembled Car Parts in the Garage to build the Starter Car! ──
    // 1. Engine Block on the workbench (left end)
    g.spawnWorldItem(createItemInstance('part_engine_std', { condition: 0.78 }), -17.1, 1.04, 17.4);
    // 2. Standard Radiator on the workbench (next to engine)
    g.spawnWorldItem(createItemInstance('part_radiator_std', { condition: 0.80 }), -16.1, 1.04, 17.4);
    // 3. Two Missing Wheels/Tires lying on the garage floor beside the car
    g.spawnWorldItem(createItemInstance('part_wheel', { condition: 0.85 }), -16.8, 0.14, 15.3);
    g.spawnWorldItem(createItemInstance('part_wheel', { condition: 0.82 }), -16.8, 0.14, 12.1);

    // ── Essential Car Fluids & Mechanic Tools on the Workbench ──
    g.spawnWorldItem(createItemInstance('jerrycan_gas', { amount: 18.0 }), -15.2, 1.02, 17.5);
    g.spawnWorldItem(createItemInstance('oil_can', { amount: 3.5 }), -14.4, 1.02, 17.5);
    g.spawnWorldItem(createItemInstance('water_jug', { amount: 9.0 }), -13.6, 1.02, 17.5);
    g.spawnWorldItem(createItemInstance('repair_kit', { uses: 5 }), -12.9, 1.02, 17.5);
    g.spawnWorldItem(
      createItemInstance('spray_paint', { paintHex: '#2b6cb0', paintName: 'Baltic Blue' }),
      -12.3,
      1.02,
      17.5
    );
    g.spawnWorldItem(createItemInstance('siphon_hose'), -17.5, 0.14, 16.8);

    // ── Kitchen Table Rations & Defense inside the House ──
    g.spawnWorldItem(createItemInstance('salami'), -15.6, 0.88, 5.4);
    g.spawnWorldItem(createItemInstance('beans'), -15.6, 0.88, 4.9);
    g.spawnWorldItem(createItemInstance('soda'), -14.6, 0.88, 4.8);
    g.spawnWorldItem(createItemInstance('revolver', { ammo: 18 }), -14.6, 0.88, 5.5);
    g.spawnWorldItem(createItemInstance('binoculars'), -15.2, 0.88, 4.7);
  }

  // Spawn tools, car parts, and broken-down cars / Ikarus Buses at Roadside Houses & Depots
  _populatePOILoot(poiDef, lootSpots, poiX, poiY, poiZ, poiSide, rng, chunkIdx) {
    const g = this.game;
    const lootPool = [
      'repair_kit',
      'jerrycan_gas',
      'oil_can',
      'water_jug',
      'part_wheel',
      'part_wheel',
      'part_engine_i4',
      'part_engine_v8',
      'part_engine_diesel',
      'part_radiator_std',
      'part_radiator_heavy',
      'salami',
      'beans',
      'chocolate',
      'soda',
      'medkit',
      'wire_brush',
      'spray_paint',
      'siphon_hose',
    ];

    // Always guarantee at least 1 repair/part or fluid item in every roadside building
    for (let sIdx = 0; sIdx < lootSpots.length; sIdx++) {
      const spot = lootSpots[sIdx];
      if (sIdx < 2 || rng() < 0.82) {
        const defId = sIdx === 0 ? pick(rng, ['repair_kit', 'jerrycan_gas', 'part_wheel']) : pick(rng, lootPool);
        const wx = poiX + (poiSide > 0 ? spot.x : -spot.x);
        const wz = poiZ + (poiSide > 0 ? spot.z : -spot.z);
        const wy = poiY + spot.y;
        const paintObj = pick(rng, PAINT_COLORS);
        const itm = createItemInstance(defId, {
          amount: Math.round(rand(rng, 4.0, 18.0) * 10) / 10,
          condition: rand(rng, 0.65, 1.0),
          paintHex: paintObj.hex,
          paintName: paintObj.name,
        });
        g.spawnWorldItem(itm, wx, wy, wz);
      }
    }

    // Spawn a Found Vehicle or Giant Ikarus Bus (often broken / "kharbana" needing repair & resources!)
    if (rng() < poiDef.spawnCarChance) {
      let arch;
      const roll = rng();
      if (poiDef.preferBus || roll < 0.28) {
        // Lucky Find: Giant Ikarus 260 Highway Bus or Ikarus 280 Royal Liner!
        arch = rng() < 0.45 ? CAR_BY_ID.megabus : CAR_BY_ID.bus;
      } else if (poiDef.preferRare || roll < 0.52) {
        // Lucky Find: Plymouth Fury V8 Muscle Cruiser or GAZ-66 4x4 Truck!
        arch = rng() < 0.65 ? CAR_BY_ID.muscle : CAR_BY_ID.truck;
      } else {
        arch = pick(rng, CAR_ARCHETYPES);
      }

      const paintObj = (arch.id === 'bus' || arch.id === 'megabus') && rng() < 0.7 ? PAINT_COLORS[1] : pick(rng, PAINT_COLORS);
      const carX = poiX + (poiSide > 0 ? -3.6 : 3.6);
      const carZ = poiZ + (poiSide > 0 ? -9.0 : 9.0);

      // Determine how broken ("kharbana") this discovered vehicle/bus is:
      // 30% chance: Lucky near-intact find (just needs fuel/oil/water or a quick wrench tune-up!)
      // 70% chance: Broken down wreck (missing 1-2 wheels, or missing radiator/engine, or damaged engine needing a Repair Kit!)
      const isLuckyMint = rng() < 0.30;
      const missingWheel1 = !isLuckyMint && rng() < 0.75 ? Math.floor(rng() * 4) : -1;
      const missingWheel2 = !isLuckyMint && rng() < 0.40 ? (missingWheel1 + 2) % 4 : -1;
      const missingRad = !isLuckyMint && rng() < 0.35;
      const missingEng = !isLuckyMint && !missingRad && rng() < 0.25;
      const damagedEngine = !isLuckyMint && rng() < 0.65;

      const wheels = [0, 1, 2, 3].map((wIdx) => ({
        installed: wIdx !== missingWheel1 && wIdx !== missingWheel2,
        condition: rand(rng, 0.45, 0.95),
      }));

      g.spawnVehicle({
        archId: arch.id,
        x: carX,
        y: poiY + 0.08,
        z: carZ,
        heading: rand(rng, -0.35, 0.35),
        paintHex: paintObj.hex,
        condition: isLuckyMint ? rand(rng, 0.78, 0.98) : rand(rng, 0.25, 0.62),
        fuel: isLuckyMint ? Math.round(rand(rng, 8.0, 28.0) * 10) / 10 : Math.round(rand(rng, 0.0, 4.5) * 10) / 10,
        oil: isLuckyMint ? Math.round(rand(rng, 1.8, 4.0) * 10) / 10 : Math.round(rand(rng, 0.0, 0.9) * 10) / 10,
        water: isLuckyMint ? Math.round(rand(rng, 4.0, 9.0) * 10) / 10 : Math.round(rand(rng, 0.0, 1.5) * 10) / 10,
        engineId: missingEng ? null : arch.defaultEngine,
        engineCondition: damagedEngine ? 0.18 : rand(rng, 0.68, 0.96),
        radiatorId: missingRad ? null : arch.defaultRadiator,
        radiatorCondition: damagedEngine ? 0.25 : rand(rng, 0.65, 0.95),
        wheels,
        hoodOpen: !isLuckyMint,
      });
    }

    // Spawn 1-2 Mutant Desert Hares near the building
    const hareCount = rng() < 0.65 ? 1 : 2;
    for (let h = 0; h < hareCount; h++) {
      const hx = poiX + rand(rng, -8, 8);
      const hz = poiZ + rand(rng, -9, 9);
      g.spawnHare(hx, poiY, hz);
    }
  }
}
