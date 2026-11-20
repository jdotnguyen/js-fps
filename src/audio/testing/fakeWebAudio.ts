/**
 * Minimal Web Audio stand-in for Node tests of AudioEngine wiring. It records the node graph
 * (who connects to whom) and AudioParam values; it renders no sound. Automation calls jump
 * straight to their target value so tests can read the settled level.
 */

export class FakeParam {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
  setTargetAtTime(v: number): this {
    this.value = v;
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
  const names = ['AudioContext', 'GainNode', 'BiquadFilterNode', 'DynamicsCompressorNode', 'ConvolverNode'] as const;
  const prev = names.map((n) => g[n]);
  g.AudioContext = FakeAudioContext;
  g.GainNode = FakeGain;
  g.BiquadFilterNode = FakeBiquad;
  g.DynamicsCompressorNode = FakeCompressor;
  g.ConvolverNode = FakeConvolver;
  return () => names.forEach((n, i) => (g[n] = prev[i]));
}
