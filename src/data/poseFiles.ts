import corpseFamily from './poses/corpse.json' with { type: 'json' };
import gestureFamily from './poses/gesture.json' with { type: 'json' };
import idleFamily from './poses/idle.json' with { type: 'json' };
import infectedFamily from './poses/infected.json' with { type: 'json' };
import killFamily from './poses/kill.json' with { type: 'json' };
import leanFamily from './poses/lean.json' with { type: 'json' };
import maulFamily from './poses/maul.json' with { type: 'json' };
import pryFamily from './poses/pry.json' with { type: 'json' };
import sitFamily from './poses/sit.json' with { type: 'json' };
import squadFamily from './poses/squad.json' with { type: 'json' };
import workFamily from './poses/work.json' with { type: 'json' };
import dockGuard from './cast/dock_guard/poses.json' with { type: 'json' };
import giles from './cast/giles/poses.json' with { type: 'json' };
import okafor from './cast/okafor/poses.json' with { type: 'json' };
import priya from './cast/priya/poses.json' with { type: 'json' };
import ruiz from './cast/ruiz/poses.json' with { type: 'json' };
import voss from './cast/voss/poses.json' with { type: 'json' };
import blade from './creatures/blade/poses.json' with { type: 'json' };
import { mergePoseFiles } from './mergeFiles.ts';

/**
 * Every pose file of the shared skeleton: one per pose family (poses/), one per character with poses of their own (cast/) and
 * one per creature that uses this skeleton (creatures/). Add a new file here. The Juggernaut has its own rig and poses.
 */
export const POSE_FILES = [
  ['data/poses/corpse.json', corpseFamily],
  ['data/poses/gesture.json', gestureFamily],
  ['data/poses/idle.json', idleFamily],
  ['data/poses/infected.json', infectedFamily],
  ['data/poses/kill.json', killFamily],
  ['data/poses/lean.json', leanFamily],
  ['data/poses/maul.json', maulFamily],
  ['data/poses/pry.json', pryFamily],
  ['data/poses/sit.json', sitFamily],
  ['data/poses/squad.json', squadFamily],
  ['data/poses/work.json', workFamily],
  ['data/cast/dock_guard/poses.json', dockGuard],
  ['data/cast/giles/poses.json', giles],
  ['data/cast/okafor/poses.json', okafor],
  ['data/cast/priya/poses.json', priya],
  ['data/cast/ruiz/poses.json', ruiz],
  ['data/cast/voss/poses.json', voss],
  ['data/creatures/blade/poses.json', blade],
] as const;

/** All poses and pose sequences as one file; loading fails on a name two files define. */
export const posesJson = mergePoseFiles(POSE_FILES);
