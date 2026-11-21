import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeHeldWand } from '../../actors/heldProps.ts';
import type { Rng } from '../../core/rng.ts';
import { fixtureMaterial, type Materials } from '../../render/materials.ts';
import { CanvasScreen, SCREEN_FONT } from '../../render/screens.ts';
import { stencilDecal } from '../../render/decals.ts';
import { drawTagMark } from '../../render/logo.ts';
import { at, cylinderBetween, pipe, rounded } from './geom.ts';
import { lathe, slab } from './shapes.ts';
import { bolts, cableTray, inFrame, pipeRun } from './detail.ts';
import { resolvePalette } from './palettes.ts';
import { PieceBuilder, boolParam, numParam, strParam, type PieceDef, type PieceOutput, type PieceParams } from './types.ts';

/**
 * Prop kit (ADR-0003). Placed freely in metres; origin on the floor, front faces -Z.
 * Static parts merge into the room; screens and glows are dynamic. Corpse poses wait for
 * the ADR-0006 humanoid.
 */

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const PI = Math.PI;

/** Shared stencil materials, keyed by text, so repeated labels share one draw call. */
const labelCache = new Map<string, THREE.MeshStandardMaterial>();
function label(text: string, color = '#2a2a26'): THREE.MeshStandardMaterial {
  const key = `${text}|${color}`;
  let mat = labelCache.get(key);
  if (!mat) {
    mat = stencilDecal([{ text, size: 0.8, y: 0.82 }], 384, 128, color, `label-${text}`);
    labelCache.set(key, mat);
  }
  return mat;
}

function crate(pb: PieceBuilder, m: Materials, x: number, y: number, z: number, s: number, ry: number, mat: THREE.Material): void {
  pb.add(rounded(s, s, s, 0.03), mat, at(x, y + s / 2, z, 0, ry, 0));
  for (const f of [0.18, 0.82]) pb.add(rounded(s + 0.02, 0.06, s + 0.02, 0.01), m.steel, at(x, y + s * f, z, 0, ry, 0));
  const r = (s * Math.SQRT2) / 2;
  const e = Math.max(Math.abs(Math.cos(ry)), Math.abs(Math.sin(ry))) * r * 0.75 + r * 0.25;
  pb.solid(x - e, y, z - e, x + e, y + s, z + e, 'metal');
}

