import * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import type { GameMode } from '../game/game.ts';
import type { LoopHandle, VoiceOptions } from './engine.ts';
import { Scheduler } from './scheduler.ts';
import type { SampleName, SoundName } from './sounds.ts';

/**
 * Minimal audio surface needed by AmbienceDirector (matches `AudioEngine` and lets
 * tests run headless without Web Audio globals).
 */
export interface AmbienceAudio {
  hasSound(name: SoundName): boolean;
  hasSample(name: SampleName): boolean;
  onSampleLoaded(fn: (name: SampleName) => void): () => void;
  loop(name: SoundName, opts?: VoiceOptions): LoopHandle;
  play(name: SoundName, opts?: VoiceOptions): void;
}

export interface AmbienceLightSource {
  readonly position: THREE.Vector3;
  readonly light: { readonly level: number; readonly pattern?: string; readonly power?: number };
  /** Light-slot kind; `pendant` lamps are not fluorescent and never buzz (in-world-audio spec). */
  readonly kind?: string;
}

export interface BedLayerSpec {
  /** Preferred recorded/generated sample; falls back to `fallback` until decoded. */
  sample: SampleName;
  fallback: SoundName;
  gain: number;
  rate?: number;
  cutoff?: number;
  muffled?: boolean;
}

export type OneShotPlacement = 'perimeter' | 'ceiling' | 'far' | 'near';

export type StationPhase = 'morning' | 'lockdown' | 'blackout';

export interface AmbienceOneShot {
  sound: SoundName;
  /** Optional fallback if `sound` is a sample-only name that has not loaded yet. */
  fallback?: SoundName;
  /** Random [min, max] interval in seconds between firings. */
  every: readonly [number, number];
  gain: number;
  placement: OneShotPlacement;
  reverb?: number;
  muffled?: boolean;
  rateRange?: readonly [number, number];
  /** Station phases in which this one-shot may fire; omitted means all phases. */
  phases?: readonly StationPhase[];
}

export interface AmbiencePreset {
  /** Primary stereo room bed plus optional asynchronous secondary texture layer. */
  beds: readonly BedLayerSpec[];
  /** Gentle dual-wave amplitude breathing so long stays in one room never feel static. */
  breathing: { depth: number; periodA: number; periodB: number };
  /** Room-appropriate spatialized environmental one-shots. */
  oneshots: readonly AmbienceOneShot[];
  /** Optional preset to substitute under `lockdown` (e.g. evacuated crew spaces). */
  lockdownPreset?: string;
  /** Optional preset to substitute under `blackout` (main power failed). */
  blackoutPreset?: string;
  /** Optional gain multiplier when station power has been restored (`R11 Power Bay`). */
  restoredGainScale?: number;
}

export const DEFAULT_AMBIENCE = 'hull_hum';
export const AMBIENCE_CROSSFADE = 2.0;

const MODE_SCALE: Record<GameMode, { scale: number; tc: number }> = {
  title: { scale: 0, tc: 0.45 },
  paused: { scale: 0.35, tc: 0.25 },
  playing: { scale: 1, tc: 0.6 },
};

const MAX_ROOM_BUZZERS = 4;
const STEADY_BUZZ_GAIN = 0.045;
const FLICKER_BUZZ_GAIN = 0.16;
/** A backup lamp's ballast hum under backup power (station-power spec), at the lamp's full pattern brightness. */
const BACKUP_HUM_GAIN = 0.09;

/**
 * Environmental soundscape presets matching `atmosphere.ambience` in level JSONs
 * (plus `'silent'` for scripted quiet moments).
 */
