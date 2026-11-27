import crew from './motion-crew.json' with { type: 'json' };
import bram from './cast/bram/motion.json' with { type: 'json' };
import dockGuard from './cast/dock_guard/motion.json' with { type: 'json' };
import giles from './cast/giles/motion.json' with { type: 'json' };
import hale from './cast/hale/motion.json' with { type: 'json' };
import heins from './cast/heins/motion.json' with { type: 'json' };
import okafor from './cast/okafor/motion.json' with { type: 'json' };
import priya from './cast/priya/motion.json' with { type: 'json' };
import ruiz from './cast/ruiz/motion.json' with { type: 'json' };
import sung from './cast/sung/motion.json' with { type: 'json' };
import voss from './cast/voss/motion.json' with { type: 'json' };
import { mergeTables } from './mergeFiles.ts';

/**
 * Every motion profile file: the crew defaults (motion-crew.json), then each named character's profile
 * (cast/<name>/motion.json). Add a new file here.
 */
export const MOTION_FILES = [
  ['data/motion-crew.json', crew.profiles],
  ['data/cast/bram/motion.json', bram],
  ['data/cast/dock_guard/motion.json', dockGuard],
  ['data/cast/giles/motion.json', giles],
  ['data/cast/hale/motion.json', hale],
  ['data/cast/heins/motion.json', heins],
  ['data/cast/okafor/motion.json', okafor],
  ['data/cast/priya/motion.json', priya],
  ['data/cast/ruiz/motion.json', ruiz],
  ['data/cast/sung/motion.json', sung],
  ['data/cast/voss/motion.json', voss],
] as const;

/** All profiles as one profile file; loading fails on an id two files define. */
export const motionProfilesJson = { defaults: crew.defaults, profiles: mergeTables(MOTION_FILES, 'motion profile') };
