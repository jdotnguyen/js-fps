import * as THREE from 'three';
import { PLAYER_TUNING, type PlayerWorld } from '../actors/player.ts';
import { gridNodes, NavGraph } from '../ai/nav.ts';
import { LightController, type ControlledLight } from '../render/lights.ts';
import { CollisionWorld } from './collision.ts';
import { LightPool, type PooledSlot } from './lightPool.ts';
import type { World } from './world.ts';

/**
 * The "Location underground laboratory" model (bazz4r, CC-BY-4.0) as a walkable World, loaded with `?level=lab`.
 * scripts/fix-lab-glb.mjs prepares three files in public/assets/models/lab/:
 *   underground_lab.glb           merged render tiles, three materials, no textures
 *   underground_lab.colliders.bin int16 (1 cm) boxes from a voxelisation of the mesh, relative to `colliders.origin`
 *   underground_lab.json          bounds, main floor height, spawn point and ceiling-lamp candidates
 * It is a sandbox for judging the space: no doors, rooms, triggers or objectives, just walls, floors, lamps and nav.
 */

interface LabMeta {
  bounds: { min: [number, number, number]; max: [number, number, number] };
  colliders: { file: string; count: number; origin: [number, number, number]; unit: number };
  mainFloorY: number;
  /** Every level with real walkable area, lowest first. */
  floors: Array<{ y: number; area: number }>;
  spawn: { x: number; y: number; z: number };
  lamps: Array<{ x: number; y: number; z: number }>;
}

const DIR = 'assets/models/lab/';
const LAMP = { color: '#dcefff', intensity: 10, range: 10 };

export async function loadLabWorld(baseUrl: string, scene: THREE.Scene): Promise<World> {
  const base = baseUrl + DIR;
  const [meta, boxes, gltf] = await Promise.all([
    fetch(`${base}underground_lab.json`).then((r) => r.json() as Promise<LabMeta>),
    fetch(`${base}underground_lab.colliders.bin`).then((r) => r.arrayBuffer()),
    import('three/examples/jsm/loaders/GLTFLoader.js').then(({ GLTFLoader }) => new GLTFLoader().loadAsync(`${base}underground_lab.glb`)),
  ]);

  const group = new THREE.Group();
  group.name = 'lab';
  group.add(gltf.scene);
  // Collision: the baked boxes are int16 centimetres relative to the grid origin.
  const colliders = new CollisionWorld();
  const q = new Int16Array(boxes);
  const [ox, oy, oz] = meta.colliders.origin;
  const u = meta.colliders.unit;
  for (let i = 0; i < q.length; i += 6) {
    colliders.add({ min: [ox + q[i]! * u, oy + q[i + 1]! * u, oz + q[i + 2]! * u], max: [ox + q[i + 3]! * u, oy + q[i + 4]! * u, oz + q[i + 5]! * u] }, 'static', 'metal');
  }
  const playerWorld: PlayerWorld = { colliders, surfaceAt: () => 'metal' };

  // Lighting: a dim ambient plus the pool's eight nearest ceiling lamps (ADR-0002).
  group.add(new THREE.HemisphereLight(0x8fb0bd, 0x0e1215, 0.22));
  const lights = new LightController();
  const pool = new LightPool(group, 8);
  const slots: PooledSlot[] = meta.lamps.map((p, i) => {
    const item: ControlledLight = { name: `lab-lamp-${i}`, light: null, base: LAMP.intensity, pattern: 'steady', seed: i, emissives: [], emissiveBase: 0, shafts: [], shaftBase: 0, level: 1 };
    lights.items.push(item);
    return { item, position: new THREE.Vector3(p.x, p.y, p.z), color: new THREE.Color(LAMP.color), range: LAMP.range, priority: 0, score: 0 };
  });
  if (scene.fog instanceof THREE.FogExp2) scene.fog.density = 0.03;

  const floor = meta.mainFloorY;
  let nav: NavGraph | null = null;
  return {
    id: 'lab',
    group,
    lights,
    spawn: { position: new THREE.Vector3(meta.spawn.x, meta.spawn.y + PLAYER_TUNING.eyeHeight, meta.spawn.z), yaw: -Math.PI / 2 },
    bounds: new THREE.Box3(new THREE.Vector3(...meta.bounds.min), new THREE.Vector3(...meta.bounds.max)),
    playerWorld,
    checkpoints: [],
    defaultLocation: 'Underground Laboratory',
    // The map is multi-level, so nav samples each floor height; links between levels come from line of sight.
    navGraph: () =>
      (nav ??= new NavGraph({
        world: colliders,
        nodes: meta.floors.flatMap((f) =>
          gridNodes(colliders, { minX: meta.bounds.min[0], maxX: meta.bounds.max[0], minZ: meta.bounds.min[2], maxZ: meta.bounds.max[2], maxY: f.y + 0.3 }, 2),
        ),
      })),
    registerInteractions: () => () => {},
    attract(t, cam) {
      // A slow drift through the central hub behind the title menu.
      cam.position.set(-4 + Math.sin(t * 0.1) * 3, floor + 1.7 + Math.sin(t * 0.07) * 0.06, meta.spawn.z);
      cam.lookAt(8, floor + 1.3, meta.spawn.z + Math.sin(t * 0.13) * 3);
    },
    update(t, _dt, cameraPosition, reducedFlashing) {
      pool.assign(slots, cameraPosition);
      lights.update(t, reducedFlashing);
      pool.finish();
    },
  };
}
