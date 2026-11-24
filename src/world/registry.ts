import * as THREE from 'three';
import type { Rng } from '../core/rng.ts';
import { yieldFrame } from '../core/yieldFrame.ts';
import { obj, record, str, type Validator } from '../core/validate.ts';
import type { KitIds } from '../data/types/level.ts';
import { disposeTexture, type Materials } from '../render/materials.ts';
import { PROP_PIECES } from './kit/props.ts';
import { STRUCTURE_PIECES } from './kit/structure.ts';
import { SLICE_PROPS, SLICE_STRUCTURE } from './kit/slice.ts';
import { DIVE_BAY_PROPS } from './kit/diveBay.ts';
import { IMPORTED_PROP_PIECES } from './kit/importedProps.ts';
import { LAB_WING_PROPS } from './kit/labWing.ts';
import { TRANSIT_PROPS } from './kit/transit.ts';
import { applyPlacementFx } from './kit/placementFx.ts';
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
 * Pivot: floor centre, facing -Z, metres. Write-up: docs/imported-props.md.
 *
 * Imported props (spec imported-props, kit/importedProps.ts) work differently: their procedural piece is a
 * stand-in that owns colliders, surfaces, spots and keep-outs, and the model only replaces its visible meshes.
 * Their materials keep their own UVs (`userData.keepUvs`), and `PART_*` hinge nodes and see-through meshes stay
 * unmerged (`userData.dynamic`). A model that fails to load leaves the stand-in in place, with one warning.
 */

export interface KitManifest {
  glb: Record<string, string>;
}

export const validateKitManifest: Validator<KitManifest> = obj({ glb: record(str) });

/** Every built-in kit piece (procedural generators and imported-prop stand-ins). */
export const KIT_PIECES: readonly PieceDef[] = [...STRUCTURE_PIECES, ...PROP_PIECES, ...SLICE_STRUCTURE, ...SLICE_PROPS, ...DIVE_BAY_PROPS, ...LAB_WING_PROPS, ...TRANSIT_PROPS, ...IMPORTED_PROP_PIECES];

export class KitRegistry {
  private readonly defs = new Map<string, PieceDef>();
  private readonly glbs = new Map<string, THREE.Group>();
  /** One `keepUvs` clone per palette slot, shared by every imported prop drawn with that slot (`material` param). */
  private readonly slotClones = new Map<string, THREE.Material>();
  private readonly manifest: KitManifest;

  constructor(manifest: KitManifest, defs: readonly PieceDef[] = KIT_PIECES) {
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

  /**
   * Load every GLB the manifest lists for the given IDs (call before create). An imported prop whose model fails
   * to load keeps its stand-in, with one warning naming the id; any other kit GLB failing is an error.
   * When using the browser GLTF path, files download in parallel and parse with frame yields so loading UI stays smooth.
   */
  async preload(
    ids: Iterable<string>,
    load?: (url: string) => Promise<{ scene: THREE.Group }>,
    onProgress?: (done: number, total: number, id: string) => void,
    /** Between parses; the title passes one that waits for the menu to go idle. Defaults to the next frame. */
    yieldTo: () => Promise<void> = yieldFrame,
  ): Promise<void> {
    const wanted = [...new Set(ids)].filter((id) => this.manifest.glb[id] && !this.glbs.has(id));
    if (!wanted.length) return;
    let done = 0;
    const total = wanted.length;
    if (load) {
      await Promise.all(
        wanted.map(async (id) => {
          const url = this.manifest.glb[id]!;
          const imported = this.defs.get(id)?.importedProp === true;
          try {
            const gltf = await load(url);
            if (imported) tagImported(gltf.scene);
            this.glbs.set(id, gltf.scene);
          } catch (e) {
            if (!imported) throw e;
            console.warn(`[kit] imported prop "${id}": model failed to load (${url}); showing its stand-in. ${(e as Error).message ?? ''}`);
          } finally {
            done++;
            onProgress?.(done, total, id);
          }
        }),
      );
      return;
    }

    const { createGltfLoader } = await import('../render/gltf.ts');
    const loader = await createGltfLoader();
    // Fetch all raw GLB buffers in parallel, then parse sequentially with frame yields to avoid CPU stalls.
    const fetched = await Promise.all(
      wanted.map(async (id) => {
        const url = this.manifest.glb[id]!;
        const imported = this.defs.get(id)?.importedProp === true;
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return { id, url, imported, buffer: await res.arrayBuffer(), error: null as unknown };
        } catch (error) {
          return { id, url, imported, buffer: null as ArrayBuffer | null, error };
        }
      }),
    );

    for (const item of fetched) {
      try {
        if (!item.buffer) throw item.error ?? new Error('missing buffer');
        const slash = item.url.lastIndexOf('/');
        const baseDir = slash >= 0 ? item.url.slice(0, slash + 1) : '';
        const gltf = await loader.parseAsync(item.buffer, baseDir);
        if (item.imported) tagImported(gltf.scene);
        this.glbs.set(item.id, gltf.scene);
      } catch (e) {
        if (!item.imported) throw e;
        console.warn(`[kit] imported prop "${item.id}": model failed to load (${item.url}); showing its stand-in. ${(e as Error).message ?? ''}`);
      }
      done++;
      onProgress?.(done, total, item.id);
      await yieldTo();
    }
  }

