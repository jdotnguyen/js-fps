import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { EventBus } from '../core/events.ts';
import { installFakeWebAudio } from './testing/fakeWebAudio.ts';
import { AudioEngine } from './engine.ts';
import { StoryDucker } from './storyDuck.ts';

let uninstall: () => void;
before(() => {
  uninstall = installFakeWebAudio();
});
after(() => uninstall());

const started = (bus: EventBus, id: string, priority: 'story' | 'hint' | 'combat' | 'idle') =>
  bus.emit('speech:started', { id, speaker: 's', name: 'S', text: '', emote: null, channel: 'local', priority, duration: 2 });
const ended = (bus: EventBus, id: string) => bus.emit('speech:ended', { id, speaker: 's', reason: 'finished' });

test('a 4 dB duck lowers music and ambience to about 0.63x and leaves other buses alone', () => {
  const engine = new AudioEngine();
  engine.setDuck(4);
  for (const b of ['music', 'ambience'] as const) assert.ok(Math.abs(engine.duckGain(b) - 0.631) < 0.001, b);
  for (const b of ['sfx', 'ui', 'voice'] as const) assert.equal(engine.duckGain(b), 1, b);
  engine.setDuck(0);
  assert.equal(engine.duckGain('music'), 1);
});

test('overlapping story lines keep the duck until the last one ends', () => {
  const bus = new EventBus();
  const engine = new AudioEngine();
  new StoryDucker(bus, engine);
  started(bus, 'pa_1', 'story');
  started(bus, 'giles_1', 'story');
  assert.ok(engine.duckGain('music') < 1);
  ended(bus, 'pa_1');
  assert.ok(engine.duckGain('music') < 1, 'still ducked while giles_1 plays');
  ended(bus, 'giles_1');
  assert.equal(engine.duckGain('music'), 1);
});

test('combat, idle and hint lines never duck', () => {
  const bus = new EventBus();
  const engine = new AudioEngine();
  new StoryDucker(bus, engine);
  started(bus, 'bark_1', 'combat');
  started(bus, 'bark_2', 'idle');
  started(bus, 'hint_1', 'hint');
  assert.equal(engine.duckGain('music'), 1);
  assert.equal(engine.duckGain('ambience'), 1);
});

test('a line that ends without starting does not affect the duck; reset restores', () => {
  const bus = new EventBus();
  const engine = new AudioEngine();
  const ducker = new StoryDucker(bus, engine);
  started(bus, 'story_1', 'story');
  ended(bus, 'queued_never_started');
  assert.ok(ducker.ducked);
  ducker.reset();
  assert.equal(engine.duckGain('ambience'), 1);
});

test('story out of earshot leaves the music alone, and ducks once the player can hear it (dialogue-channels)', () => {
  const bus = new EventBus();
  const engine = new AudioEngine();
  const ducker = new StoryDucker(bus, engine);
  bus.emit('speech:started', { id: 'hale_1', speaker: 'director', name: 'Hale', text: '', emote: null, channel: 'local', priority: 'story', duration: 2, audible: false });
  assert.equal(ducker.ducked, false, 'a scene across the station does not duck');
  bus.emit('speech:audible', { id: 'hale_1', priority: 'story', audible: true });
  assert.equal(ducker.ducked, true, 'walked within earshot');
  bus.emit('speech:audible', { id: 'hale_1', priority: 'story', audible: false });
  assert.equal(ducker.ducked, false, 'walked away again');
  bus.emit('speech:ended', { id: 'hale_1', speaker: 'director', reason: 'finished' });
  assert.equal(ducker.ducked, false);
});
