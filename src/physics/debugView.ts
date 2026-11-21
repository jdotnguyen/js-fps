/**
 * Physics collider view for `?debug` (adopt-physics-engine task 2.6; physics-world "Physics colliders can be
 * inspected"). Draws the static level mirror in grey (closed doors included, open ones hidden) and every body's
 * colliders coloured by state: active green, asleep blue, frozen (fixed body) amber, kinematic violet.
 * Loaded only in debug mode.
 */
import * as THREE from 'three';
import type { ColliderInfo, PhysicsEngine } from './engine.ts';

export const BODY_COLOURS = { active: 0x4cff7a, asleep: 0x4c9dff, frozen: 0xffb347, kinematic: 0xc77dff } as const;
const STATIC_COLOUR = 0x8a949a;

/** State shown for a body collider. */
export function bodyState(info: Pick<ColliderInfo, 'bodyKind' | 'sleeping'>): keyof typeof BODY_COLOURS {
  if (info.bodyKind === 'fixed') return 'frozen';
  if (info.bodyKind === 'kinematic') return 'kinematic';
  return info.sleeping ? 'asleep' : 'active';
}

const UNIT_BOX = new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2));
const UNIT_BALL = new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1, 1));

export class PhysicsDebugView {
  readonly group = new THREE.Group();
  private staticLines: THREE.LineSegments | null = null;
  private staticKey = '';
  private readonly bodyMeshes: THREE.LineSegments[] = [];
  private readonly capsules = new Map<string, THREE.BufferGeometry>();
  private readonly materials = Object.fromEntries(
    Object.entries(BODY_COLOURS).map(([k, c]) => [k, new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.9 })]),
  ) as Record<keyof typeof BODY_COLOURS, THREE.LineBasicMaterial>;
  private readonly staticMaterial = new THREE.LineBasicMaterial({ color: STATIC_COLOUR, transparent: true, opacity: 0.35 });
  /** Counts from the last update, for the debug panel. */
  readonly counts = { statics: 0, active: 0, asleep: 0, frozen: 0, kinematic: 0 };

  constructor() {
    this.group.name = 'physics-debug';
    this.group.renderOrder = 999;
  }

  set visible(on: boolean) {
    this.group.visible = on;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  /** Redraw from the engine; cheap when nothing static changed. Call once per rendered frame while visible. */
  update(engine: PhysicsEngine | null): void {
    if (!this.group.visible) return;
    const statics: ColliderInfo[] = [];
    const bodies: ColliderInfo[] = [];
    if (engine) engine.forEachCollider((c) => (c.body === null ? statics : bodies).push(c));
    this.updateStatics(statics);
    this.updateBodies(bodies);
  }

  dispose(): void {
    this.staticLines?.geometry.dispose();
    for (const g of this.capsules.values()) g.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    this.staticMaterial.dispose();
    this.group.removeFromParent();
  }

  private updateStatics(statics: ColliderInfo[]): void {
    const shown = statics.filter((c) => c.enabled && c.shape.kind === 'cuboid');
    this.counts.statics = shown.length;
    // Rebuild the merged static lines only when the set of enabled colliders changes (doors open or close).
    const key = `${statics.length}:${shown.map((c) => c.collider).join(',')}`;
    if (key === this.staticKey) return;
    this.staticKey = key;
    if (this.staticLines) {
      this.staticLines.geometry.dispose();
      this.group.remove(this.staticLines);
    }
    const edge = UNIT_BOX.getAttribute('position');
    const out = new Float32Array(shown.length * edge.count * 3);
    const v = new THREE.Vector3();
    let o = 0;
    for (const c of shown) {
      if (c.shape.kind !== 'cuboid') continue;
      const h = c.shape.halfExtents;
      for (let i = 0; i < edge.count; i++) {
        v.fromBufferAttribute(edge, i);
        out[o++] = c.position.x + v.x * h.x;
        out[o++] = c.position.y + v.y * h.y;
        out[o++] = c.position.z + v.z * h.z;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
    this.staticLines = new THREE.LineSegments(geo, this.staticMaterial);
    this.group.add(this.staticLines);
  }

  private updateBodies(bodies: ColliderInfo[]): void {
    this.counts.active = this.counts.asleep = this.counts.frozen = this.counts.kinematic = 0;
    while (this.bodyMeshes.length < bodies.length) {
      const m = new THREE.LineSegments(UNIT_BOX, this.materials.active);
      m.renderOrder = 999;
      this.bodyMeshes.push(m);
      this.group.add(m);
    }
    for (let i = 0; i < this.bodyMeshes.length; i++) {
      const mesh = this.bodyMeshes[i]!;
      const c = bodies[i];
      mesh.visible = c !== undefined;
      if (!c) continue;
      const state = bodyState(c);
      this.counts[state]++;
      mesh.material = this.materials[state];
      mesh.position.set(c.position.x, c.position.y, c.position.z);
      mesh.quaternion.set(c.rotation.x, c.rotation.y, c.rotation.z, c.rotation.w);
      const s = c.shape;
      if (s.kind === 'cuboid') {
        mesh.geometry = UNIT_BOX;
        mesh.scale.set(s.halfExtents.x, s.halfExtents.y, s.halfExtents.z);
      } else if (s.kind === 'ball') {
        mesh.geometry = UNIT_BALL;
        mesh.scale.setScalar(s.radius);
      } else {
        mesh.geometry = this.capsule(s.radius, s.halfHeight);
        mesh.scale.setScalar(1);
      }
    }
  }

  private capsule(radius: number, halfHeight: number): THREE.BufferGeometry {
    const key = `${radius.toFixed(3)}:${halfHeight.toFixed(3)}`;
    let g = this.capsules.get(key);
    if (!g) {
      g = new THREE.WireframeGeometry(new THREE.CapsuleGeometry(radius, halfHeight * 2, 3, 8));
      this.capsules.set(key, g);
    }
    return g;
  }
}
