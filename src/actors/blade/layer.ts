import * as THREE from 'three';
import { Rng } from '../../core/rng.ts';
import type { CreatureBoneDef } from '../bodyModel.ts';
import type { BladeCreatureProfile } from '../../data/types/bladeCreature.ts';

/**
 * The blade creature's own layer (openspec rig-necromorph, design D3): applied over the animated joints each frame. It opens
 * the jaw by an amount, and keeps the small belly arms alive: a seeded twitch and grasp at rest, spread wide by `flare`
 * (screams, strikes) and curled by `clench`. Deterministic: the same seed and the same times give the same pose.
 */

/** Amounts the scenes, performances and gaits set, each 0..1. */
export interface BladeLayerAmounts {
  jaw: number;
  flare: number;
  clench: number;
}

interface LimbBone {
  bone: THREE.Bone;
  side: -1 | 1;
  role: 'root' | 'arm' | 'wrist' | 'finger';
  phase: [number, number, number];
  rate: [number, number, number];
}

const TAU = Math.PI * 2;
/** How far a belly-arm finger joint opens and curls (radians), measured against the skin (rig-necromorph task 5.4d). */
export const FINGER_CURL = [-0.2, 0.32] as const;

export class BladeLayer {
  readonly amounts: BladeLayerAmounts = { jaw: 0, flare: 0, clench: 0 };
  /** The ankle's height above the sole at the reference height (m), for the foot IK. */
  readonly ankleHeight: number;
  private readonly limbs: LimbBone[] = [];
  private readonly jaw: THREE.Bone | null;
  private readonly openRad: number;
  private readonly restJaw: number;
  /** A footfall's jolt through the belly arms, decaying (0..1.5). */
  private kick = 0;
  /** The current amounts, eased toward `amounts`. */
  private readonly cur: BladeLayerAmounts = { jaw: 0, flare: 0, clench: 0 };
  private readonly e = new THREE.Euler();

  constructor(profile: BladeCreatureProfile, defs: readonly CreatureBoneDef[], bone: (name: string) => THREE.Bone | undefined, seed: string) {
    const rng = new Rng(`blade-layer:${seed}`);
    this.jaw = bone('jaw') ?? null;
    this.openRad = THREE.MathUtils.degToRad(profile.jaw.openDeg);
    this.restJaw = profile.jaw.rest;
    this.ankleHeight = profile.ankleHeight;
    for (const d of defs) {
      if (d.kind !== 'limb') continue;
      const b = bone(d.name);
      if (!b) continue;
      const side = d.limb.endsWith('_L') ? -1 : 1;
      const role = d.parent.startsWith('limb_') ? (/wrist/i.test(d.source) ? 'wrist' : /_(T|F)\d/i.test(d.source) ? 'finger' : 'arm') : 'root';
      this.limbs.push({
        bone: b,
        side,
        role,
        phase: [rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU)],
        rate: [rng.range(0.5, 1.3), rng.range(0.4, 1.1), rng.range(0.6, 1.6)],
      });
    }
  }

  /** A heavy step or a blow: the belly arms flail out and snap back. */
  bump(k: number): void {
    this.kick = Math.min(1.5, this.kick + k);
  }

  /** Apply over the joints the animator has just set. `t` is the body's time (s), `dt` this frame's step. */
  apply(t: number, dt: number): void {
    const k = Math.min(1, dt * 8);
    this.cur.jaw += (this.amounts.jaw - this.cur.jaw) * Math.min(1, dt * 14);
    this.cur.flare += (this.amounts.flare - this.cur.flare) * k;
    this.cur.clench += (this.amounts.clench - this.cur.clench) * k;
    if (this.jaw) {
      // Opening turns the jaw down about its sideways axis (negative X), on top of whatever the animator gave it. At rest it
      // hangs a little open.
      this.jaw.rotateX(-this.openRad * THREE.MathUtils.lerp(this.restJaw, 1, THREE.MathUtils.clamp(this.cur.jaw, 0, 1)));
    }
    this.kick *= Math.exp(-7 * dt);
    // A jolt flares them further, never past their authored reach (the skin holds to 1).
    const flare = Math.min(1, this.cur.flare + 0.7 * this.kick * (1 - this.cur.flare * 0.5));
    const clench = this.cur.clench;
    for (const l of this.limbs) {
      const w = (i: number): number => Math.sin(t * l.rate[i]! * TAU * 0.35 + l.phase[i]!);
      // A slow grasping drift, with a sharper twitch riding on it.
      const twitch = Math.max(0, Math.sin(t * l.rate[2]! * 3.1 + l.phase[2]!)) ** 6;
      switch (l.role) {
        case 'root':
          // Out to the side and forward when flared.
          this.e.set(0.12 * w(0) + 0.55 * flare, 0.08 * w(1), l.side * (0.1 * w(2) + 0.7 * flare + 0.15 * twitch));
          break;
        case 'arm':
          this.e.set(0.15 * w(0) + 0.25 * twitch - 0.35 * flare, 0, l.side * 0.1 * w(1));
          break;
        case 'wrist':
          this.e.set(0.25 * w(0) + 0.4 * twitch, 0.2 * w(1), l.side * 0.2 * w(2));
          break;
        case 'finger':
          // Grasping: curl in, open out when flared, clench shut. Every finger joint keeps within FINGER_CURL, where the small
          // finger skin holds (past it an edge stretches beyond 2.5 times; fully clenched it reached 5.9 times).
          this.e.set(THREE.MathUtils.clamp(0.06 + 0.1 * (0.5 + 0.5 * w(0)) + 0.1 * twitch + 0.17 * clench - 0.3 * flare, FINGER_CURL[0], FINGER_CURL[1]), 0, 0);
          break;
      }
      l.bone.quaternion.setFromEuler(this.e);
    }
  }
}

/** Build the layer for a body whose model has creature bones and a blade profile. */
export function bladeLayerFor(profile: BladeCreatureProfile | null, defs: readonly CreatureBoneDef[] | undefined, bone: (name: string) => THREE.Bone | undefined, seed: string): BladeLayer | null {
  if (!profile || !defs?.length) return null;
  return new BladeLayer(profile, defs, bone, seed);
}
