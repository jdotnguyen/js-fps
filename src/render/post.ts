import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import type { Settings } from '../core/settings.ts';
import { RENDER_TIERS } from './tiers.ts';

/** Final grade (ADR-0002): chromatic aberration, lift/gain, vignette, film grain, damage tint. */
export interface GradeUniforms {
  [key: string]: THREE.IUniform;
  tDiffuse: THREE.IUniform<THREE.Texture | null>;
  uTime: THREE.IUniform<number>;
  uResolution: THREE.IUniform<THREE.Vector2>;
  uGrain: THREE.IUniform<number>;
  uVignette: THREE.IUniform<number>;
  uAberration: THREE.IUniform<number>;
  uLift: THREE.IUniform<THREE.Vector3>;
  uGain: THREE.IUniform<THREE.Vector3>;
  uDamage: THREE.IUniform<number>;
}

const GRADE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const GRADE_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform vec2 uResolution;
uniform float uGrain;
uniform float uVignette;
uniform float uAberration;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uDamage;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 c = vUv - 0.5;
  vec2 off = c * uAberration * length(c) * 2.0;
  vec3 col;
  col.r = texture2D(tDiffuse, vUv + off).r;
  col.g = texture2D(tDiffuse, vUv).g;
  col.b = texture2D(tDiffuse, vUv - off).b;

  col = col * uGain + uLift;

  // Low health: desaturate and push red at the edges.
  float edge = smoothstep(0.25, 0.75, length(c) * 1.5);
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(luma), uDamage * 0.6);
  col = mix(col, vec3(luma * 1.2, luma * 0.1, luma * 0.08) + vec3(0.02, 0.0, 0.0), uDamage * edge);

  col *= 1.0 - uVignette * smoothstep(0.2, 0.85, length(c) * 1.45);

  float n = hash(vUv * uResolution + fract(uTime) * 100.0) - 0.5;
  col += n * uGrain * (0.25 + luma);
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

export interface Post {
  composer: EffectComposer;
  gtao: GTAOPass;
  bloom: UnrealBloomPass;
  smaa: SMAAPass;
  grade: GradeUniforms;
  setSize(width: number, height: number, pixelRatio: number): void;
  setQuality(quality: Settings['quality']): void;
  render(time: number): void;
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

/** GTAOPass's private visibility hooks around its own depth/normal render (three r175+). */
export interface GtaoVisibilityHooks {
  _overrideVisibility: () => void;
  _restoreVisibility: () => void;
}

/**
 * Hide `skipsAo` meshes while GTAO renders its depth and normals, so they cast no AO, and show them again after.
 * Restores what it hid itself: since r179 GTAOPass's `_restoreVisibility` only re-shows the points and lines
 * it hid, so meshes hidden here would otherwise stay invisible (the gallery glass vanished on High).
 * The hooks are private and untyped (@types/three still names the pre-r175 public method), hence the guard.
 */
export function excludeFromGtao(pass: GtaoVisibilityHooks, scene: THREE.Object3D): void {
  if (typeof pass._overrideVisibility !== 'function' || typeof pass._restoreVisibility !== 'function') {
    throw new Error('GTAOPass visibility hooks are missing; the AO exclusion needs porting');
  }
  const override = pass._overrideVisibility.bind(pass);
  const restore = pass._restoreVisibility.bind(pass);
  const hidden: THREE.Object3D[] = [];
  pass._overrideVisibility = () => {
    override();
    scene.traverse((obj) => {
      if (obj.visible && skipsAo(obj)) {
        obj.visible = false;
        hidden.push(obj);
      }
    });
  };
  pass._restoreVisibility = () => {
    restore();
    for (const obj of hidden) obj.visible = true;
    hidden.length = 0;
  };
}

export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  quality: Settings['quality'],
): Post {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.blendIntensity = 0.9;
  excludeFromGtao(gtao as unknown as GtaoVisibilityHooks, scene);
  composer.addPass(gtao);

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.45, 0.85);
  composer.addPass(bloom);

  const grade: GradeUniforms = {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(size.x, size.y) },
    uGrain: { value: 0.035 },
    uVignette: { value: 0.45 },
    uAberration: { value: 0.004 },
    uLift: { value: new THREE.Vector3(0.002, 0.004, 0.006) },
    uGain: { value: new THREE.Vector3(0.98, 1.0, 1.04) },
    uDamage: { value: 0 },
  };
  // Pass a ShaderMaterial (not a plain object) so ShaderPass keeps our uniform objects.
  composer.addPass(
    new ShaderPass(new THREE.ShaderMaterial({ uniforms: grade, vertexShader: GRADE_VERT, fragmentShader: GRADE_FRAG })),
  );
  composer.addPass(new OutputPass());
  // Edge anti-aliasing last, on the display-referred image (render-quality spec); Low skips it.
  // No size arguments since r175: the composer sizes it in addPass and setSize.
  const smaa = new SMAAPass();
  composer.addPass(smaa);

  const post: Post = {
    composer,
    gtao,
    bloom,
    smaa,
    grade,
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      grade.uResolution.value.set(width * pixelRatio, height * pixelRatio);
    },
    setQuality(q) {
      applyPostTier({ gtao, bloom, smaa }, q);
    },
    render(time) {
      grade.uTime.value = time;
      composer.render();
    },
  };
  post.setQuality(quality);
  return post;
}

/** Turn the tier's post passes on or off (render-quality spec). The composer skips disabled passes. */
export function applyPostTier(passes: { gtao: { enabled: boolean }; bloom: { enabled: boolean }; smaa: { enabled: boolean } }, quality: Settings['quality']): void {
  const tier = RENDER_TIERS[quality];
  passes.gtao.enabled = tier.gtao;
  passes.bloom.enabled = tier.bloom;
  passes.smaa.enabled = tier.smaa;
}
