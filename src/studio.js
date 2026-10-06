import * as THREE from '../vendor/three.module.js';
import { StudioEngine, COMPONENT_TYPES, componentOf } from './engine.js';
import { importAssetFiles } from './asset-import.js';
import { createProject, loadProject, saveProject, saveSnapshot, validateProject, seedTemplate, TEMPLATE_LIST } from './project.js';
import { buildPortableGame } from './exporter.js';
import { applyPlan, planPrompt, TOOL_DEFINITIONS } from './agent.js';
import { createDefaultGraphs, createGraph, GRAPH_ACTIONS, GRAPH_CONDITIONS } from './graph.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const html = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const formatNumber = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '0.00';

const builtinAssets = [
  { type: 'Cube', icon: '▰', label: 'Cube', category: 'Primitive' },
  { type: 'Sphere', icon: '●', label: 'Sphere', category: 'Primitive' },
  { type: 'Cylinder', icon: '◍', label: 'Cylinder', category: 'Primitive' },
  { type: 'Capsule', icon: '♙', label: 'Capsule', category: 'Primitive' },
  { type: 'Plane', icon: '▱', label: 'Plane', category: 'Primitive' },
  { type: 'Tree', icon: '♣', label: 'Tree', category: 'Environment' },
  { type: 'Palm', icon: '♧', label: 'Palm', category: 'Environment' },
  { type: 'Rock', icon: '◆', label: 'Rock', category: 'Environment' },
  { type: 'Cabin', icon: '⌂', label: 'Cabin', category: 'Environment' },
  { type: 'Wood Pickup', icon: '▰', label: 'Wood Pickup', category: 'Gameplay' },
  { type: 'Stone Pickup', icon: '◇', label: 'Stone Pickup', category: 'Gameplay' },
  { type: 'Berry Pickup', icon: '●', label: 'Berry Pickup', category: 'Gameplay' },
  { type: 'Player', icon: '♟', label: 'Third Person Player', category: 'Gameplay' },
  { type: 'Enemy', icon: '♟', label: 'Chasing Enemy', category: 'Gameplay' },
  { type: 'Point Light', icon: '☼', label: 'Point Light', category: 'Lighting' },
  { type: 'Directional Light', icon: '✧', label: 'Directional Light', category: 'Lighting' },
  { type: 'Camera', icon: '▣', label: 'Camera', category: 'Lighting' },
  { type: 'Material Asset', icon: '◉', label: 'PBR Material', category: 'Material' },
];

const state = {
  project: null,
  engine: null,
  activePlan: null,
  dirty: false,
  suppressDirty: true,
  saveTimer: null,
  saveInFlight: Promise.resolve(),
  saveLabel: 'Browser workspace',
  consoleEntries: [],
  problems: [],
  undo: [],
  redo: [],
  collapsed: new Set(),
  buildRunning: false,
  currentTab: 'console',
  contextObject: null,
  commandIndex: 0,
  commandEntries: [],
  maximized: false,
  lastSaveTime: null,
};

function createEngine() {
  return new StudioEngine($('#viewportCanvas'), {
    onSelection: (object) => {
      renderHierarchy(); renderInspector(object); updateSelectionStatus(object);
    },
    onTransform: (object) => {
      updateTransformFields(object); updateSelectionStatus(object);
    },
    onTransformStart: () => recordUndo('Transform'),
    onTransformEnd: () => { renderHierarchy(); markDirty('Transform changed'); },
    onObjectsChanged: () => { renderHierarchy(); renderInspector(state.engine.selected); markDirty('Scene changed'); },
    onSceneChanged: () => { updateSceneLabels(); renderHierarchy(); renderInspector(state.engine.selected); },
    onMode: syncMode,
    onLog: logConsole,
    onError: (error) => logConsole('ERROR', error.message || String(error)),
    onStats: renderStats,
    onGameUI: renderGameUI,
    onGameToast: showGameToast,
    onHint: (message) => { $('#viewportHint').textContent = message; },
  });
}

function updateSceneLabels() {
  if (!state.engine) return;
  const name = state.engine.scene.name || state.project?.sceneName || 'Scene';
  $('#sceneNameLabel').textContent = name;
  $('#hierarchySceneName').textContent = name;
  if (state.project) state.project.sceneName = name;
}

function currentSceneEntry() {
  if (!state.project) return null;
  state.project.scenes ||= [];
  return state.project.scenes.find((scene) => scene.name === state.project.sceneName) || null;
}

function syncCurrentScene() {
  if (!state.project || !state.engine || state.engine.mode === 'play') return;
  const data = state.engine.serializeScene();
  let entry = currentSceneEntry();
  if (!entry) {
    entry = { name: state.engine.scene.name || 'Main', sceneData: data };
    state.project.scenes.push(entry);
  }
  entry.name = state.engine.scene.name || entry.name || 'Main';
  entry.sceneData = data;
  state.project.sceneName = entry.name;
  state.project.sceneData = null;
}

function markDirty(reason = 'Changes pending') {
  if (state.suppressDirty || !state.project) return;
  state.dirty = true;
  $('#saveState').textContent = 'Unsaved changes';
  $('.save-indicator').classList.add('dirty');
  $('#statusMessage').textContent = reason;
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => saveProjectNow(false), 900);
}

async function saveProjectNow(manual = false) {
  if (!state.project) return null;
  if (state.engine?.mode !== 'play') syncCurrentScene();
  state.project.graphs ||= [];
  const project = state.project;
  const promise = state.saveInFlight.then(() => saveProject(project));
  state.saveInFlight = promise.catch(() => null);
  const result = await promise;
  if (project === state.project) {
    state.dirty = false;
    state.lastSaveTime = new Date();
    $('#saveState').textContent = 'All changes saved';
    $('.save-indicator').classList.remove('dirty');
    $('#projectStorageLabel').textContent = result?.storage === 'IndexedDB' ? 'Browser workspace · IndexedDB' : result?.storage === 'localStorage' ? 'Browser workspace · limited storage' : 'Browser workspace · not saved';
    $('#statusMessage').textContent = manual ? 'Project saved' : 'Autosaved';
    if (result?.warning) { logConsole('WARNING', result.warning); showToast(result.warning); }
    else if (manual) showToast('Project saved to this browser workspace.');
  }
  return result;
}

function recordUndo(label = 'Edit') {
  if (state.suppressDirty || !state.engine || state.engine.mode === 'play') return;
  try {
    state.undo.push({ label, sceneData: state.engine.serializeScene() });
    if (state.undo.length > 10) state.undo.shift();
    state.redo.length = 0;
  } catch (error) { logConsole('WARNING', `Could not record undo state: ${error.message}`); }
}

function undo() {
  if (!state.undo.length || !state.engine || state.engine.mode === 'play') { showToast('No scene edits to undo.'); return; }
  state.redo.push({ label: 'Redo', sceneData: state.engine.serializeScene() });
  const entry = state.undo.pop();
  state.engine.loadScene(entry.sceneData);
  updateSceneLabels(); markDirty(`Undo ${entry.label}`);
  logConsole('INFO', `Undo: ${entry.label}.`);
}

function redo() {
  if (!state.redo.length || !state.engine || state.engine.mode === 'play') { showToast('No scene edits to redo.'); return; }
  state.undo.push({ label: 'Undo', sceneData: state.engine.serializeScene() });
  const entry = state.redo.pop();
  state.engine.loadScene(entry.sceneData);
  updateSceneLabels(); markDirty('Redo edit'); logConsole('INFO', 'Redo scene edit.');
}

function logConsole(level, message) {
  const entry = { level: String(level || 'INFO').toUpperCase(), message: String(message ?? ''), time: new Date() };
  state.consoleEntries.push(entry);
  if (state.consoleEntries.length > 600) state.consoleEntries.shift();
  const list = $('#consoleList');
  if (!list) return;
  const row = document.createElement('div');
  row.className = `log-line ${entry.level.toLowerCase()}`;
  const time = entry.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  row.innerHTML = `<span class="log-time">${html(time)}</span><span class="log-level">${html(entry.level)}</span><span class="log-message"></span>`;
  $('.log-message', row).textContent = entry.message;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
  $('#consoleBadge').textContent = String(state.consoleEntries.length);
}

function showToast(message, duration = 2800) {
  const toast = $('#toast');
  toast.textContent = String(message);
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), duration);
}

function showGameToast(message) {
  const toast = $('#gameToast');
  toast.textContent = String(message);
  toast.classList.add('show');
  clearTimeout(showGameToast.timer);
  showGameToast.timer = setTimeout(() => toast.classList.remove('show'), 1900);
}

function renderGameUI(info = {}) {
  $('#gameHealthValue').textContent = String(info.health ?? 100);
  $('#gameHealthBar').style.width = `${Math.max(0, Math.min(100, Number(info.health ?? 100)))}%`;
  $('#gameStaminaValue').textContent = String(info.stamina ?? 100);
  $('#gameStaminaBar').style.width = `${Math.max(0, Math.min(100, Number(info.stamina ?? 100)))}%`;
  $('#inventoryWood').textContent = String(info.inventory?.wood ?? 0);
  $('#inventoryStone').textContent = String(info.inventory?.stone ?? 0);
  $('#inventoryBerries').textContent = String(info.inventory?.berries ?? 0);
  $('#gameClock').textContent = info.time || 'DAY 01 · 08:00';
}

function syncMode(mode) {
  const play = mode === 'play';
  const paused = mode === 'paused';
  $('#playButtonText').textContent = play ? 'Pause' : paused ? 'Resume' : 'Play';
  $('.play-icon', $('#playBtn')).textContent = play ? 'Ⅱ' : '▶';
  $('#playBtn').classList.toggle('is-running', play);
  $('#playBtn').classList.toggle('is-paused', paused);
  $('#stopBtn').hidden = !(play || paused);
  $('#gameHud').hidden = !(play || paused);
  $('#playPauseOverlay').hidden = !paused;
  $('#viewportState').textContent = play ? 'PLAY MODE' : paused ? 'PAUSED' : state.engine?.activeView === 'game' ? 'GAME VIEW' : 'EDIT MODE';
  $('.viewport-scene-state').classList.toggle('play', play || paused);
  $('#statusMode').textContent = play ? 'Play' : paused ? 'Paused' : 'Edit';
  if (play || paused) state.engine?.setView('game');
  const gameView = play || paused || state.engine?.activeView === 'game';
  $('#gameViewButton').classList.toggle('active', gameView);
  $('#sceneViewButton').classList.toggle('active', !gameView);
  if (!play && !paused) $('#viewportHint').textContent = 'Perspective · Lit';
}

function renderStats(stats) {
  $('#viewportPerf').innerHTML = `${Math.round(stats.fps)} FPS <span>·</span> ${stats.objects} objects`;
  $('#profilerMetrics').innerHTML = [
    ['FPS', `${Math.round(stats.fps)}`, 'frames / second'],
    ['FRAME TIME', `${formatNumber(stats.frameTime, 1)} ms`, 'last frame'],
    ['DRAW CALLS', stats.calls, 'WebGL render calls'],
    ['TRIANGLES', Number(stats.triangles).toLocaleString(), 'submitted this frame'],
    ['GEOMETRIES', stats.geometries, 'renderer cache'],
    ['TEXTURES', stats.textures, 'renderer cache'],
  ].map(([label, value, note]) => `<div class="profiler-card"><span>${html(label)} · ${html(note)}</span><b>${html(value)}</b></div>`).join('');
}

function getObjectIcon(object) {
  const kind = object.userData?.nexus?.kind;
  if (kind === 'Player') return ['♟', 'player'];
  if (kind === 'Enemy') return ['♟', 'pickup'];
  if (kind === 'Pickup') return ['✦', 'pickup'];
  if (kind === 'Light' || object.isLight) return ['☼', 'light'];
  if (kind === 'Terrain' || kind === 'Environment') return ['◈', ''];
  if (kind === 'Tree') return ['♣', ''];
  if (kind === 'Rock') return ['◆', ''];
  if (kind === 'Camera') return ['▣', ''];
  if (object.isMesh) return ['▰', ''];
  return ['◈', ''];
}

