import type { EventBus } from '../core/events.ts';
import type { ControlState } from '../actors/control.ts';
import type { Action, ActionDef, RunContext, SequenceHost } from './action.ts';
import { BUILTIN_ACTIONS } from './builtins.ts';
import type { ActionStep, Flags, IfStep, ParallelStep, SequenceDef, Step } from './types.ts';

export type EndReason = 'completed' | 'skipped' | 'cancelled';

declare module '../core/events.ts' {
  interface EventMap {
    'sequence:started': { id: string };
    'sequence:ended': { id: string; reason: EndReason };
  }
}

// ----------------------------------------------------------------------- composites

/** Steps one after another; zero-time steps chain within the same update. */
class SerialAction implements Action {
  private index = 0;
  private started = false;
  private readonly steps: Action[];
  constructor(steps: Action[]) {
    this.steps = steps;
  }
  start(): void {
    if (this.started) return;
    this.started = true;
    this.steps[0]?.start();
  }
  update(dt: number): boolean {
    this.start();
    let budget = dt;
    // The guard stops a malformed loop of zero-time steps from hanging a frame.
    for (let guard = 0; guard < 1000; guard++) {
      const cur = this.steps[this.index];
      if (!cur) return true;
      if (!cur.update(budget)) return false;
      this.index++;
      budget = 0;
      this.steps[this.index]?.start();
    }
    return false;
  }
  finish(): void {
    for (let i = this.index; i < this.steps.length; i++) this.steps[i]?.finish();
    this.index = this.steps.length;
    this.started = true;
  }
  cancel(): void {
    this.steps[this.index]?.cancel();
    this.index = this.steps.length;
  }
}

class ParallelAction implements Action {
  private pending: Action[];
  private started = false;
  constructor(children: Action[]) {
    this.pending = [...children];
  }
  start(): void {
    if (this.started) return;
    this.started = true;
    for (const c of this.pending) c.start();
  }
  update(dt: number): boolean {
    this.start();
    this.pending = this.pending.filter((c) => !c.update(dt));
    return this.pending.length === 0;
  }
  finish(): void {
    for (const c of this.pending) c.finish();
    this.pending = [];
    this.started = true;
  }
  cancel(): void {
    for (const c of this.pending) c.cancel();
    this.pending = [];
  }
}

/** Picks its branch at start, or at finish if it never started. */
class IfAction implements Action {
  private chosen: Action | null = null;
  private readonly pick: () => Action;
  constructor(pick: () => Action) {
    this.pick = pick;
  }
  start(): void {
    this.chosen ??= this.pick();
    this.chosen.start();
  }
  update(dt: number): boolean {
    if (!this.chosen) this.start();
    return this.chosen?.update(dt) ?? true;
  }
  finish(): void {
    this.chosen ??= this.pick();
    this.chosen.finish();
  }
  cancel(): void {
    this.chosen?.cancel();
  }
}

// ----------------------------------------------------------------------- runs

class Run {
  readonly def: SequenceDef;
  readonly root: Action;
  readonly releases: Array<() => void> = [];
  ended = false;
  constructor(def: SequenceDef, root: Action) {
    this.def = def;
    this.root = root;
  }
}

export interface RunningInfo {
  id: string;
  skippable: boolean;
}

export interface SequencerDeps {
  events: EventBus;
  host: SequenceHost;
  /** The game's flags object; sequences read and write it directly. */
  flags: Flags;
}

export class Sequencer {
  private readonly deps: SequencerDeps;
  private readonly defs = new Map<string, SequenceDef>();
  private readonly actions = new Map<string, ActionDef>(Object.entries(BUILTIN_ACTIONS));
  private runs: Run[] = [];

  constructor(deps: SequencerDeps) {
    this.deps = deps;
  }

  /** Add an action type (an ADR-0009 "named hook" or a new built-in). */
  registerAction(name: string, def: ActionDef): void {
    this.actions.set(name, def);
  }

