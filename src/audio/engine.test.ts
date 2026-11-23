import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as THREE from 'three';
import { installFakeWebAudio, pathGain, reaches, type FakeAudioContext, type FakeNode } from './testing/fakeWebAudio.ts';
import { AudioEngine, BUS_BASE_LEVELS, UI_SAMPLE_NAMES, UI_SOUND_NAMES, type BusName, type VoiceOptions } from './engine.ts';
import { GLASS_CUTOFF_HZ, GLASS_GAIN_SCALE, OCCLUDED_CUTOFF_HZ, OCCLUDED_GAIN_SCALE, OCCLUDED_REVERB } from './occlusion.ts';
import type { SoundName } from './sounds.ts';

let uninstall: () => void;
before(() => {
  uninstall = installFakeWebAudio();
});
after(() => uninstall());

const BUSES: BusName[] = ['ambience', 'sfx', 'ui', 'music', 'voice'];
const node = (n: unknown) => n as FakeNode;

test('engine exposes five buses, each feeding master and the output', () => {
  const engine = new AudioEngine();
  assert.deepEqual(Object.keys(engine.buses).sort(), [...BUSES].sort());
  for (const b of BUSES) {
    assert.ok(reaches(node(engine.buses[b]), node(engine.master)), `${b} reaches master`);
    assert.ok(reaches(node(engine.buses[b]), node(engine.ctx.destination)), `${b} reaches the output`);
  }
});

test('bus base levels match the tuned mix at 100% volume', () => {
  const engine = new AudioEngine();
  for (const b of BUSES) {
    assert.equal(pathGain(node(engine.buses[b]), node(engine.master)), BUS_BASE_LEVELS[b], b);
  }
});

// --- World sound occlusion (in-world-audio: World sound occlusion) ---

const SOUND: SoundName = 'metalKnock';

/** An engine with one short buffer for SOUND (no full render) and the listener at the origin, eye height. */
function occlusionEngine(): AudioEngine {
  const engine = new AudioEngine();
  const ctx = engine.ctx as unknown as FakeAudioContext;
  (engine as unknown as { buffers: Map<SoundName, unknown[]> }).buffers.set(SOUND, [ctx.createBuffer(1, 800, ctx.sampleRate)]);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.7, 0);
  (engine.ctx.listener as unknown as Record<string, unknown>).setPosition = () => undefined;
  (engine.ctx.listener as unknown as Record<string, unknown>).setOrientation = () => undefined;
  engine.updateListener(camera);
  return engine;
}

interface Voice {
  cutoff: number | null;
  gain: number;
  reverb: number;
}

/** Play SOUND and read back the voice the engine built: its low-pass, its gain node and its reverb send. */
function playAndRead(engine: AudioEngine, opts: VoiceOptions, loop = false): Voice {
  const ctx = engine.ctx as unknown as FakeAudioContext;
  const before = ctx.nodes.length;
  if (loop) engine.loop(SOUND, opts);
  else engine.play(SOUND, opts);
  const made = ctx.nodes.slice(before) as Array<FakeNode & { frequency?: { value: number }; gain?: { value: number } }>;
  const biquad = made.find((n) => n.kind === 'biquad');
  const gains = made.filter((n) => n.kind === 'gain');
  const send = gains.find((n) => n.outputs.has(node(engine.reverbIn)));
  const voiceGain = gains.find((n) => n !== send)!;
  return { cutoff: biquad?.frequency?.value ?? null, gain: voiceGain.gain!.value, reverb: send?.gain?.value ?? 0 };
}

const behind = new THREE.Vector3(-6, 1.5, 0);
const OPTS: VoiceOptions = { bus: 'sfx', position: behind, gain: 0.8, reverb: 0.2 };

test('an occluded positional sfx one-shot is low-passed, quieter and wetter', () => {
  const engine = occlusionEngine();
  const calls: Array<[THREE.Vector3, THREE.Vector3]> = [];
  engine.setOccluder((from, to) => {
    calls.push([from.clone(), to.clone()]);
    return 'wall';
  });
  const v = playAndRead(engine, OPTS);
  assert.equal(v.cutoff, OCCLUDED_CUTOFF_HZ);
  assert.ok(Math.abs(v.gain - 0.8 * OCCLUDED_GAIN_SCALE) < 1e-9, `gain ${v.gain}`);
  assert.equal(v.reverb, OCCLUDED_REVERB);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]![0].toArray(), [0, 1.7, 0], 'tested from the listener position');
  assert.deepEqual(calls[0]![1].toArray(), behind.toArray(), 'tested to the source position');
});

