import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { afterGroup, GROUPS, labBProps, type Pose } from './labBTestKit.ts';

// physical-interaction spec (voss-death-scene §5): the real Lab B, with the real Voss kill sweeping her bench and pulling
// the cart over. Run this file alone while iterating (it loads the whole level several times).

/** Lab B's side of the gallery glass (z) and its walls. */
const GLASS_Z = 22.06;
const ROOM = { x0: 2.3, x1: 13.9, z1: 29.9 };
/** The kill from Okafor's question to well after the creature is up, then a settle. */
const PLAY_S = 17;

const moved = (a: Pose, b: Pose): number => a.pos.distanceTo(b.pos);

test('physical-interaction "At rest before the kill" and "Her bench": the glassware on her bench and the cart\'s load are loose, the cart is scripted, and nothing moves or sounds as the room settles', async () => {
  const g = await labBProps();
  const ids = g.loose.map((p) => p.id);
  const bench = ids.filter((id) => id.startsWith('labb_bench_'));
  assert.equal(bench.length, 7, `the seven things on her bench top are loose (${bench.join(', ')})`);
  assert.ok(ids.filter((id) => id.startsWith('labb_cart_')).length === 9, 'and the nine on the cart');
  const cart = g.all.find((p) => p.id === 'labb_cart')!;
  assert.ok(cart.kinematic && !cart.loose && cart.colliders.length > 0, 'the cart is a scripted body and still an obstacle');
  for (const p of g.loose) {
    assert.equal(p.colliders.length, 0, `${p.id} is no obstacle to motors or the navmesh`);
    assert.ok(p.sound, `${p.id} has a sound`);
  }
  const placed = g.poses();
  g.run(5);
  for (const [id, now] of g.poses()) {
    const was = placed.get(id)!;
    assert.ok(moved(now, was) < 0.01, `${id} stayed put (${(moved(now, was) * 100).toFixed(1)} cm)`);
    assert.ok(now.pos.y > was.pos.y - 0.005, `${id} did not sink`);
    assert.ok(now.quat.angleTo(was.quat) < 0.03, `${id} stayed upright`);
  }
  assert.equal(g.heard.length, 0, 'a settling room is silent');
  g.world!.destroy();
});

test('physical-interaction "Seen from the gallery with physics off": the loaded cart and the bench objects are there, standing still', async () => {
  const g = await labBProps({ physics: false });
  const placed = g.poses();
  assert.ok(placed.size >= 17, `the cart, its load and the bench glassware (${placed.size})`);
  for (const p of g.all) {
    let shown = true;
    for (let o: THREE.Object3D | null = p.object; o; o = o.parent) shown &&= o.visible;
    assert.ok(shown, `${p.id} is drawn`);
  }
  // Up to the moment she sweeps the bench, nothing has moved.
  g.kill();
  g.run(2);
  g.ask();
  g.run(0.5);
  for (const [id, now] of g.poses()) assert.ok(now.pos.equals(placed.get(id)!.pos) && now.quat.equals(placed.get(id)!.quat), `${id} stood still`);
});

/** Where the cart first leaves its place (s after Okafor's question) and where it ends, with or without physics. */
async function cartRun(physics: boolean, fps = 60) {
  const g = await labBProps({ physics, fps });
  g.run(1);
  const placed = g.poses().get('labb_cart')!;
  g.kill();
  g.run(2);
  g.ask();
  const asked = g.time();
  let left = -1;
  g.run(PLAY_S, (t) => {
    if (left < 0 && moved(g.poses().get('labb_cart')!, placed) > 1e-4) left = t - asked;
  });
  return { g, left, rest: g.poses().get('labb_cart')! };
}

