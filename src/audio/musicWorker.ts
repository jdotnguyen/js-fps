/**
 * Renders the menu theme off the main thread (ADR-0013). The 64 s stereo loop takes seconds to
 * synthesise, which would freeze boot, so main.ts starts this worker and the music fades in
 * when it reports back.
 */
import { Rng } from '../core/rng.ts';
import { renderMenuTheme } from './music.ts';

/** 32 kHz is plenty (the track has almost nothing above 4 kHz) and renders ~2x faster than 48. */
export const MUSIC_RENDER_RATE = 32000;

export interface MusicRendered {
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
  sampleRate: number;
}

self.onmessage = (): void => {
  const { left, right } = renderMenuTheme(MUSIC_RENDER_RATE, new Rng('music:menuTheme'));
  const msg: MusicRendered = { left, right, sampleRate: MUSIC_RENDER_RATE };
  self.postMessage(msg, { transfer: [left.buffer, right.buffer] });
};