function visibleChildren(object) {
  return object.children.filter((child) => !child.userData?.editorOnly);
}

function sceneObjectByUUID(uuid) {
  if (!uuid || !state.engine) return null;
  const object = state.engine.scene.getObjectByProperty('uuid', uuid);
  return object?.userData?.editorOnly ? null : object;
}

function renderHierarchy() {
  if (!state.engine) return;
  const query = $('#hierarchySearch').value.trim().toLowerCase();
  const root = $('#hierarchyTree');
  const selected = state.engine.selected;
  let visibleCount = 0;
  const matches = (object) => object.name.toLowerCase().includes(query) || visibleChildren(object).some(matches);
  const renderObject = (object, depth) => {
    if (object.userData?.editorOnly || (query && !matches(object))) return '';
    const children = visibleChildren(object);
    const expanded = !state.collapsed.has(object.uuid);
    const [icon, iconClass] = getObjectIcon(object);
    const kind = object.userData?.nexus?.kind || (object.isMesh ? 'Mesh' : object.type);
    const isSelected = object === selected;
    visibleCount++;
    const row = `<div class="tree-node"><button class="tree-row${isSelected ? ' selected' : ''}" data-object-uuid="${html(object.uuid)}" draggable="true" style="padding-left:${10 + depth * 14}px" title="${html(object.name)}"><span class="tree-toggle${children.length ? '' : ' empty'}" data-tree-toggle="${html(object.uuid)}">${children.length ? expanded ? '▾' : '▸' : '▸'}</span><span class="tree-icon ${iconClass}">${icon}</span><span class="tree-row-name">${html(object.name || 'GameObject')}</span><span class="tree-row-kind">${html(kind)}</span></button>${children.length && expanded ? `<div class="tree-children">${children.map((child) => renderObject(child, depth + 1)).join('')}</div>` : ''}</div>`;
    return row;
  };
  const roots = state.engine.rootObjects();
  root.innerHTML = roots.map((object) => renderObject(object, 0)).join('');
  $('#objectCount').textContent = String(state.engine.listObjects().length);
  $('#emptyHierarchy').hidden = !query || visibleCount > 0;
  $('#hierarchySceneName').textContent = state.engine.scene.name || 'Scene';
}

function updateSelectionStatus(object) {
  const name = object?.name || '';
  $('#selectionStatus').textContent = name ? `${name} · ${object.userData?.nexus?.kind || object.type}` : 'No selection';
  if (object) {
    $('#selectionLabel').textContent = name;
    $('#selectionLabel').hidden = false;
  } else $('#selectionLabel').hidden = true;
}

function propertyRow(label, input) {
  return `<label class="property-row"><span title="${html(label)}">${html(label)}</span>${input}</label>`;
}
function numericInput(component, key, value, step = '0.1', min = '', max = '') {
  return `<input class="property-input" type="number" data-component="${html(component)}" data-property="${html(key)}" data-value-type="number" value="${html(value ?? 0)}" step="${step}"${min !== '' ? ` min="${min}"` : ''}${max !== '' ? ` max="${max}"` : ''}>`;
}
function textInput(component, key, value) {
  return `<input class="property-input" type="text" data-component="${html(component)}" data-property="${html(key)}" data-value-type="string" value="${html(value ?? '')}">`;
}
function checkboxInput(component, key, checked, extra = '') {
  return `<input type="checkbox" data-component="${html(component)}" data-property="${html(key)}" data-value-type="boolean" ${checked ? 'checked' : ''} ${extra}>`;
}
function selectInput(component, key, value, choices) {
  return `<select class="property-input" data-component="${html(component)}" data-property="${html(key)}" data-value-type="string">${choices.map(([option, label]) => `<option value="${html(option)}" ${value === option ? 'selected' : ''}>${html(label)}</option>`).join('')}</select>`;
}

function componentRows(component, object) {
  const c = component.type;
  if (c === 'MeshRenderer') {
    const colors = `<input class="property-input color" type="color" data-component="MeshRenderer" data-property="baseColor" data-value-type="string" value="${html(component.baseColor || '#d7dfeb')}">`;
    const materials = state.project?.materials || [];
    const materialValue = materials.find((material) => material.baseColor?.toLowerCase() === component.baseColor?.toLowerCase())?.name || '';
    const materialSelect = `<select class="property-input" data-action="assign-material" aria-label="Assign material"><option value="">Default material</option>${materials.map((material) => `<option value="${html(material.name)}" ${material.name === materialValue ? 'selected' : ''}>${html(material.name)}</option>`).join('')}</select>`;
    return propertyRow('Material', materialSelect) + propertyRow('Base Color', colors) + propertyRow('Metallic', numericInput(c, 'metallic', component.metallic, '0.01', 0, 1)) + propertyRow('Roughness', numericInput(c, 'roughness', component.roughness, '0.01', 0, 1));
  }
  if (c === 'Collider') return propertyRow('Shape', selectInput(c, 'shape', component.shape || 'Box', [['Box','Box'],['Sphere','Sphere'],['Capsule','Capsule'],['Cylinder','Cylinder'],['Plane','Plane'],['Terrain','Terrain']])) + propertyRow('Radius / Extents', numericInput(c, 'radius', component.radius || 0.5, '0.05', 0.05)) + propertyRow('Is Trigger', checkboxInput(c, 'isTrigger', component.isTrigger));
  if (c === 'RigidBody') return propertyRow('Mass', numericInput(c, 'mass', component.mass || 1, '0.1', 0.01)) + propertyRow('Use Gravity', checkboxInput(c, 'useGravity', component.useGravity !== false)) + propertyRow('Kinematic', checkboxInput(c, 'isKinematic', component.isKinematic));
  if (c === 'CharacterController') return propertyRow('Move Speed', numericInput(c, 'moveSpeed', component.moveSpeed || 6, '0.1', 0)) + propertyRow('Jump Height', numericInput(c, 'jumpHeight', component.jumpHeight || 2.2, '0.1', 0)) + propertyRow('Sprint Multiplier', numericInput(c, 'sprintMultiplier', component.sprintMultiplier || 1.7, '0.1', 1)) + propertyRow('Gravity', numericInput(c, 'gravity', component.gravity || 18, '0.1', 0));
  if (c === 'Health') return propertyRow('Max Health', numericInput(c, 'maxHealth', component.maxHealth || 100, '1', 1)) + propertyRow('Current Health', numericInput(c, 'currentHealth', component.currentHealth ?? component.maxHealth ?? 100, '1', 0));
  if (c === 'Stamina') return propertyRow('Max Stamina', numericInput(c, 'maxStamina', component.maxStamina || 100, '1', 1)) + propertyRow('Current Stamina', numericInput(c, 'currentStamina', component.currentStamina ?? component.maxStamina ?? 100, '1', 0)) + propertyRow('Sprint Cost / s', numericInput(c, 'sprintCost', component.sprintCost || 18, '1', 0));
  if (c === 'Inventory') return propertyRow('Capacity', numericInput(c, 'capacity', component.capacity || 30, '1', 1)) + propertyRow('Wood', numericInput(c, 'wood', component.wood || 0, '1', 0)) + propertyRow('Stone', numericInput(c, 'stone', component.stone || 0, '1', 0)) + propertyRow('Berries', numericInput(c, 'berries', component.berries || 0, '1', 0));
  if (c === 'AIController') return propertyRow('Behavior', selectInput(c, 'behavior', component.behavior || 'Chase', ['Idle','Patrol','Investigate','Follow','Chase','Attack','Flee','Dead'].map((value) => [value, value]))) + propertyRow('Current State', `<span class="state-readout">${html(component.state || 'Idle')}</span>`) + propertyRow('Move Speed', numericInput(c, 'moveSpeed', component.moveSpeed || 2.4, '0.1', 0)) + propertyRow('Detection Range', numericInput(c, 'detectionRange', component.detectionRange || 20, '0.5', 0)) + propertyRow('Attack Range', numericInput(c, 'attackRange', component.attackRange || 1.5, '0.1', 0)) + propertyRow('Damage', numericInput(c, 'damage', component.damage || 8, '1', 0));
  if (c === 'Pickup') return propertyRow('Resource', selectInput(c, 'resource', component.resource || 'wood', [['wood','Wood'],['stone','Stone'],['berries','Berries']])) + propertyRow('Amount', numericInput(c, 'amount', component.amount || 1, '1', 1)) + propertyRow('Collect Radius', numericInput(c, 'collectRadius', component.collectRadius || 2.2, '0.1', 0.2));
  if (c === 'DayNight') return propertyRow('Cycle Duration (s)', numericInput(c, 'cycleDuration', component.cycleDuration || 180, '1', 30)) + propertyRow('Start Hour', numericInput(c, 'startHour', component.startHour ?? 8, '1', 0, 23));
  if (c === 'Interactable') return propertyRow('Action', selectInput(c, 'action', component.action || 'Open', [['Open','Open'],['Pickup','Pickup'],['Talk','Talk'],['Activate','Activate']])) + propertyRow('Prompt', textInput(c, 'prompt', component.prompt || 'Interact'));
  if (c === 'CameraFollow') return propertyRow('Distance', numericInput(c, 'distance', component.distance ?? 7, '0.1', 0)) + propertyRow('Height', numericInput(c, 'height', component.height ?? 3.2, '0.1', 0)) + propertyRow('Look Height', numericInput(c, 'lookHeight', component.lookHeight ?? 1.1, '0.1', 0)) + propertyRow('Smoothing', numericInput(c, 'smoothing', component.smoothing || 8, '0.1', 0));
  return propertyRow('Enabled', checkboxInput(c, 'enabled', component.enabled !== false));
}

function componentCard(component, object) {
  const info = COMPONENT_TYPES[component.type] || { glyph: '◈', label: component.type };
  return `<section class="component-card" data-component-card="${html(component.type)}"><header class="component-head"><span class="component-chevron">⌄</span><span class="component-glyph">${html(info.glyph)}</span><span class="component-title">${html(info.label)}</span>${component.type === 'Transform' ? '' : `<button class="component-remove" data-remove-component="${html(component.type)}" title="Remove component">×</button>`}</header><div class="component-body">${component.type === 'Transform' ? transformRows(object) : `<label class="property-row component-enabled-row"><span>Enabled</span>${checkboxInput(component.type, 'enabled', component.enabled !== false)}</label>${componentRows(component, object)}`}</div></section>`;
}

function transformRows(object) {
  const pos = object.position, rot = object.rotation, scale = object.scale;
  const vector = (key, values, degrees = false) => `<div class="vector-fields" data-transform-group="${key}">${['X','Y','Z'].map((axis, index) => `<input class="property-input transform-input" type="number" data-transform="${key}" data-index="${index}" data-degrees="${degrees}" aria-label="${key} ${axis}" value="${formatNumber(degrees ? values[index] * 180 / Math.PI : values[index])}" step="0.1">`).join('')}</div>`;
  return propertyRow('Position', vector('position', [pos.x, pos.y, pos.z])) + propertyRow('Rotation', vector('rotation', [rot.x, rot.y, rot.z], true)) + propertyRow('Scale', vector('scale', [scale.x, scale.y, scale.z]));
}

