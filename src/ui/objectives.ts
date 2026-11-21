import type { EventMatch, ObjectiveDef, ObjectiveTable } from '../data/types/objectives.ts';

/**
 * Objectives (ADR-0024 step 3), the pure part. State lives in the playthrough's flags as
 * `obj:<id>` = "active" | "done" (the sequence actions `setObjective` / `completeObjective`
 * write the same flags), so it saves and loads with the game for free (ADR-0016).
 * `ObjectiveTracker` also starts and finishes objectives from `startOn` / `completeOn`
 * events, and `ObjectiveBanner` is the top-left HUD line's timing (ADR-0012: 5 s on change,
 * Tab shows it again).
 */

export type Scalar = string | number | boolean;
export type Flags = Record<string, Scalar>;
export type ObjectiveState = 'active' | 'done' | null;

/** The event bus with string names (data names the events). */
export interface LooseBus {
  on(name: string, fn: (payload: unknown) => void): () => void;
  emit(name: string, payload?: unknown): void;
}

export interface ObjectiveEntry {
  def: ObjectiveDef;
  state: 'active' | 'done';
}

export interface ObjectiveChange {
  kind: 'new' | 'done';
  def: ObjectiveDef;
}

/** True if `payload` is an object whose fields equal every `match` value. */
export function eventMatches(m: EventMatch, payload: unknown): boolean {
  if (!m.match) return true;
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return Object.entries(m.match).every(([k, v]) => p[k] === v);
}

