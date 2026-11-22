import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { director, run, STUB_GORE } from '../ai/enemyTestKit.ts';
import { BodyDamage } from './damage.ts';
import { pickStompHit, stomp, STOMP } from './stomp.ts';
import type { Humanoid } from './humanoid.ts';

// physical-interaction spec "Corpses can be stomped" (Block 5 task 6.2).

test('a corpse limb loses HP to stomps and severs at its threshold; a corpse never dies twice', () => {
  const d = new BodyDamage(45); // a shambler's base HP
  d.apply('torso', 1000);
  assert.ok(d.dead);
  const first = d.applyToCorpse('foreArm_L', STOMP.damage);
  assert.equal(first.severed, null, 'one stomp is not enough for an arm');
  const second = d.applyToCorpse('foreArm_L', STOMP.damage);
  assert.equal(second.severed, 'foreArm_L', 'the second takes it off');
  assert.deepEqual(second.lost, ['foreArm_L'], 'with nothing else');
  assert.equal(second.killed, false);
  assert.equal(d.applyToCorpse('torso', 1000).applied, 0, 'the torso pool is ignored');
  const alive = new BodyDamage(100);
  assert.equal(alive.applyToCorpse('foreArm_L', 1000).applied, 0, 'a living body takes apply, not this');
});

/** Kill a shambler standing at the origin and let it fall. */
function corpse(): Humanoid {
  const { dir } = director();
  const e = dir.spawn('shambler', new THREE.Vector3(0, 0, 0), 0);
  run(dir, 0.2);
  const chest = e.body.jointWorld('chest');
  e.body.applyHit({ humanoid: e.body, joint: 'chest', region: 'torso', distance: 1, point: chest }, 10000, new THREE.Vector3(0, 0, -1));
  assert.equal(e.body.alive, false);
  run(dir, 3);
  return e.body;
}

test('stomping a corpse arm enough times severs it into debris, with a thud and a crunch', () => {
  const body = corpse();
  const hand = body.jointWorld('hand_L');
  const at = new THREE.Vector3(hand.x, 0, hand.z);
  const target = pickStompHit(at, [body]);
  assert.ok(target, 'the boot lands on the corpse');

  const debris: unknown[] = [];
  const sounds: string[] = [];
  const add = STUB_GORE.addDebris;
  STUB_GORE.addDebris = (...args: Parameters<typeof add>) => void debris.push(args[0]);
  try {
    let stomps = 0;
    for (; stomps < 6 && debris.length === 0; stomps++) {
      // Re-aim at whatever is under the boot by the hand each time (an arm, or the leg next to it).
      stomp(at, new THREE.Vector3(0, 0, -1), { bodies: () => [body], sound: (n) => void sounds.push(n) });
    }
    assert.equal(debris.length, 1, `one part came off (after ${stomps} stomps)`);
    assert.ok(stomps >= 2, 'it took more than one stomp');
    assert.ok(sounds.includes('footConcrete') && sounds.includes('kill_crunch'), 'boot thud and flesh crunch');
    assert.ok(body.damage.severedRegions().size >= 1);
  } finally {
    STUB_GORE.addDebris = add;
  }
});

test('a stomp on bare floor hits nothing but still thuds, and a standing body\'s chest is out of reach', () => {
  const body = corpse();
  const sounds: string[] = [];
  assert.equal(stomp(new THREE.Vector3(5, 0, 5), new THREE.Vector3(0, 0, -1), { bodies: () => [body], sound: (n) => void sounds.push(n) }), null);
  assert.deepEqual(sounds, ['footConcrete']);
  const { dir } = director();
  const standing = dir.spawn('shambler', new THREE.Vector3(3, 0, 3), 0);
  run(dir, 0.2);
  const hit = pickStompHit(new THREE.Vector3(3, 0, 3), [standing.body]);
  assert.ok(!hit || hit.joint.startsWith('foot') || hit.joint.startsWith('shin'), `only its feet are under the boot (${hit?.joint})`);
});
