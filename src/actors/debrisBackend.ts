import * as THREE from 'three';

/**
 * How severed pieces move once they leave a body (adopt-physics-engine Block 2, design D5).
 *
 * `GoreSystem` owns the pieces, the 24-piece budget and the fade-out; a backend only moves live pieces. Two exist:
 * `floorDebris` below (the original ballistic model against a floor height, used with physics off and as the
 * fallback) and `physicsDebris` in `src/physics/debris.ts` (rigid bodies in the physics world).
 */

export interface DebrisPiece {
  object: THREE.Object3D;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  /** Points (object-local) tested against the floor, with their radius. */
  probes: THREE.Vector3[];
  radius: number;
  age: number;
  asleep: boolean;
  /** Seconds into the fade-out, or -1 while live. */
  fading: number;
  dispose: () => void;
  /** The backend moving this piece (set by `GoreSystem.addDebris`). */
  backend: DebrisBackend;
}

/** Where a piece first struck something, for marks (design D5): world point, surface normal, approach speed. */
export interface DebrisImpact {
  piece: DebrisPiece;
  point: THREE.Vector3;
  /** Unit normal of the surface that was hit, pointing out of it (up for a floor). */
  normal: THREE.Vector3;
  speed: number;
}

export interface DebrisBackend {
  readonly name: string;
  /** Take over a new piece at its current world transform. */
  add(piece: DebrisPiece): void;
  /** Move the backend's live, non-fading pieces by `dt`; report first impacts through `impacts`. */
  update(pieces: readonly DebrisPiece[], dt: number, impacts: (hit: DebrisImpact) => void): void;
  /** Stop simulating a piece (it starts fading, or is cleared); its object stays where it is. */
  release(piece: DebrisPiece): void;
}

const GRAVITY = 9.8;
export const DEBRIS_SLEEP_AFTER = 3;
const UP = new THREE.Vector3(0, 1, 0);

/** The original debris model (ADR-0006): gravity, spin and a bounce off `floorY`. No walls, no impacts. */
export function floorDebris(floorY: (x: number, z: number) => number): DebrisBackend {
  const tmp = new THREE.Vector3();
  const tmpAxis = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  return {
    name: 'floor',
    add() {},
    release() {},
    update(pieces, dt) {
      for (const d of pieces) {
        if (d.asleep) continue;
        if (d.age > DEBRIS_SLEEP_AFTER + 2) {
          d.asleep = true;
          continue;
        }
        const o = d.object;
        d.velocity.y -= GRAVITY * dt;
        o.position.addScaledVector(d.velocity, dt);
        const angle = d.spin.length() * dt;
        if (angle > 1e-6) {
          tmpQ.setFromAxisAngle(tmp.copy(d.spin).normalize(), angle);
          o.quaternion.premultiply(tmpQ);
        }
        // Floor contact against the lowest probe.
        o.updateMatrixWorld(true);
        let lowest = Infinity;
        let lx = 0;
        let lz = 0;
        for (const p of d.probes) {
          tmp.copy(p).applyMatrix4(o.matrixWorld);
          if (tmp.y < lowest) {
            lowest = tmp.y;
            lx = tmp.x;
            lz = tmp.z;
          }
        }
        const floor = floorY(lx, lz) + d.radius;
        if (lowest < floor) {
          o.position.y += floor - lowest;
          if (d.velocity.y < 0) d.velocity.y *= -0.22;
          d.velocity.x *= 0.72;
          d.velocity.z *= 0.72;
          d.spin.multiplyScalar(0.55);
          // No contact torque in this simple model, so tip long pieces over until they lie flat.
          const first = d.probes[0];
          const last = d.probes[d.probes.length - 1];
          let upright = 0;
          if (first && last && first !== last) {
            const a = tmp.copy(last).sub(first).transformDirection(o.matrixWorld);
            upright = Math.abs(a.y);
            if (upright > 0.3) {
              // Rotate the long axis toward horizontal whichever way it points.
              const k = tmpAxis.crossVectors(UP, a).multiplyScalar(Math.sign(a.y));
              if (k.lengthSq() < 1e-6) k.set(1, 0, 0);
              d.spin.addScaledVector(k.normalize(), 70 * upright * dt);
            }
          }
          if (upright <= 0.3 && d.age > 0.4 && d.velocity.lengthSq() < 0.02 && d.spin.lengthSq() < 0.2) d.asleep = true;
          if (d.age > DEBRIS_SLEEP_AFTER && upright <= 0.3) d.asleep = true;
        }
      }
    },
  };
}
