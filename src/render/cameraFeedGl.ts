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
    c *= 2.2; // the camera's auto gain lifts a dark room
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), c, 0.2) + (n - 0.5) * 0.1;
  }
  col *= uTint;
  col *= 0.84 + 0.16 * sin(uv.y * uRes.y * 3.14159); // scanlines
  vec2 q = uv - 0.5;
  col *= 1.0 - 0.9 * smoothstep(0.3, 0.75, length(q * vec2(1.0, 1.15))); // vignette
  vec4 lab = texture2D(tLabel, uv);
  col = mix(col, lab.rgb, lab.a);
  vec2 d = (uv - vec2(0.93, 0.89)) * vec2(1.78, 1.0);
  float rec = step(0.0, sin(uTime * 3.2));
  col = mix(col, vec3(1.0, 0.08, 0.05), rec * step(length(d), 0.022));
  gl_FragColor = vec4(col, 1.0);
}`;

export interface FeedGl extends FeedDraw {
  /** Draw `feed` over the whole view after post-processing; null does nothing. */
  overlay(feed: Feed | null): void;
  /** Set when a GL error stopped the feeds; they stay dark. */
  readonly failed: boolean;
  dispose(): void;
}

export interface FeedGlDeps {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /**
   * Run `draw` with the level set up to be seen from `eye` (rooms visible, lights bound), e.g.
   * `Level.renderFromEye`. Without a level, `draw` runs as is.
   */
  view?: ((eye: THREE.Vector3, draw: () => void) => void) | null;
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
  const overlayMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, depthTest: false, depthWrite: false });
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

  const labelTexture = (text: string): THREE.Texture => {
    if (!text || typeof document === 'undefined') return empty;
    let t = labels.get(text);
    if (t) return t;
    const canvas = document.createElement('canvas');
    canvas.width = FEED_SIZE.w;
    canvas.height = FEED_SIZE.h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = 'bold 15px ui-monospace, Menlo, Consolas, monospace';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(8, 8, ctx.measureText(text).width + 14, 22);
      ctx.fillStyle = '#c9ffd6';
      ctx.fillText(text, 15, 12);
    }
    t = new THREE.CanvasTexture(canvas);
    labels.set(text, t);
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
        if (d.view) d.view(camera.position, draw);
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
        u['tRaw']!.value = feed.raw.texture;
        u['tLabel']!.value = labelTexture(feed.label);
        u['uTime']!.value = time;
        u['uMode']!.value = feed.state === 'live' ? 0 : feed.state === 'static' ? 1 : 2;
        renderer.setRenderTarget(feed.output);
        renderer.render(passScene, passCam);
        renderer.setRenderTarget(null);
      } catch (err) {
        fail(err);
      }
    },
    overlay(feed) {
      if (!feed || failed) return;
      try {
        renderer.getSize(size);
        const screenAspect = size.x / Math.max(1, size.y);
        const feedAspect = FEED_SIZE.w / FEED_SIZE.h;
        // Cover: scale up on the short axis so the picture fills the view.
        overlayQuad.scale.set(screenAspect > feedAspect ? 1 : feedAspect / screenAspect, screenAspect > feedAspect ? screenAspect / feedAspect : 1, 1);
        if (overlayMat.map !== feed.output.texture) {
          overlayMat.map = feed.output.texture;
          overlayMat.needsUpdate = true;
        }
        const auto = renderer.autoClear;
        renderer.autoClear = false;
        renderer.setRenderTarget(null);
        renderer.clearDepth();
        renderer.render(overlayScene, passCam);
        renderer.autoClear = auto;
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
