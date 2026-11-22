/**
 * Web Audio side of dialogue (spec voice-playback): plays recorded VO files when loaded (falling back
 * to procedural emotes) through one of three channels:
 *   local: HRTF PannerNode at the speaker's head (or centred if no position) + room reverb send.
 *   radio: band-pass 300-3400 Hz -> waveshaper -> compressor, squelch clicks, static bed.
 *   pa: a filtered wall speaker with a fixed grille position and a light room reflection.
 * Output goes to its own gain node, which the game connects to the engine's `voice` bus
 * (spec: openspec/specs/voice-playback, openspec/specs/audio-mix).
 */
import { Rng } from '../core/rng.ts';
import { Biquad, fadeEdges, makeBuf, normalize, white, type Buf } from '../audio/dsp.ts';
import { audioUrls, type DialogueLine, type Emote } from '../data/types/dialogue.ts';
import type { PlayRequest, VoicePlayback, VoicePlayer } from './speech.ts';
import { renderUtterance } from './vocalSynth.ts';

/** Low-pass cutoff for a voice with nothing in the way: effectively open. */
const OPEN_CUTOFF_HZ = 20000;
/** Time constant for propagation changes (gain and tone); settles in about 80 ms. */
const HEAR_RAMP_S = 0.027;

/** The part of AudioEngine dialogue needs. */
export interface AudioOut {
  readonly ctx: AudioContext;
  /** Where dialogue goes: the engine's `voice` bus in the game (or master in debug pages). */
  readonly master: AudioNode;
  /** Optional shared room reverb bus so local voices sit inside the current room. */
  readonly reverbIn?: AudioNode;
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

function radioCurve(drive = 3): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = Math.max(0.5, drive);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

export interface WebAudioVoiceOptions {
  /** Voice level relative to master. */
  gain?: number;
  /** Room reverb send level for local voices (0..1). */
  reverbSend?: number;
  /** Base URL prefix for recorded VO paths. Defaults to Vite BASE_URL or '/'. */
  baseUrl?: string;
}

export class WebAudioVoicePlayer implements VoicePlayer {
  readonly output: GainNode;
  private readonly ctx: AudioContext;
  private readonly reverbIn: AudioNode | null;
  private readonly reverbSend: number;
  private readonly baseUrl: string;
  private readonly radioIn: GainNode;
  private readonly radioBed: GainNode;
  private readonly cache = new Map<string, AudioBuffer>();
  private readonly recorded = new Map<string, AudioBuffer>();
  private readonly pending = new Map<string, Promise<AudioBuffer | null>>();
  private readonly lastVariant = new Map<string, string>();
  private readonly squelch: AudioBuffer;
  private readonly staticBuf: AudioBuffer;

