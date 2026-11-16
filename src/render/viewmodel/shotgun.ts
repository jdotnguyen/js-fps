import * as THREE from 'three';
import { type HandMaterials, type HandPose, buildHand } from './hand.ts';
import { cylZ, extrudeProfile, mesh, rbox, type WeaponMaterials } from './parts.ts';
import { LOAD_BEND, LOAD_POSE, SHELL_IN_HAND } from './shotgunReload.ts';
import type { Placement, WeaponRig } from './rig.ts';

/**
 * Breacher pump shotgun (ADR-0005). Fixed stock, vented heat shield, tube magazine, ribbed rubber
 * pump forend riding on action bars. Six indicator LEDs on the receiver top show loaded shells.
 * Origin: centre of the stock wrist where the firing hand grips. -Z is the muzzle.
 */

export const SHOTGUN_RIGHT_POSE: HandPose = {
  index: { mcp: 0.5, pip: 0.5, dip: 0.2, spread: 0 },
  middle: { mcp: 0.95, pip: 1.35, dip: 0.6, spread: 0 },
  ring: { mcp: 1.0, pip: 1.4, dip: 0.6, spread: -0.04 },
  little: { mcp: 1.05, pip: 1.4, dip: 0.6, spread: -0.1 },
  thumb: { mc: [0.45, 0.5], pp: [0.3, 0.85], dp: [0.15, 0.85] },
};

export const SHOTGUN_LEFT_POSE: HandPose = {
  index: { mcp: 0.9, pip: 1.3, dip: 0.55, spread: 0 },
  middle: { mcp: 0.95, pip: 1.35, dip: 0.55, spread: 0 },
  ring: { mcp: 1.0, pip: 1.4, dip: 0.55, spread: -0.03 },
  little: { mcp: 1.05, pip: 1.4, dip: 0.55, spread: -0.08 },
  thumb: { mc: [0.45, 0.5], pp: [0.3, 0.85], dp: [0.15, 0.85] },
};

/**
 * Right hand: fist wrapped over the stock wrist from the right, fingers pointing along the gun, the forearm
 * trailing back and down toward the shooter's elbow (SHOTGUN_RIGHT_BEND swings the sleeve onto that line).
 * Derived with basisPlacement/elbowBend from rig.ts (palm surface at the wrist's right face).
 */
export const SHOTGUN_RIGHT_PLACEMENT: Placement = { pos: [0.033, 0.0169, 0.0679], rot: [1.5208, 0.7848, -1.6411] };
export const SHOTGUN_RIGHT_BEND = { yaw: -0.5209, pitch: 0.1273 };
/** Left hand placement is relative to the pump group (it travels with the forend): palm under the forend, fingers up round its right side, forearm trailing back and left. */
export const SHOTGUN_LEFT_PLACEMENT: Placement = { pos: [-0.0207, -0.0729, -0.007], rot: [3.1402, 0.1709, -0.3456] };
export const SHOTGUN_LEFT_BEND = { yaw: -1.1412, pitch: -0.2297 };

export interface ShotgunOptions {
  /** Hand mesh resolution in metres (default is the fine lab setting). */
  voxel?: number;
  rightPose?: HandPose;
  leftPose?: HandPose;
  rightPlace?: Placement;
  leftPlace?: Placement;
  rightBend?: { yaw: number; pitch: number };
  leftBend?: { yaw: number; pitch: number };
}

export const PUMP_CENTER_Z = -0.3;

