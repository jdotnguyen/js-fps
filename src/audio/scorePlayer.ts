import type { ScoreCue, ScoreDef, ScoreTable } from '../data/types/scores.ts';

/**
 * Adaptive scores in play (adaptive-music spec). Every layer of a score loops from one shared start time, so they stay
 * in step by construction; cues only move layer levels. Stingers are one-shots over the layers. The renders come from a
 * worker (`scoreWorker.ts`); a cue that arrives before the render is remembered and applied once it lands.
 */

/** Stereo pair, as rendered. */
export interface StereoPair {
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
}

export interface RenderedScore {
  sampleRate: number;
  layers: Record<string, StereoPair>;
  /** Stinger name -> variants (one is picked per play, never the same twice in a row). */
  stingers: Record<string, StereoPair[]>;
}

export interface ScoreLevel {
  setGain(value: number, timeConstant: number): void;
}

export interface ScoreBusHandle extends ScoreLevel {
  release(): void;
}

export interface ScoreLayerHandle extends ScoreLevel {
  stop(): void;
}

/** What the player needs from Web Audio (the engine adapter in `scoreAudio.ts`; a recorder in tests). */
export interface ScoreAudio {
  /** AudioContext time (s). */
  now(): number;
  /** A gain stage on the music bus that a score's layers and stingers feed. */
  bus(): ScoreBusHandle;
  /** Start a looping layer at `when` (silent until raised). */
  layer(bus: ScoreBusHandle, data: StereoPair, sampleRate: number, when: number): ScoreLayerHandle;
  /** Play a one-shot at `when` with a fixed gain. */
  oneShot(bus: ScoreBusHandle, data: StereoPair, sampleRate: number, when: number, gain: number): void;
}

export type ScoreRenderer = (id: string) => Promise<RenderedScore>;

type Vec3 = { x: number; y: number; z: number };

interface Active {
  id: string;
  def: ScoreDef;
  state: 'rendering' | 'playing';
  /** Latest cue, applied once the render lands. */
  pending: string | null;
  cue: string | null;
  bus: ScoreBusHandle | null;
  layers: Map<string, ScoreLayerHandle>;
  /** Level each layer is heading to (before distance ties). */
  targets: Map<string, number>;
  /** Level last sent to each layer. */
  sent: Map<string, number>;
  rendered: RenderedScore | null;
  start: number;
  distanceOn: boolean;
  /** Smoothed 0 (far) .. 1 (near). */
  closeness: number;
  releaseAt: number | null;
  duckUntil: number | null;
  lastVariant: Map<string, number>;
  /** Fading out under `fadeOutAll`; released when the fade ends unless cued again first. */
  fading: boolean;
}

/** A hard cut reaches silence this fast (spec: within 50 ms). */
const CUT_TC = 0.004;
const DISTANCE_TC = 0.25;

export class ScorePlayer {
  private readonly audio: ScoreAudio;
  private readonly table: ScoreTable;
  private readonly render: ScoreRenderer;
  private readonly warn: (m: string) => void;
  private readonly active = new Map<string, Active>();
  /** Seconds of play clock (update dt), for releases and ducks. */
  private clock = 0;

  constructor(audio: ScoreAudio, table: ScoreTable, render: ScoreRenderer, warn: (m: string) => void = (m) => console.warn(m)) {
    this.audio = audio;
    this.table = table;
    this.render = render;
    this.warn = warn;
  }

  /** Bus events the scores react to: cue names that look like events, plus duck events. */
  events(): string[] {
    const out = new Set<string>();
    for (const s of Object.values(this.table)) {
      for (const c of Object.keys(s.cues)) if (c.includes(':')) out.add(c);
      if (s.duck) out.add(s.duck.event);
    }
    return [...out];
  }

  /** A bus event fired: cue every score that names it, and duck the ones that duck on it. */
  onEvent(name: string): void {
    for (const [id, s] of Object.entries(this.table)) {
      if (name in s.cues) this.cue(id, name);
      if (s.duck?.event === name) this.duck(id);
    }
  }

  /** Start rendering a score ahead of its first cue. */
  load(id: string): void {
    this.ensure(id);
  }

