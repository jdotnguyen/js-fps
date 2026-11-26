import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simulateFight, type FightFigures } from './bladeTestKit.ts';

/**
 * The R06 and R11 fights against the blade creature, simulated at fixed seeds (openspec rig-necromorph, task 1.2).
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

  test(`${fight} fight: figures`, async () => {
    const now: Record<string, FightFigures> = {};
    for (const seed of SEEDS) now[seed] = await simulateFight(fight, seed);
    if (process.env['BLADE_FIGHTS'] === 'print') console.log(`[blade] ${fight}`, JSON.stringify(now));
    for (const seed of SEEDS) assert.ok(BASELINE[fight][seed], `baseline for ${fight} ${seed}`);
  });
}
