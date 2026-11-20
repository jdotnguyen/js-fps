import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { LoopHandle, VoiceOptions } from './engine.ts';
import type { SoundName } from './sounds.ts';
import { DoorAudio, type DoorAudioEngine } from './doorAudio.ts';

interface PlayedVoice {
  name: SoundName;
  opts: VoiceOptions;
  stoppedWith: number | null;
}

class MockDoorAudioEngine implements DoorAudioEngine {
  readonly played: PlayedVoice[] = [];
  readonly durations = new Map<SoundName, number>();

  hasSound(name: SoundName): boolean {
    return this.durations.has(name);
  }

  durationOf(name: SoundName): number {
    return this.durations.get(name) ?? 0;
  }

  play(name: SoundName, opts: VoiceOptions = {}): LoopHandle {
    const rec: PlayedVoice = { name, opts, stoppedWith: null };
    this.played.push(rec);
    return {
      setGain: () => {},
      stop: (fade = 0) => {
        rec.stoppedWith = fade;
      },
    };
  }
}

test('DoorAudio plays kit-matched open and close clips at the door position', () => {
  const engine = new MockDoorAudioEngine();
  engine.durations.set('doorPressureOpen', 0.95);
  engine.durations.set('doorPressureClose', 0.95);
  engine.durations.set('doorGlassOpen', 0.95);
  engine.durations.set('doorBulkheadOpen', 1.85);

  const doors = new DoorAudio(engine);
  const pos = new THREE.Vector3(3, 1.2, -4);
  doors.onMove({ id: 'D1', kit: 'pressure_slide', dir: 'open', progress: 0, position: pos });
  doors.onMove({ id: 'D2', kit: 'glass_slide', dir: 'open', progress: 0, position: pos });
  doors.onMove({ id: 'D3', kit: 'bulkhead', dir: 'open', progress: 0, position: pos });

  assert.deepEqual(
    engine.played.map((p) => p.name),
    ['doorPressureOpen', 'doorGlassOpen', 'doorBulkheadOpen'],
  );
  assert.equal(engine.played[0]!.opts.position, pos);
  assert.equal(engine.played[0]!.opts.offset, undefined);
});

test('reversing a closing door fades out the close clip and starts open at proportional offset', () => {
  const engine = new MockDoorAudioEngine();
  engine.durations.set('doorPressureOpen', 1.0);
  engine.durations.set('doorPressureClose', 1.0);

  const doors = new DoorAudio(engine);
  const pos = new THREE.Vector3(0, 1.2, 0);
  doors.onMove({ id: 'D1', kit: 'pressure_slide', dir: 'close', progress: 1, position: pos });
  doors.onMove({ id: 'D1', kit: 'pressure_slide', dir: 'open', progress: 0.4, position: pos });

  assert.equal(engine.played.length, 2);
  assert.ok((engine.played[0]!.stoppedWith ?? 0) > 0, 'closing voice should fade out cleanly');
  assert.equal(engine.played[1]!.name, 'doorPressureOpen');
  assert.ok(Math.abs((engine.played[1]!.opts.offset ?? 0) - 0.4) < 0.01);
});

test('door denied enforces cooldown and unlock plays immediately', () => {
  const engine = new MockDoorAudioEngine();
  engine.durations.set('doorDenied', 0.55);
  engine.durations.set('doorUnlocked', 0.75);

  const doors = new DoorAudio(engine);
  const pos = new THREE.Vector3(1, 1.2, 2);
  doors.onDenied('D_lock', pos, 1000);
  doors.onDenied('D_lock', pos, 1100); // within cooldown
  doors.onDenied('D_lock', pos, 1500); // past cooldown
  doors.onUnlocked('D_lock', pos);

  assert.deepEqual(
    engine.played.map((p) => p.name),
    ['doorDenied', 'doorDenied', 'doorUnlocked'],
  );
});

test('stopAll fades and clears active door voices', () => {
  const engine = new MockDoorAudioEngine();
  engine.durations.set('doorBulkheadOpen', 1.8);
  const doors = new DoorAudio(engine);
  doors.onMove({ id: 'D_bh', kit: 'bulkhead', dir: 'open', progress: 0, position: new THREE.Vector3() });
  doors.stopAll(0.2);
  assert.equal(engine.played[0]!.stoppedWith, 0.2);
});
