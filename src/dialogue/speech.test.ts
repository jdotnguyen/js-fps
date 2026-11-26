import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventBus } from '../core/events.ts';
import { DialogueLibrary } from './library.ts';
import { SpeechManager, type PlayRequest, type VoicePlayer } from './speech.ts';

const speakers: unknown = JSON.parse(readFileSync(new URL('../data/dialogue/speakers.json', import.meta.url), 'utf8'));
const L = (id: string, priority: string, text = 'One two three.', speaker = 'engineer'): Record<string, unknown> => ({
  id, speaker, text, emote: 'neutral', channel: 'local', priority, audio: null, minDuration: 1, choices: [],
});
// 'One two three.' = 3 words -> 1.85 s subtitle.
const library = new DialogueLibrary(speakers, {
  't.json': {
    chapter: 't',
    lines: [L('story_a', 'story'), L('story_b', 'story'), L('hint_a', 'hint'), L('combat_a', 'combat'), L('combat_b', 'combat'), L('idle_a', 'idle'), L('medic_a', 'story', 'Hi.', 'medic'),
      { ...L('pa_notice', 'story', 'Please stand by.', 'pa'), channel: 'pa' }],
  },
});

function setup(): { sm: SpeechManager; log: string[]; plays: PlayRequest[]; stops: Array<[string, boolean]> } {
  const bus = new EventBus();
  const log: string[] = [];
  const plays: PlayRequest[] = [];
  const stops: Array<[string, boolean]> = [];
  const player: VoicePlayer = {
    play(req) {
      plays.push(req);
      return { stop: (interrupted) => stops.push([req.line.id, interrupted]) };
    },
  };
  bus.on('speech:started', (e) => log.push(`start ${e.id}`));
  bus.on('speech:ended', (e) => log.push(`end ${e.id} ${e.reason}`));
  bus.on('speech:dropped', (e) => log.push(`drop ${e.id}`));
  return { sm: new SpeechManager(bus, library, player), log, plays, stops };
}

const run = (sm: SpeechManager, seconds: number, step = 0.05): void => {
  for (let t = 0; t < seconds - 1e-9; t += step) sm.update(step);
};

test('a line plays, shows its subtitle for the ADR duration, then ends', async () => {
  const { sm, log } = setup();
  const h = sm.say('story_a');
  assert.equal(sm.speaking()?.duration, 3 * 0.35 + 0.8);
  run(sm, 1.8);
  assert.deepEqual(log, ['start story_a']);
  run(sm, 0.1);
  assert.deepEqual(log, ['start story_a', 'end story_a finished']);
  assert.equal(await h.done, 'finished');
});

test('a story line interrupts a combat bark (ADR definition of done)', async () => {
  const { sm, log, stops } = setup();
  const bark = sm.say('combat_a');
  run(sm, 0.5);
  sm.say('story_a');
  assert.deepEqual(log, ['start combat_a', 'end combat_a interrupted', 'start story_a']);
  assert.deepEqual(stops, [['combat_a', true]]);
  assert.equal(await bark.done, 'interrupted');
});

test('equal priority queues behind, with a short gap', () => {
  const { sm, log } = setup();
  sm.say('story_a');
  sm.say('story_b');
  assert.deepEqual(sm.queuedIds(), ['story_b']);
  run(sm, 1.9);
  assert.deepEqual(log, ['start story_a', 'end story_a finished']);
  run(sm, 0.25);
  assert.deepEqual(log, ['start story_a', 'end story_a finished', 'start story_b']);
});

test('lower priority waits; hints are never dropped, combat barks are', async () => {
  const { sm, log } = setup();
  sm.say('story_a');
  const hint = sm.say('hint_a');
  const bark = sm.say('combat_a');
  assert.equal(await bark.done, 'dropped', 'would wait > 2 s');
  assert.deepEqual(sm.queuedIds(), ['hint_a']);
  run(sm, 2.2);
  assert.ok(log.includes('start hint_a'));
  run(sm, 2);
  assert.equal(await hint.done, 'finished');
});

test('a short wait is fine for barks; a long one drops them in update', () => {
  const { sm, log } = setup();
  sm.say('combat_a');
  run(sm, 0.5);
  sm.say('combat_b'); // waits ~1.55 s: allowed
  assert.deepEqual(sm.queuedIds(), ['combat_b']);
  sm.say('story_a'); // interrupts combat_a; combat_b now waits behind 1.85 s of story
  run(sm, 2.1);
  assert.ok(log.includes('drop combat_b'));
  assert.ok(!log.includes('start combat_b'));
});

