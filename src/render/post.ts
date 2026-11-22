import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  Pass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { Settings } from '../core/settings.ts';
import { RENDER_TIERS } from './tiers.ts';

/** Final grade (ADR-0002): chromatic aberration, lift/gain, vignette, film grain, damage tint. */
export interface GradeUniforms {
  uTime: THREE.Uniform<number>;
  uResolution: THREE.Uniform<THREE.Vector2>;
  uGrain: THREE.Uniform<number>;
  uVignette: THREE.Uniform<number>;
  uAberration: THREE.Uniform<number>;
  uLift: THREE.Uniform<THREE.Vector3>;
  uGain: THREE.Uniform<THREE.Vector3>;
  uDamage: THREE.Uniform<number>;
}

/**
 * The grade as a postprocessing `Effect`, run on linear HDR before tone mapping. It reads `inputBuffer` (the
 * frame before this pass's effects) at offsets for the aberration and adds back what earlier effects in the
 * pass (bloom) added, so the glow is graded but not split into colours.
 */
const GRADE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec2 uResolution;
uniform float uGrain;
uniform float uVignette;
uniform float uAberration;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uDamage;

float gradeHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 c = uv - 0.5;
  vec2 off = c * uAberration * length(c) * 2.0;
  vec3 base = texture2D(inputBuffer, uv).rgb;
  vec3 col = vec3(texture2D(inputBuffer, uv + off).r, base.g, texture2D(inputBuffer, uv - off).b);
  col += inputColor.rgb - base;

  col = col * uGain + uLift;

  // Low health: desaturate and push red at the edges.
  float edge = smoothstep(0.25, 0.75, length(c) * 1.5);
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(luma), uDamage * 0.6);
  col = mix(col, vec3(luma * 1.2, luma * 0.1, luma * 0.08) + vec3(0.02, 0.0, 0.0), uDamage * edge);

  col *= 1.0 - uVignette * smoothstep(0.2, 0.85, length(c) * 1.45);

  float n = gradeHash(uv * uResolution + fract(uTime) * 100.0) - 0.5;
  col += n * uGrain * (0.25 + luma);
  outputColor = vec4(max(col, 0.0), inputColor.a);
}`;

/**
 * Build the grade effect. The uniforms `post.grade` hands out are the effect's own objects, so setting
 * `post.grade.uGrain.value` changes the effect. It is not flagged as a convolution: `EffectPass` sorts
 * convolution effects first, which would put the grade before bloom.
 */
export function createGradeEffect(): { effect: Effect; grade: GradeUniforms } {
  const grade: GradeUniforms = {
    uTime: new THREE.Uniform(0),
    uResolution: new THREE.Uniform(new THREE.Vector2(1, 1)),
    uGrain: new THREE.Uniform(0.035),
    uVignette: new THREE.Uniform(0.45),
    uAberration: new THREE.Uniform(0.004),
    uLift: new THREE.Uniform(new THREE.Vector3(0.002, 0.004, 0.006)),
    uGain: new THREE.Uniform(new THREE.Vector3(0.98, 1.0, 1.04)),
    uDamage: new THREE.Uniform(0),
  };
  const effect = new Effect('GradeEffect', GRADE_FRAG, {
    blendFunction: BlendFunction.SRC,
    uniforms: new Map<string, THREE.Uniform>(Object.entries(grade)),
  });
  return { effect, grade };
}

/**
 * Ambient occlusion skips see-through and effect surfaces (post-processing spec): transparent meshes,
 * meshes that do not write depth (light shafts, decals, glass) and meshes flagged `userData.skipGtao`.
 */
export function skipsAo(obj: THREE.Object3D): boolean {
  if (!(obj instanceof THREE.Mesh)) return false;
  if (obj.userData['skipGtao']) return true;
  const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
  return !!mat && (mat.transparent || !mat.depthWrite);
}

/** Points, lines and sprites (dust, debug lines) never feed the AO depth either, as with GTAO. */
function drawnAfterAo(obj: THREE.Object3D): boolean {
  return skipsAo(obj) || (obj as THREE.Points).isPoints === true || (obj as THREE.Line).isLine === true || (obj as THREE.Sprite).isSprite === true;
}

function isDrawable(obj: THREE.Object3D): boolean {
  return (obj as THREE.Mesh).isMesh === true || (obj as THREE.Points).isPoints === true || (obj as THREE.Line).isLine === true || (obj as THREE.Sprite).isSprite === true;
}

/**
 * Splits the frame into the AO scene (solid geometry, drawn first so `n8ao` reads only its depth) and the
 * meshes drawn after AO. An object leaves a render by clearing its layer mask rather than `visible`, so
 * its children keep their own pass and lights stay in both renders. One walk per frame; masks are restored.
 */
export class AoSplit {
  private readonly solid: THREE.Object3D[] = [];
  private readonly solidMasks: number[] = [];
  private readonly after: THREE.Object3D[] = [];
  private readonly afterMasks: number[] = [];

  /** Collect the visible drawables and leave only the AO scene drawable. */
  beginAoScene(scene: THREE.Object3D): void {
    this.end();
    const walk = (obj: THREE.Object3D): void => {
      if (!obj.visible) return;
      if (isDrawable(obj)) {
        if (drawnAfterAo(obj)) {
          this.after.push(obj);
          this.afterMasks.push(obj.layers.mask);
          obj.layers.mask = 0;
        } else {
          this.solid.push(obj);
          this.solidMasks.push(obj.layers.mask);
        }
      }
      for (const child of obj.children) walk(child);
    };
    walk(scene);
  }

  /** Swap to the meshes drawn after AO: they draw again, the AO scene does not. */
  beginAfterAo(): void {
    for (let i = 0; i < this.after.length; i++) this.after[i]!.layers.mask = this.afterMasks[i]!;
    for (const obj of this.solid) obj.layers.mask = 0;
  }

  /** Restore every mask. Safe to call more than once. */
  end(): void {
    for (let i = 0; i < this.solid.length; i++) this.solid[i]!.layers.mask = this.solidMasks[i]!;
    for (let i = 0; i < this.after.length; i++) this.after[i]!.layers.mask = this.afterMasks[i]!;
    this.solid.length = 0;
    this.solidMasks.length = 0;
    this.after.length = 0;
    this.afterMasks.length = 0;
  }
}

/** Renders the scene without the after-AO meshes while AO is on, and remembers the target holding its depth. */
class AoScenePass extends RenderPass {
  target: THREE.WebGLRenderTarget | null = null;
  /** Whether this frame was split (AO on); the depth copy and after-AO passes do nothing otherwise. */
  splitting = false;
  private readonly split: AoSplit;
  private readonly ao: Pass;
  constructor(scene: THREE.Scene, camera: THREE.Camera, split: AoSplit, ao: Pass) {
    super(scene, camera);
    this.split = split;
    this.ao = ao;
  }
  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget, deltaTime?: number, stencilTest?: boolean): void {
    this.target = inputBuffer;
    // Split only while AO runs (the tier or the debug toggle); otherwise everything draws here once.
    this.splitting = this.ao.enabled;
    if (this.splitting) this.split.beginAoScene(this.scene);
    super.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest);
  }
}

/**
 * Copies the AO scene's depth into the buffer `n8ao` wrote, which has its own (stale) depth after the swap,
 * so the after-AO meshes are hidden behind walls. Same blit as postprocessing's own stable-depth copy.
 */
class DepthCopyPass extends Pass {
  private readonly source: AoScenePass;
  constructor(source: AoScenePass) {
    super('DepthCopyPass');
    this.source = source;
    this.needsSwap = false;
  }
  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget): void {
    const src = this.source.target;
    if (!this.source.splitting || src === null || src === inputBuffer) return;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    renderer.setRenderTarget(inputBuffer);
    const props = renderer.properties;
    const srcFbo = (props.get(src) as { __webglFramebuffer: WebGLFramebuffer }).__webglFramebuffer;
    const dstFbo = (props.get(inputBuffer) as { __webglFramebuffer: WebGLFramebuffer }).__webglFramebuffer;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFbo);
    gl.blitFramebuffer(0, 0, src.width, src.height, 0, 0, inputBuffer.width, inputBuffer.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    renderer.setRenderTarget(null);
  }
}

/** Draws only the after-AO meshes over the AO'd frame, depth-tested against the AO scene, then restores the split. */
class AfterAoPass extends RenderPass {
  private readonly split: AoSplit;
  private readonly source: AoScenePass;
  constructor(scene: THREE.Scene, camera: THREE.Camera, split: AoSplit, source: AoScenePass) {
    super(scene, camera);
    this.split = split;
    this.source = source;
    this.clear = false;
    this.ignoreBackground = true;
    this.skipShadowMapUpdate = true;
    this.needsDepthBlit = false;
  }
  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget, deltaTime?: number, stencilTest?: boolean): void {
    if (!this.source.splitting) return;
    this.split.beginAfterAo();
    try {
      super.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest);
    } finally {
      this.split.end();
    }
  }
}

/** The merged bloom + grade + tone mapping pass. Its effect list is rebuilt when bloom turns on or off. */
class GradePass extends EffectPass {
  bloomOn: boolean | null = null;
  setEffectList(effects: Effect[]): void {
    this.setEffects(effects);
    this.recompile();
  }
}

export interface Post {
  composer: EffectComposer;
  /** Ambient occlusion, High only. */
  ao: N8AOPostPass;
  bloom: BloomEffect;
  smaa: EffectPass;
  grade: GradeUniforms;
  setSize(width: number, height: number, pixelRatio: number): void;
  setQuality(quality: Settings['quality']): void;
  render(time: number): void;
  /** Free the chain's render targets and materials (session teardown). */
  dispose(): void;
}

export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  quality: Settings['quality'],
): Post {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const split = new AoSplit();

  const ao = new N8AOPostPass(scene, camera, size.x, size.y);
  ao.setQualityMode('Medium');
  ao.autoDetectTransparency = false; // our split already keeps see-through meshes out of its depth
  ao.configuration.transparencyAware = false;
  // Tuned against the r187 GTAOPass frames (design.md, 3.6).
  ao.configuration.aoRadius = 1;
  ao.configuration.distanceFalloff = 1;
  ao.configuration.intensity = 1;

  const aoScene = new AoScenePass(scene, camera, split, ao);
  const depthCopy = new DepthCopyPass(aoScene);
  const afterAo = new AfterAoPass(scene, camera, split, aoScene);

  // Matched to UnrealBloomPass (strength 0.55, radius 0.45, threshold 0.85) by frame comparison (design.md, 3.6).
  const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.85, intensity: 4, radius: 0.85 });
  const { effect: gradeEffect, grade } = createGradeEffect();
  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const main = new GradePass(camera, bloom, gradeEffect, toneMapping);
  main.bloomOn = true;
  // Edge anti-aliasing on the tone-mapped image (render-quality spec); Low skips it.
  const smaa = new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM }));

  composer.addPass(aoScene);
  composer.addPass(ao);
  composer.addPass(depthCopy);
  composer.addPass(afterAo);
  composer.addPass(main);
  composer.addPass(smaa);

  const post: Post = {
    composer,
    ao,
    bloom,
    smaa,
    grade,
    setSize(width, height, pixelRatio) {
      composer.setSize(width, height);
      grade.uResolution.value.set(width * pixelRatio, height * pixelRatio);
    },
    setQuality(q) {
      applyPostTier({ ao, smaa, main, effects: { bloom, grade: gradeEffect, toneMapping } }, q);
    },
    render(time) {
      grade.uTime.value = time;
      // The chain tone-maps in ToneMappingEffect (which still applies renderer.toneMappingExposure), so the
      // renderer must not tone-map the final draw too. Other screen renders (camera feeds) keep ACES.
      const toneMappingMode = renderer.toneMapping;
      renderer.toneMapping = THREE.NoToneMapping;
      try {
        composer.render();
      } finally {
        split.end();
        renderer.toneMapping = toneMappingMode;
      }
    },
    dispose() {
      split.end();
      composer.dispose(); // every pass, and each EffectPass's current effects
      bloom.dispose(); // not in the merged pass's list on Low
    },
  };
  // The composer sized its buffers from the renderer; only the grain's resolution needs setting here.
  grade.uResolution.value.copy(size);
  post.setQuality(quality);
  return post;
}

/** What a tier switch touches: the AO pass, the SMAA pass and the merged pass's effect list. */
export interface PostTierTargets {
  ao: { enabled: boolean };
  smaa: { enabled: boolean; renderToScreen: boolean };
  main: { renderToScreen: boolean; bloomOn: boolean | null; setEffectList(effects: Effect[]): void };
  effects: { bloom: Effect; grade: Effect; toneMapping: Effect };
}

/**
 * Follow the tier (render-quality spec): AO on High, bloom and SMAA on Medium and High. Bloom lives in the
 * merged pass, so turning it on or off rebuilds that pass's effects (one recompile, only when it changes).
 * The last enabled pass draws to the screen.
 */
export function applyPostTier(t: PostTierTargets, quality: Settings['quality']): void {
  const tier = RENDER_TIERS[quality];
  t.ao.enabled = tier.gtao;
  t.smaa.enabled = tier.smaa;
  t.smaa.renderToScreen = true;
  t.main.renderToScreen = !tier.smaa;
  if (t.main.bloomOn !== tier.bloom) {
    const { bloom, grade, toneMapping } = t.effects;
    t.main.setEffectList(tier.bloom ? [bloom, grade, toneMapping] : [grade, toneMapping]);
    t.main.bloomOn = tier.bloom;
  }
}
