/**
 * What the interpreter needs from the game (ADR-0009). Everything beyond `events`,
 * `flags` and `resolve` is optional, so the interpreter runs headless in tests and
 * actions whose system does not exist yet (NPCs, glass, water: ADR-0006/0011) degrade to
 * a one-time warning instead of failing the sequence.
 */
import type { Scalar, Flags, TargetRef, Vec3Like } from './types.ts';

/** The event bus with string names: sequences use names that come from JSON. */
export interface LooseBus {
  on(name: string, fn: (payload: unknown) => void): () => void;
  emit(name: string, payload?: unknown): void;
}

export interface ControlOverride {
  move?: 'free' | 'slow' | 'locked';
  look?: 'free' | 'clamped' | 'locked';
  weapons?: boolean;
  flashlight?: boolean;
  interact?: boolean;
}

/** Where to put the player. `y` is the feet height; omitted keeps the current floor. */
export interface PlaceTarget {
  x: number;
  y: number | undefined;
  z: number;
}

export interface CameraFeedOptions {
  state: 'live' | 'static' | 'off';
  /** Camera position and the point it looks at; null keeps the last ones. */
  from: Vec3Like | null;
  lookAt: Vec3Like | null;
  /** Show the feed over the whole screen instead of (or as well as) on the `feed:<id>` mesh. */
  fullscreen: boolean;
  /** Top-left caption, e.g. "CAM 07  SECURITY OFFICE". */
  label?: string;
  fov?: number;
  /** Rendered frames per second (camera-feeds spec); a feed that never sets it renders at 10. */
  fps?: number;
  /** Render size in pixels; a feed that never sets it renders at 320x180. */
  size?: { w: number; h: number };
  /** CCTV look strength: `monitor` (default) for in-world screens, `fullscreen` for a feed over the whole view. */
  look?: FeedLook;
}

export type FeedLook = 'monitor' | 'fullscreen';

export interface SpeechLike {
  done: Promise<unknown>;
}

/** How a scripted shot's mouse give behaves (intro-sequence spec). */
export interface FrameOptions {
  /** Seconds the give stays where the mouse left it before springing back. Default 0. */
  hold?: number;
  /** Spring-back time constant, seconds. Default about 0.12 (settles in ~0.4 s). */
  returnTime?: number;
}

export interface SequenceHost {
  events: LooseBus;
  /** The playthrough's flags (ADR-0016 saves them). A getter: loading replaces the object. */
  flags: Flags;
  /** Replace the flags wholesale (checkpoint restore). */
  setFlags?(flags: Flags): void;
  /** Resolve a target to a world position, or null if it does not exist. */
  resolve(target: TargetRef): Vec3Like | null;
  warn(message: string): void;

  /** Push a control layer; returns its release function. */
  pushControl?(over: ControlOverride, owner: string): () => void;
  lookAt?(at: Vec3Like, duration: number, weight: number): void;
  clampLook?(at: Vec3Like | null, degrees: number): void;
  /** Scripted shot (intro-sequence spec): hold the view on `at` with `give` degrees of mouse give; null releases. */
  frame?(at: Vec3Like | null, duration: number, give: number, follow?: () => Vec3Like | null, opts?: FrameOptions): void;
  /** Heading shot (intro-sequence spec): face along Jay's scripted walk with `give` degrees of leeway. Released by `frame(null)`. */
  frameHeading?(duration: number, give: number, opts?: FrameOptions): void;
  /**
   * Who to look at while `speaker` (a dialogue speaker id such as `medic` or `crew_ruiz`) talks:
   * an `npc:<id>` target, or null for Jay and anyone without a body in the scene. Used by the
   * `playerFrame` "speaker" shot; without it that shot never leaves its initial aim.
   */
  speakerTarget?(speaker: string): TargetRef | null;
  /** Resolves when the player arrives (or is released). */
  walkTo?(at: Vec3Like, speed: number | undefined, via?: string): Promise<void>;
  fade?(level: number, seconds: number): void;
  /** Teleport the player, cancelling any forced walk (skipped scenes, `playerPlace`). */
  placePlayer?(at: PlaceTarget, yaw: number | undefined, pitch: number | undefined): void;
  cameraShake?(amount: number, seconds: number): void;
  setTimeScale?(scale: number): void;