function renderInspector(object = state.engine?.selected) {
  const host = $('#inspectorContent');
  if (!object) {
    host.innerHTML = '<div class="inspector-empty"><div class="empty-orbit">◉</div><b>Select an object</b><span>Choose an item in the Hierarchy or click it in the viewport to inspect its components.</span></div>';
    return;
  }
  object.userData.nexus ||= { kind: object.isMesh ? 'Mesh' : object.type, components: [] };
  object.userData.nexus.components ||= [];
  const kind = object.userData.nexus.kind || object.type;
  const components = object.userData.nexus.components;
  if (object.isMesh && !components.some((component) => component.type === 'MeshRenderer')) {
    components.unshift({ type: 'MeshRenderer', enabled: true, baseColor: object.material?.color ? `#${object.material.color.getHexString()}` : '#d7dfeb', metallic: object.material?.metalness || 0, roughness: object.material?.roughness ?? 0.8 });
  }
  const transforms = { type: 'Transform' };
  const cardList = [componentCard(transforms, object), ...components.map((component) => componentCard(component, object))].join('');
  const componentOptions = Object.entries(COMPONENT_TYPES).filter(([type]) => type !== 'MeshRenderer' || object.isMesh || object.getObjectByProperty('isMesh', true)).map(([type, info]) => `<button class="menu-item" data-add-component="${html(type)}">${html(info.label)}<small>${html(type)}</small></button>`).join('');
  host.innerHTML = `<div class="inspector-object-head"><span class="inspector-object-icon">${getObjectIcon(object)[0]}</span><div class="inspector-name-wrap"><input class="inspector-name" id="inspectorObjectName" value="${html(object.name)}" aria-label="Object name"><span class="inspector-object-type">${html(kind)}</span></div><label class="inspector-enabled" title="Object visibility"><input type="checkbox" data-object-enabled ${object.visible ? 'checked' : ''}>Visible</label></div>${cardList}<button class="inspector-add" id="addComponentInspector">＋ Add Component</button><div class="inspector-note">Components configure the running prototype systems. Custom JavaScript execution is not enabled in this build.</div><div id="componentPicker" class="component-picker" hidden>${componentOptions}</div>`;
}

function updateTransformFields(object) {
  if (!object || state.engine.selected !== object) return;
  $$('.transform-input', $('#inspectorContent')).forEach((input) => {
    if (document.activeElement === input) return;
    const index = Number(input.dataset.index), key = input.dataset.transform;
    const value = key === 'position' ? object.position.getComponent(index) : key === 'rotation' ? object.rotation.getComponent(index) * 180 / Math.PI : object.scale.getComponent(index);
    input.value = formatNumber(value);
  });
}

function updateHierarchySelection() {
  $$('.tree-row', $('#hierarchyTree')).forEach((row) => row.classList.toggle('selected', row.dataset.objectUuid === state.engine.selected?.uuid));
}

function renderAssets() {
  const query = $('#assetSearch').value.trim().toLowerCase();
  $('#assetGrid').innerHTML = builtinAssets.filter((asset) => asset.label.toLowerCase().includes(query) || asset.category.toLowerCase().includes(query)).map((asset) => `<button class="asset-tile" data-type="${html(asset.type)}" draggable="${asset.type !== 'Material Asset'}" title="${html(asset.label)} — click to add or drag into viewport"><span class="asset-preview">${html(asset.icon)}</span><span>${html(asset.label)}</span></button>`).join('');
  renderProjectAssets(query);
}

function renderProjectAssets(query = '') {
  const assets = [];
  for (const item of state.project?.assets || []) assets.push({ id: item.id, type: 'imported', icon: '◇', name: item.name, detail: item.format || 'Imported model', item });
  for (const item of state.project?.materials || []) assets.push({ id: item.id, type: 'material', icon: '◉', name: item.name, detail: `PBR · ${item.baseColor}`, item });
  for (const item of state.project?.prefabs || []) assets.push({ id: item.id, type: 'prefab', icon: '▣', name: item.name, detail: 'Prefab', item });
  for (const item of state.project?.scripts || []) assets.push({ id: item.id, type: 'script', icon: 'JS', name: item.name, detail: 'Stored script · not executed', item });
  const filtered = assets.filter((asset) => asset.name.toLowerCase().includes(query));
  $('#projectAssetsHeading').hidden = !filtered.length;
  $('#projectAssetCount').textContent = String(filtered.length);
  $('#projectAssetGrid').innerHTML = filtered.map((asset) => `<button class="asset-tile project-asset" data-project-asset-type="${html(asset.type)}" data-project-asset-id="${html(asset.id)}" title="${html(asset.detail)}"><span class="asset-preview">${html(asset.icon)}</span><span>${html(asset.name)}</span></button>`).join('');
}

function switchLeftTab(tab) {
  $$('.left-tabs .tab').forEach((button) => button.classList.toggle('active', button.dataset.leftTab === tab));
  $('#hierarchyView').hidden = tab !== 'hierarchy';
  $('#assetsView').hidden = tab !== 'assets';
  if (tab === 'assets') renderAssets();
}

function selectBottomTab(tab) {
  state.currentTab = tab;
  $$('.bottom-tab').forEach((button) => button.classList.toggle('active', button.dataset.bottomTab === tab));
  $$('.bottom-view').forEach((view) => view.classList.toggle('active', view.dataset.bottomView === tab));
  if (tab === 'profiler') renderStats(state.engine.getStats());
}

function setProblems(problems) {
  state.problems = Array.isArray(problems) ? problems : [];
  $('#problemBadge').textContent = String(state.problems.length);
  if (!state.problems.length) {
    $('#problemList').innerHTML = '<div class="problems-empty"><span>✓</span> No project problems detected.</div>';
    return;
  }
  $('#problemList').innerHTML = state.problems.map((problem, index) => `<div class="problem-row ${problem.severity === 'error' ? 'error' : ''}"><span class="severity">${html(problem.severity.toUpperCase())}</span><span>${html(problem.message)}</span><span class="problem-target">${html(problem.target || 'Project')}</span><button data-problem-ai="${index}" title="Plan a local fix">AI</button></div>`).join('');
}

function selectedToolLabel(tool) {
  return TOOL_DEFINITIONS.find((definition) => definition.name === tool)?.name || tool;
}

function addAgentMessage(text, kind = 'assistant') {
  const conversation = $('#agentConversation');
  const entry = document.createElement('div');
  entry.className = `agent-message ${kind}`;
  entry.textContent = text;
  conversation.appendChild(entry);
  conversation.scrollTop = conversation.scrollHeight;
  return entry;
}

function renderPlanCard(plan) {
  const card = document.createElement('div');
  card.className = 'plan-card';
  const impact = plan.destructive ? `⚠ REVIEW · ${plan.impact}` : plan.impact || 'Read-only inspection';
  card.innerHTML = `<div class="plan-head"><b>${html(plan.title)}</b><span>${html(impact)}</span></div><div class="plan-steps">${plan.steps.length ? plan.steps.map((item, index) => `<div class="plan-step"><span class="step-number">${index + 1}</span><span>${html(item.label)}</span><code>${html(selectedToolLabel(item.tool))}</code></div>`).join('') : '<div class="plan-step"><span class="step-number">!</span><span>No change will be made.</span><code>NO TOOL CALLS</code></div>'}</div>${plan.notes?.length ? `<div class="plan-notes">${plan.notes.map((note) => `<p>${html(note)}</p>`).join('')}</div>` : ''}<div class="plan-actions"><button class="btn btn-small btn-bright" data-plan-action="apply" ${plan.unsupported || !plan.steps.length ? 'disabled' : ''}>${plan.destructive ? 'Review & Apply' : 'Apply Plan'}</button><button class="btn btn-small" data-plan-action="cancel">Cancel</button><span class="plan-note">Structured tool calls · project-scoped</span></div>`;
  $('#agentConversation').appendChild(card);
  $('#agentConversation').scrollTop = $('#agentConversation').scrollHeight;
  return card;
}

function createAgentContext() {
  return {
    engine: state.engine,
    project: state.project,
    getSelected: () => state.engine.selected,
    markDirty,
    createScene,
    buildProject: async () => {
      const result = await runBuild('release');
      return result ? `Build downloaded: ${result.filename}. It is a standalone HTML game; Windows .exe packaging is not included.` : 'Build failed; inspect Output and Problems.';
    },
    readConsole: (limit = 10) => state.consoleEntries.slice(-Math.max(1, Math.min(40, limit))).map((entry) => `${entry.level}: ${entry.message}`).join('\n') || 'Console is empty.',
    setProblems,
    onToolResult: (result) => logConsole('INFO', `Agent tool ${result.tool}: ${result.result}`),
  };
}

function planAgentPrompt(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return;
  addAgentMessage(text, 'user');
  $('#agentPrompt').value = '';
  const plan = planPrompt(text, { engine: state.engine, getSelected: () => state.engine.selected });
  state.activePlan = plan;
  renderPlanCard(plan);
  selectBottomTab('agent');
}

async function applyAgentPlan(card) {
  const plan = state.activePlan;
  if (!plan || plan.unsupported) return;
  if (plan.destructive && !confirm(`This plan includes a destructive change. Apply the reviewed ${plan.steps.length}-step plan to the active scene?`)) return;
  const button = $('[data-plan-action="apply"]', card);
  button.disabled = true; button.textContent = 'Running…';
  try {
    const results = await applyPlan(plan, createAgentContext());
    const summary = results.map((result) => result.result).join('\n');
    renderAssets(); renderHierarchy(); renderInspector(state.engine.selected); renderGraphs();
    addAgentMessage(`Plan applied.\n${summary}`, 'assistant');
    markDirty('AI plan applied');
    await saveProjectNow(false);
  } catch (error) {
    button.disabled = false; button.textContent = 'Retry Plan';
    addAgentMessage(`Tool call failed: ${error.message}`, 'assistant');
    logConsole('ERROR', `Agent plan failed: ${error.message}`);
  }
}

function buildProjectWizard() {
  const selectedTemplate = { value: 'Island Survival' };
  const fields = (initialName = 'New Game') => `<div class="modal-head"><div><h2>New Project</h2><p>Create a real editable project in this browser workspace. You can export it as a portable .nexus.json file.</p></div><button class="modal-close" data-close-modal>×</button></div><form id="newProjectForm"><div class="modal-body"><label class="form-field"><span>Project name</span><input class="form-control" id="newProjectName" required maxlength="48" value="${html(initialName)}"></label><div class="form-grid"><label class="form-field"><span>Graphics quality</span><select class="form-control" id="newProjectQuality"><option>High</option><option>Balanced</option><option>Performance</option></select></label><label class="form-field"><span>Target platform</span><select class="form-control" id="newProjectTarget"><option value="Web">Web · standalone HTML</option><option value="Windows">Windows · EXE not available</option></select></label></div><label class="form-field"><span>Project location</span><input class="form-control" value="Browser Workspace · IndexedDB" disabled><small>The browser build cannot write to arbitrary folders. Export a .nexus.json file to move a project between machines.</small></label><div class="form-field"><span>Starting template</span></div><div class="template-grid">${TEMPLATE_LIST.map((template) => `<button type="button" class="template-option ${template.name === selectedTemplate.value ? 'selected' : ''}" data-template="${html(template.name)}"><b>${html(template.icon)} &nbsp; ${html(template.name)}</b><small>${html(template.description)}</small></button>`).join('')}</div><div class="modal-callout"><span>i</span><span><b>Focused browser editor.</b> This build includes a WebGL scene editor and a playable sample. Native Windows packaging and arbitrary C++/JavaScript game scripting are not implemented.</span></div></div><div class="modal-footer"><button type="button" class="btn" data-close-modal>Cancel</button><button class="btn btn-bright" type="submit">Create Project</button></div></form>`;
  $('#modal').classList.remove('wide');
  $('#modal').innerHTML = fields();
  $('#modalScrim').hidden = false;
  $('#modal').onclick = (event) => {
    const template = event.target.closest('[data-template]');
    if (template) {
      selectedTemplate.value = template.dataset.template;
      $$('.template-option', $('#modal')).forEach((button) => button.classList.toggle('selected', button === template));
    }
    if (event.target.closest('[data-close-modal]')) closeModal();
  };
  $('#modal').onsubmit = (event) => {
    event.preventDefault();
    const name = $('#newProjectName').value.trim();
    if (!name) return;
    closeModal();
    createNewProject(name, selectedTemplate.value, $('#newProjectQuality').value, $('#newProjectTarget').value);
  };
}

