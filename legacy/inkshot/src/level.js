import * as THREE from 'three';
import { toonBox, gradientMap } from './toon.js';

export const ARENA_HALF = 30;
const WALL_H = 6;
const EPS = 0.001;
/** Enemies hop over anything at or below this height; taller blocks stop them. */
export const LOW_HEIGHT = 1.1;

// x, z, width, height, depth, colour, base y
const BLOCKS = [
  [0, 0, 8, 1, 8, 0xf2c14e, 0], // centre platform
  [0, 0, 2, 3.4, 2, 0xe4572e, 0], // centre pillar
  [-14, -12, 3, 5, 3, 0x4d9de0, 0],
  [14, -12, 3, 5, 3, 0x4d9de0, 0],
  [-14, 12, 3, 5, 3, 0x4d9de0, 0],
  [14, 12, 3, 5, 3, 0x4d9de0, 0],
  [-22, 0, 2, 2.4, 10, 0x9b72cf, 0],
  [22, 0, 2, 2.4, 10, 0x9b72cf, 0],
  [0, -20, 10, 2.4, 2, 0x9b72cf, 0],
  [0, 20, 10, 2.4, 2, 0x9b72cf, 0],
  [-7, -17, 2, 1, 2, 0xff9f1c, 0],
  [8, 16, 2, 1, 2, 0xff9f1c, 0],
  [-18, 21, 2, 1, 2, 0xff9f1c, 0],
  [-18, 21, 1.4, 1, 1.4, 0xffbf69, 1],
  [19, -21, 2, 1, 2, 0xff9f1c, 0],
  [19, -21, 1.4, 1, 1.4, 0xffbf69, 1],
  [7, -8, 1.6, 1, 1.6, 0xff9f1c, 0],
  [-7, 8, 1.6, 1, 1.6, 0xff9f1c, 0],
  [-24, -22, 3, 1, 3, 0x2ec4b6, 0],
  [24, 22, 3, 1, 3, 0x2ec4b6, 0],
];

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#8fd694';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#7ec98a';
  g.fillRect(0, 0, 64, 64);
  g.fillRect(64, 64, 64, 64);
  g.strokeStyle = '#62b077';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 64, 64);
  g.strokeRect(64, 64, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(ARENA_HALF / 2, ARENA_HALF / 2);
  tex.anisotropy = 4;
  return tex;
}

export function buildLevel(scene) {
  const colliders = []; // every solid Box3 (player collides with all of them)
  const tall = []; // blocks enemies must walk around
  const low = []; // blocks enemies hop onto
  const solids = []; // meshes bullets can hit

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
    new THREE.MeshToonMaterial({ map: floorTexture(), gradientMap }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  solids.push(floor);

  const addBlock = (x, z, w, h, d, color, y0 = 0) => {
    const mesh = toonBox(w, h, d, color, { outline: 0.06 });
    mesh.position.set(x, y0 + h / 2, z);
    scene.add(mesh);
    solids.push(mesh);
    const box = new THREE.Box3(
      new THREE.Vector3(x - w / 2, y0, z - d / 2),
      new THREE.Vector3(x + w / 2, y0 + h, z + d / 2),
    );
    colliders.push(box);
    (box.max.y > LOW_HEIGHT ? tall : low).push(box);
  };

  const span = ARENA_HALF * 2 + 2;
  const edge = ARENA_HALF + 0.5;
  addBlock(0, -edge, span, WALL_H, 1, 0xf7ede2);
  addBlock(0, edge, span, WALL_H, 1, 0xf7ede2);
  addBlock(-edge, 0, 1, WALL_H, span, 0xf5cac3);
  addBlock(edge, 0, 1, WALL_H, span, 0xf5cac3);
  for (const b of BLOCKS) addBlock(...b);

  // Sky dressing: flat shapes that ignore fog so they read as graphic elements.
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(9, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff3b0, fog: false }),
  );
  sun.position.set(50, 55, -110);
  sun.lookAt(0, 0, 0);
  scene.add(sun);

  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const cloudSpots = [[-60, 38, -90, 26], [30, 46, -120, 34], [90, 34, 20, 22], [-90, 42, 50, 30], [10, 40, 110, 28]];
  for (const [x, y, z, w] of cloudSpots) {
    const cloud = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const puff = new THREE.Mesh(new THREE.BoxGeometry(w * (0.5 + i * 0.25), 4 - i, 10), cloudMat);
      puff.position.set((i - 1) * w * 0.2, -i * 1.5, 0);
      cloud.add(puff);
    }
    cloud.position.set(x, y, z);
    cloud.lookAt(0, y, 0);
    scene.add(cloud);
  }

  const s = ARENA_HALF - 4;
  const spawns = [[-s, -s], [s, -s], [-s, s], [s, s], [0, -s], [0, s], [-s, 0], [s, 0]];

  return { colliders, tall, low, solids, spawns };
}

function overlaps(pos, r, h, b) {
  return (
    pos.x + r > b.min.x && pos.x - r < b.max.x &&
    pos.z + r > b.min.z && pos.z - r < b.max.z &&
    pos.y + h > b.min.y && pos.y < b.max.y
  );
}

/**
 * Moves an upright box (feet at `pos`, half-width `r`, height `h`) one axis at
 * a time, pushing it out of any collider it enters. Returns true if grounded.
 */
export function moveAndCollide(pos, vel, dt, r, h, colliders) {
  let grounded = false;

  pos.x += vel.x * dt;
  for (const b of colliders) {
    if (!overlaps(pos, r, h, b)) continue;
    pos.x = vel.x > 0 ? b.min.x - r - EPS : b.max.x + r + EPS;
    vel.x = 0;
  }

  pos.z += vel.z * dt;
  for (const b of colliders) {
    if (!overlaps(pos, r, h, b)) continue;
    pos.z = vel.z > 0 ? b.min.z - r - EPS : b.max.z + r + EPS;
    vel.z = 0;
  }

  pos.y += vel.y * dt;
  for (const b of colliders) {
    if (!overlaps(pos, r, h, b)) continue;
    if (vel.y <= 0) {
      pos.y = b.max.y;
      grounded = true;
    } else {
      pos.y = b.min.y - h - EPS;
    }
    vel.y = 0;
  }
  if (pos.y <= 0) {
    pos.y = 0;
    if (vel.y < 0) vel.y = 0;
    grounded = true;
  }
  return grounded;
}
