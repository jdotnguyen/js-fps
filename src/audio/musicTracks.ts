/**
 * Music tracks a sequence `music` step can start (spec in-world-audio: Sequence sound steps).
 * `main_theme` is the menu theme "Pressure" (music.ts). Tension music adds its ids here.
 */
export const MUSIC_TRACKS = ['main_theme'] as const;
export type MusicTrack = (typeof MUSIC_TRACKS)[number];
