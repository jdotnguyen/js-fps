/**
 * Severed pieces as rigid bodies (adopt-physics-engine Block 2, design D5; spec severed-debris).
 *
 * One body per piece: a capsule from its first probe to its last with the piece's radius (a ball when there is one
 * probe), CCD on so a shotgun-speed limb cannot tunnel through a wall, mass from its length. The body's origin is
 * the piece object's origin, so the body transform is written straight back to the object.
 *
 * - First impact: the first contact with something that is not another piece is reported once, with the point and
 *   surface normal from a raycast along the piece's path (the engine's contact point can be a rough guess on the
 *   first touch), for pools and splats.
 * - Settling: the engine's own sleeping, and a hard cutoff at `STATIC_AFTER` seconds that makes the body fixed, so a
 *   piece at rest never costs step time again but other pieces still land on it.
 * - Restarts: `PhysicsWorld.reset()` destroys the engine. Pieces from an earlier generation are left where they lie,
 *   asleep, as the floor model leaves them, and their handles are dropped.
 */
import * as THREE from 'three';
import type { DebrisBackend, DebrisImpact, DebrisPiece } from '../actors/debrisBackend.ts';
import type { BodyHandle, ColliderHandle, Transform, V3 } from './engine.ts';
import type { PhysicsWorld } from './world.ts';

/** Seconds after which a piece is made static whether or not it has come to rest (severed-debris: 6 s). */
export const STATIC_AFTER = 6;
/** Mass per metre of piece length (kg/m): a 0.7 m arm is about 5 kg, a 0.9 m leg about 6 kg. */
export const LINEAR_DENSITY = 7;
const MIN_MASS = 1;
/** Contact tuning for wet flesh on hard floors: grips more than it bounces. Recorded in docs/physics.md. */
export const DEBRIS_FRICTION = 0.7;
export const DEBRIS_RESTITUTION = 0.15;
const LINEAR_DAMPING = 0.05;
const ANGULAR_DAMPING = 0.6;
/** Fraction of the gore system's random spin kept on the body (the floor model needed more to tip pieces over). */
const SPIN_SCALE = 0.6;

interface Tracked {
  piece: DebrisPiece;
  body: BodyHandle;
  collider: ColliderHandle;
  generation: number;
  impacted: boolean;
  frozen: boolean;
  /** Velocity and position before the last step, for the impact speed and the raycast back along the path. */
  prevVel: V3;
  prevPos: V3;
  /** Object scale, kept while the body drives position and rotation. */
  scale: THREE.Vector3;
}

const _m = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _axisQ = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _inv = new THREE.Matrix4();
const _t: Transform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const _v: V3 = { x: 0, y: 0, z: 0 };

/** Capsule (or ball) for a piece, in the object's local frame scaled to world size. */
export function debrisShape(probes: readonly THREE.Vector3[], radius: number, scale: number): {
  center: THREE.Vector3;
  rotation: THREE.Quaternion;
  halfHeight: number;
  radius: number;
  mass: number;
} {
  const r = Math.max(0.01, radius * scale);
  const first = probes[0];
  const last = probes[probes.length - 1];
  const a = first ? _a.copy(first).multiplyScalar(scale) : _a.set(0, 0, 0);
  const b = last ? _b.copy(last).multiplyScalar(scale) : _b.copy(a);
  const len = a.distanceTo(b);
  const center = a.clone().add(b).multiplyScalar(0.5);
  const rotation = new THREE.Quaternion();
  if (len > 1e-3) rotation.setFromUnitVectors(_up, b.clone().sub(a).divideScalar(len));
  return { center, rotation, halfHeight: len / 2, radius: r, mass: Math.max(MIN_MASS, LINEAR_DENSITY * (len + 2 * r)) };
}

