import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BodyDamage } from './damage.ts';

const PISTOL = 18;

test('part HP follows the ADR table (base 100)', () => {
  const d = new BodyDamage(100);
  assert.equal(d.maxHp.foreArm_L, 30);
  assert.equal(d.maxHp.thigh_R, 35);
  assert.equal(d.maxHp.head, 25);
  assert.equal(d.maxHp.torso, 200);
});

test('two pistol shots sever a forearm; one arm lost lowers grab damage', () => {
  const d = new BodyDamage(100);
  assert.equal(d.apply('foreArm_L', PISTOL).severed, null);
  const r = d.apply('foreArm_L', PISTOL);
  assert.equal(r.severed, 'foreArm_L');
  assert.equal(r.newLimb, 'arm_L');
  const loc = d.locomotion();
  assert.equal(loc.canGrabL, false);
  assert.equal(loc.canGrabR, true);
  assert.equal(loc.grabMul, 0.6);
  assert.equal(loc.mode, 'walk');
});

test('severing a thigh takes the shin with it and makes the body crawl at 55%', () => {
  const d = new BodyDamage(100);
  d.apply('thigh_L', 20);
  const r = d.apply('thigh_L', 20);
  assert.deepEqual(r.lost, ['thigh_L', 'shin_L']);
  assert.ok(d.isSevered('shin_L'));
  const loc = d.locomotion();
  assert.equal(loc.mode, 'crawl');
  assert.equal(loc.speedMul, 0.55);
  // The lost shin can't be damaged any more.
  assert.equal(d.apply('shin_L', 50).applied, 0);
});

test('both legs: drag at 40%', () => {
  const d = new BodyDamage(100);
  d.apply('shin_L', 40);
  d.apply('shin_R', 40);
  const loc = d.locomotion();
  assert.equal(loc.mode, 'drag');
  assert.equal(loc.speedMul, 0.4);
  assert.equal(d.dead, false);
});

test('losing the head blinds but does not kill', () => {
  const d = new BodyDamage(100);
  const r = d.apply('head', 30);
  assert.equal(r.severed, 'head');
  assert.equal(r.killed, false);
  assert.equal(d.locomotion().blind, true);
});

test('three limbs (head counts) kill', () => {
  const d = new BodyDamage(100);
  d.apply('head', 30);
  d.apply('foreArm_R', 40);
  assert.equal(d.dead, false);
  const r = d.apply('shin_L', 40);
  assert.equal(r.killed, true);
  assert.equal(r.killedBy, 'limbs');
});

test('two cuts on the same arm count as one limb', () => {
  const d = new BodyDamage(100);
  d.apply('foreArm_L', 40);
  const r = d.apply('upperArm_L', 40);
  assert.equal(r.newLimb, null);
  assert.equal(d.limbsLost().size, 1);
});

test('torso takes half damage and costs about 3x the ammo of limbs', () => {
  const d = new BodyDamage(100);
  let shots = 0;
  while (!d.dead) {
    d.apply('torso', PISTOL);
    shots++;
  }
  assert.equal(d.causeOfDeath, 'torso');
  // 3 limbs at 2 shots each = 6 shots; torso should be ~3x that or more.
  assert.ok(shots >= 18, `torso took ${shots} shots`);
});

test('no arms: bite only', () => {
  const d = new BodyDamage(100);
  d.apply('upperArm_L', 40);
  d.apply('upperArm_R', 40);
  const loc = d.locomotion();
  assert.equal(loc.biteOnly, true);
  assert.equal(loc.grabMul, 0);
});
