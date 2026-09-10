import type { ModePalette } from "../smoke/modes";
import { EMBER_STRIDE, SMOKE_STRIDE } from "../smoke/particles";
import { buildSmokeAtlas } from "./sprites";

const SMOKE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_p;   // x, y, size, rotation
layout(location=2) in vec4 a_q;   // alpha, heat, seed, variant
uniform vec2 u_res;
out vec2 v_uv;
out float v_alpha;
out float v_heat;
void main() {
  float c = cos(a_p.w);
  float s = sin(a_p.w);
  vec2 off = vec2(a_corner.x * c - a_corner.y * s, a_corner.x * s + a_corner.y * c) * a_p.z;
  vec2 pos = a_p.xy + off;
  vec2 clip = (pos / u_res) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  float v = a_q.w;
  vec2 tile = vec2(mod(v, 2.0), floor(v * 0.5));
  v_uv = (a_corner * 0.5 + 0.5) * 0.5 + tile * 0.5;
  v_alpha = a_q.x;
  v_heat = a_q.y;
}`;

/** Accumulates density in R and heat*density in G. Blend is additive. */
const SMOKE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in float v_alpha;
in float v_heat;
uniform sampler2D u_sprite;
out vec4 frag;
void main() {
  float a = texture(u_sprite, v_uv).a * v_alpha;
  if (a <= 0.001) discard;
  frag = vec4(a, a * v_heat, 0.0, a);
}`;

const FULL_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_corner;
out vec2 v_uv;
void main() {
  v_uv = a_corner * 0.5 + 0.5;
  gl_Position = vec4(a_corner, 0.0, 1.0);
}`;

/**
 * Shades the accumulated density.
 *
 * The gradient of the density field stands in for a surface normal, so thick
 * smoke self-shades against a fixed key light. It is not a volume integral, but
 * at this scale it is indistinguishable from one and costs a single pass.
 */
const SHADE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_density;
uniform vec2 u_texel;
uniform vec3 u_thin;
uniform vec3 u_thick;
uniform vec3 u_light;
uniform vec3 u_glow;
uniform float u_glowAmount;
uniform float u_opacity;
uniform float u_normal;
uniform float u_absorb;     // how fast density turns opaque
uniform float u_alphaGain;
uniform float u_ambient;
uniform float u_diffuse;
uniform float u_rim;
uniform vec3 u_emberLight;   // xy = position in uv space, z = intensity
uniform vec3 u_emberColor;
out vec4 frag;

float D(vec2 uv) { return texture(u_density, uv).r; }

void main() {
  vec4 c = texture(u_density, v_uv);
  float d = c.r;
  if (d <= 0.0015) discard;
  float heat = c.g / max(d, 0.0015);

  float dx = D(v_uv + vec2(u_texel.x, 0.0)) - D(v_uv - vec2(u_texel.x, 0.0));
  float dy = D(v_uv + vec2(0.0, u_texel.y)) - D(v_uv - vec2(0.0, u_texel.y));
  vec3 n = normalize(vec3(-dx * u_normal, -dy * u_normal, 1.0));

  // +v runs up the density buffer, so a key light from above has a positive y.
  vec3 key = normalize(vec3(-0.5, 0.72, 0.5));
  float lambert = clamp(dot(n, key) * 0.5 + 0.5, 0.0, 1.0);

  // Beer-Lambert-ish: thin smoke is nearly transparent, thick smoke saturates.
  float thickness = 1.0 - exp(-d * u_absorb);
  vec3 body = mix(u_thin, u_thick, clamp(thickness * 1.2, 0.0, 1.0));
  vec3 lit = body * (u_ambient + u_diffuse * lambert);
  // Thin edges catch the key light: the bright fringe that says "smoke" rather
  // than "fog".
  lit += u_light * pow(lambert, 3.0) * u_rim * (1.0 - thickness * 0.75);

  if (u_glowAmount > 0.001) {
    // Eight taps on the linearly-filtered half-res buffer is a serviceable
    // bloom for the price of one pass.
    float b = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853982;
      b += D(v_uv + vec2(cos(a), sin(a)) * u_texel * 5.0);
    }
    b *= 0.125;
    lit += u_glow * u_glowAmount * (heat * 0.55 + b * 0.85);
  }

  // A warm bounce from the burning tip, falling off with distance.
  float ed = distance(v_uv, u_emberLight.xy);
  lit += u_emberColor * u_emberLight.z * exp(-ed * 9.0) * (0.35 + 0.65 * lambert);

  float alpha = clamp(thickness * u_opacity * u_alphaGain, 0.0, 1.0);
  frag = vec4(lit * alpha, alpha);
}`;

