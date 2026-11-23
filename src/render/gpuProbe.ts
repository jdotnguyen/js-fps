/**
 * Reads the three GPU limits the light budget and texture filtering depend on, without a renderer
 * (openspec `preload-during-title`, design D10). It creates one short-lived WebGL context, reads the numbers,
 * and releases the context at once; it holds no scene and no GPU resources. The result is cached for the page.
 */
export interface GpuProbeLimits {
  /** `MAX_TEXTURE_IMAGE_UNITS`: what three reports as `capabilities.maxTextures`. */
  readonly maxTextures: number;
  /** `MAX_FRAGMENT_UNIFORM_VECTORS`: `capabilities.maxFragmentUniforms`. */
  readonly maxFragmentUniforms: number;
  /** `MAX_TEXTURE_MAX_ANISOTROPY_EXT`, or 0 without the extension (`capabilities.getMaxAnisotropy()`). */
  readonly maxAnisotropy: number;
}

/** The slice of a WebGL context the probe uses; a fake in tests. */
export interface ProbeGl {
  getParameter(pname: number): unknown;
  getExtension(name: string): unknown;
}

const MAX_TEXTURE_IMAGE_UNITS = 0x8872;
const MAX_FRAGMENT_UNIFORM_VECTORS = 0x8dfd;

/** A stable string for a probe result, used in the preload key. The renderer's capabilities give the same string. */
export function gpuKey(limits: GpuProbeLimits): string {
  return `${limits.maxTextures}/${limits.maxFragmentUniforms}/${limits.maxAnisotropy}`;
}

/** Read the limits from a context. Returns null if the context is missing or a number is not usable. */
export function readLimits(gl: ProbeGl | null): GpuProbeLimits | null {
  if (!gl) return null;
  const maxTextures = Number(gl.getParameter(MAX_TEXTURE_IMAGE_UNITS));
  const maxFragmentUniforms = Number(gl.getParameter(MAX_FRAGMENT_UNIFORM_VECTORS));
  if (!(maxTextures > 0) || !(maxFragmentUniforms > 0)) return null;
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic') as { MAX_TEXTURE_MAX_ANISOTROPY_EXT: number } | null;
  const maxAnisotropy = aniso ? Number(gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) || 0 : 0;
  return { maxTextures, maxFragmentUniforms, maxAnisotropy };
}

let cached: GpuProbeLimits | null | undefined;

/** The cached limits, or undefined before the first probe. */
export function cachedGpuLimits(): GpuProbeLimits | null | undefined {
  return cached;
}

/**
 * Probe once per page. `makeGl` defaults to a detached canvas; a context that cannot be created (no WebGL, a lost
 * context, a blocked canvas) gives null, and the caller prepares nothing that depends on the limits.
 */
export function probeGpuLimits(makeGl: () => (ProbeGl & { loseContext?: () => void }) | null = defaultMakeGl): GpuProbeLimits | null {
  if (cached !== undefined) return cached;
  let gl: (ProbeGl & { loseContext?: () => void }) | null = null;
  try {
    gl = makeGl();
    cached = readLimits(gl);
  } catch {
    cached = null;
  } finally {
    try {
      gl?.loseContext?.();
    } catch {
      /* already lost */
    }
  }
  return cached;
}

/** For tests. */
export function resetGpuProbe(): void {
  cached = undefined;
}

function defaultMakeGl(): (ProbeGl & { loseContext?: () => void }) | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') as (WebGL2RenderingContext & ProbeGl) | null;
  if (!gl) return null;
  const lose = gl.getExtension('WEBGL_lose_context');
  return Object.assign(gl, { loseContext: () => lose?.loseContext() });
}