  constructor(out: AudioOut, opts: WebAudioVoiceOptions = {}) {
    this.ctx = out.ctx;
    this.reverbIn = out.reverbIn ?? null;
    this.reverbSend = opts.reverbSend ?? 0.16;
    const viteBase = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL;
    this.baseUrl = opts.baseUrl ?? viteBase ?? '/';
    const ctx = this.ctx;
    this.output = new GainNode(ctx, { gain: opts.gain ?? 1 });
    this.output.connect(out.master);

    // Radio chain, shared by every radio line.
    this.radioIn = new GainNode(ctx, { gain: 1 });
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 300, Q: 0.7 });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3400, Q: 0.7 });
    const mid = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1600, Q: 1, gain: 4 });
    const shaper = new WaveShaperNode(ctx, { curve: radioCurve(3), oversample: '2x' });
    const comp = new DynamicsCompressorNode(ctx, { threshold: -22, knee: 4, ratio: 6, attack: 0.003, release: 0.12 });
    const makeup = new GainNode(ctx, { gain: 1.3 });
    this.radioIn.connect(hp).connect(lp).connect(mid).connect(shaper).connect(comp).connect(makeup).connect(this.output);
    this.radioBed = new GainNode(ctx, { gain: 1 });
    this.radioBed.connect(hp);

    this.squelch = this.toBuffer(renderSquelch(ctx.sampleRate, new Rng('squelch')));
    this.staticBuf = this.toBuffer(renderStatic(ctx.sampleRate, new Rng('static')));
  }

  /** Pre-render procedural buffers for lines (call during loading, spread over idle time). */
  prewarm(reqs: Iterable<Omit<PlayRequest, 'at'>>): void {
    for (const r of reqs) {
      if (!r.line.audio) this.buffer(r);
    }
  }

  /** Fetch and decode every recorded VO file referenced by `lines`. */
  async loadLines(lines: Iterable<DialogueLine>, concurrency = 8): Promise<number> {
    const urls = [...new Set([...lines].flatMap((l) => audioUrls(l.audio)))];
    let loaded = 0;
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < urls.length) {
        const url = urls[next++]!;
        const buf = await this.loadAudio(url);
        if (buf) loaded++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, urls.length)) }, () => worker()));
    return loaded;
  }

  /** True if at least one recorded VO clip for this line is decoded and ready. */
  hasRecorded(line: DialogueLine): boolean {
    return audioUrls(line.audio).some((u) => this.recorded.has(u));
  }

  private pickRecorded(line: DialogueLine): AudioBuffer | undefined {
    const urls = audioUrls(line.audio);
    if (urls.length === 0) return undefined;
    const ready: Array<[string, AudioBuffer]> = [];
    for (const u of urls) {
      const buf = this.recorded.get(u);
      if (buf) ready.push([u, buf]);
      else void this.loadAudio(u);
    }
    if (ready.length === 0) return undefined;
    if (ready.length === 1) return ready[0]![1];
    const prev = this.lastVariant.get(line.id);
    const pool = ready.filter(([u]) => u !== prev);
    const [url, buf] = (pool.length > 0 ? pool : ready)[Math.floor(Math.random() * (pool.length > 0 ? pool.length : ready.length))]!;
    this.lastVariant.set(line.id, url);
    return buf;
  }

  private loadAudio(url: string): Promise<AudioBuffer | null> {
    const cached = this.recorded.get(url);
    if (cached) return Promise.resolve(cached);
    const inflight = this.pending.get(url);
    if (inflight) return inflight;
    const job = (async (): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(this.baseUrl + url);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.recorded.set(url, buf);
        return buf;
      } catch (err) {
        console.warn(`[voice] could not load VO "${url}"`, err);
        return null;
      } finally {
        this.pending.delete(url);
      }
    })();
    this.pending.set(url, job);
    return job;
  }

  play(req: PlayRequest): VoicePlayback {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.01;
    const recordedBuf = this.pickRecorded(req.line);
    const buffer = recordedBuf ?? this.buffer(req);
    const isPa = req.line.channel === 'pa';
    const position = req.line.channel === 'radio' ? null : req.at?.();
    if (isPa && !position) {
      if (import.meta.env?.DEV) console.warn(`[voice] missing PA fixture for ${req.line.id}`);
      return { ...(recordedBuf ? { duration: recordedBuf.duration } : {}), stop() {} };
    }
    const src = new AudioBufferSourceNode(ctx, { buffer });
    const lineGain = new GainNode(ctx, { gain: isPa ? 0.58 : 1 });
    const nodes: AudioNode[] = [src, lineGain];

    // Subtle vocal grit when runtime rasp is raised on a recorded clip (Giles foreshadowing).
    let head: AudioNode = src;
    if (recordedBuf && req.rasp !== null && req.rasp > 0.05) {
      const grit = new WaveShaperNode(ctx, { curve: radioCurve(1 + req.rasp * 3.5), oversample: '2x' });
      const eq = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 2400, Q: 1.4, gain: req.rasp * 3.5 });
      head.connect(grit).connect(eq);
      nodes.push(grit, eq);
      head = eq;
    }
    head.connect(lineGain);

    let panner: PannerNode | null = null;
    let hearGain: GainNode | null = null;
    let hearLp: BiquadFilterNode | null = null;
    let staticSrc: AudioBufferSourceNode | null = null;
    let bed: GainNode | null = null;
    let chime: AudioBufferSourceNode | null = null;
    let leadIn = 0;

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
      let localOut: AudioNode = lineGain;
      if (isPa) {
        const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 340, Q: 0.7 });
        const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3900, Q: 0.7 });
        const mid = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1450, gain: 2.2, Q: 0.9 });
        localOut = lineGain.connect(hp).connect(lp).connect(mid);
        nodes.push(hp, lp, mid);
        // The PA emote is itself the chime. Prefix it only when there is a voice take.
        if (req.line.paChime && recordedBuf) {
          chime = new AudioBufferSourceNode(ctx, { buffer: this.buffer(req) });
          chime.connect(lineGain);
          chime.start(t0);
          nodes.push(chime);
          leadIn = 0.82;
        }
      }
      if (position) {
        // A local voice keeps falling off with distance (no 40 m floor); propagation fades it to silence (setAudibility).
        panner = new PannerNode(ctx, {
          panningModel: 'HRTF', distanceModel: 'inverse', refDistance: isPa ? 3 : 1.5, maxDistance: isPa ? 40 : 10000, rolloffFactor: 1,
          positionX: position.x, positionY: position.y, positionZ: position.z,
        });
        localOut.connect(panner);
        nodes.push(panner);
        localOut = panner;
        if (!isPa) {
          // Walls, doorways and the way round (voice-playback: Voices carry through the station), ramped per frame.
          hearLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: OPEN_CUTOFF_HZ, Q: 0.7 });
          hearGain = new GainNode(ctx, { gain: 1 });
          localOut = localOut.connect(hearLp).connect(hearGain);
          nodes.push(hearLp, hearGain);
        }
      }
      localOut.connect(this.output);
      if (this.reverbIn && this.reverbSend > 0) {
        const send = new GainNode(ctx, { gain: this.reverbSend * (isPa ? 0.7 : 1) });
        localOut.connect(send).connect(this.reverbIn);
        nodes.push(send);
      }
      src.start(t0 + leadIn);
    }

    src.onended = () => {
      for (const n of nodes) n.disconnect();
    };

    let stopped = false;
    return {
      // Real VO clips extend the subtitle/queue timer so speech is never cut off mid-word.
      ...(recordedBuf ? { duration: recordedBuf.duration + leadIn + (req.line.channel === 'radio' ? 0.16 : 0.08) } : {}),
      update: () => {
        if (isPa || !panner || !req.at) return;
        const p = req.at();
        if (!p) return;
        const t = ctx.currentTime;
        panner.positionX.setTargetAtTime(p.x, t, 0.02);
        panner.positionY.setTargetAtTime(p.y, t, 0.02);
        panner.positionZ.setTargetAtTime(p.z, t, 0.02);
      },
      setAudibility: (gain, cutoffHz) => {
        if (!hearGain || !hearLp || stopped) return;
        const t = ctx.currentTime;
        // ~80 ms to settle, so crossing a doorway or a door swinging shut never clicks.
        hearGain.gain.setTargetAtTime(Math.max(0, Math.min(1, gain)), t, HEAR_RAMP_S);
        hearLp.frequency.setTargetAtTime(Math.min(OPEN_CUTOFF_HZ, Number.isFinite(cutoffHz) ? cutoffHz : OPEN_CUTOFF_HZ), t, HEAR_RAMP_S);
      },
      stop: (interrupted) => {
        if (stopped) return;
        stopped = true;
        const t = ctx.currentTime;
        if (interrupted) lineGain.gain.setTargetAtTime(0, t, 0.015);
        const cleanupAt = t + (interrupted ? 0.1 : 0.15);
        chime?.stop(cleanupAt);
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

  /** Bytes of decoded audio held: recorded VO, cached procedural renders, squelch and static. */
  decodedBytes(): number {
    let bytes = 0;
    const add = (b: AudioBuffer): void => {
      bytes += b.length * b.numberOfChannels * 4;
    };
    for (const b of this.recorded.values()) add(b);
    for (const b of this.cache.values()) add(b);
    add(this.squelch);
    add(this.staticBuf);
    return bytes;
  }

  /** Clear cached procedural renders (e.g. after a speaker's rasp changes a lot). */
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
