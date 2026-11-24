import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import posesJson from '../data/poses.json' with { type: 'json' };
import { ctx as enemyCtx } from '../ai/enemyTestKit.ts';
import { CAST } from './castLooks.ts';
import { loadMainCast, makeLib } from './castModelTestKit.ts';
import { HELD_SWAP_AT, heldDuringBlend, heldItemFor, PISTOL_IN_HAND, pistolRotation } from './heldProps.ts';
import { Humanoid } from './humanoid.ts';
import { AIM_CLAMP, aimSwing, ARM_AIM_CLAMP } from './squadPistol.ts';

/** The pistol as a held item (squad-sidearms tasks 2.1, 2.2): which poses hold it and when it shows during a blend. */

const POSES = Object.keys((posesJson as { poses: Record<string, unknown> }).poses);

test('aim_pistol holds the pistol; mug, drink and wand poses never do', () => {
  assert.equal(heldItemFor('aim_pistol'), 'pistol');
  const mugs = POSES.filter((p) => /(^|_)(mug|drink)(_|$)/.test(p));
  const wands = POSES.filter((p) => /(^|_)wand(_|$)/.test(p));
  assert.ok(mugs.length > 5);
  for (const p of mugs) assert.equal(heldItemFor(p), 'mug', p);
  for (const p of wands) assert.equal(heldItemFor(p), 'wand', p);
  for (const p of ['idle', 'typing', 'lean_back', 'squad_downed', 'pistolero', 'spistol']) assert.equal(heldItemFor(p), null, p);
});

test('canonical pistol placement: the grip runs up the thumb side, its forward along the fingers, the gun\'s right side on the palm', () => {
  const q = pistolRotation(PISTOL_IN_HAND);
  const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(q);
  assert.ok(at(0, 1, 0).distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-6, 'grip +Y to hand -Z (thumb side)');
  assert.ok(at(0, 0, -1).distanceTo(new THREE.Vector3(0, -1, 0)) < 1e-6, 'grip -Z to hand -Y (the fingers)');
  assert.ok(at(1, 0, 0).distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-6, 'the gun\'s right side (+X) toward the palm\'s back (palm faces -X)');
});

test('visibility rule (task 2.2): the pistol appears at half the blend in and goes at half the blend out; never two items', () => {
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    assert.equal(heldDuringBlend(null, 'pistol', t), t >= HELD_SWAP_AT ? 'pistol' : null, `in at ${t}`);
    assert.equal(heldDuringBlend('pistol', null, t), t >= HELD_SWAP_AT ? null : 'pistol', `out at ${t}`);
    assert.equal(heldDuringBlend('mug', 'pistol', t), t >= HELD_SWAP_AT ? 'pistol' : 'mug', `mug to pistol at ${t}`);
    // The mug and the wand still change with the pose.
    assert.equal(heldDuringBlend(null, 'mug', t), 'mug');
    assert.equal(heldDuringBlend('wand', null, t), null);
  }
  assert.equal(HELD_SWAP_AT, 0.5);
});

test('A mate raising and lowering the pistol: hidden in the first half of the blend in, shown by its end; gone by the end of the blend out', async () => {
  const lib = makeLib({ mechanic: await loadMainCast('mechanic'), doctor: await loadMainCast('doctor') });
  for (const who of ['giles', 'okafor']) {
    const h = new Humanoid({ ...CAST[who]!, role: 'npc', pose: 'idle' }, { ...enemyCtx(), bodyModels: lib });
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) h.update(dt);
    assert.equal(h.holding, null, `${who}: empty-handed at idle`);
    const blend = 0.4;
    h.setPose('aim_pistol', blend);
    const seen: Array<[number, string | null]> = [];
    for (let t = dt; t <= blend + 3 * dt; t += dt) {
      h.update(dt);
      seen.push([t, h.holding]);
    }
    for (const [t, item] of seen) {
      if (t < blend * HELD_SWAP_AT - dt) assert.equal(item, null, `${who}: no pistol at ${t.toFixed(3)} s of a ${blend} s raise`);
      if (t > blend * HELD_SWAP_AT + dt) assert.equal(item, 'pistol', `${who}: the pistol at ${t.toFixed(3)} s`);
    }
    assert.ok(h.pistol, `${who}: the aim pose exposes the pistol's markers`);
    h.setPose('idle', blend);
    seen.length = 0;
    for (let t = dt; t <= blend + 3 * dt; t += dt) {
      h.update(dt);
      seen.push([t, h.holding]);
    }
    for (const [t, item] of seen) {
      if (t < blend * HELD_SWAP_AT - dt) assert.equal(item, 'pistol', `${who}: still holding at ${t.toFixed(3)} s of lowering`);
      if (t > blend * HELD_SWAP_AT + dt) assert.equal(item, null, `${who}: the pistol gone at ${t.toFixed(3)} s`);
    }
    assert.equal(h.pistol, null);
    // The mug pose never shows the pistol.
    h.setPose('idle_mug', 0.3);
    for (let i = 0; i < 40; i++) h.update(dt);
    assert.equal(h.holding, 'mug', `${who}: mug pose holds the mug`);
    h.dispose();
  }
});

