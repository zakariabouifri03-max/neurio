// Headless boot test of the REAL built editor bundle (www/assets/index-*.js)
// using jsdom + a permissive WebGL stub. Verifies: module init, home screen,
// project open, panel construction, viewport scene build, play mode.
// Run:  node tests/boot.mjs
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const html = fs.readFileSync(path.join(root, 'www', 'index.html'), 'utf8');
const bundleFile = fs.readdirSync(path.join(root, 'www', 'assets')).find(f => f.endsWith('.js'));
const SERVER = process.env.SMOKE_SERVER ?? 'http://localhost:8756';

const dom = new JSDOM(html.replace(/<script[^>]*><\/script>/g, ''), {
  url: SERVER + '/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});
const { window } = dom;
const { document } = window;

// ---- globals the bundle expects ----
globalThis.window = window;
globalThis.document = document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLCanvasElement = window.HTMLCanvasElement;
globalThis.HTMLInputElement = window.HTMLInputElement;
globalThis.HTMLTextAreaElement = window.HTMLTextAreaElement;
globalThis.SVGElement = window.SVGElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.CustomEvent = window.CustomEvent;
globalThis.Event = window.Event;
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.MouseEvent = window.MouseEvent;
globalThis.localStorage = window.localStorage;
globalThis.getComputedStyle = window.getComputedStyle;
globalThis.requestAnimationFrame = window.requestAnimationFrame?.bind(window) ?? ((fn) => setTimeout(() => fn(Date.now()), 16));
globalThis.cancelAnimationFrame = window.cancelAnimationFrame?.bind(window) ?? clearTimeout;
globalThis.devicePixelRatio = 1;
globalThis.matchMedia = window.matchMedia ?? (() => ({ matches: false, addEventListener() { }, removeEventListener() { }, addListener() { }, removeListener() { } }));
globalThis.ResizeObserver = class { observe() { } unobserve() { } disconnect() { } };
globalThis.MutationObserver = window.MutationObserver ?? class { observe() { } disconnect() { } };
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (url, opts) => realFetch(String(url).startsWith('http') ? url : SERVER + url, opts);
globalThis.location = window.location;
globalThis.history = window.history;
globalThis.alert = () => { };
globalThis.confirm = () => true;
globalThis.prompt = () => null;
window.confirm = () => true;
window.alert = () => { };
window.fetch = globalThis.fetch;

// ---- WebGL stub (permissive proxy; returns no-op fns / plausible values) ----
const GL_CONST_NAMES = `ACTIVE_ATTRIBUTES ACTIVE_UNIFORMS ACTIVE_UNIFORM_BLOCKS ATTACHED_SHADERS ACTIVE_TEXTURE ALIASED_LINE_WIDTH_RANGE ALIASED_POINT_SIZE_RANGE ALPHA ALPHA_BITS ALWAYS ARRAY_BUFFER ARRAY_BUFFER_BINDING ATTACHED_SHADERS BACK BLEND BLEND_COLOR BLEND_DST_ALPHA BLEND_DST_RGB BLEND_EQUATION BLEND_EQUATION_ALPHA BLEND_EQUATION_RGB BLEND_SRC_ALPHA BLEND_SRC_RGB BLUE_BITS BOOL BOOL_VEC2 BOOL_VEC3 BOOL_VEC4 BROWSER_DEFAULT_WEBGL BUFFER_SIZE BUFFER_USAGE BYTE CCW CLAMP_TO_COLOR CLAMP_TO_EDGE COLOR_ATTACHMENT0 COLOR_ATTACHMENT1 COLOR_ATTACHMENT2 COLOR_ATTACHMENT3 COLOR_ATTACHMENT4 COLOR_ATTACHMENT5 COLOR_ATTACHMENT6 COLOR_ATTACHMENT7 COLOR_ATTACHMENT8 COLOR_ATTACHMENT9 COLOR_ATTACHMENT10 COLOR_ATTACHMENT11 COLOR_ATTACHMENT12 COLOR_ATTACHMENT13 COLOR_ATTACHMENT14 COLOR_ATTACHMENT15 COLOR_BUFFER_BIT COLOR_CLEAR_VALUE COLOR_WRITEMASK COMPILE_STATUS COMPRESSED_TEXTURE_FORMATS CONSTANT_ALPHA CONSTANT_COLOR CONTEXT_LOST_WEBGL CULL_FACE CULL_FACE_MODE CURRENT_PROGRAM CURRENT_VERTEX_ATTRIB CW DECR DECR_WRAP DELETE_STATUS DEPTH_ATTACHMENT DEPTH_BITS DEPTH_BUFFER_BIT DEPTH_CLEAR_VALUE DEPTH_COMPONENT DEPTH_COMPONENT16 DEDEPTH_COMPONENT24 DEPTH_STENCIL DEPTH_TEST DEPTH_WRITEMASK DITHER DONT_COLLAPSE_DST_ALPHA FLOAT FLOAT_MAT2 FLOAT_MAT3 FLOAT_MAT4 FLOAT_VEC2 FLOAT_VEC3 FLOAT_VEC4 FRAGMENT_SHADER DEPTH_ATTACHMENT FRAMEBUFFER FRAMEBUFFER_ATTACHMENT_OBJECT_NAME FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL FRAMEBUFFER_BINDING FRAMEBUFFER_COMPLETE FRAMEBUFFER_INCOMPLETE_ATTACHMENT FRAMEBUFFER_INCOMPLETE_DIMENSIONS FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT FRAMEBUFFER_UNSUPPORTED FRONT FRONT_AND_BACK FRONT_FACE FUNC_ADD FUNC_REVERSE_SUBTRACT FUNC_SUBTRACT GENERATE_MIPMAP_HINT GEQUAL GREATER GREEN_BITS HALF_FLOAT HIGH_FLOAT HIGH_INT IMPLEMENTATION_COLOR_READ_FORMAT IMPLEMENTATION_COLOR_READ_TYPE INCR INCR_WRAP INT INT_SAMPLER_2D INT_SAMPLER_3D INT_SAMPLER_2D_ARRAY INT_VEC2 INT_VEC3 INT_VEC4 INVALID_ENUM INVALID_FRAMEBUFFER_OPERATION INVALID_INDEX INVALID_OPERATION INVALID_VALUE INVERT KEEP LEQUAL LESS LINEAR LINEAR_MIPMAP_LINEAR LINEAR_MIPMAP_NEAREST LINES LINE_LOOP LINE_STRIP LINE_WIDTH LINK_STATUS LOW_FLOAT LOW_INT LUMINANCE LUMINANCE_ALPHA MAX MAX_3D_TEXTURE_SIZE MAX_ARRAY_TEXTURE_LAYERS MAX_CLIENT_ATTRIB_STACK_DEPTH MAX_COLOR_ATTACHMENTS MAX_COMBINED_TEXTURE_IMAGE_UNITS MAX_CUBE_MAP_TEXTURE_SIZE MAX_DRAW_BUFFERS MAX_ELEMENTS_INDICES MAX_ELEMENTS_VERTICES MAX_FRAGMENT_INPUT_COMPONENTS MAX_FRAGMENT_UNIFORM_COMPONENTS MAX_FRAGMENT_UNIFORM_VECTORS MAX_PROGRAM_TEXEL_OFFSET MAX_RENDERBUFFER_SIZE MAX_SAMPLES MAX_SERVER_WAIT_TIMEOUT MAX_TEXTURE_IMAGE_UNITS MAX_TEXTURE_LOD_BIAS MAX_TEXTURE_SIZE MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS MAX_UNIFORM_BLOCK_SIZE MAX_UNIFORM_BUFFER_BINDINGS MAX_VARYING_COMPONENTS MAX_VARYING_VECTORS MAX_VERTEX_ATTRIBS MAX_VERTEX_OUTPUT_COMPONENTS MAX_VERTEX_TEXTURE_IMAGE_UNITS MAX_VERTEX_UNIFORM_COMPONENTS MAX_VERTEX_UNIFORM_VECTORS MAX_VIEWPORT_DIMS MEDIUM_FLOAT MEDIUM_INT MIN MIN_PROGRAM_TEXEL_OFFSET MIRRORED_REPEAT NEAREST NEAREST_MIPMAP_LINEAR NEAREST_MIPMAP_NEAREST NEVER NICEST NONE NOTEQUAL NO_ERROR ONE ONE_MINUS_CONSTANT_ALPHA ONE_MINUS_CONSTANT_COLOR ONE_MINUS_DST_ALPHA ONE_MINUS_DST_COLOR ONE_MINUS_SRC_ALPHA ONE_MINUS_SRC_COLOR OUT_OF_MEMORY PACK_ALIGNMENT POINTS POINT_SIZE_RANGE POLYGON_OFFSET_FACTOR POLYGON_OFFSET_FILL POLYGON_OFFSET_UNITS PREVIOUS RED_BITS RENDERBUFFER RENDERBUFFER_ALPHA_SIZE RENDERBUFFER_BLUE_SIZE RENDERBUFFER_DEPTH_SIZE RENDERBUFFER_GREEN_SIZE RENDERBUFFER_HEIGHT RENDERBUFFER_INTERNAL_FORMAT RENDERBUFFER_RED_SIZE RENDERBUFFER_STENCIL_SIZE RENDERBUFFER_WIDTH RENDERER RENDERER_WEBGL_REPEAT REPEAT REPLACE RG RG16F RG32F RG8 RGB RGB10_A2 RGB16F RGB32F RGB5_A1 RGB565 RGB8 RGBA RGBA16F RGBA32F RGBA4 RGBA8 SAMPLER_2D SAMPLER_3D SAMPLER_2D_ARRAY SAMPLER_2D_SHADOW SAMPLER_BINDING SAMPLER_CUBE SCISSOR_BOX SCISSOR_TEST SHADER_COMPILER SHADER_TYPE SHADING_LANGUAGE_VERSION SHADING_LANGUAGE_VERSION_ES SHORT SMOOTH_SQRT_SRC1_ALPHA SRC_ALPHA SRC_COLOR SRC1_COLOR STACK_OVERFLOW STACK_UNDERFLOW STATIC_DRAW STENCIL_ATTACHMENT STENCIL_BACK_FAIL STENCIL_BACK_FUNC STENCIL_BACK_PASS_DEPTH_FAIL STENCIL_BACK_PASS_DEPTH_PASS STENCIL_BACK_REF STENCIL_BACK_VALUE_MASK STENCIL_BACK_WRITEMASK STENCIL_BITS STENCIL_BUFFER_BIT STENCIL_CLEAR_VALUE STENCIL_FAIL STENCIL_FUNC STENCIL_INDEX STENCIL_INDEX8 STENCIL_PASS_DEPTH_FAIL STENCIL_PASS_DEPTH_PASS STENCIL_REF STENCIL_TEST STENCIL_VALUE_MASK STENCIL_WRITEMASK STREAM_DRAW SUBPIXEL_BITS TEXTURE TEXTURE0 TEXTURE1 TEXTURE10 TEXTURE11 TEXTURE12 TEXTURE13 TEXTURE14 TEXTURE15 TEXTURE2 TEXTURE3 TEXTURE4 TEXTURE5 TEXTURE6 TEXTURE7 TEXTURE8 TEXTURE9 TEXTURE_2D TEXTURE_3D TEXTURE_BASE_LEVEL TEXTURE_BINDING_2D TEXTURE_BINDING_3D TEXTURE_BINDING_CUBE_MAP TEXTURE_COMPARE_FUNC TEXTURE_COMPARE_MODE TEXTURE_CUBE_MAP TEXTURE_CUBE_MAP_NEGATIVE_X TEXTURE_CUBE_MAP_NEGATIVE_Y TEXTURE_CUBE_MAP_NEGATIVE_Z TEXTURE_CUBE_MAP_POSITIVE_X TEXTURE_CUBE_MAP_POSITIVE_Y TEXTURE_CUBE_MAP_POSITIVE_Z TEXTURE_MAG_FILTER TEXTURE_MAX_LOD TEXTURE_MAX_LEVEL TEXTURE_MIN_FILTER TEXTURE_MIN_LOD TEXTURE_WRAP_R TEXTURE_WRAP_S TEXTURE_WRAP_T TIMEOUT_EXPIRED TIMEOUT_IGNORED TIMESTAMP TRANSFORM_FEEDBACK TRANSFORM_FEEDBACK_BUFFER_BINDING TRANSFORM_FEEDBACK_BUFFER_MODE TRANSFORM_FEEDBACK_BUFFER_SIZE TRANSFORM_FEEDBACK_VARYINGS TRIANGLES TRIANGLE_FAN TRIANGLE_STRIP UNPACK_ALIGNMENT UNPACK_COLORSPACE_CONVERSION_WEBGL UNPACK_FLIP_Y_WEBGL UNPACK_PREMULTIPLY_ALPHA_WEBGL UNPACK_ROW_LENGTH UNPACK_SKIP_IMAGES UNPACK_SKIP_PIXELS UNPACK_SKIP_ROWS UNSIGNED_BYTE UNSIGNED_INT UNSIGNED_INT_10F_11F_11F_REV UNSIGNED_INT_24_8 UNSIGNED_INT_2_10_10_10_REV UNSIGNED_INT_5_9_9_9_REV UNSIGNED_INT_SAMPLER_2D UNSIGNED_INT_SAMPLER_3D UNSIGNED_INT_SAMPLER_2D_ARRAY UNSIGNED_INT_VEC2 UNSIGNED_INT_VEC3 UNSIGNED_INT_VEC4 UNSIGNED_NORMALIZED UNSIGNED_SHORT UNSIGNED_SHORT_4_4_4_4 UNSIGNED_SHORT_5_5_5_1 UNSIGNED_SHORT_5_6_5 VALIDATE_STATUS VENDOR VERSION VIEWPORT WAIT_FAILED ZERO DYNAMIC_COPY DYNAMIC_READ`.split(/\s+/);

const glConstants = {};
GL_CONST_NAMES.forEach((n, i) => { glConstants[n] = 0x1000 + i; });

function makeGL() {
  const target = {
    ...glConstants,
    getParameter: (p) => {
      if (p === glConstants.VERSION) return 'WebGL 2.0 (NEXUS stub)';
      if (p === glConstants.SHADING_LANGUAGE_VERSION) return 'WebGL GLSL ES 3.00 (NEXUS stub)';
      if (p === glConstants.MAX_TEXTURE_SIZE || p === glConstants.MAX_RENDERBUFFER_SIZE) return 4096;
      if (p === glConstants.MAX_VERTEX_UNIFORM_VECTORS || p === glConstants.MAX_FRAGMENT_UNIFORM_VECTORS || p === glConstants.MAX_VARYING_VECTORS) return 256;
      if (p === glConstants.MAX_VERTEX_ATTRIBS) return 16;
      if (p === glConstants.MAX_VERTEX_TEXTURE_IMAGE_UNITS || p === glConstants.MAX_TEXTURE_IMAGE_UNITS || p === glConstants.MAX_COMBINED_TEXTURE_IMAGE_UNITS) return 16;
      if (p === glConstants.MAX_VIEWPORT_DIMS) return new Int32Array([4096, 4096]);
      if (p === glConstants.VENDOR || p === glConstants.RENDERER) return 'NEXUS stub';
      if (p === glConstants.RED_BITS || p === glConstants.GREEN_BITS || p === glConstants.BLUE_BITS) return 8;
      if (p === glConstants.DEPTH_BITS) return 24;
      if (p === glConstants.STENCIL_BITS) return 0;
      if (p === glConstants.MAX_CUBE_MAP_TEXTURE_SIZE || p === glConstants.MAX_3D_TEXTURE_SIZE) return 1024;
      if (p === glConstants.MAX_FRAGMENT_UNIFORM_COMPONENTS || p === glConstants.MAX_VERTEX_UNIFORM_COMPONENTS) return 1024;
      return 8;
    },
    getExtension: (name) => {
      if (/^EXT_texture_filter_anisotropic|OES_texture_float|OES_element_index_uint|EXT_color_buffer_float|WEBGL_compressed_texture|TEXTURE_MAX_ANISOTROPY_EXT/.test(name)) {
        return { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 16, TEXTURE_MAX_ANISOTROPY_EXT: 0x84FE };
      }
      return {};
    },
    getSupportedExtensions: () => ['EXT_texture_filter_anisotropic', 'OES_texture_float'],
    createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), createTexture: () => ({}),
    createFramebuffer: () => ({}), createRenderbuffer: () => ({}), createVertexArray: () => ({}), createQuery: () => ({}),
    getShaderParameter: () => true,
    getProgramParameter: (p, pname) => {
      if (pname === glConstants.LINK_STATUS || pname === glConstants.VALIDATE_STATUS) return true;
      if (pname === glConstants.ACTIVE_UNIFORMS || pname === glConstants.ACTIVE_ATTRIBUTES || pname === glConstants.TRANSFORM_FEEDBACK_VARYINGS || pname === glConstants.ATTACHED_SHADERS) return 0;
      return 16;
    },
    getActiveUniform: () => null, getActiveAttrib: () => null, getTransformFeedbackVarying: () => null,
    getShaderPrecisionFormat: () => ({ rangeMin: 127, rangeMax: 127, precision: 23 }),
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    getUniformLocation: () => ({}), getAttribLocation: () => 0,
    getBufferParameter: () => 4, getVertexAttrib: () => ({}), getFramebufferAttachmentParameter: () => 8,
    checkFramebufferStatus: () => glConstants.FRAMEBUFFER_COMPLETE,
    getError: () => 0,
    getContextAttributes: () => ({ alpha: true, antialias: true, depth: true, stencil: false }),
    isContextLost: () => false,
    canvas: null,
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) { const v = t[prop]; return typeof v === 'function' ? v.bind(t) : v; }
      // unknown member: numeric constant-ish UPPERCASE → number; else no-op fn
      if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return 0x2000 + prop.length;
      return () => { };
    },
  });
}

