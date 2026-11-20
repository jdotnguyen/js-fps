import * as THREE from 'three';
import { PLAYER_TUNING, type PlayerWorld } from '../actors/player.ts';
import { gridNodes, NavGraph } from '../ai/nav.ts';
import { LightController } from '../render/lights.ts';
import { createDebugCheckerMaterial, type Materials } from '../render/materials.ts';
import { tileMaterial } from '../render/uvTiling.ts';
import { CollisionWorld } from './collision.ts';
import { boxUv, MergeBuilder } from './kit/geom.ts';
import { AoMergeBuilder } from './kit/merge.ts';
import { CORNER_H, cornerBoxes, type CornerBox } from './cornerLayout.ts';
import type { World } from './world.ts';

/**
 * L-shaped corner sandbox for checking texture tiling before it goes into real rooms.
 * Load with `?level=corner`. Query options:
 *   uv=world  (default) world-space metre UVs through AoMergeBuilder, the path kit rooms use
 *   uv=repeat per-wall `texture.repeat = (length / tile, height / tile)` on cloned materials
 *   uv=local  the old per-piece boxUv: every piece restarts its pattern at its own corner
 *   wall=<material key> / floor=<material key>   e.g. wall=concrete&floor=concreteFloor (default: 1 m debug checker)
 *   glb=<url>&h=<metres>&front=<-z|+z|-x|+x>    drop a GLB through normalizeGltf next to the corner
 *
 * Walls are cut into deliberately uneven pieces (2.7 + 3.1 + 2.2 m, ...) so a seam shows at
 * every cut if UVs are wrong. Plan view (x right, z down), room height 3.2 m:
 *
 *   (0,0) ───────────────── (8,0)
 *     │        arm A          │
 *     │   (inside corner      │
 *     │    at 0,0)            │
 *   (0,4)       (4,4) ─────── (8,4)
 *     │  arm B    │  ← outside corner at (4,4)
 *     │           │
 *   (0,10) ──── (4,10)
 */

export type CornerUvMode = 'world' | 'repeat' | 'local';

export interface CornerOptions {
  uv: CornerUvMode;
  wall: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
}

/** Build the room's meshes for one UV mode. */
export function buildCornerRoom(o: CornerOptions): THREE.Group {
  const boxes = cornerBoxes();
  const matFor = (b: CornerBox): THREE.MeshStandardMaterial => (b.kind === 'wall' ? o.wall : o.floor);
  const at = (b: CornerBox): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(...b.center);

  if (o.uv === 'world') {
    const mb = new AoMergeBuilder();
    for (const b of boxes) mb.add(new THREE.BoxGeometry(...b.size), matFor(b), at(b));
    return mb.build('corner:world', null);
  }
  if (o.uv === 'local') {
    const mb = new MergeBuilder();
    for (const b of boxes) mb.add(boxUv(...b.size, 1), matFor(b), at(b));
    return mb.build('corner:local');
  }
  // repeat: plain 0..1 UVs, one tiled material clone per box sized to its visible face.
  const group = new THREE.Group();
  group.name = 'corner:repeat';
  for (const b of boxes) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...b.size), tileMaterial(matFor(b), b.faceSize[0], b.faceSize[1]));
    mesh.position.set(...b.center);
    mesh.name = `corner:${b.name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function pickMaterial(materials: Materials, key: string | null, checker: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  if (!key || key === 'checker') return checker();
  const m = (materials as unknown as Record<string, THREE.Material | undefined>)[key];
  if (m instanceof THREE.MeshStandardMaterial) return m;
  console.warn(`[corner] no material '${key}'; using the debug checker`);
  return checker();
}

export async function loadCornerWorld(scene: THREE.Scene, materials: Materials, params: URLSearchParams): Promise<World> {
  const uvParam = params.get('uv');
  const uv: CornerUvMode = uvParam === 'repeat' || uvParam === 'local' ? uvParam : 'world';
  let checker: THREE.MeshStandardMaterial | null = null;
  const getChecker = (): THREE.MeshStandardMaterial => (checker ??= createDebugCheckerMaterial(8));
  const wall = pickMaterial(materials, params.get('wall'), getChecker);
  const floor = pickMaterial(materials, params.get('floor'), getChecker);

  const group = new THREE.Group();
  group.name = 'corner';
  group.add(buildCornerRoom({ uv, wall, floor }));

  const colliders = new CollisionWorld();
  for (const b of cornerBoxes()) {
    const h = b.size.map((v) => v / 2);
    colliders.add(
      { min: [b.center[0] - h[0]!, b.center[1] - h[1]!, b.center[2] - h[2]!], max: [b.center[0] + h[0]!, b.center[1] + h[1]!, b.center[2] + h[2]!] },
      'static',
      'metal',
    );
  }
  const playerWorld: PlayerWorld = { colliders, surfaceAt: () => 'metal' };

  // Even, readable light: the point is to judge the texture, not the mood.
  group.add(new THREE.HemisphereLight(0xdfe8ee, 0x3a4248, 1.4));
  for (const [x, z] of [[2, 2], [6, 2], [2, 7]] as const) {
    const l = new THREE.PointLight(0xfff1dc, 14, 9, 2);
    l.position.set(x, CORNER_H - 0.3, z);
    group.add(l);
  }
  if (scene.fog instanceof THREE.FogExp2) scene.fog.density = 0.01;

  const glbUrl = params.get('glb');
  if (glbUrl) {
    const { createGltfLoader, normalizeGltf } = await import('../render/gltf.ts');
    const loader = await createGltfLoader();
    const gltf = await loader.loadAsync(glbUrl);
    const h = Number(params.get('h'));
    const front = params.get('front');
    const model = normalizeGltf(gltf.scene, {
      ...(h > 0 ? { height: h } : {}),
      ...(front === '+z' || front === '-z' || front === '+x' || front === '-x' ? { front } : {}),
    });
    // Stand it in arm A, facing the player's spawn (+Z faces into the room from here).
    model.root.position.set(5, 0, 1.2);
    model.root.rotation.y = Math.PI;
    group.add(model.root);
    console.info(`[corner] ${glbUrl}: ${model.size.toArray().map((v) => v.toFixed(2)).join(' x ')} m, scale ${model.scale.toFixed(4)}`);
  }

  console.info(`[corner] uv=${uv} wall=${wall.name} floor=${floor.name}`);
  const lights = new LightController();
  let nav: NavGraph | null = null;
  return {
    id: 'corner',
    group,
    lights,
    // Arm B, looking north up toward both corners.
    spawn: { position: new THREE.Vector3(2, PLAYER_TUNING.eyeHeight, 8.5), yaw: 0 },
    bounds: new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(8.5, CORNER_H + 0.5, 10.5)),
    playerWorld,
    checkpoints: [],
    defaultLocation: 'Corner test',
    navGraph: () => (nav ??= new NavGraph({ world: colliders, nodes: gridNodes(colliders, { minX: 0, maxX: 8, minZ: 0, maxZ: 10, maxY: 0.3 }, 1) })),
    registerInteractions: () => () => {},
    attract(t, cam) {
      cam.position.set(2 + Math.sin(t * 0.1) * 0.8, 1.7, 8.5);
      cam.lookAt(2, 1.4, 0);
    },
    update(t, _dt, _cameraPosition, reducedFlashing) {
      lights.update(t, reducedFlashing);
    },
  };
}
