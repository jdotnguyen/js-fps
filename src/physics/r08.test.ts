import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadSlice01 } from '../world/headlessSlice.ts';
import { impactSound } from '../audio/impacts.ts';
import { INSTRUMENT_CART } from '../world/kit/slice.ts';
import { PhysicsProps, type PropImpact } from './interaction.ts';
import { createRapierEngine } from './rapierAdapter.ts';
import { PhysicsWorld } from './world.ts';

// livelier-cart-slam: the real R08 cart and its loose instruments, thrown by the three slams as kills.json sets them.
// Run this file alone while iterating (it loads the whole level).
const STEP = 1 / 60;
/** The medical bay's side of the centre pane (z), and its walls. */
const PANE_Z = 45.72;
const ROOM = { x0: -5.8, x1: 5.8, z1: 53.8 };

async function r08() {
  const { level, events } = loadSlice01();
  const world = await PhysicsWorld.create(createRapierEngine, level.collision);
  const heard: PropImpact[] = [];
  const props = new PhysicsProps(world, level, (i) => void (impactSound(i.material, i.speed) && heard.push(i)));
  const items = level.physicsProps().filter((p) => p.id.startsWith('r08_cart_'));
  const anchor = (id: string): THREE.Vector3 => level.anchor(id)!.pos.clone();
  let time = 0;
  const run = (seconds: number, each?: (t: number) => void): void => {
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      each?.(time);
      world.step(STEP);
      props.sync(STEP);
      time += STEP;
    }
  };
  const pos = (id: string): THREE.Vector3 => items.find((p) => p.id === id)!.object.position.clone();
  return { level, events, world, props, heard, items, anchor, run, pos, now: () => time };
}

/** The slam beat's events, read from the data the game plays. */
async function slams(): Promise<Array<{ at: number; reach: number; strength: number; up: number }>> {
  const { default: kills } = await import('../data/kills.json', { with: { type: 'json' } });
  const beat = (kills as unknown as { mauled: { beats: Array<{ id: string; events: Array<Record<string, unknown>> }> } }).mauled.beats.find((b) => b.id === 'slam')!;
  return beat.events
    .filter((e) => e['do'] === 'slam')
    .map((e) => {
      const b = e['burst'] as { reach: number; strength: number; up?: number };
      // Impact time: the event, its wind-up, and the strike (MAUL.windup 0.32, MAUL.strike 0.1).
      return { at: (e['t'] as number) + ((e['windup'] as number | undefined) ?? 0.32) + 0.1, reach: b.reach, strength: b.strength, up: b.up ?? 0.5 };
    });
}

test('R08: the instruments stand flush on the cart, still and silent, and nothing on the cart blocks movement', async () => {
  const g = await r08();
  assert.equal(g.items.length, 9, g.items.map((p) => p.id).join(', '));
  const cart = g.level.physicsProps().find((p) => p.id === 'r08_cart')!;
  assert.ok(cart.kinematic, 'the cart is a scripted body');
  for (const p of g.items) {
    assert.ok(p.loose && p.sound, `${p.id} is loose and sounds`);
    assert.equal(p.colliders.length, 0, `${p.id} is no obstacle`);
    const y = p.object.position.y;
    assert.ok([INSTRUMENT_CART.top, INSTRUMENT_CART.shelf].some((s) => Math.abs(y - s) < 0.002), `${p.id} stands on the tray or the shelf (${y})`);
  }
  const placed = new Map(g.items.map((p) => [p.id, { pos: p.object.position.clone(), quat: p.object.quaternion.clone() }]));
  g.run(3);
  for (const p of g.items) {
    const was = placed.get(p.id)!;
    assert.ok(p.object.position.distanceTo(was.pos) < 0.01, `${p.id} stayed put (${(p.object.position.distanceTo(was.pos) * 100).toFixed(1)} cm)`);
    assert.ok(p.object.quaternion.angleTo(was.quat) < 0.05, `${p.id} stayed upright`);
  }
  assert.equal(g.heard.length, 0, 'a settling room is silent');
  g.world.destroy();
});