test('The pistol points along the aim (task 2.3): within 5° of a target 6 m away across the clip\'s reach, the corrections within their clamps', async () => {
  const lib = makeLib({ mechanic: await loadMainCast('mechanic'), doctor: await loadMainCast('doctor') });
  const bad: string[] = [];
  for (const who of ['giles', 'okafor']) {
    for (const [deg, y] of [[-20, 1.4], [-10, 1.4], [0, 1.4], [10, 1.4], [20, 1.4], [30, 1.4], [0, 0.7], [0, 2.0]] as const) {
      const h = new Humanoid({ ...CAST[who]!, role: 'npc', pose: 'aim_pistol' }, { ...enemyCtx(), bodyModels: lib });
      const a = THREE.MathUtils.degToRad(deg);
      const target = new THREE.Vector3(-Math.sin(a) * 6, y, -Math.cos(a) * 6);
      h.lookTarget = target;
      h.aimTarget = target;
      let worst = 0;
      let wrist = 0;
      let arm = 0;
      for (let i = 0; i < 90; i++) {
        h.update(1 / 60);
        wrist = Math.max(wrist, h.aimSwingAngle);
        arm = Math.max(arm, h.armSwingAngle);
        if (i < 30) continue;
        const p = h.pistol!;
        h.group.updateMatrixWorld(true);
        const muzzle = p.muzzle.getWorldPosition(new THREE.Vector3());
        const bore = new THREE.Vector3(0, 0, -1).applyQuaternion(p.muzzle.getWorldQuaternion(new THREE.Quaternion()));
        worst = Math.max(worst, THREE.MathUtils.radToDeg(bore.angleTo(target.clone().sub(muzzle))));
      }
      if (worst > 5) bad.push(`${who} at ${deg}°/${y} m: the bore ${worst.toFixed(1)}° off`);
      if (wrist > AIM_CLAMP + 1e-6) bad.push(`${who} at ${deg}°: wrist ${THREE.MathUtils.radToDeg(wrist).toFixed(1)}° past its clamp`);
      if (arm > ARM_AIM_CLAMP + 1e-6) bad.push(`${who} at ${deg}°: shoulder ${THREE.MathUtils.radToDeg(arm).toFixed(1)}° past its clamp`);
      h.dispose();
    }
  }
  assert.deepEqual(bad, [], bad.join('; '));
});

test('aim swing never exceeds its clamp', () => {
  const q = new THREE.Quaternion();
  for (let deg = 0; deg <= 180; deg += 5) {
    const a = THREE.MathUtils.degToRad(deg);
    const got = aimSwing(new THREE.Vector3(0, 0, -1), new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)), AIM_CLAMP, q);
    assert.ok(got <= AIM_CLAMP + 1e-9);
    assert.ok(Math.abs(2 * Math.acos(Math.min(1, Math.abs(q.w))) - got) < 1e-6, 'the rotation is the reported angle');
    if (a <= AIM_CLAMP) assert.ok(Math.abs(got - a) < 1e-6, 'small errors are taken out entirely');
  }
});

test('squad pistol grips (fix-squad-pistol-grips): Okafor wrist stays level without aimTarget and Giles left hand cups under the right hand/grip', async () => {
  const lib = makeLib({ mechanic: await loadMainCast('mechanic'), doctor: await loadMainCast('doctor') });

  const pitchOf = (who: 'giles' | 'okafor') => {
    const h = new Humanoid({ ...CAST[who]!, role: 'npc', pose: 'aim_pistol' }, { ...enemyCtx(), bodyModels: lib });
    for (let i = 0; i < 40; i++) h.update(1 / 60);
    h.group.updateMatrixWorld(true);
    const bore = new THREE.Vector3(0, 0, -1).applyQuaternion(h.pistol!.muzzle.getWorldQuaternion(new THREE.Quaternion()));
    const handR = h.bones.hand_R.getWorldPosition(new THREE.Vector3());
    const handL = h.bones.hand_L.getWorldPosition(new THREE.Vector3());
    const grip = h.pistol!.grip.getWorldPosition(new THREE.Vector3());
    const pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(bore.y, -1, 1)));
    h.dispose();
    return { pitch, handR, handL, grip };
  };

  const g = pitchOf('giles');
  const o = pitchOf('okafor');
  assert.ok(g.pitch >= -5 && g.pitch <= 3, `Giles bore pitch (${g.pitch.toFixed(1)}°) level or slightly down`);
  assert.ok(o.pitch >= -5 && o.pitch <= 3, `Okafor bore pitch (${o.pitch.toFixed(1)}°) level or slightly down`);
  assert.ok(g.handL.distanceTo(g.grip) <= 0.065 && g.handL.y < g.grip.y, `Giles hand_L cups under grip (${g.handL.distanceTo(g.grip).toFixed(3)} m)`);
  assert.ok(o.handL.distanceTo(o.grip) <= 0.065 && o.handL.y < o.grip.y, `Okafor hand_L cups under grip (${o.handL.distanceTo(o.grip).toFixed(3)} m)`);
});