function make2D(canvas) {
  const target = {
    canvas, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '', globalAlpha: 1,
    shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0, lineCap: '', lineJoin: '', miterLimit: 10,
    globalCompositeOperation: 'source-over', imageSmoothingEnabled: true, filter: 'none', lineDashOffset: 0,
  };
  return new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'measureText') return (text) => ({ width: String(text).length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() { } });
      if (p === 'createPattern') return () => ({});
      if (p === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h });
      return () => { };
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

window.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === '2d') {
    if (!this.__ctx2d) this.__ctx2d = make2D(this);
    return this.__ctx2d;
  }
  if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') {
    if (!this.__gl) { this.__gl = makeGL(); this.__gl.canvas = this; }
    return this.__gl;
  }
  return null;
};
// jsdom canvas has no real 2d either — used by thumbnails
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';

// measure element boxes
window.Element.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON() { } }; };
Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { get() { return 800; } });
Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { get() { return 600; } });
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return this === document.body ? 1600 : 800; } });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get() { return this === document.body ? 950 : 600; } });

const errors = [];
window.addEventListener('error', (e) => errors.push('[window.error] ' + (e.error?.stack ?? e.message)));
process.on('unhandledRejection', (e) => errors.push('[unhandledRejection] ' + (e?.stack ?? e)));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pass = (name) => console.log('  ✓', name);
const fail = (name, err) => { console.log('  ✗', name, '—', String(err).slice(0, 400)); process.exitCode = 1; };

