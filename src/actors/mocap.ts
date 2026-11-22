import * as THREE from 'three';
import { blendPose, emptyPose, type CompiledPose } from './poses.ts';
import { JOINT_INDEX, JOINTS, type JointName } from './skeleton.ts';

/**
 * Baked motion-capture clip library (Tier B hybrid animation: Quaternius CC0 clips retargeted
 * onto Thalassa's 21-joint canonical skeleton via scripts/bake-mocap.mjs).
 *
 * Pure Three.js + data, zero allocations during per-frame sampling, runs in Node tests.
 */

export interface RawMocapClip {
  /** Bake-list source id (credits; see RawMocapFile.sources). */
  source?: string;
  duration: number;
  frames: number;
  loop: boolean;
  stride?: number;
  pelvis: readonly number[];
  contactL?: readonly number[];
  contactR?: readonly number[];
  joints: Readonly<Record<string, readonly number[]>>;
  /** A posture hold baked as offsets from its own mean pose (design D4), to be layered on top of an authored pose. */
  additive?: boolean;
  /** Finger curls where the source records fingers: 12 per frame (left then right: thumb, index, middle, ring, pinky curl, thumb spread). */
  fingers?: readonly number[];
}

export interface RawMocapFile {
  version: number;
  fps: number;
  source: string;
  /** Credit for every source the file's clips come from, by source id. */
  sources?: Readonly<Record<string, { title: string; author: string; licence: string; url: string }>>;
  clips: Readonly<Record<string, RawMocapClip>>;
}

export interface CompiledMocapClip {
  readonly id: string;
  readonly duration: number;
  readonly frames: number;
  readonly loop: boolean;
  readonly stride: number;
  /** Flattened [x,y,z] per frame (length = frames * 3). */
  readonly pelvis: Float32Array;
  /** Per-joint flattened [x,y,z,w] normalized quaternions per frame (JOINTS order; null for root/jaw). */
  readonly tracks: readonly (Float32Array | null)[];
  /** Per-frame 0..1 stance contact weight for left/right feet (locomotion clips). */
  readonly contactL: Float32Array | null;
  readonly contactR: Float32Array | null;
  /** Finger curls, 12 per frame (see RawMocapClip.fingers), or null when the source has no finger data. */
  readonly fingers: Float32Array | null;
  /** True for posture holds stored as offsets from their mean pose (layer them; don't play them as a pose). */
  readonly additive: boolean;
  /** Mean of each finger channel over the clip (to sample finger motion as offsets), or null. */
  readonly fingersMean: Float32Array | null;
}

/** Floats per frame in a clip's finger track. */
export const FINGER_CHANNELS = 12;

const N = JOINTS.length;
const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();

function channelMean(fr: Float32Array, frames: number): Float32Array {
  const m = new Float32Array(FINGER_CHANNELS);
  for (let f = 0; f < frames; f++) for (let c = 0; c < FINGER_CHANNELS; c++) m[c] = (m[c] ?? 0) + (fr[f * FINGER_CHANNELS + c] ?? 0) / frames;
  return m;
}

function compileClip(id: string, raw: RawMocapClip): CompiledMocapClip {
  const frames = raw.frames;
  const pelvis = new Float32Array(frames * 3);
  for (let i = 0; i < pelvis.length; i++) pelvis[i] = raw.pelvis[i] ?? 0;

  const tracks: (Float32Array | null)[] = new Array(N).fill(null);
  for (const j of JOINTS) {
    const src = raw.joints[j.name];
    if (!src) continue;
    const arr = new Float32Array(frames * 4);
    for (let f = 0; f < frames; f++) {
      const k = f * 4;
      const x = src[k] ?? 0;
      const y = src[k + 1] ?? 0;
      const z = src[k + 2] ?? 0;
      const w = src[k + 3] ?? 1;
      const len = Math.hypot(x, y, z, w) || 1;
      arr[k] = x / len;
      arr[k + 1] = y / len;
      arr[k + 2] = z / len;
      arr[k + 3] = w / len;
    }
    tracks[JOINT_INDEX[j.name as JointName]] = arr;
  }

  const contactL = raw.contactL ? Float32Array.from(raw.contactL) : null;
  const contactR = raw.contactR ? Float32Array.from(raw.contactR) : null;
  const fingers = raw.fingers && raw.fingers.length === frames * FINGER_CHANNELS ? Float32Array.from(raw.fingers) : null;

  return {
    id,
    duration: raw.duration,
    frames,
    loop: raw.loop,
    stride: raw.stride ?? 0,
    pelvis,
    tracks,
    contactL,
    contactR,
    fingers,
    fingersMean: fingers ? channelMean(fingers, frames) : null,
    additive: raw.additive === true,
  };
}

