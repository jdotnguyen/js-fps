import * as THREE from 'three';
import { type HandMaterials, type HandPose, buildHand } from './hand.ts';
import { AmmoScreen, createWeaponMaterials, cylZ, extrudeProfile, labelTexture, mesh, rbox, type WeaponMaterials } from './parts.ts';
import { elbowBend, type Placement, type WeaponRig } from './rig.ts';

/**
 * SEC-9 security pistol (ADR-0005). Compact slab-sided service pistol: bare-steel slide with
 * serrations and a tilted rear ammo readout, polymer frame, stippled grip, under-barrel laser,
 * detachable magazine as its own part. Origin: top of the backstrap where the hand's web sits.
 */

const GRIP_TILT = 0.28;

/** Strong (right) hand: palm on the backstrap, fingers wrapped round the front strap, index on the trigger, thumb along the left of the frame. */
export const PISTOL_RIGHT_POSE: HandPose = {
  index: { mcp: 0.6, pip: 0.55, dip: 0.25, spread: 0 },
  middle: { mcp: 0.95, pip: 1.35, dip: 0.6, spread: 0 },
  ring: { mcp: 1.0, pip: 1.4, dip: 0.6, spread: -0.04 },
  little: { mcp: 1.05, pip: 1.4, dip: 0.6, spread: -0.1 },
  thumb: { mc: [1.1, 0.5], pp: [1.0, 0.8], dp: [0.9, 0.8] },
};

/** Support (left) hand: cups the grip from the left below the right hand, fingers wrapped over the front, thumb forward. */
export const PISTOL_LEFT_POSE: HandPose = {
  index: { mcp: 0.85, pip: 1.25, dip: 0.55, spread: 0 },
  middle: { mcp: 0.9, pip: 1.3, dip: 0.55, spread: 0 },
  ring: { mcp: 0.95, pip: 1.35, dip: 0.55, spread: -0.03 },
  little: { mcp: 1.0, pip: 1.35, dip: 0.55, spread: -0.08 },
  thumb: { mc: [0.45, 0.5], pp: [0.3, 0.85], dp: [0.15, 0.85] },
};

export const PISTOL_RIGHT_PLACEMENT: Placement = { pos: [-0.0192, -0.0565, 0.0831], rot: [1.5707963267948966, 0, -0.9272952180016123] };
export const PISTOL_LEFT_PLACEMENT: Placement = { pos: [0.0152, -0.0795, 0.0801], rot: [-1.5707963267948966, 0, 2.214297435588181] };

export interface PistolOptions {
  /** Build the support (left) hand too. Off by default while hands are being reworked. */
  twoHanded?: boolean;
  /** Hand mesh resolution in metres (default is the fine lab setting). */
  voxel?: number;
  rightPose?: HandPose;
  leftPose?: HandPose;
  rightPlace?: Placement;
  leftPlace?: Placement;
  rightBend?: { yaw: number; pitch: number };
  leftBend?: { yaw: number; pitch: number };
}