export function buildShotgun(wm: WeaponMaterials, hm: HandMaterials, opts: ShotgunOptions = {}): WeaponRig {
  const root = new THREE.Group();
  root.name = 'shotgun';
  const add = <T extends THREE.Object3D>(m: T, parent: THREE.Object3D = root): T => {
    parent.add(m);
    return m;
  };
  const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T => {
    o.position.set(x, y, z);
    return o;
  };

  // --- stock and grip wrist ---
  add(at(mesh(rbox(0.037, 0.05, 0.11, 0.014), wm.grip, 'wrist'), 0, 0, 0));
  add(mesh(extrudeProfile([[-0.045, 0.025], [-0.335, 0.012], [-0.34, -0.092], [-0.2, -0.058], [-0.045, -0.026]], 0.038, 0.004), wm.polymer, 'stock'));
  const pad = mesh(rbox(0.042, 0.112, 0.018, 0.006), wm.rubber, 'butt-pad');
  pad.position.set(0, -0.039, 0.344);
  pad.rotation.x = 0.06;
  add(pad);

  // --- receiver ---
  add(at(mesh(rbox(0.041, 0.068, 0.14, 0.009), wm.paint, 'receiver'), 0, 0.003, -0.115));
  add(at(mesh(rbox(0.0012, 0.015, 0.05, 0.0005), wm.dark, 'ejection-port'), 0.0209, 0.016, -0.12));
  add(at(mesh(rbox(0.0262, 0.0012, 0.042, 0.0005), wm.dark, 'loading-port'), 0, -0.0312, -0.152));
  add(at(mesh(rbox(0.0042, 0.012, 0.03, 0.0015), wm.steel, 'safety'), 0, 0.0, -0.045)).visible = false;
  // Shell indicator strip on top: a recessed bezel with six LEDs, one per loaded shell.
  add(at(mesh(rbox(0.0175, 0.0018, 0.108, 0.0006), wm.dark, 'led-bezel'), 0, 0.0372, -0.117));
  const ledMats: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 6; i++) {
    const m = wm.cyan.clone();
    ledMats.push(m);
    const led = mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.0012, 14), m, `led-${i}`);
    led.position.set(0, 0.0384, -0.071 - i * 0.0185);
    add(led);
  }
  // Trigger guard and trigger.
  const guard = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.029, -0.093), new THREE.Vector3(0, -0.06, -0.086), new THREE.Vector3(0, -0.07, -0.052),
    new THREE.Vector3(0, -0.06, -0.02), new THREE.Vector3(0, -0.034, -0.012),
  ]);
  add(mesh(new THREE.TubeGeometry(guard, 28, 0.0024, 8, false), wm.paint, 'trigger-guard'));
  const trigger = new THREE.Group();
  trigger.position.set(0, -0.033, -0.052);
  add(trigger);
  const blade = mesh(rbox(0.0062, 0.026, 0.006, 0.0016), wm.steel, 'trigger-blade');
  blade.position.set(0, -0.012, 0);
  blade.rotation.x = 0.28;
  trigger.add(blade);

  // --- barrel, tube, heat shield, muzzle ---
  add(at(mesh(cylZ(0.0128, 0.53, 28), wm.slide, 'barrel'), 0, 0.019, -0.45));
  add(at(mesh(cylZ(0.0108, 0.43, 24), wm.slide, 'mag-tube'), 0, -0.0145, -0.4));
  add(at(mesh(cylZ(0.0128, 0.012, 24), wm.steel, 'tube-cap'), 0, -0.0145, -0.61));
  const shield = new THREE.Group();
  shield.name = 'heat-shield';
  add(shield);
  add(at(mesh(rbox(0.036, 0.0125, 0.31, 0.005), wm.paint, 'shield-body'), 0, 0.0375, -0.355), shield);
  for (let i = 0; i < 13; i++) {
    add(at(mesh(rbox(0.0125, 0.0016, 0.0125, 0.0005), wm.dark, 'shield-vent'), 0, 0.0439, -0.215 - i * 0.0225), shield);
  }
  add(at(mesh(rbox(0.0372, 0.003, 0.31, 0.001), wm.dark, 'shield-gap'), 0, 0.0305, -0.355), shield);
  add(at(mesh(cylZ(0.0148, 0.03, 28), wm.steel, 'muzzle'), 0, 0.019, -0.72));
  add(at(mesh(cylZ(0.0098, 0.004, 24), wm.dark, 'bore'), 0, 0.019, -0.7355));
  add(at(mesh(new THREE.CylinderGeometry(0.0013, 0.0016, 0.007, 10), wm.cyan, 'bead'), 0, 0.0365, -0.705));

  // --- pump forend on its action bars (moves back on cycle) ---
  const pump = new THREE.Group();
  pump.name = 'pump';
  pump.position.set(0, 0, PUMP_CENTER_Z);
  add(pump);
  add(at(mesh(rbox(0.052, 0.046, 0.17, 0.02), wm.rubber, 'forend'), 0, -0.014, 0), pump);
  for (let i = 0; i < 9; i++) {
    add(at(mesh(rbox(0.0545, 0.0485, 0.0036, 0.0016), wm.dark, 'rib'), 0, -0.014, -0.066 + i * 0.0165), pump);
  }
  for (const sx of [-0.0225, 0.0225]) {
    add(at(mesh(cylZ(0.0034, 0.1, 10), wm.steel, 'action-bar'), sx, -0.011, 0.14), pump);
  }
  add(at(mesh(rbox(0.058, 0.01, 0.012, 0.003), wm.paint, 'forend-cap'), 0, 0.004, -0.088), pump);

  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 0.019, -0.74);
  add(muzzle);

  // --- hands ---
  const rp = opts.rightPlace ?? SHOTGUN_RIGHT_PLACEMENT;
  const lp = opts.leftPlace ?? SHOTGUN_LEFT_PLACEMENT;
  const right = buildHand(opts.rightPose ?? SHOTGUN_RIGHT_POSE, { right: true, materials: hm, ...(opts.voxel ? { voxel: opts.voxel } : {}), bend: opts.rightBend ?? SHOTGUN_RIGHT_BEND });
  right.group.name = 'hand-right';
  right.group.position.set(...rp.pos);
  right.group.rotation.set(...rp.rot);
  add(right.group);
  const left = buildHand(opts.leftPose ?? SHOTGUN_LEFT_POSE, { right: false, materials: hm, ...(opts.voxel ? { voxel: opts.voxel } : {}), watch: true, bend: opts.leftBend ?? SHOTGUN_LEFT_BEND });
  left.group.name = 'hand-left';
  left.group.position.set(...lp.pos);
  left.group.rotation.set(...lp.rot);
  add(left.group, pump);

  // Loading hand: hidden until a reload; carries a shell cradled in the curled fingers.
  const load = buildHand(LOAD_POSE, { right: true, materials: hm, ...(opts.voxel ? { voxel: opts.voxel } : {}), bend: LOAD_BEND });
  load.group.name = 'hand-right-load';
  load.group.visible = false;
  const shell = new THREE.Group();
  shell.name = 'shell';
  shell.add(mesh(cylZ(0.0095, 0.05, 14), wm.shell, 'shell-hull'));
  const brass = mesh(cylZ(0.0099, 0.014, 14), wm.brass, 'shell-brass');
  brass.position.z = 0.019;
  shell.add(brass);
  shell.position.set(...SHELL_IN_HAND);
  shell.visible = false;
  load.group.add(shell);
  add(load.group);

  return {
    id: 'shotgun',
    root,
    mover: pump,
    moverTravel: 0.075,
    mag: null,
    muzzle,
    loadHand: load.group,
    shell,
    setAmmo(loaded) {
      ledMats.forEach((m, i) => {
        m.emissiveIntensity = i < loaded ? 2.4 : 0.05;
      });
    },
    setLaser() {
      /* shotgun has no laser */
    },
    setTrigger(pull) {
      trigger.position.z = -0.052 + 0.005 * pull;
    },
  };
}
