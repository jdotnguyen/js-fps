import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { validate } from '../core/validate.ts';
import { validateRoomFoley, type RoomFoleyData } from '../data/types/roomFoley.ts';
import type { LoopHandle, VoiceOptions } from './engine.ts';
import { RoomFoleyDirector, type RoomFoleyAudio } from './roomFoley.ts';
import type { SampleName, SoundName } from './sounds.ts';

class MockFoleyAudio implements RoomFoleyAudio {
  readonly plays: Array<{ name: SoundName; opts: VoiceOptions; stoppedWith: number | null }> = [];
  readonly loaded = new Set<SampleName>();

  hasSample(name: SampleName): boolean {
    return this.loaded.has(name);
  }

  play(name: SoundName, opts: VoiceOptions = {}): LoopHandle {
    const rec = { name, opts, stoppedWith: null as number | null };
    this.plays.push(rec);
    return {
      setGain() {},
      stop(fade = 0) {
        rec.stoppedWith = fade;
      },
    };
  }
}

const SAMPLE_DATA: RoomFoleyData = validate(
  validateRoomFoley,
  {
    cues: [
      {
        id: 'admin_type',
        room: 'R14b',
        sound: 'officeType',
        positions: [[40.6, 0.85, 3.9], [45.6, 0.85, 8.1]],
        every: [4, 8],
        gain: 1.2,
        reverb: 0.15,
        rate: [0.94, 1.06],
        phases: ['morning'],
      },
      {
        id: 'transit_rail',
        room: 'R15a',
        sound: 'railCreak',
        positions: [[10, 1.5, 10]],
        every: [6, 10],
        gain: 1.0,
        phases: ['lockdown', 'blackout'],
      },
    ],
  },
  'test',
);

test('RoomFoleyDirector fires positional sfx cues in-range, respects phase gating and talking share', () => {
  const audio = new MockFoleyAudio();
  audio.loaded.add('officeType');
  audio.loaded.add('railCreak');

  const dir = new RoomFoleyDirector(audio, SAMPLE_DATA);
  dir.setMode('playing');

  // Intro not over: stays silent.
  for (let i = 0; i < 20; i++) {
    dir.update(1, { listener: new THREE.Vector3(41, 1.6, 4), phase: 'morning', talking: false, introOver: false });
  }
  assert.equal(audio.plays.length, 0);

  // Morning in Open Office: officeType fires on sfx bus; transit_rail (post-drop) does not.
  for (let i = 0; i < 20; i++) {
    dir.update(1, { listener: new THREE.Vector3(41, 1.6, 4), phase: 'morning', talking: false, introOver: true });
  }
  assert.ok(audio.plays.length > 0);
  assert.ok(audio.plays.every((p) => p.name === 'officeType' && p.opts.bus === 'sfx' && p.opts.position !== undefined));
  const loudAvg = audio.plays.reduce((s, p) => s + (p.opts.gain ?? 0), 0) / audio.plays.length;

  // Talking attenuates newly started cues.
  const beforeTalk = audio.plays.length;
  for (let i = 0; i < 20; i++) {
    dir.update(1, { listener: new THREE.Vector3(41, 1.6, 4), phase: 'morning', talking: true, introOver: true });
  }
  const talkPlays = audio.plays.slice(beforeTalk);
  assert.ok(talkPlays.length > 0);
  const quietAvg = talkPlays.reduce((s, p) => s + (p.opts.gain ?? 0), 0) / talkPlays.length;
  assert.ok(quietAvg < loudAvg * 0.7, 'talking lowers foley gain');

  // After drop (lockdown/blackout): officeType stops permanently; transit_rail fires near R15a.
  const beforeDrop = audio.plays.length;
  for (let i = 0; i < 30; i++) {
    dir.update(1, { listener: new THREE.Vector3(41, 1.6, 4), phase: 'blackout', talking: false, introOver: true });
  }
  assert.equal(audio.plays.length, beforeDrop, 'morning office foley silent under blackout');

  for (let i = 0; i < 25; i++) {
    dir.update(1, { listener: new THREE.Vector3(10, 1.6, 12), phase: 'blackout', talking: false, introOver: true });
  }
  assert.ok(audio.plays.slice(beforeDrop).some((p) => p.name === 'railCreak'));
});

test('RoomFoleyDirector culls cues beyond 24 m and stops handles on title or reset', () => {
  const audio = new MockFoleyAudio();
  audio.loaded.add('officeType');
  const dir = new RoomFoleyDirector(audio, SAMPLE_DATA);
  dir.setMode('playing');

  // Far from R14b: nothing fires.
  for (let i = 0; i < 30; i++) {
    dir.update(1, { listener: new THREE.Vector3(0, 1.6, 0), phase: 'morning', talking: false, introOver: true });
  }
  assert.equal(audio.plays.length, 0);

  // Near R14b, then quit to title: playing handles stop cleanly.
  for (let i = 0; i < 15; i++) {
    dir.update(1, { listener: new THREE.Vector3(41, 1.6, 4), phase: 'morning', talking: false, introOver: true });
  }
  assert.ok(audio.plays.length > 0);
  dir.setMode('title');
  assert.ok(audio.plays.every((p) => p.stoppedWith !== null));
  dir.dispose();
});