export class MocapLibrary {
  readonly fps: number;
  readonly source: string;
  private readonly clips = new Map<string, CompiledMocapClip>();
  /** Per-character clip packs (mocap-library spec: loaded with the body, released with it). */
  private readonly packs = new Map<string, { ids: string[]; refs: number }>();

  constructor(file: RawMocapFile) {
    this.fps = file.fps;
    this.source = file.source;
    for (const [id, raw] of Object.entries(file.clips)) {
      this.clips.set(id, compileClip(id, raw));
    }
  }

  has(id: string): boolean {
    return this.clips.has(id);
  }

  get(id: string): CompiledMocapClip {
    const c = this.clips.get(id);
    if (!c) throw new Error(`unknown mocap clip "${id}"`);
    return c;
  }

  ids(): string[] {
    return [...this.clips.keys()];
  }

  /** Add a character's clip pack (src/data/mocap/<name>.json). Adding a pack that is already loaded does nothing. */
  addPack(name: string, file: RawMocapFile): void {
    if (this.packs.has(name)) return;
    const ids: string[] = [];
    for (const [id, raw] of Object.entries(file.clips)) {
      if (this.clips.has(id)) continue;
      this.clips.set(id, compileClip(id, raw));
      ids.push(id);
    }
    this.packs.set(name, { ids, refs: 0 });
  }

  hasPack(name: string): boolean {
    return this.packs.has(name);
  }

  /** A body using the pack's clips holds it. */
  retainPack(name: string): void {
    const p = this.packs.get(name);
    if (p) p.refs++;
  }

  /** A body that used the pack is gone; the last one out removes the pack's clips. */
  releasePack(name: string): void {
    const p = this.packs.get(name);
    if (!p) return;
    p.refs--;
    if (p.refs > 0) return;
    for (const id of p.ids) this.clips.delete(id);
    this.packs.delete(name);
  }
}

let sharedLib: MocapLibrary | null = null;
let sharedLoad: Promise<MocapLibrary> | null = null;

/**
 * Fetch and compile the shared clip library (src/data/mocap-core.json). It is its own bundle chunk, loaded when a
 * session starts (startup-bundle spec: Shared clip data is its own chunk). Later calls share the first load.
 */
export function loadSharedMocapLibrary(): Promise<MocapLibrary> {
  if (sharedLoad) return sharedLoad;
  const load: Promise<MocapLibrary> = import('../data/mocapCore.ts').then((m) => {
    const lib = new MocapLibrary(m.default as unknown as RawMocapFile);
    // A clear while this was in flight wins: the next load compiles a fresh library.
    if (sharedLoad === load) sharedLib = lib;
    return lib;
  });
  sharedLoad = load;
  return load;
}

/** The shared compiled clip library. Throws until loadSharedMocapLibrary() has finished, so a late caller fails loudly. */
export function sharedMocapLibrary(): MocapLibrary {
  if (!sharedLib) throw new Error('mocap: the shared clip library is not loaded; await loadSharedMocapLibrary() before building bodies');
  return sharedLib;
}

/** Release the compiled shared mocap library (session teardown). The next loadSharedMocapLibrary() compiles it again. */
export function clearSharedMocapLibrary(): void {
  sharedLib = null;
  sharedLoad = null;
}

/**
 * Sample a clip at normalized phase `u` (0..1, wrapped if looping) into `out`.
 * Root rotation/position and jaw stay at identity so procedural layers own them.
 */
