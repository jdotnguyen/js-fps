/**
 * `?memprobe` (memory runs, openspec spec runtime-memory): counts live WebGL objects and
 * the bytes uploaded into them, and exposes `window.__memprobe` for scripted sessions. Installed before the
 * renderer creates its context, so the counts are absolute. Debug only: nothing here runs without the flag.
 */

/** GL enums used below (WebGL2 values; Node tests have no WebGL2RenderingContext). */
const GL = {
  TEXTURE_2D: 0x0de1,
  TEXTURE_CUBE_MAP: 0x8513,
  TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515,
  TEXTURE_CUBE_MAP_NEGATIVE_Z: 0x851a,
  TEXTURE_3D: 0x806f,
  TEXTURE_2D_ARRAY: 0x8c1a,
  TEXTURE0: 0x84c0,
} as const;

/** Bytes per texel for the sized internal formats three.js uses; unknown formats count as 4. */
const BYTES_PER_TEXEL: Readonly<Record<number, number>> = {
  0x8229: 1, // R8
  0x822b: 2, // RG8
  0x8051: 4, // RGB8 (stored padded)
  0x8058: 4, // RGBA8
  0x8c43: 4, // SRGB8_ALPHA8
  0x822d: 2, // R16F
  0x822f: 4, // RG16F
  0x881a: 8, // RGBA16F
  0x881b: 8, // RGB16F (stored padded)
  0x822e: 4, // R32F
  0x8230: 8, // RG32F
  0x8814: 16, // RGBA32F
  0x8815: 16, // RGB32F (stored padded)
  0x81a5: 2, // DEPTH_COMPONENT16
  0x81a6: 4, // DEPTH_COMPONENT24
  0x8cac: 4, // DEPTH_COMPONENT32F
  0x88f0: 4, // DEPTH24_STENCIL8
  0x8cad: 8, // DEPTH32F_STENCIL8
  0x1908: 4, // RGBA (unsized)
  0x1907: 4, // RGB (unsized)
  0x1903: 1, // RED (unsized)
  0x1909: 1, // LUMINANCE
};

export const bytesPerTexel = (internalFormat: number): number => BYTES_PER_TEXEL[internalFormat] ?? 4;

export interface GlCounts {
  textures: number;
  buffers: number;
  renderbuffers: number;
  framebuffers: number;
  programs: number;
  textureBytes: number;
  bufferBytes: number;
  renderbufferBytes: number;
}

type Kind = 'textures' | 'buffers' | 'renderbuffers' | 'framebuffers' | 'programs';
type BytesKind = 'textureBytes' | 'bufferBytes' | 'renderbufferBytes';

/**
 * Pure bookkeeping for the GL calls the probe intercepts. Objects are whatever the context returns; sizes are
 * attributed to the object bound at upload time. Texture levels are tracked separately so re-uploading a
 * level (texImage2D every frame on a canvas texture) does not double count.
 */
export class GlLedger {
  readonly counts: GlCounts = { textures: 0, buffers: 0, renderbuffers: 0, framebuffers: 0, programs: 0, textureBytes: 0, bufferBytes: 0, renderbufferBytes: 0 };
  private readonly sizes = new Map<object, number>();
  private readonly levels = new Map<object, Map<string, number>>();
  private readonly boundTex = new Map<string, object | null>();
  private readonly boundBuf = new Map<number, object | null>();
  private boundRb: object | null = null;
  private unit = 0;

  created(kind: Kind, obj: object | null): void {
    if (obj) this.counts[kind]++;
  }

  deleted(kind: Kind, obj: object | null | undefined): void {
    if (!obj) return;
    this.counts[kind] = Math.max(0, this.counts[kind] - 1);
    const bytes = this.sizes.get(obj) ?? 0;
    if (bytes > 0) {
      const key = BYTES_FOR[kind];
      if (key) this.counts[key] = Math.max(0, this.counts[key] - bytes);
    }
    this.sizes.delete(obj);
    this.levels.delete(obj);
  }

  activeTexture(unitEnum: number): void {
    this.unit = unitEnum - GL.TEXTURE0;
  }

