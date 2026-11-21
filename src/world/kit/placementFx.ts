import * as THREE from 'three';
import { boolParam, strParam, type PieceOutput, type PieceParams } from './types.ts';

/**
 * Placement effects any kit piece can take from its params (openspec rebuild-lab-wing, lab-wing spec):
 *   reveal: '<name>'  hidden until the event `bloom:<name>` (e.g. `reveal: 'spread'` waits for `bloom:spread`, which the
 *                     drop emits at the burst and the action restore re-emits on load); `level:reset` hides it again.
 *   breathe: true     a slow 4-6 s scale pulse of +-2 % about the piece origin (the bloom's larger masses).
 * Either makes the piece's visuals dynamic (unmerged), so they can be shown, hidden or scaled.
 */
export function applyPlacementFx(out: PieceOutput, params: PieceParams): PieceOutput {
  const reveal = strParam(params, 'reveal', '');
  const breathe = boolParam(params, 'breathe', false);
  if (!reveal && !breathe) return out;
  const holder = new THREE.Group();
  holder.name = 'placement-fx';
  for (const c of [...out.object.children]) holder.add(c);
  holder.userData['dynamic'] = true;
  out.object.add(holder);
  if (reveal) {
    holder.visible = false;
    const event = `bloom:${reveal}`;
    out.listeners = [...(out.listeners ?? []), { event, fn: () => void (holder.visible = true) }, { event: 'level:reset', fn: () => void (holder.visible = false) }];
  }
  if (breathe) {
    // Period and phase from the piece's own placement-independent hash, so neighbouring masses do not pulse in step.
    const seed = [...JSON.stringify(params)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const period = 4 + (seed % 2000) / 1000;
    const phase = (seed % 628) / 100;
    const prev = out.tick;
    out.tick = (t, dt) => {
      prev?.(t, dt);
      const s = 1 + 0.02 * Math.sin((t / period) * Math.PI * 2 + phase);
      holder.scale.set(s, 1 + (s - 1) * 1.5, s);
    };
  }
  return out;
}