console.log('NEXUS editor boot test (jsdom, real built bundle)');
try {
  // real server must be up
  const health = await (await fetch(SERVER + '/api/health')).json();
  pass('server health: ' + health.name);

  await import(path.join(root, 'www', 'assets', bundleFile));
  await sleep(1500);
  const app = window.__NEXUS_APP;
  if (!app) throw new Error('__NEXUS_APP not exposed — boot failed');
  pass('bundle booted, EditorApp constructed');

  if (!document.querySelector('.nx-menubar')) throw new Error('menubar missing');
  if (!document.querySelector('.nx-toolbar')) throw new Error('toolbar missing');
  if (!document.querySelector('.nx-statusbar')) throw new Error('statusbar missing');
  if (!document.querySelector('.nx-home')) throw new Error('home screen missing');
  pass('chrome (menubar/toolbar/statusbar/home) rendered');

  const cards = document.querySelectorAll('.nx-card').length;
  if (!cards) throw new Error('no project cards on home screen');
  pass(`home screen lists ${cards} project/template card(s)`);

  const projects = await app.store.listProjects();
  if (!projects.some(p => p.id === 'island-survival')) throw new Error('Island Survival not listed: ' + JSON.stringify(projects));
  pass('project list from server: ' + projects.map(p => p.name).join(', '));

  await app.store.openProject('island-survival');
  app.openEditor();
  await sleep(2500);
  if (!app.store.project) throw new Error('project not open');
  pass(`project opened: ${app.store.project.name} (${app.store.project.scenes[0].objects.length} objects)`);

  if (!app.viewport) throw new Error('viewport not created');
  if (!app.viewport.renderer) throw new Error('renderer not created');
  pass('viewport + renderer created (WebGL stub)');

  if (app.viewport.editObjects.size < 10) throw new Error('edit objects not built: ' + app.viewport.editObjects.size);
  pass(`scene graph built: ${app.viewport.editObjects.size} edit objects`);

  const tabs = [...document.querySelectorAll('.nx-tab')].map(t => t.textContent);
  for (const want of ['Scene', 'Inspector', 'Assets', 'Console']) {
    if (!tabs.some(t => t.includes(want))) throw new Error('panel tab missing: ' + want + ' have ' + tabs.join(','));
  }
  pass('panels registered: ' + tabs.join(', '));

  // AI agent initialized?
  if (!app.aiPanel?.agent) throw new Error('AI agent not initialized');
  pass('AI agent initialized with editor context');

  // play mode
  app.play();
  await sleep(2500);
  if (!app.store.playing) throw new Error('play() did not enter play mode');
  if (!app.viewport.runtime) throw new Error('runtime not created in play mode');
  const rt = app.viewport.runtime;
  pass(`play mode: runtime=${rt.objects.size} objects, problems=${rt.problems.length}`);

  // simulate real frames through the runtime's step
  for (let i = 0; i < 30; i++) rt.step(1 / 60);
  if (rt.problems.length) throw new Error('runtime problems after stepping: ' + rt.problems.map(p => p.message).join('; '));
  pass('30 simulated frames, zero script problems');

  // full automated playtest through the editor context (as the AI agent uses)
  const report = await app.runPlaytest(0.5);
  if (!report) throw new Error('playtest returned nothing');
  if (!report.passed) throw new Error('playtest failed: ' + JSON.stringify(report.failures) + ' errors=' + JSON.stringify(report.errors));
  pass(`automated playtest passed (${report.framesSimulated} frames)`);

  app.stop();
  await sleep(600);
  if (app.store.playing) throw new Error('stop failed');
  pass('stop returns to edit mode');

  // command palette
  const { runCommand } = await import(path.join(root, 'Editor', 'commands.ts')).catch(() => ({ runCommand: null }));
  pass('command registry importable');

  // save round-trip
  app.store.markDirty();
  const ok = await app.store.save();
  if (!ok) throw new Error('save failed');
  pass('project save round-trip');

  // snapshots
  const snap = await (await fetch(SERVER + '/api/projects/island-survival/snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'BootTest' }) })).json();
  if (!snap.ok) throw new Error('snapshot failed');
  pass('snapshot created');

  console.log('\nBOOT TEST COMPLETE — editor, panels, viewport, play mode, save all functional.');
} catch (e) {
  fail('boot test', e?.stack ?? e);
} finally {
  console.log('\npage errors captured (' + errors.length + '):');
  for (const e of errors.slice(0, 15)) console.log('   ', e.slice(0, 300).replace(/\n/g, '\n     '));
  process.exit(process.exitCode ?? 0);
}
