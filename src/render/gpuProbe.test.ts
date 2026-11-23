import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gpuKey, probeGpuLimits, readLimits, resetGpuProbe, cachedGpuLimits, type ProbeGl } from './gpuProbe.ts';

beforeEach(() => resetGpuProbe());

function fakeGl(over: { tex?: number; frag?: number; aniso?: number | null } = {}): ProbeGl & { lost: number; loseContext: () => void } {
  const state = { lost: 0 };
  return {
    get lost() {
      return state.lost;
    },
    loseContext: () => void state.lost++,
    getParameter: (p: number) => (p === 0x8872 ? (over.tex ?? 16) : p === 0x8dfd ? (over.frag ?? 1024) : p === 0x84ff ? (over.aniso ?? 16) : 0),
    getExtension: (n: string) => (n === 'EXT_texture_filter_anisotropic' && over.aniso !== null ? { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff } : null),
  };
}

test('reads texture units, fragment uniforms and anisotropy and builds a stable key', () => {
  const limits = readLimits(fakeGl())!;
  assert.deepEqual(limits, { maxTextures: 16, maxFragmentUniforms: 1024, maxAnisotropy: 16 });
  assert.equal(gpuKey(limits), '16/1024/16');
});

test('no anisotropy extension reads as 0, like the renderer', () => {
  assert.equal(readLimits(fakeGl({ aniso: null }))!.maxAnisotropy, 0);
});

test('the probe context is released right after reading, and the result is cached', () => {
  const gl = fakeGl();
  let made = 0;
  const first = probeGpuLimits(() => (made++, gl));
  const second = probeGpuLimits(() => (made++, fakeGl()));
  assert.equal(gl.lost, 1);
  assert.equal(made, 1);
  assert.equal(second, first);
  assert.equal(cachedGpuLimits(), first);
});

test('a missing, throwing or nonsense context gives null and never throws', () => {
  assert.equal(probeGpuLimits(() => null), null);
  resetGpuProbe();
  assert.equal(
    probeGpuLimits(() => {
      throw new Error('no webgl');
    }),
    null,
  );
  resetGpuProbe();
  assert.equal(probeGpuLimits(() => fakeGl({ tex: 0 })), null);
});

test('the context is released even when reading fails', () => {
  const gl = fakeGl();
  gl.getParameter = () => {
    throw new Error('lost');
  };
  assert.equal(probeGpuLimits(() => gl), null);
  assert.equal(gl.lost, 1);
});
