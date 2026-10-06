import * as THREE from '../vendor/three.module.js';

const COMPONENT_INFO = {
  5120: { bytes: 1, getter: 'getInt8', Type: Int8Array },
  5121: { bytes: 1, getter: 'getUint8', Type: Uint8Array },
  5122: { bytes: 2, getter: 'getInt16', Type: Int16Array },
  5123: { bytes: 2, getter: 'getUint16', Type: Uint16Array },
  5125: { bytes: 4, getter: 'getUint32', Type: Uint32Array },
  5126: { bytes: 4, getter: 'getFloat32', Type: Float32Array },
};
const ITEM_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const materialColor = (factor) => new THREE.Color().setRGB(factor[0] ?? 1, factor[1] ?? 1, factor[2] ?? 1, THREE.SRGBColorSpace);

export async function importAssetFiles(fileList) {
  const files = [...fileList];
  const resources = new Map(files.map((file) => [file.name.toLowerCase(), file]));
  const output = [];
  for (const file of files) {
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension === 'bin' || ['png', 'jpg', 'jpeg', 'webp'].includes(extension)) continue;
    if (extension === 'obj') output.push({ file, object: parseOBJ(await file.text(), file.name) });
    else if (extension === 'gltf') output.push({ file, object: await parseGLTFDocument(JSON.parse(await file.text()), null, resources, file.name) });
    else if (extension === 'glb') output.push({ file, object: await parseGLB(await file.arrayBuffer(), resources, file.name) });
    else throw new Error(`Unsupported asset file: ${file.name}. Import GLB, glTF 2.0, or OBJ.`);
  }
  return output;
}

export function parseOBJ(text, name = 'Imported OBJ') {
  const positions = [[0, 0, 0]], normals = [[0, 0, 1]], uvs = [[0, 0]];
  const vertices = [], vertexNormals = [], vertexUvs = [];
  let currentName = name.replace(/\.[^.]+$/, '');
  const groups = [];
  let group = { name: currentName, positions: [], normals: [], uvs: [] };
  const flush = () => {
    if (group.positions.length) groups.push(group);
    group = { name: currentName, positions: [], normals: [], uvs: [] };
  };
  const readIndex = (index, length) => {
    const parsed = Number(index);
    if (!parsed || !Number.isInteger(parsed)) return 0;
    return parsed > 0 ? parsed : length + parsed;
  };
  const putFaceVertex = (token) => {
    const parts = token.split('/');
    const vi = positions[readIndex(parts[0], positions.length)] || positions[0];
    const ti = uvs[readIndex(parts[1], uvs.length)] || uvs[0];
    const ni = normals[readIndex(parts[2], normals.length)] || null;
    group.positions.push(...vi);
    group.uvs.push(...ti);
    if (ni) group.normals.push(...ni);
    else group.normals.push(0, 0, 0);
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [tag, ...parts] = line.split(/\s+/);
    if (tag === 'v' && parts.length >= 3) positions.push(parts.slice(0, 3).map(Number));
    else if (tag === 'vn' && parts.length >= 3) normals.push(parts.slice(0, 3).map(Number));
    else if (tag === 'vt' && parts.length >= 2) uvs.push([Number(parts[0]), 1 - Number(parts[1])]);
    else if (tag === 'o' || tag === 'g') {
      flush(); currentName = parts.join(' ') || name;
      group.name = currentName;
    } else if (tag === 'f' && parts.length >= 3) {
      const first = parts[0];
      for (let i = 1; i < parts.length - 1; i++) {
        putFaceVertex(first); putFaceVertex(parts[i]); putFaceVertex(parts[i + 1]);
      }
    }
  }
  flush();
  if (!groups.length) throw new Error(`${name} did not contain any valid faces.`);
  const root = new THREE.Group(); root.name = name.replace(/\.[^.]+$/, '');
  for (const item of groups) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(item.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(item.uvs, 2));
    const hasNormals = item.normals.some((value) => Math.abs(value) > 1e-8);
    if (hasNormals) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(item.normals, 3));
    else geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#c8d1d8', roughness: 0.82, metalness: 0.02 }));
    mesh.name = item.name || 'Mesh'; mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh);
  }
  root.userData.importFormat = 'OBJ';
  return root;
}

export async function parseGLB(arrayBuffer, resources = new Map(), name = 'Imported GLB') {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error(`${name} is not a valid GLB file.`);
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`Only GLB version 2 is supported (found version ${version}).`);
  const declaredLength = view.getUint32(8, true);
  if (declaredLength > view.byteLength) throw new Error('GLB is truncated.');
  let json = null, binary = null, offset = 12;
  while (offset + 8 <= declaredLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + length > declaredLength) throw new Error('GLB chunk length exceeds the file size.');
    const chunk = arrayBuffer.slice(offset, offset + length);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk).replace(/[\0\s]+$/, ''));
    if (type === 0x004e4942) binary = chunk;
    offset += length;
  }
  if (!json) throw new Error('GLB is missing its JSON chunk.');
  return parseGLTFDocument(json, binary, resources, name);
}