  bindTexture(target: number, tex: object | null): void {
    this.boundTex.set(`${this.unit}:${target}`, tex);
  }

  bindBuffer(target: number, buf: object | null): void {
    this.boundBuf.set(target, buf);
  }

  bindRenderbuffer(rb: object | null): void {
    this.boundRb = rb;
  }

  /** texStorage2D/3D: every level allocated at once (cube maps x6, arrays x depth). */
  texStorage(target: number, levels: number, internalFormat: number, width: number, height: number, depth = 1): void {
    const tex = this.texFor(target);
    if (!tex) return;
    const faces = target === GL.TEXTURE_CUBE_MAP ? 6 : 1;
    let bytes = 0;
    for (let l = 0; l < levels; l++) bytes += Math.max(1, width >> l) * Math.max(1, height >> l) * (target === GL.TEXTURE_3D ? Math.max(1, depth >> l) : depth);
    this.setLevel(tex, 'storage', bytes * faces * bytesPerTexel(internalFormat));
  }

  /** texImage2D/3D at one level (cube faces each count once). */
  texImage(target: number, level: number, internalFormat: number, width: number, height: number, depth = 1): void {
    const tex = this.texFor(target);
    if (!tex) return;
    this.setLevel(tex, `${target}:${level}`, width * height * depth * bytesPerTexel(internalFormat));
  }

  /** bufferData with a size or a data view. */
  bufferData(target: number, size: number): void {
    const buf = this.boundBuf.get(target);
    if (buf) this.setSize(buf, 'bufferBytes', size);
  }

  renderbufferStorage(internalFormat: number, width: number, height: number, samples = 1): void {
    if (this.boundRb) this.setSize(this.boundRb, 'renderbufferBytes', width * height * bytesPerTexel(internalFormat) * Math.max(1, samples));
  }

  snapshot(): GlCounts {
    return { ...this.counts };
  }

  private texFor(target: number): object | null {
    const bindTarget = target >= GL.TEXTURE_CUBE_MAP_POSITIVE_X && target <= GL.TEXTURE_CUBE_MAP_NEGATIVE_Z ? GL.TEXTURE_CUBE_MAP : target;
    return this.boundTex.get(`${this.unit}:${bindTarget}`) ?? null;
  }

  private setLevel(tex: object, level: string, bytes: number): void {
    let lv = this.levels.get(tex);
    if (!lv) this.levels.set(tex, (lv = new Map()));
    lv.set(level, bytes);
    let total = 0;
    for (const b of lv.values()) total += b;
    this.setSize(tex, 'textureBytes', total);
  }

  private setSize(obj: object, key: BytesKind, bytes: number): void {
    this.counts[key] += bytes - (this.sizes.get(obj) ?? 0);
    this.sizes.set(obj, bytes);
  }
}

const BYTES_FOR: Partial<Record<Kind, BytesKind>> = { textures: 'textureBytes', buffers: 'bufferBytes', renderbuffers: 'renderbufferBytes' };

// ------------------------------------------------------------------------------------------- browser glue

export interface MemSample {
  /** Seconds since the probe was installed. */
  t: number;
  tag: string;
  /** Chromium only (performance.memory); null elsewhere. MB. */
  heapMB: number | null;
  gl: GlCounts;
  /** three.js renderer.info.memory once attached. */
  three: { geometries: number; textures: number } | null;
  /** Decoded audio held by the engine and voice player, MB. */
  audioMB: number | null;
}

export interface MemProbeSources {
  threeInfo: () => { geometries: number; textures: number };
  audioBytes: () => number;
}

export interface MemProbe {
  readonly ledger: GlLedger;
  readonly log: MemSample[];
  attach(sources: MemProbeSources): void;
  sample(tag?: string): MemSample;
}

