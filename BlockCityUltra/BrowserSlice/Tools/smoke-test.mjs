// Headless smoke test: run the pure generation + meshing path in Node.
import * as THREE from '../js/three.module.js';
import { City } from '../js/world.js';

const stages = [];
const city = new City(20260710, (f, s) => stages.push(s));
const t0 = Date.now();
city.generate();
const genMs = Date.now() - t0;

const t1 = Date.now();
const built = city.buildMeshes();
const meshMs = Date.now() - t1;

console.log('generation ms      :', genMs);
console.log('mesh build ms      :', meshMs);
console.log('buildings          :', city.buildings.length);
console.log('roads              :', city.roads.length);
console.log('lane nodes         :', city.laneNodes.length);
console.log('street lights      :', city.streetLights.length);
console.log('ped points         :', city.pedPoints.length);
console.log('police points      :', city.policePoints?.length ?? 0);
console.log('boxes              :', city.boxCount);
console.log('mesh stats         :', JSON.stringify(built.stats));
console.log('tallest building m :', Math.max(...city.buildings.map(b => b.h)).toFixed(1));
console.log('player start       :', JSON.stringify(city.playerStart));

// Collision + LOS sanity.
city.buildCollision();
const c = city.colliders[0];
console.log('colliders          :', city.colliders.length);
const bx = c.minX + (c.maxX - c.minX) / 2, bz = c.minZ + (c.maxZ - c.minZ) / 2;
console.log('isInsideBuilding   :', city.isInsideBuilding(bx, bz));
console.log('segment blocked    :', city.isSegmentBlocked(bx - 60, bz, bx + 60, bz));
const p = { x: bx, y: 0.3, z: bz };
city.resolveCollision(p, 0.36);
console.log('resolved out of bld:', Math.hypot(p.x - bx, p.z - bz).toFixed(2), 'm');
console.log('district at origin :', city.districtIndexAt(0, 0));
