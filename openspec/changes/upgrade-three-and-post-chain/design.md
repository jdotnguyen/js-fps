# Design

## Context

- **Renderer:** `WebGLRenderer` on three 0.170, ACES Filmic tone mapping at exposure 0.95, sRGB output, `PCFSoftShadowMap`. Since Phase 1, `main.ts` turns off `shadowMap.autoUpdate` and asks for one shadow pass per frame.
- **Post chain today** (`src/render/post.ts`, three's example `EffectComposer`):
  1. `RenderPass`
  2. `GTAOPass`, High only. Its own depth and normal pass hides transparent meshes, meshes that do not write depth, and meshes with `userData.skipGtao`. Seven files set that flag: `fx/abyss`, `fx/exterior`, `fx/exteriorLight`, `fx/oceanLife`, `fx/seabed`, `kit/slice`, and `post.ts` itself.
  3. `UnrealBloomPass`, Medium and High
  4. the grade `ShaderPass`
  5. `OutputPass` (tone mapping and sRGB)
  6. `SMAAPass`, Medium and High

  The grade runs on linear HDR, before tone mapping.
- **Who uses it:**
  - `main.ts`: `createPost`, `setSize`, `setQuality`, `render`, and `grade.uGrain` / `uDamage`. The debug GUI binds `post.gtao.enabled` and `blendIntensity`, and `post.bloom` `strength`, `threshold` and `radius`.
  - `sandbox/actorsSandbox.ts`: `createPost`.
- **Checked against the r187 package** (unpacked 2026-11-21):
  - `WebGLShadowMap` warns and swaps `PCFSoftShadowMap` for `PCFShadowMap`. r187's PCF path uses hardware-compared samples on a 5-tap Vogel disk rotated by interleaved gradient noise, with `shadow.radius` setting the width.
  - The per-light `shadow.autoUpdate` / `needsUpdate` logic is unchanged.
  - `SMAAPass()` takes no arguments.
  - Every `#include` chunk our hooks replace exists, and so does the literal line `float lightDistance = length( lVector );` in `lights_pars_begin`.
- **Packages:**
  - `postprocessing` 6.39.6 peers on `three >= 0.168.0 < 0.188.0`.
  - `n8ao` 2.1.0 peers on `three >= 0.137` and `postprocessing >= 6.30.0`.

## Goals / Non-Goals

**Goals:**
- Current three on WebGL, reached in steps small enough that each break is found where it was introduced.
- The same look and tier behaviour as today, with AO from `n8ao` and fewer full-screen passes.
- The `Post` interface stays, so game code does not change.

**Non-Goals:**
- WebGPU, TSL or clustered lighting.
- New effects: SSR, SSGI, depth of field, motion blur.
- Changing the grade's look, or the tier table (`RENDER_TIERS`).
- postprocessing v7.

## Decisions

### 1. Upgrade in four steps: 0.175, 0.180, 0.183, 0.187
Each step bumps `three` and `@types/three` together. It ends with `npm run typecheck`, the affected tests, a full `npm test`, and High screenshots of R02, R03 and R04 compared with the previous step.
- The steps fall on the releases the earlier research flagged: GTAO output changes from r181, shadow bias from r183, and the `PCFSoftShadowMap` removal before r187.
- The post chain stays on three's `EffectComposer` throughout, so a visual change can be blamed on the upgrade, not the new chain.
- Rejected: one jump from 0.170 to 0.187. A dark room or a broken shader would then have 17 releases of suspects.

### 2. `PCFShadowMap` with a tuned radius
- `renderer.shadowMap.type = PCFShadowMap` at the step where the soft type is gone or deprecated.
- The flashlight and each `SHADOW_CONES` kind get a `shadow.radius`, starting at 2, tuned by screenshot against the r170 soft edge. Bias and normal bias are retuned there too.
- Rejected:
  - `VSMShadowMap`: light bleeding, and its own blur passes.
  - Keeping the removed constant: it logs a warning on every frame's shadow pass.

### 3. Pinned packages
`postprocessing` is pinned at `6.39.6` and `n8ao` at `2.1.0`, exact versions, no caret. postprocessing's v7 replaces its `EffectComposer`, and its peer range stops before r188, so `three` is pinned at `0.187.0` too while postprocessing is in use.

### 4. The new chain
In order:
1. A `RenderPass` of everything ambient occlusion may darken.
2. `N8AOPostPass`, enabled on High.
3. A second `RenderPass` with `clear: false` for the meshes that skip AO: transparent, not writing depth, or `userData.skipGtao`.
4. An `EffectPass` with bloom, the grade and tone mapping.
5. An `EffectPass` with SMAA, enabled on Medium and High.

The split render (steps 1 and 3) keeps excluded meshes out of the depth that `n8ao` reads, the same rule `GTAOPass`'s override applies today. Glass and shafts are drawn after AO, so AO never darkens them either. Steps 1 and 3 toggle `visible` with today's predicate, so neither the 7 flagging files nor the `skipGtao` key change. Rejected: relying on `n8ao`'s own transparency handling, which only covers transparent materials and would miss depth-writing meshes flagged `skipGtao`.

### 5. Effect order and merging
- postprocessing renders into a linear HDR buffer, and three applies `renderer.toneMapping` only when drawing to the screen. So tone mapping moves into a `ToneMappingEffect` (ACES Filmic), after the grade, keeping today's "grade in linear, then tone map" order. `renderer.toneMapping` becomes `NoToneMapping` while the chain is on. Exposure 0.95 has to carry over; a task checks it against an r187 `EffectComposer` screenshot.
- The grade is a custom `Effect` that samples its input at offsets for the aberration. That makes it a convolution effect, and postprocessing allows one per `EffectPass`. SMAA is also a convolution effect, so it gets its own pass (decision 4, step 5).
- Trade-off: inside the merged pass, the aberration samples the scene before bloom is added, so the glow itself is no longer split into colours. The difference is a fraction of a pixel at the screen edges. Rejected: a third pass just to keep that.

### 6. Tier toggles and the `Post` interface
- `applyPostTier` keeps its signature and toggles `n8ao` (AO), the bloom effect and the SMAA pass.
- Bloom lives inside the merged `EffectPass`, so a tier switch rebuilds that pass's effect list: with bloom on Medium and High, without it on Low. That is one recompile, at the menu, like the light-pool resize. Rejected: keeping bloom in the pass at intensity 0 on Low, which still runs its blur passes every frame.
- `Post` keeps `setSize`, `setQuality`, `render` and `grade`. The `grade` uniforms are the same objects, now owned by the `Effect`.
- `gtao` and `bloom` become `ao` (the `N8AOPostPass`) and `bloom` (the `BloomEffect`), and the debug GUI in `main.ts` binds `ao.configuration.intensity` and `aoRadius` and the bloom's `intensity`, `luminanceMaterial.threshold` and `mipmapBlurPass.radius`.

### 7. Starting parameters
Each is tuned by screenshot in R02, R03 and R04 against the last r187 `EffectComposer` capture:
- **n8ao:** `aoRadius` about 1.5 m, `distanceFalloff` 1, `intensity` 2, quality `Medium`, full resolution.
- **Bloom:** `mipmapBlur` on, `luminanceThreshold` 0.85, `intensity` matched to `UnrealBloomPass` strength 0.55.

## Risks / Trade-offs

- [An upgrade step changes a shader our hooks patch, and a material silently compiles without the patch] → Every hook already checks chunk names in r187. Each step also screenshots the body, viewmodel and exterior lights, the hooks' consumers, and watches the console for shader warnings.
- [The look drifts across 17 releases (colour, shadow softness, AO strength)] → Screenshots at every step, compared with the previous step and not only with r170. Exposure and bias get retuned where they drift.
- [`n8ao` at full resolution costs more than GTAO on High] → Measure against the floor in the commons and the R03 drop. If needed, use half resolution with depth-aware upsampling first, then a lower quality mode.
- [The split render costs an extra scene traversal and a second `RenderPass`] → The traversal replaces GTAO's own per-frame one. The second pass draws only the excluded meshes.
- [Memory: `n8ao` and postprocessing allocate their own targets] → Compare `?slot=scratch&memprobe` before and after, at High on the target PC.
- [postprocessing pins three below r188] → Accepted. Moving past r187 waits for a postprocessing release, or for v7 as its own change.

## Migration Plan

- Each upgrade step and the post-chain swap is its own commit, so any step can be reverted alone.
- The old `EffectComposer` chain stays in git history only, not in the code behind a flag: two chains would double the post-code surface and both would need maintaining.

## Open Questions

- Final tuned values (shadow radius per light kind, `n8ao` and bloom parameters) are found by screenshot during implementation and recorded here before archiving.
