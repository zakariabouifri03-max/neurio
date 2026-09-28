// tools/shadercheck.mjs — compile every hand-written GLSL program with a REAL Khronos
// glslangValidator, transformed exactly the way three r170 transforms it in a browser:
// non-raw materials are compiled as `#version 300 es` with the compatibility defines
// (`varying` → in/out, `texture2D` → texture, `gl_FragColor` → pc_fragColor, …).
//
// This is the only way to catch a shader that silently fails to compile in the browser
// (three logs to console and *skips the draw call*, so the mesh just disappears).
//
//   node tools/shadercheck.mjs
//
// The validator is not vendored (it is a ~5 MB third-party binary). Get one with:
//   npm i --no-save glslang-validator-prebuilt-predownloaded && \
//   mkdir -p ~/.cache/glslang && cp node_modules/glslang-validator-prebuilt-predownloaded/bin/glslangValidator.linux ~/.cache/glslang/glslangValidator
// or point GLSLANG=/path/to/glslangValidator at an existing binary.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';

const ROOT = new URL('../src/', import.meta.url);

/* ----------------------------------------------------------- find the validator */
function findValidator() {
  const cands = [
    process.env.GLSLANG,
    new URL('../tools/bin/glslangValidator', import.meta.url).pathname,
    path.join(os.homedir(), '.cache/glslang/glslangValidator'),
    new URL('../node_modules/.bin/glslangValidator', import.meta.url).pathname,
    '/usr/bin/glslangValidator',
    '/usr/local/bin/glslangValidator',
  ].filter(Boolean);
  for (const c of cands) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return null;
}
const GLSLANG = findValidator();
if (!GLSLANG) {
  console.log('[shader] no glslangValidator found — skipping (see the header of this file to install one)');
  process.exit(0);
}
console.log('[shader] validator:', GLSLANG, execFileSync(GLSLANG, ['--version'], { encoding: 'utf8' }).split('\n')[0]);