  /** Validates every step now, so bad data fails at load with a readable path. */
  register(def: SequenceDef): void {
    this.checkSteps(def.steps, `sequence '${def.id}'`);
    this.defs.set(def.id, def);
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  /** Start a sequence. Returns false if refused (unknown, already running, once-done, exclusive group busy). */
  play(id: string): boolean {
    const def = this.defs.get(id);
    if (!def) throw new Error(`Unknown sequence '${id}'. Known: ${[...this.defs.keys()].join(', ')}`);
    if (def.once && this.deps.flags[`seq:${id}`]) return false;
    if (this.runs.some((r) => r.def.id === id)) return false;
    if (def.exclusive && this.runs.some((r) => r.def.exclusive === def.exclusive)) return false;

    const run = this.createRun(def);
    this.runs.push(run);
    this.deps.events.emit('sequence:started', { id });
    run.root.start();
    // Zero-time steps at the top (a fade, a control layer) take effect on this very frame.
    if (run.root.update(0)) this.end(run, 'completed');
    return true;
  }

  /** Per simulation step. */
  update(dt: number): void {
    for (const run of [...this.runs]) {
      if (run.ended) continue;
      if (run.root.update(dt)) this.end(run, 'completed');
    }
  }

  running(): RunningInfo[] {
    return this.runs.map((r) => ({ id: r.def.id, skippable: r.def.skippable === true }));
  }

  /** A skippable sequence is running (the skip prompt shows only then). */
  get skippable(): boolean {
    return this.runs.some((r) => r.def.skippable === true);
  }

  /** Skip every skippable running sequence: apply its end state instantly. Returns whether any was skipped. */
  skip(): boolean {
    let any = false;
    for (const run of [...this.runs]) {
      if (run.ended || run.def.skippable !== true) continue;
      run.root.finish();
      this.end(run, 'skipped');
      any = true;
    }
    return any;
  }

  /** Stop everything with no end state (death, load, quit to title). Control layers are released. */
  cancelAll(): void {
    for (const run of [...this.runs]) {
      if (run.ended) continue;
      run.root.cancel();
      this.end(run, 'cancelled');
    }
  }

  // ------------------------------------------------------------------- internals

  private end(run: Run, reason: EndReason): void {
    if (run.ended) return;
    run.ended = true;
    for (const release of run.releases.splice(0)) release();
    this.runs = this.runs.filter((r) => r !== run);
    if (run.def.once && reason !== 'cancelled') this.deps.flags[`seq:${run.def.id}`] = true;
    this.deps.events.emit('sequence:ended', { id: run.def.id, reason });
  }

  private createRun(def: SequenceDef): Run {
    const { events, host, flags } = this.deps;
    const releases: Array<() => void> = [];
    const ctx: RunContext = {
      sequenceId: def.id,
      events,
      flags,
      host,
      hold: (over: Partial<ControlState>) => {
        releases.push(host.pushControl(over, `seq:${def.id}`));
      },
      releaseHolds: () => {
        for (const release of releases.splice(0)) release();
      },
      build: (steps) => this.buildSteps(steps, ctx),
    };
    const run = new Run(def, this.buildSteps(def.steps, ctx));
    // Share one list so releaseHolds() and end() see the same layers.
    run.releases.push(() => ctx.releaseHolds());
    return run;
  }

  private buildSteps(steps: Step[], ctx: RunContext): Action {
    return new SerialAction(steps.map((s) => this.buildStep(s, ctx)));
  }

  private buildStep(step: Step, ctx: RunContext): Action {
    if ('parallel' in step) return new ParallelAction((step as ParallelStep).parallel.map((s) => this.buildStep(s, ctx)));
    if ('if' in step) {
      const s = step as IfStep;
      return new IfAction(() => {
        const value = ctx.flags[s.if.flag];
        const ok = s.if.equals === undefined ? Boolean(value) : value === s.if.equals;
        return this.buildSteps(ok ? s.then : (s.else ?? []), ctx);
      });
    }
    const def = this.actions.get((step as ActionStep).do);
    if (!def) throw new Error(`Unknown action '${(step as ActionStep).do}'`);
    return def.create(step as ActionStep, ctx);
  }

  private checkSteps(steps: unknown, path: string): void {
    if (!Array.isArray(steps)) throw new Error(`${path}: "steps" must be an array`);
    steps.forEach((raw, i) => {
      const at = `${path} > steps[${i}]`;
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${at}: a step must be an object`);
      const step = raw as Record<string, unknown>;
      if ('parallel' in step) return this.checkSteps(step['parallel'], `${at} > parallel`);
      if ('if' in step) {
        const cond = step['if'] as Record<string, unknown> | null;
        if (typeof cond !== 'object' || cond === null || typeof cond['flag'] !== 'string') throw new Error(`${at}: "if" needs a "flag" string`);
        this.checkSteps(step['then'], `${at} > then`);
        if (step['else'] !== undefined) this.checkSteps(step['else'], `${at} > else`);
        return;
      }
      const name = step['do'];
      if (typeof name !== 'string') throw new Error(`${at}: needs "do", "parallel" or "if"`);
      const def = this.actions.get(name);
      if (!def) throw new Error(`${at}: unknown action '${name}'. Known: ${[...this.actions.keys()].join(', ')}`);
      const problem = def.check(step as ActionStep);
      if (problem) throw new Error(`${at} (${name}): ${problem}`);
    });
  }
}
