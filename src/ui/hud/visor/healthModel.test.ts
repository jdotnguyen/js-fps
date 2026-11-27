// visor-hud: health in four segments, the chip trail after damage and the fill-up after a heal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEALTH_SEGMENTS, healthLow, HealthModel, segmentFill } from './healthModel.ts';

const STEP = 1 / 60;

function at(hp: number): HealthModel {
  const m = new HealthModel();
  m.snap(hp);
  return m;
}

function play(m: HealthModel, hp: number, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) m.step(hp, STEP);
}

const near = (actual: number, expected: number, by = 0.5): void => assert.ok(Math.abs(actual - expected) <= by, `${actual} is not within ${by} of ${expected}`);

test('health 60 fills two segments, 40% of the third and none of the fourth', () => {
  const fills = Array.from({ length: HEALTH_SEGMENTS }, (_, i) => segmentFill(60, i));
  assert.equal(fills.length, 4);
  assert.deepEqual([fills[0], fills[1], fills[3]], [1, 1, 0]);
  near(fills[2]!, 0.4, 1e-9);
});

test('the warning colour arrives between 31 and 29', () => {
  assert.equal(healthLow(31), false);
  assert.equal(healthLow(30), true);
  assert.equal(healthLow(29), true);
});

test('a hit leaves a chip that holds, then drains to the new health within about a second', () => {
  const m = at(80);
  m.step(62, STEP);
  assert.equal(m.fill, 62);
  assert.equal(m.chip, 80);
  play(m, 62, 0.35);
  assert.equal(m.chip, 80, 'still holding');
  play(m, 62, 0.3);
  assert.ok(m.chip < 80 && m.chip > 62, `draining: ${m.chip}`);
  play(m, 62, 0.3);
  assert.equal(m.chip, 62);
  assert.equal(m.fill, 62);
});

test('a frozen scene holds the chip where it is', () => {
  const m = at(80);
  play(m, 62, 0.65);
  const chip = m.chip;
  assert.ok(chip > 62 && chip < 80);
  for (let i = 0; i < 600; i++) m.step(62, 0);
  assert.equal(m.chip, chip);
  play(m, 62, 0.5);
  assert.equal(m.chip, 62);
});

test('a second hit during the hold restarts it and keeps the top', () => {
  const m = at(80);
  play(m, 62, 0.3);
  play(m, 50, 0.35);
  assert.equal(m.chip, 80);
  assert.equal(m.fill, 50);
});

test('a second hit during the drain extends the chip from where it stands', () => {
  const m = at(80);
  play(m, 62, 0.65);
  const standing = m.chip;
  m.step(40, STEP);
  assert.equal(m.chip, standing);
  play(m, 40, 0.35);
  assert.equal(m.chip, standing, 'the hold starts again');
  play(m, 40, 0.65);
  assert.equal(m.chip, 40);
});

test('a medkit fills the bar from the old health over half a second and reports +25', () => {
  const m = at(40);
  assert.equal(m.step(65, STEP), 25);
  assert.ok(m.fill > 40 && m.fill < 42);
  play(m, 65, 0.25 - STEP);
  near(m.fill, 52.5, 1);
  assert.equal(m.chip, m.fill, 'a heal shows no chip');
  play(m, 65, 0.3);
  assert.equal(m.fill, 65);
  assert.equal(m.step(65, STEP), 0);
});

test('a small heal still takes a quarter of a second', () => {
  const m = at(90);
  play(m, 95, 0.15);
  assert.ok(m.fill < 95);
  play(m, 95, 0.15);
  assert.equal(m.fill, 95);
});

test('a revive fills up from nothing to the revive health, with no chip left from going down', () => {
  const m = at(20);
  play(m, 0, 0.2);
  assert.equal(m.step(35, STEP), 35);
  assert.ok(m.fill < 2, `starts empty: ${m.fill}`);
  assert.equal(m.chip, m.fill);
  play(m, 35, 0.8);
  assert.equal(m.fill, 35);
});

test('a hit during a fill-up leaves a chip down from the health it had', () => {
  const m = at(40);
  play(m, 90, 0.2);
  m.step(30, STEP);
  assert.equal(m.fill, 30);
  assert.equal(m.chip, 90);
});

test('snapping shows the health with nothing animating', () => {
  const m = at(80);
  m.step(20, STEP);
  m.snap(70);
  assert.equal(m.fill, 70);
  assert.equal(m.chip, 70);
  assert.equal(m.step(70, STEP), 0);
});
