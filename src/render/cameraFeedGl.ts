import * as THREE from 'three';
import { FEED_SIZE, type Feed, type FeedDraw } from './cameraFeed.ts';

/**
 * The WebGL half of the security camera feed (`cameraFeed.ts`): renders the scene from the
 * feed's camera into its raw target, runs the CCTV pass into its output target, and draws a
 * fullscreen feed over the finished frame. Everything here needs a GL context, so it is not
 * unit tested; the pass is small and guarded so a driver problem disables feeds instead of
 * the game (`failed`).
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tRaw;
uniform sampler2D tLabel;
uniform float uTime;
uniform float uMode; // 0 live, 1 static, 2 off
uniform vec2 uRes;
uniform vec3 uTint;
// The look's strength (LOOKS): auto gain, colour kept, grain, scanline depth (0: the overlay
// draws them at screen resolution instead), vignette darkening at the corners.
uniform float uGain;
uniform float uColour;
uniform float uNoise;
uniform float uScan;
uniform float uVignette;
uniform float uGamma; // > 1 deepens the blacks (contrast); 1 leaves the picture as is
uniform float uInset; // REC dot moved down by this fraction of the height (clear of the cinematic bars)
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 uv = vUv;
  if (uMode > 1.5) {
    gl_FragColor = vec4(0.004, 0.006, 0.005, 1.0);
    return;
  }
  float n = hash(floor(uv * uRes) + fract(uTime * 0.37) * 713.0);
  vec3 col;
  if (uMode > 0.5) {
    // Static: grain, with the odd horizontal tear.
    float tear = step(0.96, hash(vec2(floor(uv.y * 36.0), floor(uTime * 12.0))));
    col = vec3(0.08 + 0.55 * n + 0.3 * tear * hash(vec2(uv.y, uTime)));
  } else {
    // A flaky signal now and then: a horizontal wobble.
    float glitch = step(0.97, hash(vec2(floor(uTime * 3.0), 1.0)));
    float wob = (hash(vec2(floor(uv.y * 90.0), floor(uTime * 15.0))) - 0.5) * 0.01 * glitch;
    vec3 c = texture2D(tRaw, vec2(uv.x + wob, uv.y)).rgb;
    c = c / (1.0 + c * 0.6); // soft shoulder
    c *= uGain; // the camera's auto gain lifts a dark room
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), c, uColour);
    if (uGamma != 1.0) col = pow(max(col, 0.0), vec3(uGamma));
    col += (n - 0.5) * uNoise;
  }
  col *= uTint;
  col *= (1.0 - uScan) + uScan * sin(uv.y * uRes.y * 3.14159); // scanlines
  vec2 q = uv - 0.5;
  col *= 1.0 - uVignette * smoothstep(0.3, 0.75, length(q * vec2(1.0, 1.15))); // vignette
  vec4 lab = texture2D(tLabel, uv);
  col = mix(col, lab.rgb, lab.a);
  vec2 d = (uv - vec2(0.93, 0.89 - uInset)) * vec2(1.78, 1.0);
  float rec = step(0.0, sin(uTime * 3.2));
  col = mix(col, vec3(1.0, 0.08, 0.05), rec * step(length(d), 0.022));
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * The look's strength per feed `look` (camera-feeds spec). `monitor` is the original CCTV look for
 * small in-world screens and must not change. `fullscreen` is gentler, because every flaw is
 * magnified over the whole view: less gain and grain, more colour, a lighter vignette, and its
 * scanlines are drawn by the overlay at screen resolution (OVERLAY_SCAN), not into the texture.
 */
export const LOOKS = {
  monitor: { gain: 2.2, colour: 0.2, noise: 0.1, scan: 0.16, vignette: 0.9, gamma: 1, labelScale: 1, inset: 0 },
  // `inset`: caption and REC dot sit below the 11vh cinematic bars the stinger runs under.
  fullscreen: { gain: 1.5, colour: 0.45, noise: 0.05, scan: 0, vignette: 0.55, gamma: 1.3, labelScale: 0.5, inset: 0.13 },
} as const;

