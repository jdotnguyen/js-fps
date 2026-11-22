import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RENDER_TIERS, anisotropyFor, clampTier, materialTextureUnits } from './tiers.ts';
import { tierPixelRatio, applyQuality } from './renderer.ts';
import { applyPostTier } from './post.ts';
import type { Effect } from 'postprocessing';

// render-quality spec (openspec fidelity-first-rendering): one table owns every tier's budget.

test('each tier holds the render-quality spec values', () => {
  const row = (q: keyof typeof RENDER_TIERS) => {
    const t = RENDER_TIERS[q];
    return [t.fillLights, t.shadowLights, t.shadowMapSize, t.pixelRatioCap, t.smaa, t.anisotropy, t.characterShadowDistance];
  };
  assert.deepEqual(row('low'), [12, 0, 512, 1, false, 8, 15]);
  assert.deepEqual(row('medium'), [16, 2, 1024, 1.25, true, 8, 15]);
  assert.deepEqual(row('high'), [32, 6, 2048, Infinity, true, 'max', 40]);
  assert.deepEqual([RENDER_TIERS.low.gtao, RENDER_TIERS.medium.gtao, RENDER_TIERS.high.gtao], [false, false, true], 'GTAO stays High only');
  assert.deepEqual([RENDER_TIERS.low.bloom, RENDER_TIERS.medium.bloom, RENDER_TIERS.high.bloom], [false, true, true], 'bloom stays Medium and High');
});

test('High renders at the display pixel ratio uncapped; Low and Medium keep their caps', () => {
  assert.equal(tierPixelRatio('high', 2), 2, 'High on a DPR 2 display renders at 2');
  assert.equal(tierPixelRatio('high', 3), 3);
  assert.equal(tierPixelRatio('medium', 2), 1.25);
  assert.equal(tierPixelRatio('low', 2), 1);
  let set = 0;
  applyQuality({ setPixelRatio: (r: number) => void (set = r) }, 'high', 2);
  assert.equal(set, 2, 'applyQuality uses the device pixel ratio uncapped on High');
});

test('anisotropy is the GPU maximum on High and at most 8 elsewhere', () => {
  assert.equal(anisotropyFor(RENDER_TIERS.high, 16), 16);
  assert.equal(anisotropyFor(RENDER_TIERS.medium, 16), 8);
  assert.equal(anisotropyFor(RENDER_TIERS.low, 4), 4, 'never above what the GPU offers');
});

test('a roomy GPU keeps the tier as written, with no warnings', () => {
  const { tier, warnings } = clampTier(RENDER_TIERS.high, { maxTextures: 16, maxFragmentUniforms: 1024, materialUnits: 7 });
  assert.equal(tier.shadowLights, 6);
  assert.equal(tier.fillLights, 32);
  assert.deepEqual(warnings, []);
});

test('low GPU limits cut the shadow and fill pools and warn about each', () => {
  const { tier, warnings } = clampTier(RENDER_TIERS.high, { maxTextures: 8, maxFragmentUniforms: 224, materialUnits: 5 });
  assert.equal(tier.shadowLights, 2, '8 units - 5 for materials - 1 for the flashlight');
  // 224 - 128 reserved - (2 + 1) spots x 7 = 75 vectors -> 25 point lights.
  assert.equal(tier.fillLights, 25);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0]!, /shadow lights 6 -> 2/);
  assert.match(warnings[1]!, /fill lights 32 -> 25/);
  assert.equal(RENDER_TIERS.high.shadowLights, 6, 'the table itself is untouched');
});

test('material units count the maps a material binds, plus the scene environment', () => {
  const tex = {};
  assert.equal(materialTextureUnits({ map: tex, normalMap: tex, roughnessMap: tex, metalnessMap: tex, envMapIntensity: 1 }, true), 5);
  assert.equal(materialTextureUnits({ map: tex, envMapIntensity: 1 }, false), 1);
  assert.equal(materialTextureUnits({ map: tex }, true), 1, 'an unlit material samples no environment');
});

test('post passes follow the tier: AO on High, bloom and SMAA on Medium and High, off on Low', () => {
  const bloom = { name: 'bloom' } as unknown as Effect;
  const grade = { name: 'grade' } as unknown as Effect;
  const toneMapping = { name: 'toneMapping' } as unknown as Effect;
  const builds: string[][] = [];
  const t = {
    ao: { enabled: true },
    smaa: { enabled: true, renderToScreen: true },
    main: {
      renderToScreen: false,
      bloomOn: true as boolean | null,
      setEffectList(effects: Effect[]) {
        builds.push(effects.map((e) => e.name));
      },
    },
    effects: { bloom, grade, toneMapping },
  };
  const state = () => [t.ao.enabled, t.main.bloomOn, t.smaa.enabled, t.main.renderToScreen];

  applyPostTier(t, 'low');
  assert.deepEqual(state(), [false, false, false, true], 'Low: no AO, bloom or SMAA, and the merged pass draws to the screen');
  assert.deepEqual(builds, [['grade', 'toneMapping']], 'Low builds the merged pass without bloom');
  applyPostTier(t, 'medium');
  assert.deepEqual(state(), [false, true, true, false]);
  assert.deepEqual(builds.at(-1), ['bloom', 'grade', 'toneMapping'], 'bloom comes back first, so the grade covers the glow');
  applyPostTier(t, 'high');
  assert.deepEqual(state(), [true, true, true, false]);
  assert.equal(builds.length, 2, 'Medium to High keeps bloom, so the pass is not rebuilt (no recompile)');
});
