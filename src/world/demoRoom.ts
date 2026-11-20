import * as THREE from 'three';
import type { Rng } from '../core/rng.ts';
import { fixtureMaterial, type Materials } from '../render/materials.ts';
import { LightController, type ControlledLight, type LightPattern } from '../render/lights.ts';
import { CanvasScreen, SCREEN_FONT } from '../render/screens.ts';
import { bloodDecal, paintedDecal, stencilDecal } from '../render/decals.ts';
import { drawTagBanner, drawTagLockup, drawTagMark } from '../render/logo.ts';
import { createShaft } from '../render/fx/shafts.ts';
import { createAbyss } from '../render/fx/abyss.ts';
import { createSeabed } from '../render/fx/seabed.ts';
import { Particulates } from '../render/fx/particulates.ts';
import { at, boxUv, cylinderBetween, MergeBuilder, pipe, rounded } from './kit/geom.ts';

/**
 * "Lab B observation corridor": a hand-built showcase of the look (ADR-0002) and early
 * kit detail (ADR-0003). Replaced by data-driven kit levels once ADR-0003 lands.
 *
 * Layout: 6 m wide, 3.2 m high, 20 m long along Z. You start at +Z facing the sealed
 * pressure door at -Z. Floor centre is diamond plate; side trenches are grating over
 * pipes. The right wall has a window onto the abyss.
 */

const LENGTH = 20;
const HALF_L = LENGTH / 2;
const HALF_W = 3;
const H = 3.2;
const BAY = 2.5;
const BAYS = LENGTH / BAY;
const RIB_Z = [-7.5, -5, -2.5, 0, 2.5, 5, 7.5];
const WINDOW_BAYS = new Set([3, 4]); // right wall, z -2.5..2.5

export interface DemoRoom {
  group: THREE.Group;
  lights: LightController;
  spawn: { position: THREE.Vector3; yaw: number };
  bounds: THREE.Box3;
  /** Where things are, for audio emitters (world/demoRoomAudio.ts). */
  anchors: DemoRoomAnchors;
  update(t: number, dt: number, cameraPosition: THREE.Vector3, reducedFlashing: boolean): void;
}

