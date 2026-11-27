import { arr, bool, nullable, numRange, obj, oneOf, optional, record, str, type Infer, type Validator, ValidationError } from '../../core/validate.ts';

/** Dialogue data: lines in data/dialogue/<chapter>.json, voices in speakers.json. */

export const EMOTES = ['neutral', 'question', 'urgent', 'alarmed', 'pained', 'relieved', 'laugh', 'whisper', 'dread', 'scream'] as const;
export type Emote = (typeof EMOTES)[number];

export const CHANNELS = ['local', 'radio', 'pa'] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * Lowest first. Higher interrupts lower; equal queues. `background` is overheard crew talk: it gives way to every other
 * line, whatever the conversation (dialogue-channels: Background lines give way to every other line).
 */
export const PRIORITIES = ['background', 'idle', 'combat', 'hint', 'story'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const priorityRank = (p: Priority): number => PRIORITIES.indexOf(p);

/** Speaker ids that `crew_<anything>` resolves to. */
export const CREW_PREFIX = 'crew_';

/** Single path or non-empty list of variant paths under public/ (e.g. reaction/scream pools). */
const audioPath: Validator<string | string[]> = (v, p) => {
  if (typeof v === 'string') {
    if (v.trim() === '') throw new ValidationError(p, 'empty audio path');
    return v;
  }
  const list = arr(str)(v, p);
  if (list.length === 0) throw new ValidationError(p, 'audio variant array must not be empty');
  return list;
};

/** Normalize a line's `audio` field into 0, 1, or N asset URLs. */
export function audioUrls(audio: DialogueLine['audio']): readonly string[] {
  if (audio === null) return [];
  return typeof audio === 'string' ? [audio] : audio;
}

const lineShape = {
  id: str,
  speaker: str,
  /** Optional explicit addressee ('player', an NPC id, or a speaker id) for listen-look gaze. */
  to: optional(str),
  text: str,
  /** Required unless `audio` is set. */
  emote: nullable(oneOf(EMOTES)),
  /** Acting direction for VO generation only (never shown or spoken): how this one line is delivered. */
  direction: optional(str),
  babble: optional(bool),
  /** Play the station's two-tone chime before the announcement. */
  paChime: optional(bool),
  channel: oneOf(CHANNELS),
  priority: oneOf(PRIORITIES),
  /** Path (or variant array) under public/, e.g. "assets/vo/giles_cover_01.mp3". Plays instead of the emote. */
  audio: nullable(audioPath),
  minDuration: numRange(0, 30),
  /** Loudness multiplier for this line (a shout across a room over an alarm); default 1. */
  gain: optional(numRange(0.05, 4)),
  /** `false`: never subtitled (Jay's wordless reaction to a hit). `text` is still required, for tools. */
  subtitle: optional(bool),
  /** Reserved for the dialogue-choice system; must be empty in the slice. */
  choices: arr(str),
};
export type DialogueLine = Infer<typeof lineShape>;

const validateLineShape = obj(lineShape);

export const validateLine: Validator<DialogueLine> = (v, p) => {
  const line = validateLineShape(v, p);
  if (!/^[a-z0-9_]+$/.test(line.id)) throw new ValidationError(`${p} > id`, `"${line.id}" must be lower_snake_case`);
  if (line.text.trim() === '') throw new ValidationError(`${p} > text`, 'empty subtitle text');
  if (line.emote === null && line.audio === null) throw new ValidationError(`${p} > emote`, 'emote is required unless audio is set');
  if (line.choices.length > 0) throw new ValidationError(`${p} > choices`, 'dialogue choices are not in the slice; must be []');
  return line;
};

const chapterShape = {
  chapter: str,
  lines: arr(validateLine),
};
export type DialogueChapter = Infer<typeof chapterShape>;
export const validateChapter: Validator<DialogueChapter> = obj(chapterShape);

/** Voice profile for the vocal synth. Every number is a multiplier or 0..1 amount. */
const voiceShape = {
  name: str,
  kind: oneOf(['voice', 'chime'] as const),
  /** Base pitch in Hz (ignored for chimes). */
  f0: numRange(40, 600),
  /** Formant scale: 1 = adult male reference, >1 brighter / smaller vocal tract. */
  formants: numRange(0.7, 1.5),
  /** Time stretch of every emote: >1 slower. */
  tempo: numRange(0.5, 2),
  /** Attack time multiplier: <1 snappier. */
  attack: numRange(0.2, 3),
  /** Breath noise mixed under the voice. */
  breath: numRange(0, 1),
  /** Roughness: jitter + subharmonic (Giles's foreshadowing raises this at runtime). */
  rasp: numRange(0, 1),
  /** Saturator drive. */
  drive: numRange(0, 1),
  /** Second detuned source (infected voices). */
  detune: numRange(0, 1),
  /** Brightness: lowpass cutoff in Hz after the formants. */
  brightness: numRange(1500, 12000),
  /** Default channel for lines that don't need a specific one (informational). */
  channel: oneOf(CHANNELS),
  /** Seeded spread for generated speakers (crew_*): f0 +/- this fraction, formants +/- half of it. */
  spread: optional(numRange(0, 0.6)),
};
export type VoiceProfile = Infer<typeof voiceShape>;
const validateVoice = obj(voiceShape);

export const validateSpeakers: Validator<Record<string, VoiceProfile>> = (v, p) => {
  const table = record(validateVoice)(v, p);
  for (const required of ['engineer', 'medic', 'pa', 'crew', 'infected']) {
    if (!(required in table)) throw new ValidationError(`${p} > ${required}`, 'missing required speaker');
  }
  return table;
};