test('physical-interaction "The cart on its frame": it starts over at the same moment after Okafor\'s question with physics on and off, and rests in the same pose', async () => {
  const on = await cartRun(true);
  const off = await cartRun(false);
  const frame = 1 / 60;
  // The tip is at 5.5 s into `panic`, which starts as the question ends.
  assert.ok(Math.abs(on.left - 5.5) <= frame + 1e-6, `it starts going over 5.5 s in (${on.left.toFixed(3)} s)`);
  assert.ok(Math.abs(on.left - off.left) <= frame + 1e-6, `on the same frame either way (${on.left.toFixed(3)} / ${off.left.toFixed(3)} s)`);
  const after = afterGroup(GROUPS.cart).get('labb_cart')!;
  for (const r of [on.rest, off.rest]) {
    assert.ok(r.pos.distanceTo(after.pos) < 1e-3, `it lies at its resting spot (${(r.pos.distanceTo(after.pos) * 100).toFixed(2)} cm off)`);
    assert.ok(r.quat.angleTo(after.quat) < 1e-3, 'turned as authored');
  }
  // The same at another frame rate.
  const slow = await cartRun(false, 30);
  assert.ok(Math.abs(slow.left - off.left) <= 1 / 30 + 1e-6, `at 30 fps too (${slow.left.toFixed(3)} s)`);
  on.g.world!.destroy();
});

test('physical-interaction "Played kill": she sweeps two things off her bench and the cart\'s whole load spills; all of it lands on the floor or furniture inside Lab B, none in the bench, the floor, the cart or the glass', async () => {
  const g = await labBProps();
  g.run(1);
  const before = g.poses();
  g.kill();
  g.run(2);
  g.ask();
  const asked = g.time();
  g.run(PLAY_S);
  const after = g.poses();
  const thrown = [...after].filter(([id, now]) => id !== 'labb_cart' && moved(now, before.get(id)!) > 0.1).map(([id]) => id).sort();
  const expected = [...afterGroup(GROUPS.bench).keys(), ...afterGroup(GROUPS.load).keys()].sort();
  assert.deepEqual(thrown, expected, 'what the sweep and the cart throw is what a skipped kill lays out');
  // What she swept went at the sweep, what the cart carried at the tip, and both are heard quieter under the crash.
  for (const d of g.ducked) {
    const t = d.at - asked;
    if (d.id.startsWith('labb_bench_')) assert.ok(Math.abs(t - 0.55) < 0.02, `${d.id} swept at 0.55 s (${t.toFixed(2)})`);
    else assert.ok(Math.abs(t - 5.5) < 0.02, `${d.id} thrown as the cart goes over at 5.5 s (${t.toFixed(2)})`);
  }
  assert.deepEqual(g.ducked.map((d) => d.id).sort(), expected, 'each thrown thing is ducked once');

  const statics = (x: number, y: number, z: number) =>
    g.level.collision.find(x, z, x, z).filter((k) => k.enabled !== false && y > k.minY + 1e-3 && y < k.maxY - 1e-3 && !g.all.some((p) => p.colliders.includes(k as never)));
  const cart = g.all.find((p) => p.id === 'labb_cart')!;
  cart.object.updateMatrixWorld(true);
  const toCart = cart.object.matrixWorld.clone().invert();
  for (const id of thrown) {
    const p = g.all.find((q) => q.id === id)!;
    p.object.updateMatrixWorld(true);
    const b = p.localColliders[0]!;
    const c = new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2).applyMatrix4(p.object.matrixWorld);
    assert.ok(c.y > 0, `${id} is not through the floor (${c.y.toFixed(3)})`);
    assert.equal(statics(c.x, c.y, c.z).length, 0, `${id} is not inside the bench or anything else fixed (${c.toArray().map((v) => v.toFixed(2)).join(', ')})`);
    const inCart = c.clone().applyMatrix4(toCart);
    for (const box of cart.localColliders) {
      const inside = [0, 1, 2].every((i) => inCart.getComponent(i) > box.min[i]! + 1e-3 && inCart.getComponent(i) < box.max[i]! - 1e-3);
      assert.ok(!inside, `${id} is not inside the cart's frame`);
    }
    assert.ok(c.z > GLASS_Z && c.z < ROOM.z1 && c.x > ROOM.x0 && c.x < ROOM.x1, `${id} stays in Lab B, on her side of the glass (${c.x.toFixed(2)}, ${c.z.toFixed(2)})`);
  }
  // It falls quiet.
  const count = g.heard.length;
  assert.ok(count > 0, 'the spill is heard');
  g.run(3);
  assert.equal(g.heard.length, count, 'and then is silent');
  g.world!.destroy();
});

