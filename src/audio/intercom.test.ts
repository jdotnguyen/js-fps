import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as THREE from 'three';
import { installFakeWebAudio, reaches, type FakeAudioContext, type FakeNode } from './testing/fakeWebAudio.ts';
import { AudioEngine } from './engine.ts';
import { INTERCOM_FX, intercomOcclusion, OverloadFollower, overloadAmount } from './intercom.ts';
import { GLASS_CUTOFF_HZ, GLASS_GAIN_SCALE, OCCLUDED_CUTOFF_HZ, OCCLUDED_GAIN_SCALE, SEALED_CUTOFF_HZ, SEALED_GAIN_SCALE } from './occlusion.ts';
import type { SoundName } from './sounds.ts';

// in-world-audio: "A live intercom relays a room", "The intercom clicks and hisses", "The intercom overloads on loud
// sounds" (overhaul-priya-r08-death D25).

let uninstall: () => void;
before(() => {
  uninstall = installFakeWebAudio();
});
after(() => uninstall());

const SOUND: SoundName = 'metalKnock';
const node = (n: unknown) => n as FakeNode;
/** The medical bay is z > 46 in this test; the grille is in the security office. */
const inMedbay = (p: THREE.Vector3): boolean => p.z > 46;
const GRILLE = new THREE.Vector3(-1.4, 1.9, 38.3);

function engineWithIntercom(): AudioEngine {
  const engine = new AudioEngine();
  const ctx = engine.ctx as unknown as FakeAudioContext;
  (engine as unknown as { buffers: Map<SoundName, unknown[]> }).buffers.set(SOUND, [ctx.createBuffer(1, 800, ctx.sampleRate)]);
  engine.addIntercom('medbay', GRILLE, inMedbay);
  return engine;
}

/** Play SOUND and return the nodes the call made (its source first). */
function playAt(engine: AudioEngine, at: THREE.Vector3): FakeNode[] {
  const ctx = engine.ctx as unknown as FakeAudioContext;
  const before = ctx.nodes.length;
  engine.play(SOUND, { bus: 'sfx', position: at, gain: 0.7 });
  return ctx.nodes.slice(before);
}

test('A sound in the source room: a live intercom also carries a positioned sound from its source room', () => {
  const engine = engineWithIntercom();
  engine.setIntercom('medbay', true);
  const made = playAt(engine, new THREE.Vector3(7, 0.8, 51));
  const source = made.find((n) => n.kind === 'source')!;
  const input = node(engine.intercom('medbay')!.input);
  assert.ok(reaches(source, input), 'the tray fall reaches the intercom');
  assert.ok(reaches(input, node(engine.buses.sfx)), 'and the intercom plays it on the sfx bus');
});

test('Not relayed: a positioned sound played with relay false stays off a live intercom (the monitor beep)', () => {
  const engine = engineWithIntercom();
  engine.setIntercom('medbay', true);
  const ctx = engine.ctx as unknown as FakeAudioContext;
  const before = ctx.nodes.length;
  engine.play(SOUND, { bus: 'sfx', position: new THREE.Vector3(-5.2, 1.2, 50.1), gain: 0.7, relay: false });
  const source = ctx.nodes.slice(before).find((n) => n.kind === 'source')!;
  assert.equal(reaches(source, node(engine.intercom('medbay')!.input)), false, 'not on the intercom');
  assert.ok(reaches(source, node(engine.buses.sfx)), 'still heard directly');
});

test('Off: an intercom that is off relays nothing, and a live one ignores sounds outside its rooms', () => {
  const engine = engineWithIntercom();
  const input = node(engine.intercom('medbay')!.input);
  const off = playAt(engine, new THREE.Vector3(7, 0.8, 51)).find((n) => n.kind === 'source')!;
  assert.equal(reaches(off, input), false, 'off');
  engine.setIntercom('medbay', true);
  const outside = playAt(engine, new THREE.Vector3(0, 0.8, 40)).find((n) => n.kind === 'source')!;
  assert.equal(reaches(outside, input), false, 'a sound in the security office is not relayed to itself');
  assert.deepEqual(engine.intercomInputs(new THREE.Vector3(0, 1, 40)), []);
  assert.equal(engine.intercomInputs(new THREE.Vector3(0, 1, 50)).length, 1);
});

test('Switched on / Switched off: a click and static going live, a click going dead, and the crackle bed follows', () => {
  const engine = engineWithIntercom();
  const ctx = engine.ctx as unknown as FakeAudioContext;
  const ic = engine.intercom('medbay')!;
  let before = ctx.nodes.length;
  engine.setIntercom('medbay', true);
  assert.equal(ctx.nodes.slice(before).filter((n) => n.kind === 'source').length, 2, 'click and static burst');
  assert.equal(ic.live, true);
  assert.equal((ic.input as unknown as { gain: { value: number } }).gain.value, 1, 'the mics are open');
  before = ctx.nodes.length;
  engine.setIntercom('medbay', false);
  assert.equal(ctx.nodes.slice(before).filter((n) => n.kind === 'source').length, 1, 'one click');
  assert.equal((ic.input as unknown as { gain: { value: number } }).gain.value, 0, 'the mics are closed');
  assert.equal(ic.relays(new THREE.Vector3(0, 1, 50)), false);
});

