import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { ControlledLight } from '../render/lights.ts';
import { ManualCaster, RigidCaster, ShadowCasterSet } from '../render/shadowCasters.ts';
import type { PooledSlot } from './lightPool.ts';
import { litSphere, SHADOW_FADE, SHADOW_HOLD, ShadowPool } from './shadowPool.ts';
import { cookieTexture } from '../render/cookies.ts';

// render-lighting spec (shadow-rich-rooms): shadow lights by view, held steadily, faded, and cached.

const DT = 1 / 60;

function slot(x: number, z = 0, opts: Partial<PooledSlot> = {}): PooledSlot {
  const item: ControlledLight = {
    name: `slot@${x},${z}`,
    light: null,
    base: 5,
    pattern: 'steady',
    seed: 0,
    emissives: [],
    emissiveBase: 0,
    shafts: [],
    shaftBase: 0,
    level: 1,
    power: 1,
  };
  return { item, position: new THREE.Vector3(x, 2.6, z), color: new THREE.Color(1, 1, 1), range: 6, priority: 1, shadow: true, kind: 'ceiling', score: 0, ...opts };
}

/** A player camera at `x` (eye height) looking along `dir`. */
function view(x: number, dir: THREE.Vector3): { eye: THREE.Vector3; frustum: THREE.Frustum } {
  const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 200);
  cam.position.set(x, 1.62, 0);
  cam.lookAt(cam.position.clone().add(dir));
  cam.updateMatrixWorld();
  const m = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  return { eye: cam.position.clone(), frustum: new THREE.Frustum().setFromProjectionMatrix(m) };
}

const FWD = new THREE.Vector3(1, 0, 0);
const BACK = new THREE.Vector3(-1, 0, 0);
const holder = (pool: ShadowPool): PooledSlot | null => pool.states()[0]!.slot;
const bound = (pool: ShadowPool): Set<PooledSlot> => new Set(pool.states().map((s) => s.slot).filter((s): s is PooledSlot => s !== null));

test('litSphere covers the apex, the rim and the far edge of a wide and a narrow cone', () => {
  for (const angle of [75, 30]) {
    const s = litSphere(new THREE.Vector3(0, 3, 0), 6, angle, new THREE.Sphere());
    const t = THREE.MathUtils.degToRad(angle);
    for (const p of [new THREE.Vector3(0, 3, 0), new THREE.Vector3(6 * Math.sin(t), 3 - 6 * Math.cos(t), 0), new THREE.Vector3(0, -3, 0)]) {
      assert.ok(s.containsPoint(p) || s.distanceToPoint(p) < 1e-6, `${angle}°: ${p.toArray()} inside`);
    }
  }
});

test('Light behind the player: the two lights ahead take Medium\'s spots although the two behind are nearer', () => {
  const pool = new ShadowPool(new THREE.Group(), 2);
  const behind = [slot(-12), slot(-12.5, 1)];
  const ahead = [slot(16), slot(16.5, 1)];
  const { eye, frustum } = view(0, FWD);
  pool.assign([...behind, ...ahead], eye, { dt: DT, frustum });
  assert.deepEqual(bound(pool), new Set(ahead));
  assert.equal(behind[0]!.item.light, null, 'the nearer lights behind miss the pool and go to the fill pool');
});

test('Light behind the player that lights the view ranks as in view and beats a farther light ahead', () => {
  const pool = new ShadowPool(new THREE.Group(), 1);
  const lighting = slot(-2, 0, { range: 8 }); // its pool of light reaches several metres ahead of the player
  const far = slot(25);
  const { eye, frustum } = view(0, FWD);
  assert.ok(frustum.intersectsSphere(litSphere(lighting.position, lighting.range, 75, new THREE.Sphere())));
  pool.assign([lighting, far], eye, { dt: DT, frustum });
  assert.equal(holder(pool), lighting);
});

test('the current room still comes before other visible rooms among lights in view', () => {
  const pool = new ShadowPool(new THREE.Group(), 1);
  const other = slot(6, 0, { priority: 0 });
  const mine = slot(12);
  const { eye, frustum } = view(0, FWD);
  pool.assign([other, mine], eye, { dt: DT, frustum });
  assert.equal(holder(pool), mine);
});

