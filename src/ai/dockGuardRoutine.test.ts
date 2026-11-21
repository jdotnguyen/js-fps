import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadSlice01 } from '../world/headlessSlice.ts';
import { ctx } from './enemyTestKit.ts';
import { chairBackGrip, type GuardRoutinePhase } from './dockGuardRoutine.ts';
import { NpcDirector } from './npcs.ts';

/** Build a headless R01 harness with the real slice01 level, real NpcDirector and real dock_guard. */
function makeHarness() {
  const { level, events } = loadSlice01();
  const nav = level.navGraph();
  const playerFeet = new THREE.Vector3(6.95, 0, 4.3);
  const playerHead = new THREE.Vector3(6.95, 1.62, 4.3);
  const npcs = new NpcDirector({
    ctx: { ...ctx(), colliders: level.collision },
    nav,
    colliders: level.collision,
    player: () => ({ feet: playerFeet, head: playerHead }),
    emit: (name, payload) => events.emit(name as never, payload as never),
    walk: (id) => level.walk(id) ?? null,
    setPropTransform: (id, pos, yaw) => level.setPropTransform(id, pos, yaw),
    setPropVisible: (id, visible) => level.setPropVisible(id, visible),
    propState: (id) => level.propState(id),
  });
  npcs.setResolver((ref) => {
    if (typeof ref === 'string' && ref.startsWith('anchor:')) {
      const a = level.anchor(ref.slice(7));
      return a ? { pos: { x: a.pos.x, y: a.pos.y, z: a.pos.z }, yaw: a.yaw } : null;
    }
    return null;
  });
  npcs.spawnFromLevel(level.npcSpawns().filter((n) => n.id === 'dock_guard'));
  const guard = npcs.actor('dock_guard')!;
  const cam = new THREE.Vector3(6.95, 1.62, 4.3);
  const step = (frames: number, dt = 1 / 60): void => {
    for (let i = 0; i < frames; i++) npcs.update(dt, cam);
  };
  return { level, events, npcs, guard, playerFeet, playerHead, step };
}

interface Snapshot {
  guardPos: [number, number, number];
  guardYaw: number;
  pose: string;
  handWand: boolean;
  deskWand: boolean;
  chairPos: [number, number, number];
  chairYaw: number;
  colliderCenter: [number, number];
}

function snap(h: ReturnType<typeof makeHarness>): Snapshot {
  const g = h.guard;
  const chair = h.level.propState('dock_chair')!;
  const wand = h.level.propState('dock_wand')!;
  const col = chair.colliders[0]!;
  const r = (n: number): number => Math.round(n * 1000) / 1000;
  return {
    guardPos: [r(g.position.x), r(g.position.y), r(g.position.z)],
    guardYaw: r(Math.atan2(Math.sin(g.body.heading), Math.cos(g.body.heading))),
    pose: g.body.poseName,
    handWand: g.body.holding === 'wand',
    deskWand: wand.visible,
    chairPos: [r(chair.pos.x), r(chair.pos.y), r(chair.pos.z)],
    chairYaw: r(Math.atan2(Math.sin(chair.yaw), Math.cos(chair.yaw))),
    colliderCenter: [r((col.minX + col.maxX) / 2), r((col.minZ + col.maxZ) / 2)],
  };
}

