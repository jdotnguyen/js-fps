/**
 * The train ride against the shipped voice clips (openspec fix-r13d-r16-finale): the real `r15a_train_ride` script,
 * ride controller and speech manager, with each line lasting as long as its MP3. Re-recording a clip so that it no
 * longer fits its slot fails here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ControlStack } from '../actors/control.ts';
import { EventBus, type EventName } from '../core/events.ts';
import type { DialogueLine } from '../data/types/dialogue.ts';
import { DialogueLibrary } from '../dialogue/library.ts';
import { SpeechManager, type VoicePlayer } from '../dialogue/speech.ts';
import { TransitRideController } from '../game/transitRide.ts';
import type { SequenceHost } from './host.ts';
import { SequenceManager } from './runtime.ts';
import { validateSequences } from './schema.ts';

const json = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const climax = 'data/sequences/action_climax.json';
const defs = validateSequences({ [climax]: json(`../${climax}`) }).filter((d) => d.id === 'r15a_train_ride' || d.id === 'r16_arrival_finale');
const library = new DialogueLibrary(json('../data/dialogue/speakers.json'), { 'slice01_action.json': json('../data/dialogue/slice01_action.json') });

/** Seconds of audio in a shipped MP3: its layer III frames, less the info frame and the encoder's gapless trim. */
function mp3Seconds(file: URL): number {
  const b = readFileSync(file);
  const kbpsV1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const kbpsV2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const hz: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  // Skip an ID3v2 tag (its size is four 7-bit bytes).
  let i = b.toString('latin1', 0, 3) === 'ID3' ? 10 + ((b[6]! << 21) | (b[7]! << 14) | (b[8]! << 7) | b[9]!) : 0;
  let seconds = 0;
  while (i + 4 <= b.length) {
    const version = (b[i + 1]! >> 3) & 3;
    const kbps = (version === 3 ? kbpsV1 : kbpsV2)[b[i + 2]! >> 4];
    const rate = hz[version]?.[(b[i + 2]! >> 2) & 3];
    if (b[i] !== 0xff || (b[i + 1]! & 0xe0) !== 0xe0 || ((b[i + 1]! >> 1) & 3) !== 1 || !kbps || !rate) {
      i++;
      continue;
    }
    const samples = version === 3 ? 1152 : 576;
    const bytes = Math.floor(((samples / 8) * kbps * 1000) / rate) + ((b[i + 2]! >> 1) & 1);
    const frame = b.subarray(i, i + bytes);
    const info = Math.max(frame.indexOf('Info'), frame.indexOf('Xing'));
    if (seconds === 0 && info >= 0) {
      // The header frame holds no audio; its encoder tag says how many samples to trim from the two ends.
      const flags = frame.readUInt32BE(info + 4);
      const tag = info + 8 + (flags & 1 ? 4 : 0) + (flags & 2 ? 4 : 0) + (flags & 4 ? 100 : 0) + (flags & 8 ? 4 : 0);
      const [a, mid, c] = [frame[tag + 21]!, frame[tag + 22]!, frame[tag + 23]!];
      seconds -= (((a << 4) | (mid >> 4)) + (((mid & 0x0f) << 8) | c)) / rate;
    } else seconds += samples / rate;
    i += bytes;
  }
  return seconds;
}

const clipSeconds = new Map<string, number>();
function lineSeconds(line: DialogueLine): number {
  let s = clipSeconds.get(line.id);
  if (s === undefined) {
    s = mp3Seconds(new URL(`../../public/${line.audio!}`, import.meta.url));
    assert.ok(s > 0.5, `${line.id}: read its clip length`);
    clipSeconds.set(line.id, s);
  }
  // What the voice player adds around a recording (voicePlayer.ts).
  return s + (line.channel === 'radio' ? 0.16 : 0.08) + (line.channel === 'pa' && line.paChime ? 0.82 : 0);
}