const EMBER_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_p;   // x, y, size, alpha
layout(location=2) in vec2 a_q;   // heat, seed
uniform vec2 u_res;
out vec2 v_local;
out float v_alpha;
out float v_heat;
void main() {
  vec2 pos = a_p.xy + a_corner * a_p.z;
  vec2 clip = (pos / u_res) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_local = a_corner;
  v_alpha = a_p.w;
  v_heat = a_q.x;
}`;

const EMBER_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in float v_alpha;
in float v_heat;
uniform vec3 u_color;
out vec4 frag;
void main() {
  float r = length(v_local);
  float core = exp(-r * r * 7.0);
  float halo = exp(-r * r * 1.6) * 0.35;
  float a = (core + halo) * v_alpha;
  vec3 col = mix(u_color, vec3(1.0, 0.95, 0.8), core * v_heat * 0.7);
  frag = vec4(col * a, a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) ?? "shader compile failed");
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) ?? "program link failed");
  }
  return p;
}

const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

export interface RenderOptions {
  palette: ModePalette;
  opacity: number;
  /** Ember position in canvas px and its intensity, for the warm bounce light. */
  ember: { x: number; y: number; intensity: number } | null;
}

export class SmokeRenderer {
  private gl: WebGL2RenderingContext;
  private smokeProg: WebGLProgram;
  private shadeProg: WebGLProgram;
  private emberProg: WebGLProgram;
  private quad: WebGLBuffer;
  private smokeBuf: WebGLBuffer;
  private emberBuf: WebGLBuffer;
  private smokeVao: WebGLVertexArrayObject;
  private shadeVao: WebGLVertexArrayObject;
  private emberVao: WebGLVertexArrayObject;
  private sprite: WebGLTexture;
  private fbo: WebGLFramebuffer;
  private densityTex: WebGLTexture;
  private width = 0;
  private height = 0;
  private fboW = 0;
  private fboH = 0;
  private uniforms: Record<string, Record<string, WebGLUniformLocation | null>> = {};

  /** Half-res density buffer: cheaper, and the linear upscale softens for free. */
  private scale = 0.5;

  /**
   * Shading constants, shared by every mode. Exposed rather than baked into the
   * shader so the look can be dialled in against live smoke.
   */
  tuning = {
    normal: 26,
    absorb: 2.4,
    alphaGain: 1.5,
    ambient: 0.34,
    diffuse: 1.05,
    rim: 0.55,
  };

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      desynchronized: true,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;

    // RGBA8 saturates at a density of 1, which flattens the thickest smoke but
    // is otherwise fine — float render targets are the preference, not a need.
    if (!gl.getExtension("EXT_color_buffer_float")) gl.getExtension("EXT_color_buffer_half_float");

    this.smokeProg = link(gl, SMOKE_VS, SMOKE_FS);
    this.shadeProg = link(gl, FULL_VS, SHADE_FS);
    this.emberProg = link(gl, EMBER_VS, EMBER_FS);
    this.cacheUniforms();

    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);

    this.smokeBuf = gl.createBuffer()!;
    this.emberBuf = gl.createBuffer()!;

    this.smokeVao = this.makeInstancedVao(this.smokeBuf, SMOKE_STRIDE, [4, 4]);
    this.emberVao = this.makeInstancedVao(this.emberBuf, EMBER_STRIDE, [4, 2]);

    this.shadeVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.shadeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.sprite = this.makeSpriteTexture();
    this.densityTex = gl.createTexture()!;
    this.fbo = gl.createFramebuffer()!;
  }

  private cacheUniforms() {
    const gl = this.gl;
    const grab = (p: WebGLProgram, names: string[]) => {
      const out: Record<string, WebGLUniformLocation | null> = {};
      for (const n of names) out[n] = gl.getUniformLocation(p, n);
      return out;
    };
    this.uniforms.smoke = grab(this.smokeProg, ["u_res", "u_sprite"]);
    this.uniforms.shade = grab(this.shadeProg, [
      "u_density", "u_texel", "u_thin", "u_thick", "u_light",
      "u_glow", "u_glowAmount", "u_opacity", "u_normal", "u_emberLight", "u_emberColor",
      "u_absorb", "u_alphaGain", "u_ambient", "u_diffuse", "u_rim",
    ]);
    this.uniforms.ember = grab(this.emberProg, ["u_res", "u_color"]);
  }

  private makeInstancedVao(buffer: WebGLBuffer, stride: number, sizes: number[]) {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    let offset = 0;
    sizes.forEach((size, i) => {
      const loc = i + 1;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
      offset += size;
    });
    gl.bindVertexArray(null);
    return vao;
  }

  private makeSpriteTexture() {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, buildSmokeAtlas());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  resize(width: number, height: number) {
    if (width === this.width && height === this.height) return;
    const gl = this.gl;
    this.width = width;
    this.height = height;
    gl.canvas.width = width;
    gl.canvas.height = height;
    this.fboW = Math.max(1, Math.round(width * this.scale));
    this.fboH = Math.max(1, Math.round(height * this.scale));

    gl.bindTexture(gl.TEXTURE_2D, this.densityTex);
    let ok = false;
    // Float first for real density accumulation; RGBA8 is the universal floor.
    for (const [internal, type] of [
      [gl.RGBA16F, gl.HALF_FLOAT],
      [gl.RGBA8, gl.UNSIGNED_BYTE],
    ] as const) {
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, this.fboW, this.fboH, 0, gl.RGBA, type, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.densityTex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        ok = true;
        break;
      }
    }
    if (!ok) throw new Error("no renderable colour format for the density buffer");

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  render(
    smoke: Float32Array,
    smokeCount: number,
    embers: Float32Array,
    emberCount: number,
    opts: RenderOptions,
  ) {
    const gl = this.gl;
    if (this.width === 0) return;

    // Pass 1 — accumulate density into the half-res buffer.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.fboW, this.fboH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (smokeCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.smokeProg);
      gl.uniform2f(this.uniforms.smoke.u_res, this.width, this.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sprite);
      gl.uniform1i(this.uniforms.smoke.u_sprite, 0);
      gl.bindVertexArray(this.smokeVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.smokeBuf);
      gl.bufferData(gl.ARRAY_BUFFER, smoke.subarray(0, smokeCount * SMOKE_STRIDE), gl.STREAM_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, smokeCount);
    }

    // Pass 2 — shade it onto the visible canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (smokeCount > 0) {
      const u = this.uniforms.shade;
      const p = opts.palette;
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.shadeProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.densityTex);
      gl.uniform1i(u.u_density, 0);
      gl.uniform2f(u.u_texel, 1 / this.fboW, 1 / this.fboH);
      gl.uniform3fv(u.u_thin, p.thin);
      gl.uniform3fv(u.u_thick, p.thick);
      gl.uniform3fv(u.u_light, p.light);
      gl.uniform3fv(u.u_glow, p.glow);
      gl.uniform1f(u.u_glowAmount, p.glowAmount);
      gl.uniform1f(u.u_opacity, opts.opacity);
      gl.uniform1f(u.u_normal, this.tuning.normal);
      gl.uniform1f(u.u_absorb, this.tuning.absorb);
      gl.uniform1f(u.u_alphaGain, this.tuning.alphaGain);
      gl.uniform1f(u.u_ambient, this.tuning.ambient);
      gl.uniform1f(u.u_diffuse, this.tuning.diffuse);
      gl.uniform1f(u.u_rim, this.tuning.rim);
      if (opts.ember) {
        gl.uniform3f(u.u_emberLight, opts.ember.x / this.width, opts.ember.y / this.height, opts.ember.intensity * 0.5);
      } else {
        gl.uniform3f(u.u_emberLight, 0.5, 0.5, 0);
      }
      gl.uniform3fv(u.u_emberColor, p.ember);
      gl.bindVertexArray(this.shadeVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // Pass 3 — sparks, additive, straight over the top.
    if (emberCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.emberProg);
      gl.uniform2f(this.uniforms.ember.u_res, this.width, this.height);
      gl.uniform3fv(this.uniforms.ember.u_color, opts.palette.ember);
      gl.bindVertexArray(this.emberVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.emberBuf);
      gl.bufferData(gl.ARRAY_BUFFER, embers.subarray(0, emberCount * EMBER_STRIDE), gl.STREAM_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, emberCount);
    }

    gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteProgram(this.smokeProg);
    gl.deleteProgram(this.shadeProg);
    gl.deleteProgram(this.emberProg);
    gl.deleteBuffer(this.quad);
    gl.deleteBuffer(this.smokeBuf);
    gl.deleteBuffer(this.emberBuf);
    gl.deleteTexture(this.sprite);
    gl.deleteTexture(this.densityTex);
    gl.deleteFramebuffer(this.fbo);
  }
}
