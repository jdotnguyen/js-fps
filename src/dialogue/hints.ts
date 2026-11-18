import type { ObjectiveDef } from '../data/types/objectives.ts';

/**
 * Hint system (ADR-0010 step 5). When the player is stuck on the current required
 * objectives, a squadmate says a hint: vague first, explicit later (Giles asks questions,
 * Okafor states facts; the lines live in data/dialogue/barks01.json, keyed from
 * data/objectives.json `hints`). The last tier also fires the nav pulse (ADR-0012).
 *
 * "Stuck" = time with no progress, counted only while the player could act (not on rails,
 * in a cutscene, in combat or paused). Progress = an objective started or finished, a new
 * room walked into, or getting 3 m closer to the target than ever since the last progress.
 * Tier k is due after `d1 + k * (d2 - d1)` stuck seconds (ADR-0008 `hintDelay` [d1, d2]);
 * past the last tier it repeats every d2. Progress resets the clock and steps the ladder back
 * one tier, so a player who moves on and gets stuck again hears that level again (the next
 * variant line), then escalates.
 *
 * Hints never talk over a story line (or another hint): they wait until it ends. They do
 * cut off a combat/idle bark, which the speech manager allows by priority.
 */

/** Distance gain that counts as progress (ADR-0010). */
export const PROGRESS_METRES = 3;

export interface HintSpeech {
  /** What is speaking now; hints wait while a `story` or `hint` line plays. */
  speaking(): { priority: string } | null;
  say(lineId: string): void;
}

export interface HintDeps {
  /** Active objectives, required first (`ObjectiveTracker.active`). */
  active(): readonly ObjectiveDef[];
  /** [tier1, tier2] seconds from the difficulty preset. */
  delays(): readonly number[];
  speech: HintSpeech;
  /** True while hints must not fire (on rails, cutscene, combat, not playing). */
  blocked(): boolean;
  /** Metres from the player to the objective's target, or null if unknown. */
  distance(def: ObjectiveDef): number | null;
  /** The explicit tier fired: show the way (nav pulse). */
  onPulse?(def: ObjectiveDef): void;
  /** A hint line was said. */
  onHint?(def: ObjectiveDef, tier: number, lineId: string): void;
}

interface Ladder {
  /** Next tier to say. */
  tier: number;
  /** Times each tier was said (picks the variant). */
  said: number[];
}

export class HintDirector {
  /** Seconds stuck. */
  stuck = 0;
  private readonly d: HintDeps;
  private readonly ladders = new Map<string, Ladder>();
  private best = Infinity;
  private focusId: string | null = null;
  /** `stuck` when the last hint fired (for repeats past the last tier). */
  private lastAt = -Infinity;

  constructor(deps: HintDeps) {
    this.d = deps;
  }

  /** Something moved forward: restart the stuck clock. */
  progress(): void {
    for (const l of this.ladders.values()) l.tier = Math.max(0, l.tier - 1);
    this.stuck = 0;
    this.lastAt = -Infinity;
    this.best = Infinity;
  }

  /** New game or load: forget everything. */
  reset(): void {
    this.progress();
    this.ladders.clear();
    this.focusId = null;
  }

  /** Tier that fires next for an objective (0-based). */
  tierOf(id: string): number {
    return this.ladders.get(id)?.tier ?? 0;
  }

  /** The required objective hints are about: the nearest active one that has hints. */
  focus(): ObjectiveDef | null {
    const list = this.d.active().filter((o) => o.required && (o.hints?.length ?? 0) > 0);
    if (list.length <= 1) return list[0] ?? null;
    let best: ObjectiveDef | null = null;
    let bestD = Infinity;
    for (const o of list) {
      const dist = this.d.distance(o) ?? Infinity;
      if (best === null || dist < bestD) {
        best = o;
        bestD = dist;
      }
    }
    return best;
  }

  update(dt: number): void {
    const focus = this.focus();
    if (!focus) {
      this.focusId = null;
      this.progress();
      return;
    }
    if (focus.id !== this.focusId) {
      // A different objective is now nearest: distances start over, the clock does not.
      this.focusId = focus.id;
      this.best = Infinity;
    }
    if (this.d.blocked()) return;
    const dist = this.d.distance(focus);
    if (dist !== null) {
      if (dist < this.best - PROGRESS_METRES) {
        if (this.best !== Infinity) this.progress();
        this.best = dist;
      }
    }
    this.stuck += dt;
    const ladder = this.ladder(focus.id);
    const tiers = focus.hints!;
    if (this.stuck < this.dueAt(ladder.tier, tiers.length)) return;
    const now = this.d.speech.speaking();
    if (now && (now.priority === 'story' || now.priority === 'hint')) return; // wait, never talk over it
    const t = Math.min(ladder.tier, tiers.length - 1);
    const variants = tiers[t]!;
    const said = ladder.said[t] ?? 0;
    const line = variants[said % variants.length]!;
    ladder.said[t] = said + 1;
    ladder.tier++;
    this.lastAt = this.stuck;
    this.d.speech.say(line);
    this.d.onHint?.(focus, t, line);
    if (t === tiers.length - 1) this.d.onPulse?.(focus);
  }

  private dueAt(tier: number, count: number): number {
    const [d1 = 45, d2 = 90] = this.d.delays();
    if (tier < count) return d1 + tier * (d2 - d1);
    return (Number.isFinite(this.lastAt) ? this.lastAt : 0) + d2;
  }

  private ladder(id: string): Ladder {
    let l = this.ladders.get(id);
    if (!l) {
      l = { tier: 0, said: [] };
      this.ladders.set(id, l);
    }
    return l;
  }
}
