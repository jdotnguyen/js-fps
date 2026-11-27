import type { EventBus } from './events.ts';

/** Setting `tutorialPrompts` (ADR-0025): First time only / Always / Off. */
export const TUTORIAL_MODES = ['first', 'always', 'off'] as const;
export type TutorialMode = (typeof TUTORIAL_MODES)[number];

/** Physics features (adopt-physics-engine, design D9). */
export const PHYSICS_FEATURES = ['debris', 'ragdoll', 'powered', 'interact'] as const;
export type PhysicsFeature = (typeof PHYSICS_FEATURES)[number];
export type PhysicsSwitches = Readonly<Record<PhysicsFeature, boolean>>;
export const PHYSICS_OFF: PhysicsSwitches = Object.freeze({ debris: false, ragdoll: false, powered: false, interact: false });
/** What a player starts with: severed debris and physical interaction. The ragdoll features are not built yet. */
export const PHYSICS_DEFAULT: PhysicsSwitches = Object.freeze({ debris: true, ragdoll: false, powered: false, interact: true });
/**
 * Saved beside the settings, and bumped when a physics default changes: a save records every switch, so without this
 * one written under the old default would keep the feature off.
 */
export const PHYSICS_REVISION = 1;

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
  /** The visor HUD's strength, 0.4..1 (visor-hud spec "HUD settings"). */
  hudOpacity: number;
  /** The visor HUD's size, 0.75..1.5. */
  hudScale: number;
  /** The panels dim when nothing is happening. */
  calmHud: boolean;
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
  hudOpacity: 0.85,
  hudScale: 1,
  calmHud: true,
  physics: PHYSICS_DEFAULT,
});

const STORAGE_KEY = 'js-fps:settings:v1';

/** Numbers that only count inside their range; a stored value outside it falls back to the default. */
export const SETTING_RANGES = {
  skipHoldSeconds: [1.5, 6],
  hudOpacity: [0.4, 1],
  hudScale: [0.75, 1.5],
} as const;

/**
 * Keep stored values only when they have the same type as the default
 * (and are a known option for string unions), so a bad save can't break boot.
 */
export function mergeSettings(stored: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, physics: { ...PHYSICS_DEFAULT } };
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
    const range = (SETTING_RANGES as Partial<Record<keyof Settings, readonly [number, number]>>)[key];
    if (range && ((v as number) < range[0] || (v as number) > range[1])) continue;
    (out as unknown as Record<string, unknown>)[key] = v;
  }
  out.physics = mergePhysicsSwitches(src['physicsRevision'] === PHYSICS_REVISION ? src['physics'] : undefined);
  return out;
}

/** Field by field: only known features with boolean values survive; the rest keep their default. */
export function mergePhysicsSwitches(stored: unknown): PhysicsSwitches {
  const out: Record<PhysicsFeature, boolean> = { ...PHYSICS_DEFAULT };
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this.value, physicsRevision: PHYSICS_REVISION }));
    } catch {
      /* not persisted; fine for this session */
    }
    this.events.emit('settings:changed', { key });
  }
}
