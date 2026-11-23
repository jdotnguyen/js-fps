import * as THREE from 'three';

/**
 * Something that moves and casts shadows (shadow-rich-rooms D4). Cached shadow maps redraw only when a
 * caster inside a light's reach changes, so every moving shadow caster registers here.
 */
export interface ShadowCaster {
  /** Writes the caster's world bounding sphere into `out`; false while it casts no shadow (hidden, out of range). */
  bounds(out: THREE.Sphere): boolean;
  /** Changes whenever the caster's shape or placement changes, and only then. */
  readonly version: number;
}

/**
 * A registry that holds its members weakly: an owner that is dropped without unregistering (a body a test never
 * disposes) is collected and leaves the registry, instead of being kept alive by it. Owners keep their member alive.
 */
export class WeakRegistry<T extends object> implements Iterable<T> {
  private readonly refs = new Set<WeakRef<T>>();
  private readonly byItem = new WeakMap<T, WeakRef<T>>();

  add(item: T): () => void {
    if (!this.byItem.has(item)) {
      const ref = new WeakRef(item);
      this.refs.add(ref);
      this.byItem.set(item, ref);
    }
    return () => this.delete(item);
  }

  delete(item: T): void {
    const ref = this.byItem.get(item);
    if (!ref) return;
    this.refs.delete(ref);
    this.byItem.delete(item);
  }

  /** Live members (collected ones are dropped as they are found). */
  get size(): number {
    let n = 0;
    for (const _ of this) n++;
    return n;
  }

  clear(): void {
    this.refs.clear();
  }

  *[Symbol.iterator](): Iterator<T> {
    for (const ref of this.refs) {
      const item = ref.deref();
      if (item) yield item;
      else this.refs.delete(ref);
    }
  }
}

/** The set of registered casters. One shared set serves the running world; tests make their own. */
export class ShadowCasterSet extends WeakRegistry<ShadowCaster> {}

/** Casters of the running world: characters, gore, doors and physics props register here. */
export const shadowCasters = new ShadowCasterSet();

/**
 * A caster for a rigid object: its version changes when its world matrix does, compared on each `bounds`
 * call (once per frame per light that tests it, so the compare runs at most a few times a frame).
 */
export class RigidCaster implements ShadowCaster {
  private readonly last = new THREE.Matrix4();
  private readonly local = new THREE.Sphere();
  private v = 0;
  readonly object: THREE.Object3D;

  constructor(object: THREE.Object3D, localBounds?: THREE.Sphere) {
    this.object = object;
    if (localBounds) this.local.copy(localBounds);
    else {
      const box = new THREE.Box3();
      object.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(object.matrixWorld).invert();
      object.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.computeBoundingBox();
          const b = o.geometry.boundingBox!.clone().applyMatrix4(o.matrixWorld).applyMatrix4(inv);
          box.union(b);
        }
      });
      if (box.isEmpty()) this.local.set(new THREE.Vector3(), 0.5);
      else box.getBoundingSphere(this.local);
    }
    this.last.copy(object.matrixWorld);
  }

  get version(): number {
    const m = this.object.matrixWorld;
    if (!m.equals(this.last)) {
      this.last.copy(m);
      this.v++;
    }
    return this.v;
  }

  bounds(out: THREE.Sphere): boolean {
    if (!this.object.visible || !this.object.parent) return false;
    out.copy(this.local).applyMatrix4(this.object.matrixWorld);
    return true;
  }
}

/**
 * A door's leaves as one caster: its version changes when any leaf moves (however the door is driven), and its
 * bounds are a sphere around the doorway while the door is drawn.
 */
export function doorCaster(leaves: THREE.Object3D, drawn: THREE.Object3D, center: THREE.Vector3, radius = 2.2): ShadowCaster {
  const last: number[] = [];
  let v = 0;
  const pose = (): number[] => {
    const out: number[] = [];
    for (const c of leaves.children) out.push(c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w);
    return out;
  };
  last.push(...pose());
  return {
    get version(): number {
      const now = pose();
      if (now.length !== last.length || now.some((x, i) => x !== last[i])) {
        last.length = 0;
        last.push(...now);
        v++;
      }
      return v;
    },
    bounds(out: THREE.Sphere): boolean {
      if (!drawn.visible) return false;
      out.center.copy(center);
      out.radius = radius;
      return true;
    },
  };
}

/** A caster whose owner bumps `version` itself (a skinned body, a door leaf, a cloud of gore). */
export class ManualCaster implements ShadowCaster {
  version = 0;
  private readonly boundsOf: (out: THREE.Sphere) => boolean;

  constructor(boundsOf: (out: THREE.Sphere) => boolean) {
    this.boundsOf = boundsOf;
  }

  bump(): void {
    this.version++;
  }

  bounds(out: THREE.Sphere): boolean {
    return this.boundsOf(out);
  }
}