  /** Set a score's cue. A score that is not loaded yet starts loading, and the cue waits for it. */
  cue(id: string, cue: string): void {
    const def = this.table[id];
    if (!def) return this.warn(`[score] no score "${id}"`);
    if (!(cue in def.cues)) return this.warn(`[score] ${id}: no cue "${cue}"`);
    // A score fading out (`fadeOutAll`) is cued afresh: drop the old one and start again.
    if (this.active.get(id)?.fading) this.release(id);
    const a = this.ensure(id);
    if (!a) return;
    if (a.state === 'rendering') {
      a.pending = cue;
      return;
    }
    this.apply(a, cue);
  }

  /** Play a stinger on whichever playing score has it. */
  stinger(name: string, id?: string): void {
    for (const a of this.active.values()) {
      if (id !== undefined && a.id !== id) continue;
      if (a.state === 'playing' && name in a.def.stingers) {
        this.playStinger(a, name);
        return;
      }
    }
    if (id !== undefined && this.table[id] && !(name in this.table[id]!.stingers)) this.warn(`[score] ${id}: no stinger "${name}"`);
  }

  /** AudioContext time of the next beat of the first playing score; now when none plays. */
  nextBeat(): number {
    const now = this.audio.now();
    for (const a of this.active.values()) {
      if (a.state !== 'playing' || a.releaseAt !== null) continue;
      const beat = a.def.beat;
      const n = Math.ceil((now - a.start) / beat - 1e-6);
      return a.start + Math.max(0, n) * beat;
    }
    return now;
  }

  /** Seconds until the next beat (0 with no score playing). */
  untilBeat(): number {
    return Math.max(0, this.nextBeat() - this.audio.now());
  }

  /** Per frame: distance ties, releases and duck recovery. */
  update(dt: number, player: Vec3 | null, resolve: (target: string | [number, number, number]) => Vec3 | null): void {
    this.clock += dt;
    for (const a of [...this.active.values()]) {
      if (a.state !== 'playing') continue;
      if (a.releaseAt !== null && this.clock >= a.releaseAt) {
        this.release(a.id);
        continue;
      }
      if (a.duckUntil !== null && this.clock >= a.duckUntil) {
        a.duckUntil = null;
        a.bus?.setGain(a.def.level ?? 1, (a.def.duck?.recover ?? 0.8) / 3);
      }
      const d = a.def.distance;
      if (!d || !a.distanceOn || !player) continue;
      const at = resolve(d.target);
      if (!at) continue;
      const dist = Math.hypot(player.x - at.x, player.z - at.z);
      const want = Math.min(1, Math.max(0, (d.far - dist) / (d.far - d.near)));
      a.closeness += (want - a.closeness) * Math.min(1, dt / DISTANCE_TC);
      for (const [layer, [far, near]] of Object.entries(d.layers)) this.send(a, layer, far + (near - far) * a.closeness, DISTANCE_TC);
    }
  }

  /** Whether any score is playing (or rendering to play). */
  get playing(): boolean {
    for (const a of this.active.values()) if (!a.fading) return true;
    return false;
  }

  /**
   * Fade every score out over about `seconds`, then free its audio (the end credits closing). Works off the audio
   * clock, not `update`, which only runs in play. A score cued again before then starts over instead.
   */
  fadeOutAll(seconds: number): void {
    for (const a of [...this.active.values()]) {
      if (a.state !== 'playing' || !a.bus) {
        this.release(a.id);
        continue;
      }
      a.fading = true;
      a.duckUntil = null;
      a.releaseAt = null;
      a.bus.setGain(0, seconds / 4);
      const done = a;
      setTimeout(() => {
        if (this.active.get(done.id) === done && done.fading) this.release(done.id);
      }, seconds * 1000);
    }
  }

  /** Stop every score now (restart, quit to title) and free its audio. */
  stopAll(): void {
    for (const id of [...this.active.keys()]) this.release(id);
  }

  /** Checkpoint restore: start each score whose resume rule matches the flags. */
  resume(flags: Readonly<Record<string, unknown>>): void {
    for (const [id, s] of Object.entries(this.table)) {
      for (const r of s.resume ?? []) {
        const ok = Object.entries(r.flags).every(([k, v]) => (v === false ? !flags[k] : flags[k] === v));
        if (ok) {
          this.cue(id, r.cue);
          break;
        }
      }
    }
  }

  /** Stop a score and drop its audio. */
  release(id: string): void {
    const a = this.active.get(id);
    if (!a) return;
    for (const l of a.layers.values()) l.stop();
    a.layers.clear();
    a.bus?.release();
    a.rendered = null;
    this.active.delete(id);
  }