export const AMBIENCE_PRESETS = {
  hull_hum: {
    beds: [
      { sample: 'ambHullHum', fallback: 'roomTone', gain: 0.55 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.18, rate: 0.94, cutoff: 340 },
    ],
    breathing: { depth: 0.09, periodA: 19, periodB: 31 },
    oneshots: [
      { sound: 'hullGroan', every: [22, 46], gain: 0.48, placement: 'far', muffled: true, reverb: 0.55, rateRange: [0.88, 1.05] },
      { sound: 'metalKnock', every: [18, 40], gain: 0.36, placement: 'far', muffled: true, reverb: 0.65, rateRange: [0.84, 1.1] },
      { sound: 'creak', every: [15, 34], gain: 0.22, placement: 'ceiling', reverb: 0.4, rateRange: [0.9, 1.1] },
      { sound: 'pressurePing', every: [35, 70], gain: 0.18, placement: 'far', muffled: true, reverb: 0.75, rateRange: [0.95, 1.04] },
    ],
  },
  commons_murmur: {
    beds: [
      { sample: 'ambCommons', fallback: 'roomTone', gain: 0.52 },
      { sample: 'ventFan', fallback: 'ventFan', gain: 0.09, rate: 0.91, cutoff: 900 },
    ],
    breathing: { depth: 0.07, periodA: 23, periodB: 37 },
    oneshots: [
      { sound: 'creak', every: [24, 52], gain: 0.16, placement: 'ceiling', reverb: 0.35, rateRange: [0.92, 1.08] },
      { sound: 'metalKnock', every: [30, 64], gain: 0.22, placement: 'far', muffled: true, reverb: 0.55, rateRange: [0.85, 1.06] },
    ],
    lockdownPreset: 'dead_station',
    blackoutPreset: 'dead_station',
  },
  lab_hum: {
    beds: [
      { sample: 'ambLabHum', fallback: 'roomTone', gain: 0.52 },
      { sample: 'consoleHum', fallback: 'consoleHum', gain: 0.12, rate: 0.97, cutoff: 1400 },
    ],
    breathing: { depth: 0.08, periodA: 17, periodB: 29 },
    oneshots: [
      { sound: 'consoleBeep', every: [14, 30], gain: 0.16, placement: 'near', reverb: 0.2, rateRange: [0.97, 1.04] },
      { sound: 'hullGroan', every: [28, 56], gain: 0.34, placement: 'far', muffled: true, reverb: 0.5, rateRange: [0.88, 1.04] },
      { sound: 'creak', every: [20, 44], gain: 0.2, placement: 'ceiling', reverb: 0.35, rateRange: [0.92, 1.08] },
    ],
  },
  hull_groan: {
    beds: [
      { sample: 'ambHullGroan', fallback: 'roomTone', gain: 0.62 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.28, rate: 0.92, cutoff: 380 },
    ],
    breathing: { depth: 0.13, periodA: 15, periodB: 27 },
    oneshots: [
      { sound: 'hullGroan', every: [12, 26], gain: 0.65, placement: 'far', muffled: true, reverb: 0.65, rateRange: [0.84, 1.04] },
      { sound: 'creak', every: [8, 19], gain: 0.32, placement: 'ceiling', reverb: 0.45, rateRange: [0.88, 1.12] },
      { sound: 'metalKnock', every: [12, 28], gain: 0.48, placement: 'far', muffled: true, reverb: 0.7, rateRange: [0.8, 1.08] },
      { sound: 'pressurePing', every: [26, 54], gain: 0.22, placement: 'far', muffled: true, reverb: 0.8, rateRange: [0.94, 1.05] },
    ],
  },
  office_hvac: {
    beds: [
      { sample: 'ambOfficeHvac', fallback: 'roomTone', gain: 0.5 },
      { sample: 'consoleHum', fallback: 'consoleHum', gain: 0.1, rate: 0.96, cutoff: 1200 },
    ],
    breathing: { depth: 0.06, periodA: 25, periodB: 41 },
    oneshots: [
      { sound: 'creak', every: [26, 56], gain: 0.14, placement: 'ceiling', reverb: 0.2, rateRange: [0.92, 1.08] },
      { sound: 'metalKnock', every: [32, 68], gain: 0.18, placement: 'far', muffled: true, reverb: 0.4, rateRange: [0.85, 1.05] },
    ],
  },
  med_beeps: {
    beds: [
      { sample: 'ambMedBay', fallback: 'roomTone', gain: 0.5 },
      { sample: 'ventFan', fallback: 'ventFan', gain: 0.08, rate: 0.93, cutoff: 800 },
    ],
    breathing: { depth: 0.07, periodA: 19, periodB: 33 },
    oneshots: [
      { sound: 'medBeep', fallback: 'consoleBeep', every: [7, 16], gain: 0.22, placement: 'near', reverb: 0.2, rateRange: [0.98, 1.02] },
      { sound: 'creak', every: [24, 50], gain: 0.16, placement: 'ceiling', reverb: 0.25, rateRange: [0.92, 1.08] },
    ],
  },
  water_drip: {
    beds: [
      { sample: 'ambFlooded', fallback: 'waterRumble', gain: 0.62 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.26, rate: 0.9, cutoff: 420 },
    ],
    breathing: { depth: 0.12, periodA: 16, periodB: 29 },
    oneshots: [
      { sound: 'drip', every: [1.6, 5.2], gain: 0.42, placement: 'perimeter', reverb: 0.6, rateRange: [0.85, 1.18] },
      { sound: 'hullGroan', every: [16, 36], gain: 0.52, placement: 'far', muffled: true, reverb: 0.7, rateRange: [0.84, 1.02] },
      { sound: 'metalKnock', every: [14, 32], gain: 0.38, placement: 'far', muffled: true, reverb: 0.75, rateRange: [0.8, 1.08] },
      { sound: 'pressurePing', every: [28, 56], gain: 0.2, placement: 'far', muffled: true, reverb: 0.85, rateRange: [0.94, 1.04] },
    ],
  },
  pipes_knock: {
    beds: [
      { sample: 'ambValveRoom', fallback: 'ventFan', gain: 0.58 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.22, rate: 0.95, cutoff: 480 },
    ],
    breathing: { depth: 0.1, periodA: 14, periodB: 23 },
    oneshots: [
      { sound: 'metalKnock', every: [6, 16], gain: 0.48, placement: 'perimeter', reverb: 0.55, rateRange: [0.82, 1.14] },
      { sound: 'creak', every: [10, 24], gain: 0.3, placement: 'ceiling', reverb: 0.45, rateRange: [0.88, 1.12] },
      { sound: 'drip', every: [4, 11], gain: 0.28, placement: 'perimeter', reverb: 0.4, rateRange: [0.9, 1.15] },
      { sound: 'hullGroan', every: [20, 42], gain: 0.45, placement: 'far', muffled: true, reverb: 0.55, rateRange: [0.85, 1.03] },
    ],
  },
  hydro_misters: {
    beds: [
      { sample: 'ambHydroMisters', fallback: 'ventFan', gain: 0.52 },
      { sample: 'ambHullHum', fallback: 'roomTone', gain: 0.14, rate: 0.96, cutoff: 320 },
    ],
    breathing: { depth: 0.08, periodA: 18, periodB: 31 },
    oneshots: [
      { sound: 'hydroDrip', fallback: 'drip', every: [2.8, 7.2], gain: 0.24, placement: 'perimeter', reverb: 0.35, rateRange: [0.9, 1.16] },
      { sound: 'creak', every: [22, 48], gain: 0.16, placement: 'ceiling', reverb: 0.35, rateRange: [0.92, 1.08] },
    ],
  },
  hydro_vestibule: {
    beds: [
      { sample: 'ambHydroVestibule', fallback: 'ventFan', gain: 0.48 },
      { sample: 'ambHullHum', fallback: 'roomTone', gain: 0.12, rate: 0.97, cutoff: 300 },
    ],
    breathing: { depth: 0.06, periodA: 21, periodB: 35 },
    oneshots: [
      { sound: 'creak', every: [24, 52], gain: 0.14, placement: 'ceiling', reverb: 0.25, rateRange: [0.92, 1.08] },
    ],
  },
  hydro_seed_lab: {
    beds: [
      { sample: 'ambHydroSeedLab', fallback: 'roomTone', gain: 0.46 },
      { sample: 'consoleHum', fallback: 'consoleHum', gain: 0.09, rate: 0.98, cutoff: 1200 },
    ],
    breathing: { depth: 0.06, periodA: 20, periodB: 34 },
    oneshots: [
      { sound: 'creak', every: [26, 56], gain: 0.14, placement: 'ceiling', reverb: 0.2, rateRange: [0.92, 1.08] },
    ],
  },
  hydro_plant_room: {
    beds: [
      { sample: 'ambHydroPlantRoom', fallback: 'ventFan', gain: 0.54 },
      { sample: 'ambHullHum', fallback: 'roomTone', gain: 0.16, rate: 0.94, cutoff: 340 },
    ],
    breathing: { depth: 0.09, periodA: 16, periodB: 27 },
    oneshots: [
      { sound: 'hydroDrip', fallback: 'drip', every: [4.5, 11.0], gain: 0.2, placement: 'perimeter', reverb: 0.35, rateRange: [0.9, 1.15] },
      { sound: 'metalKnock', every: [18, 42], gain: 0.26, placement: 'perimeter', reverb: 0.45, rateRange: [0.85, 1.08] },
    ],
  },
  hydro_storeroom: {
    beds: [
      { sample: 'ambHydroStoreroom', fallback: 'roomTone', gain: 0.4 },
    ],
    breathing: { depth: 0.05, periodA: 24, periodB: 39 },
    oneshots: [
      { sound: 'creak', every: [28, 60], gain: 0.12, placement: 'ceiling', reverb: 0.2, rateRange: [0.92, 1.08] },
    ],
  },
  dive_drip: {
    beds: [
      { sample: 'ambDiveBay', fallback: 'waterRumble', gain: 0.6 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.24, rate: 0.91, cutoff: 360 },
    ],
    breathing: { depth: 0.11, periodA: 17, periodB: 30 },
    oneshots: [
      { sound: 'drip', every: [2.2, 6.5], gain: 0.36, placement: 'perimeter', reverb: 0.65, rateRange: [0.86, 1.16] },
      { sound: 'hullGroan', every: [18, 38], gain: 0.48, placement: 'far', muffled: true, reverb: 0.7, rateRange: [0.85, 1.03] },
      { sound: 'pressurePing', every: [24, 52], gain: 0.24, placement: 'far', muffled: true, reverb: 0.85, rateRange: [0.94, 1.05] },
      { sound: 'distantMoan', every: [55, 110], gain: 0.35, placement: 'far', muffled: true, reverb: 0.9, rateRange: [0.94, 1.04], phases: ['lockdown', 'blackout'] },
    ],
  },
  // The Launch Hall (rebuild-dive-bay): hydraulic plant hum and water moving in the trunk, winch and
  // pressure noises; no distant moans, so the quiet half stays calm here.
  launch_bay: {
    beds: [
      { sample: 'ambLaunchBay', fallback: 'waterRumble', gain: 0.55 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.2, rate: 0.9, cutoff: 420 },
    ],
    breathing: { depth: 0.08, periodA: 19, periodB: 33 },
    oneshots: [
      { sound: 'drip', every: [2.6, 7.5], gain: 0.3, placement: 'perimeter', reverb: 0.6, rateRange: [0.88, 1.14] },
      { sound: 'winchClunk', every: [20, 45], gain: 0.34, placement: 'ceiling', reverb: 0.55, rateRange: [0.9, 1.05] },
      { sound: 'metalKnock', every: [35, 70], gain: 0.22, placement: 'ceiling', reverb: 0.55, rateRange: [0.85, 1.0] },
      { sound: 'pressurePing', every: [26, 56], gain: 0.22, placement: 'far', muffled: true, reverb: 0.85, rateRange: [0.94, 1.05] },
      { sound: 'hullGroan', every: [40, 80], gain: 0.32, placement: 'far', muffled: true, reverb: 0.7, rateRange: [0.88, 1.02] },
    ],
  },
  // ---- Living-station full-pass bespoke room presets (living-station-audio) ----
  dock_ring: {
    beds: [
      { sample: 'ambDockRing', fallback: 'roomTone', gain: 0.54 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.16, rate: 0.92, cutoff: 320 },
    ],
    breathing: { depth: 0.08, periodA: 21, periodB: 35 },
    oneshots: [
      { sound: 'gantryCreak', fallback: 'creak', every: [18, 42], gain: 0.26, placement: 'ceiling', reverb: 0.55, rateRange: [0.92, 1.06] },
      { sound: 'hullGroan', every: [26, 54], gain: 0.36, placement: 'far', muffled: true, reverb: 0.6, rateRange: [0.88, 1.04] },
      { sound: 'pressurePing', every: [36, 74], gain: 0.16, placement: 'far', muffled: true, reverb: 0.8, rateRange: [0.95, 1.04] },
    ],
    blackoutPreset: 'dead_station',
  },
  dock_walk: {
    beds: [
      { sample: 'ambDockWalk', fallback: 'roomTone', gain: 0.5 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.14, rate: 0.95, cutoff: 300 },
    ],
    breathing: { depth: 0.07, periodA: 19, periodB: 31 },
    oneshots: [
      { sound: 'creak', every: [20, 46], gain: 0.2, placement: 'ceiling', reverb: 0.4, rateRange: [0.9, 1.08] },
      { sound: 'metalKnock', every: [26, 56], gain: 0.28, placement: 'far', muffled: true, reverb: 0.6, rateRange: [0.85, 1.06] },
    ],
  },
  dock_airlock: {
    beds: [
      { sample: 'ambDockAirlock', fallback: 'roomTone', gain: 0.52 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.2, rate: 0.88, cutoff: 280 },
    ],
    breathing: { depth: 0.06, periodA: 16, periodB: 27 },
    oneshots: [
      { sound: 'airlockHiss', fallback: 'creak', every: [16, 36], gain: 0.24, placement: 'perimeter', reverb: 0.35, rateRange: [0.94, 1.06] },
      { sound: 'hullGroan', every: [24, 52], gain: 0.32, placement: 'far', muffled: true, reverb: 0.55, rateRange: [0.88, 1.04] },
    ],
  },
  obs_gallery: {
    beds: [
      { sample: 'ambObsGallery', fallback: 'roomTone', gain: 0.48 },
      { sample: 'consoleHum', fallback: 'consoleHum', gain: 0.09, rate: 0.98, cutoff: 1300 },
    ],
    breathing: { depth: 0.06, periodA: 23, periodB: 37 },
    oneshots: [
      { sound: 'creak', every: [24, 54], gain: 0.16, placement: 'ceiling', reverb: 0.4, rateRange: [0.92, 1.08] },
      { sound: 'consoleBeep', every: [22, 48], gain: 0.12, placement: 'perimeter', reverb: 0.25, rateRange: [0.97, 1.03], phases: ['morning'] },
      { sound: 'hullGroan', every: [28, 60], gain: 0.34, placement: 'far', muffled: true, reverb: 0.55, rateRange: [0.88, 1.04] },
    ],
    blackoutPreset: 'dead_station',
  },
  security_office: {
    beds: [
      { sample: 'ambSecurityOffice', fallback: 'roomTone', gain: 0.5 },
      { sample: 'consoleHum', fallback: 'consoleHum', gain: 0.13, rate: 0.96, cutoff: 1500 },
    ],
    breathing: { depth: 0.06, periodA: 22, periodB: 35 },
    oneshots: [
      { sound: 'relayClick', fallback: 'consoleBeep', every: [12, 28], gain: 0.18, placement: 'near', reverb: 0.2, rateRange: [0.94, 1.06] },
      { sound: 'creak', every: [24, 52], gain: 0.14, placement: 'ceiling', reverb: 0.25, rateRange: [0.92, 1.08] },
    ],
  },
  armory: {
    beds: [
      { sample: 'ambArmory', fallback: 'roomTone', gain: 0.42 },
    ],
    breathing: { depth: 0.05, periodA: 25, periodB: 41 },
    oneshots: [
      { sound: 'creak', every: [28, 62], gain: 0.14, placement: 'ceiling', reverb: 0.2, rateRange: [0.92, 1.08] },
      { sound: 'metalKnock', every: [34, 70], gain: 0.22, placement: 'far', muffled: true, reverb: 0.45, rateRange: [0.85, 1.05] },
    ],
  },
  surgery: {
    beds: [
      { sample: 'ambSurgery', fallback: 'roomTone', gain: 0.46 },
    ],
    breathing: { depth: 0.06, periodA: 18, periodB: 31 },
    oneshots: [
      { sound: 'surgicalPulse', fallback: 'medBeep', every: [9, 20], gain: 0.2, placement: 'near', reverb: 0.25, rateRange: [0.96, 1.04] },
      { sound: 'medBeep', fallback: 'consoleBeep', every: [14, 30], gain: 0.16, placement: 'perimeter', reverb: 0.25, rateRange: [0.98, 1.02] },
    ],
  },
  power_bay: {
    beds: [
      { sample: 'ambPowerBay', fallback: 'roomTone', gain: 0.56 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.18, rate: 0.93, cutoff: 360 },
    ],
    breathing: { depth: 0.1, periodA: 15, periodB: 26 },
    oneshots: [
      { sound: 'metalKnock', every: [14, 32], gain: 0.36, placement: 'far', muffled: true, reverb: 0.65, rateRange: [0.84, 1.08] },
      { sound: 'hullGroan', every: [20, 44], gain: 0.46, placement: 'far', muffled: true, reverb: 0.65, rateRange: [0.86, 1.04] },
      { sound: 'relayClick', fallback: 'creak', every: [18, 38], gain: 0.22, placement: 'perimeter', reverb: 0.45, rateRange: [0.92, 1.08] },
    ],
    restoredGainScale: 1.35,
  },
  wet_vestibule: {
    beds: [
      { sample: 'ambWetVestibule', fallback: 'waterRumble', gain: 0.5 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.14, rate: 0.93, cutoff: 340 },
    ],
    breathing: { depth: 0.08, periodA: 19, periodB: 32 },
    oneshots: [
      { sound: 'drip', every: [3.0, 8.0], gain: 0.28, placement: 'perimeter', reverb: 0.45, rateRange: [0.88, 1.15] },
      { sound: 'creak', every: [22, 48], gain: 0.18, placement: 'ceiling', reverb: 0.4, rateRange: [0.9, 1.08] },
      { sound: 'distantMoan', every: [55, 110], gain: 0.32, placement: 'far', muffled: true, reverb: 0.85, rateRange: [0.94, 1.04], phases: ['lockdown', 'blackout'] },
    ],
  },
  rov_workshop: {
    beds: [
      { sample: 'ambRovWorkshop', fallback: 'roomTone', gain: 0.5 },
      { sample: 'consoleHum', fallback: 'consoleHum', gain: 0.1, rate: 0.94, cutoff: 1100 },
    ],
    breathing: { depth: 0.07, periodA: 20, periodB: 33 },
    oneshots: [
      { sound: 'airlockHiss', fallback: 'creak', every: [18, 42], gain: 0.16, placement: 'perimeter', reverb: 0.3, rateRange: [0.95, 1.08] },
      { sound: 'metalKnock', every: [24, 52], gain: 0.22, placement: 'far', muffled: true, reverb: 0.5, rateRange: [0.86, 1.08] },
      { sound: 'distantMoan', every: [60, 120], gain: 0.3, placement: 'far', muffled: true, reverb: 0.85, rateRange: [0.94, 1.04], phases: ['lockdown', 'blackout'] },
    ],
  },
  sample_store: {
    beds: [
      { sample: 'ambSampleStore', fallback: 'roomTone', gain: 0.52 },
      { sample: 'freezerHum', fallback: 'ventFan', gain: 0.14, rate: 0.97, cutoff: 1400 },
    ],
    breathing: { depth: 0.06, periodA: 18, periodB: 31 },
    oneshots: [
      { sound: 'creak', every: [24, 54], gain: 0.14, placement: 'ceiling', reverb: 0.25, rateRange: [0.92, 1.08] },
      { sound: 'distantMoan', every: [60, 120], gain: 0.3, placement: 'far', muffled: true, reverb: 0.85, rateRange: [0.94, 1.04], phases: ['lockdown', 'blackout'] },
    ],
  },
  admin_reception: {
    beds: [
      { sample: 'ambAdminReception', fallback: 'roomTone', gain: 0.48 },
    ],
    breathing: { depth: 0.06, periodA: 24, periodB: 39 },
    oneshots: [
      { sound: 'creak', every: [28, 60], gain: 0.12, placement: 'ceiling', reverb: 0.2, rateRange: [0.92, 1.08] },
    ],
    blackoutPreset: 'dead_station',
  },
  admin_open_office: {
    beds: [
      { sample: 'ambAdminOpenOffice', fallback: 'roomTone', gain: 0.5 },
      { sample: 'consoleHum', fallback: 'consoleHum', gain: 0.08, rate: 0.98, cutoff: 1200 },
    ],
    breathing: { depth: 0.06, periodA: 23, periodB: 37 },
    oneshots: [
      { sound: 'creak', every: [26, 56], gain: 0.12, placement: 'ceiling', reverb: 0.2, rateRange: [0.92, 1.08] },
    ],
    blackoutPreset: 'dead_station',
  },
  directors_office: {
    beds: [
      { sample: 'ambDirectorsOffice', fallback: 'roomTone', gain: 0.44 },
    ],
    breathing: { depth: 0.05, periodA: 26, periodB: 43 },
    oneshots: [
      { sound: 'creak', every: [32, 68], gain: 0.11, placement: 'ceiling', reverb: 0.18, rateRange: [0.92, 1.08] },
    ],
    blackoutPreset: 'dead_station',
  },
  admin_boardroom: {
    beds: [
      { sample: 'ambAdminBoardroom', fallback: 'roomTone', gain: 0.46 },
    ],
    breathing: { depth: 0.05, periodA: 25, periodB: 41 },
    oneshots: [
      { sound: 'creak', every: [30, 64], gain: 0.12, placement: 'ceiling', reverb: 0.2, rateRange: [0.92, 1.08] },
    ],
    blackoutPreset: 'dead_station',
  },
  security_booth: {
    beds: [
      { sample: 'ambSecurityBooth', fallback: 'roomTone', gain: 0.5 },
      { sample: 'consoleHum', fallback: 'consoleHum', gain: 0.14, rate: 1.02, cutoff: 1800 },
    ],
    breathing: { depth: 0.05, periodA: 19, periodB: 31 },
    oneshots: [
      { sound: 'relayClick', fallback: 'consoleBeep', every: [10, 24], gain: 0.18, placement: 'near', reverb: 0.15, rateRange: [0.94, 1.06] },
    ],
    blackoutPreset: 'dead_station',
  },
  transit_boarding: {
    beds: [
      { sample: 'ambTransitBoarding', fallback: 'roomTone', gain: 0.56 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.18, rate: 0.91, cutoff: 340 },
    ],
    breathing: { depth: 0.1, periodA: 17, periodB: 29 },
    oneshots: [
      { sound: 'railCreak', fallback: 'creak', every: [14, 34], gain: 0.34, placement: 'far', reverb: 0.65, rateRange: [0.9, 1.06] },
      { sound: 'relayClick', fallback: 'consoleBeep', every: [18, 40], gain: 0.2, placement: 'perimeter', reverb: 0.45, rateRange: [0.92, 1.08] },
      { sound: 'hullGroan', every: [22, 48], gain: 0.42, placement: 'far', muffled: true, reverb: 0.7, rateRange: [0.85, 1.03] },
    ],
  },
  transit_tunnel: {
    beds: [
      { sample: 'ambTransitTunnel', fallback: 'waterRumble', gain: 0.64 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.28, rate: 0.88, cutoff: 360 },
    ],
    breathing: { depth: 0.13, periodA: 14, periodB: 25 },
    oneshots: [
      { sound: 'hullGroan', every: [12, 26], gain: 0.56, placement: 'far', muffled: true, reverb: 0.75, rateRange: [0.84, 1.02] },
      { sound: 'railCreak', fallback: 'creak', every: [10, 24], gain: 0.38, placement: 'perimeter', reverb: 0.65, rateRange: [0.88, 1.08] },
      { sound: 'pressurePing', every: [22, 48], gain: 0.24, placement: 'far', muffled: true, reverb: 0.85, rateRange: [0.94, 1.04] },
    ],
  },
  transit_dock: {
    beds: [
      { sample: 'ambTransitDock', fallback: 'roomTone', gain: 0.54 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.18, rate: 0.9, cutoff: 320 },
    ],
    breathing: { depth: 0.1, periodA: 18, periodB: 31 },
    oneshots: [
      { sound: 'railCreak', fallback: 'creak', every: [16, 36], gain: 0.32, placement: 'far', reverb: 0.65, rateRange: [0.9, 1.06] },
      { sound: 'drip', every: [4.0, 11.0], gain: 0.24, placement: 'perimeter', reverb: 0.6, rateRange: [0.88, 1.14] },
      { sound: 'hullGroan', every: [20, 44], gain: 0.44, placement: 'far', muffled: true, reverb: 0.7, rateRange: [0.85, 1.03] },
    ],
  },
  transit_concourse: {
    beds: [
      { sample: 'ambTransitConcourse', fallback: 'roomTone', gain: 0.58 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.22, rate: 0.89, cutoff: 340 },
    ],
    breathing: { depth: 0.12, periodA: 16, periodB: 29 },
    oneshots: [
      { sound: 'gantryCreak', fallback: 'creak', every: [15, 34], gain: 0.36, placement: 'ceiling', reverb: 0.75, rateRange: [0.86, 1.04] },
      { sound: 'hullGroan', every: [16, 36], gain: 0.52, placement: 'far', muffled: true, reverb: 0.8, rateRange: [0.84, 1.02] },
      { sound: 'drip', every: [5.0, 13.0], gain: 0.26, placement: 'perimeter', reverb: 0.7, rateRange: [0.86, 1.14] },
      { sound: 'distantMoan', every: [48, 96], gain: 0.36, placement: 'far', muffled: true, reverb: 0.9, rateRange: [0.92, 1.04], phases: ['lockdown', 'blackout'] },
    ],
  },
  transit_dispatch: {
    beds: [
      { sample: 'ambTransitDispatch', fallback: 'roomTone', gain: 0.48 },
      { sample: 'consoleHum', fallback: 'consoleHum', gain: 0.08, rate: 0.95, cutoff: 1400 },
    ],
    breathing: { depth: 0.07, periodA: 21, periodB: 35 },
    oneshots: [
      { sound: 'relayClick', fallback: 'consoleBeep', every: [14, 32], gain: 0.18, placement: 'near', reverb: 0.25, rateRange: [0.92, 1.06] },
      { sound: 'hullGroan', every: [24, 52], gain: 0.38, placement: 'far', muffled: true, reverb: 0.65, rateRange: [0.86, 1.04] },
    ],
  },
  dead_station: {
    beds: [
      { sample: 'ambDeadStation', fallback: 'roomTone', gain: 0.5 },
      { sample: 'waterRumble', fallback: 'waterRumble', gain: 0.18, rate: 0.88, cutoff: 300 },
    ],
    breathing: { depth: 0.11, periodA: 17, periodB: 31 },
    oneshots: [
      { sound: 'hullGroan', every: [16, 36], gain: 0.48, placement: 'far', muffled: true, reverb: 0.65, rateRange: [0.84, 1.03] },
      { sound: 'creak', every: [12, 28], gain: 0.24, placement: 'ceiling', reverb: 0.45, rateRange: [0.88, 1.1] },
      { sound: 'metalKnock', every: [20, 44], gain: 0.32, placement: 'far', muffled: true, reverb: 0.65, rateRange: [0.82, 1.08] },
    ],
  },
  silent: {
    beds: [],
    breathing: { depth: 0, periodA: 20, periodB: 31 },
    oneshots: [],
  },
} as const satisfies Record<string, AmbiencePreset>;