const GEN: Record<string, (p: PieceParams, rng: Rng, m: Materials, pb: PieceBuilder) => void> = {
  crate(p, rng, m, pb) {
    const s = numParam(p, 'size', 0.8);
    crate(pb, m, 0, 0, 0, s, rng.range(-0.08, 0.08), rng.chance(0.7) ? m.paintTeal : m.paintBone);
  },

  crate_stack(_p, rng, m, pb) {
    crate(pb, m, 0, 0, 0, 0.9, rng.range(-0.1, 0.1), m.paintTeal);
    crate(pb, m, rng.range(0.85, 0.95), 0, rng.range(-0.1, 0.1), 0.7, rng.range(-0.3, 0.3), m.paintBone);
    crate(pb, m, rng.range(-0.05, 0.05), 0.9, rng.range(-0.05, 0.05), 0.6, rng.range(-0.4, 0.4), m.paintTeal);
  },

  locker(p, _rng, m, pb) {
    const n = Math.round(numParam(p, 'count', 1));
    const pal = resolvePalette(p, m);
    const bodyMat = pal.doorPanel !== m.paintDark ? m.cleanWall : m.paintBone;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.62;
      pb.add(rounded(0.6, 2.0, 0.55, 0.02), bodyMat, at(x, 1.0, 0));
      for (let k = 0; k < 5; k++) pb.add(slab(0.4, 0.018, 0.01), m.black, at(x, 1.72 + k * 0.04, -0.277));
      pb.add(slab(0.008, 1.9, 0.01), m.black, at(x - 0.3, 1.0, -0.277));
      pb.add(rounded(0.03, 0.16, 0.04, 0.01), m.steel, at(x + 0.2, 1.05, -0.29));
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.1), label(strParam(p, 'label', 'SEC-07')));
      tag.position.set(x, 1.5, -0.279);
      tag.rotation.y = PI;
      pb.dynamic(tag);
    }
    pb.solid(-0.31 * n, 0, -0.28, 0.31 * n, 2.0, 0.28, 'metal');
  },

  console(p, _rng, m, pb) {
    const pal = resolvePalette(p, m);
    const clean = pal.doorPanel !== m.paintDark;
    const baseMat = clean ? m.cleanWall : m.paintBone;
    const housingMat = clean ? pal.doorPanel : m.paintDark;
    pb.add(rounded(1.6, 0.85, 0.7, 0.03), baseMat, at(0, 0.425, 0));
    pb.add(rounded(1.7, 0.05, 0.85, 0.015), m.steel, at(0, 0.875, -0.05));
    pb.add(rounded(0.62, 0.03, 0.26, 0.01), m.rubber, at(0, 0.915, -0.2));
    const kind = strParam(p, 'screen', 'status');
    const screen = new CanvasScreen(512, 288, kind === 'log' ? drawLog : kind === 'hydro' ? drawHydroClimate : drawStatus);
    const assembly = new THREE.Group();
    assembly.position.set(0, 1.36, 0.22);
    assembly.rotation.x = -0.26;
    const housing = new THREE.Mesh(rounded(1.05, 0.62, 0.1, 0.02), housingMat);
    const display = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.53), screen.material);
    display.position.z = -0.052;
    display.rotation.y = PI;
    assembly.add(housing, display);
    pb.dynamic(assembly);
    pb.add(cylinderBetween(V(0, 0.9, 0.25), V(0, 1.12, 0.25), 0.03), m.steel);
    const amber = fixtureMaterial(0xffa21a, 2.5);
    for (let i = 0; i < 7; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.03), amber);
      b.position.set(-0.55 + i * 0.07, 0.906, -0.1);
      pb.dynamic(b);
    }
    pb.tick((t) => screen.update(t));
    pb.solid(-0.85, 0, -0.45, 0.85, 1.0, 0.36, 'metal');
  },

  chair(p, rng, m, pb) {
    const id = strParam(p, 'id', '');
    const ry = boolParam(p, 'fixed', false) || id !== '' ? 0 : rng.range(-0.5, 0.5);
    const f = at(0, 0, 0, 0, ry, 0);
    if (id) {
      // Controllable chair (dock-checkpoint): stays dynamic as one group (2 draw calls) so mesh and collider move together.
      const grp = new THREE.Group();
      grp.name = `prop:${id}`;
      grp.userData['propId'] = id;
      const toFlat = (g: THREE.BufferGeometry, mat4?: THREE.Matrix4): THREE.BufferGeometry => {
        if (mat4) g.applyMatrix4(mat4);
        const flat = g.index ? g.toNonIndexed() : g;
        if (flat !== g) g.dispose();
        if (!flat.getAttribute('normal')) flat.computeVertexNormals();
        flat.deleteAttribute('uv');
        return flat;
      };
      const rubberParts = [
        toFlat(rounded(0.48, 0.08, 0.46, 0.03), inFrame(f, 0, 0.5, 0)),
        toFlat(rounded(0.46, 0.5, 0.06, 0.03), inFrame(f, 0, 0.82, 0.22, -0.12, 0, 0)),
      ];
      const steelParts: THREE.BufferGeometry[] = [toFlat(cylinderBetween(V(0, 0.08, 0), V(0, 0.48, 0), 0.03))];
      for (let k = 0; k < 5; k++) {
        const a = (k * 2 * PI) / 5 + ry;
        steelParts.push(toFlat(cylinderBetween(V(0, 0.08, 0), V(Math.cos(a) * 0.3, 0.04, Math.sin(a) * 0.3), 0.018)));
      }
      const rubberGeo = mergeGeometries(rubberParts, false);
      const steelGeo = mergeGeometries(steelParts, false);
      for (const g of [...rubberParts, ...steelParts]) g.dispose();
      if (rubberGeo) grp.add(new THREE.Mesh(rubberGeo, m.rubber));
      if (steelGeo) grp.add(new THREE.Mesh(steelGeo, m.steel));
      pb.dynamic(grp);
    } else {
      pb.add(rounded(0.48, 0.08, 0.46, 0.03), m.rubber, inFrame(f, 0, 0.5, 0));
      pb.add(rounded(0.46, 0.5, 0.06, 0.03), m.rubber, inFrame(f, 0, 0.82, 0.22, -0.12, 0, 0));
      pb.add(cylinderBetween(V(0, 0.08, 0), V(0, 0.48, 0), 0.03), m.steel);
      for (let k = 0; k < 5; k++) {
        const a = (k * 2 * PI) / 5 + ry;
        pb.add(cylinderBetween(V(0, 0.08, 0), V(Math.cos(a) * 0.3, 0.04, Math.sin(a) * 0.3), 0.018), m.steel);
      }
    }
    pb.solid(-0.28, 0, -0.28, 0.28, 1.07, 0.28, 'rubber');
  },

  /** Resting scanning wand on the security desk (dock-checkpoint); shares geometry/material with the held wand. */
  desk_wand(p, _rng, _m, pb) {
    const id = strParam(p, 'id', 'dock_wand');
    const grp = new THREE.Group();
    grp.name = `prop:${id}`;
    grp.userData['propId'] = id;
    const wand = makeHeldWand();
    // Local y = 0 is the desktop surface; lay the wand flat (grip toward +Z, paddle toward -Z).
    wand.position.set(0, 0.014, 0.08);
    wand.rotation.set(PI / 2, 0, 0);
    grp.add(wand);
    grp.visible = !boolParam(p, 'hidden', false);
    pb.dynamic(grp);
  },

  desk(p, _rng, m, pb) {
    const w = numParam(p, 'width', 1.6);
    const pal = resolvePalette(p, m);
    const clean = pal.doorPanel !== m.paintDark;
    pb.add(rounded(w, 0.05, 0.8, 0.015), clean ? m.cleanWall : m.paintBone, at(0, 0.75, 0));
    for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) pb.add(rounded(0.05, 0.72, 0.72, 0.01), m.steel, at(x, 0.36, 0));
    pb.add(rounded(0.45, 0.6, 0.72, 0.02), clean ? pal.doorPanel : m.paintDark, at(w / 2 - 0.3, 0.42, 0));
    for (const y of [0.25, 0.48, 0.66]) pb.add(slab(0.12, 0.02, 0.02), m.steel, at(w / 2 - 0.3, y, -0.37));
    pb.solid(-w / 2, 0, -0.4, w / 2, 0.78, 0.4, 'metal');
  },

  gurney(_p, rng, m, pb) {
    const tilt = rng.range(-0.04, 0.04);
    pb.add(rounded(0.7, 0.1, 1.95, 0.04), m.rubber, at(0, 0.82, 0, 0, tilt, 0));
    pb.add(slab(0.74, 0.03, 2.0), m.steel, at(0, 0.75, 0));
    for (const x of [-0.33, 0.33]) {
      pb.add(cylinderBetween(V(x, 0.78, -0.98), V(x, 0.78, 0.98), 0.022), m.steel);
      for (const z of [-0.85, 0.85]) {
        pb.add(cylinderBetween(V(x, 0.15, z), V(x, 0.75, z), 0.022), m.steel);
        pb.add(new THREE.TorusGeometry(0.06, 0.022, 6, 14), m.rubber, at(x, 0.08, z, 0, PI / 2, 0));
      }
    }
    pb.solid(-0.38, 0, -1.0, 0.38, 0.9, 1.0, 'metal');
  },

  specimen_tank(_p, rng, m, pb) {
    pb.add(lathe([[0, 0], [0.62, 0], [0.62, 0.32], [0.5, 0.42], [0.5, 0.5], [0, 0.5]], 32), m.steel);
    pb.add(lathe([[0, 2.35], [0.5, 2.35], [0.5, 2.45], [0.62, 2.55], [0.62, 2.8], [0.2, 2.9], [0, 2.9]], 32), m.steel);
    for (let k = 0; k < 4; k++) {
      const a = (k * PI) / 2 + PI / 4;
      pb.add(cylinderBetween(V(Math.cos(a) * 0.53, 0.5, Math.sin(a) * 0.53), V(Math.cos(a) * 0.53, 2.35, Math.sin(a) * 0.53), 0.035), m.steel);
    }
    pb.add(pipe([V(0.3, 2.9, 0), V(0.35, 3.3, 0.1), V(0.3, 4.2, 0.2)], 0.05, 1, 10), m.cable);
    const liquid = new THREE.MeshStandardMaterial({ color: 0x0a2a24, emissive: 0x2bd4a0, emissiveIntensity: 0.55, roughness: 0.1, transparent: true, opacity: 0.62 });
    const fluid = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 1.8, 28, 1, true), liquid);
    fluid.position.y = 1.43;
    pb.dynamic(fluid);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.85, 32, 1, true), m.glass);
    glass.position.y = 1.43;
    glass.renderOrder = 3;
    pb.dynamic(glass);
    const phase = rng.range(0, 6);
    pb.tick((t) => {
      liquid.emissiveIntensity = 0.45 + Math.sin(t * 0.9 + phase) * 0.12;
    });
    pb.solidC(0, 1.45, 0, 1.24, 2.9, 1.24, 'metal');
  },

  med_bed(_p, _rng, m, pb) {
    pb.add(rounded(0.9, 0.55, 2.0, 0.04), m.paintBone, at(0, 0.275, 0));
    pb.add(rounded(0.82, 0.12, 1.3, 0.05), m.rubber, at(0, 0.61, 0.32));
    pb.add(rounded(0.82, 0.12, 0.75, 0.05), m.rubber, at(0, 0.82, -0.6, -0.5, 0, 0));
    pb.add(cylinderBetween(V(0.55, 0, -0.9), V(0.55, 1.7, -0.9), 0.03), m.steel);
    pb.add(cylinderBetween(V(0.55, 1.7, -0.9), V(0.25, 1.75, -0.9), 0.025), m.steel);
    const screen = new CanvasScreen(256, 160, drawVitals, 1.4, 10);
    const mon = new THREE.Group();
    mon.position.set(0.2, 1.62, -0.92);
    mon.rotation.y = PI * 0.85;
    mon.add(new THREE.Mesh(rounded(0.42, 0.28, 0.06, 0.015), m.paintDark));
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.22), screen.material);
    disp.position.z = 0.032;
    mon.add(disp);
    pb.dynamic(mon);
    pb.tick((t) => screen.update(t));
    pb.solid(-0.45, 0, -1.0, 0.6, 0.9, 1.0, 'metal');
  },

  vending_machine(_p, _rng, m, pb) {
    pb.add(rounded(1.0, 1.95, 0.8, 0.03), m.paintDark, at(0, 0.975, 0));
    const glow = fixtureMaterial(0x7fd8ff, 1.4);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.2), glow);
    panel.position.set(-0.12, 1.2, -0.405);
    panel.rotation.y = PI;
    pb.dynamic(panel);
    pb.add(slab(0.2, 0.5, 0.02), m.black, at(0.33, 1.2, -0.41));
    pb.add(slab(0.6, 0.18, 0.04), m.black, at(-0.12, 0.35, -0.41));
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), tagDecal());
    logo.position.set(0.33, 1.65, -0.412);
    logo.rotation.y = PI;
    pb.dynamic(logo);
    pb.solid(-0.5, 0, -0.4, 0.5, 1.95, 0.4, 'metal');
    pb.spot('lean_counter', 0, 0, -0.88, PI);
  },

  ceiling_fixture(p, _rng, m, pb) {
    const drop = numParam(p, 'drop', 0.6);
    const ceil = numParam(p, 'ceiling', 3.2);
    const y = ceil - drop;
    pb.add(cylinderBetween(V(0, ceil, 0), V(0, y + 0.12, 0), 0.012, 6), m.cable);
    pb.add(new THREE.ConeGeometry(0.28, 0.2, 18, 1, true), m.paintDark, at(0, y + 0.1, 0));
    pb.light([0, y, 0], 'wall');
  },

  emergency_beacon(p, _rng, m, pb) {
    const wall = boolParam(p, 'wall', false);
    if (wall) pb.add(rounded(0.2, 0.2, 0.1, 0.02), m.steel, at(0, 0, 0.05));
    pb.add(new THREE.CylinderGeometry(0.075, 0.085, 0.06, 16), m.steel, at(0, 0.03, 0));
    pb.light([0, 0.1, 0], 'emergency');
  },

  /**
   * Rusted DANGER / DO NOT ENTER plate (photo slot `signDanger`, a non-tiling decal): one quad with
   * full 0..1 UVs. Wall-mounted like other wall props: origin on the floor at the wall face, the
   * front faces -Z, so rotate it to face into the room. `y` is the centre height, default 1.6 m.
   */
  sign_danger(p, _rng, m, pb) {
    const w = numParam(p, 'width', 0.6);
    const h = numParam(p, 'height', 0.45);
    const y = numParam(p, 'y', 1.6);
    pb.add(new THREE.PlaneGeometry(w, h), m.signDanger, at(0, y, -0.006, 0, PI, 0));
  },

  vent_grate(p, _rng, m, pb) {
    const s = numParam(p, 'size', 0.8);
    for (const dz of [-s / 2, s / 2]) pb.add(rounded(s + 0.08, 0.05, 0.08, 0.01), m.steel, at(0, 0.02, dz));
    for (const dx of [-s / 2, s / 2]) pb.add(rounded(0.08, 0.05, s, 0.01), m.steel, at(dx, 0.02, 0));
    pb.add(slab(s, 0.015, s, 0.4), m.grating, at(0, 0.01, 0));
    pb.add(slab(s, 0.01, s), m.black, at(0, -0.3, 0));
    bolts(pb, m, at(0, 0.05, 0, -PI / 2, 0, 0), [-s / 2, s / 2], [-s / 2, s / 2], 0);
  },

  valve(p, _rng, m, pb) {
    const pal = resolvePalette(p, m);
    pb.add(lathe([[0, 0], [0.12, 0], [0.12, 0.05], [0.09, 0.08], [0.11, 0.3], [0.06, 0.38], [0.03, 0.55], [0, 0.55]], 18), pal.pipeMain);
    pb.add(new THREE.TorusGeometry(0.18, 0.018, 8, 28), pal.pipeAccent, at(0, 0.55, 0, PI / 2, 0, 0));
    for (let k = 0; k < 3; k++) pb.add(slab(0.36, 0.014, 0.02), m.steel, at(0, 0.55, 0, 0, (k * PI) / 3, 0));
    pb.solid(-0.2, 0, -0.2, 0.2, 0.6, 0.2, 'metal');
  },

  pipe_run(p, _rng, m, pb) {
    const L = numParam(p, 'length', 4);
    const r = numParam(p, 'radius', 0.1);
    const y = numParam(p, 'height', 0.4);
    const pal = resolvePalette(p, m);
    const paint = strParam(p, 'paint', 'steel');
    const mat = paint === 'teal' ? pal.pipeAccent : paint === 'dark' ? pal.pipeMain : m.steel;
    pipeRun(pb, m, [V(-L / 2, y, 0), V(L / 2, y, 0)], r, mat, null, 1.5);
    for (let x = -L / 2 + 0.5; x < L / 2; x += 1.5) {
      pb.add(rounded(0.12, y, 0.3, 0.02), m.steel, at(x, y / 2 - r / 2, 0));
    }
    pb.solid(-L / 2, 0, -r - 0.15, L / 2, y + r, r + 0.15, 'metal');
  },

  cable_bundle(p, rng, m, pb) {
    const L = numParam(p, 'length', 4);
    const y = numParam(p, 'height', 3);
    cableTray(pb, m, rng, at(0, 0, 0), L, y, 0.35);
  },

  rib_frame(p, _rng, m, pb) {
    const w = numParam(p, 'width', 4);
    const h = numParam(p, 'height', 3.2);
    for (const s of [-1, 1]) {
      pb.add(rounded(0.26, h, 0.3, 0.03), m.steel, at(s * (w / 2 - 0.13), h / 2, 0));
      pb.add(rounded(0.14, 0.7, 0.2, 0.02), m.steel, at(s * (w / 2 - 0.45), h - 0.45, 0, 0, 0, s * (PI / 4)));
      pb.solid(s > 0 ? w / 2 - 0.26 : -w / 2, 0, -0.15, s > 0 ? w / 2 : -w / 2 + 0.26, h, 0.15);
    }
    pb.add(rounded(w, 0.28, 0.3, 0.03), m.steel, at(0, h - 0.14, 0));
  },

  debris_pile(_p, rng, m, pb) {
    const mats = [m.paintDark, m.paintTeal, m.steel, m.paintBone];
    for (let i = 0; i < 14; i++) {
      const a = rng.range(0, PI * 2);
      const r = rng.range(0, 0.8);
      const s = rng.range(0.08, 0.4);
      pb.add(rounded(s, rng.range(0.02, 0.12), s * rng.range(0.4, 1.4), 0.01), rng.pick(mats), at(Math.cos(a) * r, rng.range(0.01, 0.1), Math.sin(a) * r, rng.range(-0.3, 0.3), rng.range(0, PI), rng.range(-0.3, 0.3)));
    }
    for (let i = 0; i < 3; i++) {
      const a = rng.range(0, PI * 2);
      pb.add(cylinderBetween(V(Math.cos(a) * 0.9, 0.04, Math.sin(a) * 0.9), V(Math.cos(a + 2) * 0.5, 0.25, Math.sin(a + 2) * 0.5), rng.range(0.03, 0.06), 8), m.steel);
    }
    pb.add(rounded(0.9, 0.04, 0.7, 0.01), m.paintTeal, at(rng.range(-0.3, 0.3), 0.18, 0, 0.35, rng.range(0, PI), 0.1));
    pb.solid(-0.6, 0, -0.6, 0.6, 0.15, 0.6, 'metal');
  },
};