async function createNewProject(name, template, quality, target) {
  if (state.engine.mode === 'play') state.engine.stopPlay();
  if (state.dirty) await saveProjectNow(false);
  state.suppressDirty = true;
  state.undo.length = 0; state.redo.length = 0;
  state.project = createProject({ name, template, quality, target });
  state.project.graphs = template === 'Island Survival' ? createDefaultGraphs() : [];
  seedTemplate(state.engine, template);
  state.engine.setQuality(quality);
  state.project.sceneName = state.engine.scene.name || 'Main';
  state.project.scenes = [{ name: state.project.sceneName, sceneData: state.engine.serializeScene() }];
  state.project.sceneData = null;
  state.engine.setGraphs(state.project.graphs);
  updateProjectLabels(); renderAssets(); renderGraphs(); setProblems([]);
  state.suppressDirty = false;
  state.dirty = true;
  await saveProjectNow(true);
  logConsole('SUCCESS', `Created ${template} project “${name}”.`);
}

function updateProjectLabels() {
  if (!state.project) return;
  $('#projectNameLabel').textContent = state.project.name;
  $('#statusProject').textContent = state.project.name;
  $('#projectTarget').textContent = `${state.project.target === 'Windows' ? 'Windows target · HTML runtime' : state.project.target || 'Web'} · Editor`;
  $('#sceneNameLabel').textContent = state.engine.scene.name || state.project.sceneName;
  $('#hierarchySceneName').textContent = state.engine.scene.name || state.project.sceneName;
  $('#projectStorageLabel').textContent = state.saveLabel;
  document.title = `${state.project.name} — NEXUS Game Studio`;
}

async function initializeProject(project) {
  state.project = project;
  state.project.schemaVersion ||= 1;
  state.project.assets ||= []; state.project.materials ||= []; state.project.scripts ||= []; state.project.prefabs ||= []; state.project.graphs ||= [];
  state.project.scenes ||= [];
  let sceneName = state.project.sceneName || 'Main';
  let entry = state.project.scenes.find((scene) => scene.name === sceneName) || state.project.scenes[0];
  if (entry?.sceneData) {
    state.project.sceneName = entry.name || sceneName;
    if (!state.engine.loadScene(entry.sceneData)) seedTemplate(state.engine, state.project.template || 'Empty Project');
  } else if (state.project.sceneData) {
    state.engine.loadScene(state.project.sceneData);
    state.project.sceneName = state.engine.scene.name || sceneName;
  } else {
    seedTemplate(state.engine, state.project.template || 'Empty Project');
    state.project.sceneName = state.engine.scene.name || sceneName;
  }
  if (!state.project.graphs.length && state.project.template === 'Island Survival') state.project.graphs = createDefaultGraphs();
  state.engine.setGraphs(state.project.graphs);
  state.engine.setQuality(state.project.quality || 'High');
  syncCurrentScene();
  updateProjectLabels(); renderHierarchy(); renderInspector(state.engine.selected); renderAssets(); renderGraphs();
  setProblems(validateProject(state.project, state.engine));
  state.suppressDirty = false;
  state.dirty = false;
  await saveProjectNow(false);
}

function closeModal() {
  $('#modalScrim').hidden = true;
  $('#modal').innerHTML = '';
  $('#modal').onclick = null; $('#modal').onsubmit = null;
}

function showCreateMaterialModal() {
  const current = state.engine.selected?.userData?.nexus?.components?.find((component) => component.type === 'MeshRenderer');
  $('#modal').classList.remove('wide');
  $('#modal').innerHTML = `<div class="modal-head"><div><h2>New PBR Material</h2><p>Create a reusable base-color / metallic / roughness material for this project.</p></div><button class="modal-close" data-close-modal>×</button></div><form id="materialForm"><div class="modal-body"><label class="form-field"><span>Name</span><input class="form-control" id="materialName" value="Coastal Sand" maxlength="40" required></label><div class="form-grid"><label class="form-field"><span>Base Color</span><input class="form-control" id="materialColor" type="color" value="${html(current?.baseColor || '#cbb48a')}"></label><label class="form-field"><span>Metallic <small id="metallicValue">0.00</small></span><input class="form-control" id="materialMetallic" type="range" min="0" max="1" step="0.01" value="0"></label></div><label class="form-field"><span>Roughness <small id="roughnessValue">0.85</small></span><input class="form-control" id="materialRoughness" type="range" min="0" max="1" step="0.01" value="0.85"></label><div class="modal-callout"><span>i</span><span>Material preview is applied to the selected mesh when you choose it in the Inspector. Normal maps, emission maps and opacity controls are not in this build.</span></div></div><div class="modal-footer"><button type="button" class="btn" data-close-modal>Cancel</button><button class="btn btn-bright" type="submit">Create Material</button></div></form>`;
  $('#modalScrim').hidden = false;
  $('#modal').onclick = (event) => { if (event.target.closest('[data-close-modal]')) closeModal(); };
  $('#modal').oninput = () => { $('#metallicValue').textContent = Number($('#materialMetallic').value).toFixed(2); $('#roughnessValue').textContent = Number($('#materialRoughness').value).toFixed(2); };
  $('#modal').onsubmit = (event) => {
    event.preventDefault();
    state.project.materials.push({ id: `material-${Date.now()}`, name: $('#materialName').value.trim() || 'Material', baseColor: $('#materialColor').value, metallic: Number($('#materialMetallic').value), roughness: Number($('#materialRoughness').value) });
    renderAssets(); renderInspector(state.engine.selected); markDirty('Material created'); closeModal();
    logConsole('SUCCESS', `Created material “${state.project.materials.at(-1).name}”.`);
  };
}

function showHistoryModal() {
  syncCurrentScene();
  const snapshots = state.project.snapshots || [];
  $('#modal').classList.remove('wide');
  $('#modal').innerHTML = `<div class="modal-head"><div><h2>Project Snapshots</h2><p>Snapshots store the active scene graph. The newest eight are retained in the browser workspace.</p></div><button class="modal-close" data-close-modal>×</button></div><div class="modal-body"><div class="history-list">${snapshots.length ? snapshots.map((snapshot) => `<div class="history-item"><div><b>${html(snapshot.label)}</b><small>${html(new Date(snapshot.createdAt).toLocaleString())} · ${html(snapshot.sceneData?.object?.children?.length || 0)} scene roots</small></div><button class="btn btn-small" data-restore-snapshot="${html(snapshot.id)}">Restore</button></div>`).join('') : '<div class="problems-empty">No snapshots yet. Create one before a major edit.</div>'}</div></div><div class="modal-footer"><button class="btn" data-close-modal>Close</button><button class="btn btn-bright" id="takeSnapshotButton">＋ Create Snapshot</button></div>`;
  $('#modalScrim').hidden = false;
  $('#modal').onclick = (event) => {
    if (event.target.closest('[data-close-modal]')) closeModal();
    if (event.target.closest('#takeSnapshotButton')) { createSnapshot(); showHistoryModal(); }
    const restore = event.target.closest('[data-restore-snapshot]');
    if (restore) { restoreSnapshot(restore.dataset.restoreSnapshot); closeModal(); }
  };
}

function createSnapshot() {
  if (state.engine.mode === 'play') { showToast('Stop Play Mode before snapshotting.'); return; }
  syncCurrentScene();
  const label = prompt('Snapshot name', `Snapshot ${String((state.project.snapshots?.length || 0) + 1).padStart(3, '0')}`);
  if (label === null) return;
  saveSnapshot(state.project, state.engine.serializeScene(), label);
  markDirty('Snapshot created'); saveProjectNow(false);
  logConsole('SUCCESS', `Created snapshot “${label || `Snapshot ${state.project.snapshots.length}`}”.`);
}

function restoreSnapshot(id) {
  const snapshot = state.project.snapshots?.find((entry) => entry.id === id);
  if (!snapshot) return;
  recordUndo('Restore snapshot');
  state.engine.loadScene(snapshot.sceneData);
  updateSceneLabels(); markDirty('Snapshot restored'); saveProjectNow(false);
  logConsole('WARNING', `Restored snapshot “${snapshot.label}”.`);
}

function createScene(name) {
  if (state.engine.mode === 'play') state.engine.stopPlay();
  syncCurrentScene();
  const clean = String(name || 'New Scene').trim() || 'New Scene';
  const exists = state.project.scenes.some((entry) => entry.name.toLowerCase() === clean.toLowerCase());
  const sceneName = exists ? `${clean} ${state.project.scenes.length + 1}` : clean;
  state.engine.createScene(sceneName);
  state.project.sceneName = sceneName;
  const data = state.engine.serializeScene();
  state.project.scenes.push({ name: sceneName, sceneData: data });
  state.project.sceneData = null;
  updateSceneLabels(); updateProjectLabels(); markDirty('Scene created');
  logConsole('SUCCESS', `Created scene “${sceneName}”.`);
}

function switchScene(name) {
  if (state.engine.mode === 'play') state.engine.stopPlay();
  syncCurrentScene();
  const entry = state.project.scenes.find((scene) => scene.name === name);
  if (!entry) { showToast(`Scene “${name}” not found.`); return; }
  state.project.sceneName = entry.name;
  state.engine.loadScene(entry.sceneData);
  state.engine.setGraphs(state.project.graphs);
  updateSceneLabels(); updateProjectLabels(); markDirty(`Opened scene ${entry.name}`);
}