  setDoor?(id: string, state: string): boolean;
  doorStates?(): Record<string, string>;
  /** `tint`: "emergency", "none" (level colours) or "#rrggbb"; omitted keeps the current colour. */
  setLight?(room: string, pattern: string, tint?: string): boolean;
  lightStates?(): Record<string, string>;
  glass?(id: string, state: string): void;
  /** Security camera feed (render-to-texture, `render/cameraFeed.ts`). */
  cameraFeed?(id: string, opts: CameraFeedOptions): void;
  /** Cosmetic gore at a point (`gore` action): `dir` is the point it is thrown toward. */
  gore?(kind: 'burst' | 'chunks' | 'pool' | 'splash', at: Vec3Like, dir: Vec3Like, count: number | undefined, size: number | undefined, clip?: { axis: 'x' | 'y' | 'z'; at: number; keep: 'above' | 'below' }): void;
  /** Black title card over the game for `seconds`, then it fades (`titleCard` action). */
  titleCard?(title: string, sub: string, seconds: number): void;
  water?(level: number, seconds: number): void;
  sfx?(id: string, at: Vec3Like | null): void;
  music?(id: string | null): void;
  /** In-world radio (TAG FM): play `track` at `at`, or stop it with null. */
  radio?(track: string | null, at: Vec3Like | null): void;
  ambience?(id: string): void;

  /** Speak a dialogue line. */
  say?(line: string, opts?: { overlap?: boolean }): SpeechLike | null;
  /** A skipped line must not be repeated by ambient barks. */
  markLinePlayed?(line: string): void;
  /** Cut off every line still playing (a scene was skipped). */
  stopSpeech?(): void;
  /**
   * `hush` action: silence the world's ambience and sound effects and every voice but `speakers` (a fullscreen
   * feed that should carry only its own sound), over about `seconds`; `null` brings it all back.
   */
  hush?(speakers: readonly string[] | null, seconds: number): void;
  /** Give a key item (ADR-0024). False if unknown or already held. */
  giveItem?(id: string): boolean;
  /** Record a checkpoint in the game (autosave, toast). */
  checkpoint?(id: string, label: string | undefined): void;
  endSlice?(): void;
  /**
   * NPC and transform actions (ADR-0006/0011): resolves when the action is finished.
   * A skipped scene sends `instant: true`: apply the end state now (teleport, final pose).
   */
  npc?(action: string, step: Readonly<Record<string, unknown>>): Promise<void> | void;
  /** Enemy spawn groups (ADR-0007): trigger one (false if unknown or already triggered), remove one, ask if cleared. */
  spawnGroup?(group: string): boolean;
  despawnGroup?(group: string): boolean;
  groupCleared?(group: string): boolean;
  /** `squadRegroup` (squad-tasks spec): bring far, unseen squadmates near Jay; returns the ids moved. */
  squadRegroup?(distance?: number): string[];
  /** `gatherIn` (scene-gathering spec): is Jay or a squadmate inside the room? Unknown rooms count as inside. */
  inRoom?(who: 'player' | 'giles' | 'okafor', room: string): boolean;
  /** `gatherIn` timed out or skipped: put squadmates still outside the room near Jay; returns the ids moved. */
  squadPlaceIn?(room: string): string[];
  /** `squadCatchUpIn` (morning-briefing spec): move unseen squadmates outside the room inside it without popping in view. */
  squadCatchUpIn?(room: string, entry?: Vec3Like | null): string[];
}

export type { Scalar };