export type AmbiencePresetId = keyof typeof AMBIENCE_PRESETS;

export function isAmbiencePreset(id: string): id is AmbiencePresetId {
  return id in AMBIENCE_PRESETS;
}

/** Unknown or missing names fall back to `hull_hum`, so a level typo is never silent-fatal. */
export function resolveAmbience(id: string | undefined): AmbiencePresetId {
  if (id === 'none') return 'silent';
  return id !== undefined && isAmbiencePreset(id) ? id : DEFAULT_AMBIENCE;
}

interface ActiveBed {
  spec: BedLayerSpec;
  usingSample: boolean;
  handle: LoopHandle;
}

interface ActiveBuzz {
  source: AmbienceLightSource;
  handle: LoopHandle;
  baseGain: number;
  rate: number;
  usingSample: boolean;
  prevLevel: number;
  lastZap: number;
  /** A backup lamp's `backupHum`, whose gain follows the pattern, not the dimmed level. */
  hum?: boolean;
}

/**
 * Room-aware environmental soundscape director on top of `AudioEngine`.
 *
 * Manages multi-layer stereo ambient beds with smooth crossfading on room transitions,
 * scripted `ambience(id)` overrides, seamless procedural-to-sample hot-swapping once
 * async samples decode, spatial one-shot pacing around the listener, and reactive
 * fluorescent buzz/zap emitters on the active room's light fixtures.
 */
