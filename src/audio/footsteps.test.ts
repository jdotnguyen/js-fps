import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Humanoid, type FootstepEvent } from '../actors/humanoid.ts';
import { ctx as testHumanoidCtx } from '../ai/enemyTestKit.ts';
import { Rng } from '../core/rng.ts';
import { CollisionWorld, type ColliderSurface } from '../world/collision.ts';
import { floorSurfaceForKey } from '../world/kit/palettes.ts';
import type { VoiceOptions } from './engine.ts';
import { FOOTSTEP_MAX_DISTANCE, FootstepAudio, soundForSurface, type FootstepAudioEngine } from './footsteps.ts';
import type { SoundName } from './sounds.ts';

interface PlayedVoice {
  name: SoundName;
  opts: VoiceOptions;
}

function makeFakeAudio(variants = 7): { engine: FootstepAudioEngine; played: PlayedVoice[] } {
  const played: PlayedVoice[] = [];
  const engine: FootstepAudioEngine = {
    hasSound: () => true,
    variantCount: () => variants,
    play(name, opts = {}) {
      played.push({ name, opts });
    },
  };
  return { engine, played };
}

test('palette floor materials map to matching acoustic surfaces', () => {
  assert.equal(floorSurfaceForKey('concretePainted'), 'concrete');
  assert.equal(floorSurfaceForKey('concreteFloor'), 'concrete');
  assert.equal(floorSurfaceForKey('concrete'), 'concrete');
  assert.equal(floorSurfaceForKey('rubber'), 'rubber');
  assert.equal(floorSurfaceForKey('grating'), 'grate');
  assert.equal(floorSurfaceForKey('diamond'), 'metal');
  assert.equal(floorSurfaceForKey('diamondRusty'), 'metal');

  assert.equal(soundForSurface('concrete'), 'footConcrete');
  assert.equal(soundForSurface('metal'), 'footPlate');
  assert.equal(soundForSurface('grate'), 'footGrate');
  assert.equal(soundForSurface('rubber'), 'footRubber');
});

test('FootstepAudio plays player steps on concrete without back-to-back variant repeats', () => {
  const { engine, played } = makeFakeAudio(7);
  const steps = new FootstepAudio({
    audio: engine,
    rng: new Rng('player-steps'),
    listener: () => new THREE.Vector3(6, 1.7, 2.6),
    surfaceAt: () => 'concrete',
  });

  for (let i = 0; i < 20; i++) {
    steps.playPlayer({ surface: 'concrete', x: 6, y: 0, z: 2.6, sprint: i % 4 === 0 });
  }
  assert.equal(played.length, 20);
  for (let i = 0; i < played.length; i++) {
    assert.equal(played[i]!.name, 'footConcrete');
    if (i > 0) assert.notEqual(played[i]!.opts.variant, played[i - 1]!.opts.variant, `repeat at ${i}`);
  }
  const sprintGain = played[0]!.opts.gain ?? 0;
  const walkGain = played[1]!.opts.gain ?? 0;
  assert.ok(sprintGain > walkGain, `sprint (${sprintGain}) should be louder than walk (${walkGain})`);
});

