import { readDebugFlags, type DebugFlags } from '../core/debug.ts';
import { isScratchSession } from '../core/storage.ts';

/** The level a New game starts on, and the one the title prepares. */
export const DEFAULT_LEVEL = 'slice01';

export interface AutoLoadPlan {
  levelParam: string | null;
  jump: string | null;
  seq: string | null;
  enemies: string | null;
  give: string | null;
}

export interface LaunchPlan {
  vmlab: boolean;
  scratch: boolean;
  memprobe: boolean;
  debug: DebugFlags;
  checker: boolean;
  bodyModels: string | null;
  /** Non-null when dev/sandbox URL params request bypassing the title menu straight into session loading. */
  autoLoad: AutoLoadPlan | null;
}

/**
 * Inspect URL query parameters to decide whether startup stays on the lightweight 2D title menu
 * or automatically triggers session loading (session-loading spec: Developer and sandbox URLs).
 */
export function parseLaunchPlan(search: string): LaunchPlan {
  const params = new URLSearchParams(search);
  const debug = readDebugFlags(search);
  const levelParam = params.get('level');
  const jump = debug.enabled ? params.get('jump') : null;
  const seq = debug.enabled ? debug.seq : null;
  const enemies = params.get('enemies');
  const give = debug.enabled ? params.get('give') : null;
  const shouldAutoLoad = levelParam !== null || jump !== null || seq !== null || enemies !== null;

  return {
    vmlab: params.has('vmlab'),
    scratch: isScratchSession(search),
    memprobe: params.has('memprobe'),
    debug,
    checker: params.has('checker'),
    bodyModels: params.get('bodyModels'),
    autoLoad: shouldAutoLoad ? { levelParam, jump, seq, enemies, give } : null,
  };
}
