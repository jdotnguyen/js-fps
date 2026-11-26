import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import type { LoopHandle, VoiceOptions } from './engine.ts';
import { SOUND_SPECS, type SampleName, type SoundName } from './sounds.ts';
import { AMBIENCE_PRESETS, AmbienceDirector, isAmbiencePreset, resolveAmbience, type AmbienceAudio } from './ambience.ts';

interface MockLoop {
  name: SoundName;
  opts: VoiceOptions;
  gains: number[];
  stoppedWith: number | null;
}

class MockAmbienceAudio implements AmbienceAudio {
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

test('every ambience id authored in slice01.json resolves to an explicit preset', () => {
  const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, '../data/levels/slice01.json'), 'utf8')) as {
    rooms: Array<{ id: string; atmosphere?: { ambience?: string } }>;
  };
  const ids = new Set<string>();
  for (const room of raw.rooms) {
    if (room.atmosphere?.ambience) ids.add(room.atmosphere.ambience);
  }
  assert.ok(ids.size >= 8, `expected authored ambience presets in slice01.json, found ${ids.size}`);
  for (const id of ids) {
    assert.ok(isAmbiencePreset(id), `slice01 ambience "${id}" missing from AMBIENCE_PRESETS`);
  }
  assert.equal(resolveAmbience(undefined), 'hull_hum');
  assert.equal(resolveAmbience('none'), 'silent');
});

test('room transitions crossfade beds cleanly without stacking active loops', () => {
  const audio = new MockAmbienceAudio();
  audio.emitSampleLoaded('ambHullHum');
  audio.emitSampleLoaded('ambFlooded');
  audio.emitSampleLoaded('waterRumble');

  const dir = new AmbienceDirector(audio, new Rng('amb-test'));
  dir.setMode('playing');
  dir.enterRoom('hull_hum', [], 1.5);

  assert.equal(dir.currentPreset, 'hull_hum');
  assert.equal(audio.loops.length, 2);
  assert.equal(audio.loops[0]!.name, 'ambHullHum');
  assert.equal(audio.loops[1]!.name, 'waterRumble');
  assert.equal(audio.loops[0]!.stoppedWith, null);

  dir.enterRoom('water_drip', [], 1.5);
  assert.equal(dir.currentPreset, 'water_drip');
  assert.equal(audio.loops[0]!.stoppedWith, 1.5);
  assert.equal(audio.loops[1]!.stoppedWith, 1.5);
  const active = audio.loops.filter((l) => l.stoppedWith === null);
  assert.equal(active.length, 2);
  assert.equal(active[0]!.name, 'ambFlooded');
});

test('fallback beds hot-swap to recorded ElevenLabs samples once decoded', () => {
  const audio = new MockAmbienceAudio();
  const dir = new AmbienceDirector(audio, new Rng('swap-test'));
  dir.setMode('playing');
  dir.enterRoom('office_hvac');

  // Before ambOfficeHvac decodes, it starts on the procedural roomTone fallback.
  assert.equal(audio.loops[0]!.name, 'roomTone');
  assert.equal(audio.loops[0]!.stoppedWith, null);

  // When the ElevenLabs bed finishes decoding, it crossfades out the fallback and swaps in the sample.
  audio.emitSampleLoaded('ambOfficeHvac');
  assert.equal(audio.loops[0]!.stoppedWith, 1.0);
  const active = audio.loops.filter((l) => l.stoppedWith === null);
  assert.ok(active.some((l) => l.name === 'ambOfficeHvac'));
});

test('game mode silences ambience on title, ducks on pause, and suppresses non-playing one-shots', () => {
  const audio = new MockAmbienceAudio();
  const dir = new AmbienceDirector(audio, new Rng('mode-test'));
  dir.enterRoom('water_drip');

  // Title mode: initial target gain is 0 and stepping time fires no one-shots.
  assert.equal(audio.loops[0]!.gains.at(-1), 0);
  for (let t = 0; t < 40; t += 1) dir.update(t, new THREE.Vector3(0, 1.6, 0));
  assert.equal(audio.plays.length, 0);

  // Playing mode: gain rises and drips/groans begin firing spatially.
  dir.setMode('playing');
  assert.ok((audio.loops[0]!.gains.at(-1) ?? 0) > 0.3);
  for (let t = 40; t < 80; t += 1) dir.update(t, new THREE.Vector3(2, 1.6, -3));
  assert.ok(audio.plays.length > 0);
  assert.ok(audio.plays.every((p) => p.opts.bus === 'ambience' && p.opts.position !== undefined));

  // Paused mode: bed ducks down smoothly.
  const fullGain = audio.loops[0]!.gains.at(-1)!;
  dir.setMode('paused');
  const pausedGain = audio.loops[0]!.gains.at(-1)!;
  assert.ok(pausedGain > 0 && pausedGain < fullGain * 0.5);
});