export function physicsDebris(world: PhysicsWorld): DebrisBackend {
  const tracked = new Map<DebrisPiece, Tracked>();
  const byCollider = new Map<number, Tracked>();
  let generation = world.generation;

  /** Drop every handle from a destroyed engine; the pieces stay where they lie. */
  const dropStale = (): void => {
    if (generation === world.generation) return;
    generation = world.generation;
    for (const t of tracked.values()) t.piece.asleep = true;
    tracked.clear();
    byCollider.clear();
  };

  const forget = (t: Tracked): void => {
    tracked.delete(t.piece);
    byCollider.delete(t.collider);
  };

  /** Write the body's world transform to the piece object (through its parent's inverse when it has one). */
  const writeBack = (t: Tracked): void => {
    const e = world.engine;
    e.transform(t.body, _t);
    const o = t.piece.object;
    _pos.set(_t.position.x, _t.position.y, _t.position.z);
    _quat.set(_t.rotation.x, _t.rotation.y, _t.rotation.z, _t.rotation.w);
    _m.compose(_pos, _quat, t.scale);
    const parent = o.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      _m.premultiply(_inv.copy(parent.matrixWorld).invert());
    }
    _m.decompose(o.position, o.quaternion, o.scale);
  };

  /** The first impact, located by a ray from where the piece was along where it was going. */
  const impact = (t: Tracked, contactPoint: V3, contactNormal: V3, exact: boolean): DebrisImpact | null => {
    const e = world.engine;
    const v = t.prevVel;
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > 1e-3) {
      const dir = { x: v.x / speed, y: v.y / speed, z: v.z / speed };
      const hit = e.raycast(t.prevPos, dir, speed / 30 + t.piece.radius + 0.6, t.body);
      if (hit && !byCollider.has(hit.collider)) {
        const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z).normalize();
        const into = -(v.x * n.x + v.y * n.y + v.z * n.z);
        return { piece: t.piece, point: new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z), normal: n, speed: Math.max(0, into) };
      }
    }
    if (!exact) return null;
    const n = new THREE.Vector3(contactNormal.x, contactNormal.y, contactNormal.z).normalize();
    const into = Math.abs(v.x * n.x + v.y * n.y + v.z * n.z);
    return { piece: t.piece, point: new THREE.Vector3(contactPoint.x, contactPoint.y, contactPoint.z), normal: n, speed: into };
  };

  return {
    name: 'physics',

    add(piece) {
      dropStale();
      const e = world.engine;
      const o = piece.object;
      o.updateWorldMatrix(true, true);
      o.matrixWorld.decompose(_pos, _quat, _scale);
      const shape = debrisShape(piece.probes, piece.radius, _scale.x);
      const body = e.createBody({
        kind: 'dynamic',
        position: { x: _pos.x, y: _pos.y, z: _pos.z },
        rotation: { x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w },
        linvel: { x: piece.velocity.x, y: piece.velocity.y, z: piece.velocity.z },
        angvel: { x: piece.spin.x * SPIN_SCALE, y: piece.spin.y * SPIN_SCALE, z: piece.spin.z * SPIN_SCALE },
        ccd: true,
        linearDamping: LINEAR_DAMPING,
        angularDamping: ANGULAR_DAMPING,
      });
      const volume =
        shape.halfHeight > 0
          ? Math.PI * shape.radius ** 2 * (2 * shape.halfHeight) + (4 / 3) * Math.PI * shape.radius ** 3
          : (4 / 3) * Math.PI * shape.radius ** 3;
      _axisQ.copy(shape.rotation);
      const collider = e.createCollider(
        {
          shape: shape.halfHeight > 0 ? { kind: 'capsule', halfHeight: shape.halfHeight, radius: shape.radius } : { kind: 'ball', radius: shape.radius },
          offset: { x: shape.center.x, y: shape.center.y, z: shape.center.z },
          rotation: { x: _axisQ.x, y: _axisQ.y, z: _axisQ.z, w: _axisQ.w },
          density: shape.mass / volume,
          friction: DEBRIS_FRICTION,
          restitution: DEBRIS_RESTITUTION,
          contactEvents: true,
        },
        body,
      );
      const t: Tracked = {
        piece,
        body,
        collider,
        generation,
        impacted: false,
        frozen: false,
        prevVel: { x: piece.velocity.x, y: piece.velocity.y, z: piece.velocity.z },
        prevPos: { x: _pos.x, y: _pos.y, z: _pos.z },
        scale: _scale.clone(),
      };
      tracked.set(piece, t);
      byCollider.set(collider, t);
    },

    update(pieces, _dt, impacts) {
      dropStale();
      const e = world.engine;
      // First impacts from the step that just ran (the world steps before gore updates).
      for (const c of world.contacts()) {
        const ta = byCollider.get(c.a);
        const tb = byCollider.get(c.b);
        if (ta && tb) continue; // Piece on piece: no mark, and both keep waiting for a real surface.
        const t = ta ?? tb;
        if (!t || t.impacted) continue;
        t.impacted = true;
        // Contact normals point from a toward b; the surface's outward normal points toward the piece.
        const n = ta ? { x: -c.normal.x, y: -c.normal.y, z: -c.normal.z } : c.normal;
        const hit = impact(t, c.point, n, c.exact);
        if (hit) impacts(hit);
      }
      for (const piece of pieces) {
        const t = tracked.get(piece);
        if (!t || t.frozen) continue;
        writeBack(t);
        if (piece.age >= STATIC_AFTER) {
          e.setBodyKind(t.body, 'fixed');
          t.frozen = true;
          piece.asleep = true;
          continue;
        }
        piece.asleep = e.isSleeping(t.body);
        const v = e.linvel(t.body, _v);
        t.prevVel.x = v.x;
        t.prevVel.y = v.y;
        t.prevVel.z = v.z;
        const o = piece.object;
        o.updateWorldMatrix(true, false);
        _pos.setFromMatrixPosition(o.matrixWorld);
        t.prevPos.x = _pos.x;
        t.prevPos.y = _pos.y;
        t.prevPos.z = _pos.z;
      }
    },

    release(piece) {
      dropStale();
      const t = tracked.get(piece);
      if (!t) return;
      forget(t);
      world.engine.destroyBody(t.body);
    },
  };
}