test('ineligible or clear sounds are untouched', () => {
  const engine = occlusionEngine();
  const untouched = (v: Voice, label: string): void => {
    assert.equal(v.cutoff, null, `${label}: no low-pass`);
    assert.equal(v.gain, 0.8, `${label}: gain`);
    assert.equal(v.reverb, 0.2, `${label}: reverb`);
  };
  untouched(playAndRead(engine, OPTS), 'no occluder set');
  engine.setOccluder(() => 'none');
  untouched(playAndRead(engine, OPTS), 'nothing in between');
  engine.setOccluder(() => 'wall');
  untouched(playAndRead(engine, { ...OPTS, occlude: false }), 'occlude: false');
  untouched(playAndRead(engine, { ...OPTS, bus: 'ambience' }), 'ambience bus');
  untouched(playAndRead(engine, { ...OPTS, bus: 'voice' }), 'voice bus');
  untouched(playAndRead(engine, { bus: 'sfx', gain: 0.8, reverb: 0.2 }), 'no position');
  untouched(playAndRead(engine, { ...OPTS, position: new THREE.Vector3(0.3, 1.7, 0.3) }), 'within 0.6 m');
  untouched(playAndRead(engine, OPTS, true), 'loop');
  engine.setOccluder(null);
  untouched(playAndRead(engine, OPTS), 'occluder cleared');
});

test('occlusion combines with muffled and custom cutoffs', () => {
  const engine = occlusionEngine();
  engine.setOccluder(() => 'wall');
  assert.equal(playAndRead(engine, { ...OPTS, muffled: true }).cutoff, OCCLUDED_CUTOFF_HZ, 'muffled 650 Hz becomes 520 Hz');
  assert.equal(playAndRead(engine, { ...OPTS, cutoff: 300 }).cutoff, 300, 'a lower cutoff is kept');
});

test('through glass only, a sound is slightly quieter and duller, far less than through a wall', () => {
  const engine = occlusionEngine();
  engine.setOccluder(() => 'glass');
  const glass = playAndRead(engine, OPTS);
  assert.equal(glass.cutoff, GLASS_CUTOFF_HZ);
  assert.ok(Math.abs(glass.gain - 0.8 * GLASS_GAIN_SCALE) < 1e-9, `gain ${glass.gain}`);
  assert.equal(glass.reverb, 0.2, 'reverb unchanged');
  engine.setOccluder(() => 'wall');
  const wall = playAndRead(engine, OPTS);
  assert.ok(glass.gain > wall.gain && glass.cutoff! > wall.cutoff!, 'glass is louder and brighter than a wall');
  assert.ok(glass.gain < 0.8, 'glass is still a little quieter than the open');
});

test('UI-only boot renders only UI sounds, then renderSoundsAsync finishes the rest in chunks', async () => {
  const engine = new AudioEngine();
  engine.renderSounds(UI_SOUND_NAMES);
  assert.equal(engine.hasSound('uiHover'), true);
  assert.equal(engine.hasSound('uiSelect'), true);
  assert.equal(engine.hasSound('pistolShot'), false, 'gameplay SFX deferred out of shell boot');

  const steps: number[] = [];
  await engine.renderSoundsAsync(undefined, {
    batchSize: 5,
    onProgress: (done, total) => steps.push(done / total),
  });
  assert.equal(engine.hasSound('pistolShot'), true);
  assert.equal(engine.hasSound('footConcrete'), true);
  assert.ok(steps.length > 5);
  assert.equal(steps.at(-1), 1);
});

test('a recorded sample that decodes mid-render is not overwritten by its procedural fallback', async () => {
  const engine = new AudioEngine();
  const ctx = engine.ctx as unknown as FakeAudioContext;
  const recorded = ctx.createBuffer(1, 64, ctx.sampleRate) as unknown as AudioBuffer;
  // Start the render first so its to-do list includes pistolShot, then let the sample land while it yields.
  const render = engine.renderSoundsAsync(undefined, { batchSize: 1 });
  await engine.loadSamples({ names: ['pistolShot'], fetchSample: async () => recorded });
  await render;
  assert.equal(engine.hasSample('pistolShot'), true);
  assert.equal(engine.variantCount('pistolShot'), 1, 'the one recorded take, not the 4 procedural variants');
});

test('loadSamples respects bounded concurrency and skips already loaded samples', async () => {
  const engine = new AudioEngine();
  const ctx = engine.ctx as unknown as FakeAudioContext;
  let active = 0;
  let maxActive = 0;
  const loaded: string[] = [];
  await engine.loadSamples({
    names: UI_SAMPLE_NAMES,
    concurrency: 2,
    fetchSample: async (name) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
      loaded.push(name);
      return ctx.createBuffer(1, 64, ctx.sampleRate) as unknown as AudioBuffer;
    },
  });
  assert.ok(maxActive <= 2, `concurrency capped at 2 (saw ${maxActive})`);
  assert.equal(loaded.length, UI_SAMPLE_NAMES.length);
  for (const name of UI_SAMPLE_NAMES) assert.equal(engine.hasSample(name), true);

  // Calling again does not re-fetch loaded samples.
  let secondCalls = 0;
  await engine.loadSamples({
    names: UI_SAMPLE_NAMES,
    fetchSample: async () => {
      secondCalls++;
      return null;
    },
  });
  assert.equal(secondCalls, 0);
});