function openScenesModal() {
  const scenes = state.project.scenes || [];
  $('#modal').classList.remove('wide');
  $('#modal').innerHTML = `<div class="modal-head"><div><h2>Project Scenes</h2><p>Each scene is stored separately in the current project.</p></div><button class="modal-close" data-close-modal>×</button></div><div class="modal-body"><div class="history-list">${scenes.map((scene) => `<div class="history-item"><div><b>${html(scene.name)}</b><small>${scene.name === state.project.sceneName ? 'Active scene' : 'Saved scene'}</small></div><button class="btn btn-small" data-open-scene="${html(scene.name)}" ${scene.name === state.project.sceneName ? 'disabled' : ''}>Open</button></div>`).join('') || '<div class="problems-empty">No scenes in this project.</div>'}</div></div><div class="modal-footer"><button class="btn" data-close-modal>Close</button><button class="btn btn-bright" id="createSceneModalButton">＋ New Scene</button></div>`;
  $('#modalScrim').hidden = false;
  $('#modal').onclick = (event) => {
    if (event.target.closest('[data-close-modal]')) closeModal();
    const open = event.target.closest('[data-open-scene]'); if (open) { switchScene(open.dataset.openScene); closeModal(); }
    if (event.target.closest('#createSceneModalButton')) { closeModal(); const name = prompt('Scene name', 'New Scene'); if (name) createScene(name); }
  };
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function exportProjectFile() {
  syncCurrentScene();
  const data = JSON.stringify(state.project, null, 2);
  downloadBlob(`${state.project.name.replace(/[^\w -]/g, '').trim().replace(/\s+/g, '-') || 'NEXUS-Project'}.nexus.json`, new Blob([data], { type: 'application/json' }));
  logConsole('SUCCESS', 'Exported portable .nexus.json project file.');
}

async function importProjectFile(file) {
  try {
    if (state.engine.mode === 'play') state.engine.stopPlay();
    if (state.dirty) await saveProjectNow(false);
    const data = JSON.parse(await file.text());
    if (data.schemaVersion !== 1 || !data.name || !Array.isArray(data.scenes) && !data.sceneData) throw new Error('This file is not a supported NEXUS .nexus.json project.');
    data.id = `import-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    data.snapshots ||= []; data.materials ||= []; data.assets ||= []; data.scripts ||= []; data.prefabs ||= []; data.graphs ||= [];
    state.suppressDirty = true; state.undo.length = 0; state.redo.length = 0;
    await initializeProject(data);
    logConsole('SUCCESS', `Opened project “${data.name}” from ${file.name}.`);
    showToast(`Opened ${data.name}.`);
  } catch (error) {
    logConsole('ERROR', `Project import failed: ${error.message}`); showToast(error.message);
  }
}

function updateBuildStep(index, status, message = '') {
  const item = $(`[data-build-step="${index}"]`, $('#modal'));
  if (!item) return;
  item.classList.remove('active', 'done', 'failed');
  if (status === 'active') item.classList.add('active');
  if (status === 'done') item.classList.add('done');
  if (status === 'failed') item.classList.add('failed');
  const stepStatus = $('.step-status', item);
  if (stepStatus) stepStatus.textContent = message || (status === 'done' ? 'complete' : status === 'active' ? 'working…' : status === 'failed' ? 'failed' : 'waiting');
}

function openBuildModal(mode = 'release') {
  selectBottomTab('output');
  $('#modal').classList.remove('wide');
  const modeName = mode === 'development' ? 'Development' : 'Release';
  $('#modal').innerHTML = `<div class="modal-head"><div><h2>Build ${html(state.project.name)}</h2><p>Build a self-contained browser game. This build does not produce a Windows .exe.</p></div><button class="modal-close" data-close-modal>×</button></div><div class="modal-body"><label class="form-field"><span>Build configuration</span><select class="form-control" id="buildMode"><option value="release" ${mode === 'release' ? 'selected' : ''}>Release · minimal runtime diagnostics</option><option value="development" ${mode === 'development' ? 'selected' : ''}>Development · live FPS / object overlay</option></select></label><label class="form-field"><span>Target</span><select class="form-control" disabled><option>Single-file HTML · modern browser / offline</option><option>Windows .exe · future native packaging</option></select><small>Portable HTML can be opened independently in Chrome, Edge, Firefox or Safari. A native Windows executable needs a desktop wrapper and Windows build toolchain not present in this browser-based build.</small></label><div class="build-steps">${['Validate project and active scene','Check runtime dependencies','Serialize scene and PBR assets','Bundle the offline Three.js runtime','Validate and download the standalone game'].map((label, index) => `<div class="build-step" data-build-step="${index}"><i>${index + 1}</i><span>${html(label)}</span><span class="step-status">waiting</span></div>`).join('')}</div><div id="buildResult"></div></div><div class="modal-footer"><button class="btn" data-close-modal id="buildCloseButton">Close</button><button class="btn btn-bright" id="runBuildButton">Build HTML Game</button></div>`;
  $('#modalScrim').hidden = false;
  $('#modal').onclick = (event) => {
    if (event.target.closest('[data-close-modal]')) closeModal();
    if (event.target.closest('#runBuildButton')) { const selected = $('#buildMode').value; runBuild(selected, true); }
  };
}

function appendBuildLog(message, type = '') {
  const line = document.createElement('div'); line.className = `build-line ${type}`; line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  $('#buildLog').prepend(line); logConsole(type === 'warn' ? 'WARNING' : type === 'success' ? 'SUCCESS' : 'INFO', message);
}

async function runBuild(mode = 'release', modalAlreadyOpen = false) {
  if (state.buildRunning) return null;
  if (state.engine.mode === 'play') { showToast('Stop Play Mode before building the saved editor scene.'); return null; }
  state.buildRunning = true;
  if (!modalAlreadyOpen) openBuildModal(mode);
  const selectedMode = $('#buildMode')?.value || mode;
  const statuses = [0, 0, 0, 0, 0];
  const resultNode = $('#buildResult');
  const runButton = $('#runBuildButton');
  if (runButton) { runButton.disabled = true; runButton.textContent = 'Building…'; }
  $('#buildLog').innerHTML = '';
  resultNode.innerHTML = '';
  for (let i = 0; i < 5; i++) updateBuildStep(i, 'waiting');
  const finish = (message, isWarning = false, isSuccess = false) => {
    resultNode.innerHTML = `<div class="build-result ${isWarning ? 'warning' : isSuccess ? 'success' : ''}">${message}</div>`;
    if (runButton) { runButton.disabled = false; runButton.textContent = 'Build Again'; }
    state.buildRunning = false;
  };
  try {
    updateBuildStep(0, 'active');
    const problems = validateProject(state.project, state.engine);
    const errors = problems.filter((problem) => problem.severity === 'error');
    setProblems(problems);
    if (errors.length) throw new Error(errors.map((problem) => problem.message).join(' '));
    updateBuildStep(0, 'done'); appendBuildLog(`Validated ${state.engine.listObjects().length} scene objects.`);

    updateBuildStep(1, 'active');
    const runtimeResponse = await fetch(new URL('../vendor/three.module.js', import.meta.url), { method: 'HEAD' });
    if (!runtimeResponse.ok) throw new Error(`Bundled Three.js runtime could not be read (HTTP ${runtimeResponse.status}).`);
    updateBuildStep(1, 'done'); appendBuildLog('Vendored Three.js renderer is reachable.');

    updateBuildStep(2, 'active');
    syncCurrentScene();
    const sceneData = state.engine.serializeScene();
    const sceneRoots = state.engine.rootObjects().length;
    updateBuildStep(2, 'done'); appendBuildLog(`Serialized active scene “${state.engine.scene.name}” (${sceneRoots} root objects).`);

    updateBuildStep(3, 'active');
    const built = await buildPortableGame(state.project, state.engine, selectedMode);
    if (typeof built.html !== 'string' || !built.html.includes('ObjectLoader') || !built.html.includes('KeyW')) throw new Error('Standalone runtime package failed the content validation check.');
    updateBuildStep(3, 'done'); appendBuildLog(`Bundled renderer + runtime (${(built.html.length / (1024 * 1024)).toFixed(2)} MiB HTML).`);

    updateBuildStep(4, 'active');
    const inlineScene = built.html.match(/<script type="application\/json" id="nexus-project-data">([\s\S]*?)<\/script>/);
    if (!inlineScene) throw new Error('Embedded project data block is missing from the build.');
    const parsed = JSON.parse(inlineScene[1]);
    if (!parsed.scene?.object) throw new Error('Build has no valid scene graph.');
    if (/\bimport\s+[^(']/.test(built.html.slice(built.html.indexOf('<script type="module">')))) throw new Error('The standalone build contains a module import that would require an external dependency.');
    downloadBlob(built.filename, new Blob([built.html], { type: 'text/html;charset=utf-8' }));
    updateBuildStep(4, 'done'); appendBuildLog(`Downloaded ${built.filename}.`, 'success');
    const warningText = problems.some((problem) => problem.severity === 'warning') ? '<br><br>Project validation reported warnings; see Problems for details.' : '';
    finish(`<strong>Build complete:</strong> ${html(built.filename)} has been generated as a single-file, offline-capable browser game.${warningText}<br><br><strong>Windows .exe:</strong> not generated. This web editor does not include Electron/Tauri or a Windows native toolchain.`, false, true);
    return built;
  } catch (error) {
    const active = $$('.build-step', $('#modal')).findIndex((item) => item.classList.contains('active'));
    if (active >= 0) updateBuildStep(active, 'failed', 'error');
    appendBuildLog(`Build failed: ${error.message}`, 'warn');
    finish(`<strong>Build failed:</strong> ${html(error.message)}<br><br>Review Problems and Console, fix the scene, and build again.`, true);
    return null;
  }
}

function renderGraphs() {
  const host = $('#graphCanvas');
  if (!state.project) return;
  state.project.graphs ||= [];
  if (!state.project.graphs.length) {
    host.innerHTML = '<div class="problems-empty">No gameplay event chains yet. Add one to create an executable proximity event.</div>';
    return;
  }
  const names = state.engine.listObjects().map((object) => object.name);
  host.innerHTML = state.project.graphs.map((graph) => {
    const targetOptions = names.map((name) => `<option value="${html(name)}" ${graph.triggerObject === name ? 'selected' : ''}>${html(name)}</option>`).join('');
    const actionTarget = names.map((name) => `<option value="${html(name)}" ${graph.targetObject === name ? 'selected' : ''}>${html(name)}</option>`).join('');
    return `<article class="graph-chain" data-graph-id="${html(graph.id)}"><div class="graph-chain-head"><span><input class="graph-name" data-graph-field="name" value="${html(graph.name)}" aria-label="Event chain name"></span><span><label><input type="checkbox" data-graph-field="enabled" ${graph.enabled ? 'checked' : ''}> On</label> <button data-delete-graph title="Delete event chain">×</button></span></div><div class="graph-node event"><small>EVENT · ENTER</small><b>Player enters radius</b><select data-graph-field="triggerObject" title="Trigger object">${targetOptions || '<option value="">No object</option>'}</select><div class="graph-number"><span>Radius</span><input type="number" data-graph-field="radius" min="0.5" max="50" step="0.5" value="${html(graph.radius)}"><span>m</span></div></div><div class="graph-node condition"><small>CONDITION</small><b>Only when</b><select data-graph-field="condition">${GRAPH_CONDITIONS.map((item) => `<option value="${html(item.value)}" ${item.value === graph.condition ? 'selected' : ''}>${html(item.label)}</option>`).join('')}</select></div><div class="graph-node action"><small>ACTION</small><select data-graph-field="action">${GRAPH_ACTIONS.map((item) => `<option value="${html(item.value)}" ${item.value === graph.action ? 'selected' : ''}>${html(item.label)}</option>`).join('')}</select>${['open_door','toggle_object'].includes(graph.action) ? `<select data-graph-field="targetObject">${actionTarget || '<option value="">No object</option>'}</select>` : ''}${graph.action === 'message' ? `<input class="graph-message-input" data-graph-field="message" value="${html(graph.message || '')}" placeholder="Message displayed in Play Mode">` : ''}${graph.action === 'heal_player' ? `<div class="graph-number"><span>Heal</span><input type="number" data-graph-field="healAmount" min="1" max="100" value="${html(graph.healAmount || 25)}"><span>HP</span></div>` : ''}</div></article>`;
  }).join('');
}

function showContextMenu(items, x, y, object = null) {
  state.contextObject = object;
  const menu = $('#contextMenu');
  menu.innerHTML = items.map((item) => item.separator ? '<hr>' : `<button class="${item.danger ? 'danger' : ''}" data-context-action="${html(item.action)}">${html(item.label)}<small>${html(item.shortcut || '')}</small></button>`).join('');
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - rect.height - 8)}px`;
}

function hideContextMenu() { $('#contextMenu').hidden = true; state.contextObject = null; }

function showCommandPalette() {
  const definitions = [
    ['Save Project', 'Ctrl+S', saveProjectNow], ['New Project…', '', buildProjectWizard], ['Build Portable HTML Game…', '', () => openBuildModal('release')],
    ['Play / Pause', 'Ctrl+P', () => state.engine.mode === 'edit' ? state.engine.startPlay() : state.engine.togglePause()], ['Stop Play Mode', '', () => state.engine.stopPlay()],
    ['Restart Play Mode', '', restartGame], ['Create Cube', '', () => createObject('Cube')], ['Create Player', '', () => createObject('Player')],
    ['Create Enemy', '', () => createObject('Enemy')], ['Import Model…', '', () => $('#assetInput').click()], ['New Scene…', '', () => { const name = prompt('Scene name', 'New Scene'); if (name) createScene(name); }],
    ['Open Scene…', '', openScenesModal], ['Take Snapshot…', '', createSnapshot], ['Project Snapshots…', '', showHistoryModal], ['Undo', 'Ctrl+Z', undo], ['Redo', 'Ctrl+Shift+Z', redo],
    ['Focus Selected', 'F', () => state.engine.focusSelected()], ['Toggle Grid', '', toggleGrid], ['Open AI Agent', '', () => selectBottomTab('agent')], ['Open Gameplay Graph', '', () => selectBottomTab('graph')],
  ];
  state.commandEntries = definitions.map(([label, shortcut, run]) => ({ label, shortcut, run }));
  $('#commandInput').value = '';
  renderCommands();
  $('#commandOverlay').hidden = false;
  $('#commandInput').focus();
}

function renderCommands() {
  const query = $('#commandInput').value.trim().toLowerCase();
  const entries = state.commandEntries.filter((entry) => entry.label.toLowerCase().includes(query));
  if (!entries.length) { $('#commandResults').innerHTML = '<div class="problems-empty">No commands found.</div>'; return; }
  state.commandIndex = Math.min(state.commandIndex, entries.length - 1);
  $('#commandResults').innerHTML = entries.map((entry, index) => `<button class="command-result ${index === state.commandIndex ? 'active' : ''}" data-command-index="${index}"><span>${html(entry.label)}</span><small>${html(entry.shortcut)}</small></button>`).join('');
}

function runCommand(index = state.commandIndex) {
  const query = $('#commandInput').value.trim().toLowerCase();
  const entries = state.commandEntries.filter((entry) => entry.label.toLowerCase().includes(query));
  const entry = entries[index];
  if (!entry) return;
  $('#commandOverlay').hidden = true;
  entry.run();
}

function toggleGrid() {
  state.engine.setGridVisible(!state.engine.showGrid);
  $('#gridButton').classList.toggle('active', state.engine.showGrid);
}

function restartGame() {
  if (state.engine.mode === 'play') state.engine.stopPlay();
  state.engine.startPlay();
}

function showMenu(name, trigger) {
  const menu = $('#menuPopover');
  const open = menu.hidden ? null : menu.dataset.menu;
  if (open === name) { menu.hidden = true; return; }
  menu.dataset.menu = name;
  const common = {
    file: [['New Project…','', 'newProject'],['Open Project File…','', 'openProject'],['Save Project','Ctrl+S','save'],['Export Project File…','','exportProject'],['separator'],['Create Snapshot…','','snapshot'],['Project Snapshots…','','history']],
    edit: [['Undo','Ctrl+Z','undo'],['Redo','Ctrl+Shift+Z','redo'],['separator'],['Duplicate Selected','Ctrl+D','duplicate'],['Delete Selected','Delete','delete']],
    project: [['New Scene…','','newScene'],['Open Scene…','','openScene'],['separator'],['Import Model…','','importAsset'],['Run Project Validation','','validate']],
    build: [['Build Portable HTML Game…','','build'],['Development Build…','','buildDev'],['separator'],['Open Output Panel','','output']],
    play: [[state.engine.mode === 'edit' ? 'Play' : state.engine.mode === 'paused' ? 'Resume' : 'Pause','Ctrl+P','play'],['Stop and Restore Editor Scene','','stop'],['Restart Play Mode','','restart']],
    ai: [['Open AI Agent Panel','','agent'],['Ask AI to Create a Player','','aiPlayer'],['Ask AI to Add an Enemy','','aiEnemy'],['Ask AI to Validate Project','','aiValidate'],['separator'],['AI tool capabilities','','aiTools']],
    workspace: [['New Project…','','newProject'],['Open Project File…','','openProject'],['Export Project File…','','exportProject'],['Project Snapshots…','','history'],['Keyboard Shortcuts','','shortcuts']],
  }[name] || [];
  menu.innerHTML = common.map((item) => item[0] === 'separator' ? '<div class="menu-separator"></div>' : `<button class="menu-item" data-menu-action="${html(item[2])}"><span>${html(item[0])}</span><small>${html(item[1])}</small></button>`).join('');
  menu.hidden = false;
  const anchor = trigger?.getBoundingClientRect?.();
  menu.style.left = `${Math.min(Math.max(8, anchor?.left || 150), innerWidth - 220)}px`;
  menu.style.top = '42px';
}

function handleMenuAction(action) {
  $('#menuPopover').hidden = true;
  switch (action) {
    case 'newProject': return buildProjectWizard();
    case 'openProject': return $('#projectInput').click();
    case 'save': return saveProjectNow(true);
    case 'exportProject': return exportProjectFile();
    case 'snapshot': return createSnapshot();
    case 'history': return showHistoryModal();
    case 'undo': return undo();
    case 'redo': return redo();
    case 'duplicate': return duplicateSelected();
    case 'delete': return deleteSelected();
    case 'newScene': { const name = prompt('Scene name', 'New Scene'); if (name) createScene(name); return; }
    case 'openScene': return openScenesModal();
    case 'importAsset': return $('#assetInput').click();
    case 'validate': return validateAndShow();
    case 'build': return openBuildModal('release');
    case 'buildDev': return openBuildModal('development');
    case 'output': return selectBottomTab('output');
    case 'play': return state.engine.mode === 'edit' ? state.engine.startPlay() : state.engine.togglePause();
    case 'stop': return state.engine.stopPlay();
    case 'restart': return restartGame();
    case 'agent': return selectBottomTab('agent');
    case 'aiPlayer': selectBottomTab('agent'); return planAgentPrompt('Create a third-person player with health, stamina, and a follow camera');
    case 'aiEnemy': selectBottomTab('agent'); return planAgentPrompt('Add a zombie enemy that chases the player');
    case 'aiValidate': selectBottomTab('agent'); return planAgentPrompt('Validate the current project and inspect errors');
    case 'aiTools': return showToolsModal();
    case 'shortcuts': return showShortcutsModal();
  }
}

function showToolsModal() {
  $('#modal').classList.add('wide');
  $('#modal').innerHTML = `<div class="modal-head"><div><h2>Local Agent Tool Registry</h2><p>These structured calls are implemented in the current build. The planner is deterministic and does not call a cloud model.</p></div><button class="modal-close" data-close-modal>×</button></div><div class="modal-body"><div class="agent-tool-list">${TOOL_DEFINITIONS.map((tool) => `<div><code>${html(tool.name)}()</code><span>${html(tool.description)}</span>${tool.destructive ? '<b>REVIEW</b>' : ''}</div>`).join('')}</div><div class="modal-callout"><span>i</span><span>JavaScript script assets can be stored and edited but are not executed. FBX, arbitrary code execution, spawn scheduling and Windows .exe packaging are not implemented.</span></div></div><div class="modal-footer"><button class="btn btn-bright" data-close-modal>Done</button></div>`;
  $('#modalScrim').hidden = false;
  $('#modal').onclick = (event) => { if (event.target.closest('[data-close-modal]')) closeModal(); };
}

function showShortcutsModal() {
  $('#modal').classList.remove('wide');
  const shortcuts = [['Ctrl / ⌘ + S','Save project'],['Ctrl / ⌘ + P','Play / pause'],['Ctrl / ⌘ + K','Command palette'],['Ctrl / ⌘ + Z','Undo scene edit'],['Ctrl / ⌘ + Shift + Z','Redo scene edit'],['Q / W / E / R','Select / move / rotate / scale tool'],['F','Frame selected object'],['Delete','Delete selected object'],['Right mouse drag','Orbit view'],['Middle mouse drag','Pan view'],['Mouse wheel','Zoom view'],['E / F / C in Play','Gather / attack / craft']];
  $('#modal').innerHTML = `<div class="modal-head"><div><h2>Keyboard Shortcuts</h2><p>Editor viewport and Play Mode.</p></div><button class="modal-close" data-close-modal>×</button></div><div class="modal-body"><div class="shortcut-list">${shortcuts.map(([key, action]) => `<div><kbd>${html(key)}</kbd><span>${html(action)}</span></div>`).join('')}</div></div><div class="modal-footer"><button class="btn btn-bright" data-close-modal>Done</button></div>`;
  $('#modalScrim').hidden = false;
  $('#modal').onclick = (event) => { if (event.target.closest('[data-close-modal]')) closeModal(); };
}

function createObject(type, options = {}) {
  if (state.engine.mode === 'play') { showToast('Stop Play Mode to edit the scene.'); return null; }
  recordUndo(`Create ${type}`);
  try {
    const object = state.engine.createObject(type, options);
    logConsole('SUCCESS', `Created ${object.name} (${type}).`);
    return object;
  } catch (error) { logConsole('ERROR', error.message); showToast(error.message); return null; }
}

function duplicateSelected() {
  const object = state.engine.selected;
  if (!object) { showToast('Select an object to duplicate.'); return; }
  recordUndo('Duplicate object'); state.engine.duplicateObject(object); logConsole('INFO', `Duplicated ${object.name}.`);
}

function deleteSelected() {
  const object = state.engine.selected;
  if (!object) { showToast('Select an object to delete.'); return; }
  if (!confirm(`Delete “${object.name}” from the active scene?`)) return;
  recordUndo('Delete object'); state.engine.deleteObject(object); logConsole('WARNING', `Deleted ${object.name}.`);
}

function validateAndShow() {
  const problems = validateProject(state.project, state.engine);
  setProblems(problems); selectBottomTab('problems');
  logConsole(problems.some((problem) => problem.severity === 'error') ? 'ERROR' : 'SUCCESS', problems.length ? `Validation found ${problems.length} problem(s).` : 'Project validation passed.');
  if (!problems.length) showToast('Project validation passed.');
}

function assetPosition(type, x, z) {
  const y = ['Tree','Palm','Rock','Cabin','Wood Pickup','Stone Pickup','Berry Pickup','Player','Enemy','Point Light','Directional Light','Camera'].includes(type) ? 0.22 : type === 'Cube' || type === 'Sphere' || type === 'Cylinder' || type === 'Capsule' ? 0.65 : 0.02;
  return [x, y, z];
}

function addAssetAt(type, clientX, clientY) {
  if (type === 'Material Asset') { showCreateMaterialModal(); return; }
  const point = state.engine.worldPointAt(clientX, clientY, 0.22) || new THREE.Vector3(0, 0.22, 0);
  createObject(type, { position: assetPosition(type, point.x, point.z) });
}

async function importFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  try {
    const models = await importAssetFiles(files);
    for (const { file, object } of models) {
      const name = file.name.replace(/\.(glb|gltf|obj)$/i, '');
      recordUndo('Import model');
      state.engine.createImportedModel(object, name);
      const format = file.name.split('.').pop().toUpperCase();
      state.project.assets.push({ id: `asset-${Date.now()}-${Math.random().toString(16).slice(2)}`, name, format, size: file.size, objectName: name, importedAt: new Date().toISOString(), note: format === 'OBJ' ? 'Geometry import; MTL files are not applied.' : 'Mesh geometry and PBR material factors imported; animation clips are not retargeted.' });
      logConsole('SUCCESS', `Imported ${file.name} (${format} geometry).`);
    }
    renderAssets(); markDirty('Model imported'); await saveProjectNow(false);
  } catch (error) {
    logConsole('ERROR', `Asset import failed: ${error.message}`); showToast(error.message, 5000);
  } finally { $('#assetInput').value = ''; }
}

function exportStoredScript(script) {
  downloadBlob(script.name.endsWith('.js') ? script.name : `${script.name}.js`, new Blob([script.code], { type: 'text/javascript' }));
}

function showScriptModal(script) {
  $('#modal').classList.add('wide');
  $('#modal').innerHTML = `<div class="modal-head"><div><h2>${html(script.name)}</h2><p>Stored source asset · not executed by the Play Mode runtime in this build.</p></div><button class="modal-close" data-close-modal>×</button></div><div class="modal-body"><textarea class="script-editor" id="scriptSource">${html(script.code || '')}</textarea><div class="modal-callout"><span>i</span><span>Editing this file changes the stored project asset only. Use built-in components and Gameplay Graph nodes for executable gameplay.</span></div></div><div class="modal-footer"><button class="btn" data-close-modal>Close</button><button class="btn" id="downloadScriptButton">Download .js</button><button class="btn btn-bright" id="saveScriptButton">Save Source</button></div>`;
  $('#modalScrim').hidden = false;
  $('#modal').onclick = (event) => {
    if (event.target.closest('[data-close-modal]')) closeModal();
    if (event.target.closest('#downloadScriptButton')) exportStoredScript(script);
    if (event.target.closest('#saveScriptButton')) { script.code = $('#scriptSource').value; script.updatedAt = new Date().toISOString(); markDirty('Script asset edited'); closeModal(); logConsole('SUCCESS', `Saved source asset ${script.name} (not executed).`); }
  };
}

function handleProjectAsset(type, id) {
  const asset = [...(state.project.assets || []), ...(state.project.materials || []), ...(state.project.prefabs || []), ...(state.project.scripts || [])].find((item) => item.id === id);
  if (!asset) return;
  if (type === 'material') {
    if (!state.engine.selected) { showToast('Select a mesh in the scene, then choose the material again.'); return; }
    recordUndo('Assign material'); state.engine.assignMaterial(state.engine.selected, asset); markDirty('Material assigned'); renderInspector(state.engine.selected); return;
  }
  if (type === 'prefab') {
    recordUndo('Instantiate prefab'); state.engine.instantiatePrefab(asset.object, asset.name); return;
  }
  if (type === 'script') { showScriptModal(asset); return; }
  if (type === 'imported') {
    const object = state.engine.listObjects().find((item) => item.name === asset.objectName);
    if (object) state.engine.setSelection(object);
    else showToast('The original source file is not stored separately. Re-import the model to instantiate another copy.');
  }
}

function handleConsoleCommand(command) {
  const [verb, ...rest] = command.trim().split(/\s+/);
  const args = rest.join(' ');
  if (!verb) return;
  switch (verb.toLowerCase()) {
    case 'help': logConsole('INFO', 'Commands: help, scene, objects, validate, play, stop, build, add <Cube|Tree|Player|Enemy>, select <name>, clear.'); break;
    case 'clear': $('#consoleList').innerHTML = ''; state.consoleEntries = []; $('#consoleBadge').textContent = '0'; break;
    case 'scene': logConsole('INFO', `${state.project.name} · scene ${state.engine.scene.name} · ${state.engine.listObjects().length} objects.`); break;
    case 'objects': logConsole('INFO', state.engine.getSceneSummary().map((object) => `${object.name} (${object.kind})`).join(', ') || 'Scene empty.'); break;
    case 'validate': case 'test': validateAndShow(); break;
    case 'play': state.engine.startPlay(); break;
    case 'stop': state.engine.stopPlay(); break;
    case 'build': openBuildModal('release'); break;
    case 'add': {
      const map = { cube: 'Cube', sphere: 'Sphere', tree: 'Tree', palm: 'Palm', rock: 'Rock', player: 'Player', enemy: 'Enemy', cabin: 'Cabin' };
      const type = map[args.toLowerCase()];
      if (type) createObject(type); else logConsole('WARNING', `Unsupported object “${args}”. Try cube, tree, player or enemy.`);
      break;
    }
    case 'select': {
      const object = state.engine.listObjects().find((item) => item.name.toLowerCase() === args.toLowerCase());
      if (object) state.engine.setSelection(object); else logConsole('WARNING', `No object named “${args}”.`);
      break;
    }
    default: logConsole('WARNING', `Unknown command “${verb}”. Type help for available commands.`);
  }
}

function setupResizeHandles() {
  $$('.resize-handle').forEach((handle) => {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const type = handle.dataset.resize;
      handle.classList.add('dragging');
      const startX = event.clientX, startY = event.clientY;
      const left = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--left-width')) || 258;
      const right = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--right-width')) || 300;
      const bottom = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--bottom-height')) || 232;
      handle.setPointerCapture?.(event.pointerId);
      const move = (pointer) => {
        if (type === 'left') document.documentElement.style.setProperty('--left-width', `${Math.max(180, Math.min(430, left + pointer.clientX - startX))}px`);
        if (type === 'right') document.documentElement.style.setProperty('--right-width', `${Math.max(220, Math.min(450, right - pointer.clientX + startX))}px`);
        if (type === 'bottom') document.documentElement.style.setProperty('--bottom-height', `${Math.max(130, Math.min(innerHeight * 0.56, bottom - pointer.clientY + startY))}px`);
        state.engine.resize();
      };
      const up = () => { handle.classList.remove('dragging'); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up, { once: true });
    });
  });
}

