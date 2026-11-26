import * as THREE from 'three';
import { solveTwoBone } from './ik.ts';
import type { JointName, Side } from './skeleton.ts';

/**
 * World-space foot-locking IK for upright humanoids.
 *
 * Pins each foot to its floor contact point during stance windows (from mocap contact curves,
 * turn-in-place pivot steps, or standing idle), lowers the pelvis slightly when a stride
 * stretches near full leg length to prevent knee hyperextension, and keeps planted soles
 * flush with the deck while letting swing legs follow the animation arc cleanly.
 */

/** A human ankle's height above the sole at the 1.78 m reference height (m); a body may give its own (FootIkParams). */
export const ANKLE_CLEARANCE = 0.065;
/** Max horizontal distance a pinned foot may trail its FK ankle (tight enough to prevent whole-body leaning over glued feet). */
const MAX_PIN_DRIFT = 0.14;
/** Idle deadzone (m) below which a planted foot stays rock-solid; excess drift smoothly relaxes back under the hip. */
const RELAX_DEADZONE = 0.045;
const RELAX_RATE = 6.5;
const TELEPORT_DIST = 0.75;
const PLANT_RATE = 20;
const RELEASE_RATE = 14;
const MAX_PELVIS_DROP = 0.045;

interface FootState {
  pinned: boolean;
  lockWeight: number;
  readonly pinPos: THREE.Vector3;
  readonly fkPos: THREE.Vector3;
  readonly hipPos: THREE.Vector3;
  readonly kneePos: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly pole: THREE.Vector3;
}

function makeFoot(): FootState {
  return {
    pinned: false,
    lockWeight: 0,
    pinPos: new THREE.Vector3(),
    fkPos: new THREE.Vector3(),
    hipPos: new THREE.Vector3(),
    kneePos: new THREE.Vector3(),
    target: new THREE.Vector3(),
    pole: new THREE.Vector3(),
  };
}

export interface FootIkParams {
  group: THREE.Group;
  bones: Readonly<Record<JointName, THREE.Bone>>;
  scaleY: number;
  scaleW: number;
  contactL: number;
  contactR: number;
  attachedL: boolean;
  attachedR: boolean;
  /** True when the character is upright and eligible for floor foot-locking. */
  enabled: boolean;
  /** True for forced crouching/kneeling floor-plant poses (legacy plantFeet). */
  forcePlant: boolean;
  dt: number;
  /** This body's ankle height above the sole at the reference height (m); default ANKLE_CLEARANCE (rig-necromorph). */
  ankleHeight?: number;
  /** Hold a planted foot exactly where it landed (no settling toward the animated foot), up to this far from it (m); default MAX_PIN_DRIFT with settling. */
  holdPlanted?: number;
}

const qParentInv = new THREE.Quaternion();
const qFlat = new THREE.Quaternion();
const vTmp = new THREE.Vector3();

export class FootIkSolver {
  private readonly feet: Record<Side, FootState> = { L: makeFoot(), R: makeFoot() };
  private pelvisDrop = 0;
  private wasEnabled = false;

  reset(): void {
    for (const s of ['L', 'R'] as const) {
      this.feet[s].pinned = false;
      this.feet[s].lockWeight = 0;
    }
    this.pelvisDrop = 0;
    this.wasEnabled = false;
  }

  /** Exposed for unit tests: current world-space lock weight (0..1) per foot. */
  lockWeight(side: Side): number {
    return this.feet[side].lockWeight;
  }