test('A scream: a loud input drives the overload up fast; quiet speech barely moves it', () => {
  const f = new OverloadFollower();
  for (let i = 0; i < 10; i++) f.step(0.04, 1 / 60);
  assert.equal(f.value, 0, 'quiet speech is under the overload threshold');
  for (let i = 0; i < 6; i++) f.step(0.35, 1 / 60);
  assert.ok(f.value > 0.9, `scream overload ${f.value.toFixed(2)}`);
  assert.ok(f.drive() > INTERCOM_FX.baseDrive + INTERCOM_FX.overloadDrive * 0.9);
  assert.ok(f.crackle() > INTERCOM_FX.crackleBase * 4, 'crackles harder');
  assert.ok(f.drive() <= INTERCOM_FX.baseDrive + INTERCOM_FX.overloadDrive, 'capped');
});

test('Back to normal: within about 0.5 s of a loud sound ending, the overload has gone', () => {
  const f = new OverloadFollower();
  for (let i = 0; i < 30; i++) f.step(0.4, 1 / 60);
  for (let i = 0; i < 30; i++) f.step(0.02, 1 / 60);
  assert.ok(f.value < 0.05, `after 0.5 s: ${f.value.toFixed(3)}`);
  assert.equal(overloadAmount(0.01), 0);
  assert.equal(overloadAmount(1), 1);
});

test('Heard from the next room: the speaker is muffled and quieter through a wall or closed door, duller through glass, clear in the open', () => {
  const wall = intercomOcclusion('wall');
  const glass = intercomOcclusion('glass');
  const open = intercomOcclusion('none');
  assert.deepEqual(wall, { cutoff: OCCLUDED_CUTOFF_HZ, gain: OCCLUDED_GAIN_SCALE }, 'as any world sound behind a wall');
  assert.deepEqual(glass, { cutoff: GLASS_CUTOFF_HZ, gain: GLASS_GAIN_SCALE });
  assert.deepEqual(intercomOcclusion('sealed'), { cutoff: SEALED_CUTOFF_HZ, gain: SEALED_GAIN_SCALE });
  assert.ok(open.gain === 1 && open.cutoff > 3400, 'in the open the speaker keeps its own band and level');
});

test('The speaker follows the listener: muffled from the start behind a closed door, opening up as the door opens, muffled again when it shuts', () => {
  const engine = engineWithIntercom();
  let between: 'none' | 'glass' | 'wall' = 'wall';
  const asked: THREE.Vector3[] = [];
  engine.setOccluder((_from, to) => (asked.push(to.clone()), between));
  const ic = engine.intercom('medbay')!;
  const speaker = ic as unknown as { occlusionGain: { gain: { value: number } }; occlusionLp: { frequency: { value: number } } };
  engine.setIntercom('medbay', true);
  assert.equal(ic.occlusion, 'wall', 'checked as it goes live, before the first click is heard');
  assert.ok(asked.length > 0 && asked.every((p) => p.distanceTo(GRILLE) < 1e-6), 'from the grille');
  assert.equal(speaker.occlusionGain.gain.value, OCCLUDED_GAIN_SCALE);
  assert.equal(speaker.occlusionLp.frequency.value, OCCLUDED_CUTOFF_HZ);
  // The door slides open: within a check or two the speaker is clear.
  between = 'none';
  ic.update(0.05);
  assert.equal(ic.occlusion, 'wall', 'not re-checked every frame');
  ic.update(0.06);
  assert.equal(ic.occlusion, 'none');
  assert.equal(speaker.occlusionGain.gain.value, 1);
  between = 'wall';
  ic.update(0.11);
  assert.equal(ic.occlusion, 'wall');
  assert.equal(speaker.occlusionGain.gain.value, OCCLUDED_GAIN_SCALE);
  // Off, it stops looking; on again, it looks at once.
  engine.setIntercom('medbay', false);
  const asks = asked.length;
  ic.update(0.5);
  assert.equal(asked.length, asks);
  between = 'glass';
  engine.setIntercom('medbay', true);
  assert.equal(ic.occlusion, 'glass');
});

test('With no occluder (or the listener at the grille) the speaker stays clear', () => {
  const engine = engineWithIntercom();
  const ic = engine.intercom('medbay')!;
  engine.setIntercom('medbay', true);
  ic.update(0.2);
  assert.equal(ic.occlusion, 'none');
});

test('Lab B through the intercom: behind sealed glass a sound is faint and dull, and its intercom copy keeps its full level', () => {
  const engine = engineWithIntercom();
  engine.setOccluder((_from, to) => (to.z > 46 ? 'sealed' : 'none'));
  engine.setIntercom('medbay', true);
  const ctx = engine.ctx as unknown as FakeAudioContext;
  const before = ctx.nodes.length;
  engine.play(SOUND, { bus: 'sfx', position: new THREE.Vector3(2, 1, 51), gain: 0.8, occlude: 'sealed' });
  const made = ctx.nodes.slice(before) as Array<FakeNode & { gain?: { value: number }; frequency?: { value: number } }>;
  const source = made.find((n) => n.kind === 'source')!;
  const input = node(engine.intercom('medbay')!.input);
  const tap = made.find((n) => n.kind === 'gain' && n.outputs.has(input))!;
  assert.ok(source.outputs.has(tap), 'tapped dry, before the low-pass');
  assert.equal(tap.gain!.value, 0.8, 'the relay is not muffled');
  const lowpass = made.find((n) => n.kind === 'biquad')!;
  assert.equal(lowpass.frequency!.value, SEALED_CUTOFF_HZ);
  const direct = [...lowpass.outputs][0] as unknown as { gain: { value: number } };
  assert.ok(Math.abs(direct.gain.value - 0.8 * SEALED_GAIN_SCALE) < 1e-9, `direct ${direct.gain.value}`);
});