async function resourceBuffer(uri, buffers, resources, fallbackBinary, index) {
  if (!uri && index === 0 && fallbackBinary) return fallbackBinary;
  if (uri?.startsWith('data:')) {
    const decoded = decodeDataUri(uri).bytes;
    return decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength);
  }
  const leaf = decodeURIComponent((uri || '').split('/').pop() || '').toLowerCase();
  const file = resources.get(uri?.toLowerCase()) || resources.get(leaf);
  if (file) return file.arrayBuffer();
  if (index === 0 && fallbackBinary) return fallbackBinary;
  throw new Error(`Missing glTF buffer "${uri || index}". Select its .bin file together with the .gltf.`);
}

function decodeDataUri(uri) {
  const match = uri.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) throw new Error('Invalid data URI in glTF file.');
  const mime = match[1] || 'application/octet-stream';
  const content = match[3];
  const bytes = match[2]
    ? Uint8Array.from(atob(content), (char) => char.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(content));
  return { mime, bytes };
}

async function imageBlob(image, document, buffers, resources) {
  if (image.uri?.startsWith('data:')) {
    const decoded = decodeDataUri(image.uri);
    return new Blob([decoded.bytes], { type: decoded.mime });
  }
  if (image.uri) {
    const filename = decodeURIComponent(image.uri.split('/').pop()).toLowerCase();
    const file = resources.get(image.uri.toLowerCase()) || resources.get(filename);
    if (!file) return null;
    return file;
  }
  if (Number.isInteger(image.bufferView)) {
    const bufferView = document.bufferViews[image.bufferView];
    const buffer = buffers[bufferView.buffer || 0];
    if (!buffer) return null;
    return new Blob([buffer.slice(bufferView.byteOffset || 0, (bufferView.byteOffset || 0) + bufferView.byteLength)], { type: image.mimeType || 'image/png' });
  }
  return null;
}

