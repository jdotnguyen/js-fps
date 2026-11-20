import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { installFakeWebAudio, pathGain, reaches, type FakeNode } from './testing/fakeWebAudio.ts';
import { AudioEngine, BUS_BASE_LEVELS, type BusName } from './engine.ts';

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