  /** An imported prop's recorded cost (null for any other piece). */
  importedCost(id: string): { materials: number; triangles: number; standInTriangles: number } | null {
    return this.defs.get(id)?.importedCost ?? null;
  }

  /**
   * The `material` param of an imported prop: draw the model with a palette slot (e.g. the bloom growths with
   * `bloom`) instead of its own textures. The clone shares the slot's textures and keeps the model's UVs.
   */
  private slotMaterial(params: PieceParams, m: Materials): THREE.Material | null {
    const key = params['material'];
    if (typeof key !== 'string') return null;
    let clone = this.slotClones.get(key);
    if (!clone) {
      const base = (m as unknown as Record<string, THREE.Material | undefined>)[key];
      if (!base) {
        console.warn(`[kit] material "${key}" is not a palette slot; keeping the model's own`);
        return null;
      }
      clone = base.clone();
      clone.name = `${base.name || key}:imported`;
      clone.userData['keepUvs'] = true;
      this.slotClones.set(key, clone);
    }
    return clone;
  }

  source(id: string): 'glb' | 'procedural' {
    return this.glbs.has(id) ? 'glb' : 'procedural';
  }

  create(id: string, params: PieceParams, rng: Rng, m: Materials): PieceOutput {
    return applyPlacementFx(this.createBase(id, params, rng, m), params);
  }

  private createBase(id: string, params: PieceParams, rng: Rng, m: Materials): PieceOutput {
    const glb = this.glbs.get(id);
    const def = this.defs.get(id);
    if (glb && def?.importedProp) return withModel(def.generate(params, rng, m), glb.clone(true), this.slotMaterial(params, m));
    if (glb) return fromGlb(glb.clone(true));
    if (!def) throw new Error(`unknown kit piece "${id}"`);
    return def.generate(params, rng, m);
  }

  /** Dispose all cached GLB templates, textures and cloned slot materials (session teardown). */
  dispose(): void {
    const geoms = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    const texSlots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap'] as const;
    for (const scene of this.glbs.values()) {
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        geoms.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!(m instanceof THREE.Material)) continue;
          mats.add(m);
          const rec = m as unknown as Record<string, unknown>;
          for (const slot of texSlots) {
            const t = rec[slot];
            if (t instanceof THREE.Texture) textures.add(t);
          }
        }
      });
    }
    for (const g of geoms) g.dispose();
    for (const t of textures) disposeTexture(t);
    for (const m of mats) m.dispose();
    for (const m of this.slotClones.values()) m.dispose();
    this.glbs.clear();
    this.slotClones.clear();
  }
}

const v3 = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];

/** Mark an imported model once at load: its materials keep their own UVs (clones share the materials). */
function tagImported(scene: THREE.Object3D): void {
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const mat of Array.isArray(o.material) ? o.material : [o.material]) mat.userData['keepUvs'] = true;
  });
}

/**
 * Swap a stand-in's visible meshes for the model; everything else (colliders, surfaces, spots, keep-outs, sockets,
 * light slots) stays the stand-in's. Hinged `PART_*` nodes and see-through meshes become direct children marked
 * dynamic, so the room merger leaves them separate.
 */
export function withModel(out: PieceOutput, model: THREE.Object3D, material: THREE.Material | null = null): PieceOutput {
  for (const child of [...out.object.children]) {
    child.removeFromParent();
    child.traverse((c) => {
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    });
  }
  if (material) model.traverse((o) => void (o instanceof THREE.Mesh && (o.material = material)));
  out.object.add(model);
  out.object.updateMatrixWorld(true);
  const lift: THREE.Object3D[] = [];
  model.traverse((o) => {
    if (o.name.startsWith('PART_')) lift.push(o);
    else if (o instanceof THREE.Mesh && !lift.some((p) => isInside(o, p))) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some((x) => x.transparent)) lift.push(o);
    }
  });
  for (const o of lift) {
    if (lift.some((p) => p !== o && isInside(o, p))) continue;
    out.object.attach(o);
    o.userData['dynamic'] = true;
  }
  return out;
}

const isInside = (o: THREE.Object3D, ancestor: THREE.Object3D): boolean => {
  for (let x = o.parent; x; x = x.parent) if (x === ancestor) return true;
  return false;
};

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