function accessorArray(index, document, buffers, outputType = 'float') {
  const accessor = document.accessors?.[index];
  if (!accessor) throw new Error(`glTF accessor ${index} is missing.`);
  if (accessor.sparse) throw new Error('Sparse glTF accessors are not supported in this build.');
  const info = COMPONENT_INFO[accessor.componentType];
  const itemSize = ITEM_SIZE[accessor.type];
  if (!info || !itemSize) throw new Error(`Unsupported glTF accessor type ${accessor.type}/${accessor.componentType}.`);
  const viewInfo = document.bufferViews?.[accessor.bufferView];
  if (!viewInfo) throw new Error(`glTF buffer view for accessor ${index} is missing.`);
  const buffer = buffers[viewInfo.buffer || 0];
  if (!buffer) throw new Error(`glTF buffer data for accessor ${index} is missing.`);
  const start = (viewInfo.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = viewInfo.byteStride || info.bytes * itemSize;
  const view = new DataView(buffer);
  if (outputType === 'index') {
    const outType = accessor.componentType === 5125 ? Uint32Array : Uint16Array;
    const values = new outType(accessor.count);
    for (let i = 0; i < accessor.count; i++) values[i] = view[info.getter](start + i * stride, true);
    return values;
  }
  const values = new Float32Array(accessor.count * itemSize);
  for (let i = 0; i < accessor.count; i++) {
    for (let component = 0; component < itemSize; component++) {
      let value = view[info.getter](start + i * stride + component * info.bytes, true);
      if (accessor.normalized && info.Type !== Float32Array) {
        if (info.Type === Int8Array) value = Math.max(value / 127, -1);
        else if (info.Type === Int16Array) value = Math.max(value / 32767, -1);
        else value /= info.Type === Uint8Array ? 255 : 65535;
      }
      values[i * itemSize + component] = value;
    }
  }
  return values;
}

async function parseGLTFDocument(document, fallbackBinary, resources, name) {
  if (document.asset?.version && !document.asset.version.startsWith('2')) throw new Error('glTF 2.0 is required.');
  if (!Array.isArray(document.meshes)) throw new Error(`${name} contains no glTF meshes.`);
  const buffers = [];
  for (let i = 0; i < (document.buffers || []).length; i++) {
    const info = document.buffers[i];
    buffers.push(await resourceBuffer(info.uri, buffers, resources, fallbackBinary, i));
  }
  if (!buffers.length && fallbackBinary) buffers.push(fallbackBinary);

  const images = [];
  for (const image of document.images || []) {
    const blob = await imageBlob(image, document, buffers, resources);
    if (blob && typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0); bitmap.close?.();
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false;
        images.push(texture);
      } catch (_) { images.push(null); }
    } else images.push(null);
  }
  const textures = (document.textures || []).map((texture) => images[texture.source] || null);
  const materials = (document.materials || []).map((item) => {
    const pbr = item.pbrMetallicRoughness || {};
    const factor = pbr.baseColorFactor || [1, 1, 1, 1];
    const material = new THREE.MeshStandardMaterial({
      name: item.name || 'glTF Material',
      color: materialColor(factor),
      roughness: pbr.roughnessFactor ?? 1,
      metalness: pbr.metallicFactor ?? 1,
      opacity: factor[3] ?? 1,
      transparent: item.alphaMode === 'BLEND' || (factor[3] ?? 1) < 1,
      alphaTest: item.alphaMode === 'MASK' ? (item.alphaCutoff ?? 0.5) : 0,
      side: item.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    const texture = pbr.baseColorTexture && textures[pbr.baseColorTexture.index];
    if (texture) material.map = texture;
    material.needsUpdate = true;
    return material;
  });
  const defaultMaterial = new THREE.MeshStandardMaterial({ color: '#c8d1d8', roughness: 0.82 });
  const geometryFor = (primitive) => {
    if (primitive.attributes?.POSITION === undefined) throw new Error('A glTF mesh primitive has no POSITION attribute.');
    if (primitive.mode !== undefined && primitive.mode !== 4) throw new Error('Only triangle-list glTF geometry is supported.');
    const geometry = new THREE.BufferGeometry();
    for (const [key, accessorIndex] of Object.entries(primitive.attributes)) {
      const semantic = key === 'POSITION' ? 'position' : key === 'NORMAL' ? 'normal' : key === 'TEXCOORD_0' ? 'uv' : key === 'TANGENT' ? 'tangent' : key === 'COLOR_0' ? 'color' : key.toLowerCase();
      if (!['position', 'normal', 'uv', 'tangent', 'color'].includes(semantic)) continue;
      geometry.setAttribute(semantic, new THREE.BufferAttribute(accessorArray(accessorIndex, document, buffers), ITEM_SIZE[document.accessors[accessorIndex].type]));
    }
    if (primitive.indices !== undefined) geometry.setIndex(new THREE.BufferAttribute(accessorArray(primitive.indices, document, buffers, 'index'), 1));
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  };
  const meshDefs = (document.meshes || []).map((mesh, meshIndex) => {
    const group = new THREE.Group(); group.name = mesh.name || `Mesh ${meshIndex + 1}`;
    for (const primitive of mesh.primitives || []) {
      const material = materials[primitive.material] || defaultMaterial;
      const node = new THREE.Mesh(geometryFor(primitive), material);
      node.name = mesh.name || 'Mesh'; node.castShadow = true; node.receiveShadow = true;
      group.add(node);
    }
    return group;
  });
  const nodeDefs = document.nodes || [];
  const nodes = nodeDefs.map((node, index) => {
    const group = new THREE.Group(); group.name = node.name || `Node ${index + 1}`;
    if (node.mesh !== undefined && meshDefs[node.mesh]) group.add(meshDefs[node.mesh].clone(true));
    if (Array.isArray(node.matrix) && node.matrix.length === 16) {
      const matrix = new THREE.Matrix4().fromArray(node.matrix);
      matrix.decompose(group.position, group.quaternion, group.scale);
    } else {
      if (node.translation) group.position.fromArray(node.translation);
      if (node.rotation) group.quaternion.fromArray(node.rotation);
      if (node.scale) group.scale.fromArray(node.scale);
    }
    return group;
  });
  nodeDefs.forEach((node, index) => (node.children || []).forEach((child) => nodes[index].add(nodes[child])));
  const scene = new THREE.Group();
  const sceneIndex = document.scene ?? 0;
  const rootNodes = document.scenes?.[sceneIndex]?.nodes || nodeDefs.map((_, index) => index).filter((index) => !nodeDefs.some((candidate) => candidate.children?.includes(index)));
  rootNodes.forEach((nodeIndex) => { if (nodes[nodeIndex]) scene.add(nodes[nodeIndex]); });
  if (!scene.children.length && meshDefs.length) meshDefs.forEach((mesh) => scene.add(mesh.clone(true)));
  scene.name = name.replace(/\.(glb|gltf)$/i, '');
  scene.userData.importFormat = 'glTF 2.0';
  return scene;
}
