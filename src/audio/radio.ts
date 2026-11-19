import type * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import type { AudioEngine } from './engine.ts';

/**
 * In-world radio (ADR-0017 / ADR-0023 "TAG FM"): a music file played through a small,
 * old speaker. The chain matches public/assets/audio/music/tag-fm/README.md so the game
 * sounds like tag-fm-01-radio-preview.wav:
 *   wow/flutter delay -> (+ hiss, crackle) -> HP 300 -> LP 3500 x2 -> peak 1.2 kHz
 *   -> tanh saturation -> LP 4500 -> level -> HRTF panner at the radio -> ambience bus.
 * It is diegetic, so it goes on the ambience bus, not the music bus.
 */

/** Tracks by id, as sequences name them (`{ "do": "radio", "track": "tag_fm_01" }`). */
export const RADIO_TRACKS: Record<string, string> = {
  tag_fm_01: 'assets/audio/music/tag-fm/tag-fm-01.mp3',
};

export const RADIO_FX = {
  wowHz: 0.5,
  wowDepth: 0.00045,
  flutterHz: 6,
  flutterDepth: 0.000012,
  baseDelay: 0.004,
  hissLevel: 0.005, // ~ -46 dBFS RMS
  hissDriftHz: 0.125,
  hissDrift: 0.25,
  cracklesPerSecond: 4,
  popsPerSecond: 0.3,
  highpass: 300,
  lowpass: 3500,
  peakHz: 1200,
  peakDb: 2.5,
  drive: 2.2,
  /** Level into the shaper so peaks sit near 0.7 (the dry mix peaks at -1.2 dBFS). */
  preGain: 0.8,
  postLowpass: 4500,
  /** -1.5 dB after band-limiting, as in the preview. */
  outGain: 0.84,
};

/** `tanh(drive * x) / tanh(drive)` sampled over -1..1, for a WaveShaperNode. */
export function saturationCurve(drive = RADIO_FX.drive, n = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

/**
 * A loopable bed of crackle: sparse clicks (log-normal sizes, ~ -30 dBFS) plus rare bigger
 * pops (~ -24 dBFS), each a few-sample decaying burst so they read as dust, not digital ticks.
 */
export function crackleBuffer(sampleRate: number, seconds: number, rng: Rng, opts = RADIO_FX): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.floor(sampleRate * seconds));
  const place = (count: number, level: number): void => {
    for (let k = 0; k < count; k++) {
      const at = Math.floor(rng.next() * out.length);
      // Log-normal amplitude around `level`.
      const g = level * Math.exp((rng.next() + rng.next() + rng.next() - 1.5) * 0.9);
      const len = 6 + Math.floor(rng.next() * 18);
      const sign = rng.next() < 0.5 ? -1 : 1;
      for (let i = 0; i < len; i++) {
        const j = (at + i) % out.length; // wraps, so the bed loops cleanly
        const env = Math.exp(-i / (len * 0.25));
        out[j] = (out[j] ?? 0) + sign * g * env * (i % 2 === 0 ? 1 : -0.6);
      }
    }
  };
  place(Math.round(opts.cracklesPerSecond * seconds), 0.03);
  place(Math.round(opts.popsPerSecond * seconds), 0.06);
  return out;
}

/** White noise, for the hiss bed. */
export function noiseBuffer(sampleRate: number, seconds: number, rng: Rng): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.floor(sampleRate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = rng.next() * 2 - 1;
  return out;
}

interface Playing {
  track: string;
  stop: () => void;
}

export class RadioPlayer {
  private readonly audio: AudioEngine;
  private readonly decoded = new Map<string, Promise<AudioBuffer | null>>();
  private playing: Playing | null = null;
  private readonly rng = new Rng('radio');

  constructor(audio: AudioEngine) {
    this.audio = audio;
  }

  get track(): string | null {
    return this.playing?.track ?? null;
  }

  /** Start a track at a world position (replacing whatever was playing). null stops. */
  play(track: string | null, at: THREE.Vector3 | null, opts: { gain?: number } = {}): void {
    this.stop();
    if (!track) return;
    const url = RADIO_TRACKS[track];
    if (!url) {
      console.warn(`[radio] no track "${track}"`);
      return;
    }
    const token = { track, stop: () => undefined } as Playing;
    this.playing = token;
    void this.load(url).then((buffer) => {
      if (!buffer || this.playing !== token) return;
      token.stop = this.start(buffer, at, opts.gain ?? 1);
    });
  }

  stop(): void {
    this.playing?.stop();
    this.playing = null;
  }

