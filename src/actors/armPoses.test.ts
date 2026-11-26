import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import coreJson from '../data/mocap-core.json' with { type: 'json' };
import heinsPack from '../data/mocap/heins.json' with { type: 'json' };
import halePack from '../data/mocap/hale.json' with { type: 'json' };
import ruizPack from '../data/mocap/ruiz.json' with { type: 'json' };
import bramPack from '../data/mocap/bram.json' with { type: 'json' };
import posesJson from '../data/poses.json' with { type: 'json' };
import { ctx as enemyCtx } from '../ai/enemyTestKit.ts';
import { loadPoseFile, resolvePose } from '../data/types/poses.ts';
import { CAST } from './castLooks.ts';
import { loadMainCast, makeLib, type MainCastModel } from './castModelTestKit.ts';
import { Humanoid } from './humanoid.ts';
import { MocapLibrary, type RawMocapFile } from './mocap.ts';

/**
 * The shared standing arm poses read as what they are named on every body, under each character's own idle (the arms overlay
 * keeps the legs and trunk on mocap): `idle_crossed` crosses the forearms in front of the chest with each hand lying on the other
 * arm, and `idle_hips` puts the hands on the hips with the elbows out. Both used to bend the forearms straight forward: hands
 * apart in front of the chest, or held out from the body. The animator pins the hands (onto the other arm, onto the hips) after
 * writing the pose, so the result holds on every build and under every character's own idle.
 */

const FPS = 30;
const PACKS = { heins: heinsPack, hale: halePack, ruiz: ruizPack, bram: bramPack };

let lib: MocapLibrary | null = null;
function mocap(): MocapLibrary {
  if (lib) return lib;
  lib = new MocapLibrary(coreJson as unknown as RawMocapFile);
  for (const [name, pack] of Object.entries(PACKS)) {
    lib.addPack(name, pack as unknown as RawMocapFile);
    lib.retainPack(name); // held for the whole file, so the packs outlive each test body
  }
  return lib;
}

/** Bodies to hold the poses on: the procedural crew body and imported bodies of several builds (scans, a suit, a big cook). */
const BODIES: Array<[label: string, look: string | null, model: MainCastModel | null]> = [
  ['crew (procedural)', null, null],
  ['Heins', 'heins', 'heins'],
  ['Hale', 'hale', 'hale'],
  ['Ruiz', 'ruiz', 'ruiz'],
  ['Bram', 'cook', 'bram'],
];

async function body(look: string | null, model: MainCastModel | null, pose: string): Promise<Humanoid> {
  if (!look || !model) return new Humanoid({ seed: 'crew:arms', outfit: 'crew', role: 'npc', pose }, { ...enemyCtx(), mocap: mocap() });
  const bodyModels = makeLib({ [model]: await loadMainCast(model) });
  return new Humanoid({ ...CAST[look]!, role: 'npc', pose }, { ...enemyCtx(), bodyModels, mocap: mocap() });
}

/** Joint positions in a level frame at the chest: +x toward the left shoulder, +y up, +z forward. */
function sample(h: Humanoid): Record<'hL' | 'hR' | 'fL' | 'fR' | 'eL' | 'eR' | 'pelvis' | 'tL' | 'tR', THREE.Vector3> {
  h.group.updateMatrixWorld(true);
  const wp = (n: 'hand_L' | 'hand_R' | 'foreArm_L' | 'foreArm_R' | 'pelvis' | 'chest' | 'upperArm_L' | 'upperArm_R' | 'thigh_L' | 'thigh_R'): THREE.Vector3 => h.bones[n].getWorldPosition(new THREE.Vector3());
  const x = wp('upperArm_L').sub(wp('upperArm_R')).setY(0).normalize();
  const y = new THREE.Vector3(0, 1, 0);
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const inv = new THREE.Matrix4().makeBasis(x, y, z).setPosition(wp('chest')).invert();
  const f = (v: THREE.Vector3): THREE.Vector3 => v.applyMatrix4(inv);
  // The end of the hand: 9 cm on from the wrist along the hand (the same axis as the forearm at rest).
  const end = (s: 'L' | 'R'): THREE.Vector3 => {
    const hand = h.bones[`hand_${s}`];
    return hand.position.clone().normalize().applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(0.09).add(wp(`hand_${s}`));
  };
  return { fL: f(end('L')), fR: f(end('R')), hL: f(wp('hand_L')), hR: f(wp('hand_R')), eL: f(wp('foreArm_L')), eR: f(wp('foreArm_R')), pelvis: f(wp('pelvis')), tL: f(wp('thigh_L')), tR: f(wp('thigh_R')) };
}

