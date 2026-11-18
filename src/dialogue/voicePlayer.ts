/**
 * Web Audio side of dialogue (ADR-0010): renders emotes to AudioBuffers (cached by
 * line id) and plays them through one of two channels:
 *   local: HRTF PannerNode at the speaker's head (or centred if no position).
 *   radio: band-pass 300-3400 Hz -> waveshaper -> compressor, squelch clicks, static bed.
 * Output goes to its own `voice` gain node feeding the engine's master.
 */
import { Rng } from '../core/rng.ts';
import { Biquad, fadeEdges, makeBuf, normalize, white, type Buf } from '../audio/dsp.ts';
import type { Emote } from '../data/types/dialogue.ts';
import type { PlayRequest, VoicePlayback, VoicePlayer } from './speech.ts';
import { renderUtterance } from './vocalSynth.ts';

/** The part of AudioEngine (ADR-0013) dialogue needs. */
export interface AudioOut {
  readonly ctx: AudioContext;
  readonly master: AudioNode;
}

/** Short radio squelch: a click and a burst of filtered noise. */
export function renderSquelch(sr: number, rng: Rng): Buf {
  const out = makeBuf(sr, 0.09);
  const noise = white(rng);
  const bp = new Biquad('bandpass', 2200, 1.2, sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const click = t < 0.002 ? 1 - t / 0.002 : 0;
    out[i] = click * 0.8 + bp.process(noise()) * Math.exp(-t / 0.025) * 1.5;
  }
  fadeEdges(out, sr, 0.0005, 0.01);
  return normalize(out, 0.5);
}

/** Two seconds of looping comms static. */
export function renderStatic(sr: number, rng: Rng): Buf {
  const out = makeBuf(sr, 2);
  const noise = white(rng);
  const crackle = rng.fork('crackle');
  const bp = new Biquad('bandpass', 1800, 0.6, sr);
  for (let i = 0; i < out.length; i++) {
    const pop = crackle.next() < 0.0008 ? crackle.range(-1, 1) * 4 : 0;
    out[i] = bp.process(noise() + pop);
  }
  // Crossfade the ends so the loop is seamless.
  const f = Math.round(sr * 0.05);
  for (let i = 0; i < f; i++) {
    const k = i / f;
    out[i] = out[i]! * k + out[out.length - f + i]! * (1 - k);
  }
  return normalize(out.subarray(0, out.length - f).slice(), 0.5);
}

function radioCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = 3;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

export interface WebAudioVoiceOptions {
  /** Voice level relative to master. */
  gain?: number;
}

export class WebAudioVoicePlayer implements VoicePlayer {
  readonly output: GainNode;
  private readonly ctx: AudioContext;
  private readonly radioIn: GainNode;
  private readonly radioBed: GainNode;
  private readonly cache = new Map<string, AudioBuffer>();
  private readonly squelch: AudioBuffer;
  private readonly staticBuf: AudioBuffer;

