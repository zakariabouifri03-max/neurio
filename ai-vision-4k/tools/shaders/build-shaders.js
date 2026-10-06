#!/usr/bin/env node
/*
 * AI Vision 4K — GLSL -> SPIR-V build step.
 *
 * Every shader in the engine is compiled ahead of time and the resulting SPIR-V
 * blobs are checked in and embedded into the .so by CMake (see
 * cpp/shaders/CMakeLists.txt). Nothing is compiled from source strings at
 * runtime: mobile drivers vary wildly in their runtime GLSL support and a
 * shader compile failure on one device would break the whole engine.
 *
 * Two backends, chosen automatically:
 *   1. `glslangValidator` (Khronos, from the Vulkan SDK or the NDK) — preferred,
 *      full Vulkan semantics.
 *   2. @webgpu/glslang's WASM build — no toolchain installation required, works
 *      from a plain Node install (`npm --prefix tools/shaders install`).
 *
 * Usage:
 *   node tools/shaders/build-shaders.js            # build all
 *   node tools/shaders/build-shaders.js --check     # verify without writing
 *   node tools/shaders/build-shaders.js --verify-only
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SHADER_DIR = path.join(ROOT, 'aiupscaler-sdk', 'src', 'main', 'cpp', 'shaders');
const OUT_DIR = path.join(SHADER_DIR, 'spirv');

// name -> stage, plus optional preprocessor definitions.
const SHADERS = [
  { file: 'preprocess_luma.comp', stage: 'compute' },
  { file: 'motion_estimate.comp', stage: 'compute' },
  { file: 'sr_conv.comp', stage: 'compute' },
  { file: 'pixel_shuffle.comp', stage: 'compute' },
  { file: 'edge_reconstruct.comp', stage: 'compute' },
  { file: 'temporal_accum.comp', stage: 'compute' },
  { file: 'aa_resolve.comp', stage: 'compute' },
  { file: 'sharpen.comp', stage: 'compute' },
  { file: 'denoise.comp', stage: 'compute' },
  { file: 'quality_metrics.comp', stage: 'compute' },
  { file: 'elementwise.comp', stage: 'compute' },
  { file: 'downsample.comp', stage: 'compute' },
  { file: 'image_to_planar.comp', stage: 'compute' },
  { file: 'planar_to_image.comp', stage: 'compute' },
  { file: 'bicubic_residual.comp', stage: 'compute' },
  { file: 'prelu.comp', stage: 'compute' },
  { file: 'particle_sim.comp', stage: 'compute' },
  { file: 'fullscreen.vert', stage: 'vertex' },
  { file: 'present.frag', stage: 'fragment' },
  { file: 'sky.frag', stage: 'fragment' },
  { file: 'scene.vert', stage: 'vertex' },
  { file: 'scene.vert', stage: 'vertex', defines: { SHADOW_PASS: 1 }, outputName: 'scene_shadow.vert.spv' },
  { file: 'scene.frag', stage: 'fragment' },
  { file: 'particle.vert', stage: 'vertex' },
  { file: 'particle.frag', stage: 'fragment' },
];

const dirname = (p) => path.dirname(p);
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');

function findGlslangValidator() {
  const candidates = [
    process.env.GLSLANG_VALIDATOR,
    'glslangValidator',
    path.join(process.env.ANDROID_NDK_HOME || '', 'shader_tools', 'glslangValidator'),
    path.join(process.env.ANDROID_NDK_ROOT || '', 'shader_tools', 'glslangValidator'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch (_) {
      /* keep looking */
    }
  }
  return null;
}