export function sampleClip(clip: CompiledMocapClip, u: number, out: CompiledPose): void {
  const n = clip.frames;
  const wrapped = clip.loop ? ((u % 1) + 1) % 1 : THREE.MathUtils.clamp(u, 0, 1);
  const fPos = clip.loop ? wrapped * n : wrapped * (n - 1);
  const i0 = Math.floor(fPos) % n;
  const i1 = clip.loop ? (i0 + 1) % n : Math.min(n - 1, i0 + 1);
  const alpha = fPos - Math.floor(fPos);

  out.rootRot.identity();
  out.rootPos.set(0, 0, 0);

  const p0 = i0 * 3;
  const p1 = i1 * 3;
  const pv = clip.pelvis;
  out.pelvis.set(
    (pv[p0] ?? 0) + ((pv[p1] ?? 0) - (pv[p0] ?? 0)) * alpha,
    (pv[p0 + 1] ?? 0) + ((pv[p1 + 1] ?? 0) - (pv[p0 + 1] ?? 0)) * alpha,
    (pv[p0 + 2] ?? 0) + ((pv[p1 + 2] ?? 0) - (pv[p0 + 2] ?? 0)) * alpha,
  );

  for (let j = 0; j < N; j++) {
    const oq = out.joints[j];
    if (!oq) continue;
    const tr = clip.tracks[j];
    if (!tr) {
      oq.identity();
      continue;
    }
    const k0 = i0 * 4;
    const k1 = i1 * 4;
    qA.set(tr[k0] ?? 0, tr[k0 + 1] ?? 0, tr[k0 + 2] ?? 0, tr[k0 + 3] ?? 1);
    qB.set(tr[k1] ?? 0, tr[k1 + 1] ?? 0, tr[k1 + 2] ?? 0, tr[k1 + 3] ?? 1);
    oq.slerpQuaternions(qA, qB, alpha);
  }
}

/**
 * Sample a clip's finger curls at normalized phase `u` into `out` (12 floats: left then right hand, thumb..pinky curl in radians,
 * then thumb spread). Returns false (and leaves `out` alone) when the clip has no finger data.
 */
export function sampleFingers(clip: CompiledMocapClip, u: number, out: Float32Array | number[], relative = false): boolean {
  const fr = clip.fingers;
  const mean = relative ? clip.fingersMean : null;
  if (!fr) return false;
  const n = clip.frames;
  const wrapped = clip.loop ? ((u % 1) + 1) % 1 : THREE.MathUtils.clamp(u, 0, 1);
  const fPos = clip.loop ? wrapped * n : wrapped * (n - 1);
  const i0 = Math.floor(fPos) % n;
  const i1 = clip.loop ? (i0 + 1) % n : Math.min(n - 1, i0 + 1);
  const a = fPos - Math.floor(fPos);
  for (let c = 0; c < FINGER_CHANNELS; c++) {
    const v0 = fr[i0 * FINGER_CHANNELS + c] ?? 0;
    const v1 = fr[i1 * FINGER_CHANNELS + c] ?? 0;
    out[c] = v0 + (v1 - v0) * a - (mean?.[c] ?? 0);
  }
  return true;
}