let tagMaterial: THREE.MeshStandardMaterial | null = null;
function tagDecal(): THREE.MeshStandardMaterial {
  if (!tagMaterial) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) drawTagMark(ctx, 64, 64, 58, { ink: '#cfe8f0', accent: '#4fd6d0' });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tagMaterial = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, emissive: 0x4fd6d0, emissiveMap: tex, emissiveIntensity: 0.4 });
  }
  return tagMaterial;
}

function drawStatus(ctx: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  ctx.fillStyle = '#020a0c';
  ctx.fillRect(0, 0, w, h);
  ctx.font = `600 22px ${SCREEN_FONT}`;
  ctx.fillStyle = '#7fe3d0';
  ctx.fillText('THALASSA // SECTION 07', 18, 34);
  ctx.fillRect(18, 44, w - 36, 2);
  drawTagMark(ctx, w - 36, 26, 15, { ink: '#7fe3d0', accent: '#3f8f82' });
  ctx.font = `20px ${SCREEN_FONT}`;
  const rows: Array<[string, string]> = [
    ['O2', `${(20.7 + Math.sin(t * 0.7) * 0.1).toFixed(1)} %`],
    ['HULL PRESSURE', `${(301.4 + Math.sin(t * 0.31) * 0.3).toFixed(1)} ATM`],
    ['LAB B LOCKDOWN', 'ACTIVE'],
  ];
  rows.forEach(([k, v], i) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5fb8a8';
    ctx.fillText(k, 18, 84 + i * 30);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#bff7ea';
    ctx.fillText(v, w - 18, 84 + i * 30);
  });
  ctx.textAlign = 'left';
  ctx.fillStyle = Math.floor(t * 2) % 2 === 0 ? '#ffb020' : '#6b4a10';
  ctx.fillText('AWAITING OVERRIDE', 18, 200);
  if (Math.floor(t * 3) % 2 === 0) {
    ctx.fillStyle = '#7fe3d0';
    ctx.fillRect(18, 220, 12, 20);
  }
  ctx.fillStyle = '#7fe3d0';
  ctx.fillText(`T+${(t + 3600).toFixed(0)}`, w - 120, h - 20);
}