async function loadWasmBackend() {
  const candidates = [
    // Installed next to this script (tools/shaders/node_modules).
    path.join(__dirname, 'node_modules', '@webgpu', 'glslang', 'dist', 'web-devel', 'glslang.js'),
    // Or anywhere else on the module path.
    '@webgpu/glslang/dist/web-devel/glslang.js',
    '/tmp/gvt4/node_modules/@webgpu/glslang/dist/web-devel/glslang.js',
  ];
  for (const candidate of candidates) {
    try {
      const wasmDir = path.join(dirname(candidate), 'glslang.wasm');
      const resolved = path.isAbsolute(candidate) ? candidate : require.resolve(candidate);
      const resolvedWasm = path.isAbsolute(candidate)
        ? wasmDir
        : path.join(path.dirname(resolved), 'glslang.wasm');
      // The WASM build fetches its payload; feed it from disk.
      globalThis.fetch = async (url) => {
        const name = String(url).replace(/^.*\//, '');
        const payload = fs.readFileSync(path.join(path.dirname(resolvedWasm), name));
        return new Response(payload, { headers: { 'content-type': 'application/wasm' } });
      };
      const module = await import(resolved);
      return { glslang: await module.default(), path: resolved };
    } catch (_) {
      /* try the next candidate */
    }
  }
  return null;
}

function sanitise(source, defines) {
  let out = source;
  if (defines) {
    const defineBlock = Object.entries(defines)
      .map(([k, v]) => `#define ${k} ${v}`)
      .join('\n');
    const versionIndex = out.indexOf('#version');
    if (versionIndex < 0) {
      throw new Error('shader has no #version directive');
    }
    const newline = out.indexOf('\n', versionIndex);
    if (newline < 0) {
      throw new Error('malformed #version directive');
    }
    // Definitions must follow #version but precede any code.
    out = out.slice(0, newline + 1) + defineBlock + '\n' + out.slice(newline + 1);
  }
  return out;
}

// glslang's WASM build hands back a Uint32Array of SPIR-V words; the file needs
// the little endian byte encoding of those words (NOT a truncated copy).
function wordsToBytes(words) {
  const bytes = Buffer.alloc(words.length * 4);
  for (let i = 0; i < words.length; ++i) {
    bytes.writeUInt32LE(words[i] >>> 0, i * 4);
  }
  return bytes;
}

async function main() {
  if (!fs.existsSync(SHADER_DIR)) {
    console.error(`shader directory not found: ${SHADER_DIR}`);
    process.exit(2);
  }

  const validator = findGlslangValidator();
  let wasm = null;
  if (!validator) {
    wasm = await loadWasmBackend();
  }
  const backend = validator ? `glslangValidator (${validator})` : wasm ? 'webgpu/glslang WASM' : null;
  if (!backend) {
    console.error('No shader compiler available.\n' +
      '  Install the Vulkan SDK / NDK shader tools, or run:\n' +
      '    npm --prefix tools/shaders install');
    process.exit(2);
  }
  console.log(`== shader backend: ${backend} ==`);

  if (!checkOnly) fs.mkdirSync(OUT_DIR, { recursive: true });

  let failures = 0;
  let totalBytes = 0;

  for (const shader of SHADERS) {
    const sourcePath = path.join(SHADER_DIR, shader.file);
    if (!fs.existsSync(sourcePath)) {
      console.error(`  MISSING ${shader.file}`);
      failures++;
      continue;
    }
    const outputName = shader.outputName || `${shader.file}.spv`;
    const outputPath = path.join(OUT_DIR, outputName);
    const source = sanitise(fs.readFileSync(sourcePath, 'utf8'), shader.defines);

    try {
      let spirv;
      if (validator) {
        const tmp = path.join(OUT_DIR, `.${outputName}.glsl`);
        fs.writeFileSync(tmp, source);
        execFileSync(validator, ['-V', '--target-env', 'vulkan1.1', sourcePath.endsWith('.comp') ? '-S' : '-S',
          shader.stage, tmp, '-o', outputPath], { stdio: 'pipe' });
        fs.unlinkSync(tmp);
        spirv = fs.readFileSync(outputPath);
      } else {
        const compiled = wasm.glslang.compileGLSL(source, shader.stage);
        spirv = wordsToBytes(compiled);
        const magic = spirv.readUInt32LE(0);
        if (magic !== 0x07230203) {
          throw new Error(`bad SPIR-V magic 0x${magic.toString(16)}`);
        }
        if (!checkOnly) fs.writeFileSync(outputPath, spirv);
      }
      totalBytes += spirv.length;
      console.log(`  ok   ${outputName.padEnd(28)} ${String(spirv.length).padStart(6)} bytes`);
    } catch (error) {
      failures++;
      const message = (error && (error.stderr || error.message || error.toString())) || 'unknown error';
      console.error(`  FAIL ${outputName}\n${String(message).split('\n').slice(0, 12).join('\n')}`);
    }
  }

  console.log(`== ${SHADERS.length - failures}/${SHADERS.length} shaders built, ${totalBytes} bytes total ==`);
  if (failures > 0) process.exit(1);
  if (checkOnly) console.log('(--check: nothing written)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