test('physical-interaction "Physics off": at the sweep and as the cart goes over, what they throw appears at its resting spot and stays there', async () => {
  const g = await labBProps({ physics: false });
  const bench = afterGroup(GROUPS.bench);
  const load = afterGroup(GROUPS.load);
  const placed = g.poses();
  g.kill();
  g.run(2);
  g.ask();
  const asked = g.time();
  const appeared = new Map<string, number>();
  g.run(PLAY_S, (t) => {
    for (const [id, now] of g.poses()) {
      const at = bench.get(id) ?? load.get(id);
      if (at && !appeared.has(id) && now.pos.distanceTo(at.pos) < 1e-4) appeared.set(id, t - asked);
    }
  });
  for (const id of bench.keys()) assert.ok(Math.abs(appeared.get(id)! - 0.55) <= 1 / 60 + 1e-6, `${id} lies where it lands at the sweep (${appeared.get(id)?.toFixed(3)} s)`);
  for (const id of load.keys()) assert.ok(Math.abs(appeared.get(id)! - 5.5) <= 1 / 60 + 1e-6, `${id} lies where it lands as the cart goes over (${appeared.get(id)?.toFixed(3)} s)`);
  for (const [id, now] of g.poses()) {
    const at = bench.get(id) ?? load.get(id);
    if (at) assert.ok(now.pos.distanceTo(at.pos) < 1e-4 && now.quat.angleTo(at.quat) < 1e-3, `${id} stayed there`);
    else if (id !== 'labb_cart') assert.ok(now.pos.equals(placed.get(id)!.pos), `${id} never moved`);
  }
});

for (const physics of [true, false]) {
  test(`physical-interaction "Restored kill" (physics ${physics ? 'on' : 'off'}): the cart and what it and the sweep threw lie at their resting spots, nothing else moves, and it is silent`, async () => {
    const g = await labBProps({ physics });
    g.run(1);
    const placed = g.poses();
    g.kill(true);
    g.run(3);
    const laid = new Map([...afterGroup(GROUPS.bench), ...afterGroup(GROUPS.cart), ...afterGroup(GROUPS.load)]);
    assert.equal(laid.size, 12, 'two swept things, the cart and its nine');
    for (const [id, now] of g.poses()) {
      const at = laid.get(id);
      if (at) {
        assert.ok(now.pos.distanceTo(at.pos) < 0.02, `${id} lies at its resting spot (${(now.pos.distanceTo(at.pos) * 100).toFixed(1)} cm off)`);
        assert.ok(now.quat.angleTo(at.quat) < 0.05, `${id} turned as laid out`);
      } else assert.ok(moved(now, placed.get(id)!) < 0.01, `${id} is not moved by the restored kill`);
    }
    assert.equal(g.heard.length, 0, 'a restored kill is silent');
    assert.equal(g.ducked.length, 0, 'and throws nothing');
    g.world?.destroy();
  });
}

test('physical-interaction "Restart before the kill": after a played kill, a restart puts every object back where it was placed, silently', async () => {
  const g = await labBProps();
  g.run(1);
  const placed = g.poses();
  g.kill();
  g.run(2);
  g.ask();
  g.run(PLAY_S);
  const heard = g.heard.length;
  await g.restart();
  g.run(2);
  for (const [id, now] of g.poses()) {
    assert.ok(moved(now, placed.get(id)!) < 0.02, `${id} is back (${(moved(now, placed.get(id)!) * 100).toFixed(1)} cm off)`);
    assert.ok(now.quat.angleTo(placed.get(id)!.quat) < 0.05, `${id} is upright again`);
  }
  assert.equal(g.heard.length, heard, 'standing things up again is silent');
  g.world!.destroy();
});
