import { ValidationError, arr, bool, num, numRange, obj, optional, record, str, tuple3, type Infer, type Validator } from '../../core/validate.ts';

/**
 * Scored set pieces (adaptive-music spec, `data/scores.json`). A score is a set of layers that loop together on one
 * clock, plus one-shot stingers. Cues set every layer's level at once: a layer a cue does not name goes to silence.
 * A cue named like a bus event (`kill:arch`) fires on that event; any cue can also be set by the `score` sequence step.
 */

const gain = numRange(0, 2);

const cueShape = {
  /** Seconds for layers to settle on their new levels (ignored with `cut`). */
  fade: optional(numRange(0, 20)),
  /** Level per layer (0..2); layers left out go silent. */
  layers: optional(record(gain)),
  /** Stop every layer at once, with no fade. */
  cut: optional(bool),
  /** A stinger to play when the cue lands. */
  stinger: optional(str),
  /** Turn the distance tie on or off (left out: keep it as it is). */
  distance: optional(bool),
  /** Stop the score and free its audio this many seconds after the cue. */
  release: optional(numRange(0, 60)),
};

const scoreShape = {
  /** Seconds per beat. */
  beat: numRange(0.1, 4),
  beatsPerBar: numRange(1, 16),
  /** Loop length in bars: every layer is this long. */
  bars: numRange(1, 64),
  /** Overall level of the score on the music bus (the bus itself sits low for the menu theme, so scores lift it). */
  level: optional(numRange(0, 8)),
  layers: arr(str),
  /** Stinger name -> level. */
  stingers: record(gain),
  cues: record(obj(cueShape)),
  /** Layers tied to the player's distance from a target while a cue has the tie on. */
  distance: optional(
    obj({
      /** Sequence target (`door:<id>`, `anchor:<id>`, ...) or an [x, y, z] point. */
      target: (v: unknown, p: string): string | [number, number, number] => (Array.isArray(v) ? tuple3()(v, p) : str(v, p)),
      far: numRange(0, 500),
      near: numRange(0, 500),
      /** Layer -> [level when far, level when near]. */
      layers: record((v, p) => {
        const t = arr(gain)(v, p);
        if (t.length !== 2) throw new ValidationError(p, 'expected [far, near]');
        return [t[0]!, t[1]!] as [number, number];
      }),
    }),
  ),
  /** Dip the score briefly when a bus event fires (in-world hits that must be heard). */
  duck: optional(obj({ event: str, db: numRange(-40, 0), hold: numRange(0, 10), recover: numRange(0.01, 10) })),
  /** Checkpoint states the score comes back in, and the cue it starts at. */
  resume: optional(arr(obj({ flags: record((v, p) => (typeof v === 'boolean' ? v : num(v, p))), cue: str }))),
};

export type ScoreCue = Infer<typeof cueShape>;
export type ScoreDef = Infer<typeof scoreShape>;
export type ScoreTable = Record<string, ScoreDef>;

export const validateScoreTable: Validator<ScoreTable> = (v, p) => {
  const table = record(obj(scoreShape))(v, p);
  for (const [id, s] of Object.entries(table)) {
    const sp = `${p} > ${id}`;
    const layers = new Set(s.layers);
    if (layers.size !== s.layers.length) throw new ValidationError(`${sp} > layers`, 'duplicate layer');
    for (const [name, cue] of Object.entries(s.cues)) {
      const cp = `${sp} > cues > ${name}`;
      for (const l of Object.keys(cue.layers ?? {})) if (!layers.has(l)) throw new ValidationError(`${cp} > layers > ${l}`, `unknown layer "${l}"`);
      if (cue.stinger !== undefined && !(cue.stinger in s.stingers)) throw new ValidationError(`${cp} > stinger`, `unknown stinger "${cue.stinger}"`);
    }
    if (s.distance) {
      for (const l of Object.keys(s.distance.layers)) if (!layers.has(l)) throw new ValidationError(`${sp} > distance > layers > ${l}`, `unknown layer "${l}"`);
      if (s.distance.near >= s.distance.far) throw new ValidationError(`${sp} > distance`, '"near" must be less than "far"');
    }
    for (const [i, r] of (s.resume ?? []).entries()) {
      if (!(r.cue in s.cues)) throw new ValidationError(`${sp} > resume[${i}] > cue`, `unknown cue "${r.cue}"`);
    }
  }
  return table;
};
