import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../world/collision.ts';
import { GLASS_CUTOFF_HZ, GLASS_GAIN_SCALE, OCCLUDED_CUTOFF_HZ, OCCLUDED_GAIN_SCALE, OCCLUDED_REVERB, SEALED_CUTOFF_HZ, SEALED_GAIN_SCALE, occludeVoice, wallOccluder, type Occluder } from './occlusion.ts';

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/**
 * A floor, a full-height wall at x = 0 with a door gap, a closed door in the gap, a partition at x = 1.5
 * covering z -10..-2, and a counter at x = 4.
 */
function room(): { world: CollisionWorld; door: ReturnType<CollisionWorld['add']>; occluder: Occluder } {
  const world = new CollisionWorld();
  world.add({ min: [-20, -0.2, -20], max: [20, 0, 20] }, 'floor', 'concrete');
  world.add({ min: [-0.2, 0, -10], max: [0.2, 3, -1] }, 'wall');
  world.add({ min: [-0.2, 0, 1], max: [0.2, 3, 10] }, 'wall');
  world.add({ min: [1.4, 0, -10], max: [1.6, 3, -2] }, 'wall:partition');
  const door = world.add({ min: [-0.1, 0, -1], max: [0.1, 2.4, 1] }, 'door:test');
  world.add({ min: [4, 0, -1], max: [4.4, 1.08, 1] }, 'prop:counter', 'metal');
  return { world, door, occluder: wallOccluder((...a) => world.raycast(...a)) };
}

test('a full-height wall blocks, a counter does not, an open door does not', () => {
  const { door, occluder } = room();
  const listener = v(6, 1.7, 0);
  assert.equal(occluder(listener, v(-3, 1.5, -5)), 'wall', 'wall between');
  assert.equal(occluder(listener, v(2, 1.0, 0)), 'none', 'only the 1.08 m counter between');
  assert.equal(occluder(listener, v(-3, 1.5, 0)), 'wall', 'closed door between');
  door.enabled = false;
  assert.equal(occluder(listener, v(-3, 1.5, 0)), 'none', 'open door between');
});

test('a source within 0.5 m is never blocked', () => {
  const { occluder } = room();
  assert.equal(occluder(v(0.3, 1.5, 5), v(-0.15, 1.5, 5)), 'none');
});

test("a door's own sound is not blocked by that door, from either side", () => {
  const { occluder } = room();
  const doorCentre = v(0, 1.25, 0);
  assert.equal(occluder(v(3, 1.7, 0), doorCentre), 'none', 'near side');
  assert.equal(occluder(v(-3, 1.7, 0), doorCentre), 'none', 'far side');
});

test('a wall between the listener and a door blocks its sound', () => {
  const { occluder } = room();
  const doorCentre = v(0, 1.25, 0);
  assert.equal(occluder(v(3, 1.7, -6), doorCentre), 'wall', 'the partition is in the way');
  assert.equal(occluder(v(3, 1.7, -1), doorCentre), 'none', 'past the end of the partition');
});

test('occludeVoice muffles only eligible blocked one-shots', () => {
  const listener = v(0, 1.7, 0);
  const blocked: Occluder = () => 'wall';
  const clear: Occluder = () => 'none';
  const at = v(-5, 1.5, 0);
  const opts = { bus: 'sfx' as const, position: at, gain: 0.8, reverb: 0.2 };

  const out = occludeVoice(opts, listener, blocked);
  assert.equal(out.cutoff, OCCLUDED_CUTOFF_HZ);
  assert.equal(out.gain, 0.8 * OCCLUDED_GAIN_SCALE);
  assert.equal(out.reverb, OCCLUDED_REVERB);
  assert.equal(occludeVoice({ ...opts, reverb: 0.5 }, listener, blocked).reverb, 0.5, 'a wetter send is kept');
  assert.equal(occludeVoice({ position: at }, listener, blocked).gain, OCCLUDED_GAIN_SCALE, 'default bus is sfx, default gain 1');

  assert.equal(occludeVoice(opts, listener, clear), opts, 'nothing in between');
  assert.equal(occludeVoice(opts, listener, null), opts, 'no occluder set');
  assert.equal(occludeVoice({ ...opts, occlude: false }, listener, blocked).cutoff, undefined, 'opted out');
  assert.equal(occludeVoice({ ...opts, bus: 'ambience' }, listener, blocked).cutoff, undefined, 'ambience bus');
  assert.equal(occludeVoice({ ...opts, bus: 'voice' }, listener, blocked).cutoff, undefined, 'voice bus');
  assert.equal(occludeVoice({ bus: 'sfx', gain: 0.8 }, listener, blocked).cutoff, undefined, 'no position');
  assert.equal(occludeVoice({ ...opts, position: v(0.4, 1.7, 0) }, listener, blocked).cutoff, undefined, 'within 0.6 m');
});

