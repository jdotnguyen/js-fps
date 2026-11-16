import type { EventBus } from './events.ts';

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
  filmGrain: boolean;
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
  filmGrain: true,
});

const STORAGE_KEY = 'js-fps:settings:v1';

/**
 * Keep stored values only when they have the same type as the default
 * (and are a known option for string unions), so a bad save can't break boot.
 */
export function mergeSettings(stored: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (typeof stored !== 'object' || stored === null) return out;
  const src = stored as Record<string, unknown>;
  const qualities: readonly string[] = ['low', 'medium', 'high'];
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    const v = src[key];
    if (typeof v !== typeof DEFAULT_SETTINGS[key]) continue;
    if (key === 'quality' && !qualities.includes(v as string)) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    (out as unknown as Record<string, unknown>)[key] = v;
  }
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