export interface DemoRoomAnchors {
  vent: THREE.Vector3;
  window: THREE.Vector3;
  abyss: THREE.Vector3;
  console: THREE.Vector3;
  door: THREE.Vector3;
  fixtures: Array<{ position: THREE.Vector3; light: ControlledLight }>;
  drips: THREE.Vector3[];
  ceiling: THREE.Vector3[];
  /** Wall save terminal (ADR-0016). */
  saveStation: THREE.Vector3;
  /** Autosave when the player first walks past `zBelow` (heading toward the door). */
  checkpoints: Array<{ id: string; label: string; zBelow: number }>;
}

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export function buildDemoRoom(m: Materials, rng: Rng): DemoRoom {
  const root = new THREE.Group();
  root.name = 'demo-room';
  const mb = new MergeBuilder();
  const lights = new LightController();
  const tickers: Array<(t: number, dt: number) => void> = [];
  const add = (...objects: THREE.Object3D[]): void => {
    for (const o of objects) {
      o.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });
      root.add(o);
    }
  };

  root.add(new THREE.HemisphereLight(0x8fb0bd, 0x0e1215, 0.22));

  // ---------------------------------------------------------------- floor + trenches
  mb.add(boxUv(3.6, 0.1, LENGTH), m.diamond, at(0, -0.05, 0));
  for (const s of [-1, 1]) {
    const xc = s * 2.4;
    mb.add(boxUv(1.2, 0.03, LENGTH), m.grating, at(xc, -0.015, 0));
    mb.add(boxUv(1.2, 0.05, LENGTH), m.paintDark, at(xc, -0.625, 0));
    mb.add(boxUv(0.05, 0.6, LENGTH), m.paintDark, at(s * 1.8, -0.32, 0));
    for (let z = -HALF_L + 0.625; z < HALF_L; z += 1.25) {
      mb.add(boxUv(1.2, 0.06, 0.05), m.steel, at(xc, -0.06, z));
    }
    mb.add(pipe([V(s * 2.15, -0.42, -HALF_L), V(s * 2.15, -0.42, HALF_L)], 0.08, 1, 14), m.steel);
    mb.add(pipe([V(s * 2.62, -0.5, -HALF_L), V(s * 2.62, -0.5, HALF_L)], 0.045, 1, 10), m.cable);
    mb.add(boxUv(0.04, 0.02, LENGTH), m.glowCyan, at(s * 2.93, -0.56, 0));
  }

  // ---------------------------------------------------------------- walls
  for (const s of [-1, 1]) {
    for (let b = 0; b < BAYS; b++) {
      const z0 = -HALF_L + b * BAY;
      const zc = z0 + BAY / 2;
      const isWindow = s === 1 && WINDOW_BAYS.has(b);
      const backX = s * (HALF_W + 0.05);
      if (isWindow) {
        mb.add(boxUv(0.1, 1.45, BAY), m.black, at(backX, 0.125, zc));
        mb.add(boxUv(0.1, 0.75, BAY), m.black, at(backX, 2.825, zc));
      } else {
        mb.add(boxUv(0.1, 3.8, BAY), m.black, at(backX, 1.3, zc));
      }

      mb.add(boxUv(0.04, 0.28, 2.18), m.steelBrushed, at(s * (HALF_W - 0.02), 0.14, zc));
      const px = s * (HALF_W - 0.03);
      for (const dz of [-0.55, 0.55]) {
        const z = zc + dz;
        if (isWindow) {
          mb.add(rounded(0.06, 0.48, 1.05), m.paintDark, at(px, 0.56, z));
        } else {
          mb.add(rounded(0.06, 1.0, 1.05), m.paintDark, at(px, 0.82, z));
          mb.add(rounded(0.06, 1.1, 1.05), m.paintTeal, at(px, 1.9, z));
        }
      }

      // Trim rail, cable tray and sagging cables between ribs.
      mb.add(boxUv(0.06, 0.06, BAY), m.steel, at(s * (HALF_W - 0.04), 2.5, zc));
      mb.add(boxUv(0.36, 0.025, 2.2, 0.5), m.grating, at(s * (HALF_W - 0.2), 2.62, zc));
      for (let c = 0; c < 3; c++) {
        const x = s * (HALF_W - 0.1 - c * 0.09);
        const sag = 0.1 + rng.range(0, 0.14);
        const za = z0 + 0.2;
        const zb = z0 + BAY - 0.2;
        const pts = [V(x, 2.6, za), V(x, 2.6 - sag * 0.75, za + 0.55), V(x, 2.6 - sag, (za + zb) / 2), V(x, 2.6 - sag * 0.75, zb - 0.55), V(x, 2.6, zb)];
        mb.add(pipe(pts, 0.012 + c * 0.005, 1, 6), m.cable);
      }
    }
  }

  // ---------------------------------------------------------------- window onto the abyss
  {
    const x = HALF_W;
    mb.add(rounded(0.3, 0.12, 5.0, 0.03), m.steel, at(x - 0.1, 0.85, 0));
    mb.add(rounded(0.3, 0.15, 5.0, 0.03), m.steel, at(x - 0.1, 2.45, 0));
    for (const z of [-2.5, 0, 2.5]) mb.add(rounded(0.24, 1.6, 0.14, 0.03), m.steel, at(x - 0.08, 1.65, z));
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.5), m.glass);
    glass.position.set(x, 1.65, 0);
    glass.rotation.y = -Math.PI / 2;
    glass.renderOrder = 3;
    root.add(glass);

    // Station truss outside, silhouetted against the water.
    for (const z of [-4, 1.5, 6]) mb.add(boxUv(0.4, 9, 0.4), m.paintDark, at(5.4, 1.5, z));
    mb.add(boxUv(0.3, 0.3, 14), m.paintDark, at(5.2, -0.6, 0));
    const abyss = createAbyss(34, 16);
    abyss.mesh.position.set(9, 1.5, 0);
    abyss.mesh.rotation.y = -Math.PI / 2;
    root.add(abyss.mesh);
    tickers.push((t) => {
      abyss.uniforms.uTime.value = t;
    });
    // Sea floor between the truss and the backdrop. Seabed frame: -Z is outwards, here +X.
    const seabed = createSeabed({ length: 5, depth: 6, floorY: -4.2, pad: 6, seed: 7 });
    seabed.position.set(x, 0, 0);
    seabed.rotation.y = -Math.PI / 2;
    root.add(seabed);
  }

  // ---------------------------------------------------------------- structural ribs + bolts
  const boltMatrices: THREE.Matrix4[] = [];
  for (const z of RIB_Z) {
    for (const s of [-1, 1]) {
      mb.add(rounded(0.3, 3.55, 0.28, 0.03), m.steel, at(s * 2.84, 1.175, z));
      mb.add(rounded(0.12, 0.75, 0.2, 0.02), m.steel, at(s * 2.42, 2.72, z, 0, 0, s * (Math.PI / 4)));
      mb.add(boxUv(0.42, 0.03, 0.42), m.steel, at(s * 2.84, -0.585, z));
      for (const y of [0.3, 0.95, 1.6, 2.25]) {
        for (const dz of [-0.08, 0.08]) boltMatrices.push(at(s * (2.84 - 0.15 - 0.006), y, z + dz));
      }
    }
    mb.add(rounded(5.4, 0.26, 0.28, 0.03), m.steel, at(0, 3.07, z));
  }
  const boltGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.022, 6);
  boltGeometry.rotateZ(Math.PI / 2);
  const bolts = new THREE.InstancedMesh(boltGeometry, m.steel, boltMatrices.length);
  boltMatrices.forEach((mat, i) => bolts.setMatrixAt(i, mat));
  bolts.castShadow = true;
  bolts.receiveShadow = true;
  root.add(bolts);

  // ---------------------------------------------------------------- ceiling + pipes
  mb.add(boxUv(6.2, 0.1, LENGTH), m.paintDark, at(0, H + 0.05, 0));
  const pipeRun = (x: number, y: number, r: number, mat: THREE.Material, flanges: boolean): void => {
    mb.add(pipe([V(x, y, -HALF_L), V(x, y, HALF_L)], r, 1, 16), mat);
    if (flanges) {
      for (let z = -8.75; z <= 8.75; z += BAY) {
        mb.add(new THREE.CylinderGeometry(r * 1.35, r * 1.35, 0.07, 16), m.steel, at(x, y, z, Math.PI / 2, 0, 0));
      }
    }
    for (const z of RIB_Z) {
      mb.add(cylinderBetween(V(x, H, z + 0.35), V(x, y + r, z + 0.35), 0.012, 6), m.steel);
      mb.add(new THREE.TorusGeometry(r + 0.012, 0.012, 6, 20), m.steel, at(x, y, z + 0.35));
    }
  };
  pipeRun(-1.6, 2.72, 0.12, m.steel, true);
  pipeRun(-1.15, 2.84, 0.07, m.paintTeal, false);
  pipeRun(1.45, 2.76, 0.16, m.paintDark, true);

  // Valve wheel hanging from the big pipe.
  {
    const red = new THREE.MeshStandardMaterial({ color: 0x6e1510, roughness: 0.5, metalness: 0.3 });
    const vz = 5.6;
    const vy = 2.36;
    mb.add(cylinderBetween(V(1.45, 2.62, vz), V(1.45, vy, vz), 0.022), m.steel);
    mb.add(new THREE.TorusGeometry(0.14, 0.016, 8, 28), red, at(1.45, vy, vz, Math.PI / 2, 0, 0));
    for (let k = 0; k < 3; k++) mb.add(boxUv(0.28, 0.012, 0.02), red, at(1.45, vy, vz, 0, (k * Math.PI) / 3, 0));
  }

  // ---------------------------------------------------------------- light fixtures
  const fixtureAnchors: DemoRoomAnchors['fixtures'] = [];
  const fixtures: Array<{ z: number; pattern: LightPattern; name: string }> = [
    { z: 6.25, pattern: 'steady', name: 'fixture near start' },
    { z: 1.25, pattern: 'flicker', name: 'fixture by window' },
    { z: -3.75, pattern: 'dying', name: 'fixture near door' },
  ];
  fixtures.forEach((f, k) => {
    mb.add(rounded(1.3, 0.1, 0.34, 0.02), m.steel, at(0, 3.14, f.z));
    for (const x of [-0.45, -0.15, 0.15, 0.45]) mb.add(boxUv(0.02, 0.02, 0.32), m.steel, at(x, 3.065, f.z));
    const glow = fixtureMaterial(0xdcefff, 3.2);
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.24), glow);
    diffuser.position.set(0, 3.08, f.z);
    root.add(diffuser);
    const light = new THREE.PointLight(0xdcefff, 10, 11, 2);
    light.position.set(0, 2.92, f.z);
    root.add(light);
    const shaft = createShaft(0.55, 1.6, 2.95, 0xbfe4ff);
    shaft.mesh.position.set(0, 3.06 - 2.95 / 2, f.z);
    root.add(shaft.mesh);
    tickers.push((t) => {
      shaft.uniforms.uTime.value = t;
    });
    const controlled = lights.add({ name: f.name, light, base: 10, pattern: f.pattern, seed: 17 + k * 31, emissives: [glow], emissiveBase: 3.2, shafts: [shaft.uniforms], shaftBase: 0.05 });
    fixtureAnchors.push({ position: V(0, 3.05, f.z), light: controlled });
  });

  // ---------------------------------------------------------------- console (left wall)
  {
    const cz = -6.25;
    mb.add(rounded(0.7, 0.85, 1.6, 0.03), m.paintBone, at(-2.55, 0.425, cz));
    mb.add(rounded(0.85, 0.05, 1.7, 0.015), m.steel, at(-2.5, 0.875, cz));
    mb.add(rounded(0.26, 0.03, 0.62, 0.01), m.rubber, at(-2.3, 0.915, cz));
    mb.add(cylinderBetween(V(-2.86, 0.9, cz), V(-2.86, 1.12, cz), 0.03), m.steel);

    const screen = new CanvasScreen(512, 288, drawConsole);
    const assembly = new THREE.Group();
    assembly.position.set(-2.8, 1.38, cz);
    assembly.rotation.z = 0.26;
    const housing = new THREE.Mesh(rounded(0.1, 0.62, 1.05, 0.02), m.paintDark);
    const display = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.53), screen.material);
    display.position.x = 0.052;
    display.rotation.y = Math.PI / 2;
    assembly.add(housing, display);
    add(assembly);
    tickers.push((t) => screen.update(t));

    const amber = fixtureMaterial(0xffa21a, 2.5);
    const redLed = fixtureMaterial(0xff2a1a, 3);
    for (let i = 0; i < 7; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.03), i === 5 ? redLed : amber);
      b.position.set(-2.62, 0.906, cz - 0.62 + i * 0.07);
      root.add(b);
    }
    tickers.push((t) => {
      redLed.emissiveIntensity = Math.floor(t * 1.5) % 2 === 0 ? 3 : 0.2;
    });

    mb.add(new THREE.ConeGeometry(0.16, 0.2, 18, 1, true), m.paintDark, at(-2.0, 3.05, cz));
    const hero = new THREE.SpotLight(0xffe2bd, 45, 7, THREE.MathUtils.degToRad(38), 0.65, 2);
    hero.position.set(-2.0, 2.92, cz);
    hero.target.position.set(-2.55, 0.9, cz);
    hero.castShadow = true;
    hero.shadow.mapSize.set(1024, 1024);
    hero.shadow.bias = -0.0005;
    hero.shadow.normalBias = 0.02;
    root.add(hero, hero.target);
    lights.add({ name: 'console spot', light: hero, base: 45, pattern: 'steady', seed: 5, emissives: [], emissiveBase: 0, shafts: [], shaftBase: 0 });
  }

  // ---------------------------------------------------------------- locker (left wall)
  {
    const lz = 3.75;
    mb.add(rounded(0.5, 2.0, 0.9, 0.02), m.paintBone, at(-2.7, 1.0, lz));
    for (let i = 0; i < 5; i++) mb.add(boxUv(0.01, 0.018, 0.5), m.black, at(-2.447, 1.72 + i * 0.04, lz));
    mb.add(boxUv(0.01, 1.9, 0.008), m.black, at(-2.447, 1.0, lz));
    mb.add(rounded(0.04, 0.16, 0.03, 0.01), m.steel, at(-2.43, 1.05, lz + 0.08));
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.36, 0.12),
      stencilDecal([{ text: 'SEC-07', size: 0.8, y: 0.82 }], 384, 128, '#2a2a26', 'locker'),
    );
    label.position.set(-2.443, 1.5, lz - 0.2);
    label.rotation.y = Math.PI / 2;
    root.add(label);
  }

  // ---------------------------------------------------------------- crates (right side)
  const crate = (x: number, y: number, z: number, s: number, ry: number): void => {
    mb.add(rounded(s, s, s, 0.03), m.paintTeal, at(x, y + s / 2, z, 0, ry, 0));
    for (const f of [0.18, 0.82]) mb.add(rounded(s + 0.02, 0.06, s + 0.02, 0.01), m.steel, at(x, y + s * f, z, 0, ry, 0));
  };
  crate(2.32, 0, -6.6, 0.9, 0.05);
  crate(2.28, 0.9, -6.55, 0.6, -0.2);
  crate(2.25, 0, -5.4, 0.7, 0.35);

  // ---------------------------------------------------------------- wall vent with fan (right wall)
  {
    const vx = 2.91;
    const vy = 0.62;
    const vz = 6.8;
    for (const dy of [-0.255, 0.255]) mb.add(rounded(0.06, 0.05, 0.56, 0.01), m.steel, at(vx, vy + dy, vz));
    for (const dz of [-0.255, 0.255]) mb.add(rounded(0.06, 0.56, 0.05, 0.01), m.steel, at(vx, vy, vz + dz));
    mb.add(boxUv(0.015, 0.46, 0.46, 0.4), m.grating, at(vx - 0.025, vy, vz));
    mb.add(boxUv(0.005, 0.46, 0.46), m.black, at(vx + 0.028, vy, vz));
    const fan = new THREE.Group();
    fan.position.set(vx + 0.008, vy, vz);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 12), m.steel);
    hub.rotation.z = Math.PI / 2;
    fan.add(hub);
    for (let k = 0; k < 4; k++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.2, 0.06), m.steel);
      const a = (k * Math.PI) / 2;
      blade.position.set(0, Math.cos(a) * 0.12, Math.sin(a) * 0.12);
      blade.rotation.set(a, 0.35, 0, 'XYZ');
      fan.add(blade);
    }
    add(fan);
    tickers.push((_t, dt) => {
      fan.rotation.x += dt * 9;
    });
  }

  // ---------------------------------------------------------------- sealed pressure door (-Z)
  {
    const dz = -HALF_L;
    mb.add(boxUv(1.9, 3.8, 0.1), m.paintDark, at(-2.05, 1.3, dz - 0.05));
    mb.add(boxUv(1.9, 3.8, 0.1), m.paintDark, at(2.05, 1.3, dz - 0.05));
    mb.add(boxUv(2.2, 0.6, 0.1), m.paintDark, at(0, 2.9, dz - 0.05));
    for (const s of [-1, 1]) {
      mb.add(rounded(0.32, 2.8, 0.36, 0.03), m.steel, at(s * 1.26, 1.4, dz + 0.12));
      mb.add(boxUv(0.22, 2.5, 0.02), m.paintDark, at(s * 1.26, 1.4, dz + 0.31));
      mb.add(rounded(1.1, 2.6, 0.12, 0.02), m.paintDark, at(s * 0.55, 1.3, dz + 0.02));
      mb.add(boxUv(1.06, 0.22, 0.02), m.steelBrushed, at(s * 0.55, 0.9, dz + 0.09));
      mb.add(boxUv(0.3, 0.18, 0.02), m.black, at(s * 0.55, 1.95, dz + 0.085));
    }
    mb.add(rounded(2.84, 0.34, 0.36, 0.03), m.steel, at(0, 2.77, dz + 0.12));
    mb.add(boxUv(0.012, 2.6, 0.13), m.black, at(0, 1.3, dz + 0.02));
    mb.add(cylinderBetween(V(-0.35, 1.6, dz + 0.11), V(0.35, 1.6, dz + 0.11), 0.03, 12), m.steel);
    mb.add(cylinderBetween(V(-0.35, 1.0, dz + 0.11), V(0.35, 1.0, dz + 0.11), 0.03, 12), m.steel);

    // Door status panel.
    mb.add(rounded(0.42, 0.56, 0.06, 0.015), m.steel, at(1.8, 1.4, dz + 0.03));
    const panel = new CanvasScreen(256, 320, drawDoorPanel, 1.8, 6);
    const panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.44), panel.material);
    panelMesh.position.set(1.8, 1.4, dz + 0.062);
    root.add(panelMesh);
    tickers.push((t) => panel.update(t));

    // TAG Industries: emblem across the seam, banner on the lintel.
    const doorMark = new THREE.Mesh(
      new THREE.PlaneGeometry(0.75, 0.75),
      paintedDecal((ctx, w, h) => drawTagMark(ctx, w / 2, h / 2, w * 0.47, { ink: '#cfe8f0', accent: '#3aa8a3' }), 512, 512, 'door-tag'),
    );
    doorMark.position.set(0, 2.2, dz + 0.086);
    root.add(doorMark);
    const lintel = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 0.284),
      paintedDecal((ctx, w) => drawTagBanner(ctx, 0, 0, w, { ink: '#cfe8f0', accent: '#4fd6d0' }), 1620, 200, 'lintel-tag'),
    );
    lintel.position.set(0, 2.77, dz + 0.302);
    root.add(lintel);

    // Blood on the left leaf.
    const blood = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.5), bloodDecal(512, 768, 'door-blood'));
    blood.position.set(-0.45, 1.25, dz + 0.102);
    root.add(blood);

    // Floor warning.
    const caution = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 0.55),
      stencilDecal([{ text: 'CAUTION  -  PRESSURE DOOR', size: 0.5, y: 0.68 }], 1024, 256, '#c99a12', 'floor-caution'),
    );
    caution.rotation.x = -Math.PI / 2;
    caution.position.set(0, 0.003, dz + 1.3);
    root.add(caution);

    // Alarm beacon with a sweeping red spot.
    mb.add(new THREE.CylinderGeometry(0.075, 0.085, 0.06, 16), m.steel, at(0, 2.97, dz + 0.36));
    const beaconMat = fixtureMaterial(0xff2a1a, 3);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), beaconMat);
    dome.position.set(0, 3.0, dz + 0.36);
    root.add(dome);
    const beacon = new THREE.SpotLight(0xff2a14, 30, 12, THREE.MathUtils.degToRad(26), 0.5, 1.5);
    beacon.position.set(0, 2.92, dz + 0.5);
    root.add(beacon, beacon.target);
    let angle = 0;
    tickers.push((_t, dt) => {
      angle += dt * 2.6;
      beacon.target.position.set(beacon.position.x + Math.sin(angle) * 4, 1.0, beacon.position.z + Math.cos(angle) * 4);
    });
    lights.add({ name: 'alarm beacon', light: beacon, base: 30, pattern: 'alarm', seed: 2, emissives: [beaconMat], emissiveBase: 3, shafts: [], shaftBase: 0 });
  }

  // ---------------------------------------------------------------- save station (left wall, near start)
  {
    const sz = 8.0;
    mb.add(rounded(0.14, 0.78, 0.56, 0.02), m.paintDark, at(-2.88, 1.35, sz));
    mb.add(rounded(0.06, 0.06, 0.62, 0.015), m.steel, at(-2.84, 1.77, sz));
    mb.add(rounded(0.18, 0.08, 0.4, 0.02), m.steel, at(-2.86, 0.94, sz));
    const terminal = new CanvasScreen(256, 320, drawSaveStation, 1.7, 4);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.52), terminal.material);
    face.position.set(-2.809, 1.38, sz);
    face.rotation.y = Math.PI / 2;
    root.add(face);
    tickers.push((t) => terminal.update(t));
    const lamp = fixtureMaterial(0x39ff9e, 2.4);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), lamp);
    led.position.set(-2.805, 1.71, sz + 0.22);
    root.add(led);
    tickers.push((t) => {
      lamp.emissiveIntensity = 1.2 + Math.sin(t * 2.4) * 1.1;
    });
  }

  // ---------------------------------------------------------------- start wall (+Z) and signage
  mb.add(boxUv(6, 3.8, 0.1), m.paintDark, at(0, 1.3, HALF_L + 0.05));
  {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.0),
      stencilDecal(
        [
          { text: '07', size: 0.62, y: 0.6 },
          { text: 'DECK 3  /  SECTION 07', size: 0.12, y: 0.82 },
        ],
        800,
        500,
        '#d8d2c0',
        'start-sign',
      ),
    );
    sign.position.set(0, 1.7, HALF_L - 0.002);
    sign.rotation.y = Math.PI;
    root.add(sign);

    // Large painted TAG Industries logo across the left wall's teal panels (bay z -2.5..0).
    const wallLogo = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 0.683),
      paintedDecal((ctx, w) => drawTagLockup(ctx, 0, 0, w, { ink: '#d8d2c0', accent: '#d8d2c0' }), 1200, 410, 'wall-tag'),
    );
    wallLogo.position.set(-2.935, 1.9, -1.25);
    wallLogo.rotation.y = Math.PI / 2;
    root.add(wallLogo);

    const labB = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 0.5),
      stencilDecal(
        [
          { text: 'LAB B', size: 0.5, y: 0.55 },
          { text: 'OBSERVATION  07', size: 0.16, y: 0.84 },
        ],
        800,
        400,
        '#d8d2c0',
        'lab-b',
      ),
    );
    labB.position.set(-2.935, 1.95, -8.2);
    labB.rotation.y = Math.PI / 2;
    root.add(labB);
  }

  // ---------------------------------------------------------------- dust
  const dust = new Particulates(rng.fork('dust'));
  root.add(dust.points);

  root.add(mb.build('demo-room-static'));

  return {
    group: root,
    lights,
    spawn: { position: V(0, 1.62, 8.6), yaw: 0 },
    bounds: new THREE.Box3(V(-2.5, 0.4, -9.5), V(2.5, 2.9, 9.5)),
    anchors: {
      vent: V(2.9, 0.62, 6.8),
      window: V(3.1, 1.6, 0),
      abyss: V(10, 2.5, 0),
      console: V(-2.6, 1.2, -6.25),
      door: V(0, 1.5, -11.5),
      fixtures: fixtureAnchors,
      drips: [V(-2.4, -0.45, -7.2), V(2.4, -0.45, -3.1), V(-2.4, -0.45, 3.9), V(2.4, -0.45, 8.1), V(2.85, 0.9, 1.2)],
      ceiling: [-8, -3, 2, 7].flatMap((z) => [V(-1.6, 2.72, z), V(1.45, 2.76, z + 1.5)]),
      saveStation: V(-2.8, 1.35, 8.0),
      checkpoints: [
        { id: 'cp_start', label: 'Section 07 - entrance', zBelow: 99 },
        { id: 'cp_window', label: 'Lab B - observation window', zBelow: 1.0 },
        { id: 'cp_door', label: 'Lab B - pressure door', zBelow: -6.5 },
      ],
    },
    update(t, dt, cameraPosition, reducedFlashing) {
      for (const tick of tickers) tick(t, dt);
      lights.update(t, reducedFlashing);
      dust.update(cameraPosition, t, dt);
    },
  };
}

