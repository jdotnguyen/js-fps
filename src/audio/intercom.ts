/**
 * A room intercom (in-world-audio: "A live intercom relays a room", "The intercom clicks and hisses", "The intercom
 * overloads on loud sounds"; overhaul-priya-r08-death D25). Room mics in a source room feed a wall grille in another
 * room. While live, every positioned world sound and local voice that starts in a source room is also tapped, dry
 * and unoccluded, into this chain:
 *   input -> drive -> HP 300 -> LP 3400 -> peak 1.5 kHz -> tanh shaper -> compressor -> level
 *   -> HRTF panner at the grille (gentle falloff) -> out (+ a little room reverb).
 * A crackle bed runs under it while live, and a level follower on the input pushes the drive and the crackle harder
 * while the input is loud (a scream, a slam), recovering within about half a second. The direct sound is untouched.
 * The speaker itself is heard like any sound from where it hangs: muffled and quieter through a wall or closed door,
 * a little duller through glass, followed as the listener moves and doors open (`occlusion`).
 */
import * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import { GLASS_CUTOFF_HZ, GLASS_GAIN_SCALE, OCCLUDED_CUTOFF_HZ, OCCLUDED_GAIN_SCALE, SEALED_CUTOFF_HZ, SEALED_GAIN_SCALE, type Occlusion } from './occlusion.ts';
import { crackleBuffer, saturationCurve } from './radio.ts';

export const INTERCOM_FX = {
  highpass: 300,
  lowpass: 3400,
  peakHz: 1500,
  peakDb: 4,
  baseDrive: 2.4,
  /** Extra shaper drive at full overload, on top of `baseDrive` (input level into the shaper). */
  overloadDrive: 2.2,
  /** Input RMS where overload starts and where it is full. */
  overloadFrom: 0.08,
  overloadFull: 0.3,
  crackleBase: 0.5,
  crackleOverload: 2.2,
  /** Follower time constants (s): fast attack, recovery well inside 0.5 s. */
  attack: 0.02,
  release: 0.12,
  /** The grille's panner: clear anywhere in a 12 m room. */
  refDistance: 4,
  rolloff: 0.5,
  level: 1.15,
  reverbSend: 0.18,
  /** How often (s) a live speaker re-checks what stands between it and the listener, and how fast (s) it follows. */
  occlusionCheck: 0.1,
  occlusionSmooth: 0.08,
};

/** The speaker's low-pass and level with nothing in the way: open (its own band already ends at 3.4 kHz). */
const OPEN_CUTOFF_HZ = 20000;

/** The speaker heard through what stands between it and the listener (in-world-audio "A live intercom relays a room"). */
export function intercomOcclusion(o: Occlusion): { cutoff: number; gain: number } {
  if (o === 'wall') return { cutoff: OCCLUDED_CUTOFF_HZ, gain: OCCLUDED_GAIN_SCALE };
  if (o === 'sealed') return { cutoff: SEALED_CUTOFF_HZ, gain: SEALED_GAIN_SCALE };
  if (o === 'glass') return { cutoff: GLASS_CUTOFF_HZ, gain: GLASS_GAIN_SCALE };
  return { cutoff: OPEN_CUTOFF_HZ, gain: 1 };
}

/** Overload amount 0..1 for an input RMS (pure; the follower smooths it). */
export function overloadAmount(rms: number, fx = INTERCOM_FX): number {
  if (!(rms > fx.overloadFrom)) return 0;
  return Math.min(1, (rms - fx.overloadFrom) / (fx.overloadFull - fx.overloadFrom));
}

/** Smooths the overload amount: rises fast, falls within about half a second. */
export class OverloadFollower {
  value = 0;
  private readonly fx: typeof INTERCOM_FX;
  constructor(fx = INTERCOM_FX) {
    this.fx = fx;
  }
  step(rms: number, dt: number): number {
    const target = overloadAmount(rms, this.fx);
    const tc = target > this.value ? this.fx.attack : this.fx.release;
    this.value += (target - this.value) * (1 - Math.exp(-dt / tc));
    if (this.value < 1e-4) this.value = 0;
    return this.value;
  }
  /** Drive into the shaper and crackle bed level for the current amount. */
  drive(): number {
    return this.fx.baseDrive + this.fx.overloadDrive * this.value;
  }
  crackle(): number {
    return this.fx.crackleBase + this.fx.crackleOverload * this.value;
  }
}

/** A short switch click (a relay contact) and a burst of band-limited static (pure, for a buffer). */
export function renderClick(sampleRate: number, rng: Rng): Float32Array<ArrayBuffer> {
  const n = Math.floor(sampleRate * 0.03);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (rng.next() * 2 - 1) * Math.exp(-i / (sampleRate * 0.0025)) * 0.8;
  return out;
}

