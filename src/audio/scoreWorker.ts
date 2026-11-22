/**
 * Renders a generated score off the main thread (adaptive-music spec): its layers take seconds to synthesise.
 * The buffers are transferred, not copied.
 */
import { Rng } from '../core/rng.ts';
import { SCORE_RENDERS } from './scores/index.ts';
import type { RenderedScore } from './scorePlayer.ts';

/** Same rate as the menu theme: the scores carry little above 6 kHz. */
export const SCORE_RENDER_RATE = 32000;

export type ScoreWorkerReply = { id: string; score: RenderedScore } | { id: string; error: string };

self.onmessage = (e: MessageEvent<{ id: string }>): void => {
  const { id } = e.data;
  const spec = SCORE_RENDERS[id];
  if (!spec) {
    self.postMessage({ id, error: `no render for score "${id}"` } satisfies ScoreWorkerReply);
    return;
  }
  const score = spec.render(SCORE_RENDER_RATE, new Rng(`score:${id}`));
  const transfer: ArrayBuffer[] = [];
  for (const p of Object.values(score.layers)) transfer.push(p.left.buffer, p.right.buffer);
  for (const vs of Object.values(score.stingers)) for (const p of vs) transfer.push(p.left.buffer, p.right.buffer);
  self.postMessage({ id, score } satisfies ScoreWorkerReply, { transfer });
};
