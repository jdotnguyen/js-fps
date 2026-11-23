/**
 * voice-playback "A scene can project a voice": while projected, a speaker's local lines are no quieter than at a set
 * distance. A local voice's panner falls off as `ref / d` past its reference distance (inverse model, rolloff 1), so
 * holding the level of distance `at` beyond it is a gain of `d / at`. Nearer than `at` the voice plays as normal, so it
 * never sounds closer than the speaker is.
 */

/** The local voice panner's reference distance (WebAudioVoicePlayer). */
export const LOCAL_VOICE_REF_M = 1.5;

/** Highest boost a projected voice is given (about 30 m away at 3.5 m). */
export const MAX_PROJECTION_GAIN = 8;

/** Gain that makes a voice `distance` m away as loud as one `at` m away; 1 when nearer than `at`. */
export function projectionGain(distance: number, at: number): number {
  if (!(distance > at) || !(at > 0)) return 1;
  const ref = LOCAL_VOICE_REF_M;
  const fall = (d: number): number => (d <= ref ? 1 : ref / d);
  return Math.min(MAX_PROJECTION_GAIN, fall(at) / fall(distance));
}