test('scripted override wins over room changes until cleared', () => {
  const audio = new MockAmbienceAudio();
  const dir = new AmbienceDirector(audio, new Rng('override-test'));
  dir.setMode('playing');
  dir.enterRoom('hull_hum');
  dir.setOverride('silent');
  assert.equal(dir.currentPreset, 'silent');
  assert.equal(audio.loops.filter((l) => l.stoppedWith === null).length, 0);

  // Walking into another room keeps the scripted override.
  dir.enterRoom('pipes_knock');
  assert.equal(dir.currentPreset, 'silent');

  // Clearing override restores the room's preset.
  dir.setOverride(null);
  assert.equal(dir.currentPreset, 'pipes_knock');
  assert.equal(audio.loops.filter((l) => l.stoppedWith === null).length, AMBIENCE_PRESETS.pipes_knock.beds.length);
});

test('lamps never buzz: only the fluorescent fixtures in a room with ceiling lights and a lamp get buzz loops', () => {
  const audio = new MockAmbienceAudio();
  const dir = new AmbienceDirector(audio, new Rng('lamp-buzz'));
  dir.setMode('playing');
  const tube = new THREE.Vector3(1, 3.5, 2);
  const lamp = new THREE.Vector3(4, 2, 2);
  dir.enterRoom('hull_hum', [
    { position: tube, light: { level: 1, pattern: 'steady' }, kind: 'ceiling' },
    { position: lamp, light: { level: 1, pattern: 'flicker' }, kind: 'pendant' },
  ]);
  const buzz = audio.loops.filter((l) => l.name === 'fluorescentBuzz');
  assert.equal(buzz.length, 1, 'one buzzer, for the ceiling tube');
  dir.dispose();
});

test('in-world-audio "Power sounds": on backup power the tubes fall silent and the lit backup lamp hums from its position', () => {
  const audio = new MockAmbienceAudio();
  const dir = new AmbienceDirector(audio, new Rng('backup-hum'));
  dir.setMode('playing');
  const tube = { level: 1, pattern: 'steady', power: 1 };
  const beacon = { level: 0, pattern: 'steady', power: 1 };
  const lamp = new THREE.Vector3(3, 2.7, 1);
  const lights = [
    { position: new THREE.Vector3(1, 3, 1), light: tube, kind: 'ceiling' },
    { position: lamp, light: beacon, kind: 'emergency' },
  ];
  dir.enterRoom('hull_hum', lights);
  assert.equal(audio.loops.filter((l) => l.name === 'backupHum').length, 0, 'no hum on main power');
  // The mains fail: the tube goes out, the beacon comes on dim.
  Object.assign(tube, { level: 0, power: 0 });
  Object.assign(beacon, { level: 0.25, power: 0.25 });
  dir.rebindLights(lights);
  assert.equal(audio.loops.filter((l) => l.name === 'backupHum').length, 0, 'the hum waits for its recording');
  audio.emitSampleLoaded('backupHum');
  const hum = audio.loops.filter((l) => l.name === 'backupHum' && l.stoppedWith === null);
  assert.equal(hum.length, 1);
  assert.equal(hum[0]!.opts.position, lamp, 'the hum comes from the lamp');
  assert.equal(audio.loops.filter((l) => l.name === 'fluorescentBuzz' && l.stoppedWith === null).length, 0, 'the tubes are silent');
  dir.update(2, new THREE.Vector3(0, 1.6, 0));
  assert.ok(hum[0]!.gains.at(-1)! > 0.05, 'the hum plays at the lamp\'s full pattern level, not its dimmed light');
  dir.dispose();
});

test('flickering room lights drive buzz gain and fire zap arcs on re-ignition', () => {
  const audio = new MockAmbienceAudio();
  const dir = new AmbienceDirector(audio, new Rng('light-test'));
  dir.setMode('playing');
  const lamp = { level: 0.2, pattern: 'flicker' };
  dir.enterRoom('hull_hum', [{ position: new THREE.Vector3(1, 3, 2), light: lamp }]);

  const buzz = audio.loops.find((l) => l.name === 'fluorescentBuzz');
  assert.ok(buzz, 'expected fluorescentBuzz loop for flickering room fixture');

  dir.update(1.0, new THREE.Vector3(0, 1.6, 0));
  lamp.level = 0.95;
  dir.update(1.1, new THREE.Vector3(0, 1.6, 0));

  assert.ok(audio.plays.some((p) => p.name === 'zap'), 'expected zap when flickering light snaps back on');
  dir.dispose();
  assert.equal(buzz.stoppedWith, 0);
});

test('all five Hydroponics room presets resolve, crossfade, and hot-swap ElevenLabs beds', () => {
  const hydroPresets = [
    ['hydro_vestibule', 'ambHydroVestibule'],
    ['hydro_misters', 'ambHydroMisters'],
    ['hydro_seed_lab', 'ambHydroSeedLab'],
    ['hydro_plant_room', 'ambHydroPlantRoom'],
    ['hydro_storeroom', 'ambHydroStoreroom'],
  ] as const;

  const audio = new MockAmbienceAudio();
  const dir = new AmbienceDirector(audio, new Rng('hydro-amb'));
  dir.setMode('playing');

  for (const [preset, sample] of hydroPresets) {
    assert.ok(isAmbiencePreset(preset), `${preset} exists`);
    dir.enterRoom(preset, [], 1.5);
    assert.equal(dir.currentPreset, preset);
    const before = audio.loops.filter((l) => l.stoppedWith === null);
    assert.ok(before.length >= 1, `${preset} starts fallback bed before decode`);
    assert.ok(!before.some((l) => l.name === sample), `${preset} starts on fallback before ${sample} decodes`);
    audio.emitSampleLoaded(sample);
    const after = audio.loops.filter((l) => l.stoppedWith === null);
    assert.ok(after.some((l) => l.name === sample), `${preset} hot-swaps to ${sample}`);
  }

  dir.dispose();
});