/** Fullscreen scanlines: depth, and screen pixels per line (clamped by the view's height). */
export const OVERLAY_SCAN = { depth: 0.12, minPitch: 2, maxPitch: 4, linesPerView: 360 } as const;

/** Screen pixels between fullscreen scanlines for a drawing buffer `height` pixels tall. */
export function scanPitch(height: number): number {
  return Math.min(OVERLAY_SCAN.maxPitch, Math.max(OVERLAY_SCAN.minPitch, height / OVERLAY_SCAN.linesPerView));
}

const OVERLAY_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const OVERLAY_FRAG = /* glsl */ `
uniform sampler2D tFeed;
uniform float uScan;
uniform float uPitch;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tFeed, vUv).rgb;
  c *= (1.0 - uScan) + uScan * (0.5 + 0.5 * sin(gl_FragCoord.y * 6.2831853 / uPitch));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export interface FeedGl extends FeedDraw {
  /**
   * Draw `feed` over the whole view; null does nothing. After post-processing it draws over the
   * finished frame. With `alone`, the player's view was not rendered this frame (the feed
   * replaces it), so the overlay clears the screen first.
   */
  overlay(feed: Feed | null, alone?: boolean): void;
  /** Set when a GL error stopped the feeds; they stay dark. */
  readonly failed: boolean;
  /** Pre-compile CCTV look and fullscreen overlay shaders during session loading. */
  warm(): void;
  dispose(): void;
}

export interface FeedGlDeps {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /**
   * Run `draw` with the level set up to be seen from `eye` (rooms visible, lights bound), e.g.
   * `Level.renderFromEye`. Without a level, `draw` runs as is.
   */
  view?: ((eye: THREE.Vector3, draw: () => void, camera?: THREE.Camera) => void) | null;
  warn?: (message: string) => void;
}

export function createFeedGl(d: FeedGlDeps): FeedGl {
  const { renderer, scene } = d;
  const labels = new Map<string, THREE.CanvasTexture>();
  const empty = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  empty.needsUpdate = true;
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      tRaw: { value: null },
      tLabel: { value: empty },
      uTime: { value: 0 },
      uMode: { value: 0 },
      uRes: { value: new THREE.Vector2(FEED_SIZE.w, FEED_SIZE.h) },
      uTint: { value: new THREE.Vector3(0.62, 1.0, 0.72) },
      uGain: { value: LOOKS.monitor.gain },
      uColour: { value: LOOKS.monitor.colour },
      uNoise: { value: LOOKS.monitor.noise },
      uScan: { value: LOOKS.monitor.scan },
      uVignette: { value: LOOKS.monitor.vignette },
      uGamma: { value: LOOKS.monitor.gamma },
      uInset: { value: LOOKS.monitor.inset },
    },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const passScene = new THREE.Scene();
  passScene.add(quad);
  const passCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // Fullscreen overlay: the finished texture on a quad that covers the view (cropped, never stretched).
  // A small shader (not MeshBasicMaterial) so a fullscreen look can lay its scanlines at screen
  // resolution; `colorspace_fragment` keeps the same output encoding MeshBasicMaterial had.
  const overlayMat = new THREE.ShaderMaterial({
    vertexShader: OVERLAY_VERT,
    fragmentShader: OVERLAY_FRAG,
    uniforms: { tFeed: { value: null }, uScan: { value: 0 }, uPitch: { value: 3 } },
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
  });
  const overlayQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), overlayMat);
  overlayQuad.frustumCulled = false;
  const overlayScene = new THREE.Scene();
  overlayScene.add(overlayQuad);
  const size = new THREE.Vector2();

  let failed = false;
  const fail = (err: unknown): void => {
    failed = true;
    renderer.setRenderTarget(null);
    (d.warn ?? ((m: string) => console.warn(`[feed] ${m}`)))(`camera feeds disabled: ${String(err)}`);
  };

  /**
   * The caption at the feed's own size, laid out as on a 320x180 feed and scaled up (sharp at any
   * size), times `scale` (a fullscreen look halves it: over the whole view it would be huge).
   */
  const labelTexture = (text: string, w: number, h: number, scale: number, inset: number): THREE.Texture => {
    if (!text || typeof document === 'undefined') return empty;
    const key = `${w}x${h}x${scale}x${inset}|${text}`;
    let t = labels.get(key);
    if (t) return t;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const k = (h / FEED_SIZE.h) * scale;
      ctx.translate(0, inset * h);
      ctx.scale(k, k);
      ctx.font = 'bold 15px ui-monospace, Menlo, Consolas, monospace';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(8, 8, ctx.measureText(text).width + 14, 22);
      ctx.fillStyle = '#c9ffd6';
      ctx.fillText(text, 15, 12);
    }
    t = new THREE.CanvasTexture(canvas);
    labels.set(key, t);
    return t;
  };

  return {
    get failed() {
      return failed;
    },
    scene(feed, camera) {
      if (failed) return;
      try {
        const draw = (): void => {
          renderer.setRenderTarget(feed.raw);
          renderer.clear();
          renderer.render(scene, camera);
        };
        if (d.view) d.view(camera.position, draw, camera);
        else draw();
        renderer.setRenderTarget(null);
      } catch (err) {
        fail(err);
      }
    },
    look(feed, time) {
      if (failed) return;
      try {
        const u = material.uniforms as Record<string, THREE.IUniform>;
        const w = feed.output.width;
        const h = feed.output.height;
        const look = LOOKS[feed.look];
        u['tRaw']!.value = feed.raw.texture;
        u['tLabel']!.value = labelTexture(feed.label, w, h, look.labelScale, look.inset);
        u['uInset']!.value = look.inset;
        u['uTime']!.value = time;
        u['uMode']!.value = feed.state === 'live' ? 0 : feed.state === 'static' ? 1 : 2;
        (u['uRes']!.value as THREE.Vector2).set(w, h);
        u['uGain']!.value = look.gain;
        u['uColour']!.value = look.colour;
        u['uNoise']!.value = look.noise;
        u['uScan']!.value = look.scan;
        u['uVignette']!.value = look.vignette;
        u['uGamma']!.value = look.gamma;
        renderer.setRenderTarget(feed.output);
        renderer.render(passScene, passCam);
        renderer.setRenderTarget(null);
      } catch (err) {
        fail(err);
      }
    },
    overlay(feed, alone = false) {
      if (!feed || failed) return;
      try {
        renderer.getDrawingBufferSize(size);
        const screenAspect = size.x / Math.max(1, size.y);
        const feedAspect = feed.output.width / Math.max(1, feed.output.height);
        // Cover: scale up on the short axis so the picture fills the view.
        overlayQuad.scale.set(screenAspect > feedAspect ? 1 : feedAspect / screenAspect, screenAspect > feedAspect ? screenAspect / feedAspect : 1, 1);
        const u = overlayMat.uniforms as Record<string, THREE.IUniform>;
        u['tFeed']!.value = feed.output.texture;
        u['uScan']!.value = feed.look === 'fullscreen' ? OVERLAY_SCAN.depth : 0;
        u['uPitch']!.value = scanPitch(size.y);
        const auto = renderer.autoClear;
        renderer.autoClear = false;
        renderer.setRenderTarget(null);
        if (alone) renderer.clear();
        else renderer.clearDepth();
        renderer.render(overlayScene, passCam);
        renderer.autoClear = auto;
      } catch (err) {
        fail(err);
      }
    },
    warm() {
      if (failed) return;
      try {
        // Each pass compiles for where it draws: the look into a feed's target (a different program from the
        // screen's), the overlay onto the screen.
        const target = new THREE.WebGLRenderTarget(1, 1);
        renderer.setRenderTarget(target);
        renderer.compile(passScene, passCam);
        renderer.setRenderTarget(null);
        target.dispose();
        renderer.compile(overlayScene, passCam);
      } catch (err) {
        fail(err);
      }
    },
    dispose() {
      material.dispose();
      overlayMat.dispose();
      for (const t of labels.values()) t.dispose();
    },
  };
}
