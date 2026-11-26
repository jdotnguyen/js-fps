import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ctx as enemyCtx, director as enemyDirector } from '../ai/enemyTestKit.ts';
import { squadEnemySource } from '../ai/squadEnemies.ts';
import { Humanoid } from '../actors/humanoid.ts';
import { CasingAudio } from '../audio/casings.ts';
import type { VoiceOptions } from '../audio/engine.ts';
import type { SoundName } from '../audio/sounds.ts';
import { CollisionWorld } from '../world/collision.ts';
import { shotPoints, type SquadEvents } from '../ai/squad.ts';
import { RATE_JITTER, SQUAD_SHOT, wireSquadShots } from './squadShots.ts';
import { MUZZLE_FLASH_TIME, SLIDE_CYCLE, SLIDE_TRAVEL } from '../actors/squadPistol.ts';
import { EventBus } from '../core/events.ts';

/** Squad covering fire wired up (squad-sidearms task 3.3): one gunshot at the muzzle, one brass landing, no enemy noise, the slide kick. */

interface Played {
  name: SoundName;
  opts: VoiceOptions | undefined;
}

/** A mate aiming the pistol, a deck-plate floor, the casing audio on a fake engine and clock, and the enemy director's noise counted. */
function range() {
  const played: Played[] = [];
  const engine = {
    hasSound: () => true,
    variantCount: () => 4,
    play(name: SoundName, opts?: VoiceOptions) {
      played.push({ name, opts });
      return { stop() {} };
    },
  };
  const timers: Array<() => void> = [];
  const cw = new CollisionWorld();
  cw.add({ min: [-20, -0.2, -20], max: [20, 0, 20] }, 'deck', 'metal');
  const listener = new THREE.Vector3(0, 1.6, 2);
  const casings = new CasingAudio({
    audio: engine,
    listener: () => listener,
    world: { raycast: (...r) => cw.raycast(...r), surfaceAt: (x, y, z) => cw.surfaceAt(x, y, z) },
    later: (fn) => void timers.push(fn),
    now: () => 0,
  });
  const { dir, events } = enemyDirector();
  let noises = 0;
  const realNoise = dir.noise.bind(dir);
  dir.noise = ((...a: Parameters<typeof dir.noise>) => {
    noises++;
    return realNoise(...a);
  }) as typeof dir.noise;
  const body = new Humanoid({ seed: 'squad-shot', outfit: 'crew', role: 'npc', pose: 'aim_pistol' }, enemyCtx());
  for (let i = 0; i < 40; i++) body.update(1 / 60);
  wireSquadShots({ events, audio: engine, casings: () => casings, body: () => body });
  const fire = () => {
    const m = { position: body.group.position, body };
    const payload: SquadEvents['squad:fired'] = { id: 'engineer', enemy: 'e0', hit: true, killed: false, ...shotPoints(m) };
    // The squad's own hit ray, as the session's enemy source runs it (it makes no noise either).
    squadEnemySource(dir).shoot('e0', 'torso', 10, payload.muzzle);
    events.emit('squad:fired', payload);
    return payload;
  };
  const emit = (payload: SquadEvents['squad:fired']) => events.emit('squad:fired', payload);
  return { played, timers, body, fire, emit, noises: () => noises, dir };
}

test('one squad shot: one squad gunshot at the muzzle, one brass landing, no enemy noise', () => {
  const r = range();
  assert.ok(r.body.pistol, 'the mate holds the pistol');
  const shot = r.fire();
  assert.equal(shot.fromPistol, true);
  const shots = r.played.filter((p) => p.name === 'squadPistolShot');
  assert.equal(shots.length, 1, 'one gunshot');
  const at = shots[0]!.opts!.position!;
  assert.ok(at.distanceTo(new THREE.Vector3(shot.muzzle.x, shot.muzzle.y, shot.muzzle.z)) < 1e-9, 'at the muzzle');
  assert.equal(shots[0]!.opts!.bus, 'sfx', 'a positional world sound (occluded like the rest)');
  assert.notEqual(shots[0]!.opts!.occlude, false);
  assert.ok(!r.played.some((p) => p.name === 'pistolShot'), 'never Jay\'s own shot');
  // The brass lands later.
  assert.equal(r.timers.length, 1, 'one casing scheduled');
  for (const t of r.timers.splice(0)) t();
  const brass = r.played.filter((p) => String(p.name).startsWith('casingBrass'));
  assert.equal(brass.length, 1, 'one brass landing');
  assert.equal(brass[0]!.name, 'casingBrassMetal', 'on deck plate');
  assert.equal(r.noises(), 0, 'the infected hear nothing');
  // The noise spy works: Jay's own shot is heard.
  r.dir.playerShot('pistol', new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0, 0, -1), 1);
  assert.equal(r.noises(), 1);
});

