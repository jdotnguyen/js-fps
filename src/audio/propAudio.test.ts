import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { AmbienceAudio } from './ambience.ts';
import type { LoopHandle, VoiceOptions } from './engine.ts';
import { PropAudioController, type WorldSoundLoop } from './propAudio.ts';
import { SOUND_SPECS, type SampleName, type SoundName } from './sounds.ts';

interface MockLoop {
  name: SoundName;
  opts: VoiceOptions;
  gains: number[];
  stoppedWith: number | null;
}

class MockPropAudio implements AmbienceAudio {
  readonly loops: MockLoop[] = [];
  readonly plays: Array<{ name: SoundName; opts: VoiceOptions }> = [];
  readonly loaded = new Set<SampleName>();
  private readonly listeners = new Set<(name: SampleName) => void>();

  hasSound(name: SoundName): boolean {
    return name in SOUND_SPECS || this.loaded.has(name as SampleName);
  }

  hasSample(name: SampleName): boolean {
    return this.loaded.has(name);
  }

  onSampleLoaded(fn: (name: SampleName) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emitSampleLoaded(name: SampleName): void {
    this.loaded.add(name);
    for (const fn of this.listeners) fn(name);
  }

  loop(name: SoundName, opts: VoiceOptions = {}): LoopHandle {
    const rec: MockLoop = { name, opts, gains: [opts.gain ?? 1], stoppedWith: null };
    this.loops.push(rec);
    return {
      setGain: (v: number) => rec.gains.push(v),
      stop: (fade = 0) => {
        rec.stoppedWith = fade;
      },
    };
  }

  play(name: SoundName, opts: VoiceOptions = {}): void {
    this.plays.push({ name, opts });
  }
}

test('PropAudioController starts nearby loops once decoded, scales with mode, and culls by distance', () => {
  const audio = new MockPropAudio();
  const loopSpec: WorldSoundLoop = {
    room: 'R12d',
    sound: 'dehumidifierHum',
    position: new THREE.Vector3(42.8, 1.0, 27.15),
    gain: 0.4,
    maxDist: 12,
    bus: 'ambience',
  };
  const ctrl = new PropAudioController(audio, [loopSpec]);

  // Title mode: silent even when nearby and loaded.
  audio.emitSampleLoaded('dehumidifierHum');
  ctrl.update(new THREE.Vector3(43, 1.6, 27));
  assert.equal(audio.loops.length, 0);

  // Playing mode nearby: loop starts at full gain.
  ctrl.setMode('playing');
  assert.equal(audio.loops.length, 1);
  assert.equal(audio.loops[0]!.name, 'dehumidifierHum');
  assert.ok((audio.loops[0]!.gains.at(-1) ?? 0) > 0.35);

  // Paused mode: the held loop keeps its level (game-pause).
  const full = audio.loops[0]!.gains.at(-1)!;
  ctrl.setMode('paused');
  assert.equal(audio.loops[0]!.gains.at(-1), full);

  // Move far away (> maxDist): loop stops cleanly.
  ctrl.setMode('playing');
  ctrl.update(new THREE.Vector3(0, 1.6, 0));
  assert.ok(audio.loops[0]!.stoppedWith !== null);

  // Return to title & dispose clean up without error.
  ctrl.setMode('title');
  ctrl.dispose();
});

test('PropAudioController hot-starts when ElevenLabs sample finishes decoding and honours active() predicate', () => {
  const audio = new MockPropAudio();
  let running = true;
  const ctrl = new PropAudioController(audio, [
    {
      room: 'R12e',
      sound: 'kettleSimmer',
      position: new THREE.Vector3(40.4, 0.9, 29.3),
      gain: 0.3,
      maxDist: 10,
      bus: 'ambience',
      active: () => running,
    },
  ]);

  ctrl.setMode('playing');
  ctrl.update(new THREE.Vector3(40, 1.6, 28.5));
  assert.equal(audio.loops.length, 0, 'waits until ElevenLabs sample decodes');

  audio.emitSampleLoaded('kettleSimmer');
  assert.equal(audio.loops.length, 1);
  assert.equal(audio.loops[0]!.stoppedWith, null);

  running = false;
  ctrl.update(new THREE.Vector3(40, 1.6, 28.5));
  assert.ok(audio.loops[0]!.stoppedWith !== null, 'stops when active() turns false');

  ctrl.dispose();
});

test('PropAudioController routes world:sfx on sfx bus with position and distance/mode gating', () => {
  const audio = new MockPropAudio();
  audio.emitSampleLoaded('misterSpray');
  const ctrl = new PropAudioController(audio, []);
  const railPos = new THREE.Vector3(44, 4.0, 18.8);

  // Ignored on title screen.
  ctrl.onWorldSfx({ sound: 'misterSpray', position: railPos, gain: 0.5 }, new THREE.Vector3(44, 1.6, 20));
  assert.equal(audio.plays.length, 0);

  // Ignored when far away.
  ctrl.setMode('playing');
  ctrl.onWorldSfx({ sound: 'misterSpray', position: railPos, gain: 0.5, maxDist: 20 }, new THREE.Vector3(0, 1.6, 0));
  assert.equal(audio.plays.length, 0);

  // Plays with sfx bus and position when playing and in range.
  ctrl.onWorldSfx({ sound: 'misterSpray', position: railPos, gain: 0.5, reverb: 0.3 }, new THREE.Vector3(44, 1.6, 20));
  assert.equal(audio.plays.length, 1);
  assert.equal(audio.plays[0]!.name, 'misterSpray');
  assert.equal(audio.plays[0]!.opts.bus, 'sfx');
  assert.deepEqual(audio.plays[0]!.opts.position, railPos);

  ctrl.dispose();
});
