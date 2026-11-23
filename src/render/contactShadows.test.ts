import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONTACT_FADE_HEIGHT, CONTACT_STRENGTH, CONTACT_UNDER_REAL, ContactShadows, contactBodies, type ContactBody, type ContactSample } from './contactShadows.ts';
import { Humanoid } from '../actors/humanoid.ts';
import { ctx } from '../ai/enemyTestKit.ts';
import { ShadowPool } from '../world/shadowPool.ts';

// render-lighting "Characters are grounded" (shadow-rich-rooms D8).

const body = (x: number, y: number, z: number, real = false, radius = 0.45): ContactBody => ({
  contactShadow(out: ContactSample): boolean {
    out.at.set(x, y, z);
    out.radius = radius;
    out.real = real;
    return true;
  },
});

test('a standing body gets a flat disc on the floor under it, sized from its footprint', () => {
  const cs = new ContactShadows();
  cs.update([body(2, 0, -3)]);
  const [d] = cs.discs();
  assert.ok(d);
  assert.equal(cs.mesh.count, 1);
  assert.ok(Math.abs(d.x - 2) < 1e-6 && Math.abs(d.z + 3) < 1e-6);
  assert.ok(d.y > 0 && d.y < 0.02, 'just above the floor, never on a wall');
  assert.equal(d.radius, 0.45);
  assert.equal(d.strength, CONTACT_STRENGTH);
  const m = new THREE.Matrix4();
  cs.mesh.getMatrixAt(0, m);
  const n = new THREE.Vector3(0, 0, 1).transformDirection(m);
  assert.ok(n.y > 0.999, 'the disc faces up');
});

test('the disc sits on a sunken floor and fades as the body leaves it', () => {
  const cs = new ContactShadows();
  const floorY = (): number => -1.2;
  cs.update([body(0, -1.2, 0), body(4, -1.2 + CONTACT_FADE_HEIGHT / 2, 0), body(8, -1.2 + CONTACT_FADE_HEIGHT + 0.1, 0)], { floorY });
  const ds = cs.discs();
  assert.equal(ds.length, 2, 'a body well above the floor (jumping) casts no contact shadow');
  assert.ok(Math.abs(ds[0]!.y - -1.19) < 1e-6);
  assert.ok(ds[1]!.strength < ds[0]!.strength && ds[1]!.strength > 0, 'half way up, half as dark or less');
});

test('under a real shadow the disc weakens to a soft edge; with no real shadow it stays full', () => {
  const cs = new ContactShadows();
  cs.update([body(0, 0, 0, true), body(5, 0, 0, false)], { shadowed: () => true });
  const [real, far] = cs.discs();
  assert.equal(real!.strength, CONTACT_UNDER_REAL);
  assert.equal(far!.strength, CONTACT_STRENGTH, 'beyond the character-shadow distance: no real shadow to double');
});

test('far bodies fade out with camera distance, and hidden bodies show nothing', () => {
  const cs = new ContactShadows();
  const hidden: ContactBody = { contactShadow: () => false };
  cs.update([body(0, 0, 20), body(0, 0, 80), hidden], { camera: new THREE.Vector3(0, 1.6, 0) });
  assert.equal(cs.discs().length, 1);
  assert.equal(cs.discs()[0]!.z, 20);
});

test('a humanoid reports itself: in the scene it registers and grounds, disposed it leaves', () => {
  const h = new Humanoid({ seed: 'contact', outfit: 'crew', role: 'npc' }, ctx());
  const s: ContactSample = { at: new THREE.Vector3(), radius: 0, real: false };
  assert.equal(h.contactShadow(s), false, 'not in a scene yet');
  new THREE.Scene().add(h.group);
  h.group.position.set(3, 0, 1);
  assert.ok(h.contactShadow(s));
  assert.ok(s.at.equals(h.group.position));
  assert.ok(s.radius > 0.3 && s.radius < 0.8);
  assert.ok([...contactBodies].includes(h));
  h.dispose();
  assert.ok(![...contactBodies].includes(h));
});

test('ShadowPool.covers: inside a bound spot\'s cone, not outside it or above it', () => {
  const pool = new ShadowPool(new THREE.Group(), 1);
  const item = { name: 's', light: null, base: 1, pattern: 'steady' as const, seed: 0, emissives: [], emissiveBase: 0, shafts: [], shaftBase: 0, level: 1, power: 1 };
  pool.assign([{ item, position: new THREE.Vector3(0, 2.6, 0), color: new THREE.Color(1, 1, 1), range: 6, priority: 1, shadow: true, kind: 'pendant', score: 0 }], new THREE.Vector3());
  assert.equal(pool.covers(new THREE.Vector3(0.5, 0, 0)), true);
  assert.equal(pool.covers(new THREE.Vector3(8, 0, 0)), false, 'beyond its reach');
  assert.equal(pool.covers(new THREE.Vector3(0, 3, 0)), false, 'above the fixture');
  pool.suspend();
  assert.equal(pool.covers(new THREE.Vector3(0.5, 0, 0)), false);
});
