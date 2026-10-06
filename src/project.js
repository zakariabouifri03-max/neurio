const DB_NAME = 'nexus-game-studio';
const DB_VERSION = 1;
const STORE = 'projects';
const FALLBACK_KEY = 'nexus-game-studio.project.v1';

const uuid = () => globalThis.crypto?.randomUUID?.() || `nexus-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function createProject({ name = 'Untitled Game', template = 'Empty Project', quality = 'High', target = 'Web' } = {}) {
  const cleanName = name.trim() || 'Untitled Game';
  return {
    schemaVersion: 1,
    id: uuid(),
    name: cleanName,
    template,
    quality,
    target,
    sceneName: template === 'Island Survival' ? 'Island' : 'Main',
    sceneData: null,
    scenes: [],
    assets: [],
    materials: [],
    scripts: [],
    prefabs: [],
    graphs: [],
    snapshots: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function openDatabase() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('IndexedDB is unavailable.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the project database.'));
    request.onblocked = () => reject(new Error('The project database is blocked by another tab.'));
  });
}

async function transact(mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let request;
    try { request = action(store); } catch (error) { db.close(); reject(error); return; }
    transaction.oncomplete = () => { db.close(); resolve(request?.result); };
    transaction.onerror = () => { db.close(); reject(transaction.error || request?.error || new Error('Project database operation failed.')); };
    transaction.onabort = () => { db.close(); reject(transaction.error || new Error('Project database operation was cancelled.')); };
  });
}

export async function saveProject(project) {
  project.updatedAt = new Date().toISOString();
  try {
    await transact('readwrite', (store) => store.put(project));
    return { storage: 'IndexedDB', warning: null };
  } catch (error) {
    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(project));
      return { storage: 'localStorage', warning: `Large projects require IndexedDB. Fallback storage may not fit this project (${error.message}).` };
    } catch (_) {
      return { storage: 'unavailable', warning: `Project could not be persisted: ${error.message}` };
    }
  }
}

export async function loadProject(id) {
  try {
    if (id) {
      const found = await transact('readonly', (store) => store.get(id));
      if (found) return found;
    }
    const all = await transact('readonly', (store) => store.getAll());
    if (all?.length) return all.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
  } catch (_) { /* private mode or unsupported IndexedDB: try the small-project fallback */ }
  try {
    const value = JSON.parse(localStorage.getItem(FALLBACK_KEY) || 'null');
    return value && typeof value === 'object' ? value : null;
  } catch (_) { return null; }
}

export async function listProjects() {
  try {
    const all = await transact('readonly', (store) => store.getAll());
    return (all || []).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  } catch (_) {
    const saved = await loadProject();
    return saved ? [saved] : [];
  }
}

export function saveSnapshot(project, sceneData, label = '') {
  const snapshot = {
    id: uuid(),
    label: label.trim() || `Snapshot ${String((project.snapshots?.length || 0) + 1).padStart(3, '0')}`,
    createdAt: new Date().toISOString(),
    sceneData: structuredClone(sceneData),
  };
  project.snapshots ||= [];
  project.snapshots.unshift(snapshot);
  project.snapshots = project.snapshots.slice(0, 8);
  return snapshot;
}

export function validateProject(project, engine) {
  const problems = [];
  if (!project?.name?.trim()) problems.push({ severity: 'error', message: 'Project name is empty.', target: 'Project Settings' });
  const objects = engine.listObjects();
  if (!objects.length) problems.push({ severity: 'error', message: 'Scene has no GameObjects.', target: project.sceneName || 'Scene' });
  const hasLight = objects.some((object) => object.isLight);
  if (!hasLight) problems.push({ severity: 'warning', message: 'Scene has no light; the game may render very dark.', target: project.sceneName || 'Scene' });
  const hasPlayer = objects.some((object) => object.userData?.nexus?.components?.some((component) => component.type === 'CharacterController'));
  if (!hasPlayer) problems.push({ severity: 'warning', message: 'Scene has no Character Controller; the build will render but will not have player movement.', target: project.sceneName || 'Scene' });
  for (const object of objects) {
    const position = object.position;
    const scale = object.scale;
    if (![position.x, position.y, position.z, scale.x, scale.y, scale.z].every(Number.isFinite)) {
      problems.push({ severity: 'error', message: `${object.name} has a non-finite transform.`, target: object.name });
    }
    if (!object.name?.trim()) problems.push({ severity: 'warning', message: 'A GameObject has an empty name.', target: 'Hierarchy' });
    object.traverse((child) => {
      if (!child.isMesh) return;
      const positions = child.geometry?.getAttribute?.('position');
      if (!positions || positions.count === 0) problems.push({ severity: 'error', message: `${object.name} contains a mesh with no position vertices.`, target: object.name });
    });
  }
  return problems;
}

export const TEMPLATE_LIST = [
  { name: 'Island Survival', description: 'Playable island, third-person player, resources and a pursuing enemy.', icon: '◈' },
  { name: 'Third Person', description: 'Third-person character, camera follow, ground and a small test area.', icon: '♟' },
  { name: 'First Person', description: 'First-person-style controller setup and a minimal test scene.', icon: '⊙' },
  { name: 'Top Down', description: 'Top-down player setup with a wide follow camera.', icon: '▦' },
  { name: 'Simple Shooter', description: 'Player, target enemy, basic health and a test range.', icon: '◎' },
  { name: 'Empty Project', description: 'Clean lit scene with a ground plane and editor grid.', icon: '＋' },
];

export function seedTemplate(engine, template) {
  if (template === 'Island Survival') { engine.createSampleScene(); return; }
  engine.createScene(template === 'Empty Project' ? 'Main' : 'Test Scene');
  if (template === 'Empty Project') return;
  const player = engine.createObject('Player', { name: 'Player', position: [0, 0, 4] });
  if (template === 'First Person') {
    const follow = player.userData.nexus.components.find((component) => component.type === 'CameraFollow');
    Object.assign(follow, { distance: 0.25, height: 1.55, lookHeight: 1.55, smoothing: 18 });
  }
  if (template === 'Top Down') {
    const follow = player.userData.nexus.components.find((component) => component.type === 'CameraFollow');
    Object.assign(follow, { distance: 0, height: 13, lookHeight: 0.3, smoothing: 5 });
  }
  engine.createObject('Tree', { name: 'Test Tree', position: [4, 0, -3], select: false });
  engine.createObject('Rock', { name: 'Target Marker', position: [-4, 0, -4], select: false });
  if (template === 'Simple Shooter') {
    engine.createObject('Enemy', { name: 'Target Dummy', position: [0, 0, -7], select: false });
    engine.createObject('Wood Pickup', { name: 'Ammo / Pickup Test', position: [2, 0, 1], select: false });
  }
}
