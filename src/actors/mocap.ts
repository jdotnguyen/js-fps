import * as THREE from 'three';
import mocapJson from '../data/mocap-clips.json' with { type: 'json' };
import { blendPose, emptyPose, type CompiledPose } from './poses.ts';
import { JOINT_INDEX, JOINTS, type JointName } from './skeleton.ts';

/**
 * Baked motion-capture clip library (Tier B hybrid animation: Quaternius CC0 clips retargeted
 * onto Thalassa's 21-joint canonical skeleton via scripts/bake-mocap.mjs).
 *
 * Pure Three.js + data, zero allocations during per-frame sampling, runs in Node tests.
 */

export interface RawMocapClip {
  duration: number;
  frames: number;
  loop: boolean;
  stride?: number;
  pelvis: readonly number[];
  contactL?: readonly number[];
  contactR?: readonly number[];
  joints: Readonly<Record<string, readonly number[]>>;
}

export interface RawMocapFile {
  version: number;
  fps: number;
  source: string;
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
}

const N = JOINTS.length;
const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();

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
  };
}

export class MocapLibrary {
  readonly fps: number;
  readonly source: string;
  private readonly clips = new Map<string, CompiledMocapClip>();

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
}

let sharedLib: MocapLibrary | null = null;

/** Shared compiled mocap library (compiled once from src/data/mocap-clips.json). */
export function sharedMocapLibrary(): MocapLibrary {
  if (!sharedLib) sharedLib = new MocapLibrary(mocapJson as unknown as RawMocapFile);
  return sharedLib;
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
 *   idle (0 m/s) <-> walk / walk_formal (~1.3 m/s) <-> jog (~2.7+ m/s).
 * Writes the blended pose into `outPose` and returns stride + contact metadata.
 */
export function sampleLocomotion(
  lib: MocapLibrary,
  speed: number,
  locoPhase: number,
  idlePhase: number,
  opts: { formal?: boolean; talking?: boolean },
  outPose: CompiledPose,
  outInfo: LocomotionSample,
): void {
  const idleClip = lib.get(opts.talking ? 'idle_talk' : 'idle');
  const walkClip = lib.get(opts.formal ? 'walk_formal' : 'walk');
  const jogClip = lib.get('jog');

  const moveW = smoothstep(0.04, 0.85, speed);
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
  outInfo.contactL = 1 + (cWalk[0] - 1) * moveW;
  outInfo.contactR = 1 + (cWalk[1] - 1) * moveW;
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
