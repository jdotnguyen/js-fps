import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { NPC_ANIMS } from '../../ai/npcActor.ts';
import { loadSharedMocapLibrary } from '../mocap.ts';
import { creatureBody, necromorphModel } from './bladeTestKit.ts';
import { readLevel } from '../../data/levels/readLevel.ts';

/**
 * rig-necromorph + flooded-tunnel: R10 ambush door pry geometry and timing sync, plus Okafor/Giles doorway sightlines.
 * Verifies every frame of the pry keeps the creature's body behind the closed door, tracks the receding leaf edges without
 * clipping through the solid leaves during `pry_wrench`, and lunges both blades deep into R10 during `pry_thrust`.
 */

const DOOR_X = 30.0;
const DOOR_Z = 48.0;
const DOOR_BACK_X = 29.91;

const smooth = (u: number): number => {
  const c = THREE.MathUtils.clamp(u, 0, 1);
  return c * c * (3 - 2 * c);
};

/** Half-width (m) of the clear gap between the two `pressure_slide` leaves at openness `open` (0..1). */
const leafHalfGap = (open: number): number => Math.max(0, 0.98 * smooth(open) - 0.01);

/** World Z where segment A->B crosses plane X = `x`, or null if it does not cross. */
function crossZ(a: THREE.Vector3, b: THREE.Vector3, x: number): number | null {
  const dx = b.x - a.x;
  if (Math.abs(dx) < 1e-6) return null;
  const t = (x - a.x) / dx;
  return t >= 0 && t <= 1 ? a.z + (b.z - a.z) * t : null;
}

function anchorOf(id: string): { pos: [number, number, number]; yaw?: number } {
  for (const r of (readLevel('slice01') as { rooms: Array<{ anchors?: Array<{ id: string; pos: [number, number, number]; yaw?: number }> }> }).rooms) {
    const hit = r.anchors?.find((a) => a.id === id);
    if (hit) return hit;
  }
  throw new Error(`missing anchor "${id}"`);
}

