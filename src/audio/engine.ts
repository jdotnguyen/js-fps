import * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import { occludeVoice, type Occluder } from './occlusion.ts';
import { DEFAULT_REVERB, REVERB_CROSSFADE, REVERB_SPECS, renderReverbIr, resolveReverb, type ReverbPreset } from './reverb.ts';
import { SAMPLE_URLS, SOUND_SPECS, type SampleName, type SoundName } from './sounds.ts';

/**
 * Web Audio engine (spec: openspec/specs/audio-mix): five buses -> master -> muffle -> limiter,
 * a shared convolution reverb send, HRTF-positioned voices, and recorded or procedural buffers.
 *
 * Each bus is `input (base level) -> volume (player setting) -> duck -> master`. The input node
 * is what sounds connect to; its gain is the mix's base level (tunable in the debug GUI).
 */
export type BusName = 'ambience' | 'sfx' | 'ui' | 'music' | 'voice';

/** Base level of each bus at 100% volume: the mix as tuned before volume settings existed. */
export const BUS_BASE_LEVELS: Readonly<Record<BusName, number>> = { ambience: 1, sfx: 1, ui: 0.8, music: 0.3, voice: 1 };

/** Buses lowered while a story line plays (audio-mix: Story ducking). */
export const DUCKED_BUSES: readonly BusName[] = ['music', 'ambience'];

/** Time constant (s) of duck and volume changes. */
const LEVEL_TC = 0.05;
const DUCK_TC = 0.15;

export interface VoiceOptions {
  bus?: BusName;
  gain?: number;
  /** World position; omit for non-positional (inside-your-head) sounds. */
  position?: THREE.Vector3;
  /** Reverb send level, 0..1. */
  reverb?: number;
  /** Low-pass as if heard through a wall or water. */
  muffled?: boolean;
  /** Optional custom low-pass cutoff in Hz (overrides `muffled`'s 650 Hz when set). */
  cutoff?: number;
  /**
   * `false` opts a positional `sfx` one-shot out of wall occlusion (in-world-audio: World sound occlusion).
   * Use it for sounds that already handle occlusion or must play as authored.
   */
  occlude?: boolean;
  rate?: number;
  variant?: number;
  /** Play only a slice of the clip: start `offset` s in, for `duration` s (at rate 1), fading out at the end. */
  offset?: number;
  duration?: number;
}

export interface LoopHandle {
  setGain(value: number, timeConstant?: number): void;
  /** Stop immediately, or fade smoothly to zero over `fadeSeconds` before stopping. */
  stop(fadeSeconds?: number): void;
}

interface ReverbNode {
  conv: ConvolverNode;
  out: GainNode;
  /** Whether the reverb send currently feeds this convolver. */
  connected: boolean;
}

/**
 * Fixed context rate. Left unset, the browser uses the output device's rate, and some Windows headsets and
 * interfaces run at 96 or 192 kHz: every decoded sample, VO line and procedural buffer is then stored at that
 * rate, 2-4x the memory for no audible gain. 48 kHz is the native rate of most devices, so the browser
 * resamples only where the device differs.
 */
export const AUDIO_SAMPLE_RATE = 48000;

