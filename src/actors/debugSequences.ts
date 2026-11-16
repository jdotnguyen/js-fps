import * as THREE from 'three';
import type { Player } from './player.ts';

/**
 * Hand-written stand-ins for ADR-0009 sequences, used to prove the control API
 * (ADR-0004 Definition of done). Run with `?debug&seq=<id>` or from the debug panel.
 */
export interface DebugSequenceContext {
  player: Player;
  /** Shows a caption; returns nothing. */
  say: (title: string, body?: string) => void;
  /** Something worth looking at (the sealed door in the demo room). */
  focus: THREE.Vector3;
}

const wait = (s: number): Promise<void> => new Promise((r) => setTimeout(r, s * 1000));

export const DEBUG_SEQUENCES: Record<string, (ctx: DebugSequenceContext) => Promise<void>> = {
  /** Lock movement, pull the view to the door, soft-lock it there, then restore. */
  'control-test': async ({ player, say, focus }) => {
    const release = player.control.push(
      { move: 'locked', look: 'clamped', weapons: false, interact: false, flashlight: false },
      'control-test',
    );
    try {
      say('Control test', 'Movement locked · view held on the door (40°)');
      player.lookAt(focus, { duration: 0.8, weight: 0.85 });
      player.clampLook(focus, 40);
      await wait(4);
      say('Control test', 'Slow walk allowed · view still clamped');
      const slow = player.control.push({ move: 'slow' }, 'control-test:slow');
      await wait(3);
      slow();
    } finally {
      // The sequencer guarantees this on end or cancel; here try/finally does.
      release();
    }
    say('Control test', 'Control restored');
  },

  /** Forced walk toward the door, then hand control back. */
  'walk-test': async ({ player, say, focus }) => {
    const release = player.control.push({ look: 'clamped', weapons: false, interact: false }, 'walk-test');
    try {
      player.clampLook(focus, 60);
      say('Walk test', 'Forced walk');
      await player.walkTo(new THREE.Vector3(0, 0, Math.max(-8.5, player.body.z - 4)));
    } finally {
      release();
    }
    say('Walk test', 'Control restored');
  },
};