test('R10 door pry: body stays behind the closed leaves, arms track the opening gap without clipping, blades thrust deep into R10', async () => {
  await loadSharedMocapLibrary();
  const model = await necromorphModel();
  const pryAnchor = anchorOf('r09_pry');
  const h = await creatureBody('flood_elite', 'idle');
  h.group.position.set(pryAnchor.pos[0], pryAnchor.pos[1], pryAnchor.pos[2]);
  h.setHeading(THREE.MathUtils.degToRad(pryAnchor.yaw ?? 270));
  const dt = 1 / 60;
  const cam = new THREE.Vector3(32.6, 1.62, 48.2);
  // Settle in stance before the ambush starts.
  for (let i = 0; i < 10; i++) h.update(dt, cam);

  let doorOpen = 0;
  let doorTarget = 0;
  let doorRate = 0;
  const pryDoor = (target: number, seconds: number): void => {
    doorTarget = target;
    doorRate = Math.abs(target - doorOpen) / Math.max(1e-3, seconds);
  };

  const stepDoor = (): void => {
    if (doorOpen < doorTarget) doorOpen = Math.min(doorTarget, doorOpen + doorRate * dt);
    else if (doorOpen > doorTarget) doorOpen = Math.max(doorTarget, doorOpen - doorRate * dt);
  };

  const measureArmDoorCross = (): { zL: number | null; zR: number | null; handL: THREE.Vector3; handR: THREE.Vector3; tipL: THREE.Vector3; tipR: THREE.Vector3 } => {
    h.group.updateMatrixWorld(true);
    const w = (n: string): THREE.Vector3 => h.group.getObjectByName(n)!.getWorldPosition(new THREE.Vector3());
    const faL = w('foreArm_L');
    const faR = w('foreArm_R');
    const handL = w('hand_L');
    const handR = w('hand_R');
    const tipL = h.group.getObjectByName('hand_L')!.localToWorld(new THREE.Vector3(...model.bladeTips!.L));
    const tipR = h.group.getObjectByName('hand_R')!.localToWorld(new THREE.Vector3(...model.bladeTips!.R));
    const zL = crossZ(faL, handL, DOOR_X) ?? crossZ(handL, tipL, DOOR_X);
    const zR = crossZ(faR, handR, DOOR_X) ?? crossZ(handR, tipR, DOOR_X);
    return { zL, zR, handL, handR, tipL, tipR };
  };

  const maxNonArmX = (): number => {
    h.group.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let maxX = -Infinity;
    h.group.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || !m.visible) return;
      m.skeleton.update();
      const pos = m.geometry.getAttribute('position');
      const si = m.geometry.getAttribute('skinIndex');
      const sw = m.geometry.getAttribute('skinWeight');
      const bones = m.skeleton.bones;
      for (let k = 0; k < pos.count; k++) {
        let armW = 0;
        for (let c = 0; c < 4; c++) {
          const bn = bones[si.getComponent(k, c)]?.name ?? '';
          if (/^(upperArm|foreArm|hand)_[LR]$/.test(bn)) armW += sw.getComponent(k, c);
        }
        if (armW > 0.3) continue;
        m.localToWorld(m.getVertexPosition(k, v));
        if (v.x > maxX) maxX = v.x;
      }
    });
    return maxX;
  };

  // Phase 1: pry_reach (0.42 s) + doorPry(0.16, 0.18)
  h.setPose('pry_reach', NPC_ANIMS['pry_reach']!.blend!);
  pryDoor(0.16, 0.18);
  for (let f = 0; f < Math.round(0.42 / dt); f++) {
    stepDoor();
    h.update(dt, cam);
  }
  assert.ok(maxNonArmX() <= DOOR_BACK_X, `body poked through cracked door during reach (${maxNonArmX().toFixed(2)} > ${DOOR_BACK_X})`);

  // Phase 2: pry_clamp (0.36 s)
  h.setPose('pry_clamp', NPC_ANIMS['pry_clamp']!.blend!);
  for (let f = 0; f < Math.round(0.36 / dt); f++) {
    stepDoor();
    h.update(dt, cam);
  }
  assert.ok(maxNonArmX() <= DOOR_BACK_X + 0.02, `body poked through cracked door during clamp (${maxNonArmX().toFixed(2)})`);
  const atClamp = measureArmDoorCross();
  const clampGap = leafHalfGap(doorOpen);
  assert.ok(atClamp.zL !== null && atClamp.zR !== null, 'both blades/arms cross the door seam in pry_clamp');
  assert.ok(Math.abs(atClamp.zL! - DOOR_Z) <= clampGap + 0.025, `L arm clips leaf in clamp: |${(atClamp.zL! - DOOR_Z).toFixed(3)}| > ${clampGap.toFixed(3)}`);
  assert.ok(Math.abs(atClamp.zR! - DOOR_Z) <= clampGap + 0.025, `R arm clips leaf in clamp: |${(atClamp.zR! - DOOR_Z).toFixed(3)}| > ${clampGap.toFixed(3)}`);

  // Phase 3: pry_wrench (1.25 s) in lockstep with doorPry(0.5, 1.2)
  h.setPose('pry_wrench', NPC_ANIMS['pry_wrench']!.blend!);
  pryDoor(0.5, 1.2);
  let worstClip = -Infinity;
  let worstLag = 0;
  for (let f = 0; f < Math.round(1.25 / dt); f++) {
    stepDoor();
    h.update(dt, cam);
    const m = measureArmDoorCross();
    const gap = leafHalfGap(doorOpen);
    assert.ok(m.zL !== null && m.zR !== null, `arm left door plane at wrench frame ${f}`);
    const overL = (DOOR_Z - m.zL!) - gap;
    const overR = (m.zR! - DOOR_Z) - gap;
    worstClip = Math.max(worstClip, overL, overR);
    // Keep the arms riding near the opening edges rather than floating far inside the gap.
    worstLag = Math.max(worstLag, gap - (DOOR_Z - m.zL!), gap - (m.zR! - DOOR_Z));
  }
  assert.ok(worstClip <= 0.025, `arms clipped into the sliding leaves during pry_wrench by ${(worstClip * 100).toFixed(1)} cm`);
  assert.ok(worstLag <= 0.14, `arms lagged ${(worstLag * 100).toFixed(1)} cm behind the sliding leaves during pry_wrench`);

  // Phase 4: pry_thrust (0.50 s) — lunges forward into R10 inside the 0.96 m gap
  h.setPose('pry_thrust', NPC_ANIMS['pry_thrust']!.blend!);
  for (let f = 0; f < Math.round(0.50 / dt); f++) {
    stepDoor();
    h.update(dt, cam);
  }
  const atThrust = measureArmDoorCross();
  const openGap = leafHalfGap(doorOpen);
  assert.ok(atThrust.handL.x > DOOR_X + 0.35 && atThrust.handR.x > DOOR_X + 0.35, `wrists should lunge well into R10 (L=${atThrust.handL.x.toFixed(2)}, R=${atThrust.handR.x.toFixed(2)})`);
  assert.ok(atThrust.tipL.x > DOOR_X + 1.0 && atThrust.tipR.x > DOOR_X + 1.0, `blade tips should reach >1 m into R10 (L=${atThrust.tipL.x.toFixed(2)}, R=${atThrust.tipR.x.toFixed(2)})`);
  assert.ok(Math.abs(atThrust.zL! - DOOR_Z) < openGap - 0.12 && Math.abs(atThrust.zR! - DOOR_Z) < openGap - 0.12, 'thrust forearms stay cleanly inside the pried gap');
});

test('R10 valve cutscene: Okafor and Giles doorway anchors have clear sightlines down R09 through D_R09_R10 without blocking Jay', () => {
  const chargeStart = anchorOf('r09_charge_start').pos;
  const chargeEnd = anchorOf('r09_flood_behind').pos;
  const jay = anchorOf('r10_run_stop').pos;
  const doorMinZ = 47.0;
  const doorMaxZ = 49.0;

  for (const id of ['r10_door_okafor', 'r10_door_giles']) {
    const p = anchorOf(id).pos;
    for (const [label, target] of [['chargeStart', chargeStart], ['chargeEnd', chargeEnd]] as const) {
      const t = (DOOR_X - p[0]) / (target[0] - p[0]);
      const zAtDoor = p[2] + (target[2] - p[2]) * t;
      assert.ok(
        zAtDoor > doorMinZ + 0.1 && zAtDoor < doorMaxZ - 0.1,
        `${id} sightline to ${label} crosses X=${DOOR_X} at Z=${zAtDoor.toFixed(2)}, outside clear doorway [${doorMinZ + 0.1}, ${doorMaxZ - 0.1}]`,
      );
    }
    // Clear of Jay's center sightline to the charging monster
    const tJay = (p[0] - jay[0]) / (chargeStart[0] - jay[0]);
    const jayRayZ = jay[2] + (chargeStart[2] - jay[2]) * tJay;
    assert.ok(Math.abs(p[2] - jayRayZ) > 0.45, `${id} sits too close to Jay's view ray (${Math.abs(p[2] - jayRayZ).toFixed(2)} m)`);
  }
});
