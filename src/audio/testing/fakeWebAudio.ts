/**
 * Minimal Web Audio stand-in for Node tests of AudioEngine wiring. It records the node graph
 * (who connects to whom) and AudioParam values; it renders no sound. Automation calls jump
 * straight to their target value so tests can read the settled level.
 */

export class FakeParam {
  value: number;
  /** The time constant of the last `setTargetAtTime`. */
  timeConstant: number | null = null;
  constructor(value: number) {
    this.value = value;
  }
  setTargetAtTime(v: number, _at?: number, timeConstant?: number): this {
    this.value = v;
    this.timeConstant = timeConstant ?? null;
    return this;
  }
  setValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  setValueCurveAtTime(curve: ArrayLike<number>): this {
    this.value = curve[curve.length - 1] ?? this.value;
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

export class FakeNode {
  readonly outputs = new Set<FakeNode>();
  readonly context: FakeAudioContext;
  readonly kind: string;
  constructor(context: FakeAudioContext, kind: string) {
    this.context = context;
    this.kind = kind;
    context.nodes.push(this);
  }
  connect<T>(target: T): T {
    if (target instanceof FakeNode) this.outputs.add(target);
    return target;
  }
  disconnect(target?: FakeNode): void {
    if (target) this.outputs.delete(target);
    else this.outputs.clear();
  }
}

class FakeGain extends FakeNode {
  readonly gain: FakeParam;
  constructor(ctx: FakeAudioContext, opts: { gain?: number } = {}) {
    super(ctx, 'gain');
    this.gain = new FakeParam(opts.gain ?? 1);
  }
}

class FakeBiquad extends FakeNode {
  readonly frequency: FakeParam;
  readonly Q: FakeParam;
  readonly gain: FakeParam;
  constructor(ctx: FakeAudioContext, opts: { frequency?: number; Q?: number; gain?: number } = {}) {
    super(ctx, 'biquad');
    this.frequency = new FakeParam(opts.frequency ?? 350);
    this.Q = new FakeParam(opts.Q ?? 1);
    this.gain = new FakeParam(opts.gain ?? 0);
  }
}

class FakeCompressor extends FakeNode {
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'compressor');
  }
}

class FakeWaveShaper extends FakeNode {
  constructor(ctx: FakeAudioContext) { super(ctx, 'waveshaper'); }
}

export class FakeSource extends FakeNode {
  readonly buffer: unknown;
  readonly loop: boolean;
  /** `start` arguments, `[]` for a bare start; null until started. */
  started: number[] | null = null;
  /** Context time the source stops at; null while no stop was asked for. */
  stopAt: number | null = null;
  onended: (() => void) | null = null;
  private ended = false;
  private readonly listeners: Array<() => void> = [];
  constructor(ctx: FakeAudioContext, opts: { buffer?: unknown; loop?: boolean } = {}) {
    super(ctx, 'source');
    this.buffer = opts.buffer ?? null;
    this.loop = opts.loop ?? false;
  }
  start(...args: number[]): void {
    this.started = args;
  }
  /** As in browsers, a later call replaces the stop time. The `ended` event waits for `ctx.advance`. */
  stop(when?: number): void {
    this.stopAt = Math.max(when ?? 0, this.context.currentTime);
  }
  addEventListener(type: string, fn: () => void): void {
    if (type === 'ended') this.listeners.push(fn);
  }
  /** Fire `ended` once, if the stop time has come. */
  settle(): void {
    if (this.ended || this.stopAt === null || this.stopAt > this.context.currentTime) return;
    this.ended = true;
    this.onended?.();
    for (const fn of this.listeners) fn();
  }
}

export class FakePanner extends FakeNode {
  readonly positionX: FakeParam;
  readonly positionY: FakeParam;
  readonly positionZ: FakeParam;
  constructor(ctx: FakeAudioContext, opts: PannerOptions) {
    super(ctx, 'panner');
    this.positionX = new FakeParam(opts.positionX ?? 0);
    this.positionY = new FakeParam(opts.positionY ?? 0);
    this.positionZ = new FakeParam(opts.positionZ ?? 0);
  }
}

class FakeConvolver extends FakeNode {
  buffer: unknown;
  constructor(ctx: FakeAudioContext, opts: { buffer?: unknown } = {}) {
    super(ctx, 'convolver');
    this.buffer = opts.buffer ?? null;
  }
}

class FakeBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  copyToChannel(): void {}
  getChannelData(): Float32Array {
    return new Float32Array(this.length);
  }
}

export class FakeAudioContext {
  readonly nodes: FakeNode[] = [];
  readonly sampleRate = 8000;
  currentTime = 0;
  state = 'running';
  readonly destination: FakeNode;
  readonly listener = {};
  constructor() {
    this.destination = new FakeNode(this, 'destination');
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
  async suspend(): Promise<void> {
    this.state = 'suspended';
  }
  /** Let `seconds` of audio play: the clock stands still unless running. Sources due to stop fire `ended`. */
  advance(seconds: number): void {
    if (this.state !== 'running') return;
    this.currentTime += seconds;
    for (const n of this.nodes) if (n instanceof FakeSource) n.settle();
  }
}

/** True when `to` is reachable from `from` by following connections. */
export function reaches(from: FakeNode, to: FakeNode): boolean {
  const seen = new Set<FakeNode>();
  const stack = [from];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n === to) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const o of n.outputs) stack.push(o);
  }
  return false;
}

/** Product of gain values on the single path from `from` to `to` (gain nodes only). */
export function pathGain(from: FakeNode, to: FakeNode): number {
  let g = 1;
  let n: FakeNode | undefined = from;
  const seen = new Set<FakeNode>();
  while (n && n !== to) {
    if (seen.has(n)) throw new Error('cycle');
    seen.add(n);
    if (n instanceof FakeGain) g *= n.gain.value;
    n = [...n.outputs].find((o) => reaches(o, to));
  }
  if (n !== to) throw new Error('no path');
  return g;
}

/** Install the fakes as globals so `new AudioContext()` etc. work in Node. Returns an uninstall function. */
export function installFakeWebAudio(): () => void {
  const g = globalThis as Record<string, unknown>;
  const names = ['AudioContext', 'GainNode', 'BiquadFilterNode', 'DynamicsCompressorNode', 'ConvolverNode', 'WaveShaperNode', 'AudioBufferSourceNode', 'PannerNode'] as const;
  const prev = names.map((n) => g[n]);
  g.AudioContext = FakeAudioContext;
  g.GainNode = FakeGain;
  g.BiquadFilterNode = FakeBiquad;
  g.DynamicsCompressorNode = FakeCompressor;
  g.ConvolverNode = FakeConvolver;
  g.WaveShaperNode = FakeWaveShaper;
  g.AudioBufferSourceNode = FakeSource;
  g.PannerNode = FakePanner;
  return () => names.forEach((n, i) => (g[n] = prev[i]));
}
