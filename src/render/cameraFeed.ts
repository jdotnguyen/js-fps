import * as THREE from 'three';
import type { CameraFeedOptions, FeedLook } from '../script/host.ts';
import type { Vec3Like } from '../script/types.ts';

/**
 * Reusable security camera feed (ADR-0023 glimpse, ADR-0014 stinger): the world seen from a
 * point, rendered to a small texture a few times a second and drawn through a CCTV look
 * (scanlines, noise, a cold green tint, a vignette, a label and a blinking REC dot).
 *
 * The sequence action is `cameraFeed { id, from, lookAt, state: live|static|off, fullscreen? }`.
 * A feed shows on every mesh named `feed:<id>` (the `security_monitor` prop's screen) and, with
 * `fullscreen`, over the whole view after the post-processing. Rendering is throttled to each
 * feed's own rate and size (FEED_FPS and FEED_SIZE unless the action sets `fps`/`size`, spec
 * camera-feeds) and only happens while someone can see the feed; `static` and `off` cost only
 * the cheap noise pass.
 *
 * The WebGL work lives behind `FeedDraw` (`cameraFeedGl.ts`) so the state, the throttle and the
 * screen swap are tested headless (`cameraFeed.test.ts`).
 */

export type FeedState = 'live' | 'static' | 'off';

/** Default rendered frames per second of a live feed, and the default size of its texture (16:9). */
export const FEED_FPS = 10;
export const FEED_SIZE = { w: 320, h: 180 } as const;
export const FEED_FOV = 62;

/** What the feed needs to draw; the browser build implements it with the renderer, tests count calls. */
export interface FeedDraw {
  /** Render the world from `camera` into `feed.raw`. */
  scene(feed: Feed, camera: THREE.PerspectiveCamera): void;
  /** Run the CCTV pass: `feed.raw` (or noise, or black) -> `feed.output`. */
  look(feed: Feed, time: number): void;
}

export interface Feed {
  readonly id: string;
  state: FeedState;
  fullscreen: boolean;
  label: string;
  /** Rendered frames per second while live and seen. */
  fps: number;
  /** CCTV look strength (`cameraFeedGl.ts`). */
  look: FeedLook;
  readonly camera: THREE.PerspectiveCamera;
  /** Linear HDR scene colour, before the CCTV look. */
  readonly raw: THREE.WebGLRenderTarget;
  /** What the screens and the overlay show. */
  readonly output: THREE.WebGLRenderTarget;
  /** The material put on `feed:<id>` meshes. */
  readonly screen: THREE.MeshStandardMaterial;
  meshes: THREE.Mesh[];
  /** Original material of the meshes, put back on `dispose`. */
  originals: THREE.Material | THREE.Material[] | null;
  /** Seconds since the last scene render. */
  since: number;
  /** True once a live frame has been drawn. */
  hasFrame: boolean;
  /** The CCTV pass must run once more (the state changed, e.g. to `off`: draw the dark glass). */
  needsLook: boolean;
}

export interface CameraFeedsDeps {
  /** Root to search for `feed:<id>` meshes (the level group, or the scene). */
  root: THREE.Object3D;
  draw: FeedDraw;
  warn?: (message: string) => void;
}

const tmpLook = new THREE.Vector3();
/** Seconds of tolerance on the throttle interval (well under a frame at any display rate). */
const THROTTLE_SLACK = 1e-4;

function isShown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

export class CameraFeeds {
  private readonly d: CameraFeedsDeps;
  private readonly feeds = new Map<string, Feed>();
  private readonly warned = new Set<string>();
  /** Counters for tests and the debug overlay. */
  sceneRenders = 0;
  lookPasses = 0;

  constructor(deps: CameraFeedsDeps) {
    this.d = deps;
  }

  ids(): string[] {
    return [...this.feeds.keys()];
  }

  get(id: string): Feed | undefined {
    return this.feeds.get(id);
  }

  /** The feed currently shown over the whole view, if any. */
  get fullscreen(): Feed | null {
    for (const f of this.feeds.values()) if (f.fullscreen && f.state !== 'off') return f;
    return null;
  }