test('Walking between two lamps hands the shadow over once, not back and forth', () => {
  const pool = new ShadowPool(new THREE.Group(), 1);
  const a = slot(-4);
  const b = slot(4);
  const eye = new THREE.Vector3();
  let changes = 0;
  let last: PooledSlot | null = null;
  // Walk from x -3 to +3 at 0.5 m/s with a small side-to-side sway near the midpoint.
  for (let t = 0; t <= 12; t += DT) {
    eye.set(-3 + 0.5 * t + 0.15 * Math.sin(t * 9), 1.62, 0);
    pool.assign([a, b], eye, { dt: DT });
    pool.finish();
    const h = holder(pool);
    if (h && h !== last) {
      if (last) changes++;
      last = h;
    }
  }
  assert.equal(last, b, 'the walk ends under b');
  assert.equal(changes, 1);
});

test('A quick glance away and back keeps the shadow where it was', () => {
  const pool = new ShadowPool(new THREE.Group(), 1);
  const front = slot(15);
  const back = slot(-15);
  const fwd = view(0, FWD);
  const rev = view(0, BACK);
  pool.assign([front, back], fwd.eye, { dt: DT, frustum: fwd.frustum });
  assert.equal(holder(pool), front);
  for (let t = 0; t < SHADOW_HOLD * 0.8; t += DT) pool.assign([front, back], rev.eye, { dt: DT, frustum: rev.frustum });
  assert.equal(holder(pool), front, 'still held while looking away briefly');
  assert.equal(pool.states()[0]!.phase, 'on');
  for (let t = 0; t < 1; t += DT) pool.assign([front, back], fwd.eye, { dt: DT, frustum: fwd.frustum });
  assert.equal(holder(pool), front);
});

test('a light that goes out releases its spot at once, without a hold', () => {
  const pool = new ShadowPool(new THREE.Group(), 1);
  const a = slot(2);
  const b = slot(5);
  const eye = new THREE.Vector3(0, 1.62, 0);
  pool.assign([a, b], eye, { dt: DT });
  assert.equal(holder(pool), a);
  // Blackout: the level stops offering a (power 0); b takes the spot this same frame.
  pool.assign([b], eye, { dt: DT });
  assert.equal(holder(pool), b);
  assert.equal(a.item.light, null);
});

test('a hand-over fades the old shadow out, then the new one in, in at most 0.6 s and never in one frame', () => {
  const pool = new ShadowPool(new THREE.Group(), 1);
  const a = slot(1);
  const b = slot(9);
  const at = (x: number): THREE.Vector3 => new THREE.Vector3(x, 1.62, 0);
  pool.assign([a, b], at(0), { dt: DT });
  pool.finish();
  assert.equal(pool.states()[0]!.fade, 1, 'the first binding is instant');
  let prev = 1;
  let outStart = -1;
  let inDone = -1;
  for (let i = 0; i < 120; i++) {
    const t = i * DT;
    pool.assign([a, b], at(10), { dt: DT });
    pool.finish();
    const s = pool.states()[0]!;
    // Signed shadow strength: + for a, - for b, so a swap that skipped the fades shows as a jump.
    const signed = s.slot === a ? s.fade : -s.fade;
    assert.ok(Math.abs(signed - prev) <= DT / SHADOW_FADE + 1e-9, `frame ${i}: ${prev} -> ${signed}`);
    prev = signed;
    if (outStart < 0 && s.phase === 'out') outStart = t;
    if (inDone < 0 && s.slot === b && s.phase === 'on') inDone = t;
  }
  assert.ok(outStart >= SHADOW_HOLD - 2 * DT, 'the hold comes first');
  assert.ok(inDone > outStart);
  assert.ok(inDone - outStart <= 0.6, `hand-over took ${(inDone - outStart).toFixed(3)} s`);
  assert.equal(pool.states()[0]!.light.shadow.intensity, 1);
});