test('wand stays in guard hand through the walk and transfers atomically to the desktop on contact (exactly one wand on every frame)', async () => {
  const h = makeHarness();
  // Jay leaves the booth opening so the guard starts his walk after waitMin.
  h.playerFeet.set(11.5, 0, 2.0);
  h.playerHead.set(11.5, 1.62, 2.0);

  let done = false;
  void h.npcs.command('npcTask', { npc: 'dock_guard', task: 'return_to_desk' }).then(() => {
    done = true;
  });

  const frames: Array<{ phase: GuardRoutinePhase; hand: boolean; desk: boolean }> = [];
  let sawWalkWithWand = false;
  for (let i = 0; i < 60 * 25 && !done; i++) {
    h.step(1);
    const phase = h.npcs.dockGuard.phase;
    const hand = h.guard.body.holding === 'wand';
    const desk = h.level.propState('dock_wand')!.visible;
    frames.push({ phase, hand, desk });
    assert.equal((hand ? 1 : 0) + (desk ? 1 : 0), 1, `frame ${i} (${phase}): exactly one wand visible (hand=${hand}, desk=${desk})`);
    if (phase === 'walk_desk') {
      assert.equal(hand, true, `frame ${i}: wand stays in hand while walking`);
      assert.equal(desk, false, `frame ${i}: desk wand hidden while walking`);
      sawWalkWithWand = true;
    }
    if (i % 10 === 0) await Promise.resolve();
  }
  await Promise.resolve();
  assert.ok(done, 'return_to_desk finishes');
  assert.ok(sawWalkWithWand, 'walk_desk phase observed with wand in hand');

  const releaseIdx = frames.findIndex((f) => f.desk);
  assert.ok(releaseIdx > 1, 'wand releases during routine');
  const before = frames[releaseIdx - 1]!;
  const at = frames[releaseIdx]!;
  const after = frames[releaseIdx + 1]!;
  assert.deepEqual([before.hand, before.desk], [true, false], 'frame before release: wand in hand only');
  assert.deepEqual([at.hand, at.desk], [false, true], 'release frame: wand on desk only');
  assert.deepEqual([after.hand, after.desk], [false, true], 'frame after release: wand on desk only');
});

test('reach, pull, turn and sit: hand reaches chair before pull, stays on backrest with aligned collider and planted foot, and hips settle on seat', async () => {
  const h = makeHarness();
  h.playerFeet.set(11.5, 0, 2.0);
  h.playerHead.set(11.5, 1.62, 2.0);

  const chairStart = h.level.propState('dock_chair')!.pos.clone();
  let done = false;
  void h.npcs.command('npcTask', { npc: 'dock_guard', task: 'return_to_desk' }).then(() => {
    done = true;
  });

  let sawReach = false;
  let reachEndHandDist = Infinity;
  let pullFrames = 0;
  let maxPullHandErr = 0;
  let maxColliderErr = 0;
  let pullFootLStart: THREE.Vector3 | null = null;
  let pullFootRStart: THREE.Vector3 | null = null;
  let maxDriftL = 0;
  let maxDriftR = 0;
  const grip = new THREE.Vector3();
  const handPos = new THREE.Vector3();
  const footL = new THREE.Vector3();
  const footR = new THREE.Vector3();

  for (let i = 0; i < 60 * 25 && !done; i++) {
    h.step(1);
    const phase = h.npcs.dockGuard.phase;
    const chair = h.level.propState('dock_chair')!;
    const col = chair.colliders[0]!;
    const colCx = (col.minX + col.maxX) / 2;
    const colCz = (col.minZ + col.maxZ) / 2;
    const colErr = Math.hypot(colCx - chair.pos.x, colCz - chair.pos.z);
    if (colErr > maxColliderErr) maxColliderErr = colErr;

    if (phase === 'reach_chair') {
      sawReach = true;
      assert.ok(chair.pos.distanceTo(chairStart) < 1e-4, 'chair does not move before reach completes');
      chairBackGrip(chair.pos, chair.yaw, grip);
      h.guard.body.jointWorld('hand_R', handPos);
      reachEndHandDist = handPos.distanceTo(grip);
    } else if (phase === 'pull_chair') {
      pullFrames++;
      chairBackGrip(chair.pos, chair.yaw, grip);
      h.guard.body.jointWorld('hand_R', handPos);
      const err = handPos.distanceTo(grip);
      if (err > maxPullHandErr) maxPullHandErr = err;

      // Spatial hash agrees with the moving chair on every pull frame.
      assert.ok(
        h.level.collision.find(chair.pos.x - 0.1, chair.pos.z - 0.1, chair.pos.x + 0.1, chair.pos.z + 0.1).includes(col),
        `pull frame ${pullFrames}: spatial hash contains moved chair collider`,
      );

      // Track foot plants through the pull.
      h.guard.body.jointWorld('foot_L', footL);
      h.guard.body.jointWorld('foot_R', footR);
      if (!pullFootLStart) {
        pullFootLStart = footL.clone();
        pullFootRStart = footR.clone();
      } else {
        maxDriftL = Math.max(maxDriftL, Math.hypot(footL.x - pullFootLStart.x, footL.z - pullFootLStart.z));
        maxDriftR = Math.max(maxDriftR, Math.hypot(footR.x - pullFootRStart!.x, footR.z - pullFootRStart!.z));
      }
    }
    if (i % 10 === 0) await Promise.resolve();
  }
  await Promise.resolve();
  assert.ok(done, 'routine completed');
  assert.ok(sawReach, 'reach_chair phase ran');
  assert.ok(reachEndHandDist < 0.08, `hand reaches chair backrest before pull (${reachEndHandDist.toFixed(3)} m)`);
  assert.ok(pullFrames >= 50, `pull ran across ${pullFrames} frames`);
  assert.ok(maxPullHandErr < 0.1, `hand stays on chair backrest throughout pull (max err ${maxPullHandErr.toFixed(3)} m)`);
  assert.ok(maxColliderErr < 0.01, `chair mesh and collider stay aligned (max err ${maxColliderErr.toFixed(4)} m)`);
  const minFootDrift = Math.min(maxDriftL, maxDriftR);
  assert.ok(minFootDrift < 0.15, `at least one foot stays planted during pull (L=${maxDriftL.toFixed(3)} m, R=${maxDriftR.toFixed(3)} m)`);

  // Settle a few frames in seated pose and check pelvis on seat and feet on floor.
  h.step(30);
  const pelvis = h.guard.body.jointWorld('pelvis');
  h.guard.body.jointWorld('foot_L', footL);
  h.guard.body.jointWorld('foot_R', footR);
  assert.equal(h.guard.body.poseName, 'sit_typing_cctv');
  assert.ok(pelvis.y > 0.48 && pelvis.y < 0.65, `hips settle on the chair seat (pelvis y=${pelvis.y.toFixed(3)} m)`);
  assert.ok(footL.y < 0.18 && footR.y < 0.18, `feet rest on the floor (L=${footL.y.toFixed(3)} m, R=${footR.y.toFixed(3)} m)`);
});

