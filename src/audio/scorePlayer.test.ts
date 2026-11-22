import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../core/validate.ts';
import { validateScoreTable, type ScoreTable } from '../data/types/scores.ts';
import scoresJson from '../data/scores.json' with { type: 'json' };
import { ScorePlayer, type RenderedScore, type ScoreAudio, type StereoPair } from './scorePlayer.ts';

const pairOf = (): StereoPair => ({ left: new Float32Array(4), right: new Float32Array(4) });

/** Records what the player asks of Web Audio. Gains settle at once. */
class Recorder implements ScoreAudio {
  t = 10;
  readonly starts: Array<{ name: string; when: number }> = [];
  readonly gains = new Map<string, { v: number; tc: number }>();
  readonly shots: Array<{ gain: number; data: StereoPair }> = [];
  bus_ = { v: 0, tc: 0 };
  private next = 0;
  names: string[] = [];
  now(): number {
    return this.t;
  }
  bus() {
    return { setGain: (v: number, tc: number) => (this.bus_ = { v, tc }), release: () => {} };
  }
  layer(_bus: unknown, _data: StereoPair, _sr: number, when: number) {
    const name = this.names[this.next++] ?? `l${this.next}`;
    this.starts.push({ name, when });
    return { setGain: (v: number, tc: number) => this.gains.set(name, { v, tc }), stop: () => this.gains.delete(name) };
  }
  oneShot(_bus: unknown, data: StereoPair, _sr: number, _when: number, gain: number): void {
    this.shots.push({ gain, data });
  }
}

const TABLE: ScoreTable = validate(validateScoreTable, scoresJson, 'data/scores.json');

function setup(table: ScoreTable = TABLE): { audio: Recorder; player: ScorePlayer; land: () => Promise<void>; warns: string[] } {
  const audio = new Recorder();
  const def = table['labB']!;
  audio.names = [...def.layers];
  let resolve: (r: RenderedScore) => void = () => {};
  const warns: string[] = [];
  const player = new ScorePlayer(
    audio,
    table,
    () =>
      new Promise<RenderedScore>((r) => {
        resolve = r;
      }),
    (m) => warns.push(m),
  );
  const land = async (): Promise<void> => {
    resolve({
      sampleRate: 8000,
      layers: Object.fromEntries(def.layers.map((l) => [l, pairOf()])),
      stingers: Object.fromEntries(Object.keys(def.stingers).map((s) => [s, s === 'stab' ? [pairOf(), pairOf()] : [pairOf()]])),
    });
    await Promise.resolve();
    await Promise.resolve();
  };
  return { audio, player, land, warns };
}

test('scores.json validates', () => {
  assert.ok(TABLE['labB']);
});

test('a cue naming an unknown layer or stinger is reported', () => {
  const bad = structuredClone(scoresJson) as { labB: { cues: Record<string, unknown> } };
  bad.labB.cues['kill:arch'] = { layers: { drums: 1 } };
  assert.throws(() => validate(validateScoreTable, bad, 'scores'), /unknown layer "drums"/);
  const bad2 = structuredClone(scoresJson) as { labB: { cues: Record<string, unknown> } };
  bad2.labB.cues['door'] = { stinger: 'boom' };
  assert.throws(() => validate(validateScoreTable, bad2, 'scores'), /unknown stinger "boom"/);
});

test('every layer starts at the same time', async () => {
  const { audio, player, land } = setup();
  player.cue('labB', 'kill:scratch');
  await land();
  assert.equal(audio.starts.length, TABLE['labB']!.layers.length);
  assert.equal(new Set(audio.starts.map((s) => s.when)).size, 1);
});

test('a cue before the render lands is applied when it lands (the latest one)', async () => {
  const { audio, player, land } = setup();
  player.cue('labB', 'kill:scratch');
  player.cue('labB', 'kill:panic');
  assert.equal(player.inspect('labB').state, 'rendering');
  await land();
  assert.equal(player.inspect('labB').cue, 'kill:panic');
  const panic = TABLE['labB']!.cues['kill:panic']!.layers!;
  assert.equal(audio.gains.get('pulse')?.v, panic['pulse']);
  assert.equal(audio.gains.get('heartSlow')?.v, panic['heartSlow']);
});

test('layers a cue leaves out go silent', async () => {
  const { audio, player, land } = setup();
  player.cue('labB', 'kill:arch');
  await land();
  player.cue('labB', 'kill:still');
  assert.equal(audio.gains.get('brutal')?.v, 0);
  assert.equal(audio.gains.get('hold')?.v, TABLE['labB']!.cues['kill:still']!.layers!['hold']);
});

test('the burst cuts every layer to silence within 50 ms', async () => {
  const { audio, player, land } = setup();
  player.cue('labB', 'kill:arch');
  await land();
  player.cue('labB', 'kill:burst');
  for (const l of TABLE['labB']!.layers) {
    const g = audio.gains.get(l)!;
    assert.equal(g.v, 0, l);
    // setTargetAtTime reaches under 1% of the start in about 4.6 time constants.
    assert.ok(g.tc * 4.6 <= 0.05, `${l}: tc ${g.tc}`);
  }
});

test('the burst is a hard cut', () => {
  assert.equal(TABLE['labB']!.cues['kill:burst']!.cut, true);
  assert.equal(TABLE['labB']!.cues['kill:burst']!.layers, undefined);
});

test('stingers alternate their variants and unknown ones warn', async () => {
  const { audio, player, land, warns } = setup();
  player.cue('labB', 'kill:glass');
  await land();
  player.stinger('stab');
  player.stinger('stab');
  player.stinger('stab');
  assert.equal(audio.shots.length, 3);
  assert.notEqual(audio.shots[0]!.data, audio.shots[1]!.data);
  assert.notEqual(audio.shots[1]!.data, audio.shots[2]!.data);
  player.stinger('nope', 'labB');
  assert.ok(warns.some((w) => w.includes('nope')));
});

