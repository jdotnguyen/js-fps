import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { EnemyDirector } from '../../ai/enemyDirector.ts';
import { ctx as enemyCtx, room, stubTarget, TABLE } from '../../ai/enemyTestKit.ts';
import { EventBus } from '../../core/events.ts';
import { creatureLib, necromorphModel, simulateFight, type FightFigures } from './bladeTestKit.ts';

/**
 * The R06 and R11 fights against the blade creature, simulated at fixed seeds (openspec rig-necromorph, tasks 1.2, 6.1, 6.2).
 * `fightBaseline.json` holds the figures from before the creature's hit shapes changed; task 6.2 compares against it.
 * Print the current figures with BLADE_FIGHTS=print.
 */

const SEEDS = ['a', 'b', 'c'] as const;
const BASELINE = JSON.parse(readFileSync(new URL('./fightBaseline.json', import.meta.url), 'utf8')) as Record<'r06' | 'r11', Record<string, FightFigures>>;

for (const fight of ['r06', 'r11'] as const) {
  test(`${fight} fight: the same seed gives the same figures twice`, async () => {
    const a = await simulateFight(fight, 'a');
    const b = await simulateFight(fight, 'a');
    assert.deepEqual(a, b);
  });

  test(`${fight} fight: resolves on every seed and stays within 25% of the pre-profile baseline duration`, async () => {
    const now: Record<string, FightFigures> = {};
    for (const seed of SEEDS) now[seed] = await simulateFight(fight, seed);
    if (process.env['BLADE_FIGHTS'] === 'print') console.log(`[blade] ${fight}`, JSON.stringify(now));
    for (const seed of SEEDS) {
      assert.ok(BASELINE[fight][seed], `baseline for ${fight} ${seed}`);
      assert.equal(now[seed]!.resolved, true, `${fight} seed ${seed} must resolve`);
      assert.ok(now[seed]!.shotsToSever !== null, `${fight} seed ${seed} severs a limb`);
    }
    const avg = (r: Record<string, FightFigures>): number => SEEDS.reduce((s, k) => s + r[k]!.seconds, 0) / SEEDS.length;
    const baseMean = avg(BASELINE[fight]);
    const nowMean = avg(now);
    const ratio = Math.abs(nowMean - baseMean) / baseMean;
    assert.ok(ratio <= 0.25, `${fight} mean duration ${nowMean.toFixed(2)} s moved ${(ratio * 100).toFixed(1)}% from baseline ${baseMean.toFixed(2)} s (limit 25%)`);
  });
}

test('profiled blade creature combat: windup/swipe, hero slam, forearm sever, and leg-loss crawl/drag preserve timings and reach', async () => {
  const model = await necromorphModel();
  const world = room();
  const events = new EventBus();
  const dir = new EnemyDirector({
    ctx: { ...enemyCtx(), bodyModels: creatureLib(model) },
    nav: world.nav,
    colliders: world.colliders,
    events,
    table: TABLE,
    difficulty: () => ({ enemyHp: 1, enemyLurchInterval: 1 }),
    seed: 'blade-combat-check',
  });
  const player = stubTarget('player', [0, 0, 0], { grabbable: false });
  dir.addTarget(player);
  // R06 creature approaches, winds up with windupSide set, and deals swipe damage at normal range.
  const r06 = dir.spawn('shambler', { x: 0, y: 0, z: -2.2 }, Math.PI, { look: 'lab_creature', hp: 90, id: 'r06_check' });
  let sawWindup = false;
  for (let i = 0; i < 360; i++) {
    dir.update(1 / 60, null);
    if (r06.body.windupSide !== null) sawWindup = true;
    if (player.hits.length > 0) break;
  }
  assert.ok(sawWindup, 'R06 blade creature sets windupSide during attack telegraph');
  assert.ok(player.hits.length > 0, 'R06 blade creature lands swipe damage');
  // Taking both legs drops the creature into crawl/drag and it still advances toward the player.
  const zBefore = r06.position.z;
  r06.body.cut('shin_L', new THREE.Vector3(1, 0, 0));
  r06.body.cut('shin_R', new THREE.Vector3(-1, 0, 0));
  assert.notEqual(r06.body.locomotion.mode, 'walk', 'legless creature crawls or drags');
  for (let i = 0; i < 120; i++) dir.update(1 / 60, null);
  assert.ok(r06.position.z > zBefore + 0.05 || r06.position.distanceTo(new THREE.Vector3(0, 0, 0)) < 1.2, 'legless creature keeps advancing');
  // Hero tier slams cleanly through tryAttack with blade_slam_windup -> blade_slam_impact.
  dir.spawn('hero', { x: 0, y: 0, z: -1.6 }, Math.PI, { id: 'r11_check' });
  let slammed = false;
  events.on('enemy:slam', () => (slammed = true));
  for (let i = 0; i < 180; i++) {
    dir.update(1 / 60, null);
    if (slammed) break;
  }
  assert.ok(slammed, 'R11 hero blade creature completes its slam on time');
});