export class AmbienceDirector {
  private readonly audio: AmbienceAudio;
  private readonly rng: Rng;
  private readonly offSample: () => void;

  private mode: GameMode = 'title';
  private phase: StationPhase = 'morning';
  private powerRestored = false;
  private roomPreset: AmbiencePresetId | null = null;
  private overridePreset: AmbiencePresetId | null = null;
  private activePreset: AmbiencePresetId | null = null;
  private beds: ActiveBed[] = [];
  private scheduler: Scheduler | null = null;
  private buzzers: ActiveBuzz[] = [];
  /** The current room's fixtures, kept so a late-decoding hum or a power change can rebind them. */
  private roomLightSources: readonly AmbienceLightSource[] = [];
  private listenerPos = new THREE.Vector3();
  private lastTime = 0;

  constructor(audio: AmbienceAudio, rng: Rng) {
    this.audio = audio;
    this.rng = rng;
    this.offSample = this.audio.onSampleLoaded((name) => this.handleSampleLoaded(name));
  }

  /** Current effective preset (script override wins over room preset). */
  get currentPreset(): AmbiencePresetId | null {
    return this.activePreset;
  }

  /** Current station phase (`morning`, `lockdown`, or `blackout`). */
  get currentPhase(): StationPhase {
    return this.phase;
  }

