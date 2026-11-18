import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BodyDamage, HERO_BASE_HP, HERO_PROFILE } from './damage.ts';

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

test('a leg that has lost 40% of a part limps and walks slower, and the limp grows toward severing', () => {
  const d = new BodyDamage(100);
  assert.equal(d.locomotion().limp, 0);
  assert.equal(d.locomotion().speedMul, 1);
  d.apply('thigh_R', 10);
  assert.equal(d.locomotion().limp, 0, 'a scratch does not limp');
  d.apply('thigh_R', 10);
  const first = d.locomotion();
  assert.ok(first.limp >= 0.4 && first.limp <= 1, `limp ${first.limp}`);
  assert.equal(first.limpSide, 'R');
  assert.ok(first.speedMul < 1 && first.speedMul >= 0.75);
  assert.equal(first.mode, 'walk');
  d.apply('thigh_R', 10);
  assert.ok(d.locomotion().limp > first.limp, 'worse wound, worse limp');
});

test('one pistol hit to a thigh starts the limp and the next one takes the leg off', () => {
  const d = new BodyDamage(100);
  assert.equal(d.apply('thigh_L', PISTOL).severed, null);
  assert.ok(d.locomotion().limp > 0);
  assert.equal(d.apply('thigh_L', PISTOL).severed, 'thigh_L');
  const loc = d.locomotion();
  assert.equal(loc.mode, 'crawl');
  assert.equal(loc.limp, 0);
  assert.equal(loc.limpSide, null);
  assert.equal(loc.speedMul, 0.55);
});

test('the worse leg decides which side limps', () => {
  const d = new BodyDamage(100);
  d.apply('thigh_L', 20);
  d.apply('thigh_R', 28);
  assert.equal(d.locomotion().limpSide, 'R');
});

test('a tougher body takes more hits before it limps (hero: 400 HP)', () => {
  const d = new BodyDamage(400);
  d.apply('thigh_L', PISTOL * 2);
  assert.equal(d.locomotion().limp, 0, 'two pistol hits do not limp a hero');
  d.apply('thigh_L', PISTOL * 3);
  assert.ok(d.locomotion().limp > 0);
  assert.equal(d.locomotion().mode, 'walk');
});

test('hero: limbs and torso shrug off pistol fire, the weak spot does not', () => {
  const hero = new BodyDamage(HERO_BASE_HP, HERO_PROFILE);
  assert.equal(hero.maxHp.torso, 480);
  const body = hero.apply('torso', PISTOL);
  assert.ok(body.applied < 3, `a body shot takes ${body.applied}`);
  const belly = hero.apply('torso', PISTOL, true);
  assert.equal(belly.region, 'torso');
  assert.equal(belly.weakSpot, true);
  assert.ok(belly.applied >= 10 * body.applied, 'the weak spot takes ten times a body shot');
  // About a dozen pistol shots to the belly kill it.
  let shots = 1;
  while (!hero.dead && shots < 40) {
    hero.apply('torso', PISTOL, true);
    shots++;
  }
  assert.ok(hero.dead && shots >= 10 && shots <= 16, `${shots} belly shots`);
});

test('hero: a thigh takes about sixteen pistol hits to sever', () => {
  const hero = new BodyDamage(HERO_BASE_HP, HERO_PROFILE);
  let shots = 0;
  while (!hero.isSevered('thigh_L') && shots < 40) {
    hero.apply('thigh_L', PISTOL);
    shots++;
  }
  assert.ok(shots >= 14 && shots <= 18, `${shots} hits`);
});

test('crowd bodies keep the ADR-0006 tables', () => {
  const d = new BodyDamage(100);
  assert.equal(d.apply('torso', 20).applied, 10);
  assert.equal(d.apply('torso', 20, true).applied, 20, 'weak spot multiplier 1 without a profile');
});
