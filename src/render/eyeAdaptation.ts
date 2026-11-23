import * as THREE from 'three';
import { Pass } from 'postprocessing';

/**
 * Eye adaptation (openspec change room-light-response, post-processing spec "Eye adaptation", design D6). The scene's
 * HDR colour is measured each frame as a centre-weighted mean log luminance; a gate drops changes that do not last
 * (muzzle flashes, sparks, a flicker's peaks); the result is clamped to the exposure range and then followed slowly,
 * faster toward brighter views than darker ones. The grade multiplies by `key / adapted` before tone mapping.
 * Everything lives on the GPU in a 1×1 state texture, so nothing is read back.
 *
 * `stepAdaptation` is the same filter on the CPU: the tests run it, and the shader below must match it.
 */

/** Lowest and highest exposure multiplier (design D6): dark rooms stay dark, bright ones are never crushed. */
export const ADAPT_MIN = 0.7;
export const ADAPT_MAX = 1.6;
/** Neutral luminance: the Commons and R03 at High sit at a multiplier of about 1.0 (calibrated in task 5.3). */
export const ADAPT_KEY = 0.058;
/** Time constant (s) of the fast stage that follows the measurement. */
export const TAU_FOLLOW = 0.05;
/** A change bigger than this (stops) must last `GATE_SECONDS` before the slow stage sees it. */
export const GATE_STOPS = 0.25;
export const GATE_SECONDS = 0.25;
/** After a rejected change, the slow stage waits until the measurement is back within this (stops) of what it had. */
export const GATE_SETTLE = 0.05;
/** Slow stage time constants (s): toward darker views (eyes opening) and toward brighter ones. 90% settles in ~2.3 τ. */
export const TAU_DARKER = 1.1;
export const TAU_BRIGHTER = 0.3;

/** The filter's state, all in log2 luminance except `held` (seconds). */
export interface AdaptState {
  /** Follows the measurement quickly. */
  follow: number;
  /** What the slow stage aims for: `follow` once a big change has lasted the gate time. */
  accepted: number;
  /** Seconds `follow` has differed from `accepted` by more than the gate; −1 while a rejected change dies away. */
  held: number;
  /** The adapted level. */
  adapted: number;
}

/** Start the filter settled on a measurement. */
export function initialAdaptState(logLum: number, key = ADAPT_KEY): AdaptState {
  const clamped = clampToRange(logLum, key);
  return { follow: logLum, accepted: logLum, held: 0, adapted: clamped };
}

const clampToRange = (logLum: number, key: number): number => Math.min(Math.max(logLum, Math.log2(key / ADAPT_MAX)), Math.log2(key / ADAPT_MIN));

/** One frame of the filter (`logLum`: this frame's measurement, log2). */
export function stepAdaptation(s: AdaptState, logLum: number, dt: number, key = ADAPT_KEY): AdaptState {
  const follow = s.follow + (logLum - s.follow) * (1 - Math.exp(-dt / TAU_FOLLOW));
  let accepted = s.accepted;
  let held = 0;
  const d = Math.abs(follow - accepted);
  if (d > GATE_STOPS) {
    held = Math.max(s.held, 0) + dt;
    if (held >= GATE_SECONDS) {
      accepted = follow;
      held = 0;
    }
  } else if (s.held !== 0 && d > GATE_SETTLE) held = -1; // a flash dying away: its tail is not let through
  else accepted = follow;
  const target = clampToRange(accepted, key);
  const tau = target < s.adapted ? TAU_DARKER : TAU_BRIGHTER;
  const adapted = s.adapted + (target - s.adapted) * (1 - Math.exp(-dt / tau));
  return { follow, accepted, held, adapted };
}

/** The grade's exposure multiplier for an adapted level. */
export function adaptMultiplier(adaptedLog: number, key = ADAPT_KEY): number {
  return Math.min(Math.max(key / Math.pow(2, adaptedLog), ADAPT_MIN), ADAPT_MAX);
}

// ---------------------------------------------------------------- GPU

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

/** Log2 luminance of the HDR frame, into a small mipmapped target. */
const MEASURE_FRAG = /* glsl */ `
uniform sampler2D inputBuffer;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(inputBuffer, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(log2(max(l, 1e-4)), 0.0, 0.0, 1.0);
}`;