export function buildPistol(wm: WeaponMaterials, hm: HandMaterials, opts: PistolOptions = {}): WeaponRig {
  const rp = opts.rightPlace ?? PISTOL_RIGHT_PLACEMENT;
  const lp = opts.leftPlace ?? PISTOL_LEFT_PLACEMENT;
  const root = new THREE.Group();
  root.name = 'pistol';
  const add = (m: THREE.Object3D, parent: THREE.Object3D = root): THREE.Object3D => {
    parent.add(m);
    return m;
  };
  const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T => {
    o.position.set(x, y, z);
    return o;
  };

  // --- slide (the part that cycles) ---
  const slide = new THREE.Group();
  slide.name = 'slide';
  add(slide);
  const W = 0.0292;
  const body = mesh(
    extrudeProfile([[-0.019, 0.0045], [-0.019, 0.0305], [-0.0155, 0.0335], [0.138, 0.0335], [0.1485, 0.0295], [0.1485, 0.0045]], W, 0.0022),
    wm.slide,
    'slide-body',
  );
  add(body, slide);
  // Serrations: dark grooves cut across both flanks, front and rear.
  for (let i = 0; i < 6; i++) {
    for (const a of [0.114 + i * 0.0036, -0.0155 + i * 0.0036 - 0.001]) {
      add(at(mesh(rbox(W + 0.0004, 0.0215, 0.0011, 0.0004), wm.dark, 'serration'), 0, 0.0185, -a), slide);
    }
  }
  // Ejection port on the right flank.
  add(at(mesh(rbox(0.0012, 0.0105, 0.037, 0.0004), wm.dark, 'ejection-port'), W / 2 + 0.0004, 0.0225, -0.05), slide);
  // Muzzle: bare-steel barrel stub with a bore.
  add(at(mesh(cylZ(0.0062, 0.012), wm.steel, 'barrel'), 0, 0.0185, -0.1495), slide);
  add(at(mesh(cylZ(0.0036, 0.004), wm.dark, 'bore'), 0, 0.0185, -0.1558), slide);
  // Iron sights with tritium-style dots.
  add(at(mesh(rbox(0.004, 0.0052, 0.007, 0.0006), wm.dark, 'front-sight'), 0, 0.0361, -0.138), slide);
  add(at(mesh(cylZ(0.0011, 0.0008, 10), wm.cyan, 'front-dot'), 0, 0.0368, -0.1415), slide);
  for (const sx of [-0.0043, 0.0043]) {
    add(at(mesh(rbox(0.0036, 0.0055, 0.0075, 0.0006), wm.dark, 'rear-sight'), sx, 0.0362, -0.0035), slide);
    add(at(mesh(cylZ(0.0011, 0.0008, 10), wm.cyan, 'rear-dot'), sx, 0.0367, 0.0003), slide);
  }
  // Etched legend on the right flank.
  const tex = labelTexture(['SEC-9  9x19', 'TAG IND. SECURITY DIV.'], 512, 96);
  const labelMat = wm.label.clone();
  labelMat.map = tex;
  const decal = mesh(new THREE.PlaneGeometry(0.058, 0.0109), labelMat, 'legend');
  decal.rotation.y = Math.PI / 2;
  decal.position.set(W / 2 + 0.0027, 0.0125, -0.082);
  add(decal, slide);

  // --- rear ammo readout: a sloped pod on top-rear of the slide, facing the shooter ---
  const pod = new THREE.Group();
  pod.name = 'ammo-pod';
  add(pod, slide);
  add(mesh(extrudeProfile([[-0.019, 0.0325], [-0.019, 0.0375], [0.0035, 0.049], [0.0035, 0.0325]], 0.0235, 0.0018), wm.slide, 'pod'), pod);
  const screen = new AmmoScreen('pistol');
  const slope = Math.atan2(0.049 - 0.0375, 0.0035 + 0.019); // face rises away from the shooter, tipped back at the eye
  const face = mesh(new THREE.PlaneGeometry(0.0185, 0.0235), screen.material, 'ammo-screen');
  face.rotation.x = -Math.PI / 2 + slope;
  face.position.set(0, 0.04325, 0.00775);
  face.translateZ(0.0016);
  add(face, pod);

  // --- frame ---
  add(mesh(extrudeProfile([[-0.019, 0.0045], [0.124, 0.0045], [0.124, -0.0125], [0.04, -0.0165], [-0.019, -0.0165]], 0.0272, 0.0022), wm.polymer, 'frame'));
  // Grip: tilted slab with stipple, magazine floorplate showing underneath.
  const grip = new THREE.Group();
  grip.name = 'grip-tilt';
  grip.position.set(0, -0.004, 0.019);
  grip.rotation.x = -GRIP_TILT;
  add(grip);
  add(at(mesh(rbox(0.0305, 0.104, 0.038, 0.0075), wm.grip, 'grip'), 0, -0.052, -0.019), grip);
  add(at(mesh(rbox(0.0316, 0.012, 0.0355, 0.004), wm.polymer, 'grip-cap'), 0, -0.002, -0.0195), grip);
  // Magazine: separate part so reloads can drop it.
  const mag = new THREE.Group();
  mag.name = 'magazine';
  add(mag, grip);
  add(at(mesh(rbox(0.0262, 0.098, 0.031, 0.003), wm.steel, 'mag-body'), 0, -0.052, -0.019), mag);
  add(at(mesh(rbox(0.0336, 0.0095, 0.0455, 0.0035), wm.polymer, 'mag-plate'), 0, -0.1085, -0.0185), mag);
  add(at(mesh(rbox(0.0338, 0.0016, 0.0457, 0.0006), wm.dark, 'mag-plate-line'), 0, -0.1035, -0.0185), mag);
  // Trigger guard, trigger, release and slide stop.
  const guardCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.012, -0.1), new THREE.Vector3(0, -0.032, -0.098), new THREE.Vector3(0, -0.0425, -0.085),
    new THREE.Vector3(0, -0.0435, -0.04), new THREE.Vector3(0, -0.04, -0.016),
  ]);
  add(mesh(new THREE.TubeGeometry(guardCurve, 24, 0.0022, 8, false), wm.polymer, 'trigger-guard'));
  const trigger = new THREE.Group();
  trigger.name = 'trigger';
  trigger.position.set(0, -0.012, -0.05);
  add(trigger);
  const tBlade = mesh(rbox(0.0058, 0.027, 0.0065, 0.0016), wm.steel, 'trigger-blade');
  tBlade.position.set(0, -0.012, 0);
  tBlade.rotation.x = 0.22;
  trigger.add(tBlade);
  add(at(mesh(cylZ(0.0023, 0.004, 12), wm.steel, 'mag-release'), 0, 0, 0)).rotation.set(0, 0, Math.PI / 2);
  const release = root.children[root.children.length - 1]!;
  release.position.set(-0.0138, -0.0085, -0.0235);
  add(at(mesh(rbox(0.0026, 0.0052, 0.024, 0.001), wm.steel, 'slide-stop'), -0.0141, 0.0015, -0.04));

  // --- under-barrel laser ---
  const laser = new THREE.Group();
  laser.name = 'laser';
  add(laser);
  add(at(mesh(rbox(0.0205, 0.0145, 0.036, 0.0035), wm.paint, 'laser-body'), 0, -0.0245, -0.1055), laser);
  add(at(mesh(cylZ(0.0043, 0.003, 16), wm.glass, 'laser-lens'), 0, -0.0245, -0.1245), laser);
  add(at(mesh(cylZ(0.0019, 0.0012, 12), wm.cyan, 'laser-diode'), 0, -0.0245, -0.1258), laser);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0x2fd3ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const beam = mesh(cylZ(0.0006, 6, 6), beamMat, 'laser-beam');
  beam.position.set(0, -0.0245, -0.1258 - 3);
  laser.add(beam);

  // --- muzzle marker for flashes ---
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 0.0185, -0.158);
  add(muzzle);

  // --- hands ---
  const right = buildHand(opts.rightPose ?? PISTOL_RIGHT_POSE, { right: true, materials: hm, ...(opts.voxel ? { voxel: opts.voxel } : {}), bend: opts.rightBend ?? elbowBend(rp, [0.6, -0.45, 0.65], true) });
  right.group.position.set(...rp.pos);
  right.group.rotation.set(...rp.rot);
  right.group.name = 'hand-right';
  add(right.group);
  if (opts.twoHanded) {
  const left = buildHand(opts.leftPose ?? PISTOL_LEFT_POSE, { right: false, materials: hm, ...(opts.voxel ? { voxel: opts.voxel } : {}), watch: true, ...(opts.leftBend ? { bend: opts.leftBend } : {}) });
  left.group.position.set(...lp.pos);
  left.group.rotation.set(...lp.rot);
  left.group.name = 'hand-left';
  add(left.group);
  }

  return {
    id: 'pistol',
    root,
    mover: slide,
    moverTravel: 0.028,
    mag,
    muzzle,
    setAmmo(loaded, reserve) {
      screen.set(loaded, reserve);
    },
    setLaser(strength) {
      beamMat.opacity = 0.55 * strength;
      beam.visible = strength > 0.01;
    },
    setTrigger(pull) {
      trigger.position.z = -0.05 + 0.0045 * pull;
    },
  };
}

export { createWeaponMaterials };
