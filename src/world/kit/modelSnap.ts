import * as THREE from 'three';
import type { Socket } from './types.ts';

export interface ModelBounds {
  box: THREE.Box3;
  size: THREE.Vector3;
  center: THREE.Vector3;
}

export interface SnapOptions {
  /** Uniformly scale the model so its bounding-box height (Y) equals this value in metres. */
  targetHeight?: number;
  /** Uniformly scale the model so its bounding-box width (X) equals this value in metres. */
  targetWidth?: number;
  /** Offset (m) along the socket's outward direction to prevent z-fighting (default 0.004 for wall sockets). */
  inset?: number;
  /** Extra rotation around Y in radians after aligning to socket.dir. */
  yawOffset?: number;
}

/** Measure a model's world-space axis-aligned bounding box in metres. */
export function measureBounds(object: THREE.Object3D): ModelBounds {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  return { box, size, center };
}

/**
 * Snap a 3D model onto a designated floor, wall, or door socket at true-to-life FPS scale.
 * - `floor` / `door`: rests `min.y` cleanly on `socket.pos[1]` (y = 0 floor), centred in X/Z, facing `socket.dir`.
 * - `wall`: rotates to face `socket.dir` (inward into room), centres X/Y on `socket.pos`, and places
 *   the model's back face flush against the wall plane + `inset` (default 0.004 m).
 */
export function snapModelToSocket(model: THREE.Object3D, socket: Socket, options: SnapOptions = {}): ModelBounds {
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.set(1, 1, 1);

  const initial = measureBounds(model);
  if (options.targetHeight !== undefined && initial.size.y > 1e-6) {
    const s = options.targetHeight / initial.size.y;
    model.scale.setScalar(s);
  } else if (options.targetWidth !== undefined && initial.size.x > 1e-6) {
    const s = options.targetWidth / initial.size.x;
    model.scale.setScalar(s);
  }

  // Rotate so the model's -Z (or local front) aligns with socket.dir in XZ.
  const dir = new THREE.Vector3(socket.dir[0], 0, socket.dir[2]);
  if (dir.lengthSq() > 1e-6) {
    dir.normalize();
    const yaw = Math.atan2(-dir.x, -dir.z) + (options.yawOffset ?? 0);
    model.rotation.y = yaw;
  } else if (options.yawOffset) {
    model.rotation.y = options.yawOffset;
  }

  const rotated = measureBounds(model);
  const kind = socket.kind ?? 'floor';

  if (kind === 'wall') {
    const inset = options.inset ?? 0.004;
    const n = dir.lengthSq() > 1e-6 ? dir : new THREE.Vector3(0, 0, 1);
    // Project the rotated AABB onto the wall normal to find its back-most extent along -n.
    const halfDepth = (Math.abs(n.x) * rotated.size.x + Math.abs(n.z) * rotated.size.z) / 2;
    const targetCenterX = socket.pos[0] + n.x * (halfDepth + inset);
    const targetCenterZ = socket.pos[2] + n.z * (halfDepth + inset);
    model.position.set(
      targetCenterX - rotated.center.x,
      socket.pos[1] - rotated.center.y,
      targetCenterZ - rotated.center.z,
    );
  } else {
    model.position.set(
      socket.pos[0] - rotated.center.x,
      socket.pos[1] - rotated.box.min.y,
      socket.pos[2] - rotated.center.z,
    );
  }

  return measureBounds(model);
}
