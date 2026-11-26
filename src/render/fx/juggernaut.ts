import * as THREE from 'three';

/**
 * The creature of the R16 finale ("Juggernaut" GLB, see CREDITS.md). It is loaded with the session and added to the
 * scene hidden, so the loading screen uploads its textures and builds its shaders; the reveal only shows and places it
 * (session-loading "Late-appearing models load with the session", openspec stop-midgame-shader-stalls D4).
 */

export const JUGGERNAUT_URL = 'assets/models/infected/monster_juggernaut.glb';
/** The level anchors of its entrance: where it waits behind the pillar, and where it peeks out to. */
export const JUGGERNAUT_HIDE_ANCHOR = 'r16_monster_hide';
export const JUGGERNAUT_REVEAL_ANCHOR = 'r16_monster_reveal';

/** Height it is scaled to (m). */
const HEIGHT = 5.1;
/** Seconds from behind the pillar to fully revealed. */
const ENTRANCE_SECONDS = 5.2;
/** The forward head marker stays on the exposed face as it peeks around the pillar. */
const HEAD_NODE = 'head_ik_094';
/** The squad aims this far above the head marker (m). */
const AIM_ABOVE_HEAD = 0.8;

export interface Anchor {
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  readonly yaw: number;
}

export type ModelLoader = (url: string) => Promise<{ scene: THREE.Object3D }>;

const gltfLoader: ModelLoader = async (url) => {
  const { createGltfLoader } = await import('../gltf.ts');
  return (await createGltfLoader()).loadAsync(url);
};

export class Juggernaut {
  readonly root: THREE.Group;
  private readonly head: THREE.Object3D | undefined;
  private readonly start = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private t = 0;
  private active = false;

  constructor(scene: THREE.Object3D) {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    scene.traverse((c) => {
      if (!(c instanceof THREE.Mesh)) return;
      // This export's detail meshes are bound hundreds of units above the body.
      if (!Array.isArray(c.material) && c.material.name === 'details') {
        c.visible = false;
        return;
      }
      box.expandByObject(c);
      c.frustumCulled = false;
      c.castShadow = true;
      c.receiveShadow = true;
    });
    const scale = HEIGHT / Math.max(0.01, box.max.y - box.min.y);
    const centre = box.getCenter(new THREE.Vector3());
    scene.scale.setScalar(scale);
    scene.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
    this.head = scene.getObjectByName(HEAD_NODE);
    this.root = new THREE.Group();
    this.root.name = 'r16_juggernaut';
    this.root.add(scene);
    this.root.visible = false;
  }

  /** Show it behind the pillar and start its entrance. A missing anchor keeps the last place it was given. */
  reveal(hide: Anchor | null, peek: Anchor | null): void {
    if (hide) this.start.set(hide.pos.x, hide.pos.y, hide.pos.z);
    if (peek) {
      this.end.set(peek.pos.x, peek.pos.y, peek.pos.z);
      this.root.rotation.y = peek.yaw;
    }
    this.t = 0;
    this.active = true;
    this.root.position.copy(this.start);
    this.root.visible = true;
  }

  hide(): void {
    this.active = false;
    this.root.visible = false;
  }

  /** One simulation step of the entrance. */
  update(dt: number): void {
    if (!this.active) return;
    this.t = Math.min(1, this.t + dt / ENTRANCE_SECONDS);
    const ease = this.t * this.t * (3 - 2 * this.t);
    this.root.position.lerpVectors(this.start, this.end, ease);
  }

  /** Where the squad aims, or null when the model has no head marker. */
  aimPoint(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.head) return null;
    this.head.getWorldPosition(out);
    out.y += AIM_ABOVE_HEAD;
    return out;
  }

  /** Take it out of the scene and release its geometry, materials, textures and skeletons. */
  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    const skeletons = new Set<THREE.Skeleton>();
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      geometries.add(o.geometry);
      if (o instanceof THREE.SkinnedMesh) skeletons.add(o.skeleton);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        materials.add(m);
        for (const value of Object.values(m)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    for (const g of geometries) g.dispose();
    for (const s of skeletons) s.dispose();
    for (const t of textures) t.dispose();
    for (const m of materials) m.dispose();
    this.root.removeFromParent();
  }
}

/** Load and prepare the creature, or null (with a warning) when its model cannot be loaded. */
export async function loadJuggernaut(baseUrl = '/', load: ModelLoader = gltfLoader): Promise<Juggernaut | null> {
  const url = baseUrl.replace(/\/?$/, '/') + JUGGERNAUT_URL;
  try {
    return new Juggernaut((await load(url)).scene);
  } catch (err) {
    console.warn(`[r16] failed to load ${JUGGERNAUT_URL}; the finale runs without the creature`, err);
    return null;
  }
}