/** Board the train and run until the finale starts. `longer`: extra seconds on a line's clip. */
async function ride(longer: Record<string, number> = {}) {
  const events = new EventBus();
  let now = 0;
  const marks: Array<{ t: number; name: string }> = [];
  const mark = (name: string): void => void marks.push({ t: now, name });
  const player: VoicePlayer = { play: ({ line }) => ({ duration: lineSeconds(line) + (longer[line.id] ?? 0), stop() {} }) };
  const speech = new SpeechManager(events, library, player);
  events.on('speech:started', (e) => mark(`say ${e.id}`));
  events.on('speech:ended', (e) => mark(`${e.reason} ${e.id}`));
  for (const name of ['transit:stage:pullout', 'transit:stage:arrival', 'transit:stage:arrived', 'transit:arrived_r16']) {
    events.on(name as EventName, () => mark(name));
  }
  const control = new ControlStack();
  const base: Partial<SequenceHost> = {
    events: events as unknown as SequenceHost['events'],
    flags: { r11_powered: true, r15a_ready_to_depart: true },
    resolve: () => ({ x: 0, y: 0, z: 0 }),
    warn: (m) => mark(`warn ${m}`),
    pushControl: (over, owner) => control.push(over, owner),
    walkTo: () => Promise.resolve(),
    say: (line, opts) => speech.say(line, opts),
    setLight: (room, pattern) => (mark(`room ${room} ${pattern}`), true),
    sfx: (id) => mark(`sfx ${id}`),
    npc: () => undefined,
    squadRegroup: () => [],
    squadPlaceIn: () => [],
    squadCatchUpIn: () => [],
    inRoom: () => true,
  };
  // Everything the script does that this test does not measure succeeds and does nothing.
  const host = new Proxy(base, { get: (t, k) => (k in t ? t[k as keyof SequenceHost] : () => true) }) as SequenceHost;
  const sequences = new SequenceManager(host, defs);
  const train = new TransitRideController({
    events,
    level: { propState: () => null, setPropTransform: () => true, anchor: () => null },
    player: { body: { x: 48, y: 0.5, z: 38, vy: 0, grounded: true }, yaw: 0, pitch: 0, placeAtEye() {}, applyCamera() {} },
  });
  events.emit('trigger:r15a_boarded' as EventName, {} as never);
  const first = (name: string): number | undefined => marks.find((m) => m.name === name)?.t;
  for (let frame = 1; frame <= 180 * 60 && first('transit:arrived_r16') === undefined; frame++) {
    now = frame / 60;
    sequences.update(1 / 60);
    train.update(1 / 60);
    speech.update(1 / 60);
    await Promise.resolve();
    await Promise.resolve();
  }
  const at = (name: string): number => {
    const t = first(name);
    assert.ok(t !== undefined, `"${name}" happened`);
    return t;
  };
  assert.deepEqual(marks.filter((m) => m.name.startsWith('warn')), []);
  return { marks, at, finale: sequences.isRunning('r16_arrival_finale') };
}

test('the power-loss announcement finishes well before the train reaches R16', async () => {
  const r = await ride();
  const spare = r.at('transit:stage:arrival') - r.at('finished r16_pa_01');
  assert.ok(spare >= 2, `r16_pa_01 ends ${spare.toFixed(1)} s before the hand-off to R16a`);
});

test('Giles answers the lost call just after the announcement says the power is gone', async () => {
  const r = await ride();
  const into = r.at('say r15a_giles_04') - r.at('say r16_pa_01');
  // The recording pauses after "...traction power has been lost." from 4.6 s to 5.2 s.
  assert.ok(into >= 4.6 && into <= 5.3, `Giles starts ${into.toFixed(2)} s into the announcement`);
  assert.ok(r.at('say r15a_giles_04') < r.at('finished r16_pa_01'), 'while it is still going');
  assert.ok(r.at('say r15a_giles_04') - r.at('finished r15a_heins_04') <= 7.5, 'soon after Heins cuts off');
  r.at('finished r15a_giles_04');
});

test('R16 goes dark before the train leaves the bay and nothing lights it on the way', async () => {
  const r = await ride();
  for (const room of ['R16a', 'R16b']) {
    assert.ok(r.at(`room ${room} off`) <= r.at('transit:stage:pullout'), `${room} is off before the pull-out`);
  }
  const lit = r.marks.filter((m) => m.t < r.at('transit:arrived_r16') && /^room R16[ab] (?!off)/.test(m.name));
  assert.deepEqual(lit, []);
});

test('the gate and the arrival line play during the glide, and the finale follows the stop', async () => {
  const r = await ride();
  const [from, to] = [r.at('transit:stage:arrival'), r.at('transit:stage:arrived')];
  assert.ok(r.marks.some((m) => m.name === 'sfx blastGateOpen' && m.t >= from && m.t <= to), 'the R16a gate sounds as it lifts');
  const dock = r.at('say r15a_okafor_03');
  assert.ok(dock >= from && dock <= to, `r15a_okafor_03 is said during the glide (${dock.toFixed(1)} s)`);
  const quiet = r.at('transit:arrived_r16') - to;
  assert.ok(quiet <= 2, `the finale starts ${quiet.toFixed(1)} s after the train stops`);
  assert.equal(r.finale, true);
});

test('an announcement that runs past the arrival never makes the script miss it', async () => {
  const r = await ride({ r16_pa_01: 8 });
  assert.ok(r.at('finished r16_pa_01') > r.at('transit:stage:arrival'), 'the line really is late');
  const ready = Math.max(r.at('transit:stage:arrived'), r.at('finished r15a_okafor_03'));
  const quiet = r.at('transit:arrived_r16') - ready;
  assert.ok(quiet <= 2, `the finale starts ${quiet.toFixed(1)} s after the last arrival line and the stop`);
});