/* --------------------------------------------------- three's shader assembly bits */
function resolveIncludes(src) {
  let out = src;
  for (let pass = 0; pass < 12; pass++) {
    const next = out.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (m, name) => {
      const c = THREE.ShaderChunk[name];
      return c === undefined ? m : resolveIncludes(c);
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

const VERT_PREFIX = [
  '#define attribute in',
  '#define varying out',
  '#define texture2D texture',
  'uniform mat4 modelMatrix;',
  'uniform mat4 modelViewMatrix;',
  'uniform mat4 projectionMatrix;',
  'uniform mat4 viewMatrix;',
  'uniform mat3 normalMatrix;',
  'uniform vec3 cameraPosition;',
  'uniform bool isOrthographic;',
  'attribute vec3 position;',
  'attribute vec3 normal;',
  'attribute vec2 uv;',
  'attribute vec3 color;',
].join('\n');

const FRAG_PREFIX = [
  '#define varying in',
  'layout(location = 0) out highp vec4 pc_fragColor;',
  '#define gl_FragColor pc_fragColor',
  '#define gl_FragDepthEXT gl_FragDepth',
  '#define texture2D texture',
  '#define textureCube texture',
  '#define texture2DProj textureProj',
  '#define texture2DLodEXT textureLod',
  '#define textureCubeLodEXT textureLod',
  '#define texture2DGradEXT textureGrad',
  '#define textureCubeGradEXT textureGrad',
  'precision highp float;',
  'precision highp int;',
  // three generates this from the renderer's outputColorSpace (getTexelEncodingFunction);
  // <colorspace_fragment> and <tonemapping_fragment> call it, so mirror it here
  'vec4 linearToOutputTexel( vec4 value ) { return value; }',
  'vec3 LinearToneMapping( vec3 c ) { return c; }',
  'vec3 ACESFilmicToneMapping( vec3 c ) { return c; }',
  'vec3 toneMapping( vec3 c ) { return c; }',
  '#define TONE_MAPPING',
].join('\n');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tsunami-shaders-'));
let fails = 0, checked = 0;

// glslang's ESSL 3.20 profile reserves the word `average`, which three's own <common> chunk
// declares (`float average(vec3)`); browsers compile as ESSL 3.00 where it is legal. The two
// diagnostics below are that quirk only — everything else is a real failure.
const BENIGN = [/ERROR: \d+:\d+: 'average' : function name is redeclaration/,
                /ERROR: \d+:\d+: 'average' : can't find function/,
                /ERROR: \d+:\d+: '' : compilation terminated/,
                /ERROR: \d+ compilation errors\.  No code generated\./,
                /^\s*$/];

function compile(label, kind, body, prefix) {
  const file = path.join(tmp, `${label.replace(/[^\w.-]/g, '_')}.${kind}`);
  fs.writeFileSync(file, `#version 300 es\n${prefix}\n${resolveIncludes(body)}\n`);
  let out = '';
  try { out = execFileSync(GLSLANG, [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const all = out.split('\n').filter((l) => /ERROR/.test(l));
  const errors = all.filter((l) => !BENIGN.some((re) => re.test(l)));
  checked++;
  const good = errors.length === 0;
  if (!good) fails++;
  console.log(`${good ? '✓' : '✗ FAIL'} ${label}.${kind}`, good ? '' : '\n     ' + errors.slice(0, 8).join('\n     '));
}

function checkMaterial(label, mat) {
  if (!mat) { console.log('✗ FAIL missing material', label); fails++; return; }
  compile(label, 'vert', mat.vertexShader, VERT_PREFIX);
  compile(label, 'frag', mat.fragmentShader, FRAG_PREFIX);
}

/* --------------------------------------------------------------- fake DOM (headless) */
globalThis.window = { innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1, addEventListener() { }, matchMedia: () => ({ matches: false }), location: { href: '' } };
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', maxTouchPoints: 0, hardwareConcurrency: 8 }, configurable: true });
class FakeCtx {
  constructor(w, h) { this.w = w; this.h = h; this.canvas = { width: w, height: h }; }
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  getImageData(x, y, w, h) { return this.createImageData(w, h); }
  putImageData() { } fillRect() { } clearRect() { } beginPath() { } closePath() { }
  moveTo() { } lineTo() { } quadraticCurveTo() { } bezierCurveTo() { } arc() { } arcTo() { } ellipse() { }
  fill() { } stroke() { } strokeRect() { } clip() { } rect() { } roundRect() { } drawImage() { }
  createRadialGradient() { return { addColorStop() { } }; } createLinearGradient() { return { addColorStop() { } }; }
  fillText() { } strokeText() { } save() { } restore() { } translate() { } scale() { } rotate() { }
  setTransform() { } resetTransform() { } measureText() { return { width: 10 }; } createPattern() { return null; }
}
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') return { style: {}, appendChild() { }, addEventListener() { }, classList: { add() { }, remove() { }, contains: () => false }, dataset: {} };
    const c = { width: 1, height: 1, style: {}, getContext: () => new FakeCtx(c.width, c.height), addEventListener() { } };
    return c;
  },
  getElementById: () => null, body: { appendChild() { }, addEventListener() { } }, addEventListener() { },
};

const { World } = await import(new URL('world.js', ROOT));
const { Ocean } = await import(new URL('ocean.js', ROOT));
const { Sky } = await import(new URL('sky.js', ROOT));
const { FX } = await import(new URL('particles.js', ROOT));
const { Post } = await import(new URL('post.js', ROOT));
const { createMaterials } = await import(new URL('materials.js', ROOT));

const quality = 'ultra';
const scene = new THREE.Scene();
const world = new World(scene, quality);
world.buildHeightField();
const { mats } = createMaterials(quality);
world.buildTerrainMesh(mats);              // installs the splatting patch on the terrain material
const ocean = new Ocean(scene, world, quality, null);
const sky = new Sky(scene, quality);
sky.bakeClouds();
const fx = new FX(scene, quality, null);
const post = new Post({ getPixelRatio: () => 1, getSize: (v) => v.set(1600, 900), capabilities: { isWebGL2: true } }, quality);

console.log('\n== custom ShaderMaterials ==');
checkMaterial('water', ocean.mat);
checkMaterial('crest', ocean.crest.material);
checkMaterial('sky', sky.mesh.material);
checkMaterial('fx_spray', fx.spray && fx.spray.mat);
checkMaterial('fx_fire', fx.fire && fx.fire.mat);
checkMaterial('fx_dust', fx.dust && fx.dust.mat);
checkMaterial('fx_smoke', fx.smokePool && fx.smokePool.mat);
checkMaterial('fx_rain', fx.rainMat);
checkMaterial('post_bright', post.brightMat);
checkMaterial('post_blur', post.blurMat);
checkMaterial('post_rays', post.raysMat);
checkMaterial('post_composite', post.compMat);

/* ------------------------------------------ the patched three material (terrain splat) */
console.log('\n== patched MeshStandardMaterial (terrain) ==');
const DEFINES = [
  '#define STANDARD', '#define USE_UV', '#define USE_SHADOWMAP', '#define USE_FOG', '#define FOG_EXP2',
  '#define USE_MAP', '#define USE_COLOR', '#define NUM_DIR_LIGHTS 1', '#define NUM_POINT_LIGHTS 0',
  '#define NUM_SPOT_LIGHTS 0', '#define NUM_HEMI_LIGHTS 1', '#define MAX_DIR_LIGHTS 1',
  '#define MAX_POINT_LIGHTS 0', '#define MAX_SPOT_LIGHTS 0', '#define MAX_HEMI_LIGHTS 1',
  ].join('\n');
const VS_EXTRA = [
  'uniform vec3 directionalLightColor[1];', 'uniform vec3 ambientLightColor;',
  'uniform vec3 lightProbe[9];', 'uniform vec3 diffuse;',
].join('\n');
const FS_EXTRA = [
  'uniform vec3 directionalLightColor[1];', 'uniform vec3 directionalLightDirection[1];',
  'uniform vec3 ambientLightColor;', 'uniform vec3 lightProbe[9];',
].join('\n');
const terrainMat = world.terrainMaterial;
if (terrainMat && terrainMat.onBeforeCompile) {
  const shaderObj = {
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  terrainMat.onBeforeCompile(shaderObj, { getRenderTarget: () => null, capabilities: { isWebGL2: true }, extensions: { has: () => true } });
  compile('terrain', 'vert', shaderObj.vertexShader, VERT_PREFIX + '\n' + VS_EXTRA, DEFINES);
  compile('terrain', 'frag', shaderObj.fragmentShader, FRAG_PREFIX + '\n' + FS_EXTRA, DEFINES);
} else {
  console.log('· terrain material has no patch — skipped');
}

console.log(`\n[shader] ${checked - fails}/${checked} programs compile clean`);
console.log(fails ? `${fails} SHADER FAILURE(S)` : 'ALL SHADERS COMPILE');
process.exit(fails ? 1 : 0);
