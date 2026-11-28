import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { EARSHOT_LEVEL, OCCLUDED_CUTOFF_HZ, VOICE_CLOSED_DOOR_GAIN, voiceAudibility, wallOccluder, type Occlusion } from '../audio/occlusion.ts';
import { frictionOf, GLASS_FRICTION } from '../physics/world.ts';
import { labBKill } from './labBKillTestKit.ts';

/**
 * Lab B behind its sealed observation glass (voss-death-scene §7, design D12), on the headless slice01 with one played
 * kill: in-world-audio "Sealed observation glass muffles hard" and voice-playback "Voss behind the sealed glass".
 */

/** Jay's eye: before the middle pane, at the west end of the glass, and back in the gallery. */
const LISTENERS = [new THREE.Vector3(8, 1.62, 19.6), new THREE.Vector3(4, 1.62, 20.8), new THREE.Vector3(12.5, 1.62, 16.5)];

interface Spurt {
  kind: string;
  clip: { axis: string; at: number; keep: string } | undefined;
}

async function played() {
  const g = await labBKill({ creature: true });
  const occluder = wallOccluder((...ray) => g.level.collision.raycast(...ray));
  const sounds: Array<{ id: string; at: THREE.Vector3; heard: Occlusion[] }> = [];
  const gore: Spurt[] = [];
  const world = (g.npcs.kills as unknown as { w: { sfx: (ids: readonly string[], at: THREE.Vector3) => boolean; ctx: { gore: unknown } } }).w;
  world.sfx = (ids, at) => {
    const p = new THREE.Vector3(at.x, at.y, at.z);
    // Heard as the game plays a kill sound: only sealed glass muffles it (`session.ts`).
    sounds.push({ id: ids[0]!, at: p, heard: LISTENERS.map((l) => occluder(l, p, true)) });
    return true;
  };
  // Which argument of each gore call is its clip plane.
  const CLIP_ARG: Record<string, number> = { burst: 4, chunks: 3, spurt: 5 };
  world.ctx = { ...world.ctx, gore: new Proxy({}, { get: (_t, kind: string) => (...args: unknown[]) => void (kind in CLIP_ARG && gore.push({ kind, clip: args[CLIP_ARG[kind]!] as Spurt['clip'] })) }) };
  g.start();
  g.run(1.5);
  g.ask();
  g.run(34);
  return { g, occluder, sounds, gore };
}

const run = await played();
const sealed = run.g.level.collision.colliders.filter((c) => c.acoustic === 'sealed');

test('Lab B\'s observation glass is sealed, and no other pane in the slice is', () => {
  assert.deepEqual(
    sealed.map((c) => [c.minX, c.maxX, c.minZ, c.maxZ]).sort((a, b) => a[0]! - b[0]!),
    [[2, 6, 21.75, 22], [6, 10, 21.75, 22], [10, 14, 21.75, 22]],
    'the three panes of the gallery\'s south wall',
  );
  assert.ok(run.g.level.collision.colliders.filter((c) => c.acoustic === 'glass').length > 0, 'the other partitions are ordinary glass');
});

test('a sealed pane is still glass for everything but sound: its friction, and rounds stop on it', () => {
  for (const c of sealed) assert.equal(frictionOf(c), GLASS_FRICTION);
  assert.ok(run.g.level.glassAt({ x: 8, y: 1.5, z: 21.75 }));
});

test('a sealed pane still clips gore: nothing sprayed in her kill crosses to Jay\'s side', () => {
  const clipped = run.gore.filter((c) => c.clip);
  assert.ok(clipped.some((c) => c.kind === 'burst') && clipped.some((c) => c.kind === 'chunks'), 'the burst sprays and throws chunks');
  for (const c of clipped) assert.deepEqual([c.clip!.axis, c.clip!.keep, Math.round(c.clip!.at * 100) / 100], ['z', 'above', 21.86]);
  assert.deepEqual(run.gore.filter((c) => c.kind !== 'spurt' && !c.clip), [], 'no burst or chunks without the pane\'s clip');
});

test('in-world-audio "Scripted kill behind sealed glass": her kill\'s sounds are muffled as sealed glass muffles, except those made on the pane', () => {
  // (She falls back from the glass after the burst: her body never strikes it.)
  const ON_PANE = ['palm_glass_hit', 'creature_glass_hit', 'blood_splat_glass'];
  for (const id of ON_PANE) assert.ok(run.sounds.some((s) => s.id === id), `${id} played`);
  for (const s of run.sounds.filter((s) => ON_PANE.includes(s.id))) {
    assert.deepEqual(s.heard, ['none', 'none', 'none'], `${s.id} at ${s.at.toArray().map((v) => v.toFixed(2))}: on the pane, heard as authored`);
  }
  for (const id of ['body_bench_hit', 'bench_sweep', 'cart_crash', 'kill_burst']) {
    const s = run.sounds.find((q) => q.id === id);
    assert.ok(s, `${id} played`);
    assert.deepEqual(s.heard, ['sealed', 'sealed', 'sealed'], `${id}: from the room, through the pane`);
  }
});

test('voice-playback "Voss behind the sealed glass": her direct voice reaches the gallery at least as muffled as through a closed door, still within earshot', () => {
  for (const from of [run.g.anchor('labb_victim').setY(1.6), new THREE.Vector3(8, 1.6, 22.4)]) {
    for (const to of LISTENERS) {
      const path = run.g.level.voicePath(from, to)!;
      assert.deepEqual([path.boundaries, path.closedDoors, path.glass], [1, 1, 0]);
      const a = voiceAudibility(path);
      assert.equal(a.cutoffHz, OCCLUDED_CUTOFF_HZ);
      assert.ok(a.gain <= VOICE_CLOSED_DOOR_GAIN, `gain ${a.gain}`);
      assert.ok(a.level >= EARSHOT_LEVEL, `level ${a.level}: her line is voiced and subtitled even with the intercom off`);
    }
  }
});

test('R08\'s window is unchanged: a voice crosses it as through glass', () => {
  const path = run.g.level.voicePath(new THREE.Vector3(0, 1.6, 49), new THREE.Vector3(0, 1.6, 42));
  assert.deepEqual([path?.closedDoors, path?.glass], [0, 1]);
});