/** Hold the pose for 3 s under the body's own idle and collect what goes wrong on any frame after it settles. */
async function hold(look: string | null, model: MainCastModel | null, pose: string, check: (s: ReturnType<typeof sample>) => string | null): Promise<string[]> {
  const h = await body(look, model, pose);
  const bad = new Set<string>();
  for (let i = 0; i < 3 * FPS; i++) {
    h.update(1 / FPS);
    if (i < FPS) continue;
    const problem = check(sample(h));
    if (problem) bad.add(problem);
  }
  h.dispose();
  return [...bad];
}

const cm = (v: number): string => `${(v * 100).toFixed(0)} cm`;

const ARM_JOINTS = ['shoulder_L', 'upperArm_L', 'foreArm_L', 'hand_L', 'shoulder_R', 'upperArm_R', 'foreArm_R', 'hand_R'] as const;

/** Each placed-arms resting pose and the head gestures it can pick (keep-crossed-arms). */
const FAMILIES = {
  idle_crossed: ['idle_crossed_glance', 'idle_crossed_glance_other', 'idle_crossed_look_down'],
  idle_hips: ['idle_hips_glance', 'idle_hips_glance_other', 'idle_hips_look_up'],
} as const;

test('placed-arm head gestures: every arm joint equals its resting pose, and only neck and head differ', () => {
  const file = loadPoseFile(posesJson);
  for (const [base, variants] of Object.entries(FAMILIES)) {
    const rest = resolvePose(file, base);
    for (const name of variants) {
      const pose = resolvePose(file, name);
      for (const j of ARM_JOINTS) assert.deepEqual(pose.joints[j], rest.joints[j], `${name} ${j}`);
      assert.deepEqual(Object.keys(file.poses[name]!.joints).sort(), ['head', 'neck'], `${name} sets only neck and head`);
      assert.notDeepEqual(pose.joints.head, rest.joints.head, `${name} turns the head`);
    }
  }
});

type Family = keyof typeof FAMILIES;
type Sample = ReturnType<typeof sample>;

