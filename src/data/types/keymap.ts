import { arr, obj, str, type Validator } from '../../core/validate.ts';

export const ACTIONS = [
  'moveForward', 'moveBack', 'moveLeft', 'moveRight', 'sprint',
  'fire', 'aim', 'reload', 'interact', 'shove', 'flashlight',
  'weapon1', 'weapon2', 'objective', 'navPulse', 'map', 'pause', 'skipCutscene',
  'flyUp', 'flyDown',
] as const;

export type Action = (typeof ACTIONS)[number];

/** Each action maps to one or more `KeyboardEvent.code`s or `Mouse0`/`Mouse1`/`Mouse2`. */
export type Keymap = Record<Action, string[]>;

const shape = Object.fromEntries(ACTIONS.map((a) => [a, arr(str)])) as Record<Action, Validator<string[]>>;

export const validateKeymap: Validator<Keymap> = obj(shape);
