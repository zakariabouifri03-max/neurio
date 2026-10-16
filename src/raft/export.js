import * as THREE from 'three';

// A small, dependency-free glTF 2.0 writer for the game's procedural meshes.
// Transforms and normals are baked, and local surface textures are embedded as PNG.
export async function exportRaft(root, { filename = 'drift-raft.glb', title = 'Drift raft', generator = 'Drift — original procedural survival world' } = {}) {
  root.updateMatrixWorld(true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const buffers = [], materials = new Map(), textures = new Map();
  const gltf = { asset: { version: '2.0', generator }, scene: 0, scenes: [{ name: title, nodes: [0] }], nodes: [{ name: title, mesh: 0 }], meshes: [{ name: title, primitives: [] }], materials: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] };
  let byteLength = 0;
  function append(array, target) {
    const data = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const view = { buffer: 0, byteOffset: byteLength, byteLength: data.length };
    if (target) view.target = target;
    const padded = new Uint8Array(Math.ceil(data.length / 4) * 4); padded.set(data); buffers.push(padded); byteLength += padded.length;
    return gltf.bufferViews.push(view) - 1;
  }
  function accessor(array, count, type, componentType, target, bounds) {
    const result = { bufferView: append(array, target), componentType, count, type };
    if (bounds) Object.assign(result, bounds);
    return gltf.accessors.push(result) - 1;
  }
  async function materialIndex(source) {
    if (materials.has(source.uuid)) return materials.get(source.uuid);
    const index = gltf.materials.length;
    const result = { name: `Surface ${index + 1}`, pbrMetallicRoughness: { baseColorFactor: [source.color.r, source.color.g, source.color.b, source.opacity], metallicFactor: source.metalness || 0, roughnessFactor: source.roughness ?? 1 } };
    if (source.transparent) result.alphaMode = 'BLEND';
    if (source.side === THREE.DoubleSide) result.doubleSided = true;
    if (source.emissive?.getHex()) result.emissiveFactor = source.emissive.toArray().map(value => Math.min(1, value * (source.emissiveIntensity || 1)));
    if (source.map?.image) {
      const texture = source.map;
      if (!textures.has(texture.uuid)) {
        const image = texture.image, canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        if (texture.flipY) { ctx.translate(0, canvas.height); ctx.scale(1, -1); }
        ctx.drawImage(image, 0, 0);
        const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!png) throw new Error('Could not export model texture');
        gltf.images ||= []; gltf.textures ||= [];
        const sourceIndex = gltf.images.push({ bufferView: append(new Uint8Array(await png.arrayBuffer())), mimeType: 'image/png' }) - 1;
        const textureIndex = gltf.textures.push({ source: sourceIndex }) - 1;
        textures.set(texture.uuid, textureIndex);
      }
      result.pbrMetallicRoughness.baseColorTexture = { index: textures.get(texture.uuid) };
    }
    gltf.materials.push(result); materials.set(source.uuid, index); return index;
  }
  // Capture one coherent pose before the asynchronous PNG encoding yields a frame.
  const meshes = [];
  root.traverse(node => {
    if (node.isMesh && node.visible && !node.userData.noExport) meshes.push({ node, geometry: node.geometry.clone(), transform: node.matrixWorld.clone() });
  });
  for (const { node, geometry, transform } of meshes) {
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverseRoot, transform));
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const position = geometry.attributes.position, normal = geometry.attributes.normal, uv = geometry.attributes.uv;
    const primitive = {
      attributes: {
        POSITION: accessor(new Float32Array(position.array), position.count, 'VEC3', 5126, 34962, { min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() }),
        NORMAL: accessor(new Float32Array(normal.array), normal.count, 'VEC3', 5126, 34962),
      },
      material: await materialIndex(node.material), mode: 4,
    };
    const colors = geometry.attributes.color;
    if (colors && node.material.vertexColors) primitive.attributes.COLOR_0 = accessor(new Float32Array(colors.array), colors.count, colors.itemSize === 4 ? 'VEC4' : 'VEC3', 5126, 34962);
    if (uv && node.material.map) primitive.attributes.TEXCOORD_0 = accessor(new Float32Array(uv.array), uv.count, 'VEC2', 5126, 34962);
    if (geometry.index) primitive.indices = accessor(new Uint32Array(geometry.index.array), geometry.index.count, 'SCALAR', 5125, 34963);
    gltf.meshes[0].primitives.push(primitive); geometry.dispose();
  }
  gltf.buffers[0].byteLength = byteLength;
  const encoded = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = Math.ceil(encoded.length / 4) * 4, total = 12 + 8 + jsonLength + 8 + byteLength;
  const output = new ArrayBuffer(total), view = new DataView(output), bytes = new Uint8Array(output);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength); bytes.set(encoded, 20);
  let offset = 20 + jsonLength; view.setUint32(offset, byteLength, true); view.setUint32(offset + 4, 0x004e4942, true); offset += 8;
  for (const buffer of buffers) { bytes.set(buffer, offset); offset += buffer.length; }
  const blob = new Blob([output], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return blob;
}