  private load(url: string): Promise<AudioBuffer | null> {
    let p = this.decoded.get(url);
    if (!p) {
      p = fetch(import.meta.env.BASE_URL + url)
        .then((r) => {
          if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
          return r.arrayBuffer();
        })
        .then((b) => this.audio.ctx.decodeAudioData(b))
        .catch((err: unknown) => {
          console.warn(`[radio] could not load ${url}`, err);
          return null;
        });
      this.decoded.set(url, p);
    }
    return p;
  }

  private start(buffer: AudioBuffer, at: THREE.Vector3 | null, gain: number): () => void {
    const ctx = this.audio.ctx;
    const fx = RADIO_FX;
    const sr = ctx.sampleRate;
    const sources: AudioScheduledSourceNode[] = [];
    const nodes: AudioNode[] = [];
    const keep = <T extends AudioNode>(n: T): T => {
      nodes.push(n);
      return n;
    };

    // Music through a wobbling delay (wow + flutter).
    const music = new AudioBufferSourceNode(ctx, { buffer, loop: true });
    const delay = keep(new DelayNode(ctx, { delayTime: fx.baseDelay, maxDelayTime: 0.02 }));
    for (const [hz, depth] of [[fx.wowHz, fx.wowDepth], [fx.flutterHz, fx.flutterDepth]] as const) {
      const lfo = new OscillatorNode(ctx, { frequency: hz });
      lfo.connect(keep(new GainNode(ctx, { gain: depth }))).connect(delay.delayTime);
      sources.push(lfo);
    }
    const pre = keep(new GainNode(ctx, { gain: fx.preGain }));
    music.connect(delay).connect(pre);
    sources.push(music);

    // Hiss: band-limited noise with a slow level drift.
    const hissBuf = ctx.createBuffer(1, sr * 4, sr);
    hissBuf.copyToChannel(noiseBuffer(sr, 4, this.rng), 0);
    const hiss = new AudioBufferSourceNode(ctx, { buffer: hissBuf, loop: true });
    const hissGain = keep(new GainNode(ctx, { gain: fx.hissLevel }));
    const drift = new OscillatorNode(ctx, { frequency: fx.hissDriftHz });
    drift.connect(keep(new GainNode(ctx, { gain: fx.hissLevel * fx.hissDrift }))).connect(hissGain.gain);
    hiss.connect(keep(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1450, Q: 0.35 }))).connect(hissGain).connect(pre);
    sources.push(hiss, drift);

    // Crackle bed (9 s loop, so the pattern doesn't line up with the 64 s track).
    const crackBuf = ctx.createBuffer(1, Math.floor(sr * 9), sr);
    crackBuf.copyToChannel(crackleBuffer(sr, 9, this.rng), 0);
    const crackle = new AudioBufferSourceNode(ctx, { buffer: crackBuf, loop: true });
    crackle.connect(keep(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 900 }))).connect(pre);
    sources.push(crackle);

    // Speaker: HP 300, 4th-order LP 3500, small-cabinet bump, saturation, post LP.
    let node: AudioNode = pre;
    const chain: AudioNode[] = [
      new BiquadFilterNode(ctx, { type: 'highpass', frequency: fx.highpass, Q: 0.707 }),
      new BiquadFilterNode(ctx, { type: 'lowpass', frequency: fx.lowpass, Q: 0.541 }),
      new BiquadFilterNode(ctx, { type: 'lowpass', frequency: fx.lowpass, Q: 1.307 }),
      new BiquadFilterNode(ctx, { type: 'peaking', frequency: fx.peakHz, Q: 1, gain: fx.peakDb }),
      new WaveShaperNode(ctx, { curve: saturationCurve(), oversample: '2x' }),
      new BiquadFilterNode(ctx, { type: 'lowpass', frequency: fx.postLowpass, Q: 0.707 }),
      new GainNode(ctx, { gain: fx.outGain * gain }),
    ];
    for (const n of chain) node = node.connect(keep(n));
    if (at) {
      node = node.connect(
        keep(
          new PannerNode(ctx, {
            panningModel: 'HRTF',
            distanceModel: 'inverse',
            refDistance: 1.5,
            maxDistance: 40,
            rolloffFactor: 1.4,
            positionX: at.x,
            positionY: at.y,
            positionZ: at.z,
          }),
        ),
      );
    }
    node.connect(this.audio.buses.ambience);

    // Start the music at a random point so every visit doesn't begin on bar 1.
    const t = ctx.currentTime + 0.05;
    for (const s of sources) {
      if (s === music) music.start(t, this.rng.next() * buffer.duration);
      else s.start(t);
    }
    return () => {
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      for (const n of nodes) n.disconnect();
    };
  }
}
