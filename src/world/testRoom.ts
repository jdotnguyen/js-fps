import * as THREE from 'three';
import type { Rng } from '../core/rng.ts';

/**
 * Placeholder grey room proving the loop (ADR-0001). Replaced by kit levels in ADR-0003.
 * 12 m x 3.2 m x 16 m, origin at floor centre.
 */
export function buildTestRoom(rng: Rng): THREE.Group {
  const room = new THREE.Group();
  room.name = 'test-room';
  const W = 12;
  const H = 3.2;
  const D = 16;
  const T = 0.2;

  const wall = new THREE.MeshStandardMaterial({ color: 0x6b7378, roughness: 0.85, metalness: 0.2 });
  const floor = new THREE.MeshStandardMaterial({ color: 0x3c4246, roughness: 0.95, metalness: 0.1 });
  const crate = new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.8 });

  const slab = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material): void => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    room.add(mesh);
  };

  slab(W, T, D, 0, -T / 2, 0, floor);
  slab(W, T, D, 0, H + T / 2, 0, wall);
  slab(T, H, D, -W / 2 - T / 2, H / 2, 0, wall);
  slab(T, H, D, W / 2 + T / 2, H / 2, 0, wall);
  slab(W, H, T, 0, H / 2, -D / 2 - T / 2, wall);
  slab(W, H, T, 0, H / 2, D / 2 + T / 2, wall);

  // Seeded clutter so determinism is visible: same seed, same layout.
  for (let i = 0; i < 8; i++) {
    const s = rng.range(0.6, 1.2);
    slab(s, s, s, rng.range(-W / 2 + 1, W / 2 - 1), s / 2, rng.range(-D / 2 + 1, D / 2 - 3), crate);
  }

  room.add(new THREE.HemisphereLight(0x8fa3ad, 0x1b1f22, 0.6));
  const lamp = new THREE.PointLight(0xffe2b0, 18, 14, 2);
  lamp.position.set(0, H - 0.3, -2);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  room.add(lamp);
  return room;
}
