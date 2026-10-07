/** Thin WebGL2 helpers: programs, framebuffers, textures. */

export interface Program {
  prog: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

export interface FBO {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
}

export class GLContext {
  gl: WebGL2RenderingContext;
  private programs = new Map<string, Program>();
  private pool: FBO[] = [];
  private inUse = new Set<FBO>();
  private vao: WebGLVertexArrayObject;
  maxTexSize: number;

  constructor(public canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
      desynchronized: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not supported in this browser');
    this.gl = gl;
    this.maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
  }

  program(key: string, vert: string, frag: string): Program {
    let p = this.programs.get(key);
    if (p) return p;
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error(`Shader compile error (${key}): ${log}\n${src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n')}`);
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, vert);
    const fs = compile(gl.FRAGMENT_SHADER, frag);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Program link error (${key}): ${gl.getProgramInfoLog(prog)}`);
    const uniforms = new Map<string, WebGLUniformLocation | null>();
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i)!;
      const name = info.name.replace(/\[0\]$/, '');
      uniforms.set(name, gl.getUniformLocation(prog, info.name));
      if (info.size > 1) uniforms.set(info.name, gl.getUniformLocation(prog, info.name));
    }
    p = { prog, uniforms };
    this.programs.set(key, p);
    return p;
  }

  hasProgram(key: string) {
    return this.programs.has(key);
  }

  use(p: Program) {
    this.gl.useProgram(p.prog);
  }

  u(p: Program, name: string) {
    return p.uniforms.get(name) ?? null;
  }
  u1f(p: Program, name: string, v: number) {
    const l = this.u(p, name);
    if (l) this.gl.uniform1f(l, v);
  }
  u1i(p: Program, name: string, v: number) {
    const l = this.u(p, name);
    if (l) this.gl.uniform1i(l, v);
  }
  u2f(p: Program, name: string, x: number, y: number) {
    const l = this.u(p, name);
    if (l) this.gl.uniform2f(l, x, y);
  }
  u3f(p: Program, name: string, x: number, y: number, z: number) {
    const l = this.u(p, name);
    if (l) this.gl.uniform3f(l, x, y, z);
  }
  u4f(p: Program, name: string, x: number, y: number, z: number, w: number) {
    const l = this.u(p, name);
    if (l) this.gl.uniform4f(l, x, y, z, w);
  }
  u1fv(p: Program, name: string, v: Float32Array | number[]) {
    const l = this.u(p, name);
    if (l) this.gl.uniform1fv(l, v);
  }
  u2fv(p: Program, name: string, v: Float32Array | number[]) {
    const l = this.u(p, name);
    if (l) this.gl.uniform2fv(l, v);
  }
  umat3(p: Program, name: string, m: Float32Array | number[]) {
    const l = this.u(p, name);
    if (l) this.gl.uniformMatrix3fv(l, false, m);
  }
  tex(p: Program, name: string, unit: number, tex: WebGLTexture | null, target: number = this.gl.TEXTURE_2D) {
    const l = this.u(p, name);
    if (!l) return;
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(target, tex);
    this.gl.uniform1i(l, unit);
  }

  createTexture(filter: number = this.gl.LINEAR, wrap: number = this.gl.CLAMP_TO_EDGE): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  }

  upload(tex: WebGLTexture, source: TexImageSource, premultiply = true) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    // No Y flip: the compositor works in a y-down (screen) convention — texel row 0 is the top of the
    // image, FBO row 0 is the top of the frame, and only the final blit to the canvas flips.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  uploadData(tex: WebGLTexture, w: number, h: number, data: Uint8Array | Float32Array | null, format: 'rgba8' | 'r8' | 'rgba32f' = 'rgba8') {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (format === 'r8') gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data as Uint8Array | null);
    else if (format === 'rgba32f') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data as Float32Array | null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data as Uint8Array | null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  create3DTexture(size: number, data: Uint8Array): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, size, size, size, 0, gl.RGB, gl.UNSIGNED_BYTE, data);
    return t;
  }

  acquireFBO(width: number, height: number): FBO {
    width = Math.max(1, Math.min(this.maxTexSize, Math.round(width)));
    height = Math.max(1, Math.min(this.maxTexSize, Math.round(height)));
    const idx = this.pool.findIndex((f) => f.width === width && f.height === height && !this.inUse.has(f));
    let f: FBO;
    if (idx >= 0) f = this.pool[idx];
    else {
      const gl = this.gl;
      const tex = this.createTexture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      f = { fb, tex, width, height };
      this.pool.push(f);
      if (this.pool.length > 48) this.gcPool();
    }
    this.inUse.add(f);
    return f;
  }

  release(f: FBO | null | undefined) {
    if (f) this.inUse.delete(f);
  }

  releaseAll() {
    this.inUse.clear();
  }

  private gcPool() {
    const gl = this.gl;
    const keep: FBO[] = [];
    for (const f of this.pool) {
      if (this.inUse.has(f) || keep.length < 24) keep.push(f);
      else {
        gl.deleteFramebuffer(f.fb);
        gl.deleteTexture(f.tex);
      }
    }
    this.pool = keep;
  }

  bind(f: FBO | null, w?: number, h?: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f ? f.fb : null);
    gl.viewport(0, 0, f ? f.width : w ?? this.canvas.width, f ? f.height : h ?? this.canvas.height);
  }

  clear(r = 0, g = 0, b = 0, a = 0) {
    const gl = this.gl;
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    const gl = this.gl;
    for (const f of this.pool) {
      gl.deleteFramebuffer(f.fb);
      gl.deleteTexture(f.tex);
    }
    for (const p of this.programs.values()) gl.deleteProgram(p.prog);
    this.pool = [];
    this.programs.clear();
  }
}
