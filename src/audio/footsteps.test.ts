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
import { GLASS_CUTOFF_HZ, wallOccluder } from './occlusion.ts';
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
    assert.equal(played[i]!.opts.occlude, false, 'player steps are never occluded');
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
    isOccluded: wallOccluder((...ray) => world.raycast(...ray)),
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

  for (const p of played) assert.equal(p.opts.occlude, false, 'footsteps opt out of the engine occlusion check');
  assert.ok((blocked.opts.cutoff ?? 20000) <= 600, `blocked step should be muffled (cutoff ${blocked.opts.cutoff})`);
  assert.ok((blocked.opts.gain ?? 0) < (open.opts.gain ?? 0), 'blocked step behind closed door is quieter than open door');
  assert.ok((open.opts.cutoff ?? 20000) > (blocked.opts.cutoff ?? 0), 'opening door removes occlusion muffle');
});

test('steps behind a glass partition are only lightly muffled (in-world-audio: Glass muffles lightly)', () => {
  const world = new CollisionWorld();
  world.add({ min: [-20, -0.2, -20], max: [20, 0, 20] }, 'floor', 'concrete');
  world.add({ min: [-0.1, 0, -4], max: [0.1, 3, 4], acoustic: 'glass' }, 'room:glass');
  world.add({ min: [-6.1, 0, -4], max: [-5.9, 3, 4] }, 'room:wall');
  const listener = new THREE.Vector3(1.5, 1.7, 0);
  const { engine, played } = makeFakeAudio(7);
  const steps = new FootstepAudio({
    audio: engine,
    rng: new Rng('glass-steps'),
    listener: () => listener,
    surfaceAt: () => 'concrete',
    isOccluded: wallOccluder((...ray) => world.raycast(...ray)),
  });
  const step = (x: number): void => steps.playCharacter({ x, y: 0.05, z: 0, side: 'L', speed: 1.3, kind: 'walk', actor: 'okafor' });
  step(2.5); // same side, 1 m away
  step(-1); // 1 m behind the glass
  step(-8); // behind the glass and a wall
  const [open, glass, wall] = played as [PlayedVoice, PlayedVoice, PlayedVoice];
  assert.equal(glass.opts.cutoff, GLASS_CUTOFF_HZ, 'slightly dulled');
  assert.ok((glass.opts.gain ?? 0) < (open.opts.gain ?? 0), 'a little quieter than in the open');
  assert.ok((glass.opts.gain ?? 0) > (wall.opts.gain ?? 0) * 1.4, 'clearly louder than through a wall');
  assert.ok((wall.opts.cutoff ?? 20000) <= 600, 'glass then a wall is fully muffled');
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

// in-world-audio spec (overhaul-flooded-tunnel): footsteps, slosh and landings in standing water.
function waterRig(depth: (y: number) => number) {
  const { engine, played } = makeFakeAudio(3);
  const loops: Array<{ name: SoundName; gains: number[]; stopped: boolean }> = [];
  engine.loop = (name) => {
    const l = { name, gains: [] as number[], stopped: false };
    loops.push(l);
    return { setGain: (v: number) => void l.gains.push(v), stop: () => void (l.stopped = true), setPosition: () => undefined };
  };
  const later: Array<() => void> = [];
  const fs = new FootstepAudio({
    audio: engine,
    rng: new Rng('wade'),
    listener: () => new THREE.Vector3(0, 1.6, 0),
    surfaceAt: () => 'water',
    waterDepth: (_x, y) => depth(y),
    later: (fn) => void later.push(fn),
  });
  return { fs, played, loops, later };
}

test('walking down stairs into water: the first submerged step splashes, then wading steps, heavier when deeper', () => {
  const { fs, played } = waterRig((y) => Math.max(0, -0.45 - y));
  for (const y of [0, -0.24, -0.48, -0.72, -0.96, -1.2]) fs.playPlayer({ surface: -0.45 - y > 0.02 ? 'water' : 'metal', x: 0, y, z: 0, sprint: false });
  const names = played.map((p) => p.name);
  assert.deepEqual(names.filter((n) => n === 'waterSplashStep').length, 1, 'one splash, on the first wet step');
  assert.equal(names.indexOf('waterSplashStep'), names.indexOf('footWadeShallow') - 1, 'the splash comes with the first wading step');
  assert.ok(names.includes('footWadeDeep'), 'thigh-deep steps use the deep bank');
  assert.equal(names[names.length - 1], 'footWadeDeep');
  assert.ok(played.every((p) => p.opts.cutoff === undefined), 'real wading sounds, not a muffled concrete step');
});

test('a jump from the water onto a dry case: takeoff splash, then the case\'s landing step, then drips', () => {
  const { fs, played, later } = waterRig((y) => Math.max(0, -0.45 - y));
  fs.waterJump(0, -1.2, 0);
  fs.playPlayer({ surface: 'metal', x: 0, y: -0.35, z: 0, sprint: false, landing: true });
  assert.deepEqual(played.map((p) => p.name), ['waterSplashTakeoff', 'footPlate']);
  assert.equal(later.length, 1);
  later[0]!();
  assert.equal(played.at(-1)!.name, 'bodyDrip');
});

test('dropping from the case back into the water: a landing splash and no dry landing step', () => {
  const { fs, played } = waterRig((y) => Math.max(0, -0.45 - y));
  fs.playPlayer({ surface: 'water', x: 0, y: -1.2, z: 0, sprint: false, landing: true });
  assert.deepEqual(played.map((p) => p.name), ['waterSplashLand']);
});

test('wading slosh follows speed and fades out within about half a second of stopping', () => {
  const { fs, loops } = waterRig(() => 0.75);
  for (let i = 0; i < 30; i++) fs.slosh('player', 0, -1.2, 0, 1.6, 1 / 60);
  assert.equal(loops.length, 1);
  assert.equal(loops[0]!.name, 'waterSlosh');
  const moving = loops[0]!.gains.at(-1)!;
  assert.ok(moving > 0.1, `audible while wading (${moving})`);
  fs.slosh('player', 0, -1.2, 0, 0, 1 / 60);
  assert.equal(loops[0]!.gains.at(-1), 0, 'stopping targets silence (0.12 s time constant: ~0.5 s to fade)');
  for (let i = 0; i < 120; i++) fs.slosh('player', 0, -1.2, 0, 0, 1 / 60);
  assert.equal(loops[0]!.stopped, true, 'the loop is released after a while idle');
});

test('another body\'s slosh is cut beyond footstep range', () => {
  const { fs, loops } = waterRig(() => 0.75);
  fs.slosh('far', FOOTSTEP_MAX_DISTANCE + 5, -1.2, 0, 1.5, 1 / 60);
  assert.equal(loops.length, 0);
});
