/**
 * Sequence interpreter and manager (ADR-0009).
 *
 * Each running sequence is a cursor over its steps. Actions implement
 * `update(dt) -> done`, `cancel()`. Everything a sequence takes (control layers, event
 * listeners, time scale) is released when it ends or is cancelled, so a failed or
 * interrupted sequence can never leave the player stuck.
 */
import { ACTIONS, isParallel, type ActionContext, type Hook } from './actions.ts';
import type { ControlOverride, SequenceHost } from './host.ts';
import type { Running, SequenceDef, Step } from './types.ts';

export interface RunInfo {
  id: string;
  /** Index of the current top-level step, and how many there are. */
  step: number;
  total: number;
  /** Short description of what is happening now. */
  label: string;
  elapsed: number;
  skippable: boolean;
}

/** In-memory world state at a checkpoint (ADR-0009). Persisting it is ADR-0016's job. */
export interface ScriptSnapshot {
  checkpoint: string;
  doors: Record<string, string>;
  lights: Record<string, string>;
  /** Other resumable sequences that were running when the checkpoint was taken. */
  resume: string[];
}

interface Run {
  def: SequenceDef;
  root: Running;
  step: number;
  label: string;
  elapsed: number;
  releases: Array<() => void>;
  endFns: Array<() => void>;
  listeners: Array<() => void>;
  checkpointed: boolean;
}

class Serial implements Running {
  private i = 0;
  private cur: Running | null = null;
  private readonly steps: Step[];
  private readonly start: (step: Step, index: number) => Running | void;
  private readonly skipStep: (step: Step) => void;

  constructor(steps: Step[], start: (step: Step, index: number) => Running | void, skipStep: (step: Step) => void) {
    this.steps = steps;
    this.start = start;
    this.skipStep = skipStep;
  }

  update(dt: number): boolean {
    for (;;) {
      if (!this.cur) {
        if (this.i >= this.steps.length) return true;
        const index = this.i++;
        this.cur = this.start(this.steps[index]!, index) ?? null;
        if (!this.cur) continue;
      }
      if (!this.cur.update(dt)) return false;
      this.cur = null;
    }
  }

  cancel(): void {
    this.cur?.cancel?.();
    this.cur = null;
  }

  /** Finish the step in flight, then apply every later step's end state. */
  skip(): void {
    this.cur?.skip?.();
    this.cur = null;
    while (this.i < this.steps.length) this.skipStep(this.steps[this.i++]!);
  }
}

class Parallel implements Running {
  private live: Running[];

  constructor(kids: Running[]) {
    this.live = kids;
  }

  update(dt: number): boolean {
    this.live = this.live.filter((k) => !k.update(dt));
    return this.live.length === 0;
  }

  cancel(): void {
    for (const k of this.live) k.cancel?.();
    this.live = [];
  }

  skip(): void {
    for (const k of this.live) k.skip?.();
    this.live = [];
  }
}

