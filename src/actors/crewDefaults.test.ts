import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ctx } from '../ai/enemyTestKit.ts';
import type { Animator } from './animator.ts';
import type { BodyModelLibrary } from './bodyModelLibrary.ts';
import { Humanoid, type HumanoidSpec } from './humanoid.ts';
import { readLevel } from '../data/levels/readLevel.ts';

/**
 * The gendered crew defaults (per-character-motion task 6.9, character-motion "Generic crew use a gendered default profile"):
 * crew on female bodies play the feminine default and male bodies the masculine one, each body walking and running one of its
 * default's three takes, picked by its seed; two crew on the same default idle out of phase and at different tempos, and each
 * one's variation is the same every run.
 */

const anim = (h: Humanoid): Animator => h['animator'];
const crew = (seed: string, gender: 'm' | 'f'): Humanoid => new Humanoid({ seed, outfit: 'crew', role: 'npc', gender } as HumanoidSpec, ctx());
const SEEDS = Array.from({ length: 24 }, (_, i) => `crew:mess:${i}`);

test('a mixed room of crew: female bodies play the feminine default, male bodies the masculine one', () => {
  for (const [i, seed] of SEEDS.slice(0, 8).entries()) {
    const g = i % 2 ? 'f' : 'm';
    const h = crew(seed, g);
    const m = anim(h).motion;
    assert.equal(m.profile, g === 'f' ? 'crew_f' : 'crew_m', seed);
    assert.ok(m.isDefault, `${seed} varies as crew`);
    assert.match(m.clips.walk, new RegExp(`^crew_${g}_walk_[abc]$`), `${seed} walks a ${g} take`);
    assert.match(m.clips.jog, new RegExp(`^crew_${g}_jog_[abc]$`), `${seed} runs a ${g} take`);
    h.dispose();
  }
});

test('crew spread over all three takes of each default: a room of crew does not walk alike', () => {
  for (const g of ['m', 'f'] as const) {
    const walks = new Set<string>();
    const jogs = new Set<string>();
    for (const seed of SEEDS) {
      const h = crew(seed, g);
      walks.add(anim(h).motion.clips.walk);
      jogs.add(anim(h).motion.clips.jog);
      h.dispose();
    }
    assert.equal(walks.size, 3, `${g}: ${[...walks].join(', ')}`);
    assert.equal(jogs.size, 3, `${g}: ${[...jogs].join(', ')}`);
  }
});

test('two crew on the same default idle out of phase and at different tempos, the same every run', () => {
  const sample = (seed: string) => {
    const h = crew(seed, 'm');
    for (let i = 0; i < 30; i++) h.update(1 / 30);
    const a = anim(h);
    const out = { phase: a['idlePhase'] as number, tempo: a.tempo, posture: a.posture, walk: a.motion.clips.walk };
    h.dispose();
    return out;
  };
  const a = sample('crew:mess:a');
  const b = sample('crew:mess:b');
  // Out of phase (either way round the loop): seeded start phases, then their own tempos.
  const gap = Math.abs(a.phase - b.phase);
  assert.ok(Math.min(gap, 1 - gap) > 0.03, `idle phases ${a.phase.toFixed(2)} and ${b.phase.toFixed(2)}`);
  assert.notEqual(a.tempo.toFixed(3), b.tempo.toFixed(3), 'different tempos');
  for (const t of [a.tempo, b.tempo]) assert.ok(t > 0.9 && t < 1.1, `tempo within the seeded ±8% (${t.toFixed(3)})`);
  // Seeded by id: the same body built again moves exactly the same way.
  assert.deepEqual(sample('crew:mess:a'), a);
});

test('named characters ignore the crew pools', () => {
  for (const seed of SEEDS.slice(0, 6)) {
    const h = new Humanoid({ seed, outfit: 'crew', role: 'npc', profile: 'okafor' } as HumanoidSpec, ctx());
    assert.equal(anim(h).motion.clips.walk, 'okafor_walk');
    h.dispose();
  }
});

test('the R02 mess room: every generic crew member plays its body\'s default, on a spread of takes, out of step', async () => {
  const level = readLevel('slice01') as { rooms: { id: string; npcs?: { id: string; look: string; pose?: string }[] }[] };
  const table = (await import('../data/body-models.json', { with: { type: 'json' } })).default as unknown as Record<string, { gender: 'm' | 'f' }>;
  const { castSpec } = await import('./castLooks.ts');
  // The bodies' genders as the game reads them (body-models.json); the meshes themselves aren't needed to pick the motion.
  const bodyModels = { table, get: () => undefined } as unknown as BodyModelLibrary;
  const room = level.rooms.find((r) => r.id === 'R02')!;
  const rows: { id: string; gender: string; profile: string; walk: string; phase: number; tempo: number }[] = [];
  for (const npc of room.npcs ?? []) {
    const spec = castSpec(npc.look, npc.id);
    if (spec.profile) continue; // named characters (Bram the cook) have their own motion
    const h = new Humanoid({ ...spec, role: 'npc', pose: npc.pose ?? 'idle' }, { ...ctx(), bodyModels });
    h.update(1 / 30);
    const a = anim(h);
    const gender = spec.model ? table[spec.model]!.gender : 'm';
    rows.push({ id: npc.id, gender, profile: a.motion.profile, walk: a.motion.clips.walk, phase: a['idlePhase'] as number, tempo: a.tempo });
    h.dispose();
  }
  assert.ok(rows.length >= 8, `${rows.length} generic crew in R02`);
  assert.ok(rows.some((r) => r.gender === 'f') && rows.some((r) => r.gender === 'm'), 'the room is mixed');
  for (const r of rows) assert.equal(r.profile, r.gender === 'f' ? 'crew_f' : 'crew_m', `${r.id} (${r.gender} body)`);
  // Not in step: no two crew share a start phase and a tempo; between them they walk more than one take.
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i]!, b = rows[j]!;
    assert.ok(Math.abs(a.phase - b.phase) > 1e-3 || Math.abs(a.tempo - b.tempo) > 1e-3, `${a.id} and ${b.id} move in step`);
  }
  assert.ok(new Set(rows.map((r) => r.walk)).size >= 3, `walks: ${[...new Set(rows.map((r) => r.walk))].join(', ')}`);
});