test('next beat: on the score grid, or now with no score', async () => {
  const { audio, player, land } = setup();
  assert.equal(player.nextBeat(), audio.t);
  player.cue('labB', 'kill:arch');
  await land();
  const start = audio.starts[0]!.when;
  audio.t = start + 1.0; // 1.0 s in: beats at 0.65, 1.3
  assert.ok(Math.abs(player.nextBeat() - (start + 1.3)) < 1e-9);
  assert.ok(player.nextBeat() - audio.t <= 0.65);
});

/** The Lab B score with a distance tie and pound ducking turned on (the shipped score keeps a steady level). */
function withTieAndDuck(): ScoreTable {
  const t = structuredClone(TABLE);
  const s = t['labB']!;
  s.distance = { target: 'door:D_R04_R05', far: 14, near: 3, layers: { voice: [0.2, 0.7], heartFast: [0, 0.6] } };
  s.duck = { event: 'creature:pound', db: -6, hold: 0.6, recover: 0.8 };
  s.cues['kill:creature']!.distance = true;
  s.cues['hold']!.distance = true;
  s.cues['contact']!.distance = false;
  return t;
}

test('distance tie: a tied layer grows as the player nears the target', async () => {
  const { audio, player, land } = setup(withTieAndDuck());
  player.cue('labB', 'kill:creature');
  await land();
  const door = { x: 0, y: 0, z: 0 };
  const at = (d: number): number => {
    for (let i = 0; i < 60; i++) player.update(0.1, { x: d, y: 0, z: 0 }, () => door);
    return audio.gains.get('voice')!.v;
  };
  const far = at(20);
  const mid = at(8);
  const near = at(2);
  assert.ok(far < mid && mid < near, `${far} ${mid} ${near}`);
  assert.ok(Math.abs(near - 0.7) < 0.02);
  player.cue('labB', 'contact');
  assert.equal(player.inspect('labB').distance, false);
  assert.equal(audio.gains.get('voice')!.v, TABLE['labB']!.cues['contact']!.layers!['voice']);
});

test('a duck event dips the score and it recovers', async () => {
  const { audio, player, land } = setup(withTieAndDuck());
  player.cue('labB', 'hold');
  await land();
  player.onEvent('creature:pound');
  const level = TABLE['labB']!.level ?? 1;
  assert.ok(Math.abs(audio.bus_.v - level * Math.pow(10, -6 / 20)) < 1e-9);
  player.update(0.7, null, () => null);
  assert.equal(audio.bus_.v, level);
});

test('restoring after the drop, before contact, resumes in the hold', async () => {
  const { player, land } = setup();
  player.resume({ drop_done: true });
  await land();
  assert.equal(player.inspect('labB').cue, 'hold');
  assert.equal(player.inspect('labB').levels['brutal'], 0);
});

test('no resume before the drop or after contact', () => {
  for (const flags of [{}, { drop_done: true, contact_done: true }]) {
    const { player } = setup();
    player.resume(flags);
    assert.equal(player.inspect('labB').state, 'idle', JSON.stringify(flags));
  }
});

test('the end cue plays the final hit and releases the score', async () => {
  const { audio, player, land } = setup();
  player.cue('labB', 'door');
  await land();
  player.cue('labB', 'end');
  assert.equal(audio.shots.length, 2); // slam, then end
  player.update(4.9, null, () => null);
  assert.equal(player.inspect('labB').state, 'playing');
  player.update(0.2, null, () => null);
  assert.equal(player.inspect('labB').state, 'idle');
  assert.equal(audio.gains.size, 0);
});

test('stopAll during the render drops the late result', async () => {
  const { audio, player, land } = setup();
  player.cue('labB', 'kill:scratch');
  player.stopAll();
  await land();
  assert.equal(player.inspect('labB').state, 'idle');
  assert.equal(audio.starts.length, 0);
});

test('the shipped Lab B score holds a steady level: no distance tie, no ducking', async () => {
  const { audio, player, land } = setup();
  player.cue('labB', 'hold');
  await land();
  const bus = audio.bus_.v;
  player.onEvent('creature:pound');
  for (let i = 0; i < 30; i++) player.update(0.1, { x: i, y: 0, z: 0 }, () => ({ x: 0, y: 0, z: 0 }));
  assert.equal(audio.bus_.v, bus);
  assert.equal(audio.gains.get('voice')!.v, TABLE['labB']!.cues['hold']!.layers!['voice']);
});

test('fadeOutAll fades the score on the audio clock and frees it after; a cue during the fade starts it over', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { audio, player, land } = setup();
  player.cue('labB', 'kill:still');
  await land();
  assert.equal(player.playing, true);
  player.fadeOutAll(3);
  assert.deepEqual(audio.bus_, { v: 0, tc: 0.75 }, 'fades to silence over about 3 s');
  assert.equal(player.playing, false, 'a fading score no longer counts as playing');
  assert.ok(audio.gains.size > 0, 'still sounding during the fade');
  t.mock.timers.tick(3000);
  assert.equal(audio.gains.size, 0, 'freed once the fade is done (no update() needed: the title screen runs none)');

  const again = setup();
  again.player.cue('labB', 'kill:still');
  await again.land();
  again.player.fadeOutAll(3);
  again.player.cue('labB', 'hold');
  t.mock.timers.tick(3000);
  assert.equal(again.player.playing, true, 'cued again during the fade: a fresh score, not released by the old fade');
});