test('a side view suspends the pool: spots go dark for its draw, and bindings, fades and maps are untouched', () => {
  const pool = new ShadowPool(new THREE.Group(), 2);
  const a = slot(1);
  const b = slot(3);
  const eye = new THREE.Vector3(0, 1.62, 0);
  pool.assign([a, b], eye, { dt: DT });
  pool.finish();
  for (const l of pool.lights) l.intensity = 5;
  const before = pool.states().map((s) => [s.slot, s.fade, s.phase]);
  for (let i = 0; i < 30; i++) {
    pool.suspend();
    assert.equal(pool.holds(a), false, 'the feed lights a from the fill pool');
    pool.finish();
    assert.ok(pool.lights.every((l) => l.intensity === 0), 'no spot lights the side view');
    pool.assign([a, b], eye, { dt: DT });
    assert.equal(pool.redraws, 0, `frame ${i}: no redraw after a side view`);
    pool.finish();
  }
  assert.deepEqual(pool.states().map((s) => [s.slot, s.fade, s.phase]), before);
  assert.equal(a.item.light, pool.lights[0]);
});

test('cached maps: an idle room redraws once; a caster moving in reach redraws; one leaving gets one clearing redraw', () => {
  const casters = new ShadowCasterSet();
  const pool = new ShadowPool(new THREE.Group(), 1);
  const a = slot(0);
  const eye = new THREE.Vector3(0, 1.62, 0);
  const frame = (): number => {
    pool.assign([a], eye, { dt: DT, casters });
    return pool.redraws;
  };
  assert.equal(frame(), 1, 'first bind draws the map');
  for (let i = 0; i < 10; i++) assert.equal(frame(), 0, 'idle room: no redraws');
  assert.equal(pool.lights[0]!.shadow.autoUpdate, false);

  const pos = new THREE.Vector3(1, 0.9, 0);
  const walker = new ManualCaster((out) => {
    out.center.copy(pos);
    out.radius = 1;
    return true;
  });
  casters.add(walker);
  assert.equal(frame(), 1, 'a caster entering the reach redraws');
  for (let i = 0; i < 5; i++) {
    pos.x += 0.1;
    walker.bump();
    assert.equal(frame(), 1, 'a moving caster in reach redraws every frame');
  }
  assert.equal(frame(), 0, 'a caster standing still does not');
  pos.x = 30;
  walker.bump();
  assert.equal(frame(), 1, 'leaving the reach clears its shadow once');
  for (let i = 0; i < 5; i++) {
    walker.bump();
    assert.equal(frame(), 0, 'moving outside the reach costs nothing');
  }
});

test('a light that moves redraws its map; a rebound spot redraws', () => {
  const pool = new ShadowPool(new THREE.Group(), 1);
  const a = slot(0);
  const eye = new THREE.Vector3(0, 1.62, 0);
  pool.assign([a], eye, { dt: DT });
  pool.assign([a], eye, { dt: DT });
  assert.equal(pool.redraws, 0);
  a.position.x += 0.05; // a swinging fixture
  pool.assign([a], eye, { dt: DT });
  assert.equal(pool.redraws, 1);
  const b = slot(1);
  pool.assign([b], eye, { dt: DT });
  assert.equal(pool.redraws, 1, 'b took the spot: its map is drawn');
});

test('RigidCaster versions follow the world matrix; hidden objects cast nothing', () => {
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  const parent = new THREE.Group();
  parent.add(box);
  const c = new RigidCaster(box);
  const v0 = c.version;
  assert.equal(c.version, v0);
  box.position.x = 2;
  box.updateMatrixWorld();
  assert.notEqual(c.version, v0);
  const s = new THREE.Sphere();
  assert.ok(c.bounds(s));
  assert.ok(Math.abs(s.center.x - 2) < 1e-6);
  box.visible = false;
  assert.equal(c.bounds(s), false);
});

// ---------------------------------------------------------------- light patterns (D7)

const mapsOn = (pool: ShadowPool): number => pool.lights.filter((l) => l.map !== null).length;

test('Two patterned lights on Medium: the higher-ranked shows its pattern, the other casts its shadow plain', () => {
  const pool = new ShadowPool(new THREE.Group(), 2, 1024, 1);
  const near = slot(2, 0, { cookie: 'grille' });
  const far = slot(5, 0, { cookie: 'fan' });
  pool.assign([far, near], new THREE.Vector3(0, 1.62, 0), { dt: DT });
  const byslot = new Map(pool.states().map((s) => [s.slot, s]));
  assert.equal(byslot.get(near)!.patterned, true);
  assert.equal(byslot.get(near)!.light.map, cookieTexture('grille'));
  assert.equal(byslot.get(far)!.patterned, false);
  assert.equal(byslot.get(far)!.light.map, null, 'the second casts its shadow without a pattern');
});