/** One frame of `stepAdaptation` on the GPU: reads the previous state, writes the next (R adapted, G follow, B accepted, A held). */
const STATE_FRAG = /* glsl */ `
uniform sampler2D measure;
uniform sampler2D previous;
uniform float lod;
uniform float dt;
uniform float key;
uniform float reset;
varying vec2 vUv;

float minLog() { return log2(key / ${ADAPT_MAX.toFixed(4)}); }
float maxLog() { return log2(key / ${ADAPT_MIN.toFixed(4)}); }

void main() {
  // Centre-weighted mean log luminance: the centre counts double the four quadrant samples.
  float m = 2.0 * textureLod(measure, vec2(0.5), lod).r;
  m += textureLod(measure, vec2(0.25, 0.25), lod).r + textureLod(measure, vec2(0.75, 0.25), lod).r;
  m += textureLod(measure, vec2(0.25, 0.75), lod).r + textureLod(measure, vec2(0.75, 0.75), lod).r;
  m /= 6.0;
  vec4 s = texture2D(previous, vec2(0.5));
  if (reset > 0.5) {
    gl_FragColor = vec4(clamp(m, minLog(), maxLog()), m, m, 0.0);
    return;
  }
  float follow = s.g + (m - s.g) * (1.0 - exp(-dt / ${TAU_FOLLOW.toFixed(4)}));
  float accepted = s.b;
  float held = 0.0;
  float d = abs(follow - accepted);
  if (d > ${GATE_STOPS.toFixed(4)}) {
    held = max(s.a, 0.0) + dt;
    if (held >= ${GATE_SECONDS.toFixed(4)}) { accepted = follow; held = 0.0; }
  } else if (s.a != 0.0 && d > ${GATE_SETTLE.toFixed(4)}) held = -1.0;
  else accepted = follow;
  float target = clamp(accepted, minLog(), maxLog());
  float tau = target < s.r ? ${TAU_DARKER.toFixed(4)} : ${TAU_BRIGHTER.toFixed(4)};
  float adapted = s.r + (target - s.r) * (1.0 - exp(-dt / tau));
  gl_FragColor = vec4(adapted, follow, accepted, held);
}`;

/** Measurement target size: small enough to be cheap, mipmapped so the state pass reads an 8×8 average. */
const MEASURE_SIZE = 64;

/** Uniforms the grade reads (see `post.ts`). */
export interface AdaptUniforms {
  /** The 1×1 state; R is the adapted log2 luminance. */
  uAdaptState: THREE.Uniform<THREE.Texture | null>;
  uAdaptKey: THREE.Uniform<number>;
  /** 1 applies the multiplier; 0 forces 1.0 (Settings "Eye adaptation" off). */
  uAdaptOn: THREE.Uniform<number>;
}

export function createAdaptUniforms(): AdaptUniforms {
  return { uAdaptState: new THREE.Uniform(null), uAdaptKey: new THREE.Uniform(ADAPT_KEY), uAdaptOn: new THREE.Uniform(1) };
}

/**
 * Measures the frame and advances the state. It draws nothing to the chain's buffers (`needsSwap` false); put it
 * after the scene render and before the grade.
 */
export class EyeAdaptationPass extends Pass {
  /** Seconds since the last frame; set by `post.render`. */
  dt = 1 / 60;
  private readonly uniforms: AdaptUniforms;
  private readonly measure: THREE.WebGLRenderTarget;
  private readonly states: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly measureMat: THREE.ShaderMaterial;
  private readonly stateMat: THREE.ShaderMaterial;
  private current = 0;
  private needsReset = true;

  constructor(uniforms: AdaptUniforms) {
    super('EyeAdaptationPass');
    this.needsSwap = false;
    this.uniforms = uniforms;
    this.measure = new THREE.WebGLRenderTarget(MEASURE_SIZE, MEASURE_SIZE, {
      type: THREE.HalfFloatType,
      format: THREE.RedFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    // Full floats: the slow stage moves by under a thousandth of a stop per frame, below half-float precision.
    const state = (): THREE.WebGLRenderTarget =>
      new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
    this.states = [state(), state()];
    this.measureMat = new THREE.ShaderMaterial({ name: 'EyeAdaptMeasure', vertexShader: FULLSCREEN_VERT, fragmentShader: MEASURE_FRAG, uniforms: { inputBuffer: { value: null } }, depthTest: false, depthWrite: false });
    this.stateMat = new THREE.ShaderMaterial({
      name: 'EyeAdaptState',
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: STATE_FRAG,
      uniforms: {
        measure: { value: this.measure.texture },
        previous: { value: null },
        lod: { value: Math.log2(MEASURE_SIZE / 8) },
        dt: { value: 1 / 60 },
        key: { value: uniforms.uAdaptKey.value },
        reset: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    uniforms.uAdaptState.value = this.states[0].texture;
  }

  /** Settle on the next frame's view (a new level, or adaptation switched back on). */
  reset(): void {
    this.needsReset = true;
  }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget): void {
    this.measureMat.uniforms['inputBuffer']!.value = inputBuffer.texture;
    this.fullscreenMaterial = this.measureMat;
    renderer.setRenderTarget(this.measure);
    renderer.render(this.scene, this.camera);

    const prev = this.states[this.current]!;
    const next = this.states[1 - this.current]!;
    const u = this.stateMat.uniforms;
    u['previous']!.value = prev.texture;
    u['dt']!.value = Math.min(Math.max(this.dt, 0), 0.1);
    u['key']!.value = this.uniforms.uAdaptKey.value;
    u['reset']!.value = this.needsReset ? 1 : 0;
    this.needsReset = false;
    this.fullscreenMaterial = this.stateMat;
    renderer.setRenderTarget(next);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
    this.current = 1 - this.current;
    this.uniforms.uAdaptState.value = next.texture;
  }

  override dispose(): void {
    this.measure.dispose();
    this.states[0].dispose();
    this.states[1].dispose();
    this.measureMat.dispose();
    this.stateMat.dispose();
    super.dispose();
  }
}
