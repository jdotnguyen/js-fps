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
  // player-hit-feedback D6: Jay's reaction to a hit, picked by its size (the three react_jay_pain takes join the mid
  // tier), and his heavy breathing at low health (D7).
  {
    name: 'react_jay_hurt_light',
    speaker: 'player',
    character: 'Jay, 30s male security officer (grounded, steady lower-mid male voice)',
    takes: [
      { id: 'react_jay_hurt_light_01', direction: 'a minor blow in a fight: a quick hiss of pain through clenched teeth, very short', vocalization: 'Tsss!' },
      { id: 'react_jay_hurt_light_02', direction: 'a small cut in a fight: a sharp irritated wince through the teeth, very short', vocalization: 'Sss— agh.' },
      { id: 'react_jay_hurt_light_03', direction: 'a glancing hit: a short clipped grunt of surprise, very short', vocalization: 'Tch!' },
      { id: 'react_jay_hurt_light_04', direction: 'a light knock to the arm in a brawl: one small tight grunt, very short', vocalization: 'Ngh.' },
      { id: 'react_jay_hurt_light_05', direction: 'a scrape: a short punchy exhale of annoyance and pain, very short', vocalization: 'Hmph!' },
    ],
  },
  {
    name: 'react_jay_hurt_mid',
    speaker: 'player',
    character: 'Jay, 30s male security officer (grounded, steady lower-mid male voice)',
    takes: [
      { id: 'react_jay_hurt_mid_01', direction: 'a solid pained grunt taking a clawing blow', vocalization: 'Agh!' },
      { id: 'react_jay_hurt_mid_02', direction: 'a short hard grunt as a hit lands in the ribs', vocalization: 'Oof—!' },
      { id: 'react_jay_hurt_mid_03', direction: 'a gritted-teeth grunt of pain', vocalization: 'Gnh!' },
      { id: 'react_jay_hurt_mid_04', direction: 'a sharp pained grunt, knocked off balance', vocalization: 'Hah-ngh!' },
      { id: 'react_jay_hurt_mid_05', direction: 'a low pained grunt that catches, breath knocked loose', vocalization: 'Uhn!' },
    ],
  },
  {
    name: 'react_jay_hurt_heavy',
    speaker: 'player',
    character: 'Jay, 30s male security officer (grounded, steady lower-mid male voice)',
    takes: [
      { id: 'react_jay_hurt_heavy_01', direction: 'a loud raw cry of pain from a deep wound, one burst, not a long scream', vocalization: 'AAGH!' },
      { id: 'react_jay_hurt_heavy_02', direction: 'a heavy anguished cry as a huge blow throws him back', vocalization: 'Gaaah—!' },
      { id: 'react_jay_hurt_heavy_03', direction: 'a loud pained yell torn out of him, ending in a gasp', vocalization: 'Aarrgh— hh!' },
      { id: 'react_jay_hurt_heavy_04', direction: 'a hard winded cry, all the air slammed out of him', vocalization: 'Ough— AH!' },
      { id: 'react_jay_hurt_heavy_05', direction: 'a strained loud groan of serious pain', vocalization: 'Nnaaagh!' },
    ],
  },
  {
    name: 'react_jay_breath',
    speaker: 'player',
    character: 'Jay, 30s male security officer (grounded, steady lower-mid male voice)',
    takes: [
      { id: 'react_jay_breath_01', direction: 'a wounded soldier catching his breath after a hard fight: heavy tired panting, four even breaths, steady rhythm, no voice', vocalization: 'Huff... huff... huff... huff...' },
      { id: 'react_jay_breath_02', direction: 'an injured man out of breath from running, wincing now and then: four heavy even breaths, steady rhythm', vocalization: 'Huff... hff, ugh... huff... hff, ugh...' },
      { id: 'react_jay_breath_03', direction: 'a hurt security officer panting through gritted teeth to push through the pain: four short even breaths, steady rhythm', vocalization: 'Hff... hff... hff... hff...' },
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
    // speed-up-priya-aftermath: Okafor's exhale and sniffle at the glass after her death. A male voice only: the
    // sigh and sniffle are not his speech, so they use Jay's cast entry (a steady lower-mid male voice).
    name: 'react_okafor_exhale',
    speaker: 'player',
    character: 'a worn-out middle-aged male surgeon, deep low male voice, alone and exhausted after watching a patient die',
    takes: [
      { id: 'react_okafor_exhale_01', direction: 'one long, heavy, tired exhale through the nose and mouth, loud and audible, then a single wet sniffle; exhausted and grieving, no words', vocalization: 'Hhhhaaahhh... [sniff]' },
      { id: 'react_okafor_exhale_02', direction: 'a slow weary sigh out, shaky at the end, then a quiet sniffle and a swallow; loud and close to the microphone, no words', vocalization: 'Hhhhhhhh... hh— [sniff]' },
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
  // Her staged run to the glass (voss-death-scene D1, 4.7): sounds `voss_gasp`, `voss_grunt` and `voss_cough`.
  {
    name: 'react_voss_gasp',
    speaker: 'crew_lab',
    character: 'Dr. Lena Voss, 34 female microbiologist (sharp female voice, something is tearing her apart from inside)',
    takes: [
      { id: 'react_voss_gasp_01', direction: 'one sharp ragged gasp of pain as something inside her lurches, close to the mic', vocalization: 'Hhah—!' },
      { id: 'react_voss_gasp_02', direction: 'a strangled panicked gasp for air, her breath catching in her throat', vocalization: 'Hhhk— hah—' },
      { id: 'react_voss_gasp_03', direction: 'a desperate wheezing breath in, fighting to breathe, close to tears', vocalization: 'Hhhhh— hh—' },
    ],
  },
  {
    name: 'react_voss_grunt',
    speaker: 'crew_lab',
    character: 'Dr. Lena Voss, 34 female microbiologist (sharp female voice, something is tearing her apart from inside)',
    takes: [
      { id: 'react_voss_grunt_01', direction: 'a short pained grunt as she slams hip-first into a steel lab bench', vocalization: 'Unhh!' },
      { id: 'react_voss_grunt_02', direction: 'a strained effortful cry through clenched teeth, pushing herself up off the bench', vocalization: 'Nnngh— ahh!' },
      { id: 'react_voss_grunt_03', direction: 'a winded cry of pain as her knee hits a hard floor', vocalization: 'Agh— hhh!' },
    ],
  },
  {
    name: 'react_voss_cough',
    speaker: 'crew_lab',
    character: 'Dr. Lena Voss, 34 female microbiologist (sharp female voice, choking on blood in her throat)',
    takes: [
      { id: 'react_voss_cough_01', direction: 'one short wet choking cough, blood in her throat, under half a second', vocalization: 'Khh!' },
      { id: 'react_voss_cough_02', direction: 'one harsh wet cough that ends in a gurgle, short', vocalization: 'Hkkh—' },
      { id: 'react_voss_cough_03', direction: 'one retching wet cough, gagging, short', vocalization: 'Uhkk!' },
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