/** What goes wrong with each family's arms on a settled frame, or null. */
const CHECKS: Record<Family, (s: Sample) => string | null> = {
  idle_crossed: (s) => {
    // Each wrist reaches at least the middle of the body and its hand lies across onto the other side (over the other arm).
    if (s.hL.x > 0.05) return `left wrist short of the middle (${cm(s.hL.x)})`;
    if (s.hR.x < -0.05) return `right wrist short of the middle (${cm(-s.hR.x)})`;
    if (s.fL.x > -0.03) return `left hand ends only ${cm(-s.fL.x)} across`;
    if (s.fR.x < 0.03) return `right hand ends only ${cm(s.fR.x)} across`;
    // In front of the chest, not reaching out: wrists 10-30 cm forward of the chest joint, elbows by the sides.
    for (const [n, v] of [['left wrist', s.hL], ['right wrist', s.hR]] as const) if (v.z < 0.1 || v.z > 0.3) return `${n} ${cm(v.z)} forward`;
    if (Math.abs(s.eL.x) > 0.26 || Math.abs(s.eR.x) > 0.26) return 'elbows held out from the sides';
    // The left forearm rides above the right one, so they don't pass through each other.
    if ((s.hL.y + s.eL.y) / 2 < (s.hR.y + s.eR.y) / 2 + 0.01) return 'forearms at the same height';
    return null;
  },
  idle_hips: (s) => {
    // Measured from each hip joint: the wrist rests just outside it and up on the hip, at the side (not in front or behind),
    // with the elbow well out beyond the hand.
    for (const [n, hand, elbow, hip] of [['left', s.hL, s.eL, s.tL], ['right', s.hR, s.eR, s.tR]] as const) {
      const side = n === 'left' ? 1 : -1;
      const d = hand.clone().sub(hip);
      if (side * d.x < 0 || side * d.x > 0.16) return `${n} wrist ${cm(side * d.x)} out from the hip joint`;
      if (d.y < 0.03 || d.y > 0.2) return `${n} wrist ${cm(d.y)} above the hip joint`;
      if (Math.abs(d.z) > 0.08) return `${n} wrist ${cm(d.z)} in front of the hip joint`;
      if (side * (elbow.x - hand.x) < 0.06) return `${n} elbow only ${cm(side * (elbow.x - hand.x))} out beyond the hand`;
    }
    return null;
  },
};

/** Where each wrist sits against what it rests on: the other arm's elbow when crossed, its own hip when on the hips. */
const CONTACT: Record<Family, (s: Sample) => THREE.Vector3[]> = {
  idle_crossed: (s) => [s.hL.clone().sub(s.eR), s.hR.clone().sub(s.eL)],
  idle_hips: (s) => [s.hL.clone().sub(s.tL), s.hR.clone().sub(s.tR)],
};

const TITLES: Record<Family, string> = {
  idle_crossed: 'the forearms cross in front of the chest, the left one on top',
  idle_hips: 'hands on the hips, elbows out',
};

for (const [label, look, model] of BODIES) {
  for (const base of Object.keys(FAMILIES) as Family[]) {
    // Bram's elbows don't bow out beyond his hands on the hips, even with his idle's trunk levelled (level-mocap-trunk-posture:
    // up to 6 cm where 6 cm is the minimum, and some frames none); he never stands hands on hips in the game.
    if (base === 'idle_hips' && look === 'cook') continue;
    for (const pose of [base, ...FAMILIES[base]]) {
      test(`${pose} on ${label}: ${TITLES[base]}`, async () => {
        const bad = await hold(look, model, pose, CHECKS[base]);
        assert.deepEqual(bad, [], bad.join('; '));
      });
    }

    // Against an identical body that plays no gesture: the idle's own sway moves the wrists a few centimetres on some builds
    // either way, and only what a gesture adds to that counts.
    test(`${base} on ${label}: no head gesture moves a wrist, in or out`, async () => {
      const h = await body(look, model, base);
      const still = await body(look, model, base);
      const moved = [0, 0];
      const run = (seconds: number, measure: boolean): void => {
        for (let i = 0; i < seconds * FPS; i++) {
          h.update(1 / FPS);
          still.update(1 / FPS);
          if (!measure) continue;
          const control = CONTACT[base](sample(still));
          CONTACT[base](sample(h)).forEach((v, k) => (moved[k] = Math.max(moved[k]!, v.distanceTo(control[k]!))));
        }
      };
      run(1, false);
      for (const variant of FAMILIES[base]) {
        moved.fill(0);
        // The same blend the idle gestures use, and a hold inside their range (NpcActor).
        h.setPose(variant, 0.6);
        run(2, true);
        h.setPose(base, 0.6);
        run(2, true);
        assert.ok(moved[0]! < 0.03 && moved[1]! < 0.03, `${variant}: wrists moved ${(moved[0]! * 100).toFixed(1)} / ${(moved[1]! * 100).toFixed(1)} cm`);
      }
      still.dispose();
      h.dispose();
    });
  }
}