test('a patterned light on a plain spot lights without its pattern; an unpatterned light on a patterned spot gets the white map', () => {
  const plainOnly = new ShadowPool(new THREE.Group(), 1, 1024, 0);
  const grille = slot(2, 0, { cookie: 'grille' });
  plainOnly.assign([grille], new THREE.Vector3(), { dt: DT });
  assert.equal(plainOnly.states()[0]!.slot, grille);
  assert.equal(plainOnly.lights[0]!.map, null);

  const patternedOnly = new ShadowPool(new THREE.Group(), 1, 1024, 1);
  const plain = slot(2);
  patternedOnly.assign([plain], new THREE.Vector3(), { dt: DT });
  assert.equal(patternedOnly.lights[0]!.map, cookieTexture('white'));
});

test('the number of spot maps never changes in play (no material recompiles), only on a tier switch', () => {
  const pool = new ShadowPool(new THREE.Group(), 2, 1024, 1);
  const slots = [slot(-6, 0, { cookie: 'fan' }), slot(-3), slot(3, 0, { cookie: 'cracked' }), slot(6)];
  const eye = new THREE.Vector3();
  assert.equal(mapsOn(pool), 1, 'unbound, the patterned spot already carries its white map');
  for (let t = 0; t < 20; t += DT) {
    eye.x = 8 * Math.sin(t * 0.7);
    pool.assign(t > 10 ? slots.slice(1) : slots, eye, { dt: DT });
    pool.finish();
    assert.equal(mapsOn(pool), 1);
  }
  pool.resize(6, 2048, 2);
  assert.equal(mapsOn(pool), 2, 'High: two patterned spots');
  pool.resize(0, 512, 0);
  assert.equal(mapsOn(pool), 0);
});

test('a fan pattern turns: its spot redraws every frame while a plain one stays cached', () => {
  const pool = new ShadowPool(new THREE.Group(), 2, 1024, 1);
  const fan = slot(1, 0, { cookie: 'fan' });
  const plain = slot(3);
  const eye = new THREE.Vector3();
  pool.assign([fan, plain], eye, { dt: DT });
  const fanSpot = pool.states().find((s) => s.slot === fan)!;
  const plainSpot = pool.states().find((s) => s.slot === plain)!;
  const up0 = fanSpot.light.shadow.camera.up.clone();
  for (let i = 0; i < 10; i++) {
    pool.assign([fan, plain], eye, { dt: DT });
    assert.equal(fanSpot.redrawn, true, 'the turning fan redraws');
    assert.equal(plainSpot.redrawn, false, 'only that spot');
    assert.equal(pool.redraws, 1);
  }
  const up1 = fanSpot.light.shadow.camera.up;
  assert.ok(up0.angleTo(up1) > 0.3, 'the blades have turned');
  assert.ok(Math.abs(up1.y) < 1e-9, 'it turns about the cone axis');
});

test('a patterned light that ends up on a plain spot trades places with an unpatterned light on the patterned spot', () => {
  const pool = new ShadowPool(new THREE.Group(), 2, 1024, 1);
  const plainNear = slot(1);
  const plainFar = slot(4);
  const grille = slot(3, 0, { cookie: 'grille' });
  const eye = new THREE.Vector3();
  pool.assign([plainNear, plainFar], eye, { dt: DT });
  const patternedSpot = pool.states().find((s) => s.patterned)!;
  assert.equal(patternedSpot.slot, plainNear, 'with no patterned light around, the patterned spot lights a plain one');
  // plainFar's room is culled and the grille comes into view: it can only take the freed plain spot ...
  pool.assign([plainNear, grille], eye, { dt: DT });
  // ... and is then swapped onto the patterned spot, both keeping their shadows at full strength.
  assert.equal(patternedSpot.slot, grille);
  assert.equal(patternedSpot.light.map, cookieTexture('grille'));
  const plainSpot = pool.states().find((s) => !s.patterned)!;
  assert.equal(plainSpot.slot, plainNear);
  assert.equal(plainSpot.light.map, null);
  assert.ok(pool.states().every((s) => s.slot === null || s.phase !== 'out'), 'no fade-out for a trade');
  assert.equal(grille.item.light, patternedSpot.light);
  assert.equal(plainNear.item.light, plainSpot.light);
});
