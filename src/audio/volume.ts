import type { BusName } from './engine.ts';

/** Bus volume settings and the buses each one controls (spec audio-mix: Volume settings). */
export const VOLUME_BUSES = {
  musicVolume: ['music'],
  sfxVolume: ['sfx', 'ambience', 'ui'],
  voiceVolume: ['voice'],
} as const satisfies Record<string, readonly BusName[]>;

export type BusVolumeSettings = Record<keyof typeof VOLUME_BUSES, number>;

/** Apply the player's music / SFX / voice settings to their buses. */
export function applyBusVolumes(audio: { setBusVolume(bus: BusName, v: number): void }, s: BusVolumeSettings): void {
  for (const key of Object.keys(VOLUME_BUSES) as Array<keyof typeof VOLUME_BUSES>) {
    for (const bus of VOLUME_BUSES[key]) audio.setBusVolume(bus, s[key]);
  }
}