/** "obj_survive_lab" -> "Survive lab", for ids a sequence uses that the data file lacks. */
function fallbackTitle(id: string): string {
  const words = id.replace(/^(obj|opt|round)_/, '').replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export class ObjectiveTracker {
  private readonly defs: ObjectiveTable;
  private readonly flags: () => Flags;
  private readonly bus: LooseBus;
  private readonly listeners = new Set<(c: ObjectiveChange) => void>();
  private readonly offs: Array<() => void> = [];

  constructor(defs: ObjectiveTable, flags: () => Flags, bus: LooseBus) {
    this.defs = { ...defs };
    this.flags = flags;
    this.bus = bus;
    this.offs.push(
      bus.on('objective:set', (p) => this.changed('new', idOf(p))),
      bus.on('objective:done', (p) => this.changed('done', idOf(p))),
    );
    for (const def of Object.values(this.defs)) {
      const d = def;
      if (d.startOn) {
        const m = d.startOn;
        this.offs.push(bus.on(m.event, (p) => eventMatches(m, p) && this.start(d.id)));
      }
      if (d.completeOn) {
        const m = d.completeOn;
        this.offs.push(bus.on(m.event, (p) => eventMatches(m, p) && this.complete(d.id)));
      }
    }
  }

  def(id: string): ObjectiveDef {
    return (this.defs[id] ??= { id, title: fallbackTitle(id), required: true });
  }

  state(id: string): ObjectiveState {
    const v = this.flags()[`obj:${id}`];
    return v === 'active' || v === 'done' ? v : null;
  }

  /** Start an objective (no-op if already active or done). Emits `objective:set`. */
  start(id: string): boolean {
    if (this.state(id) !== null) return false;
    this.flags()[`obj:${id}`] = 'active';
    this.bus.emit('objective:set', { id });
    return true;
  }

  /** Finish an objective, starting it first if needed. Emits `objective:done`. */
  complete(id: string): boolean {
    if (this.state(id) === 'done') return false;
    this.flags()[`obj:${id}`] = 'done';
    this.bus.emit('objective:done', { id });
    return true;
  }

  /** Everything started so far, in the order the flags were set, required and optional apart. */
  list(): { required: ObjectiveEntry[]; optional: ObjectiveEntry[] } {
    const required: ObjectiveEntry[] = [];
    const optional: ObjectiveEntry[] = [];
    for (const [k, v] of Object.entries(this.flags())) {
      if (!k.startsWith('obj:') || (v !== 'active' && v !== 'done')) continue;
      const def = this.def(k.slice(4));
      (def.required ? required : optional).push({ def, state: v });
    }
    return { required, optional };
  }

  /** Active objectives, required first. */
  active(): ObjectiveDef[] {
    const { required, optional } = this.list();
    return [...required, ...optional].filter((e) => e.state === 'active').map((e) => e.def);
  }

  onChange(fn: (c: ObjectiveChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose(): void {
    for (const off of this.offs) off();
  }

  private changed(kind: 'new' | 'done', id: string | null): void {
    if (!id) return;
    const def = this.def(id);
    for (const fn of [...this.listeners]) fn({ kind, def });
  }
}

function idOf(p: unknown): string | null {
  if (typeof p !== 'object' || p === null) return null;
  const id = (p as Record<string, unknown>)['id'];
  return typeof id === 'string' ? id : null;
}

/** Seconds a completed objective lingers with a checkmark before clearing (hud-wayfinding spec). */
export const DONE_SECONDS = 3.5;
/** Seconds a newly added objective shows its highlight state. */
export const NEW_SECONDS = 2.5;
/** Seconds the Tab pulse emphasis lasts (and empty recall notice). */
export const PULSE_SECONDS = 2.0;

export interface BannerLine {
  id: string;
  /** "Objective", "Optional", "Objective complete", "Objectives". */
  label: string;
  text: string;
  done: boolean;
  optional: boolean;
  fresh: boolean;
}

/**
 * Persistent right-side objective list state (hud-wayfinding spec): active objectives stay
 * visible continuously while playing; newly added ones highlight briefly; completed ones show
 * a checkmark briefly before clearing; Tab pulses the panel (or notes when none are active).
 */
export class ObjectiveBanner {
  private readonly doneTimers = new Map<string, { def: ObjectiveDef; left: number }>();
  private readonly newTimers = new Map<string, number>();
  private pulseLeft = 0;
  private emptyNoticeLeft = 0;
  private readonly doneSeconds: number;
  private readonly newSeconds: number;
  private readonly pulseSeconds: number;

  constructor(doneSeconds = DONE_SECONDS, newSeconds = NEW_SECONDS, pulseSeconds = PULSE_SECONDS) {
    this.doneSeconds = doneSeconds;
    this.newSeconds = newSeconds;
    this.pulseSeconds = pulseSeconds;
  }

  /** Whether the Tab pulse highlight is currently active. */
  get pulsed(): boolean {
    return this.pulseLeft > 0;
  }

  /** An objective started or finished. */
  push(c: ObjectiveChange): void {
    this.emptyNoticeLeft = 0;
    if (c.kind === 'new') {
      this.doneTimers.delete(c.def.id);
      this.newTimers.set(c.def.id, this.newSeconds);
    } else {
      this.newTimers.delete(c.def.id);
      this.doneTimers.set(c.def.id, { def: c.def, left: this.doneSeconds });
    }
  }

  /** Tab: emphasize the active objective list (or briefly show "No current objectives"). */
  recall(active: readonly ObjectiveDef[]): void {
    this.pulseLeft = this.pulseSeconds;
    this.emptyNoticeLeft = active.length === 0 && this.doneTimers.size === 0 ? this.pulseSeconds : 0;
  }

  clear(): void {
    this.doneTimers.clear();
    this.newTimers.clear();
    this.pulseLeft = 0;
    this.emptyNoticeLeft = 0;
  }

  update(dt: number): void {
    if (this.pulseLeft > 0) this.pulseLeft = Math.max(0, this.pulseLeft - dt);
    if (this.emptyNoticeLeft > 0) this.emptyNoticeLeft = Math.max(0, this.emptyNoticeLeft - dt);
    for (const [id, left] of [...this.newTimers]) {
      const next = left - dt;
      if (next <= 0) this.newTimers.delete(id);
      else this.newTimers.set(id, next);
    }
    for (const [id, entry] of [...this.doneTimers]) {
      entry.left -= dt;
      if (entry.left <= 0) this.doneTimers.delete(id);
    }
  }

  /** Current lines to display for the active objectives plus any recently completed checkmarks. */
  snapshot(active: readonly ObjectiveDef[]): { visible: boolean; pulsed: boolean; lines: BannerLine[] } {
    const lines: BannerLine[] = active.map((d) => ({
      id: d.id,
      label: d.required ? 'Objective' : 'Optional',
      text: d.title,
      done: false,
      optional: !d.required,
      fresh: this.newTimers.has(d.id),
    }));
    const activeIds = new Set(active.map((d) => d.id));
    for (const { def } of this.doneTimers.values()) {
      if (activeIds.has(def.id)) continue;
      lines.push({
        id: def.id,
        label: 'Complete',
        text: def.title,
        done: true,
        optional: !def.required,
        fresh: false,
      });
    }
    if (lines.length === 0 && this.emptyNoticeLeft > 0) {
      lines.push({
        id: '__empty__',
        label: 'Objectives',
        text: 'No current objectives',
        done: false,
        optional: false,
        fresh: false,
      });
    }
    return { visible: lines.length > 0, pulsed: this.pulseLeft > 0, lines };
  }
}