test('living-station presets resolve, crossfade, and hot-swap ElevenLabs beds', () => {
  const newPresets = [
    ['dock_ring', 'ambDockRing'],
    ['dock_walk', 'ambDockWalk'],
    ['dock_airlock', 'ambDockAirlock'],
    ['obs_gallery', 'ambObsGallery'],
    ['security_office', 'ambSecurityOffice'],
    ['armory', 'ambArmory'],
    ['surgery', 'ambSurgery'],
    ['power_bay', 'ambPowerBay'],
    ['wet_vestibule', 'ambWetVestibule'],
    ['rov_workshop', 'ambRovWorkshop'],
    ['sample_store', 'ambSampleStore'],
    ['admin_reception', 'ambAdminReception'],
    ['admin_open_office', 'ambAdminOpenOffice'],
    ['directors_office', 'ambDirectorsOffice'],
    ['admin_boardroom', 'ambAdminBoardroom'],
    ['security_booth', 'ambSecurityBooth'],
    ['transit_boarding', 'ambTransitBoarding'],
    ['transit_tunnel', 'ambTransitTunnel'],
    ['transit_dock', 'ambTransitDock'],
    ['transit_concourse', 'ambTransitConcourse'],
    ['transit_dispatch', 'ambTransitDispatch'],
    ['dead_station', 'ambDeadStation'],
  ] as const;

  const audio = new MockAmbienceAudio();
  const dir = new AmbienceDirector(audio, new Rng('living-presets'));
  dir.setMode('playing');

  for (const [preset, sample] of newPresets) {
    assert.ok(isAmbiencePreset(preset), `${preset} exists`);
    dir.enterRoom(preset, [], 1.5);
    assert.equal(dir.currentPreset, preset);
    audio.emitSampleLoaded(sample);
    const active = audio.loops.filter((l) => l.stoppedWith === null);
    assert.ok(active.some((l) => l.name === sample), `${preset} hot-swaps to ${sample}`);
  }

  dir.dispose();
});

test('station phase shifts inhabited presets to dead_station under blackout and gates distantMoan out of morning', () => {
  const audio = new MockAmbienceAudio();
  audio.emitSampleLoaded('ambAdminOpenOffice');
  audio.emitSampleLoaded('ambDeadStation');
  audio.emitSampleLoaded('ambWetVestibule');
  audio.emitSampleLoaded('ambPowerBay');

  const dir = new AmbienceDirector(audio, new Rng('phase-test'));
  dir.setMode('playing');

  // Morning shift in wet_vestibule: distantMoan never fires over 300 s.
  dir.enterRoom('wet_vestibule', [], 0);
  for (let t = 0; t < 300; t += 1) dir.update(t, new THREE.Vector3(0, 1.6, 0));
  assert.equal(audio.plays.filter((p) => p.name === 'distantMoan').length, 0, 'no distantMoan during morning');

  // Switching to blackout unlocks distantMoan in wet_vestibule.
  dir.setPhase('blackout', 1.5);
  for (let t = 300; t < 600; t += 1) dir.update(t, new THREE.Vector3(0, 1.6, 0));
  assert.ok(audio.plays.filter((p) => p.name === 'distantMoan').length > 0, 'distantMoan fires under blackout');

  // Entering an inhabited office under blackout immediately plays dead_station.
  dir.enterRoom('admin_open_office', [], 0);
  assert.equal(dir.currentPreset, 'dead_station');

  // Returning to morning crossfades back to admin_open_office; lockdown shifts commons_murmur to dead_station.
  dir.setPhase('morning', 2.0);
  assert.equal(dir.currentPreset, 'admin_open_office');
  dir.enterRoom('commons_murmur', [], 0);
  assert.equal(dir.currentPreset, 'commons_murmur');
  dir.setPhase('lockdown', 2.0);
  assert.equal(dir.currentPreset, 'dead_station');

  // Power Bay scales bed gain up when station power is restored.
  dir.setPhase('blackout', 0);
  dir.enterRoom('power_bay', [], 0);
  dir.update(601, new THREE.Vector3(0, 1.6, 0));
  const activePower = audio.loops.find((l) => l.name === 'ambPowerBay' && l.stoppedWith === null)!;
  const beforeRestore = activePower.gains.at(-1)!;
  dir.setPowerRestored(true, 1.0);
  const afterRestore = activePower.gains.at(-1)!;
  assert.ok(afterRestore > beforeRestore * 1.2, 'power_bay bed scales up on power restore');

  dir.dispose();
});