/** Sample interpolated foot stance contacts [left, right] in 0..1 at normalized phase `u`. */
export function sampleContacts(clip: CompiledMocapClip, u: number, out: [number, number]): void {
  if (!clip.contactL || !clip.contactR) {
    out[0] = 1;
    out[1] = 1;
    return;
  }
  const n = clip.frames;
  const wrapped = ((u % 1) + 1) % 1;
  const fPos = wrapped * n;
  const i0 = Math.floor(fPos) % n;
  const i1 = (i0 + 1) % n;
  const alpha = fPos - Math.floor(fPos);
  out[0] = (clip.contactL[i0] ?? 0) + ((clip.contactL[i1] ?? 0) - (clip.contactL[i0] ?? 0)) * alpha;
  out[1] = (clip.contactR[i0] ?? 0) + ((clip.contactR[i1] ?? 0) - (clip.contactR[i0] ?? 0)) * alpha;
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

const tmpWalk = emptyPose('mocap_walk');
const tmpJog = emptyPose('mocap_jog');
const tmpIdle = emptyPose('mocap_idle');
const cWalk: [number, number] = [1, 1];
const cJog: [number, number] = [1, 1];

/**
 * The locomotion clips the blend space samples (idle, talk, walk, jog). A body's full set of clips comes from its motion profile
 * (motionProfiles.ts); this is the subset `sampleLocomotion` needs.
 */
export interface MotionSet {
  idle: string;
  talk: string;
  walk: string;
  jog: string;
}

export const DEFAULT_MOTIONS: Readonly<MotionSet> = { idle: 'idle', talk: 'idle_talk', walk: 'walk', jog: 'jog' };
/** The calmer, composed walk (medics, the director). */
export const FORMAL_MOTIONS: Readonly<MotionSet> = { ...DEFAULT_MOTIONS, walk: 'walk_formal' };

export interface LocomotionSample {
  /** Blended stride length (m/cycle) at the current speed, for phase advancement. */
  stride: number;
  /** 0..1 locomotion weight (0 = full idle, 1 = full walk/jog). */
  moveWeight: number;
  /** 0..1 jog share (0 = walk, 1 = jog). */
  jogWeight: number;
  /** Foot stance contact weights (0..1) for foot-locking IK. */
  contactL: number;
  contactR: number;
}

/**
 * Evaluate the phase-synchronized 1D human locomotion blend space:
 *   idle (0 m/s) <-> walk (~1.3 m/s) <-> jog (~2.7+ m/s), using the body's motion set (default: idle, walk, jog).
 * Writes the blended pose into `outPose` and returns stride + contact metadata.
 */
export function sampleLocomotion(
  lib: MocapLibrary,
  speed: number,
  locoPhase: number,
  idlePhase: number,
  opts: { formal?: boolean; talking?: boolean; motions?: MotionSet },
  outPose: CompiledPose,
  outInfo: LocomotionSample,
): void {
  const set = opts.motions ?? (opts.formal ? FORMAL_MOTIONS : DEFAULT_MOTIONS);
  const idleClip = lib.get(opts.talking ? set.talk : set.idle);
  const walkClip = lib.get(set.walk);
  const jogClip = lib.get(set.jog);

  const moveW = smoothstep(0.04, 0.85, speed);
  // Release swing-foot contacts promptly at low walking speeds so FootIk never glues both feet down while gliding to a stop.
  const contactW = smoothstep(0.04, 0.28, speed);
  const jogW = smoothstep(1.55, 2.75, speed);
  const stride = walkClip.stride + (jogClip.stride - walkClip.stride) * jogW;

  outInfo.stride = stride;
  outInfo.moveWeight = moveW;
  outInfo.jogWeight = jogW;

  if (moveW <= 1e-4) {
    sampleClip(idleClip, idlePhase, outPose);
    outInfo.contactL = 1;
    outInfo.contactR = 1;
    return;
  }

  sampleClip(walkClip, locoPhase, tmpWalk);
  sampleContacts(walkClip, locoPhase, cWalk);

  if (jogW > 1e-4) {
    sampleClip(jogClip, locoPhase, tmpJog);
    sampleContacts(jogClip, locoPhase, cJog);
    blendPose(tmpWalk, tmpJog, jogW, tmpWalk);
    cWalk[0] += (cJog[0] - cWalk[0]) * jogW;
    cWalk[1] += (cJog[1] - cWalk[1]) * jogW;
  }

  if (moveW >= 1 - 1e-4) {
    blendPose(tmpWalk, tmpWalk, 1, outPose);
    outInfo.contactL = cWalk[0];
    outInfo.contactR = cWalk[1];
    return;
  }

  sampleClip(idleClip, idlePhase, tmpIdle);
  blendPose(tmpIdle, tmpWalk, moveW, outPose);
  outInfo.contactL = 1 + (cWalk[0] - 1) * contactW;
  outInfo.contactR = 1 + (cWalk[1] - 1) * contactW;
}

/**
 * Evaluate the dedicated slow, limping infected locomotion blend space:
 *   zombie_idle (0 m/s) <-> zombie_walk (slow asymmetric dragging shamble).
 * Never blends into human walking or jogging so enemies stay unmistakably undead.
 */
export function sampleZombieLocomotion(
  lib: MocapLibrary,
  speed: number,
  locoPhase: number,
  idlePhase: number,
  outPose: CompiledPose,
  outInfo: LocomotionSample,
): void {
  const zIdle = lib.get('zombie_idle');
  const zWalk = lib.get('zombie_walk');
  const moveW = smoothstep(0.03, 0.45, speed);
  outInfo.stride = zWalk.stride || 1.5;
  outInfo.moveWeight = moveW;
  outInfo.jogWeight = 0;

  if (moveW <= 1e-4) {
    sampleClip(zIdle, idlePhase, outPose);
    outInfo.contactL = 1;
    outInfo.contactR = 1;
    return;
  }

  sampleClip(zWalk, locoPhase, tmpWalk);
  sampleContacts(zWalk, locoPhase, cWalk);
  if (moveW >= 1 - 1e-4) {
    blendPose(tmpWalk, tmpWalk, 1, outPose);
    outInfo.contactL = cWalk[0];
    outInfo.contactR = cWalk[1];
    return;
  }

  sampleClip(zIdle, idlePhase, tmpIdle);
  blendPose(tmpIdle, tmpWalk, moveW, outPose);
  outInfo.contactL = 1 + (cWalk[0] - 1) * moveW;
  outInfo.contactR = 1 + (cWalk[1] - 1) * moveW;
}
