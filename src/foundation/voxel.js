import * as THREE from 'three';
import { LogVoxel } from './game-core.js';

export const BLOCKS = Object.freeze({
  air: { id: 0, name: 'Air', solid: false, color: 0x000000 },
  grass: { id: 1, name: 'Grass', solid: true, color: 0x5fa84d },
  dirt: { id: 2, name: 'Dirt', solid: true, color: 0x8b5a3c },
  stone: { id: 3, name: 'Stone', solid: true, color: 0x808b94 },
  sand: { id: 4, name: 'Sand', solid: true, color: 0xd7bb73 },
  concrete: { id: 5, name: 'Concrete', solid: true, color: 0xabb3b8 },
  wood: { id: 6, name: 'Wood', solid: true, color: 0x9a633f },
  glass: { id: 7, name: 'Glass', solid: false, color: 0x82c9dc, opacity: 0.42 },
  road: { id: 8, name: 'Road', solid: true, color: 0x30363d },
});

export class VoxelChunkData {
  constructor({ size = 16, worldPosition = new THREE.Vector3() } = {}) {
    this.size = size;
    this.worldPosition = worldPosition.clone();
    this.blocks = new Uint8Array(size * size * size);
    this.generationState = 'empty';
    this.loadingState = 'unloaded';
  }
  index(x, y, z) { return x + this.size * (y + this.size * z); }
  get(x, y, z) { return this.blocks[this.index(x, y, z)] ?? 0; }
  set(x, y, z, blockId) { this.blocks[this.index(x, y, z)] = blockId; }
}

// Small instanced prototype only. It deliberately keeps chunks as data and uses
// one draw call per block type, so Phase 02 can replace meshing without changing callers.
export class VoxelChunkComponent {
  constructor(data) { this.data = data; this.group = new THREE.Group(); }
  buildPreview() {
    this.group.clear();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    for (const block of Object.values(BLOCKS)) {
      if (!block.solid) continue;
      const entries = [];
      for (let z = 0; z < this.data.size; z++) for (let y = 0; y < this.data.size; y++) for (let x = 0; x < this.data.size; x++) {
        if (this.data.get(x, y, z) === block.id) entries.push([x, y, z]);
      }
      if (!entries.length) continue;
      const material = new THREE.MeshStandardMaterial({ color: block.color, roughness: 0.9 });
      const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
      const transform = new THREE.Object3D();
      entries.forEach(([x, y, z], i) => {
        transform.position.set(x + 0.5, y + 0.5, z + 0.5);
        transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.voxelBlock = block.name;
      this.group.add(mesh);
    }
    return this.group;
  }
}

export class VoxelWorldManager {
  constructor({ chunkSize = 16 } = {}) { this.chunkSize = chunkSize; this.chunks = new Map(); }
  key(x, y, z) { return `${x}:${y}:${z}`; }
  createTestChunk({ x = 0, y = 0, z = 0 } = {}) {
    const data = new VoxelChunkData({ size: this.chunkSize, worldPosition: new THREE.Vector3(x, y, z) });
    for (let zz = 0; zz < data.size; zz++) for (let xx = 0; xx < data.size; xx++) {
      data.set(xx, 0, zz, BLOCKS.grass.id);
      if ((xx + zz) % 7 === 0) data.set(xx, 1, zz, BLOCKS.stone.id);
    }
    data.generationState = 'generated'; data.loadingState = 'loaded';
    const component = new VoxelChunkComponent(data); component.buildPreview();
    const chunk = { data, component };
    this.chunks.set(this.key(x, y, z), chunk);
    LogVoxel('Created prototype chunk', chunk.data.worldPosition.toArray());
    return chunk;
  }
  get loadedChunkCount() { return this.chunks.size; }
}
