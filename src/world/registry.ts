import * as THREE from 'three';
import type { Rng } from '../core/rng.ts';
import { obj, record, str, type Validator } from '../core/validate.ts';
import type { KitIds } from '../data/types/level.ts';
import type { Materials } from '../render/materials.ts';
import { PROP_PIECES } from './kit/props.ts';
import { STRUCTURE_PIECES } from './kit/structure.ts';
import { SLICE_PROPS, SLICE_STRUCTURE } from './kit/slice.ts';
import {
  LIGHT_SLOT_KINDS,
  SURFACE_MATERIALS,
  type BoxSpec,
  type LightSlotKind,
  type PieceDef,
  type PieceOutput,
  type PieceParams,
  type SurfaceMaterial,
  type Vec3,
} from './kit/types.ts';

/**
 * Resolves a kit ID to geometry (ADR-0003). If data/kit-manifest.json maps the ID to a
 * GLB, the model is used; otherwise the procedural generator runs. GLB conventions:
 *   COL_*            mesh, its bounding box becomes a collider (hidden)
 *   SURF_<mat>_*     mesh, collider with a footstep surface (metal|grate|rubber|water)
 *   SOCKET_<name>    empty, connection point; its -Z axis is the direction
 *   LIGHT_<kind>_*   empty, light slot (ceiling|wall|emergency)
 *   NAV_*            empty, walkable point for ADR-0007
 * Pivot: floor centre, facing -Z, metres. Full write-up goes in docs/kit-authoring.md
 * with the first real GLB.
 */

export interface KitManifest {
  glb: Record<string, string>;
}

export const validateKitManifest: Validator<KitManifest> = obj({ glb: record(str) });

export class KitRegistry {
  private readonly defs = new Map<string, PieceDef>();
  private readonly glbs = new Map<string, THREE.Group>();
  private readonly manifest: KitManifest;

  constructor(manifest: KitManifest, defs: PieceDef[] = [...STRUCTURE_PIECES, ...PROP_PIECES, ...SLICE_STRUCTURE, ...SLICE_PROPS]) {
    this.manifest = manifest;
    for (const d of defs) {
      if (this.defs.has(d.id)) throw new Error(`kit id "${d.id}" registered twice`);
      this.defs.set(d.id, d);
    }
  }

  ids(): KitIds {
    const structure = new Set<string>();
    const prop = new Set<string>();
    for (const d of this.defs.values()) (d.family === 'prop' ? prop : structure).add(d.id);
    return { structure, prop };
  }

  /** Load every GLB the manifest lists for the given IDs (call before create). */
  async preload(ids: Iterable<string>): Promise<void> {
    const wanted = [...new Set(ids)].filter((id) => this.manifest.glb[id] && !this.glbs.has(id));
    if (!wanted.length) return;
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    await Promise.all(
      wanted.map(async (id) => {
        const url = this.manifest.glb[id]!;
        const gltf = await loader.loadAsync(url);
        this.glbs.set(id, gltf.scene);
      }),
    );
  }

  source(id: string): 'glb' | 'procedural' {
    return this.glbs.has(id) ? 'glb' : 'procedural';
  }

  create(id: string, params: PieceParams, rng: Rng, m: Materials): PieceOutput {
    const glb = this.glbs.get(id);
    if (glb) return fromGlb(glb.clone(true));
    const def = this.defs.get(id);
    if (!def) throw new Error(`unknown kit piece "${id}"`);
    return def.generate(params, rng, m);
  }
}

const v3 = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];

function boxOf(o: THREE.Object3D): BoxSpec {
  const b = new THREE.Box3().setFromObject(o);
  return { min: v3(b.min), max: v3(b.max) };
}

/** Read the named-empty conventions out of a GLB scene. */
export function fromGlb(scene: THREE.Group): PieceOutput {
  scene.updateMatrixWorld(true);
  const out: PieceOutput = { object: new THREE.Group(), colliders: [], sockets: [], lightSlots: [], navNodes: [], surfaces: [] };
  const remove: THREE.Object3D[] = [];
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  scene.traverse((o) => {
    const name = o.name;
    if (name.startsWith('COL_')) {
      out.colliders.push(boxOf(o));
      remove.push(o);
    } else if (name.startsWith('SURF_')) {
      const mat = name.split('_')[1]?.toLowerCase() ?? '';
      const box = boxOf(o);
      out.colliders.push(box);
      if ((SURFACE_MATERIALS as readonly string[]).includes(mat)) out.surfaces.push({ box, material: mat as SurfaceMaterial });
      remove.push(o);
    } else if (name.startsWith('SOCKET_')) {
      o.getWorldPosition(p);
      o.getWorldQuaternion(q);
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      out.sockets.push({ name: name.slice(7), pos: v3(p), dir: v3(dir) });
    } else if (name.startsWith('LIGHT_')) {
      const kind = name.split('_')[1]?.toLowerCase() ?? '';
      o.getWorldPosition(p);
      if ((LIGHT_SLOT_KINDS as readonly string[]).includes(kind)) out.lightSlots.push({ pos: v3(p), kind: kind as LightSlotKind, ry: 0 });
    } else if (name.startsWith('NAV_')) {
      o.getWorldPosition(p);
      out.navNodes.push({ pos: v3(p) });
    }
  });
  for (const o of remove) o.removeFromParent();
  out.object.add(scene);
  return out;
}