test('higher priority jumps the queue', () => {
  const { sm } = setup();
  sm.say('medic_a'); // 1.15 s, so the idle line's wait stays under 2 s
  sm.say('idle_a');
  sm.say('hint_a');
  assert.deepEqual(sm.queuedIds(), ['hint_a', 'idle_a']);
});

test('saying the same line twice returns the same handle', () => {
  const { sm, plays } = setup();
  const a = sm.say('story_a');
  assert.equal(sm.say('story_a'), a);
  assert.equal(plays.length, 1);
});

test('stopAll clears everything and resolves as stopped', async () => {
  const { sm } = setup();
  const a = sm.say('story_a');
  const b = sm.say('story_b');
  sm.stopAll();
  assert.equal(await a.done, 'stopped');
  assert.equal(await b.done, 'stopped');
  assert.equal(sm.speaking(), null);
});

test('rasp override and babble flag reach the player', () => {
  const { sm, plays } = setup();
  sm.setRasp('engineer', 0.4);
  sm.babble = true;
  sm.say('story_a');
  assert.equal(plays[0]!.rasp, 0.4);
  assert.equal(plays[0]!.babble, true);
  sm.say('medic_a');
  run(sm, 5);
  assert.equal(plays[1]!.rasp, null);
});

test('a long real-audio file extends the line', () => {
  const bus = new EventBus();
  const sm = new SpeechManager(bus, library, { play: () => ({ duration: 4, stop: () => {} }) });
  sm.say('story_a');
  assert.equal(sm.speaking()?.duration, 4);
});

test('a fast recorded VO clip ends on audio duration instead of inflating to the word-count estimate', async () => {
  const bus = new EventBus();
  const longLine = new DialogueLibrary(speakers, {
    't.json': {
      chapter: 't',
      lines: [L('fast_vo', 'story', 'One two three four five six seven eight.')], // subtitleDuration = 3.6 s
    },
  });
  const sm = new SpeechManager(bus, longLine, { play: () => ({ duration: 1.4, stop: () => {} }) });
  const h = sm.say('fast_vo');
  assert.equal(sm.speaking()?.duration, 1.4);
  run(sm, 1.35);
  assert.ok(sm.speaking(), 'still speaking before clip ends');
  run(sm, 0.1);
  assert.equal(sm.speaking(), null, 'ended promptly on recorded audio duration');
  assert.equal(await h.done, 'finished');
});

test('a very short recorded VO clip honors the 0.85 s readability floor and queued lines keep a ~0.15 s breath', () => {
  const bus = new EventBus();
  const started: Array<[string, number]> = [];
  let t = 0;
  bus.on('speech:started', (e) => started.push([e.id, Number(t.toFixed(2))]));
  const sm = new SpeechManager(bus, library, { play: () => ({ duration: 0.4, stop: () => {} }) });
  sm.say('story_a');
  sm.say('story_b');
  assert.equal(sm.speaking()?.duration, 0.85);
  for (let i = 0; i < 25; i++) {
    t += 0.05;
    sm.update(0.05);
  }
  assert.deepEqual(started, [['story_a', 0], ['story_b', 1]], '0.85 s floor + 0.15 s breath = 1.00 s');
});

test('addressee flows from line or say option into SpeechInfo with option winning', () => {
  const bus = new EventBus();
  const seen: Array<string | undefined> = [];
  bus.on('speech:started', (e) => seen.push(e.to));
  const withTo = new DialogueLibrary(speakers, {
    't.json': {
      chapter: 't',
      lines: [{ ...L('dir_a', 'story'), to: 'okafor' }, L('dir_b', 'story')],
    },
  });
  const sm = new SpeechManager(bus, withTo, { play: () => ({ stop: () => {} }) });
  sm.say('dir_a');
  sm.say('dir_b', { to: 'player' });
  run(sm, 3);
  sm.say('dir_a', { to: 'player' });
  run(sm, 3);
  assert.deepEqual(seen, ['okafor', 'player', 'player']);
});

test('an overlap line plays beside a story line without queuing (PA under the squad, intro-sequence spec)', async () => {
  const { sm, log } = setup();
  sm.say('story_a');
  const pa = sm.say('medic_a', { overlap: true });
  assert.deepEqual(sm.queuedIds(), [], 'nothing waits');
  assert.deepEqual(log, ['start story_a', 'start medic_a']);
  assert.equal(sm.speaking()?.id, 'story_a', 'the main lane is unchanged');
  sm.say('story_b');
  assert.deepEqual(sm.queuedIds(), ['story_b'], 'the main queue still works normally');
  run(sm, 1.9);
  assert.equal(await pa.done, 'finished');
  assert.ok(log.includes('end medic_a finished'));
});