  /** Debug and tests: a score's state, cue and the levels last sent to its layers. */
  inspect(id: string): { state: 'idle' | 'rendering' | 'playing'; cue: string | null; levels: Record<string, number>; distance: boolean } {
    const a = this.active.get(id);
    if (!a) return { state: 'idle', cue: null, levels: {}, distance: false };
    return { state: a.state, cue: a.cue ?? a.pending, levels: Object.fromEntries(a.sent), distance: a.distanceOn };
  }

  // ------------------------------------------------------------------ internals

  private ensure(id: string): Active | null {
    const existing = this.active.get(id);
    if (existing) return existing;
    const def = this.table[id];
    if (!def) {
      this.warn(`[score] no score "${id}"`);
      return null;
    }
    const a: Active = {
      id,
      def,
      state: 'rendering',
      pending: null,
      cue: null,
      bus: null,
      layers: new Map(),
      targets: new Map(),
      sent: new Map(),
      rendered: null,
      start: 0,
      distanceOn: false,
      closeness: 0,
      releaseAt: null,
      duckUntil: null,
      lastVariant: new Map(),
      fading: false,
    };
    this.active.set(id, a);
    this.render(id).then(
      (r) => {
        if (this.active.get(id) !== a) return; // released while rendering
        this.begin(a, r);
      },
      (e: unknown) => {
        this.warn(`[score] ${id}: render failed (${e instanceof Error ? e.message : String(e)})`);
        if (this.active.get(id) === a) this.active.delete(id);
      },
    );
    return a;
  }

  private begin(a: Active, r: RenderedScore): void {
    a.rendered = r;
    a.bus = this.audio.bus();
    a.bus.setGain(a.def.level ?? 1, 0.01);
    // Every layer from one start time, a little ahead so the graph is built before the first sample.
    a.start = this.audio.now() + 0.05;
    for (const name of a.def.layers) {
      const data = r.layers[name];
      if (!data) {
        this.warn(`[score] ${a.id}: render has no layer "${name}"`);
        continue;
      }
      a.layers.set(name, this.audio.layer(a.bus, data, r.sampleRate, a.start));
    }
    // Web Audio holds its own copy of each layer now; keep only the stingers here.
    r.layers = {};
    a.state = 'playing';
    const cue = a.pending;
    a.pending = null;
    if (cue) this.apply(a, cue);
  }

  private apply(a: Active, name: string): void {
    const cue: ScoreCue = a.def.cues[name]!;
    a.cue = name;
    a.releaseAt = cue.release !== undefined ? this.clock + cue.release : null;
    if (cue.distance !== undefined) {
      a.distanceOn = cue.distance;
      if (cue.distance) a.closeness = 0;
    }
    const tc = cue.cut ? CUT_TC : Math.max(0.01, (cue.fade ?? 1) / 3);
    for (const layer of a.def.layers) {
      const v = cue.cut ? 0 : (cue.layers?.[layer] ?? 0);
      a.targets.set(layer, v);
      const tied = a.distanceOn && a.def.distance?.layers[layer];
      if (tied) continue; // the distance tie owns this layer's level
      this.send(a, layer, v, tc, true);
    }
    if (cue.stinger) this.playStinger(a, cue.stinger);
  }

  private send(a: Active, layer: string, v: number, tc: number, force = false): void {
    const prev = a.sent.get(layer);
    if (!force && prev !== undefined && Math.abs(prev - v) < 0.005) return;
    a.sent.set(layer, v);
    a.layers.get(layer)?.setGain(v, tc);
  }

  private duck(id: string): void {
    const a = this.active.get(id);
    const d = a?.def.duck;
    if (!a || !d || a.state !== 'playing' || !a.bus) return;
    a.bus.setGain((a.def.level ?? 1) * Math.pow(10, d.db / 20), 0.03);
    a.duckUntil = this.clock + d.hold;
  }

  private playStinger(a: Active, name: string): void {
    const variants = a.rendered?.stingers[name];
    if (!variants?.length || !a.bus) return this.warn(`[score] ${a.id}: no stinger "${name}"`);
    const last = a.lastVariant.get(name) ?? -1;
    const i = variants.length === 1 ? 0 : (last + 1) % variants.length;
    a.lastVariant.set(name, i);
    this.audio.oneShot(a.bus, variants[i]!, a.rendered!.sampleRate, this.audio.now(), a.def.stingers[name] ?? 1);
  }
}