  /** Exposed for unit tests: current pinned world position for a foot. */
  pinnedWorld(side: Side, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.feet[side].pinPos);
  }

  solve(p: FootIkParams): boolean {
    if (!p.enabled && !p.forcePlant) {
      if (this.wasEnabled) this.reset();
      return false;
    }

    const h = Math.min(Math.max(p.dt, 0), 0.05);
    p.group.updateMatrixWorld(true);

    const floorY = p.group.position.y;
    const ankle = p.ankleHeight ?? ANKLE_CLEARANCE;
    const ankleY = floorY + ankle * p.scaleY;
    const maxDrift = (p.holdPlanted ?? MAX_PIN_DRIFT) * p.scaleY;
    const teleportDist = TELEPORT_DIST * p.scaleY;

    const contacts: Record<Side, number> = {
      L: p.attachedL ? (p.forcePlant ? 1 : p.contactL) : 0,
      R: p.attachedR ? (p.forcePlant ? 1 : p.contactR) : 0,
    };

    // 1. Sample FK ankle positions & update world-space foot pin states.
    let activeCount = 0;
    for (const s of ['L', 'R'] as const) {
      const f = this.feet[s];
      const foot = p.bones[`foot_${s}`];
      const thigh = p.bones[`thigh_${s}`];
      const shin = p.bones[`shin_${s}`];
      foot.getWorldPosition(f.fkPos);
      thigh.getWorldPosition(f.hipPos);
      shin.getWorldPosition(f.kneePos);

      const c = contacts[s];
      const attached = s === 'L' ? p.attachedL : p.attachedR;
      if (!attached) {
        f.pinned = false;
        f.lockWeight = 0;
        continue;
      }

      if (p.forcePlant) {
        const x = (s === 'L' ? -1 : 1) * 0.11 * p.scaleW;
        p.group.localToWorld(f.pinPos.set(x, ankle * p.scaleY, s === 'L' ? -0.05 : 0.12));
        f.pinned = true;
        f.lockWeight = 1;
        activeCount++;
        continue;
      }

      // Snap or release if character teleported or solver just turned on.
      if (!this.wasEnabled || (f.pinned && f.pinPos.distanceTo(f.fkPos) > teleportDist)) {
        f.pinPos.set(f.fkPos.x, ankleY, f.fkPos.z);
        f.pinned = c >= 0.5;
        f.lockWeight = f.pinned ? Math.min(1, c) : 0;
      }

      if (c >= 0.55) {
        if (!f.pinned) {
          f.pinPos.set(f.fkPos.x, ankleY, f.fkPos.z);
          f.pinned = true;
        }
      } else if (c < 0.42) {
        f.pinned = false;
      }

      if (f.pinned) {
        // Track floor height changes (stairs/ramps), clamp extreme lag, and smoothly settle excess drift
        // beyond the idle deadzone so feet never stay glued behind a stopping, turning, or nudged body.
        f.pinPos.y = ankleY;
        const dx = f.fkPos.x - f.pinPos.x;
        const dz = f.fkPos.z - f.pinPos.z;
        const d = Math.hypot(dx, dz);
        const deadzone = RELAX_DEADZONE * p.scaleY;
        if (d > maxDrift) {
          const pull = (d - maxDrift) / d;
          f.pinPos.x += dx * pull;
          f.pinPos.z += dz * pull;
        } else if (d > deadzone && p.holdPlanted === undefined) {
          const excess = d - deadzone;
          const relax = (excess * (1 - Math.exp(-RELAX_RATE * h))) / d;
          f.pinPos.x += dx * relax;
          f.pinPos.z += dz * relax;
        }
      }

      const targetW = f.pinned ? Math.min(1, c * 1.15) : 0;
      const rate = targetW > f.lockWeight ? PLANT_RATE : RELEASE_RATE;
      f.lockWeight += (targetW - f.lockWeight) * (1 - Math.exp(-rate * h));
      if (f.lockWeight < 0.005) f.lockWeight = 0;
      if (f.lockWeight > 0) activeCount++;
    }

    this.wasEnabled = true;
    if (activeCount === 0) {
      this.pelvisDrop *= Math.exp(-12 * h);
      return false;
    }

    // 2. Compute gentle pelvis drop if any pinned foot stretches near full leg reach.
    let neededDrop = 0;
    for (const s of ['L', 'R'] as const) {
      const f = this.feet[s];
      if (f.lockWeight <= 0.05) continue;
      const lenAB = f.hipPos.distanceTo(f.kneePos);
      const lenBC = f.kneePos.distanceTo(f.fkPos);
      const maxReach = (lenAB + lenBC) * 0.975;
      const wantDist = f.hipPos.distanceTo(f.pinPos);
      if (wantDist > maxReach) {
        neededDrop = Math.max(neededDrop, (wantDist - maxReach) * f.lockWeight);
      }
      // Also prevent FK foot from sinking below floor plane during stance.
      if (f.fkPos.y < ankleY - 0.015) {
        neededDrop = Math.max(neededDrop, 0);
      }
    }
    neededDrop = Math.min(neededDrop, MAX_PELVIS_DROP * p.scaleY);
    this.pelvisDrop += (neededDrop - this.pelvisDrop) * (1 - Math.exp(-16 * h));
    if (this.pelvisDrop > 1e-4 && !p.forcePlant) {
      p.bones.pelvis.position.y -= this.pelvisDrop / Math.max(0.1, p.scaleY);
      p.group.updateMatrixWorld(true);
    }

    // 3. Solve two-bone leg IK and level the planted foot onto the floor.
    for (const s of ['L', 'R'] as const) {
      const f = this.feet[s];
      if (f.lockWeight <= 1e-3) continue;
      const thigh = p.bones[`thigh_${s}`];
      const shin = p.bones[`shin_${s}`];
      const foot = p.bones[`foot_${s}`];

      // Target blends smoothly between FK ankle and pinned floor position.
      foot.getWorldPosition(f.fkPos);
      f.target.copy(f.pinPos);
      // Pole vector in front of the knee (-Z in character space), slightly biased outward.
      const xSign = s === 'L' ? -1 : 1;
      p.group.localToWorld(f.pole.set(xSign * 0.22 * p.scaleW, 0.55 * p.scaleY, -1.4 * p.scaleY));

      solveTwoBone(thigh, shin, foot, f.target, f.pole, f.lockWeight);

      // Keep planted foot flat on the deck (smoothly preserving heel-strike/toe-off as lockWeight tapers).
      // For a body that holds planted feet where they landed (`holdPlanted`), stop flattening once the foot lifts so
      // a tucked swing shin does not wrench the airborne ankle upward.
      const parent = foot.parent;
      if (parent && (f.pinned || p.forcePlant || p.holdPlanted === undefined)) {
        parent.getWorldQuaternion(qParentInv).invert();
        qFlat.copy(qParentInv).multiply(p.group.quaternion);
        const flatW = p.forcePlant ? 1 : f.lockWeight * 0.82;
        foot.quaternion.slerp(qFlat, flatW);
      }
    }

    // Prevent any foot (swing or transitioning) from dipping below floor height.
    for (const s of ['L', 'R'] as const) {
      const f = this.feet[s];
      const attached = s === 'L' ? p.attachedL : p.attachedR;
      if (!attached) continue;
      const foot = p.bones[`foot_${s}`];
      foot.getWorldPosition(vTmp);
      if (vTmp.y < ankleY) {
        f.target.set(vTmp.x, ankleY, vTmp.z);
        const xSign = s === 'L' ? -1 : 1;
        p.group.localToWorld(f.pole.set(xSign * 0.22 * p.scaleW, 0.55 * p.scaleY, -1.4 * p.scaleY));
        solveTwoBone(p.bones[`thigh_${s}`], p.bones[`shin_${s}`], foot, f.target, f.pole, 1);
      }
    }

    p.group.updateMatrixWorld(true);
    return true;
  }
}