test('occludeVoice combines with muffled and custom cutoffs', () => {
  const listener = v(0, 1.7, 0);
  const at = v(-5, 1.5, 0);
  assert.equal(occludeVoice({ position: at, muffled: true }, listener, () => 'wall').cutoff, OCCLUDED_CUTOFF_HZ);
  assert.equal(occludeVoice({ position: at, cutoff: 300 }, listener, () => 'wall').cutoff, 300);
});

/** A glass pane at x = 1.5 (z -2..2), a wall at x = -2 (z -2..2) beyond it, and a second pane at x = -5. */
function glassRoom(): Occluder {
  const world = new CollisionWorld();
  world.add({ min: [-20, -0.2, -20], max: [20, 0, 20] }, 'floor', 'concrete');
  world.add({ min: [1.4, 0, -2], max: [1.6, 3, 2], acoustic: 'glass' }, 'room:glass');
  world.add({ min: [-2.1, 0, -2], max: [-1.9, 3, 2] }, 'room:wall');
  world.add({ min: [-5.1, 0, -2], max: [-4.9, 3, 2], acoustic: 'glass' }, 'room:glass2');
  return wallOccluder((...a) => world.raycast(...a));
}

test('glass alone gives glass; glass with a wall beyond, or a wall with glass beyond, gives wall', () => {
  const occluder = glassRoom();
  assert.equal(occluder(v(3, 1.7, 0), v(0.5, 1.5, 0)), 'glass', 'monster 1 m behind the pane');
  assert.equal(occluder(v(3, 1.7, 0), v(-3, 1.5, 0)), 'wall', 'glass, then a wall');
  assert.equal(occluder(v(-3, 1.7, 0), v(3, 1.5, 0)), 'wall', 'a wall, then glass');
  assert.equal(occluder(v(-3, 1.7, 0), v(-7, 1.5, 0)), 'glass', 'the second pane alone');
  assert.equal(occluder(v(3, 1.7, 5), v(0.5, 1.5, 5)), 'none', 'past the end of the pane');
});

test('occludeVoice through glass is a light muffle, between the open and a wall', () => {
  const listener = v(0, 1.7, 0);
  const opts = { position: v(-5, 1.5, 0), gain: 0.8, reverb: 0.2 };
  const out = occludeVoice(opts, listener, () => 'glass');
  assert.equal(out.cutoff, GLASS_CUTOFF_HZ);
  assert.equal(out.gain, 0.8 * GLASS_GAIN_SCALE);
  assert.equal(out.reverb, 0.2, 'reverb unchanged');
  assert.equal(occludeVoice({ ...opts, cutoff: 900 }, listener, () => 'glass').cutoff, 900, 'a lower cutoff is kept');
  assert.ok(GLASS_GAIN_SCALE > OCCLUDED_GAIN_SCALE && GLASS_CUTOFF_HZ > OCCLUDED_CUTOFF_HZ);
});

// ------------------------------------------------------------------ sealed glass (in-world-audio: Sealed observation glass muffles hard)

/**
 * A sealed pane as thick as the kit's (x 1.375 to 1.625, z -4..4), a counter on the listener's side of it (z -1..1),
 * a wall at x = -3 (z -4..-2) beyond it, and a second wall at x = 5 (z 2..4) before it.
 */
