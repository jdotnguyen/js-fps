import * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import { DEFAULT_REVERB, REVERB_CROSSFADE, REVERB_SPECS, renderReverbIr, resolveReverb, type ReverbPreset } from './reverb.ts';
import { SAMPLE_URLS, SOUND_SPECS, type SampleName, type SoundName } from './sounds.ts';

/**
 * Web Audio engine (ADR-0013): buses -> master -> limiter, a shared convolution
 * reverb send, HRTF-positioned voices, and procedurally rendered buffers.
 */
export type BusName = 'ambience' | 'sfx' | 'ui' | 'music';

export interface VoiceOptions {
  bus?: BusName;
  gain?: number;
  /** World position; omit for non-positional (inside-your-head) sounds. */
  position?: THREE.Vector3;
  /** Reverb send level, 0..1. */
  reverb?: number;
  /** Low-pass as if heard through a wall or water. */
  muffled?: boolean;
  rate?: number;
  variant?: number;
}

export interface LoopHandle {
  setGain(value: number, timeConstant?: number): void;
  stop(): void;
}

interface ReverbNode {
  conv: ConvolverNode;
  out: GainNode;
  /** Whether the reverb send currently feeds this convolver. */
  connected: boolean;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  /** Low-pass on the whole mix, for the damage "muffle" (ADR-0004). */
  private readonly muffleFilter: BiquadFilterNode;
  readonly buses: Record<BusName, GainNode>;
  private readonly reverbIn: GainNode;
  private readonly reverbs = new Map<ReverbPreset, ReverbNode>();
  private activeReverb: ReverbPreset;
  private readonly buffers = new Map<SoundName, AudioBuffer[]>();
  private readonly rng = new Rng('audio-engine');
  private readonly forward = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const limiter = new DynamicsCompressorNode(this.ctx, { threshold: -8, knee: 6, ratio: 12, attack: 0.003, release: 0.25 });
    limiter.connect(this.ctx.destination);
    this.master = new GainNode(this.ctx, { gain: 0.8 });
    this.muffleFilter = new BiquadFilterNode(this.ctx, { type: 'lowpass', frequency: 20000, Q: 0.5 });
    this.master.connect(this.muffleFilter).connect(limiter);
    const bus = (gain: number): GainNode => {
      const node = new GainNode(this.ctx, { gain });
      node.connect(this.master);
      return node;
    };
    this.buses = { ambience: bus(1), sfx: bus(1), ui: bus(0.8), music: bus(0.3) };

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

  /**
   * Fetch and decode the recorded samples (SAMPLE_URLS), replacing any procedural sound of the same
   * name. Failures are logged and leave the procedural fallback (or silence) in place.
   */
  async loadSamples(): Promise<void> {
    const base = import.meta.env.BASE_URL;
    await Promise.all(
      (Object.entries(SAMPLE_URLS) as Array<[SampleName, string]>).map(async ([name, url]) => {
        try {
          const res = await fetch(base + url);
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(name, [buffer]);
        } catch (err) {
          console.warn(`[audio] could not load sample "${name}" from ${url}`, err);
        }
      }),
    );
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
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Follow the camera every frame. */
  updateListener(camera: THREE.Camera): void {
    const l = this.ctx.listener;
    const p = camera.position;
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

  play(name: SoundName, opts: VoiceOptions = {}): void {
    const { source, output } = this.voice(name, opts, false);
    source.onended = () => output.disconnect();
    source.start();
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
    return {
      setGain: (value, timeConstant = 0.03) => gain.gain.setTargetAtTime(value, this.ctx.currentTime, timeConstant),
      stop: () => {
        source.stop();
        output.disconnect();
      },
    };
  }

  private voice(name: SoundName, opts: VoiceOptions, loop: boolean): { source: AudioBufferSourceNode; gain: GainNode; output: AudioNode } {
    const list = this.buffers.get(name);
    if (!list || list.length === 0) throw new Error(`Sound "${name}" was not rendered`);
    const buffer = list[(opts.variant ?? this.rng.int(0, list.length - 1)) % list.length]!;
    const source = new AudioBufferSourceNode(this.ctx, { buffer, loop, playbackRate: opts.rate ?? 1 });
    let node: AudioNode = source;
    if (opts.muffled) {
      const lp = new BiquadFilterNode(this.ctx, { type: 'lowpass', frequency: 650, Q: 0.5 });
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
