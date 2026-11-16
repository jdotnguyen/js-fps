import * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import { impulseResponse } from './dsp.ts';
import { SOUND_SPECS, type SoundName } from './sounds.ts';

/**
 * Web Audio engine (ADR-0013): buses -> master -> limiter, a shared convolution
 * reverb send, HRTF-positioned voices, and procedurally rendered buffers.
 */
export type BusName = 'ambience' | 'sfx' | 'ui';

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

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly buses: Record<BusName, GainNode>;
  private readonly reverbIn: GainNode;
  private readonly buffers = new Map<SoundName, AudioBuffer[]>();
  private readonly rng = new Rng('audio-engine');
  private readonly forward = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const limiter = new DynamicsCompressorNode(this.ctx, { threshold: -8, knee: 6, ratio: 12, attack: 0.003, release: 0.25 });
    limiter.connect(this.ctx.destination);
    this.master = new GainNode(this.ctx, { gain: 0.8 });
    this.master.connect(limiter);
    const bus = (gain: number): GainNode => {
      const node = new GainNode(this.ctx, { gain });
      node.connect(this.master);
      return node;
    };
    this.buses = { ambience: bus(1), sfx: bus(1), ui: bus(0.8) };

    const sr = this.ctx.sampleRate;
    const [left, right] = impulseResponse(sr, 1.6, new Rng('reverb'));
    const ir = this.ctx.createBuffer(2, left.length, sr);
    ir.copyToChannel(left, 0);
    ir.copyToChannel(right, 1);
    const convolver = new ConvolverNode(this.ctx, { buffer: ir });
    this.reverbIn = new GainNode(this.ctx, { gain: 1 });
    const reverbOut = new GainNode(this.ctx, { gain: 0.55 });
    this.reverbIn.connect(convolver).connect(reverbOut).connect(this.master);
  }

  /** Browsers start audio suspended until a user gesture; call from a click handler. */
  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  /** Render every sound in SOUND_SPECS at the context's sample rate. Returns ms taken. */
  renderSounds(): number {
    const t0 = performance.now();
    const sr = this.ctx.sampleRate;
    for (const [name, spec] of Object.entries(SOUND_SPECS) as Array<[SoundName, (typeof SOUND_SPECS)[SoundName]]>) {
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
