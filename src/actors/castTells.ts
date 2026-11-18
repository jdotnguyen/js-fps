import * as THREE from 'three';
import type { JointName } from './skeleton.ts';

/**
 * Cheap visible tells on a named character (ADR-0022 ladder): a bandage on the left forearm once
 * it is bandaged (stage 2), and at stage 3 dark veins and beads of sweat. Small meshes parented to
 * existing bones, built on first use and only toggled afterwards, so they follow the animation and
 * need no rebuild when a save is loaded. Pure three.js, no DOM.
 *
 * Bone space follows skeleton.ts: limbs hang along -Y from the joint, the head faces -Z with the
 * crown at y ~0.21 (see the glasses prop in bodyGeometry.ts).
 */
export interface Tells {
  bandage: boolean;
  /** 0..1: how visible the veins are. */
  veins: number;
  /** 0..1: how sweaty. */
  sweat: number;
}

export const NO_TELLS: Readonly<Tells> = { bandage: false, veins: 0, sweat: 0 };

type BoneOf = (name: JointName) => THREE.Object3D;

const GAUZE = new THREE.Color('#d9d4c6');
const GAUZE_STAIN = new THREE.Color('#5a3a30');
const VEIN = new THREE.Color('#2b2f4a');

/** Forearm radius at local y (segment 0.01 -> -0.25, r 0.046 -> 0.034), a little proud. */
const forearmR = (y: number): number => 0.046 + ((0.01 - y) / 0.26) * (0.034 - 0.046);

/** A point on the head ellipsoid (centre y 0.105) at yaw `a` (0 = straight ahead, -Z) and height `y`. */
function headPoint(a: number, y: number, lift = 0.001): THREE.Vector3 {
  const ry = 0.1;
  const k = Math.sqrt(Math.max(0, 1 - ((y - 0.105) / ry) ** 2));
  return new THREE.Vector3(Math.sin(a) * 0.082 * k * (1 + lift / 0.082), y, -Math.cos(a) * 0.099 * k * (1 + lift / 0.099));
}

function tube(points: THREE.Vector3[], r: number): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.max(6, points.length * 3), r, 4, false);
}