export function renderStaticBurst(sampleRate: number, rng: Rng, seconds = 0.45): Float32Array<ArrayBuffer> {
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    lp += ((rng.next() * 2 - 1) - lp) * 0.35;
    const env = Math.min(1, t * 40) * (1 - t) ** 1.6;
    out[i] = lp * env * 0.55;
  }
  return out;
}

export interface IntercomOptions {
  readonly id: string;
  /** World position of the grille. */
  readonly position: THREE.Vector3;
  /** Whether a world position is inside one of the intercom's source rooms. */
  readonly contains: (p: THREE.Vector3) => boolean;
  /** Where the grille's sound goes (the engine's sfx bus). */
  readonly out: AudioNode;
  readonly reverbIn?: AudioNode | null;
  /** Loudness multiplier for this grille (default 1): a mic that must carry across a big room. */
  readonly level?: number;
  /**
   * Plays the recorded switch sounds at the grille (`intercomClick`, `intercomStatic`); returns false when a sample is not
   * loaded, and the intercom falls back to its own procedural click or burst (procedural audio is fallback-only).
   */
  readonly playSample?: (name: 'intercomClick' | 'intercomStatic', gain: number) => boolean;
  /** What stands between the listener and the grille now (the engine's occluder); without it the speaker is always clear. */
  readonly occlusion?: (grille: THREE.Vector3) => Occlusion;
}

export class Intercom {
  readonly id: string;
  readonly position: THREE.Vector3;
  /** Relayed sounds connect here (dry, before any occlusion). */
  readonly input: GainNode;
  private readonly contains: (p: THREE.Vector3) => boolean;
  private readonly ctx: AudioContext;
  private readonly drive: GainNode;
  private readonly shaperIn: AudioNode;
  private readonly bedGain: GainNode;
  private readonly bedSrc: AudioBufferSourceNode;
  private readonly clickBuf: AudioBuffer;
  private readonly staticBuf: AudioBuffer;
  private readonly panner: PannerNode;
  private readonly analyser: AnalyserNode | null;
  private readonly samples: Float32Array<ArrayBuffer> | null;
  private readonly follower = new OverloadFollower();
  private readonly playSample: IntercomOptions['playSample'];
  /** The speaker heard through a wall, door or glass: a low-pass and a level after everything else in the chain. */
  private readonly occlusionLp: BiquadFilterNode;
  private readonly occlusionGain: GainNode;
  private readonly occlusionOf: IntercomOptions['occlusion'];
  private occlusionNow: Occlusion = 'none';
  private sinceOcclusion = 0;
  private liveNow = false;
  private disposed = false;