function wireUI() {
  $('#saveProjectBtn').addEventListener('click', () => saveProjectNow(true));
  $('#playBtn').addEventListener('click', () => state.engine.mode === 'edit' ? state.engine.startPlay() : state.engine.togglePause());
  $('#stopBtn').addEventListener('click', () => state.engine.stopPlay());
  $('#newProjectButton').addEventListener('click', buildProjectWizard);
  $('#buildButton').addEventListener('click', () => openBuildModal('release'));
  $('#buildFromOutput').addEventListener('click', () => openBuildModal('release'));
  $('#commandButton').addEventListener('click', showCommandPalette);
  $('#workspaceMenuBtn').addEventListener('click', (event) => showMenu('workspace', event.currentTarget));
  $$('.menu-trigger').forEach((button) => button.addEventListener('click', (event) => showMenu(button.dataset.menu, event.currentTarget)));
  $('#menuPopover').addEventListener('click', (event) => {
    const item = event.target.closest('[data-menu-action]'); if (item) handleMenuAction(item.dataset.menuAction);
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.topbar') && !event.target.closest('#projectOptionsBtn')) $('#menuPopover').hidden = true;
    if (!event.target.closest('#contextMenu') && !event.target.closest('#addObjectButton') && !event.target.closest('#hierarchyAddButton') && !event.target.closest('#inspectorMoreBtn')) hideContextMenu();
  });
  $('#projectOptionsBtn').addEventListener('click', (event) => showMenu('workspace', event.currentTarget));
  $('#inspectorMoreBtn').addEventListener('click', (event) => showContextMenu([{ label: 'Copy object name', action: 'copyName' }, { label: 'Frame selected', action: 'frame' }, { separator: true }, { label: 'Add Component', action: 'addComponent' }], event.clientX, event.clientY, state.engine.selected));
  $('#projectFolderBtn').addEventListener('click', exportProjectFile);
  $('#shortcutsButton').addEventListener('click', showShortcutsModal);
  $('#hierarchySearch').addEventListener('input', renderHierarchy);
  $('#assetSearch').addEventListener('input', renderAssets);
  $$('.left-tabs .tab').forEach((button) => button.addEventListener('click', () => switchLeftTab(button.dataset.leftTab)));
  $$('.bottom-tab').forEach((button) => button.addEventListener('click', () => selectBottomTab(button.dataset.bottomTab)));
  $$('.tool-button[data-tool]').forEach((button) => button.addEventListener('click', () => {
    state.engine.setTool(button.dataset.tool);
    $$('.tool-button[data-tool]').forEach((tool) => tool.classList.toggle('active', tool === button));
    $('#viewportCanvas').focus();
  }));
  $('#gridButton').addEventListener('click', toggleGrid);
  $('#focusButton').addEventListener('click', () => state.engine.focusSelected());
  $('#sceneViewButton').addEventListener('click', () => { state.engine.setView('scene'); $('#sceneViewButton').classList.add('active'); $('#gameViewButton').classList.remove('active'); $('#viewportState').textContent = 'EDIT MODE'; });
  $('#gameViewButton').addEventListener('click', () => { state.engine.setView('game'); $('#gameViewButton').classList.add('active'); $('#sceneViewButton').classList.remove('active'); $('#viewportState').textContent = 'GAME VIEW'; });
  $('#maximizeViewportButton').addEventListener('click', () => {
    state.maximized = !state.maximized; $('#viewportPanel').classList.toggle('maximized', state.maximized);
    $('#maximizeViewportButton').classList.toggle('active', state.maximized); setTimeout(() => state.engine.resize(), 50);
  });
  $('#toggleBottomButton').addEventListener('click', () => {
    const collapsed = $('#bottomDock').classList.toggle('collapsed');
    document.documentElement.style.setProperty('--bottom-height', collapsed ? '31px' : '232px');
    $('#toggleBottomButton').textContent = collapsed ? '⌃' : '⌄'; setTimeout(() => state.engine.resize(), 50);
  });
  $('#clearConsoleButton').addEventListener('click', () => { state.consoleEntries = []; $('#consoleList').innerHTML = ''; $('#consoleBadge').textContent = '0'; });
  $('#consoleInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { const text = event.currentTarget.value; event.currentTarget.value = ''; logConsole('INFO', `› ${text}`); handleConsoleCommand(text); }
  });
  $('#addObjectButton').addEventListener('click', (event) => showContextMenu(builtinAssets.filter((asset) => asset.type !== 'Material Asset').slice(0, 15).map((asset) => ({ label: `Create ${asset.label}`, action: `create:${asset.type}` })), event.clientX, event.clientY));
  $('#hierarchyAddButton').addEventListener('click', (event) => showContextMenu(builtinAssets.filter((asset) => asset.type !== 'Material Asset').slice(0, 15).map((asset) => ({ label: `Create ${asset.label}`, action: `create:${asset.type}` })), event.clientX, event.clientY));
  $('#importAssetButton').addEventListener('click', () => $('#assetInput').click());
  $('#assetInput').addEventListener('change', (event) => importFiles(event.target.files));
  $('#projectInput').addEventListener('change', (event) => { const file = event.target.files?.[0]; if (file) importProjectFile(file); event.target.value = ''; });
  $('#agentForm').addEventListener('submit', (event) => { event.preventDefault(); planAgentPrompt($('#agentPrompt').value); });
  $$('.agent-suggestions button').forEach((button) => button.addEventListener('click', () => planAgentPrompt(button.dataset.prompt)));
  $('#agentConversation').addEventListener('click', (event) => {
    const card = event.target.closest('.plan-card');
    const action = event.target.closest('[data-plan-action]')?.dataset.planAction;
    if (action === 'apply') applyAgentPlan(card);
    if (action === 'cancel') { card.remove(); state.activePlan = null; }
  });
  $('#problemList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-problem-ai]'); if (!button) return;
    const problem = state.problems[Number(button.dataset.problemAi)];
    selectBottomTab('agent'); planAgentPrompt(`Inspect and help fix this project validation issue: ${problem.message}`);
  });
  $('#addGraphButton').addEventListener('click', () => {
    const graph = createGraph({ name: `Event Chain ${state.project.graphs.length + 1}`, triggerObject: state.engine.scene.name === 'Island' ? 'Driftwood Cabin' : state.engine.selected?.name || state.engine.rootObjects()[0]?.name || 'Ground' });
    state.project.graphs.push(graph); state.engine.setGraphs(state.project.graphs); renderGraphs(); markDirty('Gameplay graph added');
  });
  $('#graphCanvas').addEventListener('change', (event) => {
    const field = event.target.closest('[data-graph-field]'); if (!field) return;
    const chain = field.closest('[data-graph-id]'); const graph = state.project.graphs.find((item) => item.id === chain.dataset.graphId); if (!graph) return;
    const key = field.dataset.graphField;
    graph[key] = field.type === 'checkbox' ? field.checked : field.type === 'number' ? Number(field.value) : field.value;
    state.engine.setGraphs(state.project.graphs); markDirty('Gameplay graph updated');
    if (key === 'action') renderGraphs();
  });
  $('#graphCanvas').addEventListener('click', (event) => {
    const remove = event.target.closest('[data-delete-graph]'); if (!remove) return;
    const chain = remove.closest('[data-graph-id]'); state.project.graphs = state.project.graphs.filter((item) => item.id !== chain.dataset.graphId);
    state.engine.setGraphs(state.project.graphs); renderGraphs(); markDirty('Gameplay graph removed');
  });
  $('#hierarchyTree').addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-tree-toggle]');
    if (toggle) {
      const uuid = toggle.dataset.treeToggle;
      state.collapsed.has(uuid) ? state.collapsed.delete(uuid) : state.collapsed.add(uuid);
      renderHierarchy(); return;
    }
    const row = event.target.closest('[data-object-uuid]'); if (!row) return;