export class CastTells {
  readonly bandage = new THREE.Group();
  readonly veins = new THREE.Group();
  readonly sweat = new THREE.Group();
  private state: Tells = { ...NO_TELLS };
  private readonly mats: THREE.Material[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly veinMat: THREE.MeshStandardMaterial;
  private readonly sweatMat: THREE.MeshStandardMaterial;

  constructor(bone: BoneOf) {
    const gauze = new THREE.MeshStandardMaterial({ color: GAUZE, roughness: 0.92, metalness: 0 });
    const stain = new THREE.MeshStandardMaterial({ color: GAUZE_STAIN, roughness: 0.8, metalness: 0 });
    this.veinMat = new THREE.MeshStandardMaterial({ color: VEIN, roughness: 0.55, metalness: 0, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.sweatMat = new THREE.MeshStandardMaterial({ color: '#d4e6ee', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.7 });
    this.mats.push(gauze, stain, this.veinMat, this.sweatMat);

    // Bandage: a wrapped cuff over the sleeve, a few ridges, and a dark seep on the inner side.
    const wrap = new THREE.CylinderGeometry(0.057, 0.048, 0.14, 14, 1, true);
    wrap.translate(0, -0.095, 0);
    this.geos.push(wrap);
    const cuff = new THREE.Mesh(wrap, gauze);
    cuff.material.side = THREE.DoubleSide;
    this.bandage.add(cuff);
    for (const y of [-0.045, -0.085, -0.125, -0.16]) {
      const r = forearmR(y) + 0.0145;
      const ridge = new THREE.TorusGeometry(r, 0.0035, 5, 16);
      ridge.rotateX(Math.PI / 2);
      ridge.translate(0, y, 0);
      this.geos.push(ridge);
      this.bandage.add(new THREE.Mesh(ridge, gauze));
    }
    const seep = new THREE.SphereGeometry(0.02, 8, 6);
    seep.scale(1, 1.4, 0.35);
    seep.translate(0.0, -0.1, -0.052);
    this.geos.push(seep);
    this.bandage.add(new THREE.Mesh(seep, stain));
    this.bandage.name = 'tell:bandage';
    bone('foreArm_L').add(this.bandage);

    // Veins: branches from under the bandage down the forearm to the hand, and up the neck and temple.
    this.veins.name = 'tell:veins';
    const arm: THREE.Vector3[][] = [];
    for (const [a0, drift] of [[0.5, 0.6], [1.6, -0.5], [2.6, 0.4], [-0.6, -0.7]] as const) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 5; i++) {
        const y = -0.165 - i * 0.012;
        const a = a0 + drift * (i / 5) + Math.sin(i * 1.7 + a0) * 0.18;
        const r = forearmR(y) + 0.0008;
        pts.push(new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r));
      }
      arm.push(pts);
    }
    for (const pts of arm) {
      const g = tube(pts, 0.0017);
      this.geos.push(g);
      this.veins.add(new THREE.Mesh(g, this.veinMat));
    }
    bone('foreArm_L').add(this.veins);
    const face = new THREE.Group();
    face.name = 'tell:faceVeins';
    for (const [a0, y0, y1, drift] of [[-1.05, 0.04, 0.17, 0.3], [-0.8, 0.07, 0.2, -0.25], [1.0, 0.05, 0.16, -0.2]] as const) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        pts.push(headPoint(a0 + drift * t + Math.sin(t * 7 + a0) * 0.06, y0 + (y1 - y0) * t));
      }
      const g = tube(pts, 0.0015);
      this.geos.push(g);
      face.add(new THREE.Mesh(g, this.veinMat));
    }
    bone('head').add(face);
    const neck = new THREE.Group();
    neck.name = 'tell:neckVeins';
    for (const [a0, drift] of [[-0.9, 0.25], [0.7, -0.2]] as const) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        const a = a0 + drift * t;
        pts.push(new THREE.Vector3(Math.sin(a) * 0.052, 0.01 + t * 0.07, -Math.cos(a) * 0.052));
      }
      const g = tube(pts, 0.0017);
      this.geos.push(g);
      neck.add(new THREE.Mesh(g, this.veinMat));
    }
    bone('neck').add(neck);
    this.faceVeins = [face, neck];

    // Sweat: glossy beads on the forehead, temples and upper lip.
    this.sweat.name = 'tell:sweat';
    const bead = new THREE.SphereGeometry(0.0042, 6, 5);
    this.geos.push(bead);
    for (const [a, y] of [[-0.35, 0.168], [0.1, 0.176], [0.42, 0.164], [-0.75, 0.15], [0.8, 0.148], [-0.2, 0.152], [0.25, 0.14], [-0.5, 0.058], [0.45, 0.06]] as const) {
      const m = new THREE.Mesh(bead, this.sweatMat);
      m.position.copy(headPoint(a, y, 0.0015));
      this.sweat.add(m);
    }
    bone('head').add(this.sweat);
    this.apply();
  }

  private readonly faceVeins: THREE.Group[];

  get current(): Readonly<Tells> {
    return this.state;
  }

  set(t: Tells): void {
    if (t.bandage === this.state.bandage && t.veins === this.state.veins && t.sweat === this.state.sweat) return;
    this.state = { ...t };
    this.apply();
  }

  private apply(): void {
    const s = this.state;
    this.bandage.visible = s.bandage;
    const v = s.veins > 0;
    this.veins.visible = v;
    for (const g of this.faceVeins) g.visible = v;
    this.veinMat.opacity = 0.85 * Math.min(1, s.veins);
    this.sweat.visible = s.sweat > 0;
    this.sweatMat.opacity = 0.7 * Math.min(1, s.sweat);
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const o of [this.bandage, this.veins, this.sweat, ...this.faceVeins]) o.removeFromParent();
  }
}

/** The tells the infection ladder shows (ADR-0022): the bandage once bandaged, veins and sweat from stage 3. */
export function tellsFor(stage: number, bandaged: boolean): Tells {
  return { bandage: bandaged, veins: stage >= 3 ? 1 : 0, sweat: stage >= 3 ? 1 : 0 };
}