test('FootstepAudio attenuates distant character steps, culls past max distance, and muffles behind closed doors', () => {
  const world = new CollisionWorld();
  world.add({ min: [-20, -0.2, -20], max: [20, 0, 20] }, 'floor', 'concrete');
  const door = world.add({ min: [-0.2, 0, -2], max: [0.2, 2.4, 2] }, 'door:D_dock');
  // Waist-high security counter between Jay (x=6, z=2.6) and an NPC right in front of the desk (x=6, z=1.0).
  world.add({ min: [4.4, 0, 1.6], max: [7.4, 1.08, 2.0] }, 'prop:half_wall', 'metal');

  const listener = new THREE.Vector3(6, 1.7, 2.6);
  const { engine, played } = makeFakeAudio(7);
  const steps = new FootstepAudio({
    audio: engine,
    rng: new Rng('char-steps'),
    listener: () => listener,
    surfaceAt: (x, y, z): ColliderSurface | null => world.surfaceAt(x, y, z),
    isOccluded: (from, to) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dz = to.z - from.z;
      const d = Math.hypot(dx, dy, dz);
      if (d <= 0.5) return false;
      const hit = world.raycast(from.x, from.y, from.z, dx, dy, dz, d - 0.35);
      return hit !== null && hit.collider.maxY >= 2.0;
    },
  });

  // 1. Close step across the waist-high counter in Room 1 -> must NOT be falsely muffled.
  steps.playCharacter({ x: 6, y: 0.05, z: 1.0, side: 'L', speed: 1.3, kind: 'walk', actor: 'giles' });
  // 2. Further unoccluded step (past fade start, within max distance).
  steps.playCharacter({ x: 24, y: 0.05, z: 2.6, side: 'R', speed: 1.3, kind: 'walk', actor: 'giles' });
  // 3. Beyond max distance -> culled completely.
  steps.playCharacter({ x: 6 + FOOTSTEP_MAX_DISTANCE + 5, y: 0.05, z: 2.6, side: 'L', speed: 1.3, kind: 'walk', actor: 'giles' });
  // 4. Behind closed airlock door D_dock (x = -3, door at x = 0) -> occluded and muffled.
  steps.playCharacter({ x: -3, y: 0.05, z: 0, side: 'L', speed: 1.3, kind: 'walk', actor: 'okafor' });
  // 5. Door opens -> unoccluded.
  door.enabled = false;
  steps.playCharacter({ x: -3, y: 0.05, z: 0, side: 'R', speed: 1.3, kind: 'walk', actor: 'okafor' });

  assert.equal(played.length, 4, 'step beyond max distance is culled');
  const [near, far, blocked, open] = played as [PlayedVoice, PlayedVoice, PlayedVoice, PlayedVoice];

  assert.equal(near.name, 'footConcrete');
  assert.ok(near.opts.position && near.opts.position.x === 6 && near.opts.position.z === 1.0);
  assert.equal(near.opts.cutoff, undefined, 'waist-high counter does not muffle nearby open-room footsteps');
  assert.ok((far.opts.gain ?? 0) < (near.opts.gain ?? 0), 'distant step is quieter than near step');
  assert.ok((far.opts.cutoff ?? 20000) < 12000, 'distant step applies air-absorption low-pass');

  assert.ok((blocked.opts.cutoff ?? 20000) <= 600, `blocked step should be muffled (cutoff ${blocked.opts.cutoff})`);
  assert.ok((blocked.opts.gain ?? 0) < (open.opts.gain ?? 0), 'blocked step behind closed door is quieter than open door');
  assert.ok((open.opts.cutoff ?? 20000) > (blocked.opts.cutoff ?? 0), 'opening door removes occlusion muffle');
});

test('Humanoid fires alternating left/right footstep events synced to walking mocap foot plants', () => {
  const steps: FootstepEvent[] = [];

  const body = new Humanoid(
    { seed: 'giles', outfit: 'engineer', role: 'npc' },
    { ...testHumanoidCtx(), onFootstep: (s) => steps.push(s) },
  );
  body.group.visible = true;
  body.setHeading(0);

  // Standing still: no footsteps should ever fire.
  for (let i = 0; i < 60; i++) body.update(1 / 60, new THREE.Vector3(0, 1.7, 3));
  assert.equal(steps.length, 0, 'standing idle emits zero footsteps');

  // Walk forward for 2 seconds at 1.4 m/s (~2.8 m, ~4 steps).
  const dir = new THREE.Vector3(0, 0, -1);
  for (let i = 0; i < 120; i++) {
    body.move(dir, 1 / 60);
    body.update(1 / 60, new THREE.Vector3(0, 1.7, 3));
  }
  assert.ok(steps.length >= 2 && steps.length <= 8, `expected 2..8 steps in 2 s walk, got ${steps.length}`);
  const sides = new Set(steps.map((s) => s.side));
  assert.equal(sides.size, 2, 'both left and right feet fire steps');
  for (const s of steps) {
    assert.equal(s.actor, 'giles');
    assert.equal(s.kind, 'walk');
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z));
  }
});