test('a scripted volley with a gain plays its shots that much quieter, in the head (the R16 finale under the roar)', () => {
  const r = range();
  const m = { position: r.body.group.position, body: r.body };
  r.emit({ id: 'engineer', enemy: 'scripted', hit: false, killed: false, ...shotPoints(m) });
  r.emit({ id: 'engineer', enemy: 'scripted', hit: false, killed: false, gain: 0.6, ...shotPoints(m) });
  const shots = r.played.filter((p) => p.name === 'squadPistolShot');
  assert.equal(shots.length, 2);
  assert.equal(shots[0]!.opts!.gain, SQUAD_SHOT.gain);
  assert.ok(Math.abs(shots[1]!.opts!.gain! - SQUAD_SHOT.gain * 0.6) < 1e-9, 'quieter by its gain');
  assert.equal(shots[1]!.opts!.position, undefined, 'heard through the feed, not placed');
});

test('consecutive squad shots vary in pitch within ±4%', () => {
  const r = range();
  for (let i = 0; i < 12; i++) r.fire();
  const rates = r.played.filter((p) => p.name === 'squadPistolShot').map((p) => p.opts!.rate!);
  assert.equal(rates.length, 12);
  for (const x of rates) assert.ok(Math.abs(x - 1) <= RATE_JITTER + 1e-9, `rate ${x}`);
  assert.ok(new Set(rates).size > 6, 'they differ');
});

test('the slide kicks back on a shot and is closed again within 0.15 s', () => {
  const r = range();
  assert.equal(r.body.slideTravel, 0, 'closed at rest');
  r.fire();
  let peak = 0;
  let closedAt = Infinity;
  const dt = 1 / 120;
  for (let t = dt; t <= 0.3; t += dt) {
    r.body.update(dt);
    peak = Math.max(peak, r.body.slideTravel);
    if (r.body.slideTravel === 0 && closedAt === Infinity && peak > 0) closedAt = t;
  }
  assert.ok(peak > SLIDE_TRAVEL * 0.5, `the slide moved back (${(peak * 1000).toFixed(1)} mm)`);
  assert.ok(closedAt <= 0.15, `closed again at ${closedAt.toFixed(3)} s`);
  assert.ok(SLIDE_CYCLE <= 0.15);
  assert.equal(r.body.slideTravel, 0);
});

test('a squad shot flashes at the muzzle and fires the shared light there; the flash is gone within its time', () => {
  const r = range();
  const fired: Array<{ x: number; y: number; z: number }> = [];
  // Its own wiring on a fresh bus, with a light (the range's wiring has none).
  const bus = new EventBus();
  wireSquadShots({ events: bus, audio: { play() {} }, casings: () => null, body: () => r.body, light: { fire: (m) => void fired.push(m) } });
  const shot = { id: 'engineer' as const, enemy: 'e0', hit: false, killed: false, ...shotPoints({ position: r.body.group.position, body: r.body }) };
  assert.equal(r.body.muzzleFlashing, false);
  bus.emit('squad:fired', shot);
  assert.deepEqual(fired, [shot.muzzle], 'the light fires at the muzzle');
  assert.equal(r.body.muzzleFlashing, true, 'the flash shows');
  let t = 0;
  while (r.body.muzzleFlashing && t < 0.5) {
    r.body.update(1 / 120);
    t += 1 / 120;
  }
  assert.ok(t <= MUZZLE_FLASH_TIME + 1 / 60, `the flash went after ${t.toFixed(3)} s`);
});