export function createAudioContext(): AudioContext {
  try {
    return new AudioContext({ latencyHint: 'interactive', sampleRate: AUDIO_SAMPLE_RATE });
  } catch (err) {
    // An engine that refuses a forced rate still gets audio at the device rate.
    console.warn(`[audio] ${AUDIO_SAMPLE_RATE} Hz context refused, using the device rate`, err);
    return new AudioContext({ latencyHint: 'interactive' });
  }
}

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  /** Low-pass on the whole mix, for the damage "muffle" (ADR-0004). */
  private readonly muffleFilter: BiquadFilterNode;
  readonly buses: Record<BusName, GainNode>;
  /** Player volume setting per bus (0..1), after the base level. */
  private readonly volumes: Record<BusName, GainNode>;
  /** Story-ducking gain per bus (1 unless ducked). */
  private readonly ducks: Record<BusName, GainNode>;
  /** Shared room convolution reverb input (spec audio-mix: Room reverb); also fed by local dialogue. */
  readonly reverbIn: GainNode;
  private readonly reverbs = new Map<ReverbPreset, ReverbNode>();
  private activeReverb: ReverbPreset;
  private readonly buffers = new Map<SoundName, AudioBuffer[]>();
  private readonly loadedSamples = new Set<SampleName>();
  private readonly sampleListeners = new Set<(name: SampleName) => void>();
  private readonly rng = new Rng('audio-engine');
  private readonly forward = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  /** Last listener position from `updateListener`, for occlusion checks. */
  private readonly listenerPos = new THREE.Vector3();
  private occluder: Occluder | null = null;

  constructor() {
    this.ctx = createAudioContext();
    const limiter = new DynamicsCompressorNode(this.ctx, { threshold: -8, knee: 6, ratio: 12, attack: 0.003, release: 0.25 });
    limiter.connect(this.ctx.destination);
    this.master = new GainNode(this.ctx, { gain: 0.8 });
    this.muffleFilter = new BiquadFilterNode(this.ctx, { type: 'lowpass', frequency: 20000, Q: 0.5 });
    this.master.connect(this.muffleFilter).connect(limiter);
    const names = Object.keys(BUS_BASE_LEVELS) as BusName[];
    const make = (gain: (n: BusName) => number) =>
      Object.fromEntries(names.map((n) => [n, new GainNode(this.ctx, { gain: gain(n) })])) as Record<BusName, GainNode>;
    this.buses = make((n) => BUS_BASE_LEVELS[n]);
    this.volumes = make(() => 1);
    this.ducks = make(() => 1);
    for (const n of names) this.buses[n].connect(this.volumes[n]).connect(this.ducks[n]).connect(this.master);

    this.reverbIn = new GainNode(this.ctx, { gain: 1 });
    this.activeReverb = DEFAULT_REVERB;
    const initial = this.reverbNode(DEFAULT_REVERB);
    initial.out.gain.value = REVERB_SPECS[DEFAULT_REVERB].level;
    this.connectReverb(initial);
  }

  /** Build (once) the convolver for a preset. Its output is silent until the preset is active. */
  private reverbNode(preset: ReverbPreset): ReverbNode {
    let node = this.reverbs.get(preset);
    if (!node) {
      const sr = this.ctx.sampleRate;
      const [left, right] = renderReverbIr(sr, preset, new Rng('reverb'));
      const ir = this.ctx.createBuffer(2, left.length, sr);
      ir.copyToChannel(left, 0);
      ir.copyToChannel(right, 1);
      const conv = new ConvolverNode(this.ctx, { buffer: ir });
      const out = new GainNode(this.ctx, { gain: 0 });
      conv.connect(out).connect(this.master);
      node = { conv, out, connected: false };
      this.reverbs.set(preset, node);
    }
    return node;
  }

  private connectReverb(node: ReverbNode): void {
    if (!node.connected) {
      this.reverbIn.connect(node.conv);
      node.connected = true;
    }
  }

  /** Reverb preset currently applied to the reverb send. */
  get roomReverb(): ReverbPreset {
    return this.activeReverb;
  }

  /**
   * Switch the shared reverb to a room's preset (level data `atmosphere.reverb`) with an
   * equal-power crossfade, so walking from a corridor into a hall changes the space smoothly.
   * Unknown names fall back to the default preset.
   */
  setRoomReverb(name: string | undefined, seconds = REVERB_CROSSFADE): void {
    const next = resolveReverb(name);
    if (next === this.activeReverb) return;
    const prevPreset = this.activeReverb;
    const prev = this.reverbNode(prevPreset);
    const incoming = this.reverbNode(next);
    this.activeReverb = next;
    this.connectReverb(incoming);

    const now = this.ctx.currentTime;
    const steps = 16;
    const fadeIn = new Float32Array(steps);
    const fadeOut = new Float32Array(steps);
    for (let i = 0; i < steps; i++) {
      const x = i / (steps - 1);
      fadeIn[i] = Math.sin(x * Math.PI * 0.5) * REVERB_SPECS[next].level;
      fadeOut[i] = Math.cos(x * Math.PI * 0.5) * REVERB_SPECS[prevPreset].level;
    }
    for (const [node, curve] of [[incoming, fadeIn], [prev, fadeOut]] as const) {
      node.out.gain.cancelScheduledValues(now);
      node.out.gain.setValueAtTime(node.out.gain.value, now);
      node.out.gain.setValueCurveAtTime(curve, now, Math.max(seconds, 0.01));
    }
    // Stop feeding the old convolver once it has faded out, unless it became active again.
    const outgoing = prev;
    setTimeout(() => {
      if (this.reverbs.get(this.activeReverb) === outgoing) return;
      this.reverbIn.disconnect(outgoing.conv);
      outgoing.connected = false;
    }, seconds * 1000 + 100);
  }

  /** Browsers start audio suspended until a user gesture; call from a click handler. */
  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  /** Render every sound in SOUND_SPECS at the context's sample rate. Returns ms taken. */
  renderSounds(): number {
    const t0 = performance.now();
    const sr = this.ctx.sampleRate;
    for (const [name, spec] of Object.entries(SOUND_SPECS) as Array<[keyof typeof SOUND_SPECS, (typeof SOUND_SPECS)[keyof typeof SOUND_SPECS]]>) {
      const list: AudioBuffer[] = [];
      for (let v = 0; v < spec.variants; v++) {
        const data = spec.make(sr, new Rng(`${name}:${v}`));
        const buffer = this.ctx.createBuffer(1, data.length, sr);
        buffer.copyToChannel(data, 0);
        list.push(buffer);
      }
      this.buffers.set(name, list);
    }
    return performance.now() - t0;
  }

  /** True when at least one buffer (procedural or recorded sample) is ready for `name`. */
  hasSound(name: SoundName): boolean {
    const list = this.buffers.get(name);
    return list !== undefined && list.length > 0;
  }

  /** Number of rendered or decoded variants currently available for `name`. */
  variantCount(name: SoundName): number {
    return this.buffers.get(name)?.length ?? 0;
  }

  /** True once the recorded sample for `name` has finished decoding. */
  hasSample(name: SampleName): boolean {
    return this.loadedSamples.has(name);
  }

  /** Bytes of decoded audio this engine holds: every sound's buffers plus the reverb impulse responses. */
  decodedBytes(): number {
    let bytes = 0;
    for (const list of this.buffers.values()) for (const b of list) bytes += b.length * b.numberOfChannels * 4;
    for (const r of this.reverbs.values()) if (r.conv.buffer) bytes += r.conv.buffer.length * r.conv.buffer.numberOfChannels * 4;
    return bytes;
  }

  /** Duration in seconds of the first loaded buffer for `name`, or 0 if unavailable. */
  durationOf(name: SoundName): number {
    return this.buffers.get(name)?.[0]?.duration ?? 0;
  }

  /** Subscribe to sample-decode completions (used to hot-upgrade loops started on procedural fallbacks). */
  onSampleLoaded(fn: (name: SampleName) => void): () => void {
    this.sampleListeners.add(fn);
    return () => {
      this.sampleListeners.delete(fn);
    };
  }

  /**
   * Fetch and decode the recorded samples (SAMPLE_URLS), replacing any procedural sound of the same
   * name. Failures are logged and leave the procedural fallback (or silence) in place.
   */
  async loadSamples(): Promise<void> {
    await Promise.all(
      (Object.entries(SAMPLE_URLS) as Array<[SampleName, string | readonly string[]]>).map(async ([name, urls]) => {
        const list = (await Promise.all((typeof urls === 'string' ? [urls] : urls).map((url) => this.fetchSample(name, url)))).filter(
          (b): b is AudioBuffer => b !== null,
        );
        if (list.length > 0) {
          this.buffers.set(name, list);
          this.loadedSamples.add(name);
          for (const fn of this.sampleListeners) fn(name);
        }
      }),
    );
  }

  private async fetchSample(name: SampleName, url: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(import.meta.env.BASE_URL + url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch (err) {
      console.warn(`[audio] could not load sample "${name}" from ${url}`, err);
      return null;
    }
  }

  /** Dull the whole mix for `seconds` (taking a hit), then open back up. */
  muffle(seconds = 0.4, cutoff = 650): void {
    const f = this.muffleFilter.frequency;
    const now = this.ctx.currentTime;
    f.cancelScheduledValues(now);
    f.setValueAtTime(f.value, now);
    f.exponentialRampToValueAtTime(cutoff, now + 0.03);
    f.setValueAtTime(cutoff, now + seconds);
    f.exponentialRampToValueAtTime(20000, now + seconds + 0.25);
  }

  setMasterVolume(v: number): void {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, LEVEL_TC);
  }

  /** Player volume for one bus, 0..1 (Settings: music, SFX, voice). */
  setBusVolume(bus: BusName, v: number): void {
    const clamped = Math.min(1, Math.max(0, v));
    this.volumes[bus].gain.setTargetAtTime(clamped, this.ctx.currentTime, LEVEL_TC);
  }

  /** Current player volume of a bus (its target level). */
  busVolume(bus: BusName): number {
    return this.volumes[bus].gain.value;
  }

  /** Lower the ducked buses (music, ambience) by `db` dB; 0 restores them. Smooth, ~0.15 s. */
  setDuck(db: number): void {
    const g = Math.pow(10, -Math.max(0, db) / 20);
    for (const n of DUCKED_BUSES) this.ducks[n].gain.setTargetAtTime(g, this.ctx.currentTime, DUCK_TC);
  }

  /** Current duck gain of a bus (1 = not ducked). */
  duckGain(bus: BusName): number {
    return this.ducks[bus].gain.value;
  }

  /**
   * Set the wall test applied to positional `sfx` one-shots (in-world-audio: World sound occlusion),
   * or `null` to muffle nothing (title screen, between levels, headless tests).
   */
  setOccluder(occluder: Occluder | null): void {
    this.occluder = occluder;
  }

  /** Follow the camera every frame. */
  updateListener(camera: THREE.Camera): void {
    const l = this.ctx.listener;
    const p = camera.position;
    this.listenerPos.copy(p);
    camera.getWorldDirection(this.forward);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const f = this.forward;
    const u = this.up;
    if (l.positionX) {
      l.positionX.value = p.x;
      l.positionY.value = p.y;
      l.positionZ.value = p.z;
      l.forwardX.value = f.x;
      l.forwardY.value = f.y;
      l.forwardZ.value = f.z;
      l.upX.value = u.x;
      l.upY.value = u.y;
      l.upZ.value = u.z;
    } else {
      // Firefox: AudioParams on the listener are not implemented.
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  play(name: SoundName, voiceOpts: VoiceOptions = {}): LoopHandle {
    // Decided once, at start (design D5): a sound already playing keeps its treatment.
    const opts = occludeVoice(voiceOpts, this.listenerPos, this.occluder);
    const { source, gain, output } = this.voice(name, opts, false);
    let stopped = false;
    let stopTimer: ReturnType<typeof setTimeout> | null = null;
    const finishStop = (): void => {
      if (stopped) return;
      stopped = true;
      if (stopTimer !== null) {
        clearTimeout(stopTimer);
        stopTimer = null;
      }
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      output.disconnect();
    };
    source.onended = () => finishStop();

    const length = source.buffer?.duration ?? 0;
    const now = this.ctx.currentTime;
    const offset = length > 0 ? Math.min(Math.max(0, opts.offset ?? 0), Math.max(0, length - 0.05)) : 0;
    if (opts.duration === undefined || length === 0) {
      if (offset > 0) source.start(now, offset);
      else source.start();
    } else {
      const span = Math.min(opts.duration, length - offset);
      const fade = Math.min(0.3, span * 0.3);
      const level = opts.gain ?? 1;
      // `duration` counts clip seconds, so a faster rate finishes sooner; fade over the last bit of what is heard.
      const heard = span / (opts.rate ?? 1);
      gain.gain.setValueAtTime(level, now + Math.max(0, heard - fade));
      gain.gain.linearRampToValueAtTime(0, now + heard);
      source.start(now, offset, span);
    }

    return {
      setGain: (value, timeConstant = 0.03) => {
        if (stopped) return;
        gain.gain.setTargetAtTime(value, this.ctx.currentTime, timeConstant);
      },
      stop: (fadeSeconds = 0) => {
        if (stopped) return;
        if (fadeSeconds <= 0) {
          finishStop();
          return;
        }
        const t = this.ctx.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(0, t + fadeSeconds);
        stopTimer = setTimeout(finishStop, Math.ceil(fadeSeconds * 1000) + 40);
      },
    };
  }

  /** Loop a pre-rendered stereo track on the music bus. Silent until `setGain` raises it. */
  loopStereo(left: Float32Array<ArrayBuffer>, right: Float32Array<ArrayBuffer>, sampleRate: number): LoopHandle {
    const buffer = this.ctx.createBuffer(2, left.length, sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    const source = new AudioBufferSourceNode(this.ctx, { buffer, loop: true });
    const gain = new GainNode(this.ctx, { gain: 0 });
    source.connect(gain).connect(this.buses.music);
    source.start();
    return {
      setGain: (value, timeConstant = 0.03) => gain.gain.setTargetAtTime(value, this.ctx.currentTime, timeConstant),
      stop: () => {
        source.stop();
        gain.disconnect();
      },
    };
  }

  loop(name: SoundName, opts: VoiceOptions = {}): LoopHandle {
    const { source, gain, output } = this.voice(name, opts, true);
    const buffer = source.buffer;
    source.start(0, buffer ? this.rng.next() * buffer.duration : 0);
    let stopped = false;
    let stopTimer: ReturnType<typeof setTimeout> | null = null;
    const finishStop = (): void => {
      if (stopped) return;
      stopped = true;
      if (stopTimer !== null) {
        clearTimeout(stopTimer);
        stopTimer = null;
      }
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      output.disconnect();
    };
    return {
      setGain: (value, timeConstant = 0.03) => {
        if (stopped) return;
        gain.gain.setTargetAtTime(value, this.ctx.currentTime, timeConstant);
      },
      stop: (fadeSeconds = 0) => {
        if (stopped) return;
        if (fadeSeconds <= 0) {
          finishStop();
          return;
        }
        const now = this.ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + fadeSeconds);
        stopTimer = setTimeout(finishStop, Math.ceil(fadeSeconds * 1000) + 40);
      },
    };
  }

  private voice(name: SoundName, opts: VoiceOptions, loop: boolean): { source: AudioBufferSourceNode; gain: GainNode; output: AudioNode } {
    const list = this.buffers.get(name);
    if (!list || list.length === 0) throw new Error(`Sound "${name}" was not rendered`);
    const buffer = list[(opts.variant ?? this.rng.int(0, list.length - 1)) % list.length]!;
    const source = new AudioBufferSourceNode(this.ctx, { buffer, loop, playbackRate: opts.rate ?? 1 });
    let node: AudioNode = source;
    if (opts.cutoff !== undefined || opts.muffled) {
      const lp = new BiquadFilterNode(this.ctx, { type: 'lowpass', frequency: opts.cutoff ?? 650, Q: 0.5 });
      node.connect(lp);
      node = lp;
    }
    const gain = new GainNode(this.ctx, { gain: opts.gain ?? 1 });
    node.connect(gain);
    node = gain;
    if (opts.position) {
      const panner = new PannerNode(this.ctx, {
        panningModel: 'HRTF',
        distanceModel: 'inverse',
        refDistance: 1.2,
        maxDistance: 50,
        rolloffFactor: 1.2,
        positionX: opts.position.x,
        positionY: opts.position.y,
        positionZ: opts.position.z,
      });
      node.connect(panner);
      node = panner;
    }
    node.connect(this.buses[opts.bus ?? 'sfx']);
    if (opts.reverb) {
      const send = new GainNode(this.ctx, { gain: opts.reverb });
      node.connect(send).connect(this.reverbIn);
    }
    return { source, gain, output: node };
  }
}