function drawConsole(ctx: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  ctx.fillStyle = '#020a0c';
  ctx.fillRect(0, 0, w, h);
  ctx.font = `600 22px ${SCREEN_FONT}`;
  ctx.fillStyle = '#7fe3d0';
  ctx.fillText('THALASSA // LAB B MONITOR', 18, 34);
  ctx.fillRect(18, 44, w - 36, 2);
  drawTagMark(ctx, w - 36, 26, 15, { ink: '#7fe3d0', accent: '#3f8f82' });
  ctx.font = `20px ${SCREEN_FONT}`;
  const rows: Array<[string, string]> = [
    ['O2', `${(20.9 + Math.sin(t * 0.7) * 0.1).toFixed(1)} %`],
    ['HULL PRESSURE', `${(301.4 + Math.sin(t * 0.31) * 0.3).toFixed(1)} ATM`],
    ['TEMP', '4.1 C'],
    ['SPECIMEN B-7', 'STABLE'],
  ];
  rows.forEach(([k, v], i) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5fb8a8';
    ctx.fillText(k, 18, 82 + i * 30);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#bff7ea';
    ctx.fillText(v, w - 18, 82 + i * 30);
  });
  ctx.textAlign = 'left';
  ctx.fillStyle = Math.floor(t * 2) % 2 === 0 ? '#ffb020' : '#6b4a10';
  ctx.fillText('CONTAINMENT: CHECK REQUIRED', 18, 222);
  if (Math.floor(t * 3) % 2 === 0) {
    ctx.fillStyle = '#7fe3d0';
    ctx.fillRect(18, 240, 12, 20);
  }
  ctx.strokeStyle = '#3f8f82';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < 170; x++) {
    const y = h - 26 - 14 * Math.sin(x * 0.12 + t * 2) * (0.6 + 0.4 * Math.sin(x * 0.031 + t));
    if (x === 0) ctx.moveTo(w - 190 + x, y);
    else ctx.lineTo(w - 190 + x, y);
  }
  ctx.stroke();
}

