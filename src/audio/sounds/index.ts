/**
 * The sound registry, combined from one file per area. A sound's procedural spec and its recorded sample go in the same
 * area file. This list changes only when an area is added; ../soundAreas.test.ts fails on a name two areas define.
 * Written by hand: a glob would lose the literal names `SoundName` is built from, and Node has no `import.meta.glob`.
 */
import * as weapons from './weapons.ts';
import * as ui from './ui.ts';
import * as creatures from './creatures.ts';
import * as footsteps from './footsteps.ts';
import * as flood from './flood.ts';
import * as commons from './commons.ts';
import * as impacts from './impacts.ts';
import * as kills from './kills.ts';
import * as player from './player.ts';
import * as ambience from './ambience.ts';
import * as docks from './docks.ts';
import * as power from './power.ts';
import * as transit from './transit.ts';
import * as roomLife from './roomLife.ts';
import * as doors from './doors.ts';

export type { SoundSpec } from '../synth.ts';
export { ZOMBIE_SPLASH_VARIANT } from './creatures.ts';

/**
 * Procedural sounds: fallbacks until recorded files load (spec audio-assets). Each generator renders a mono buffer from a
 * seeded RNG, so sounds are identical on every machine and need no audio files.
 * Loops are seamless; periodic parts complete whole cycles over the loop length.
 */
export const SOUND_SPECS = {
  ...weapons.specs,
  ...ui.specs,
  ...footsteps.specs,
  ...flood.specs,
  ...kills.specs,
  ...player.specs,
  ...ambience.specs,
};

/**
 * Recorded one-shots loaded from public/assets/audio/. A sample with the same name as a procedural
 * sound replaces it once loaded (the procedural version stays as the fallback until then). An array
 * of URLs loads as variants, one picked at random per play.
 */
export const SAMPLE_URLS = {
  ...weapons.samples,
  ...ui.samples,
  ...creatures.samples,
  ...footsteps.samples,
  ...flood.samples,
  ...commons.samples,
  ...impacts.samples,
  ...kills.samples,
  ...player.samples,
  ...ambience.samples,
  ...docks.samples,
  ...power.samples,
  ...transit.samples,
  ...roomLife.samples,
  ...doors.samples,
};

export type SampleName = keyof typeof SAMPLE_URLS;
export type SoundName = keyof typeof SOUND_SPECS | SampleName;
