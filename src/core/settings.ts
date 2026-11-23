import type { EventBus } from './events.ts';

/** Setting `tutorialPrompts` (ADR-0025): First time only / Always / Off. */
export const TUTORIAL_MODES = ['first', 'always', 'off'] as const;
export type TutorialMode = (typeof TUTORIAL_MODES)[number];

/** Physics features (adopt-physics-engine, design D9). Each stays off until its block's gate passes. */
export const PHYSICS_FEATURES = ['debris', 'ragdoll', 'powered', 'interact'] as const;
export type PhysicsFeature = (typeof PHYSICS_FEATURES)[number];
export type PhysicsSwitches = Readonly<Record<PhysicsFeature, boolean>>;
export const PHYSICS_OFF: PhysicsSwitches = Object.freeze({ debris: false, ragdoll: false, powered: false, interact: false });

/** Player settings persisted to localStorage. Grows with ADR-0012. */
export interface Settings {
  mouseSensitivity: number;
  invertY: boolean;
  fov: number;
  quality: 'low' | 'medium' | 'high';
  subtitles: boolean;
  reducedFlashing: boolean;
  reducedMotion: boolean;
  masterVolume: number;
  /** Bus volumes 0..1 (spec audio-mix: Volume settings). SFX covers sfx, ambience and ui. */
  musicVolume: number;
  sfxVolume: number;
  voiceVolume: number;
  filmGrain: boolean;
  /** Exposure follows how bright the view is (post-processing spec "Eye adaptation"); off keeps it fixed. */
  eyeAdaptation: boolean;
  /** Seconds the skip key is held to skip a cutscene (intro-sequence spec). */
  skipHoldSeconds: number;
  /** One press starts the skip countdown instead of holding the key (intro-sequence spec). */
  skipAssist: boolean;
  /** Tutorial pop-ups: first time only (per profile), always, or off (ADR-0025). */
  tutorialPrompts: TutorialMode;
  /** Physics feature switches; a `?physics=` URL flag overrides them for one session (`physics/switches.ts`). */
  physics: PhysicsSwitches;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  mouseSensitivity: 1,
  invertY: false,
  fov: 80,
  quality: 'medium',
  subtitles: true,
  reducedFlashing: false,
  reducedMotion: false,
  masterVolume: 0.8,
  musicVolume: 1,
  sfxVolume: 1,
  voiceVolume: 1,
  filmGrain: true,
  eyeAdaptation: true,
  skipHoldSeconds: 3,
  skipAssist: false,
  tutorialPrompts: 'first',
  physics: PHYSICS_OFF,
});

const STORAGE_KEY = 'js-fps:settings:v1';

/**
 * Keep stored values only when they have the same type as the default
 * (and are a known option for string unions), so a bad save can't break boot.
 */
export function mergeSettings(stored: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, physics: { ...PHYSICS_OFF } };
  if (typeof stored !== 'object' || stored === null) return out;
  const src = stored as Record<string, unknown>;
  const qualities: readonly string[] = ['low', 'medium', 'high'];
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    if (key === 'physics') continue;
    const v = src[key];
    if (typeof v !== typeof DEFAULT_SETTINGS[key]) continue;
    if (key === 'quality' && !qualities.includes(v as string)) continue;
    if (key === 'tutorialPrompts' && !(TUTORIAL_MODES as readonly unknown[]).includes(v)) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    if (key.endsWith('Volume') && ((v as number) < 0 || (v as number) > 1)) continue;
    if (key === 'skipHoldSeconds' && ((v as number) < 1.5 || (v as number) > 6)) continue;
    (out as unknown as Record<string, unknown>)[key] = v;
  }
  out.physics = mergePhysicsSwitches(src['physics']);
  return out;
}

/** Field by field: only known features with boolean values survive; the rest keep their default (off). */
export function mergePhysicsSwitches(stored: unknown): PhysicsSwitches {
  const out: Record<PhysicsFeature, boolean> = { ...PHYSICS_OFF };
  if (typeof stored !== 'object' || stored === null) return out;
  const src = stored as Record<string, unknown>;
  for (const f of PHYSICS_FEATURES) if (typeof src[f] === 'boolean') out[f] = src[f];
  return out;
}

export class SettingsStore {
  private value: Settings;
  private readonly events: EventBus;

  constructor(events: EventBus) {
    this.events = events;
    let stored: unknown = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      stored = raw ? JSON.parse(raw) : null;
    } catch {
      stored = null; // storage blocked or corrupt: use defaults
    }
    this.value = mergeSettings(stored);
  }

  get(): Readonly<Settings> {
    return this.value;
  }

  set<K extends keyof Settings>(key: K, v: Settings[K]): void {
    this.value = { ...this.value, [key]: v };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.value));
    } catch {
      /* not persisted; fine for this session */
    }
    this.events.emit('settings:changed', { key });
  }
}