/** Wrap `getContext` so the first WebGL2 context gets counted. Call before the renderer is created. */
export function installMemProbe(): MemProbe {
  const ledger = new GlLedger();
  const log: MemSample[] = [];
  const t0 = performance.now();
  let sources: MemProbeSources | null = null;
  const wrapped = new WeakSet<object>();
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
    const ctx = original.apply(this, args) as RenderingContext | null;
    if (ctx && (args[0] as string) === 'webgl2' && !wrapped.has(ctx)) {
      wrapped.add(ctx);
      wrapGl(ctx as WebGL2RenderingContext, ledger);
    }
    return ctx;
  } as typeof original;

  const probe: MemProbe = {
    ledger,
    log,
    attach(s) {
      sources = s;
    },
    sample(tag = '') {
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      const s: MemSample = {
        t: Math.round((performance.now() - t0) / 1000),
        tag,
        heapMB: mem ? Math.round(mem.usedJSHeapSize / 1e6) : null,
        gl: ledger.snapshot(),
        three: sources ? { ...sources.threeInfo() } : null,
        audioMB: sources ? Math.round(sources.audioBytes() / 1e6) : null,
      };
      log.push(s);
      return s;
    },
  };
  (window as unknown as { __memprobe: MemProbe }).__memprobe = probe;
  console.info('[memprobe] counting WebGL objects; window.__memprobe.sample()');
  return probe;
}

function wrapGl(gl: WebGL2RenderingContext, L: GlLedger): void {
  const g = gl as unknown as Record<string, (...a: unknown[]) => unknown>;
  const hook = (name: string, after: (args: unknown[], result: unknown) => void): void => {
    const fn = g[name];
    if (typeof fn !== 'function') return;
    const bound = fn.bind(gl);
    g[name] = (...args: unknown[]) => {
      const r = bound(...args);
      after(args, r);
      return r;
    };
  };
  const n = (v: unknown): number => Number(v);
  const sizeOf = (v: unknown): number => (typeof v === 'number' ? v : ArrayBuffer.isView(v) ? v.byteLength : v instanceof ArrayBuffer ? v.byteLength : 0);
  for (const [kind, create, del] of [
    ['textures', 'createTexture', 'deleteTexture'],
    ['buffers', 'createBuffer', 'deleteBuffer'],
    ['renderbuffers', 'createRenderbuffer', 'deleteRenderbuffer'],
    ['framebuffers', 'createFramebuffer', 'deleteFramebuffer'],
    ['programs', 'createProgram', 'deleteProgram'],
  ] as const) {
    hook(create, (_a, r) => L.created(kind, r as object | null));
    hook(del, (a) => L.deleted(kind, a[0] as object | null));
  }
  hook('activeTexture', (a) => L.activeTexture(n(a[0])));
  hook('bindTexture', (a) => L.bindTexture(n(a[0]), a[1] as object | null));
  hook('bindBuffer', (a) => L.bindBuffer(n(a[0]), a[1] as object | null));
  hook('bindRenderbuffer', (a) => L.bindRenderbuffer(a[1] as object | null));
  hook('texStorage2D', (a) => L.texStorage(n(a[0]), n(a[1]), n(a[2]), n(a[3]), n(a[4])));
  hook('texStorage3D', (a) => L.texStorage(n(a[0]), n(a[1]), n(a[2]), n(a[3]), n(a[4]), n(a[5])));
  hook('texImage2D', (a) => {
    // (target, level, internalformat, width, height, ...) or (target, level, internalformat, format, type, source)
    const source = a[5] as { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | undefined;
    if (a.length >= 8) L.texImage(n(a[0]), n(a[1]), n(a[2]), n(a[3]), n(a[4]));
    else if (source && typeof source === 'object') L.texImage(n(a[0]), n(a[1]), n(a[2]), source.videoWidth ?? source.width ?? 0, source.videoHeight ?? source.height ?? 0);
  });
  hook('texImage3D', (a) => L.texImage(n(a[0]), n(a[1]), n(a[2]), n(a[3]), n(a[4]), n(a[5])));
  hook('bufferData', (a) => L.bufferData(n(a[0]), sizeOf(a[1])));
  hook('renderbufferStorage', (a) => L.renderbufferStorage(n(a[1]), n(a[2]), n(a[3])));
  hook('renderbufferStorageMultisample', (a) => L.renderbufferStorage(n(a[2]), n(a[3]), n(a[4]), n(a[1])));
}

