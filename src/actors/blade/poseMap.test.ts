import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Humanoid } from '../humanoid.ts';
import { castSpec } from '../castLooks.ts';
import { ctx } from '../../ai/enemyTestKit.ts';
import { creatureBody, stepBody } from './bladeTestKit.ts';

/** rig-necromorph task 5.2 (design D4): the creature's pose map. */

const current = (h: Humanoid): string => (h as unknown as { animator: { to: { name: string } } }).animator.to.name;

test('a creature asked for a mapped pose takes its own; a human asked for the same takes the original', async () => {
  const c = await creatureBody('lab_creature');
  c.setPose('stare', 0.01);
  stepBody(c, 2);
  assert.equal(current(c), 'blade_stare');
  const human = new Humanoid({ ...castSpec('voss', 'voss'), role: 'npc', pose: 'idle' }, ctx());
  human.setPose('stare', 0.01);
  assert.equal(current(human), 'stare');
});

test('a creature starts in its own stance, and an unmapped pose is used as it is', async () => {
  const c = await creatureBody('flood_elite');
  assert.equal(current(c), 'blade_stance', 'from its first frame');
  c.setPose('corpseProne', 0.01);
  assert.equal(current(c), 'corpseProne');
});

test('a mapped pose that is missing falls back to the stance with one warning, without throwing', async () => {
  const c = await creatureBody('lab_creature');
  const anim = (c as unknown as { animator: { poseMap: Record<string, string> } }).animator;
  anim.poseMap = { ...anim.poseMap, kill_glass_0: 'blade_not_there' };
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (m: string) => warned.push(m);
  try {
    c.setPose('kill_glass_0', 0.01);
    c.setPose('idle', 0.01);
    c.setPose('kill_glass_0', 0.01);
  } finally {
    console.warn = warn;
  }
  assert.equal(current(c), 'blade_stance');
  assert.equal(warned.filter((m) => m.includes('blade_not_there')).length, 1, 'warned once');
});

test('sequence steps are mapped too, and every mapped pose resolves', async () => {
  const { bladeCreatureProfile } = await import('../bodyModelLibrary.ts');
  const c = await creatureBody('lab_creature');
  for (const [asked, expected] of Object.entries(bladeCreatureProfile().poseMap)) {
    c.setPose(asked, 0.01);
    assert.equal(current(c), expected, `${asked} -> ${expected}`);
  }
  c.playDead('corpseProne');
  c.getUp();
  stepBody(c, 1);
  assert.equal(current(c), 'blade_unfold_0');
});
