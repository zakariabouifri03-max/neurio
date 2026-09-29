// Test-only view of the vendored build: everything is real three.js except
// WebGLRenderer, which is replaced by the headless stub (see renderer-stub.mjs).
export * from '../vendor/three.module.js';
import { StubWebGLRenderer as WebGLRenderer } from './renderer-stub.mjs';

export { WebGLRenderer };
