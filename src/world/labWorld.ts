import * as THREE from 'three';
import { PLAYER_TUNING, type PlayerWorld } from '../actors/player.ts';
import { gridNodes, NavGraph } from '../ai/nav.ts';
import { LightController, type ControlledLight } from '../render/lights.ts';
import type { Materials } from '../render/materials.ts';
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
const LAMP = { color: '#dcefff', intensity: 45, range: 18 };

function applyLabMaterials(root: THREE.Object3D, materials: Materials): void {
  // Imported architectural meshes often have single-sided planes; DoubleSide prevents
  // upper floors/catwalks from looking transparent when viewed from below.
  const doubleCache = new Map<THREE.MeshStandardMaterial, THREE.MeshStandardMaterial>();
  const doubleSided = (base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
    let m = doubleCache.get(base);
    if (!m) {
      m = base.clone();
      m.side = THREE.DoubleSide;
      doubleCache.set(base, m);
    }
    return m;
  };

  const blueGlass = materials.glass.clone();
  blueGlass.color.setHex(0x6eaee0);
  blueGlass.opacity = 0.24;

  const byName: Record<string, { mat: THREE.Material; shadow: boolean }> = {
    lab_hub_floor: { mat: doubleSided(materials.labTile), shadow: true },
    lab_hub_wall: { mat: doubleSided(materials.labPanel), shadow: true },
    lab_hub_ceiling: { mat: doubleSided(materials.paintDark), shadow: true },
    lab_hub_prop: { mat: doubleSided(materials.steel), shadow: true },
    lab_east_floor: { mat: doubleSided(materials.labTile), shadow: true },
    lab_east_upper_floor: { mat: doubleSided(materials.diamond), shadow: true },
    lab_east_wall: { mat: doubleSided(materials.paintBone), shadow: true },
    lab_east_ceiling: { mat: doubleSided(materials.paintDark), shadow: true },
    lab_east_prop: { mat: doubleSided(materials.steel), shadow: true },
    lab_west_floor: { mat: doubleSided(materials.rubber), shadow: true },
    lab_west_wall: { mat: doubleSided(materials.paintTeal), shadow: true },
    lab_west_ceiling: { mat: doubleSided(materials.concrete), shadow: true },
    lab_west_prop: { mat: doubleSided(materials.steel), shadow: true },
    lab_north_floor: { mat: doubleSided(materials.concrete), shadow: true },
    lab_north_wall: { mat: doubleSided(materials.concrete), shadow: true },
    lab_north_ceiling: { mat: doubleSided(materials.paintDark), shadow: true },
    lab_north_prop: { mat: doubleSided(materials.paintDark), shadow: true },
    glass: { mat: materials.glass, shadow: false },
    Material_44: { mat: blueGlass, shadow: false },
  };

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const entry = m?.name ? byName[m.name] : undefined;
    if (!entry) return;
    obj.material = entry.mat;
    obj.castShadow = entry.shadow;
    obj.receiveShadow = entry.shadow;
  });
}

/**
 * The lab's ceiling lamps as pooled slots sharing a fill pool of `fillLights` (render-lighting spec;
 * 12 on Low). No lamp opts in to shadows, so the lab has no shadow pool.
 */
export function labLamps(group: THREE.Object3D, lamps: ReadonlyArray<{ x: number; y: number; z: number }>, fillLights: number): { lights: LightController; pool: LightPool; slots: PooledSlot[] } {
  const lights = new LightController();
  const pool = new LightPool(group, fillLights);
  const slots: PooledSlot[] = lamps.map((p, i) => {
    const item: ControlledLight = { name: `lab-lamp-${i}`, light: null, base: LAMP.intensity, pattern: 'steady', seed: i, emissives: [], emissiveBase: 0, shafts: [], shaftBase: 0, level: 1 };
    lights.items.push(item);
    return { item, position: new THREE.Vector3(p.x, p.y, p.z), color: new THREE.Color(LAMP.color), range: LAMP.range, priority: 0, score: 0 };
  });
  return { lights, pool, slots };
}

export async function loadLabWorld(baseUrl: string, scene: THREE.Scene, materials: Materials, fillLights = 12): Promise<World> {
  const base = baseUrl + DIR;
  const [meta, boxes, gltf] = await Promise.all([
    fetch(`${base}underground_lab.json`).then((r) => r.json() as Promise<LabMeta>),
    fetch(`${base}underground_lab.colliders.bin`).then((r) => r.arrayBuffer()),
    import('../render/gltf.ts').then(({ createGltfLoader }) => createGltfLoader().then((l) => l.loadAsync(`${base}underground_lab.glb`))),
  ]);

  applyLabMaterials(gltf.scene, materials);
  const group = new THREE.Group();
  group.name = 'lab';
  group.add(gltf.scene);

  // Add a full-bounds ceiling cap so open-top cutaway areas don't show the void above.
  const [minX, , minZ] = meta.bounds.min;
  const [maxX, maxY, maxZ] = meta.bounds.max;
  const ceilW = maxX - minX;
  const ceilD = maxZ - minZ;
  const ceilGeo = new THREE.PlaneGeometry(ceilW, ceilD);
  const ceilUv = ceilGeo.getAttribute('uv');
  for (let i = 0; i < ceilUv.count; i++) {
    ceilUv.setXY(i, ceilUv.getX(i) * ceilW, ceilUv.getY(i) * ceilD);
  }
  const ceilMat = materials.paintDark.clone();
  ceilMat.side = THREE.DoubleSide;
  const ceiling = new THREE.Mesh(ceilGeo, ceilMat);
  ceiling.name = 'lab_roof_ceiling';
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set((minX + maxX) / 2, maxY, (minZ + maxZ) / 2);
  ceiling.receiveShadow = true;
  ceiling.castShadow = false;
  group.add(ceiling);
  // Collision: the baked boxes are int16 centimetres relative to the grid origin.
  const colliders = new CollisionWorld();
  const q = new Int16Array(boxes);
  const [ox, oy, oz] = meta.colliders.origin;
  const u = meta.colliders.unit;
  for (let i = 0; i < q.length; i += 6) {
    colliders.add({ min: [ox + q[i]! * u, oy + q[i + 1]! * u, oz + q[i + 2]! * u], max: [ox + q[i + 3]! * u, oy + q[i + 4]! * u, oz + q[i + 5]! * u] }, 'static', 'metal');
  }
  const playerWorld: PlayerWorld = { colliders, surfaceAt: () => 'metal' };

  // Lighting: bright ambient + hemisphere fill plus the tier's fill pool on the nearest ceiling lamps.
  group.add(new THREE.HemisphereLight(0xaad0de, 0x2a3338, 1.1));
  const { lights, pool, slots } = labLamps(group, meta.lamps, fillLights);
  if (scene.fog instanceof THREE.FogExp2) scene.fog.density = 0.014;

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
    setLightBudget(budget) {
      pool.resize(budget.fillLights);
    },
  };
}