function drawSaveStation(ctx: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  ctx.fillStyle = '#021208';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#39ff9e';
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#39ff9e';
  ctx.font = `700 30px ${SCREEN_FONT}`;
  ctx.fillText('SAVE', w / 2, 70);
  ctx.fillText('STATION', w / 2, 104);
  // Pulsing ring.
  const r = 34 + Math.sin(t * 2.4) * 4;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(w / 2, 180, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w / 2, 180, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `15px ${SCREEN_FONT}`;
  ctx.fillStyle = '#7fe8b4';
  ctx.fillText('PERSONNEL LOG', w / 2, 252);
  ctx.fillText(Math.floor(t * 1.5) % 2 === 0 ? 'READY' : '', w / 2, 278);
}

function drawDoorPanel(ctx: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  ctx.fillStyle = '#120304';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#ff3b2f';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  drawTagMark(ctx, w / 2, 44, 24, { ink: '#c96a5f', accent: '#ff3b2f' });
  // Padlock.
  const on = Math.floor(t * 1.5) % 2 === 0;
  ctx.strokeStyle = ctx.fillStyle = on ? '#ff3b2f' : '#8a1d16';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(w / 2, 108, 34, Math.PI, 0);
  ctx.stroke();
  ctx.fillRect(w / 2 - 52, 106, 104, 70);
  ctx.fillStyle = '#120304';
  ctx.fillRect(w / 2 - 6, 130, 12, 26);
  ctx.textAlign = 'center';
  ctx.fillStyle = on ? '#ff3b2f' : '#b52a20';
  ctx.font = `700 46px ${SCREEN_FONT}`;
  ctx.fillText('SEALED', w / 2, 236);
  ctx.font = `15px ${SCREEN_FONT}`;
  ctx.fillStyle = '#c96a5f';
  ctx.fillText('PRESSURE DIFFERENTIAL', w / 2, 266);
  ctx.fillText('LOCKDOWN 07-B', w / 2, 290);
}
