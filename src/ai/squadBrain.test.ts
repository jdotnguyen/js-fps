import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT, KillShare, REVIVE, ReviveJob, SquadTask, TASKS, aimFor, enemyWeight, ladderStage, pickTarget, playerDownIsGameOver, type SquadEnemy, type TargetContext } from './squadBrain.ts';

const P = (x: number, z: number) => ({ x, y: 0, z });
const enemy = (id: string, x: number, z: number, extra: Partial<SquadEnemy> = {}): SquadEnemy => ({ id, position: P(x, z), alive: true, ...extra });
const ctx = (over: Partial<TargetContext> = {}): TargetContext => ({
  me: P(0, 0),
  role: 'engineer',
  player: P(0, 2),
  medic: P(-1, 4),
  engineer: P(0, 0),
  engineerWorking: false,
  current: null,
  canSee: () => true,
  ...over,
});

test('targeting: threats to Jay first, the medic goes for grabbers, unseen or far enemies are ignored', () => {
  const far = enemy('far', 0, -6);
  const nearJay = enemy('nearJay', 1, 0);
  assert.equal(pickTarget([far, nearJay], ctx())?.id, 'nearJay');
  const grabber = enemy('grabber', 3, -5, { grabbing: 'player' });
  assert.equal(pickTarget([nearJay, grabber], ctx({ role: 'medic', me: P(-1, 4) }))?.id, 'grabber');
  assert.equal(pickTarget([enemy('x', 0, -30)], ctx()), null, 'out of range');
  assert.equal(pickTarget([nearJay], ctx({ canSee: () => false })), null, 'no line of sight');
  assert.equal(pickTarget([{ ...nearJay, alive: false }], ctx()), null);
  // A working engineer pulls fire toward whatever is near him.
  const nearGiles = enemy('nearGiles', -6, -1);
  const other = enemy('other', 6, -1);
  assert.equal(pickTarget([other, nearGiles], ctx({ me: P(0, 3), engineer: P(-6, 0), engineerWorking: true, player: P(0, 6) }))?.id, 'nearGiles');
  // Stickiness keeps the current target among equals.
  const a = enemy('a', 4, -4);
  const b = enemy('b', -4, -4);
  assert.equal(pickTarget([a, b], ctx({ current: 'b' }))?.id, 'b');
});

test('support role: Giles aims at legs, Okafor at arms, grabbers get the arms, crawlers the torso', () => {
  assert.equal(aimFor('engineer', enemy('e', 0, 0)), 'legs');
  assert.equal(aimFor('medic', enemy('e', 0, 0)), 'arms');
  assert.equal(aimFor('engineer', enemy('e', 0, 0, { grabbing: 'player' })), 'arms');
  assert.equal(aimFor('engineer', enemy('e', 0, 0, { crawling: true })), 'torso');
});

test('kill-share guard halves squad damage above 35 % and resets after the fight', () => {
  const k = new KillShare();
  assert.equal(k.factor, 1);
  k.record('player');
  k.record('player');
  k.record('squad');
  assert.equal(k.guard, false, '1 of 3 = 33 %');
  k.record('squad');
  assert.equal(k.guard, true, '2 of 4 = 50 %');
  assert.equal(k.factor, 0.5);
  k.record('player');
  k.record('player');
  assert.equal(k.guard, false, '2 of 6 = 33 %: the player caught up');
  k.update(COMBAT.fightGap - 1, false);
  assert.equal(k.player, 4);
  k.update(1.1, false);
  assert.equal(k.player + k.squad, 0, 'a long lull ends the fight');
});

test('tasks pause when threatened, resume, never reset, and report progress; durations match the ADR', () => {
  assert.equal(TASKS['bypass_long']!.duration, 20);
  assert.equal(TASKS['power_restore']!.duration, 30);
  assert.equal(TASKS['biometric']!.duration, 5);
  assert.equal(TASKS['biometric']!.who, 'medic');
  const log: string[] = [];
  const t = new SquadTask('bypass_long', {}, {
    progress: (x) => log.push(`%${Math.round(x.progress * 10)}`),
    paused: () => log.push('paused'),
    resumed: () => log.push('resumed'),
    done: () => log.push('done'),
  });
  let finished = false;
  t.whenDone(() => (finished = true));
  t.update(5, false);
  assert.equal(t.progress, 0, 'no progress while walking to the panel');
  t.arrive();
  for (let i = 0; i < 100; i++) t.update(0.1, false); // 10 s
  assert.ok(Math.abs(t.progress - 0.5) < 1e-6);
  t.update(0.1, true);
  assert.equal(t.state, 'paused');
  for (let i = 0; i < 50; i++) t.update(0.1, true);
  assert.ok(Math.abs(t.progress - 0.5) < 1e-6, 'held while threatened, not reset');
  for (let i = 0; i < 101; i++) t.update(0.1, false);
  assert.equal(t.done, true);
  assert.equal(finished, true);
  assert.deepEqual(log.filter((e) => !e.startsWith('%')), ['paused', 'resumed', 'done']);
  assert.ok(log.includes('%5') && log.includes('%9') && log.at(-2) === '%10');
});

test('revive takes 3 s, a hit pauses it without losing progress', () => {
  const r = new ReviveJob('player');
  assert.equal(r.update(1, false), false, 'walking over');
  r.update(1.5, true);
  r.hit();
  r.update(0.3, true);
  assert.equal(r.progress, 0.5);
  assert.equal(r.paused, true);
  r.update(REVIVE.hitPause, true);
  let done = false;
  for (let i = 0; i < 20 && !done; i++) done = r.update(0.1, true);
  assert.equal(done, true);
});

test('the medic-down rule and enemy target weights', () => {
  assert.equal(playerDownIsGameOver(true), true);
  assert.equal(playerDownIsGameOver(false), false);
  assert.equal(enemyWeight('medic', { reviving: true, working: false, downed: false }), 1.0);
  assert.equal(enemyWeight('medic', { reviving: false, working: false, downed: false }), 0.7);
  assert.equal(enemyWeight('engineer', { reviving: false, working: true, downed: false }), 0.9);
  assert.equal(enemyWeight('engineer', { reviving: false, working: false, downed: false }), 0.6);
});

test('the infection ladder: rasp grows, the laugh goes at the reveal', () => {
  assert.equal(ladderStage(0).rasp, 0);
  assert.ok(ladderStage(2).rasp > 0);
  assert.ok(ladderStage(3).rasp > ladderStage(2).rasp);
  assert.ok(ladderStage(3).gestures.includes('cough'));
  assert.equal(ladderStage(4).laugh, false);
  assert.equal(ladderStage(9).laugh, false);
});
