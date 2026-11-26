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
  // The overheard Commons pairs (in-world-audio spec), recorded one speaker per request (voice-casting-standard §2).
  crew_crew_2: {
    label: 'BarMan',
    voice: 'Umbriel',
    model: 'gemini-3.8-flash-tts',
    profile: 'Off-shift lab hand on a stool at the Commons bar, 30s man; easygoing gossip who notices small odd things; talking quietly to the person beside him.',
  },
  crew_bar_1: {
    label: 'BarWoman',
    voice: 'Autonoe',
    model: 'gemini-3.8-flash-tts',
    profile: 'Off-shift crew member at the Commons bar, 30s woman; dry, unbothered, quick to brush things off; talking quietly to the person beside her.',
  },
  crew_wall_1: {
    label: 'WallWoman',
    voice: 'Vindemiatrix',
    model: 'gemini-3.8-flash-tts',
    profile: 'Station clerk leaning on the Commons wall, 40s woman; practical, mildly teasing, grows uneasy only slowly; talking quietly to a colleague.',
  },
  crew_chat_5: {
    label: 'WallMan',
    voice: 'Schedar',
    model: 'gemini-3.8-flash-tts',
    profile: 'Maintenance engineer standing in the Commons, 40s man; tired, careful, worried by what his readings say; talking quietly to a colleague.',
  },
  // Station blackout radio chatter (station-power spec): voices only heard over the radio, each at a station post.
  radio_ops: {
    label: 'Ops',
    voice: 'Zephyr',
    model: 'gemini-3.8-flash-tts',
    profile: '30s, station comms operator on the open channel, trying to keep order as reports pour in; clipped, professional, fraying.',
  },
  radio_dock: {
    label: 'Dock',
    voice: 'Algieba',
    model: 'gemini-3.8-flash-tts',
    profile: 'Dock security guard calling in from the Docking Ring, out of breath, running and terrified.',
  },
  radio_hydro: {
    label: 'Hydro',
    voice: 'Erinome',
    model: 'gemini-3.8-flash-tts',
    profile: 'Young hydroponics technician hiding in the Grow Hall; crying, whispering into the radio so nothing hears her.',
  },
  radio_launch: {
    label: 'Launch',
    voice: 'Sadaltager',
    model: 'gemini-3.8-flash-tts',
    profile: 'Station diver in the Launch Hall, shouting over rushing water and alarms; panicked, urgent.',
  },
  // Multi-room overheard crew & solo ambient speakers (living-station-audio), recorded single-speaker on 3.8.
  crew_exec_1: {
    label: 'ExecMan',
    voice: 'Zubenelgenubi',
    model: 'gemini-3.8-flash-tts',
    profile: '30s male TAG operations analyst in the Admin Open Office; low-key, cautious corporate gossip, speaking quietly to a coworker.',
  },
  crew_exec_3: {
    label: 'ExecWoman',
    voice: 'Callirrhoe',
    model: 'gemini-3.8-flash-tts',
    profile: '30s female TAG compliance coordinator in the Admin Open Office; dry, observant, lowered voice in an open office.',
  },
  crew_exec_2: {
    label: 'DeskMan',
    voice: 'Sadachbia',
    model: 'gemini-3.8-flash-tts',
    profile: '40s male TAG logistics manager speaking quietly into a desk telephone; polite, tired corporate routine.',
  },
  crew_exec_4: {
    label: 'DeskWoman',
    voice: 'Laomedeia',
    model: 'gemini-3.8-flash-tts',
    profile: '30s female TAG procurement clerk speaking quietly into a desk telephone; brisk, mildly exasperated.',
  },
  crew_board_1: {
    label: 'BoardChair',
    voice: 'Pulcherrima',
    model: 'gemini-3.8-flash-tts',
    profile: '40s female TAG senior VP chairing a closed boardroom meeting; crisp, polished, measured corporate authority.',
  },
  crew_board_2: {
    label: 'BoardLegal',
    voice: 'Achernar',
    model: 'gemini-3.8-flash-tts',
    profile: '40s female TAG legal and risk director in the boardroom; careful, clipped, wary of liability.',
  },
  crew_board_3: {
    label: 'BoardScience',
    voice: 'Fenrir',
    model: 'gemini-3.8-flash-tts',
    profile: '50s male TAG research liaison in the boardroom; gravelly, pragmatic, pushing back gently against corporate spin.',
  },
  crew_board_4: {
    label: 'BoardOps',
    voice: 'Schedar',
    model: 'gemini-3.8-flash-tts',
    profile: '40s male TAG operations controller in the boardroom; bottom-line focused, impatient about downtime.',
  },
  crew_admin_visitor: {
    label: 'AdminVisitor',
    voice: 'Umbriel',
    model: 'gemini-3.8-flash-tts',
    profile: '30s male station lab technician waiting in TAG Reception; mildly frustrated, trying to stay polite.',
  },
  crew_botanist_1: {
    label: 'HydroManA',
    voice: 'Algieba',
    model: 'gemini-3.8-flash-tts',
    profile: '30s male hydroponics botanist in the Grow Hall; practical, attentive to his plants, quietly puzzled.',
  },
  crew_botanist_2: {
    label: 'HydroManB',
    voice: 'Enceladus',
    model: 'gemini-3.8-flash-tts',
    profile: '40s male senior hydroponics technician in the Grow Hall; dry, observant, unimpressed by maintenance excuses.',
  },
  crew_botanist_3: {
    label: 'SeedTech',
    voice: 'Sadaltager',
    model: 'gemini-3.8-flash-tts',
    profile: '30s male seed-lab specialist muttering quietly to himself while checking trays in the Seed Lab; calm, absorbed.',
  },
  crew_diver_1: {
    label: 'LaunchDiver',
    voice: 'Zubenelgenubi',
    model: 'gemini-3.8-flash-tts',
    profile: '30s male deep-sea diver in the Launch Hall; grounded, plainspoken, slightly unsettled by the last dive.',
  },
  crew_diver_2: {
    label: 'StoreDiver',
    voice: 'Sadachbia',
    model: 'gemini-3.8-flash-tts',
    profile: '30s male dive-bay sample handler muttering quietly over cold-store manifests in Sample Store; methodical, dry.',
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