function drawLog(ctx: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  ctx.fillStyle = '#04070a';
  ctx.fillRect(0, 0, w, h);
  ctx.font = `17px ${SCREEN_FONT}`;
  const lines = ['> containment B-7 ... nominal', '> pressure seal 07-B ... ENGAGED', '> crew roster sync ... FAILED', '> retrying uplink', '> retrying uplink', '> ERR: no carrier'];
  const shown = Math.floor(t * 0.8) % (lines.length + 3);
  ctx.fillStyle = '#8fd0c0';
  lines.slice(0, Math.min(shown, lines.length)).forEach((l, i) => ctx.fillText(l, 16, 32 + i * 28));
  if (Math.floor(t * 2) % 2 === 0) ctx.fillRect(16, 32 + Math.min(shown, lines.length) * 28 - 16, 10, 18);
  ctx.fillStyle = '#2f5f56';
  ctx.fillRect(0, h - 4, w, 4);
}

function drawHydroClimate(ctx: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  ctx.fillStyle = '#04100d';
  ctx.fillRect(0, 0, w, h);
  ctx.font = `600 21px ${SCREEN_FONT}`;
  ctx.fillStyle = '#7fe3c8';
  ctx.fillText('HYDRO // FERTIGATION & HVAC', 18, 34);
  ctx.fillRect(18, 44, w - 36, 2);
  drawTagMark(ctx, w - 36, 26, 15, { ink: '#7fe3c8', accent: '#3f8f82' });
  ctx.font = `19px ${SCREEN_FONT}`;
  const rows: Array<[string, string, string]> = [
    ['GROW HALL RH', `${(86.4 + Math.sin(t * 0.9) * 0.6).toFixed(1)} %  (HIGH)`, '#ffb020'],
    ['NUTRIENT EC / pH', '1.8 mS  /  6.1 pH', '#bff7ea'],
    ['RO TANK A / B', '78 %  /  84 %', '#bff7ea'],
    ['DEHUMIDIFIER', 'COIL FAULT #03', '#ff6a4a'],
  ];
  rows.forEach(([k, v, c], i) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#6fb8a4';
    ctx.fillText(k, 18, 84 + i * 32);
    ctx.textAlign = 'right';
    ctx.fillStyle = c;
    ctx.fillText(v, w - 18, 84 + i * 32);
  });
  ctx.textAlign = 'left';
  ctx.fillStyle = Math.floor(t * 2) % 2 === 0 ? '#ffb020' : '#6b4a10';
  ctx.fillText('ALARM ACTIVE  ·  [E] RESET HUMIDITY ALARM', 18, 232);
  ctx.fillStyle = '#5fb8a8';
  ctx.fillText('BAY 12D · PLANT ROOM', 18, h - 18);
}

function drawVitals(ctx: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  ctx.fillStyle = '#020806';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#3cff8a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const p = ((x + t * 90) % 120) / 120;
    const y = h / 2 - (p > 0.45 && p < 0.5 ? 40 : p > 0.5 && p < 0.55 ? -18 : 0);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#3cff8a';
  ctx.font = `600 22px ${SCREEN_FONT}`;
  ctx.fillText('HR --', 12, 28);
  ctx.fillText('NO SIGNAL', 12, h - 14);
}

export const PROP_PIECES: PieceDef[] = Object.entries(GEN).map(([id, gen]) => ({
  id,
  family: 'prop' as const,
  footprint: [0, 0] as [number, number],
  generate(params: PieceParams, rng: Rng, m: Materials): PieceOutput {
    const pb = new PieceBuilder();
    gen(params, rng, m, pb);
    return pb.build();
  },
}));

