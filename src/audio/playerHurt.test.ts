/** The impact of a hit and the low-health bed (player-hit-feedback D7). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Vitals } from '../actors/vitals.ts';
import type { LoopHandle, VoiceOptions } from './engine.ts';
import { IMPACTS, LOW_BED, PlayerHurtAudio } from './playerHurt.ts';
import { SAMPLE_URLS, type SampleName } from './sounds.ts';

function fake() {
  const played: Array<{ name: SampleName; opts: VoiceOptions }> = [];
  const loops = new Map<SampleName, { gain: number; stopped: number | null }>();
  const hurt = new PlayerHurtAudio(
    {
      hasSample: () => true,
      play: (name, opts = {}) => played.push({ name, opts }),
      loop: (name): LoopHandle => {
        const state = { gain: 0, stopped: null as number | null };
        loops.set(name, state);
        return { setGain: (g) => void (state.gain = g), stop: (fade = 0) => void (state.stopped = fade) };
      },
    },
    () => 0.5,
  );
  const sounding = (): string[] => [...loops].filter(([, s]) => s.stopped === null).map(([n]) => n).sort();
  return { hurt, played, loops, sounding };
}

test('each kind of hit lands its own blow at the listener; a grab tick lands none', () => {
  const { hurt, played } = fake();
  hurt.hit('swipe', 0.6);
  hurt.hit('bite', 0.6);
  hurt.hit('slam', 0.6);
  hurt.hit('grab', 0.1);
  assert.deepEqual(played.map((p) => p.name), ['hitClaw', 'hitBite', 'hitSlam']);
  for (const p of played) assert.equal(p.opts.position, undefined);
});

test('every impact and the bed have recordings, several to pick from for each blow', () => {
  for (const name of [...Object.values(IMPACTS).map((i) => i!.name), LOW_BED.heart.name, LOW_BED.breath.name]) {
    const urls = [SAMPLE_URLS[name]].flat();
    for (const url of urls) assert.ok(existsSync(new URL(`../../public/${url}`, import.meta.url)), url);
  }
  assert.equal([SAMPLE_URLS.hitClaw].flat().length, 4);
  assert.equal([SAMPLE_URLS.hitBite].flat().length, 3);
  assert.equal([SAMPLE_URLS.hitSlam].flat().length, 3);
});

test('the heartbeat and breathing start below the low-health line and stop above it or when downed', () => {
  const { hurt, loops, sounding } = fake();
  const vitals = new Vitals(() => ({ playerDamageTaken: 1, bleedOutTime: 20, reviveHp: 40, revivesPerCheckpoint: 1 }));
  hurt.update(vitals.low);
  assert.deepEqual(sounding(), []);
  vitals.damage(75);
  hurt.update(vitals.low);
  hurt.update(vitals.low);
  assert.deepEqual(sounding(), ['jayBreath', 'lowHeartbeat']);
  assert.equal(loops.get('lowHeartbeat')!.gain, LOW_BED.heart.gain);
  assert.ok(LOW_BED.breath.gain < 0.5, 'under dialogue');
  vitals.heal(50); // a medkit
  hurt.update(vitals.low);
  assert.deepEqual(sounding(), []);
  assert.ok(loops.get('lowHeartbeat')!.stopped! > 0, 'faded, not cut');
  vitals.damage(60);
  hurt.update(vitals.low);
  assert.equal(sounding().length, 2);
  vitals.damage(100);
  assert.equal(vitals.state, 'downed');
  hurt.update(vitals.low);
  assert.deepEqual(sounding(), []);
});