test('R08: the three slams throw the load up and off the cart, some at the glass, none out of the room', async () => {
  const g = await r08();
  g.run(1);
  const hits = await slams();
  assert.equal(hits.length, 3);
  const at = g.anchor('r08_cart_top');
  const toward = g.anchor('medbay_c_glass');
  const top = g.items.filter((p) => Math.abs(p.object.position.y - INSTRUMENT_CART.top) < 0.01).map((p) => p.id);
  const shelf = g.items.filter((p) => Math.abs(p.object.position.y - INSTRUMENT_CART.shelf) < 0.01).map((p) => p.id);
  assert.ok(top.length >= 6 && shelf.length >= 2);
  const onFloor = (id: string): boolean => g.pos(id).y < 0.1;
  const onCart = (id: string): boolean => {
    const p = g.pos(id);
    return p.y > 0.85 && Math.abs(p.x - at.x) < INSTRUMENT_CART.w / 2 && Math.abs(p.z - at.z) < INSTRUMENT_CART.d / 2;
  };
  let highest = 0;
  let nearestPane = Infinity;
  const fired = new Set<number>();
  const start = g.now();
  // The throw (kills.json `throw` beat, its `knock`): from behind the cart over it to the pane's foot, then her slide.
  const knocked = new Set<string>();
  const rest = g.anchor('priya_rest');
  const flight = [new THREE.Vector3(-0.3, 0, 47.8), new THREE.Vector3(0.9, 0, 46.07), rest];
  let her: THREE.Vector3 | null = null;
  const watch = (t: number): void => {
    const u = t - start - hits[2]!.at;
    if (u >= 0 && u <= 1.8) {
      const next = u < 0.55 ? flight[0]!.clone().lerp(flight[1]!, u / 0.55) : flight[1]!.clone().lerp(flight[2]!, Math.min(1, (u - 0.55) / 0.9));
      const travel = her ? next.clone().sub(her) : new THREE.Vector3(1, 0, -1);
      g.props.knock(next, travel.lengthSq() > 1e-8 ? travel : new THREE.Vector3(0, 0, -1), 0.55, 1, knocked);
      her = next;
    }
    for (const [i, h] of hits.entries()) {
      if (fired.has(i) || t - start < h.at) continue;
      fired.add(i);
      g.props.burst(at, h.reach, h.strength, { up: h.up, along: { x: 1, y: 0, z: 0 }, toward, seed: `priya:slam:${i + 1}` });
    }
    for (const id of top) highest = Math.max(highest, g.pos(id).y);
    for (const p of g.items) nearestPane = Math.min(nearestPane, p.object.position.z - PANE_Z);
  };
  // First slam: small things jump, and some land back on the tray.
  g.run(hits[1]!.at - 0.05, watch);
  assert.ok(highest > INSTRUMENT_CART.top + 0.05, `the top's load leaves the tray (${highest.toFixed(2)} m)`);
  assert.ok(top.some(onCart), 'and some of it lands back on the cart');
  // Second: most of the top is swept off.
  g.run(hits[1]!.at - (g.now() - start) + 1, watch);
  const swept = top.filter(onFloor);
  assert.ok(swept.length >= top.length / 2, `at least half the top is on the floor a second after the second slam (${swept.join(', ')})`);
  // Third: the shelf is tipped out too.
  g.run(hits[2]!.at - (g.now() - start) + 2, watch);
  assert.ok(shelf.some(onFloor), `a shelf item is on the floor (${shelf.map((id) => g.pos(id).toArray().map((v) => v.toFixed(2)).join(',')).join(' | ')})`);
  assert.ok(nearestPane < 0.5, `something comes at the glass (${nearestPane.toFixed(2)} m from the pane)`);
  g.run(4);
  for (const p of g.items) {
    const q = p.object.position;
    assert.ok(Math.hypot(q.x - rest.x, q.z - rest.z) > 0.3, `${p.id} is not under her body (${q.x.toFixed(2)}, ${q.z.toFixed(2)})`);
    assert.ok(q.y > -0.05, `${p.id} is not through the floor (${q.y.toFixed(2)})`);
    assert.ok(q.z > PANE_Z && q.z < ROOM.z1 && q.x > ROOM.x0 && q.x < ROOM.x1, `${p.id} stays in the medical bay (${q.x.toFixed(2)}, ${q.z.toFixed(2)})`);
  }
  const sounds = new Set(g.heard.map((i) => impactSound(i.material, i.speed)!.sound));
  assert.ok(sounds.has('propMetal') && sounds.has('propDishSpin'), `steel clinks and the dish spins down (${[...sounds].join(', ')})`);
  g.world.destroy();
});