const object = sceneObjectByUUID(row.dataset.objectUuid);
    if (object) state.engine.setSelection(object);
  });
  $('#hierarchyTree').addEventListener('contextmenu', (event) => {
    const row = event.target.closest('[data-object-uuid]'); if (!row) return;
    event.preventDefault(); const object = sceneObjectByUUID(row.dataset.objectUuid);
    if (object) showObjectContext(object, event.clientX, event.clientY);
  });
  $('#hierarchyTree').addEventListener('dragstart', (event) => {
    const row = event.target.closest('[data-object-uuid]'); if (!row) return;
    event.dataTransfer.setData('application/x-nexus-object', row.dataset.objectUuid);
  });
  $('#hierarchyTree').addEventListener('dragover', (event) => {
    if (event.dataTransfer.types.includes('application/x-nexus-object')) { event.preventDefault(); event.target.closest('.tree-row')?.classList.add('drag-over'); }
  });
  $('#hierarchyTree').addEventListener('drop', (event) => {
    const targetRow = event.target.closest('[data-object-uuid]'); const sourceId = event.dataTransfer.getData('application/x-nexus-object');
    if (!targetRow || !sourceId) return; event.preventDefault();
    const source = sceneObjectByUUID(sourceId), target = sceneObjectByUUID(targetRow.dataset.objectUuid);
    if (source && target && source !== target) { recordUndo('Reparent object'); if (state.engine.setParent(source, target)) { renderHierarchy(); markDirty('Object parent changed'); } else showToast('That parent would create a hierarchy cycle.'); }
  });
  $('#assetGrid').addEventListener('click', (event) => {
    const tile = event.target.closest('[data-type]'); if (!tile) return;
    const type = tile.dataset.type;
    if (type === 'Material Asset') { showCreateMaterialModal(); return; }
    createObject(type);
  });
  $('#assetGrid').addEventListener('dragstart', (event) => {
    const tile = event.target.closest('[data-type]'); if (!tile || tile.dataset.type === 'Material Asset') return;
    event.dataTransfer.setData('application/x-nexus-asset', tile.dataset.type);
    event.dataTransfer.effectAllowed = 'copy';
  });
  $('#projectAssetGrid').addEventListener('click', (event) => {
    const tile = event.target.closest('[data-project-asset-id]'); if (tile) handleProjectAsset(tile.dataset.projectAssetType, tile.dataset.projectAssetId);
  });
  $('#viewportCanvas').addEventListener('dragover', (event) => { event.preventDefault(); $('#viewportCanvas').classList.add('drag-active'); $('#viewportDropHint').classList.add('visible'); });
  $('#viewportCanvas').addEventListener('dragleave', (event) => { if (!$('#viewportCanvas').contains(event.relatedTarget)) { $('#viewportCanvas').classList.remove('drag-active'); $('#viewportDropHint').classList.remove('visible'); } });
  $('#viewportCanvas').addEventListener('drop', (event) => {
    event.preventDefault(); $('#viewportCanvas').classList.remove('drag-active'); $('#viewportDropHint').classList.remove('visible');
    if (event.dataTransfer.files?.length) { importFiles(event.dataTransfer.files); return; }
    const type = event.dataTransfer.getData('application/x-nexus-asset'); if (type) addAssetAt(type, event.clientX, event.clientY);
  });
  $('#viewportCanvas').addEventListener('contextmenu', (event) => {
    event.preventDefault(); const hit = state.engine.pickObject(event.clientX, event.clientY);
    if (hit) showObjectContext(hit, event.clientX, event.clientY);
    else showContextMenu([{ label: 'Create Cube', action: 'create:Cube' }, { label: 'Create Player', action: 'create:Player' }, { label: 'Create Enemy', action: 'create:Enemy' }, { label: 'Import Model…', action: 'importAsset' }], event.clientX, event.clientY);
  });
  $('#contextMenu').addEventListener('click', (event) => {
    const button = event.target.closest('[data-context-action]'); if (!button) return;
    const action = button.dataset.contextAction; const object = state.contextObject;
    hideContextMenu(); handleContextAction(action, object);
  });
  $('#inspectorContent').addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-component]');
    if (remove) { recordUndo(`Remove ${remove.dataset.removeComponent}`); state.engine.removeComponent(state.engine.selected, remove.dataset.removeComponent); markDirty('Component removed'); return; }
    if (event.target.closest('#addComponentInspector')) {
      const picker = $('#componentPicker'); picker.hidden = !picker.hidden; return;
    }
    const add = event.target.closest('[data-add-component]');
    if (add) { recordUndo(`Add ${add.dataset.addComponent}`); state.engine.addComponent(state.engine.selected, add.dataset.addComponent); markDirty('Component added'); }
    const head = event.target.closest('.component-head');
    if (head && !event.target.closest('.component-remove')) { const body = $('.component-body', head.parentElement); body.hidden = !body.hidden; }
  });
  $('#inspectorContent').addEventListener('change', (event) => {
    const input = event.target;
    const object = state.engine.selected; if (!object) return;
    if (input.id === 'inspectorObjectName') { recordUndo('Rename object'); state.engine.renameObject(object, input.value); markDirty('Object renamed'); renderHierarchy(); return; }
    if (input.hasAttribute('data-object-enabled')) { recordUndo('Visibility'); object.visible = input.checked; markDirty('Object visibility changed'); return; }
    if (input.hasAttribute('data-transform')) {
      recordUndo('Transform');
      const group = input.closest('[data-transform-group]'); const values = $$('input', group).map((field) => Number(field.value));
      const key = input.dataset.transform;
      if (key === 'rotation') for (let i = 0; i < values.length; i++) values[i] *= Math.PI / 180;
      state.engine.setTransform(object, key, values); markDirty('Transform updated'); renderHierarchy(); return;
    }
    if (input.dataset.action === 'assign-material') {
      if (!input.value) return;
      const material = state.project.materials.find((item) => item.name === input.value); if (!material) return;
      recordUndo('Assign material'); state.engine.assignMaterial(object, material); markDirty('Material assigned'); renderInspector(object); return;
    }
    if (input.dataset.component && input.dataset.property) {
      const value = input.dataset.valueType === 'number' ? Number(input.value) : input.dataset.valueType === 'boolean' ? input.checked : input.value;
      recordUndo(`Edit ${input.dataset.component}`);
      state.engine.updateComponent(object, input.dataset.component, input.dataset.property, value);
      markDirty(`${input.dataset.component} updated`);
      if (input.dataset.component === 'MeshRenderer') renderHierarchy();
    }
  });
  $('#inspectorContent').addEventListener('input', (event) => {
    const input = event.target;
    if (input.dataset.component === 'MeshRenderer' && input.dataset.property === 'baseColor') {
      if (state.engine.selected) state.engine.updateComponent(state.engine.selected, 'MeshRenderer', 'baseColor', input.value);
    }
  });
  $('#modalScrim').addEventListener('click', (event) => { if (event.target === $('#modalScrim')) closeModal(); });
  $('#commandOverlay').addEventListener('click', (event) => { if (event.target === $('#commandOverlay')) $('#commandOverlay').hidden = true; const row = event.target.closest('[data-command-index]'); if (row) runCommand(Number(row.dataset.commandIndex)); });
  $('#commandInput').addEventListener('input', () => { state.commandIndex = 0; renderCommands(); });
  $('#commandInput').addEventListener('keydown', (event) => {
    const entries = state.commandEntries.filter((entry) => entry.label.toLowerCase().includes($('#commandInput').value.trim().toLowerCase()));
    if (event.key === 'ArrowDown') { event.preventDefault(); state.commandIndex = (state.commandIndex + 1) % Math.max(entries.length, 1); renderCommands(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); state.commandIndex = (state.commandIndex - 1 + Math.max(entries.length, 1)) % Math.max(entries.length, 1); renderCommands(); }
    if (event.key === 'Enter') { event.preventDefault(); runCommand(); }
    if (event.key === 'Escape') $('#commandOverlay').hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    const inputting = event.target?.matches?.('input,textarea,select,[contenteditable="true"]');
    if (event.key === 'Escape') { if (!$('#commandOverlay').hidden) $('#commandOverlay').hidden = true; if (!$('#modalScrim').hidden) closeModal(); hideContextMenu(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProjectNow(true); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); showCommandPalette(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') { event.preventDefault(); state.engine.mode === 'edit' ? state.engine.startPlay() : state.engine.togglePause(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    if (inputting || state.engine.mode === 'play') return;
    if (event.key === 'Delete' || event.key === 'Backspace') { if (state.engine.selected) { event.preventDefault(); deleteSelected(); } return; }
    if (event.key.toLowerCase() === 'f') state.engine.focusSelected();
    if (event.key.toLowerCase() === 'q') selectTool('select');
    if (event.key.toLowerCase() === 'w') selectTool('move');
    if (event.key.toLowerCase() === 'e') selectTool('rotate');
    if (event.key.toLowerCase() === 'r') selectTool('scale');
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); }
  });
  setupResizeHandles();
}