  /** `SequenceHost.cameraFeed`: create the feed on first use, then set its state and view. */
  apply(id: string, opts: CameraFeedOptions): void {
    const f = this.feeds.get(id) ?? this.create(id);
    f.state = opts.state;
    f.fullscreen = opts.fullscreen;
    if (opts.label !== undefined) f.label = opts.label;
    if (opts.fps !== undefined) f.fps = opts.fps;
    if (opts.look !== undefined) f.look = opts.look;
    if (opts.size && (opts.size.w !== f.raw.width || opts.size.h !== f.raw.height)) {
      f.raw.setSize(opts.size.w, opts.size.h);
      f.output.setSize(opts.size.w, opts.size.h);
      f.camera.aspect = opts.size.w / opts.size.h;
      f.camera.updateProjectionMatrix();
      f.hasFrame = false;
    }
    if (opts.fov !== undefined) {
      f.camera.fov = opts.fov;
      f.camera.updateProjectionMatrix();
    }
    if (opts.from) f.camera.position.set(opts.from.x, opts.from.y, opts.from.z);
    if (opts.lookAt) this.lookAt(f, opts.lookAt);
    // A live feed draws its first frame on the next update, not after a whole interval
    // (a stalled clock: the throttle renders at once and restarts it).
    f.since = Number.POSITIVE_INFINITY;
    f.needsLook = true;
    if (f.meshes.length === 0) this.attach(f);
    if (f.state === 'off') f.hasFrame = false;
  }

  /** Back to nothing on screen (new game): every feed off, no overlay. */
  reset(): void {
    for (const f of this.feeds.values()) {
      f.state = 'off';
      f.fullscreen = false;
      f.hasFrame = false;
      f.needsLook = true;
    }
  }

  /**
   * Per rendered frame, before the world updates (a feed render rebinds lights and room
   * visibility; `world.update` then sets them back for the player's own view).
   *
   * The throttle keeps the time left over past each interval, so a feed holds its rate (a 30 fps
   * feed renders on every second frame at 60 Hz) instead of drifting below it. After a stall (a
   * hitch, an unseen stretch) it renders once and restarts its clock: no catch-up burst.
   */
  update(dt: number, time: number): void {
    for (const f of this.feeds.values()) {
      f.since += dt;
      const interval = 1 / f.fps;
      // A little slack so float sums of frame times (2 x 1/60 against 1/30) never skip a frame.
      if (f.since + THROTTLE_SLACK < interval) continue;
      const seen = f.fullscreen || f.meshes.some(isShown);
      if (!seen) continue;
      f.since -= interval;
      if (f.since >= interval) f.since = 0;
      if (f.state === 'live') {
        this.d.draw.scene(f, f.camera);
        f.hasFrame = true;
        this.sceneRenders++;
      }
      if (f.state !== 'off' || f.needsLook) {
        this.d.draw.look(f, time);
        this.lookPasses++;
        f.needsLook = false;
      }
    }
  }

  dispose(): void {
    for (const f of this.feeds.values()) {
      if (f.originals) for (const m of f.meshes) m.material = f.originals;
      f.raw.dispose();
      f.output.dispose();
      f.screen.dispose();
    }
    this.feeds.clear();
  }

  // ------------------------------------------------------------------ internals

  private lookAt(f: Feed, at: Vec3Like): void {
    f.camera.lookAt(tmpLook.set(at.x, at.y, at.z));
    f.camera.updateMatrixWorld(true);
  }

  private create(id: string): Feed {
    const camera = new THREE.PerspectiveCamera(FEED_FOV, FEED_SIZE.w / FEED_SIZE.h, 0.05, 60);
    const raw = new THREE.WebGLRenderTarget(FEED_SIZE.w, FEED_SIZE.h, { depthBuffer: true, type: THREE.HalfFloatType });
    const output = new THREE.WebGLRenderTarget(FEED_SIZE.w, FEED_SIZE.h, { depthBuffer: false, type: THREE.HalfFloatType });
    for (const rt of [raw, output]) {
      rt.texture.minFilter = THREE.LinearFilter;
      rt.texture.magFilter = THREE.LinearFilter;
    }
    const screen = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: output.texture, emissiveIntensity: 1.25, roughness: 0.25, metalness: 0 });
    screen.name = `feed-screen:${id}`;
    const f: Feed = { id, state: 'off', fullscreen: false, label: '', fps: FEED_FPS, look: 'monitor', camera, raw, output, screen, meshes: [], originals: null, since: 1, hasFrame: false, needsLook: true };
    this.feeds.set(id, f);
    return f;
  }

  /** Put the feed's screen on every `feed:<id>` mesh under the root. */
  private attach(f: Feed): void {
    const name = `feed:${f.id}`;
    const found: THREE.Mesh[] = [];
    this.d.root.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.name === name || o.userData['feed'] === f.id)) found.push(o);
    });
    if (found.length === 0) {
      // A fullscreen-only feed (Priya's stinger) has no monitor: that is fine.
      if (!f.fullscreen && !this.warned.has(f.id)) {
        this.warned.add(f.id);
        (this.d.warn ?? ((m: string) => console.warn(`[feed] ${m}`)))(`no mesh named "${name}"; the feed only shows fullscreen`);
      }
      return;
    }
    f.originals = found[0]!.material;
    for (const m of found) m.material = f.screen;
    f.meshes = found;
  }
}