test('one seated endpoint: full watch, skips during scan/walk/pull/sit and post-intro restore match identically', async () => {
  // 1. Full watched completion.
  const watchedH = makeHarness();
  watchedH.playerFeet.set(11.5, 0, 2.0);
  let done = false;
  void watchedH.npcs.command('npcTask', { npc: 'dock_guard', task: 'return_to_desk' }).then(() => {
    done = true;
  });
  for (let i = 0; i < 60 * 25 && !done; i++) {
    watchedH.step(1);
    if (i % 10 === 0) await Promise.resolve();
  }
  watchedH.step(60);
  const watched = snap(watchedH);
  assert.equal(watched.pose, 'sit_typing_cctv');
  assert.equal(watched.handWand, false);
  assert.equal(watched.deskWand, true);

  // 2. Skip during scan (before routine starts), walk, pull, sit.
  const skipPhases: Array<GuardRoutinePhase | 'scan'> = ['scan', 'walk_desk', 'pull_chair', 'sit_down'];
  for (const targetPhase of skipPhases) {
    const h = makeHarness();
    h.playerFeet.set(11.5, 0, 2.0);
    if (targetPhase === 'scan') {
      void h.npcs.command('npcAnim', { npc: 'dock_guard', anim: 'wand_up' });
      h.step(12);
    } else {
      void h.npcs.command('npcTask', { npc: 'dock_guard', task: 'return_to_desk' });
      let hit = false;
      for (let i = 0; i < 60 * 20; i++) {
        h.step(1);
        if (h.npcs.dockGuard.phase === targetPhase) {
          h.step(10);
          hit = true;
          break;
        }
        if (i % 10 === 0) await Promise.resolve();
      }
      assert.ok(hit, `reached phase ${targetPhase}`);
    }
    // Apply skip instant endpoint, then advance 120 more frames to verify no delayed callback moves him or toggles a second wand.
    void h.npcs.command('npcTask', { npc: 'dock_guard', task: 'return_to_desk', instant: true });
    h.step(120);
    assert.deepEqual(snap(h), watched, `skip during ${targetPhase} matches watched endpoint`);
  }

  // 3. Post-intro checkpoint restore after reset.
  const restoreH = makeHarness();
  restoreH.npcs.reset();
  restoreH.events.emit('level:reset', {});
  void restoreH.npcs.command('npcTask', { npc: 'dock_guard', task: 'return_to_desk', instant: true });
  restoreH.step(60);
  assert.deepEqual(snap(restoreH), watched, 'post-intro restore matches watched endpoint');
});
