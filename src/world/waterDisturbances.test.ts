import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WaterBodies, WaterBody } from './water.ts';
import { WaterDisturbances, type SplashEvent } from './waterDisturbances.ts';
import { SPLASH_PRESETS, burstCount } from '../render/water/splashes.ts';

// standing-water spec (overhaul-flooded-tunnel D6/D7): what disturbs the water.

function setup(): { body: WaterBody; fx: WaterDisturbances; splashes: SplashEvent[] } {
  const water = new WaterBodies();
  const body = new WaterBody({ room: 'R09', level: -0.45, floor: -1.2, cells: [{ minX: 0, maxX: 8, minZ: 0, maxZ: 4 }] });
  water.add(body);
  let seed = 1;
  const fx = new WaterDisturbances(water, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
  const splashes: SplashEvent[] = [];
  fx.onSplash = (s) => splashes.push(s);
  return { body, fx, splashes };
}

test('a step in the water pushes the surface; a step on dry ground does not', () => {
  const { body, fx } = setup();
  fx.footstep(2, -1.2, 2, 'walk', 'okafor');
  assert.equal(body.pending.length, 1);
  assert.ok(body.pending[0]!.strength < 0, 'a foot pushes the surface down');
  fx.footstep(2, 0, 2, 'walk', 'okafor');
  assert.equal(body.pending.length, 1, 'standing on a landing above the water');
  fx.footstep(20, -1.2, 2, 'walk', 'okafor');
  assert.equal(body.pending.length, 1, 'outside the footprint');
});

test('a wading shambler leaves a wake back to its last step', () => {
  const { body, fx } = setup();
  fx.footstep(1, -1.2, 2, 'shamble', 'e1');
  fx.footstep(1.8, -1.2, 2, 'shamble', 'e1');
  assert.equal(body.pending.length, 1 + 1 + 3, 'two rings and three wake stamps between them');
  const wake = body.pending.slice(2).map((s) => s.x);
  assert.ok(wake.every((x) => x > 1 && x < 1.8));
});

test('Jay wading leaves a wake every 22 cm moved, and nothing while standing still', () => {
  const { body, fx } = setup();
  fx.wade('player', 1, -1.2, 2);
  for (let i = 1; i <= 10; i++) fx.wade('player', 1 + i * 0.1, -1.2, 2);
  assert.equal(body.pending.length, 4);
  body.takeStamps();
  for (let i = 0; i < 10; i++) fx.wade('player', 2, -1.2, 2);
  assert.equal(body.pending.length, 0);
});

test('a shot down into the water hits the surface before the floor; a shot along it does not', () => {
  const { body, fx, splashes } = setup();
  const p = fx.shot({ x: 1, y: 0.6, z: 2 }, { x: Math.SQRT1_2, y: -Math.SQRT1_2, z: 0 }, 10);
  assert.ok(p);
  assert.ok(Math.abs(p.x - 2.05) < 1e-9 && p.y === -0.45, `crossed the surface at x=${p.x}`);
  assert.equal(body.pending.length, 1);
  assert.equal(splashes.at(-1)?.kind, 'bullet');
  assert.equal(fx.shot({ x: 1, y: 0.6, z: 2 }, { x: 1, y: 0, z: 0 }, 10), null, 'level shot');
  assert.equal(fx.shot({ x: 1, y: 0.6, z: 2 }, { x: Math.SQRT1_2, y: -Math.SQRT1_2, z: 0 }, 0.5), null, 'hit a wall first');
});

test('a body falling into the water splashes; one landing on a dry landing does not', () => {
  const { body, fx, splashes } = setup();
  fx.land(3, -1.2, 2, 0.9, 'body');
  assert.equal(splashes.at(-1)?.kind, 'body');
  assert.equal(body.pending.length, 1);
  fx.land(3, 0, 2, 0.9, 'body');
  assert.equal(body.pending.length, 1);
});

test('a hull groan makes every body shudder', () => {
  const { body, fx } = setup();
  fx.shake(0.25);
  assert.equal(body.shudder, 0.75);
});

test('a drip emitter rings the water now and then; a pour churns it steadily', () => {
  const { body, fx } = setup();
  fx.addEmitter({ x: 4, z: 2, rate: 0.5, radius: 0.08, strength: -0.004, kind: 'drip' });
  fx.addEmitter({ x: 6, z: 2, rate: 20, radius: 0.4, strength: -0.003, kind: 'pour' });
  for (let i = 0; i < 600; i++) fx.update(1 / 60);
  const drips = body.pending.filter((s) => s.x === 4).length;
  const pours = body.pending.length - drips;
  assert.ok(drips >= 1 && drips <= 15, `drips over 10 s: ${drips}`);
  assert.equal(body.pending.length, 64, 'the queue keeps the newest stamps');
  assert.ok(pours > 40, `pour stamps kept: ${pours}`);
});

// rig-necromorph task 7.5a (design D6c; spec flooded-tunnel "It tears through the water"):
// in R09's 0.75 m water, a person's step throws no spray, while the charging creature throws a stomp spray larger than a
// body landing on every landing and a kick spray on every lift.
test('a creature charging in 0.75 m water throws stomp and kick sprays larger than a body landing; a person step is unchanged', () => {
  const { body, fx, splashes } = setup();
  // A person wading in 0.75 m water: pushes the surface, throws no spray (depth >= 0.35 m).
  fx.footstep(2, -1.2, 2, 'walk', 'okafor');
  assert.equal(splashes.length, 0, 'a person step in 0.75 m water throws no spray');
  const personStrength = Math.abs(body.pending[0]!.strength);
  const personRadius = body.pending[0]!.radius;
  body.takeStamps();

  // A body landing in the same water, for comparison.
  fx.land(3, -1.2, 2, 1, 'body');
  const bodySplash = splashes.at(-1)!;
  assert.equal(bodySplash.kind, 'body');
  body.takeStamps();

  // The creature landing in 0.75 m water: churns harder and wider and throws a stomp spray larger than a body landing.
  fx.footstep(4, -1.2, 2, 'heavy', 'r09-flood-elite', 1);
  assert.equal(body.pending.length, 1);
  assert.ok(Math.abs(body.pending[0]!.strength) > personStrength * 3, 'creature stomp churns much harder than a person step');
  assert.ok(body.pending[0]!.radius > personRadius * 1.4, 'creature stomp churns wider');
  const stompSplash = splashes.at(-1)!;
  assert.equal(stompSplash.kind, 'stomp');
  assert.equal(stompSplash.y, body.level);
  assert.ok(burstCount(stompSplash.kind, stompSplash.size) > burstCount(bodySplash.kind, bodySplash.size), 'stomp throws more droplets than a body landing');
  assert.ok(SPLASH_PRESETS.stomp.spread > SPLASH_PRESETS.body.spread && SPLASH_PRESETS.stomp.up[1] > SPLASH_PRESETS.body.up[1]);
  body.takeStamps();

  // The creature pulling a foot out of 0.75 m water: lifts the surface and throws a kick spray.
  fx.footstep(4, -1.2, 2, 'lift', 'r09-flood-elite', 1);
  assert.equal(body.pending.length, 1);
  assert.ok(body.pending[0]!.strength > 0, 'a lift pulls the surface up');
  const kickSplash = splashes.at(-1)!;
  assert.equal(kickSplash.kind, 'kick');
  assert.equal(kickSplash.y, body.level);
  assert.ok(burstCount(kickSplash.kind, kickSplash.size) > burstCount('step', 0.3) * 5, 'kick spray is far larger than a shallow person step');

  // Shallow water: a person's step still throws the small 'step' spray unchanged.
  const shallow = new WaterBodies();
  const puddle = new WaterBody({ room: 'R09', level: -1.0, floor: -1.2, cells: [{ minX: 0, maxX: 8, minZ: 0, maxZ: 4 }] });
  shallow.add(puddle);
  const shallowSplashes: SplashEvent[] = [];
  const sfx = new WaterDisturbances(shallow, () => 0.5);
  sfx.onSplash = (s) => shallowSplashes.push(s);
  sfx.footstep(2, -1.2, 2, 'walk', 'okafor');
  assert.equal(shallowSplashes.length, 1);
  assert.equal(shallowSplashes[0]!.kind, 'step');
  assert.equal(shallowSplashes[0]!.size, 0.3);
});