  /** Set game mode: silent on title (MenuMusic owns it), ducked on pause, full while playing. */
  setMode(mode: GameMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'title') this.overridePreset = null;
    this.applyBedGains(this.lastTime, MODE_SCALE[mode].tc);
    this.applyBuzzGains(MODE_SCALE[mode].tc);
  }

  /**
   * Update the station phase (`morning` -> `lockdown` -> `blackout`) so inhabited presets shift to dead/reduced
   * variants and phase-gated horror one-shots (such as `distantMoan`) unlock only after the drop.
   */
  setPhase(phase: StationPhase, fadeSeconds = AMBIENCE_CROSSFADE): void {
    if (phase === this.phase) return;
    this.phase = phase;
    if (this.overridePreset !== null) {
      this.rebuildScheduler(AMBIENCE_PRESETS[this.overridePreset]);
      return;
    }
    if (this.roomPreset !== null) {
      const target = this.effectivePreset(this.roomPreset);
      if (target !== this.activePreset) {
        this.transitionTo(target, fadeSeconds);
      } else {
        this.rebuildScheduler(AMBIENCE_PRESETS[target]);
      }
    }
  }

  /** Scale up `power_bay` (and any preset with `restoredGainScale`) once station power is restored. */
  setPowerRestored(restored: boolean, fadeSeconds = 1.5): void {
    if (restored === this.powerRestored) return;
    this.powerRestored = restored;
    this.applyBedGains(this.lastTime, Math.max(0.05, fadeSeconds * 0.45));
  }

  /** Called on `room:entered` with the room's `atmosphere.ambience` id and optional light fixtures. */
  enterRoom(ambienceId: string | undefined, lights: readonly AmbienceLightSource[] = [], fadeSeconds = AMBIENCE_CROSSFADE): void {
    this.roomPreset = resolveAmbience(ambienceId);
    this.bindRoomLights(lights);
    if (this.overridePreset === null) {
      this.transitionTo(this.effectivePreset(this.roomPreset), fadeSeconds);
    }
  }

  /** Station power changed (station-power spec): rebind the current room's fixture emitters, beds untouched. */
  rebindLights(lights: readonly AmbienceLightSource[]): void {
    this.bindRoomLights(lights);
  }

  /** Scripted `ambience(id)` action: overrides room ambience until cleared with `null`. */
  setOverride(ambienceId: string | null, fadeSeconds = AMBIENCE_CROSSFADE): void {
    if (ambienceId === null) {
      this.overridePreset = null;
      if (this.roomPreset !== null) this.transitionTo(this.effectivePreset(this.roomPreset), fadeSeconds);
      return;
    }
    this.overridePreset = resolveAmbience(ambienceId);
    this.transitionTo(this.overridePreset, fadeSeconds);
  }

  /** Clear scripted override and light emitters (e.g. on `level:reset`). */
  reset(): void {
    this.overridePreset = null;
    this.clearBuzzers(0.25);
    if (this.roomPreset !== null) {
      this.transitionTo(this.effectivePreset(this.roomPreset), 0.8);
    }
  }

  /** Tick breathing modulation, one-shot scheduler, and flickering light arcs. */
  update(t: number, listenerPos: THREE.Vector3): void {
    this.lastTime = t;
    this.listenerPos.copy(listenerPos);

    if (this.mode === 'playing') {
      this.applyBedGains(t, 0.35);
      this.scheduler?.update(t);
    }

    const modeScale = MODE_SCALE[this.mode].scale;
    for (const b of this.buzzers) {
      if (b.hum) {
        // A backup lamp's hum follows its pattern, not its dimmed brightness, and never zaps.
        b.handle.setGain(b.baseGain * (b.source.light.level / Math.max(1e-3, b.source.light.power ?? 1)) * modeScale, 0.02);
        continue;
      }
      const level = b.source.light.level;
      b.handle.setGain(b.baseGain * level * modeScale, 0.02);
      if (this.mode === 'playing' && b.prevLevel < 0.4 && level > 0.75 && t - b.lastZap > 0.3) {
        if (this.audio.hasSound('zap')) {
          this.audio.play('zap', {
            bus: 'ambience',
            position: b.source.position,
            gain: 0.3,
            reverb: 0.25,
            rate: this.rng.range(0.9, 1.12),
          });
        }
        b.lastZap = t;
      }
      b.prevLevel = level;
    }
  }

  /** Stop all active loops and unsubscribe from sample-load events. */
  dispose(): void {
    this.offSample();
    for (const b of this.beds) b.handle.stop(0);
    this.beds = [];
    this.clearBuzzers(0);
    this.scheduler = null;
    this.activePreset = null;
  }

  // ---------------------------------------------------------------- internals

  private effectivePreset(base: AmbiencePresetId): AmbiencePresetId {
    const spec: AmbiencePreset = AMBIENCE_PRESETS[base];
    if (this.phase === 'blackout' && spec.blackoutPreset && isAmbiencePreset(spec.blackoutPreset)) {
      return spec.blackoutPreset;
    }
    if (this.phase === 'lockdown' && spec.lockdownPreset && isAmbiencePreset(spec.lockdownPreset)) {
      return spec.lockdownPreset;
    }
    return base;
  }

  private phaseGainScale(): number {
    if (!this.activePreset || !this.powerRestored) return 1;
    const spec: AmbiencePreset = AMBIENCE_PRESETS[this.activePreset];
    return spec.restoredGainScale ?? 1;
  }

  private transitionTo(next: AmbiencePresetId, fadeSeconds: number): void {
    if (next === this.activePreset && this.beds.length > 0) return;
    if (next === this.activePreset && AMBIENCE_PRESETS[next].beds.length === 0) return;

    const prevBeds = this.beds;
    this.beds = [];
    for (const b of prevBeds) b.handle.stop(fadeSeconds);

    this.activePreset = next;
    const spec = AMBIENCE_PRESETS[next];
    const tc = Math.max(0.05, fadeSeconds * 0.45);
    const modeScale = MODE_SCALE[this.mode].scale * this.phaseGainScale();

    for (const layer of spec.beds) {
      const active = this.startBedLayer(layer, 0);
      if (!active) continue;
      this.beds.push(active);
      active.handle.setGain(layer.gain * modeScale * this.breathFactor(this.lastTime), tc);
    }

    this.rebuildScheduler(spec);
  }

  private startBedLayer(spec: BedLayerSpec, initialGain: number): ActiveBed | null {
    const sampleReady = this.audio.hasSample(spec.sample) && this.audio.hasSound(spec.sample);
    const sound: SoundName = sampleReady ? spec.sample : spec.fallback;
    if (!this.audio.hasSound(sound)) return null;
    const opts: VoiceOptions = {
      bus: 'ambience',
      gain: initialGain,
      ...(spec.rate !== undefined ? { rate: spec.rate } : {}),
      ...(spec.cutoff !== undefined ? { cutoff: spec.cutoff } : {}),
      ...(spec.muffled ? { muffled: true } : {}),
    };
    return {
      spec,
      usingSample: sampleReady,
      handle: this.audio.loop(sound, opts),
    };
  }

  private handleSampleLoaded(name: SampleName): void {
    const modeScale = MODE_SCALE[this.mode].scale;
    const bedScale = modeScale * this.phaseGainScale();
    const breath = this.breathFactor(this.lastTime);

    // Hot-swap any active bed layer waiting for its recorded ElevenLabs sample.
    for (let i = 0; i < this.beds.length; i++) {
      const b = this.beds[i]!;
      if (!b.usingSample && b.spec.sample === name && this.audio.hasSound(name)) {
        const replacement = this.startBedLayer(b.spec, 0);
        if (!replacement) continue;
        b.handle.stop(1.0);
        replacement.handle.setGain(b.spec.gain * bedScale * breath, 0.45);
        this.beds[i] = replacement;
      }
    }

    // The backup-lamp hum is recorded only: once it decodes, bind it to the room's lit backup lamps.
    if (name === 'backupHum' && this.roomLightSources.some((l) => (l.light.power ?? 1) < 1)) this.bindRoomLights(this.roomLightSources);

    // Hot-swap active fluorescent buzzers when the ElevenLabs buzz clip finishes decoding.
    if (name === 'fluorescentBuzz' && this.audio.hasSound('fluorescentBuzz')) {
      for (const b of this.buzzers) {
        if (b.usingSample) continue;
        const level = b.source.light.level;
        const nextHandle = this.audio.loop('fluorescentBuzz', {
          bus: 'ambience',
          gain: 0,
          position: b.source.position,
          rate: b.rate,
        });
        b.handle.stop(0.4);
        nextHandle.setGain(b.baseGain * level * modeScale, 0.2);
        b.handle = nextHandle;
        b.usingSample = true;
      }
    }
  }

  private rebuildScheduler(preset: AmbiencePreset): void {
    const allowed = preset.oneshots.filter((s) => !s.phases || s.phases.includes(this.phase));
    if (allowed.length === 0) {
      this.scheduler = null;
      return;
    }
    const sched = new Scheduler(this.rng.fork(`oneshots:${this.activePreset ?? 'none'}:${this.phase}`));
    for (const shot of allowed) {
      sched.add(shot.every, () => this.fireOneShot(shot));
    }
    this.scheduler = sched;
  }

  private fireOneShot(shot: AmbienceOneShot): void {
    if (this.mode !== 'playing') return;
    const sound = this.audio.hasSound(shot.sound) ? shot.sound : shot.fallback;
    if (!sound || !this.audio.hasSound(sound)) return;

    const pos = this.placeOneShot(shot.placement);
    const rate = shot.rateRange ? this.rng.range(shot.rateRange[0], shot.rateRange[1]) : 1;
    this.audio.play(sound, {
      bus: 'ambience',
      position: pos,
      gain: shot.gain * this.rng.range(0.82, 1.12),
      ...(shot.muffled ? { muffled: true } : {}),
      ...(shot.reverb !== undefined ? { reverb: shot.reverb } : {}),
      rate,
    });
  }

  private placeOneShot(placement: OneShotPlacement): THREE.Vector3 {
    const angle = this.rng.range(0, Math.PI * 2);
    const p = this.listenerPos;
    switch (placement) {
      case 'near': {
        const r = this.rng.range(2.2, 4.8);
        return new THREE.Vector3(p.x + Math.cos(angle) * r, p.y + this.rng.range(-0.4, 0.8), p.z + Math.sin(angle) * r);
      }
      case 'ceiling': {
        const r = this.rng.range(2.0, 6.5);
        return new THREE.Vector3(p.x + Math.cos(angle) * r, p.y + this.rng.range(1.8, 3.6), p.z + Math.sin(angle) * r);
      }
      case 'perimeter': {
        const r = this.rng.range(4.5, 9.5);
        return new THREE.Vector3(p.x + Math.cos(angle) * r, p.y + this.rng.range(-1.2, 1.4), p.z + Math.sin(angle) * r);
      }
      case 'far': {
        const r = this.rng.range(9.5, 17.0);
        return new THREE.Vector3(p.x + Math.cos(angle) * r, p.y + this.rng.range(-3.0, 3.5), p.z + Math.sin(angle) * r);
      }
    }
  }

  private bindRoomLights(all: readonly AmbienceLightSource[]): void {
    this.roomLightSources = all;
    this.clearBuzzers(0.35);
    this.bindBackupHums(all);
    // Lamps are not fluorescent tubes; lights out or on backup power do not buzz (station-power spec).
    const lights = all.filter((l) => l.kind !== 'pendant' && (l.light.power ?? 1) === 1);
    if (lights.length === 0 || !this.audio.hasSound('fluorescentBuzz')) return;

    // Prioritize flickering/failing tubes so faulty fixtures are always audible, then steady fixtures.
    const ranked = [...lights].sort((a, b) => {
      const aFlicker = a.light.pattern && a.light.pattern !== 'steady' && a.light.pattern !== 'off' ? 1 : 0;
      const bFlicker = b.light.pattern && b.light.pattern !== 'steady' && b.light.pattern !== 'off' ? 1 : 0;
      return bFlicker - aFlicker;
    });

    const modeScale = MODE_SCALE[this.mode].scale;
    const usingSample = this.audio.hasSample('fluorescentBuzz');
    for (const src of ranked.slice(0, MAX_ROOM_BUZZERS)) {
      if (src.light.pattern === 'off') continue;
      const isFaulty = src.light.pattern !== undefined && src.light.pattern !== 'steady';
      const baseGain = isFaulty ? FLICKER_BUZZ_GAIN : STEADY_BUZZ_GAIN;
      const rate = this.rng.range(0.97, 1.03);
      const handle = this.audio.loop('fluorescentBuzz', {
        bus: 'ambience',
        gain: 0,
        position: src.position,
        rate,
      });
      handle.setGain(baseGain * src.light.level * modeScale, 0.25);
      this.buzzers.push({
        source: src,
        handle,
        baseGain,
        rate,
        usingSample,
        prevLevel: src.light.level,
        lastZap: -1,
      });
    }
  }

  /** Under backup power each lit backup lamp hums from its position (in-world-audio spec "Power sounds"). */
  private bindBackupHums(all: readonly AmbienceLightSource[]): void {
    if (!this.audio.hasSound('backupHum')) return;
    const modeScale = MODE_SCALE[this.mode].scale;
    for (const src of all) {
      const power = src.light.power ?? 1;
      if (power <= 0 || power >= 1 || src.light.pattern === 'off') continue;
      if (this.buzzers.length >= MAX_ROOM_BUZZERS) break;
      const rate = this.rng.range(0.98, 1.02);
      const handle = this.audio.loop('backupHum', { bus: 'ambience', gain: 0, position: src.position, rate });
      handle.setGain(BACKUP_HUM_GAIN * (src.light.level / power) * modeScale, 0.4);
      this.buzzers.push({ source: src, handle, baseGain: BACKUP_HUM_GAIN, rate, usingSample: true, prevLevel: src.light.level, lastZap: -1, hum: true });
    }
  }

  private clearBuzzers(fadeSeconds: number): void {
    for (const b of this.buzzers) b.handle.stop(fadeSeconds);
    this.buzzers = [];
  }

  private breathFactor(t: number): number {
    if (!this.activePreset) return 1;
    const br = AMBIENCE_PRESETS[this.activePreset].breathing;
    if (br.depth <= 0) return 1;
    const wave = 0.6 * Math.sin((Math.PI * 2 * t) / br.periodA) + 0.4 * Math.sin((Math.PI * 2 * t) / br.periodB + 1.3);
    return 1 + br.depth * wave;
  }

  private applyBedGains(t: number, tc: number): void {
    const bedScale = MODE_SCALE[this.mode].scale * this.phaseGainScale();
    const breath = this.breathFactor(t);
    for (const b of this.beds) {
      b.handle.setGain(b.spec.gain * bedScale * breath, tc);
    }
  }

  private applyBuzzGains(tc: number): void {
    const modeScale = MODE_SCALE[this.mode].scale;
    for (const b of this.buzzers) {
      const level = b.hum ? b.source.light.level / Math.max(1e-3, b.source.light.power ?? 1) : b.source.light.level;
      b.handle.setGain(b.baseGain * level * modeScale, tc);
    }
  }
}