function sealedRoom(): Occluder {
  const world = new CollisionWorld();
  world.add({ min: [-20, -0.2, -20], max: [20, 0, 20] }, 'floor', 'concrete');
  world.add({ min: [1.375, 0, -4], max: [1.625, 3.6, 4], acoustic: 'sealed' }, 'room:sealed');
  world.add({ min: [2.4, 0, -1], max: [2.8, 1.1, 1] }, 'prop:counter', 'metal');
  world.add({ min: [-3.1, 0, -4], max: [-2.9, 3, -2] }, 'room:wall');
  world.add({ min: [4.9, 0, 2], max: [5.1, 3, 4] }, 'room:wall2');
  return wallOccluder((...a) => world.raycast(...a));
}

test('Intercom off: a sound in the room behind sealed glass is heard faint and dull, at least as through a closed door', () => {
  const occluder = sealedRoom();
  const listener = v(4, 1.7, 0);
  const opts = { position: v(-2, 1.5, 0), gain: 0.8, reverb: 0.2 };
  for (const occlude of [undefined, 'sealed' as const]) {
    const out = occludeVoice({ ...opts, ...(occlude ? { occlude } : {}) }, listener, occluder);
    assert.equal(out.cutoff, SEALED_CUTOFF_HZ, `${occlude ?? 'a world sound'}`);
    assert.equal(out.gain, 0.8 * SEALED_GAIN_SCALE);
    assert.equal(out.reverb, OCCLUDED_REVERB);
    assert.equal(out.relayGain, 0.8, 'a room intercom still carries it at its own level');
  }
  assert.ok(SEALED_CUTOFF_HZ <= OCCLUDED_CUTOFF_HZ && SEALED_GAIN_SCALE <= OCCLUDED_GAIN_SCALE);
});

test('Hands on the pane: a sound within 0.3 m of a sealed pane is not sealed-muffled, from any angle', () => {
  const occluder = sealedRoom();
  // Straight on, from far to one side, and from close to the glass.
  for (const listener of [v(4, 1.7, 0), v(3, 1.7, 3.5), v(2.2, 1.7, -3.5), v(9, 1.7, 0)]) {
    for (const off of [0, 0.1, 0.3]) {
      const at = v(1.375 - off, 1.4, 0);
      assert.equal(occluder(listener, at, true), 'none', `a kill sound ${off} m off: as authored`);
      assert.ok(['none', 'glass'].includes(occluder(listener, at)), `a world sound ${off} m off: as through ordinary glass`);
    }
    assert.equal(occluder(listener, v(0.9, 1.4, 0), true), 'sealed', '0.475 m off');
  }
});

test('a sealed pane: a low barrier does not hide it, and a wall wins except where only sealed glass counts', () => {
  const occluder = sealedRoom();
  assert.equal(occluder(v(4, 1.7, 0), v(-2, 0.1, 0)), 'sealed', 'over the counter to the floor beyond the pane');
  assert.equal(occluder(v(4, 1.7, -3), v(-5, 1.5, -3)), 'wall', 'the pane, then a wall');
  assert.equal(occluder(v(4, 1.7, -3), v(-5, 1.5, -3), true), 'sealed', 'a kill sound beyond both is still sealed in');
  assert.equal(occluder(v(7, 1.7, 3), v(-2, 1.5, 3)), 'wall', 'a wall, then the pane');
  assert.equal(occluder(v(7, 1.7, 3), v(-2, 1.5, 3), true), 'sealed');
  assert.equal(occluder(v(7, 1.7, 3), v(3, 1.5, 3), true), 'none', 'a wall alone leaves a kill sound as authored');
});

test('Other glass unchanged: ordinary glass muffles only lightly, and not a kill or sequence sound at all', () => {
  const occluder = glassRoom();
  const listener = v(3, 1.7, 0);
  const opts = { position: v(0.2, 1.5, 0), gain: 0.8 };
  const world = occludeVoice(opts, listener, occluder);
  assert.deepEqual([world.cutoff, world.gain], [GLASS_CUTOFF_HZ, 0.8 * GLASS_GAIN_SCALE]);
  const kill = { ...opts, occlude: 'sealed' as const };
  assert.equal(occludeVoice(kill, listener, occluder), kill, 'as authored');
  const beyond = { ...kill, position: v(-3, 1.5, 0) };
  assert.equal(occludeVoice(beyond, listener, occluder), beyond, 'and through a wall too');
});
