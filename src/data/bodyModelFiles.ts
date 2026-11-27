import generic from './body-models.json' with { type: 'json' };
import bram from './cast/bram/body.json' with { type: 'json' };
import giles from './cast/giles/body.json' with { type: 'json' };
import hale from './cast/hale/body.json' with { type: 'json' };
import heins from './cast/heins/body.json' with { type: 'json' };
import okafor from './cast/okafor/body.json' with { type: 'json' };
import priya from './cast/priya/body.json' with { type: 'json' };
import ruiz from './cast/ruiz/body.json' with { type: 'json' };
import sung from './cast/sung/body.json' with { type: 'json' };
import { mergeTables } from './mergeFiles.ts';

/**
 * Every body model file: the generic crew and infected bodies (body-models.json, listed first: spawns pick from them in table
 * order), then each named character's own body (cast/<name>/body.json). Add a new file here.
 */
export const BODY_MODEL_FILES = [
  ['data/body-models.json', generic],
  ['data/cast/bram/body.json', bram],
  ['data/cast/giles/body.json', giles],
  ['data/cast/hale/body.json', hale],
  ['data/cast/heins/body.json', heins],
  ['data/cast/okafor/body.json', okafor],
  ['data/cast/priya/body.json', priya],
  ['data/cast/ruiz/body.json', ruiz],
  ['data/cast/sung/body.json', sung],
] as const;

/** All body models as one table; loading fails on an id two files define. */
export const bodyModelsJson = mergeTables(BODY_MODEL_FILES, 'body model');