test('R08: a kinematic cart carries what rests on it, and its collision follows it', async () => {
  const g = await r08();
  g.run(0.5);
  const cart = g.level.propPose('r08_cart')!;
  const dish = g.pos('r08_cart_dish');
  const colliderBefore = g.level.physicsProps().find((p) => p.id === 'r08_cart')!.colliders[0]!.min[2];
  // Slide 5 cm toward the glass over half a second, the way a slam's jolt moves it.
  const to = cart.pos.clone().add(new THREE.Vector3(0, 0, -0.05));
  g.run(0.5, (t) => {
    const u = Math.min(1, (t - 0.5) / 0.3);
    const p = cart.pos.clone().lerp(to, u);
    g.level.setPropPose('r08_cart', p, cart.rotation);
    g.props.drive('r08_cart', p, cart.rotation);
  });
  g.run(0.5);
  assert.ok(Math.abs(g.pos('r08_cart_dish').z - (dish.z - 0.05)) < 0.02, `the dish rode along (${(g.pos('r08_cart_dish').z - dish.z).toFixed(3)} m)`);
  const colliderAfter = g.level.physicsProps().find((p) => p.id === 'r08_cart')!.colliders[0]!.min[2];
  assert.ok(Math.abs(colliderAfter - colliderBefore + 0.05) < 0.005, 'the cart blocks movement where it is now');
  g.world.destroy();
});

// medbay-attack "Skip and restore give the end state", physical-interaction "A scripted pose can be given to loose objects".
test('R08: a skipped scene lays the instruments and the cart out where the slams leave them, still and silent, with or without physics', async () => {
  const g = await r08();
  g.run(1);
  const laid = g.level.layOut('r08_cart');
  assert.equal(laid.length, 10, 'the cart and its nine instruments');
  for (const a of laid) g.props.place(a.id, a.pos, a.rotation);
  g.run(3);
  const rest = g.anchor('priya_rest');
  for (const a of laid) {
    const now = g.level.propPose(a.id)!;
    assert.ok(now.pos.distanceTo(a.pos) < 0.03, `${a.id} lies at its layout (${(now.pos.distanceTo(a.pos) * 100).toFixed(1)} cm off)`);
    assert.ok(now.rotation.angleTo(a.rotation) < 0.1, `${a.id} turned as laid out`);
    if (a.id !== 'r08_cart') {
      assert.ok(a.pos.y < 0.2, `${a.id} is on the floor`);
      assert.ok(a.pos.z > PANE_Z && Math.hypot(a.pos.x - rest.x, a.pos.z - rest.z) > 0.3, `${a.id} is on her side of the pane and not under her`);
    }
  }
  assert.equal(g.heard.length, 0, 'a skipped scene is silent');
  g.world.destroy();
  // Physics off: the level alone draws them there.
  const { level } = loadSlice01();
  for (const a of level.layOut('r08_cart')) assert.ok(level.propPose(a.id)!.pos.distanceTo(a.pos) < 1e-6, `${a.id} drawn at its layout with no physics`);
});