test('an overlap line from someone already talking cuts their other line: nobody talks over themself', async () => {
  const { sm, log } = setup();
  const first = sm.say('story_a');
  sm.say('story_b', { overlap: true });
  assert.deepEqual(log, ['start story_a', 'end story_a interrupted', 'start story_b']);
  assert.equal(await first.done, 'interrupted');
});

test('PA and squad subtitles coexist until skipping or quitting stops both voices', async () => {
  const bus = new EventBus();
  const visible = new Set<string>();
  const stops: string[] = [];
  bus.on('subtitle:show', line => visible.add(line.id));
  bus.on('subtitle:hide', line => visible.delete(line.id));
  const sm = new SpeechManager(bus, library, { play: req => ({ stop: () => stops.push(req.line.id) }) });
  const pa = sm.say('pa_notice', { overlap: true });
  const giles = sm.say('story_a');
  assert.deepEqual([...visible], ['pa_notice', 'story_a']);
  assert.deepEqual(stops, []);
  sm.stopAll();
  assert.equal(await pa.done, 'stopped');
  assert.equal(await giles.done, 'stopped');
  assert.deepEqual(new Set(stops), new Set(['pa_notice', 'story_a']));
  assert.equal(visible.size, 0);
});

test('onlySpeakers cuts everyone else off and drops their new lines until lifted (a scene hush)', async () => {
  const { sm, log } = setup();
  const engineer = sm.say('story_a');
  const queued = sm.say('story_b');
  sm.onlySpeakers(['medic']);
  assert.equal(await engineer.done, 'stopped');
  assert.equal(await queued.done, 'stopped');
  assert.equal(await sm.say('combat_a').done, 'dropped', 'a new line from anyone else is dropped');
  assert.ok(log.includes('drop combat_a'));
  const medic = sm.say('medic_a');
  run(sm, 0.3);
  assert.equal(sm.speaking()?.id, 'medic_a', 'the scene\'s own speaker is heard');
  run(sm, 3);
  assert.equal(await medic.done, 'finished');
  sm.onlySpeakers(null);
  sm.say('story_a');
  run(sm, 0.3);
  assert.equal(sm.speaking()?.id, 'story_a', 'everyone back once lifted');
});

test('background PA shows subtitles only within 12 m and audible, hides on leaving, and yields to higher speech', () => {
  const bus = new EventBus();
  const visible = new Set<string>();
  const log: string[] = [];
  bus.on('subtitle:show', (l) => visible.add(l.id));
  bus.on('subtitle:hide', (l) => visible.delete(l.id));
  bus.on('speech:started', (e) => log.push(`start ${e.id}`));
  bus.on('speech:ended', (e) => log.push(`end ${e.id} ${e.reason}`));
  const lib = new DialogueLibrary(speakers, {
    't.json': {
      chapter: 't',
      lines: [
        L('story_a', 'story'),
        { ...L('pa_story', 'story', 'Quarantine notice.', 'pa'), channel: 'pa' },
        { ...L('pa_bg', 'background', 'Stay hydrated.', 'pa'), channel: 'pa' },
      ],
    },
  });
  let paDist = 6;
  let paAudible = true;
  const sm = new SpeechManager(
    bus,
    lib,
    { play: () => ({ stop: () => {} }) },
    {
      hearing: (line) => {
        if (line.channel === 'pa' && line.priority === 'background') {
          return { gain: paAudible ? 0.8 : 0, cutoffHz: 20000, distance: paDist, audible: paAudible };
        }
        return 'everywhere';
      },
    },
  );

  // Within 12 m: background PA subtitle shows, but does not count as foreground speaking().
  sm.say('pa_bg', { channel: 'ambient:pa' });
  assert.ok(visible.has('pa_bg'));
  assert.equal(sm.speaking(), null, 'background PA never holds back barks or idle timers');

  // Walking beyond 12 m hides the subtitle dynamically.
  paDist = 15;
  sm.update(0.1);
  assert.ok(!visible.has('pa_bg'));

  // Walking back in shows it again.
  paDist = 8;
  sm.update(0.1);
  assert.ok(visible.has('pa_bg'));

  // Story line cuts off background PA immediately; story PA stays visible regardless of distance.
  sm.say('story_a');
  assert.ok(!visible.has('pa_bg'));
  assert.ok(log.includes('end pa_bg interrupted'));
  paDist = 40;
  paAudible = false;
  sm.say('pa_story', { overlap: true });
  assert.ok(visible.has('pa_story'), 'story PA shows subtitles station-wide');
});
