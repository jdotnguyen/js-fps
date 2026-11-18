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

/** Seconds the objective line stays up (ADR-0012). */
export const BANNER_SECONDS = 5;

export interface BannerLine {
  /** "New objective", "Objective complete", "Objectives". */
  label: string;
  text: string;
  done: boolean;
}

/**
 * Timing of the top-left objective line: a change shows for 5 s (several changes in a row
 * stack into one banner), Tab shows the active list again for 5 s.
 */
export class ObjectiveBanner {
  lines: BannerLine[] = [];
  private left = 0;
  private recalled = false;
  private readonly seconds: number;

  constructor(seconds = BANNER_SECONDS) {
    this.seconds = seconds;
  }

  get visible(): boolean {
    return this.left > 0 && this.lines.length > 0;
  }

  /** An objective started or finished. Joins the banner if it is still up. */
  push(c: ObjectiveChange): void {
    if (!this.visible || this.recalled) this.lines = [];
    this.recalled = false;
    const line: BannerLine = c.kind === 'new' ? { label: c.def.required ? 'New objective' : 'New optional', text: c.def.title, done: false } : { label: 'Objective complete', text: c.def.title, done: true };
    this.lines = [...this.lines.filter((l) => l.text !== line.text), line].slice(-4);
    this.left = this.seconds;
  }

  /** Tab: show what is active now. */
  recall(active: readonly ObjectiveDef[]): void {
    this.recalled = true;
    this.lines = active.length ? active.map((d) => ({ label: d.required ? 'Objective' : 'Optional', text: d.title, done: false })) : [{ label: 'Objectives', text: 'No current objectives', done: false }];
    this.left = this.seconds;
  }

  hide(): void {
    this.left = 0;
  }

  update(dt: number): void {
    if (this.left > 0) this.left = Math.max(0, this.left - dt);
  }
}
