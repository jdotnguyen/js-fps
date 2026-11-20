import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { installFakeWebAudio } from './testing/fakeWebAudio.ts';
import { AudioEngine, type BusName } from './engine.ts';
import { applyBusVolumes } from './volume.ts';

let uninstall: () => void;
before(() => {
  uninstall = installFakeWebAudio();
});
after(() => uninstall());

const ALL: BusName[] = ['ambience', 'sfx', 'ui', 'music', 'voice'];
const levels = (e: AudioEngine) => Object.fromEntries(ALL.map((b) => [b, e.busVolume(b)]));

test('voice volume changes only the voice bus', () => {
  const engine = new AudioEngine();
  applyBusVolumes(engine, { musicVolume: 1, sfxVolume: 1, voiceVolume: 1 });
  const before = levels(engine);
  applyBusVolumes(engine, { musicVolume: 1, sfxVolume: 1, voiceVolume: 0 });
  const after = levels(engine);
  for (const b of ALL) assert.equal(after[b], b === 'voice' ? 0 : before[b], b);
});

test('SFX volume covers sfx, ambience and ui; music covers music', () => {
  const engine = new AudioEngine();
  applyBusVolumes(engine, { musicVolume: 0.2, sfxVolume: 0.5, voiceVolume: 1 });
  assert.deepEqual(levels(engine), { ambience: 0.5, sfx: 0.5, ui: 0.5, music: 0.2, voice: 1 });
});

test('bus volume is clamped to 0..1', () => {
  const engine = new AudioEngine();
  engine.setBusVolume('music', 4);
  assert.equal(engine.busVolume('music'), 1);
  engine.setBusVolume('music', -1);
  assert.equal(engine.busVolume('music'), 0);
});