function describe(step: Step): string {
  if (isParallel(step)) return `parallel x${step.parallel.length}`;
  const bits = Object.entries(step)
    .filter(([k]) => k !== 'do')
    .slice(0, 2)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? '…' : String(v)}`);
  return [step.do, ...bits].join(' ');
}

export class SequenceManager {
  private readonly host: SequenceHost;
  private readonly defs = new Map<string, SequenceDef>();
  private readonly hooks = new Map<string, Hook>();
  private readonly warned = new Set<string>();
  private readonly subs: Array<() => void> = [];
  private runs: Run[] = [];
  private queue: string[] = [];
  private dying: string[] = [];
  private snapshot: ScriptSnapshot | null = null;

  constructor(host: SequenceHost, defs: SequenceDef[]) {
    this.host = host;
    for (const d of defs) this.defs.set(d.id, d);
    this.wireTriggers();
    this.subs.push(
      host.events.on('player:died', () => this.onDeath()),
      host.events.on('game:restarted', (p) => this.onRestart((p as { checkpoint?: string | null } | undefined)?.checkpoint ?? null)),
    );
  }

  registerHook(name: string, fn: Hook): void {
    this.hooks.set(name, fn);
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  ids(): string[] {
    return [...this.defs.keys()];
  }

  isRunning(id: string): boolean {
    return this.runs.some((r) => r.def.id === id);
  }

  running(): RunInfo[] {
    return this.runs.map((r) => ({
      id: r.def.id,
      step: r.step,
      total: r.def.steps.length,
      label: r.label,
      elapsed: r.elapsed,
      skippable: r.def.skippable === true,
    }));
  }

  /** A skippable sequence is running (the skip prompt shows only then). */
  get skippable(): boolean {
    return this.runs.some((r) => r.def.skippable === true);
  }

  /**
   * Skip every skippable running sequence (intro-sequence spec): apply the end state of everything
   * left, then end normally so control layers are released. Returns whether any skipped.
   */
  skip(): boolean {
    let any = false;
    for (const run of [...this.runs]) {
      if (!run.def.skippable) continue;
      any = true;
      try {
        run.root.skip?.();
      } catch (err) {
        this.host.warn(`sequence "${run.def.id}" failed while skipping (${run.label}): ${String(err)}`);
      }
      this.end(run, false, true);
    }
    if (any) this.host.stopSpeech?.();
    return any;
  }

  /**
   * Start a sequence now (debug `?seq=`, or code). With `debug`, its `debugSetup` flags
   * are applied first. Returns false if it is unknown, already running or has to wait.
   */
  start(id: string, opts: { debug?: boolean } = {}): boolean {
    const def = this.defs.get(id);
    if (!def) {
      this.host.warn(`unknown sequence "${id}". Known: ${this.ids().join(', ')}`);
      return false;
    }
    if (opts.debug) Object.assign(this.host.flags, def.debugSetup?.flags ?? {});
    return this.begin(def, true);
  }

  update(dt: number): void {
    for (const run of [...this.runs]) {
      if (!this.runs.includes(run)) continue;
      try {
        run.elapsed += dt;
        if (run.root.update(dt)) this.end(run, false);
      } catch (err) {
        this.host.warn(`sequence "${run.def.id}" failed at step ${run.step} (${run.label}): ${String(err)}`);
        this.end(run, true);
      }
    }
  }

  cancel(id: string): void {
    for (const run of this.runs.filter((r) => r.def.id === id)) this.end(run, true);
  }

  /** Stop everything (quit to title, new game). */
  cancelAll(): void {
    this.queue = [];
    for (const run of [...this.runs]) this.end(run, true);
  }

  dispose(): void {
    this.cancelAll();
    for (const off of this.subs.splice(0)) off();
  }

  // ------------------------------------------------------------------ triggers

  private wireTriggers(): void {
    const byEvent = new Map<string, SequenceDef[]>();
    for (const d of this.defs.values()) {
      if (!d.trigger) continue;
      const list = byEvent.get(d.trigger.event) ?? [];
      list.push(d);
      byEvent.set(d.trigger.event, list);
    }
    const fire = (list: SequenceDef[], payload?: unknown): void => {
      for (const d of list) {
        const want = d.trigger?.match;
        if (want) {
          const got = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
          if (!Object.entries(want).every(([k, v]) => got[k] === v)) continue;
        }
        const need = d.trigger?.requires;
        if (need && !this.host.flags[need]) continue;
        const done = d.trigger?.unless;
        if (done && this.host.flags[done]) continue;
        this.begin(d, false);
      }
    };
    for (const [event, list] of byEvent) {
      this.subs.push(this.host.events.on(event, (p) => fire(list, p)));
    }
    // Level triggers announce themselves as `trigger:fired { event }` (ADR-0003). Their `emit`
    // may be written with or without the `trigger:` prefix (slice01 writes `trigger:<name>`, use
    // triggers write e.g. `round:hydro_log`): a sequence trigger matches either spelling.
    this.subs.push(
      this.host.events.on('trigger:fired', (p) => {
        const emitted = (p as { event?: string } | null)?.event ?? '';
        if (!emitted) return;
        const prefixed = byEvent.get(`trigger:${emitted}`);
        if (prefixed) fire(prefixed, p);
        const plain = byEvent.get(emitted);
        if (plain) fire(plain, p);
      }),
    );
  }

  // ------------------------------------------------------------------ lifecycle

  private begin(def: SequenceDef, forced: boolean): boolean {
    if (!forced && def.once && this.host.flags[`seq:${def.id}`]) return false;
    if (this.isRunning(def.id) || this.queue.includes(def.id)) return false;
    if (def.exclusive && this.runs.some((r) => r.def.exclusive === def.exclusive)) {
      this.queue.push(def.id);
      return false;
    }
    if (def.once) this.host.flags[`seq:${def.id}`] = true;
    const run: Run = {
      def,
      root: { update: () => true },
      step: 0,
      label: 'starting',
      elapsed: 0,
      releases: [],
      endFns: [],
      listeners: [],
      checkpointed: false,
    };
    this.runs.push(run);
    this.host.events.emit('sequence:started', { id: def.id });
    try {
      run.root = new Serial(
        def.steps,
        (step, index) => {
          run.step = index;
          run.label = describe(step);
          return this.startStep(run, step);
        },
        (step) => this.skipStep(run, step),
      );
      // Run the first instantaneous steps right away, as the author would expect.
      if (run.root.update(0)) this.end(run, false);
    } catch (err) {
      this.host.warn(`sequence "${def.id}" failed to start: ${String(err)}`);
      this.end(run, true);
      return false;
    }
    return true;
  }

  private end(run: Run, cancelled: boolean, skipped = false): void {
    if (!this.runs.includes(run)) return;
    this.runs = this.runs.filter((r) => r !== run);
    if (cancelled) {
      try {
        run.root.cancel?.();
      } catch (err) {
        this.host.warn(`sequence "${run.def.id}" cancel failed: ${String(err)}`);
      }
    }
    for (const fn of run.endFns.reverse()) fn();
    for (const release of run.releases.reverse()) release();
    for (const off of run.listeners) off();
    this.host.events.emit('sequence:ended', { id: run.def.id, cancelled, skipped });
    this.drainQueue();
  }

  private drainQueue(): void {
    for (const id of [...this.queue]) {
      const def = this.defs.get(id);
      if (!def) continue;
      if (def.exclusive && this.runs.some((r) => r.def.exclusive === def.exclusive)) continue;
      this.queue = this.queue.filter((q) => q !== id);
      this.begin(def, true);
    }
  }

  // ------------------------------------------------------------------ steps

  private startStep(run: Run, step: Step): Running | void {
    if (isParallel(step)) {
      const kids: Running[] = [];
      for (const child of step.parallel) {
        const r = this.startStep(run, child);
        if (r) kids.push(r);
      }
      return kids.length ? new Parallel(kids) : undefined;
    }
    const def = ACTIONS[step.do];
    if (!def) throw new Error(`unknown action "${step.do}"`);
    const ctx = this.contextFor(run);
    const r = def.start(step, ctx);
    if (!r || r.skip) return r;
    // A step in flight: skipping stops it and applies its end state once.
    return {
      update: (dt) => r.update(dt),
      cancel: () => r.cancel?.(),
      skip: () => {
        r.cancel?.();
        def.skip?.(step, ctx);
      },
    };
  }

  /** Apply a step's end state without playing it. */
  private skipStep(run: Run, step: Step): void {
    if (isParallel(step)) {
      for (const child of step.parallel) this.skipStep(run, child);
      return;
    }
    const def = ACTIONS[step.do];
    if (!def) return;
    const ctx = this.contextFor(run);
    if (def.skip) def.skip(step, ctx);
    else def.start(step, ctx)?.cancel?.();
  }

  private contextFor(run: Run): ActionContext {
    const host = this.host;
    return {
      host,
      seqId: run.def.id,
      isRunning: (id) => this.isRunning(id) || this.queue.includes(id),
      build: (steps) =>
        new Serial(
          steps,
          (step) => this.startStep(run, step),
          (step) => this.skipStep(run, step),
        ),
      skipSteps: (steps) => {
        for (const step of steps) this.skipStep(run, step);
      },
      listen: (event, fn) => {
        const off = host.events.on(event, fn);
        run.listeners.push(off);
        return off;
      },
      pushControl: (over: ControlOverride) => {
        if (!host.pushControl) return this.missing('player control');
        run.releases.push(host.pushControl(over, `seq:${run.def.id}`));
      },
      releaseControl: () => {
        for (const release of run.releases.splice(0).reverse()) release();
      },
      onEnd: (fn) => {
        run.endFns.push(fn);
      },
      checkpoint: (id, label) => {
        run.checkpointed = true;
        this.snapshot = this.takeSnapshot(id, run);
        host.checkpoint?.(id, label);
      },
      hook: (name) => this.hooks.get(name),
      missing: (feature) => this.missing(feature),
    };
  }

  private missing(feature: string): void {
    if (this.warned.has(feature)) return;
    this.warned.add(feature);
    this.host.warn(`${feature} is not available yet; skipped`);
  }

  // ------------------------------------------------------------------ checkpoints

  private takeSnapshot(checkpoint: string, taker: Run): ScriptSnapshot {
    return {
      checkpoint,
      doors: { ...(this.host.doorStates?.() ?? {}) },
      lights: { ...(this.host.lightStates?.() ?? {}) },
      resume: this.runs
        .filter((r) => r !== taker && r.def.resumeFromCheckpoint && !r.checkpointed)
        .map((r) => r.def.id),
    };
  }

  /** Death: remember what was in flight, then stop it so nothing keeps running. */
  private onDeath(): void {
    this.dying = this.runs.filter((r) => r.def.resumeFromCheckpoint && !r.checkpointed).map((r) => r.def.id);
    this.cancelAll();
  }

  /**
   * The load itself announced `game:mode playing`, which started the restore sequences; the
   * restart then cancelled them (and the NPC reset ran after them). Run them again, once the
   * dust has settled. They must be idempotent (ADR-0009), as pause/resume fires them too.
   */
  private refireRestores(): void {
    for (const d of this.defs.values()) {
      const t = d.trigger;
      if (!t || t.event !== 'game:mode' || t.match?.['mode'] !== 'playing') continue;
      if (t.requires && !this.host.flags[t.requires]) continue;
      if (t.unless && this.host.flags[t.unless]) continue;
      this.begin(d, false);
    }
  }

  /** The game reloaded the checkpoint autosave: put the scripted world back as it was. */
  private onRestart(checkpoint: string | null): void {
    const resume = new Set(this.dying);
    this.dying = [];
    this.cancelAll();
    const snap = this.snapshot && checkpoint !== null && this.snapshot.checkpoint === checkpoint ? this.snapshot : null;
    if (snap) {
      for (const [id, state] of Object.entries(snap.doors)) this.host.setDoor?.(id, state);
      for (const [room, pattern] of Object.entries(snap.lights)) this.host.setLight?.(room, pattern);
      for (const id of snap.resume) resume.add(id);
    }
    for (const id of resume) {
      const def = this.defs.get(id);
      if (def) this.begin(def, true);
    }
    this.refireRestores();
  }
}
