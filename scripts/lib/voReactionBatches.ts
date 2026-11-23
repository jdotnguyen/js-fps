/**
 * TTS reaction batches for `scripts/vo-reactions.ts`. Each batch names a speaker, so its voice and model come
 * from that speaker's entry in `voCast.ts`. Only TTS takes live here: screams and Jay's startled shouts are
 * credited recordings (CREDITS.md) and must never be regenerated over, so they have no batch.
 */
import { castFor, type TtsModel } from './voCast.ts';

export interface ReactionTake {
  id: string;
  direction: string;
  vocalization: string;
}

export interface ReactionBatch {
  name: string;
  speaker: string;
  character: string;
  takes: ReactionTake[];
}

export const REACTION_BATCHES: readonly ReactionBatch[] = [
  {
    name: 'react_jay_pain',
    speaker: 'player',
    character: 'Jay, 30s male security officer (grounded, steady lower-mid male voice)',
    takes: [
      { id: 'react_jay_pain_01', direction: 'tight pained effort grunt while shoving a monster off', vocalization: 'Hngh!' },
      { id: 'react_jay_pain_02', direction: 'strained struggling grunt of pain', vocalization: 'Nngh— agh!' },
      { id: 'react_jay_pain_03', direction: 'low winded grunt taking a sudden hit', vocalization: 'Ughh!' },
    ],
  },
  {
    name: 'react_priya_choke',
    speaker: 'nurse',
    character: 'Priya Anand, 29 female medical nurse (warm female voice, now utterly terrified in a horror scene)',
    takes: [
      { id: 'react_priya_choke_01', direction: 'being strangled: throat clamped shut, panicked wet gagging and failed gasps that catch in the throat, fighting for air; ugly and frightened, NOT moaning, sighing, breathy or sensual', vocalization: 'Gkh— kkh— hhk!' },
      { id: 'react_priya_choke_02', direction: 'air-starved strangled choking and gagging breaths', vocalization: 'Ghk— hh— khh!' },
      { id: 'react_priya_choke_03', direction: 'weak ragged choked wheeze struggling to breathe', vocalization: 'Hkh— ghh— hh!' },
    ],
  },
  {
    // overhaul-priya-r08-death D29: her sob as she stumbles in the run (line 4), and her panic after the tray (line 20).
    name: 'react_priya_panic',
    speaker: 'nurse',
    character: 'Priya Anand, 29 female medical nurse (warm female voice, terrified, hiding from something in a dark station)',
    takes: [
      { id: 'react_priya_sob_01', direction: 'one sharp frightened sob caught in the throat as she stumbles while running, breathless', vocalization: 'Hnh— hh!' },
      { id: 'react_priya_sob_02', direction: 'a short choked sob of panic mid-stride, gasping', vocalization: 'Hhuh— nh!' },
      { id: 'react_priya_breath_01', direction: 'fast shallow panicked breathing close to a microphone, then a small terrified whimper; trying to stay quiet', vocalization: 'Hh— hh— hh— hh— nnh—' },
      { id: 'react_priya_breath_02', direction: 'hyperventilating, ragged quick breaths through the mouth, whimpering, terrified of being heard', vocalization: 'Hah— hah— hh— hh— mmh—' },
    ],
  },
  {
    // Her panic as the thing crawls up her arm (infection-kills spec, the scratch beat: sound `voss_panic_breath`).
    name: 'react_voss_panic',
    speaker: 'crew_lab',
    character: 'Dr. Lena Voss, 34 female microbiologist (sharp female voice, something is moving under the skin of her arm)',
    takes: [
      { id: 'react_voss_panic_01', direction: 'fast shallow terrified panting, breath catching, close to the mic', vocalization: 'Hh— hh— hh— hhh—' },
      { id: 'react_voss_panic_02', direction: 'choked whimpering sobs of disgust and fear, trying not to scream', vocalization: 'Nn— nnh— oh god— nnh—' },
      { id: 'react_voss_panic_03', direction: 'ragged hyperventilating gasps turning into a whimper', vocalization: 'Hah— hah— hahh— nnnh—' },
    ],
  },
];

/** Credited recordings that share the `react_` prefix but are not TTS (CREDITS.md). No batch may write these. */
export const CREDITED_REACTION_CLIPS: readonly string[] = [
  'react_jay_scare_01', 'react_jay_scare_02', 'react_jay_scare_03',
  'react_giles_cry_01', 'react_giles_cry_02', 'react_giles_cry_03',
  'react_priya_scream_01', 'react_priya_scream_02', 'react_priya_scream_03',
  'react_priya_cutoff_01', 'react_priya_cutoff_02', 'react_priya_cutoff_03',
  'react_voss_scream_01', 'react_voss_scream_02', 'react_voss_scream_03',
];

/** The voice and model a reaction batch is generated with: always its speaker's cast entry. */
export function reactionVoice(batch: ReactionBatch): { voice: string; model: TtsModel } {
  const c = castFor(batch.speaker);
  return { voice: c.voice, model: c.model };
}