  constructor(ctx: AudioContext, opts: IntercomOptions) {
    this.ctx = ctx;
    this.id = opts.id;
    this.position = opts.position.clone();
    this.contains = opts.contains;
    this.playSample = opts.playSample;
    this.occlusionOf = opts.occlusion;
    const fx = INTERCOM_FX;
    this.input = new GainNode(ctx, { gain: 0 });
    this.drive = new GainNode(ctx, { gain: fx.baseDrive / 2 });
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: fx.highpass, Q: 0.7 });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: fx.lowpass, Q: 0.7 });
    const peak = new BiquadFilterNode(ctx, { type: 'peaking', frequency: fx.peakHz, Q: 1, gain: fx.peakDb });
    const shaper = new WaveShaperNode(ctx, { curve: saturationCurve(2), oversample: '2x' });
    const comp = new DynamicsCompressorNode(ctx, { threshold: -18, knee: 6, ratio: 8, attack: 0.002, release: 0.1 });
    const level = new GainNode(ctx, { gain: fx.level * (opts.level ?? 1) });
    this.panner = new PannerNode(ctx, {
      panningModel: 'HRTF', distanceModel: 'inverse', refDistance: fx.refDistance, maxDistance: 60, rolloffFactor: fx.rolloff,
      positionX: this.position.x, positionY: this.position.y, positionZ: this.position.z,
    });
    this.occlusionLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: OPEN_CUTOFF_HZ, Q: 0.5 });
    this.occlusionGain = new GainNode(ctx, { gain: 1 });
    this.input.connect(this.drive).connect(hp).connect(lp).connect(peak).connect(shaper).connect(comp).connect(level).connect(this.occlusionLp).connect(this.occlusionGain).connect(this.panner).connect(opts.out);
    this.shaperIn = hp;
    if (opts.reverbIn) this.panner.connect(new GainNode(ctx, { gain: fx.reverbSend })).connect(opts.reverbIn);

    const rng = new Rng(`intercom:${opts.id}`);
    const sr = ctx.sampleRate;
    const bed = crackleBuffer(sr, 4, rng);
    // A low hiss under the crackle, so a live line is never dead silent.
    for (let i = 0; i < bed.length; i++) bed[i] = bed[i]! + (rng.next() * 2 - 1) * 0.006;
    const bedBuf = ctx.createBuffer(1, bed.length, sr);
    bedBuf.copyToChannel(bed, 0);
    this.bedSrc = new AudioBufferSourceNode(ctx, { buffer: bedBuf, loop: true });
    this.bedGain = new GainNode(ctx, { gain: 0 });
    this.bedSrc.connect(this.bedGain).connect(this.shaperIn);
    this.bedSrc.start();
    this.clickBuf = this.toBuffer(renderClick(sr, rng));
    this.staticBuf = this.toBuffer(renderStaticBurst(sr, rng));

    const Analyser = (globalThis as { AnalyserNode?: typeof AnalyserNode }).AnalyserNode;
    if (Analyser) {
      this.analyser = new Analyser(ctx, { fftSize: 512 });
      this.input.connect(this.analyser);
      this.samples = new Float32Array(this.analyser.fftSize);
    } else {
      this.analyser = null;
      this.samples = null;
    }
  }

  get live(): boolean {
    return this.liveNow;
  }

  /** Whether a sound starting at `p` is relayed now. */
  relays(p: THREE.Vector3 | null | undefined): boolean {
    return this.liveNow && !this.disposed && p !== null && p !== undefined && this.contains(p);
  }

  setLive(on: boolean): void {
    if (this.disposed || on === this.liveNow) return;
    this.liveNow = on;
    // Heard from where it hangs from the first click: through the door at once, not clear for a moment first.
    if (on) this.checkOcclusion(true);
    const t = this.ctx.currentTime;
    this.input.gain.setTargetAtTime(on ? 1 : 0, t, 0.01);
    this.bedGain.gain.setTargetAtTime(on ? this.follower.crackle() * 0.02 : 0, t, 0.02);
    if (!this.playSample?.('intercomClick', 0.9)) this.oneShot(this.clickBuf, 0.9, t);
    if (on && !this.playSample?.('intercomStatic', 0.7)) this.oneShot(this.staticBuf, 0.7, t + 0.02);
  }

  /** Per frame: follow the input level and drive the overload. `dt` in seconds. */
  update(dt: number): void {
    if (this.disposed || !this.liveNow) return;
    let rms = 0;
    if (this.analyser && this.samples) {
      this.analyser.getFloatTimeDomainData(this.samples);
      let s = 0;
      for (const v of this.samples) s += v * v;
      rms = Math.sqrt(s / this.samples.length);
    }
    this.follower.step(rms, dt);
    const t = this.ctx.currentTime;
    this.drive.gain.setTargetAtTime(this.follower.drive() / 2, t, 0.01);
    this.bedGain.gain.setTargetAtTime(this.follower.crackle() * 0.02, t, 0.02);
    this.sinceOcclusion += dt;
    if (this.sinceOcclusion >= INTERCOM_FX.occlusionCheck) this.checkOcclusion(false);
  }

  /** What stands between the listener and the speaker now: 'none', 'glass', 'sealed' or 'wall' (a wall or a closed door). */
  get occlusion(): Occlusion {
    return this.occlusionNow;
  }

  /**
   * Hear the speaker through `o` (in-world-audio "A live intercom relays a room"): it follows within a fraction of a
   * second as Jay walks or a door opens; `instant` jumps there (going live).
   */
  setOcclusion(o: Occlusion, instant = false): void {
    if (this.disposed || (o === this.occlusionNow && !instant)) return;
    this.occlusionNow = o;
    const { cutoff, gain } = intercomOcclusion(o);
    const t = this.ctx.currentTime;
    if (instant) {
      this.occlusionLp.frequency.setValueAtTime(cutoff, t);
      this.occlusionGain.gain.setValueAtTime(gain, t);
      return;
    }
    this.occlusionLp.frequency.setTargetAtTime(cutoff, t, INTERCOM_FX.occlusionSmooth);
    this.occlusionGain.gain.setTargetAtTime(gain, t, INTERCOM_FX.occlusionSmooth);
  }

  private checkOcclusion(instant: boolean): void {
    this.sinceOcclusion = 0;
    if (this.occlusionOf) this.setOcclusion(this.occlusionOf(this.position), instant);
  }

  /** The follower's current overload amount 0..1 (for tests and debugging). */
  get overload(): number {
    return this.follower.value;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.bedSrc.stop();
    } catch {
      /* already stopped */
    }
    this.input.disconnect();
    this.panner.disconnect();
  }

  private oneShot(buf: AudioBuffer, gain: number, at: number): void {
    const src = new AudioBufferSourceNode(this.ctx, { buffer: buf });
    const g = new GainNode(this.ctx, { gain });
    // Clicks and static come from the grille itself, after the shaper (they are the speaker, not the room), and are heard
    // through whatever stands between it and the listener, as the speaker is.
    src.connect(g).connect(this.occlusionLp);
    src.onended = () => g.disconnect();
    src.start(at);
  }

  private toBuffer(data: Float32Array<ArrayBuffer>): AudioBuffer {
    const b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    b.copyToChannel(data, 0);
    return b;
  }
}
