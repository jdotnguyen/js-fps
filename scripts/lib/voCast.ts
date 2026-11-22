/**
 * The VO cast: one Gemini TTS voice and one pinned Gemini TTS model per speaker (voice-playback spec,
 * "Each speaker's pinned model is recorded with their voice"). Both `scripts/vo-generate.ts` and
 * `scripts/vo-reactions.ts` read this, so a speaker's model is never chosen anywhere else.
 * Changing a speaker's `model` is a recast: re-record all of their lines (docs/voice-casting-standard.md).
 */

export type TtsModel = 'gemini-2.5-flash-preview-tts' | 'gemini-3.1-flash-tts-preview' | 'gemini-3.8-flash-tts';

export interface CastMember {
  /** Speaker name used inside multi-speaker TTS prompts. */
  label: string;
  /** Gemini prebuilt voice name. */
  voice: string;
  /** The only model this speaker's lines are generated on. */
  model: TtsModel;
  profile: string;
  /**
   * Accent stated in every prompt. Without one the model picks an accent from context, and a short retake can
   * drift (2026-11-21: a one-line Heins retake came out Australian). Set it from listening to the speaker's
   * existing lines, never by guessing.
   */
  accent?: string;
}

export const CAST: Readonly<Record<string, CastMember>> = {
  engineer: {
    label: 'Giles',
    voice: 'Algenib',
    model: 'gemini-2.5-flash-preview-tts',
    profile: 'August Giles, 42, weathered deep-sea systems engineer, blue-collar, gravelly warmth, wry dry humour hiding exhaustion and nerves.',
  },
  medic: {
    label: 'Okafor',
    voice: 'Charon',
    model: 'gemini-2.5-flash-preview-tts',
    profile: 'Dr. Tomas Okafor, 50s, deep warm calm trauma surgeon; disciplined, measured authority; voice drops quiet when genuinely afraid.',
  },
  player: {
    label: 'Jay',
    voice: 'Orus',
    model: 'gemini-3.1-flash-tts-preview',
    profile: 'Jay, 30s, steady grounded station security officer; kind, attentive, conversational lower-mid male voice.',
  },
  nurse: {
    label: 'Priya',
    voice: 'Sulafat',
    model: 'gemini-3.1-flash-tts-preview',
    profile: 'Priya Anand, 29, warm cheerful sharp medical nurse; friendly, competent, affectionate teasing with coworkers.',
  },
  chief: {
    label: 'Heins',
    voice: 'Kore',
    model: 'gemini-3.1-flash-tts-preview',
    profile: 'Katie Heins, 38, no-nonsense security chief; crisp, brisk, firm, slightly annoyed by corporate secrecy.',
    accent: 'General American',
  },
  director: {
    label: 'Hale',
    voice: 'Rasalgethi',
    model: 'gemini-3.1-flash-tts-preview',
    profile: 'Director Hale, 48, smooth polished corporate station administrator; calm and rehearsed on intercom, clipped and nervous under stress.',
  },
  pa: {
    label: 'StationPA',
    voice: 'Gacrux',
    model: 'gemini-3.1-flash-tts-preview',
    profile: 'TAG Industries automated station PA voice; smooth, mature, calm, overly polite, detached retro-corporate announcement.',
  },
  crew_ruiz: {
    label: 'Ruiz',
    voice: 'Aoede',
    model: 'gemini-3.1-flash-tts-preview',
    profile: 'Ines Ruiz, 30s, relaxed breezy comms technician; friendly morning banter.',
  },
  crew_cook: {
    label: 'Bram',
    voice: 'Enceladus',
    model: 'gemini-3.1-flash-tts-preview',
    profile: 'Bram, 45, dry deadpan station cook; raspy, tired, wry humour.',
  },
  crew_sung: {
    label: 'Sung',
    voice: 'Achird',
    model: 'gemini-3.1-flash-tts-preview',
    profile: 'Sung, 30, friendly station diver just returning from shore leave; warm, easygoing.',
  },
  crew_lab: {
    label: 'Voss',
    voice: 'Leda',
    model: 'gemini-3.8-flash-tts',
    profile: 'Dr. Lena Voss, 34, sharp anxious microbiologist; terrified and pleading when infected.',
  },
  crew_botanist: {
    label: 'Botanist',
    voice: 'Puck',
    model: 'gemini-3.1-flash-tts-preview',
    profile: 'Station hydroponics botanist; conversational, dryly amused, slightly exasperated.',
  },
  crew_assistant: {
    label: 'Assistant',
    voice: 'Despina',
    model: 'gemini-3.8-flash-tts',
    profile: 'Director Hale administrative assistant; quiet, tense, anxious around corporate secrets.',
  },
  crew_mess: {
    label: 'Crew',
    voice: 'Fenrir',
    model: 'gemini-3.8-flash-tts',
    profile: 'Casual off-shift station crew member in the mess hall; wry morning greeting.',
  },
  crew_maint: {
    label: 'Maint',
    voice: 'Iapetus',
    model: 'gemini-3.8-flash-tts',
    profile: 'Tired maintenance tech in the dive bay; practical, low-key warning.',
  },
  crew_dock_guard: {
    label: 'Guard',
    voice: 'Alnilam',
    model: 'gemini-3.1-flash-tts-preview',
    profile: '40s, dock security guard who has scanned the same crew every morning for years; patient, dry, warm under the routine.',
  },
};

/** The cast entry for `speaker`. Throws before any request is made when the speaker has none. */
export function castFor(speaker: string): CastMember {
  const c = CAST[speaker];
  if (!c) throw new Error(`No cast entry for speaker "${speaker}": add them to scripts/lib/voCast.ts with a voice and a pinned model`);
  return c;
}

/** The speaker's profile as it goes into a prompt, with their accent pinned when they have one. */
export function promptProfile(speaker: string): string {
  const c = castFor(speaker);
  return c.accent ? `${c.profile} Speaks with a ${c.accent} accent on every line; never any other accent.` : c.profile;
}

/** The one model shared by every speaker in a batch. Throws if they differ, since one request runs on one model. */
export function batchModel(speakers: readonly string[]): TtsModel {
  const models = new Set(speakers.map((s) => castFor(s).model));
  if (models.size !== 1) throw new Error(`Speakers [${speakers.join(', ')}] are pinned to different models (${[...models].join(', ')}); record them in separate batches`);
  return [...models][0]!;
}
