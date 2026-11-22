import type { Rng } from '../../core/rng.ts';
import type { RenderedScore } from '../scorePlayer.ts';
import { LAB_B_LOOP, renderLabB } from './labB.ts';

/** Generated scores by id (`data/scores.json` holds their cues). */
export const SCORE_RENDERS: Record<string, { title: string; seconds: number; render: (sr: number, rng: Rng) => RenderedScore }> = {
  labB: { title: 'Lab B', seconds: LAB_B_LOOP, render: renderLabB },
};
