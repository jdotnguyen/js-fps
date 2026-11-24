import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../core/validate.ts';
import { Rng } from '../core/rng.ts';
import { validateScoreTable, type ScoreTable } from '../data/types/scores.ts';
import scoresJson from '../data/scores.json' with { type: 'json' };
import { ScorePlayer, type RenderedScore, type ScoreAudio, type StereoPair } from './scorePlayer.ts';
import { MEDBAY_BEAT, MEDBAY_LOOP, renderMedbay } from './scores/medbay.ts';

// adaptive-music: "The medbay score follows the scene", "The medbay score keeps the monitor's time", "Distance to the
// glass drives the glass layer", "Her motif returns in the aftermath" (overhaul-priya-r08-death D31).

const TABLE: ScoreTable = validate(validateScoreTable, scoresJson, 'data/scores.json');
const DEF = TABLE['medbay']!;
const pairOf = (): StereoPair => ({ left: new Float32Array(4), right: new Float32Array(4) });

class Recorder implements ScoreAudio {
  t = 10;
  readonly gains = new Map<string, number>();
  readonly shots: number[] = [];
  private next = 0;
  now(): number {
    return this.t;
  }
  bus() {
    return { setGain: () => {}, release: () => {} };
  }
  layer() {
    const name = DEF.layers[this.next++]!;
    return { setGain: (v: number) => void this.gains.set(name, v), stop: () => void this.gains.delete(name) };
  }
  oneShot(_bus: unknown, _data: StereoPair, _sr: number, _when: number, gain: number): void {
    this.shots.push(gain);
  }
}

async function playing(): Promise<{ audio: Recorder; player: ScorePlayer }> {
  const audio = new Recorder();
  let land: (r: RenderedScore) => void = () => {};
  const player = new ScorePlayer(audio, TABLE, () => new Promise<RenderedScore>((r) => (land = r)), () => {});
  player.cue('medbay', 'enter');
  land({ sampleRate: 8000, layers: Object.fromEntries(DEF.layers.map((l) => [l, pairOf()])), stingers: { stab: [pairOf()] } });
  await Promise.resolve();
  await Promise.resolve();
  return { audio, player };
}

const loud = (audio: Recorder): string[] => [...audio.gains].filter(([, v]) => v > 0.001).map(([k]) => k).sort();

test('Her motif: the priya layer plays through the rescue and not during the kill', async () => {
  const { audio, player } = await playing();
  for (const cue of ['triage', 'sit', 'armory']) {
    player.cue('medbay', cue);
    assert.ok((audio.gains.get('priya') ?? 0) > 0.5, cue);
  }
  for (const cue of ['emerge', 'walk', 'kill:impale', 'kill:slam', 'kill:throw', 'kill:still']) {
    player.cue('medbay', cue);
    assert.equal(audio.gains.get('priya') ?? 0, 0, cue);
  }
});

test('Silence at the fall / Silence at the stare: every layer out, the distance tie off, then the music comes back', async () => {
  const { audio, player } = await playing();
  for (const cue of ['hush', 'kill:noticed']) {
    player.cue('medbay', cue);
    assert.deepEqual(loud(audio), [], cue);
    assert.equal(player.inspect('medbay').distance, false, `${cue}: the glass layer is not held up by the tie`);
    for (let i = 0; i < 20; i++) player.update(0.1, { x: 0, y: 0, z: 45 }, () => ({ x: 0, y: 0, z: 45.7 }));
    assert.deepEqual(loud(audio), [], `${cue}: still silent while the player stands at the glass`);
  }
  player.cue('medbay', 'dread');
  assert.ok(loud(audio).includes('drone'));
  player.cue('medbay', 'walk');
  assert.ok(loud(audio).includes('pulse') && loud(audio).includes('rise'));
});

test('the kill beats cue the score by their own events, and the slams duck it', async () => {
  for (const ev of ['kill:noticed', 'kill:impale', 'kill:slam', 'kill:throw', 'kill:still']) assert.ok(ev in DEF.cues, ev);
  assert.equal(DEF.duck?.event, 'kill:impact');
  assert.ok((DEF.cues['kill:impale']!.layers!['brutal'] ?? 0) > 0.5);
});

test('Her motif is faded out before Okafor speaks in the aftermath', async () => {
  const { audio, player } = await playing();
  player.cue('medbay', 'aftermath');
  assert.ok((audio.gains.get('hold') ?? 0) > 0.5);
  player.cue('medbay', 'aftermath_out');
  player.update(1.2, null, () => null);
  assert.ok((audio.gains.get('hold') ?? 0) < 0.02, 'the motif has stopped before line 20');
});

test('Ends with the intercom: the end cue silences every layer and frees the score', async () => {
  const { audio, player } = await playing();
  player.cue('medbay', 'aftermath');
  assert.ok((audio.gains.get('hold') ?? 0) > 0.5, 'her motif, slowed, in the aftermath');
  player.cue('medbay', 'end');
  assert.deepEqual(loud(audio), []);
  player.update(1.2, null, () => null);
  assert.equal(player.inspect('medbay').state, 'idle');
});

test('Walking up to the glass: the glass layer is louder at the viewing strip than at the back of the room', async () => {
  const { audio, player } = await playing();
  player.cue('medbay', 'triage');
  const glassAt = (z: number): number => {
    for (let i = 0; i < 60; i++) player.update(0.1, { x: 0, y: 0, z }, () => ({ x: 1, y: 1.5, z: 45.72 }));
    return audio.gains.get('glass') ?? 0;
  };
  const back = glassAt(39);
  const strip = glassAt(45.1);
  assert.ok(strip > back + 0.3, `${back} -> ${strip}`);
});

test('One clock: the score beat is the monitor interval, and the rendered loop is whole beats of it', () => {
  assert.equal(DEF.beat, MEDBAY_BEAT);
  assert.ok(Math.abs(MEDBAY_LOOP - DEF.beat * DEF.beatsPerBar * DEF.bars) < 0.01);
  const r = renderMedbay(4000, new Rng('medbay-test'));
  for (const name of DEF.layers) {
    const l = r.layers[name];
    assert.ok(l, name);
    assert.equal(l.left.length, Math.round(4000 * MEDBAY_LOOP), name);
    let energy = 0;
    for (const v of l.left) energy += v * v;
    assert.ok(energy > 0, `${name} is not silent`);
  }
  assert.ok(r.stingers['stab']?.length === 1);
});