  constructor(out: AudioOut, opts: WebAudioVoiceOptions = {}) {
    this.ctx = out.ctx;
    const ctx = this.ctx;
    this.output = new GainNode(ctx, { gain: opts.gain ?? 1 });
    this.output.connect(out.master);

    // Radio chain, shared by every radio line.
    this.radioIn = new GainNode(ctx, { gain: 1 });
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 300, Q: 0.7 });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3400, Q: 0.7 });
    const mid = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1600, Q: 1, gain: 4 });
    const shaper = new WaveShaperNode(ctx, { curve: radioCurve(), oversample: '2x' });
    const comp = new DynamicsCompressorNode(ctx, { threshold: -22, knee: 4, ratio: 6, attack: 0.003, release: 0.12 });
    const makeup = new GainNode(ctx, { gain: 1.3 });
    this.radioIn.connect(hp).connect(lp).connect(mid).connect(shaper).connect(comp).connect(makeup).connect(this.output);
    this.radioBed = new GainNode(ctx, { gain: 1 });
    this.radioBed.connect(hp);

    this.squelch = this.toBuffer(renderSquelch(ctx.sampleRate, new Rng('squelch')));
    this.staticBuf = this.toBuffer(renderStatic(ctx.sampleRate, new Rng('static')));
  }

  /** Pre-render buffers for lines (call during loading, spread over idle time). */
  prewarm(reqs: Iterable<Omit<PlayRequest, 'at'>>): void {
    for (const r of reqs) this.buffer(r);
  }

  play(req: PlayRequest): VoicePlayback {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.01;
    const buffer = this.buffer(req);
    const src = new AudioBufferSourceNode(ctx, { buffer });
    const lineGain = new GainNode(ctx, { gain: 1 });
    src.connect(lineGain);
    const nodes: AudioNode[] = [src, lineGain];
    let panner: PannerNode | null = null;
    let staticSrc: AudioBufferSourceNode | null = null;
    let bed: GainNode | null = null;

    if (req.line.channel === 'radio') {
      lineGain.connect(this.radioIn);
      this.blip(t0);
      staticSrc = new AudioBufferSourceNode(ctx, { buffer: this.staticBuf, loop: true });
      bed = new GainNode(ctx, { gain: 0 });
      bed.gain.setTargetAtTime(0.05, t0, 0.02);
      staticSrc.connect(bed).connect(this.radioBed);
      staticSrc.start(t0);
      const bedNode = bed;
      staticSrc.onended = () => bedNode.disconnect();
      // Voice starts just after the squelch.
      src.start(t0 + 0.07);
    } else {
      if (req.at) {
        const p = req.at();
        panner = new PannerNode(ctx, {
          panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.5, maxDistance: 40, rolloffFactor: 1,
          positionX: p.x, positionY: p.y, positionZ: p.z,
        });
        lineGain.connect(panner).connect(this.output);
        nodes.push(panner);
      } else {
        lineGain.connect(this.output);
      }
      src.start(t0);
    }

    src.onended = () => {
      for (const n of nodes) n.disconnect();
    };

    let stopped = false;
    return {
      update: () => {
        if (!panner || !req.at) return;
        const p = req.at();
        const t = ctx.currentTime;
        panner.positionX.setTargetAtTime(p.x, t, 0.02);
        panner.positionY.setTargetAtTime(p.y, t, 0.02);
        panner.positionZ.setTargetAtTime(p.z, t, 0.02);
      },
      stop: (interrupted) => {
        if (stopped) return;
        stopped = true;
        const t = ctx.currentTime;
        if (interrupted) lineGain.gain.setTargetAtTime(0, t, 0.015);
        const cleanupAt = t + (interrupted ? 0.1 : 0.15);
        if (staticSrc) {
          this.blip(t);
          bed?.gain.setTargetAtTime(0, t, 0.02);
          staticSrc.stop(t + 0.08);
        }
        try {
          src.stop(cleanupAt);
        } catch {
          /* already ended */
        }
      },
    };
  }

  /** Clear cached renders (e.g. after a speaker's rasp changes a lot). */
  clear(): void {
    this.cache.clear();
  }

  private blip(at: number): void {
    const s = new AudioBufferSourceNode(this.ctx, { buffer: this.squelch });
    const g = new GainNode(this.ctx, { gain: 0.6 });
    s.connect(g).connect(this.radioIn);
    s.onended = () => g.disconnect();
    s.start(at);
  }

  private buffer(req: Omit<PlayRequest, 'at'>): AudioBuffer {
    const rasp = req.rasp === null ? null : Math.round(req.rasp * 20) / 20;
    const key = `${req.line.id}|${rasp ?? '-'}|${req.babble ? 'b' : ''}`;
    let buf = this.cache.get(key);
    if (!buf) {
      // Real VO files arrive with execution step 6; until then audio-only lines fall back to `neutral`.
      const emote: Emote = req.line.emote ?? 'neutral';
      const data = renderUtterance(this.ctx.sampleRate, req.profile, emote, req.line.id, {
        ...(rasp === null ? {} : { rasp }),
        ...(req.babble ? { babbleText: req.line.text } : {}),
      });
      buf = this.toBuffer(data);
      this.cache.set(key, buf);
    }
    return buf;
  }

  private toBuffer(data: Buf): AudioBuffer {
    const b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    b.copyToChannel(data, 0);
    return b;
  }
}