function selectTool(name) {
  state.engine.setTool(name);
  $$('.tool-button[data-tool]').forEach((button) => button.classList.toggle('active', button.dataset.tool === name));
}

function showObjectContext(object, x, y) {
  state.engine.setSelection(object);
  showContextMenu([
    { label: 'Frame Selected', action: 'frame', shortcut: 'F' },
    { label: 'Duplicate', action: 'duplicate', shortcut: 'Ctrl+D' },
    { label: 'Create Child Cube', action: 'createChild' },
    { label: 'Copy Object Name', action: 'copyName' },
    { separator: true },
    { label: 'Delete', action: 'delete', danger: true, shortcut: 'Del' },
  ], x, y, object);
}

function handleContextAction(action, object) {
  if (action.startsWith('create:')) { createObject(action.slice(7)); return; }
  switch (action) {
    case 'frame': state.engine.setSelection(object || state.engine.selected); state.engine.focusSelected(); break;
    case 'duplicate': if (object) { recordUndo('Duplicate object'); state.engine.duplicateObject(object); } break;
    case 'delete': if (object && confirm(`Delete “${object.name}” from the active scene?`)) { recordUndo('Delete object'); state.engine.deleteObject(object); markDirty('Object deleted'); } break;
    case 'createChild': if (object) { recordUndo('Create child'); state.engine.createObject('Cube', { name: `${object.name} Child`, parent: object, position: [0, 0.7, 0] }); } break;
    case 'copyName': if (object) navigator.clipboard?.writeText(object.name).then(() => showToast('Object name copied.')).catch(() => showToast(object.name)); break;
    case 'importAsset': $('#assetInput').click(); break;
    case 'addComponent': if (object) { const choice = prompt(`Component type: ${Object.keys(COMPONENT_TYPES).join(', ')}`, 'Health'); if (choice && COMPONENT_TYPES[choice]) { recordUndo(`Add ${choice}`); state.engine.addComponent(object, choice); } } break;
  }
}

function showContextMenuFromInspector() {}

function inspectorCommand(action, x, y) { showContextMenu([{ label: 'Frame Selected', action: 'frame' }, { label: 'Duplicate', action: 'duplicate' }, { label: 'Delete', action: 'delete', danger: true }], x, y, state.engine.selected); }

function setupGlobalEvents() {
  window.addEventListener('beforeunload', (event) => {
    if (state.dirty && state.engine?.mode !== 'play') { syncCurrentScene(); event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('resize', () => state.engine?.resize());
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((error) => logConsole('WARNING', `Offline cache unavailable: ${error.message}`)));
  }
}

async function boot() {
  try {
    state.engine = createEngine();
  } catch (error) {
    $('#rendererStatus').textContent = 'WebGL unavailable';
    $('#viewportCanvas').innerHTML = `<div class="inspector-empty"><div class="empty-orbit">!</div><b>WebGL could not start</b><span>${html(error.message)}<br><br>Try an up-to-date browser with hardware acceleration enabled.</span></div>`;
    return;
  }
  wireUI(); setupGlobalEvents();
  state.suppressDirty = true;
  let project = await loadProject();
  if (!project) project = createProject({ name: 'Island Survival', template: 'Island Survival', quality: 'High', target: 'Web' });
  await initializeProject(project);
  state.suppressDirty = false;
  logConsole('SUCCESS', `NEXUS Game Studio ready · ${state.engine.listObjects().length} scene objects · Three.js r170.`);
  logConsole('INFO', 'This is a browser-based editor. Native Windows EXE packaging, FBX and arbitrary script execution are not included.');
  logConsole('INFO', 'Sample game: press Play, use WASD / Space / Shift, E to gather, F to attack, C to craft.');
  $('#rendererStatus').textContent = 'WebGL renderer ready · Three.js r170';
  $('#viewportHint').textContent = 'Perspective · Lit';
}

boot();
