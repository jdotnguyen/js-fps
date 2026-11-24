import * as THREE from 'three';
import type { Collider, CollisionWorld } from '../collision.ts';
import type { AoFn } from './merge.ts';

/** Distance from a point to a box (0 inside). */
function boxDistance(p: THREE.Vector3, c: Collider): number {
  const dx = Math.max(c.minX - p.x, 0, p.x - c.maxX);
  const dy = Math.max(c.minY - p.y, 0, p.y - c.maxY);
  const dz = Math.max(c.minZ - p.z, 0, p.z - c.maxZ);
  return Math.hypot(dx, dy, dz);
}

/**
 * Per-vertex AO from nearby colliders: a box darkens a vertex when it lies on the side
 * the vertex faces (so a wall never shades itself) and is close.
 */
export function colliderAo(world: CollisionWorld): AoFn {
  const q = new THREE.Vector3();
  const list: Collider[] = [];
  const R = 0.9;
  return (p, n) => {
    q.copy(p).addScaledVector(n, 0.12);
    world.find(q.x - R, q.z - R, q.x + R, q.z + R, list);
    let ao = 1;
    for (const c of list) {
      if (q.y < c.minY - R || q.y > c.maxY + R) continue;
      const cx = (c.minX + c.maxX) / 2 - p.x;
      const cy = (c.minY + c.maxY) / 2 - p.y;
      const cz = (c.minZ + c.maxZ) / 2 - p.z;
      if (cx * n.x + cy * n.y + cz * n.z <= 0) continue;
      const d = boxDistance(q, c);
      if (d > R) continue;
      ao *= 1 - 0.5 * Math.exp(-d / 0.3);
    }
    return Math.max(0.32, ao);
  };
}
