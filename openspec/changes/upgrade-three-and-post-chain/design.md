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
- The steps fall on the releases the earlier research flagged: GTAO output changes from r181, and the `PCFSoftShadowMap` deprecation with soft PCF in r183 (the earlier research dated this to r187; the r183 source already warns and falls back).
- The post chain stays on three's `EffectComposer` throughout, so a visual change can be blamed on the upgrade, not the new chain.
- Rejected: one jump from 0.170 to 0.187. A dark room or a broken shader would then have 17 releases of suspects.

### 2. `PCFShadowMap` with a tuned radius
- `renderer.shadowMap.type = PCFShadowMap` at r183 (task 2.3), the step that deprecates the soft type.
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

## Baseline

Captured 2026-11-22 on three 0.170.0 at `foundation` 577b5e1 (task 1.1). Quality High, on the developer desktop:
- Chrome window of 1849×971 CSS px at a device pixel ratio of 1.8, giving a 3328×1749 drawing buffer.
- Display at 60 Hz with vsync.
- URL `?slot=scratch&memprobe&debug`, with the HTML overlays hidden so only the canvas shows.

**Camera pins.** Every later step re-shoots these same pins. They are `window.__view = { at, look, flashlight? }` on the title screen. This change adds the `flashlight` option to `src/game/game.ts`.

| Shot | `at` | `look` | File |
| --- | --- | --- | --- |
| R02 commons | 17, 1.7, 13 | 30, 1, 23 | `baseline/r170-r02-commons.jpg` |
| R03 sofa under the east lamp | 9.2, 1.9, 17 | 12.2, 0.2, 19 | `baseline/r170-r03-sofa.jpg` |
| R04 through the glass | 8, 1.6, 18 | 8, 1.2, 28 | `baseline/r170-r04-through-glass.jpg` |
| Flashlight shadow (sofa onto the wall) | 9, 1.6, 18.2 (`flashlight: true`) | 13.5, 0.9, 18.7 | `baseline/r170-flashlight-sofa-wall.jpg` |

What to look for:
- **R03:** the sofa's shadow on the carpet has a soft edge.
- **R04:** the Lab B blinds are down at title time, so Lab B shows only between the slats.
- **Flashlight shot:** the sofa's back throws a soft-edged shadow onto the wall.

**Frame time.** Measured with `requestAnimationFrame` deltas over 10 s, after 3 s to settle. The 1% low is the average of the slowest 1% of frames.

| Where | Frames | Avg fps | Median ms | p99 ms | Max ms | 1% low fps |
| --- | --- | --- | --- | --- | --- | --- |
| Commons pin | 600 | 60.0 | 16.7 | 16.8 | 16.9 | 59.5 |
| R03 pin facing the pane | 600 | 60.0 | 16.7 | 16.8 | 16.9 | 59.4 |
| First 25 s of play with `&seq=drop`, player at the dock | 1499 | 60.0 | 16.7 | 16.8 | 33.5 | 55.7 |

- **Vsync caps every row at 60.** The numbers show no dropped frames, not how much headroom is left. A step counts as a regression if a pin stops holding 60 or its 1% low falls below 54 (10%).
- **The play-start row** has a single 33.5 ms frame about 2.4 s in, as play and the sequences start.
- **Not measured:** the drop itself, with the pane in view. A scripted session can't take pointer lock to walk the player into R03, and the opening intro sequence holds the view. Task 4.2 times the drop by hand, on the target PC, against the commons and R03 pin numbers above.

**GPU memory.** From `window.__memprobe.sample()` on the title at High, after the pins above:
- textures: 125 objects, 821 MiB
- renderbuffers: 21 objects, 180 MiB
- buffers: 1550 objects, 19 MiB
- **total: 1020 MiB**
- 131 programs and 24 framebuffers

## Upgrade steps

Every step re-shoots the four Baseline pins and re-times the two timing pins, on the same window and settings.

**`npm test` reference.** On r170 the full suite has 7 failures that are not caused by this change:
- the three slice01 walk tests;
- the R03 light-slot claim;
- finger bones on every named body;
- dock_guard motion binding;
- chair reach-and-sit.

A step passes `npm test` when it fails exactly these 7 and no others.

**0.175.0 (2.1).** Two breaks:
- **SMAA:** `SMAAPass` takes no constructor arguments from r175, not r187. The composer still sizes it in `addPass` and `setSize`.
- **GTAO hook:** `GTAOPass.overrideVisibility` became the private `_overrideVisibility`. `@types/three` still declares the public name, so the typecheck passed, and the game failed at boot with "Cannot read properties of undefined (reading 'bind')". `post.ts` now wraps `_overrideVisibility` and throws a clear error if it is missing. Section 3 removes `GTAOPass`.

One type-only fix: `@types/three` 0.175 gives `morphAttributes` fixed keys, so `merge.ts` deletes the keys instead of assigning `{}`.

Results:
- typecheck: 0 errors
- `npm test`: 1171 pass, the same 7 failures as r170
- console: no three.js or shader warnings
- the four pins match r170 by eye (exposure, colour, the sofa's soft shadow, the flashlight shadow, no AO marks under the commons lights)
- 1% lows: 59.4 at the commons pin and at the R03-pane pin
- GPU memory: 1020 MiB, 131 programs, the same as r170

**0.180.0 (2.2).** The typecheck was clean and the tests passed, but the screenshots caught a silent break: on High the gallery glass stopped rendering.
- **Symptom:** the east lamp's reflection on the R03/R04 glass was gone from three pins. Shader programs dropped from 131 to 125 and GPU memory from 1020 to 1006 MiB.
- **Bisect:** r178 is good and r179 is bad. On r178, hiding the glass removes the highlight, and `pool-light-4` is the light it reflects.
- **Cause:** in r179, `GTAOPass._restoreVisibility` only re-shows the points and lines it hid itself. Before, it restored every object from a cache. Our AO exclusion hides transparent, non-depth-writing and `skipGtao` meshes (glass, light shafts, decals) for the depth/normal pass, so from the first High frame on they stayed hidden.
- **Fix:** `excludeFromGtao` in `post.ts` restores what it hid, after GTAO's own restore. The predicate is now `skipsAo` (section 3 reuses it). The new `post.test.ts` runs a stub pass with r179's restore behaviour, and the test fails without the fix.

Results after the fix:
- typecheck: 0 errors
- `npm test`: 1174 pass, the same 7 failures as r170 (3 new tests)
- console: no three.js or shader warnings
- the four pins match r170 by eye, the glass reflection included
- 1% lows: 59.5 at the commons pin and 59.3 at the R03-pane pin
- GPU memory: 1020 MiB, 131 programs, the same as r170

**0.183.0 (2.3).** The shadow switch moved into this step from 2.4, because r183 (not r187) deprecates `PCFSoftShadowMap`. It logs a warning and falls back to the new soft `PCFShadowMap`. That filter takes 5 hardware-compared taps on a Vogel disk, rotated by interleaved gradient noise, and is `shadow.radius` texels wide.
- **Shadow type:** `renderer.ts` sets `SHADOW_MAP_TYPE = PCFShadowMap`. The flashlight (`FLASHLIGHT_SHADOW`) and every `SHADOW_CONES` kind set `shadow.radius = 2`, which matches the r170 soft edge on the sofa and table shadows. The biases are unchanged: the flashlight pin shows no acne or peter-panning.
- **Silent break: the whole room was black on every tier.** Only unlit meshes (light shafts, dust) drew. The typecheck, the tests and the console were all clean, and hiding the spot lights brought the room back.
  - **Cause:** a three r183 bug. For a shadow-sampler array, `WebGLUniforms` binds an empty placeholder `DepthTexture` without setting its `compareFunction`; only the single-sampler path sets it.
  - A castShadow spot that has never rendered a shadow pass has no map, so it gets that placeholder. WebGL2 then rejects every lit draw call, because the shader samples a shadow sampler whose compare mode is off.
  - Our unbound pool spots and the flashlight while off are exactly such lights. They keep `castShadow`, which avoids recompiles, and skip their pass.
  - r187 fixes the placeholder (`initShadowTexture` on both paths).
  - **Fix:** `pauseShadow` (`src/render/shadowMapKeep.ts`) stops a light's pass, but first asks for one pass if the light has no map. The pool and the flashlight both use it. Tests cover the helper, an unbound pool spot, and the flashlight starting off.
- **Console:** no three.js warnings on a normal load. On a cold shader cache, the ANGLE/D3D compiler logs warning X4122 for three's new `PMREMGGXConvolution` environment prefilter. It is a harmless double-precision constant-folding notice, and the shader is three's, not ours, so it is left alone.
- **`meshoptimizer`:** `@types/three` 0.183 depends on `meshoptimizer` ~1.0.1, which displaced the 0.22.0 at the top of `node_modules`. The `scripts/*-glb.mjs` asset tools and `scripts/lib/scan-body.mjs` import `meshoptimizer/meshopt_simplifier.module.js`, a path 1.0 no longer exports. They had only worked through the old `@types/three` dependency. `meshoptimizer@0.22.0` is now an exact devDependency, so the scripts keep the same simplifier, and `scanBody.test.ts` passes again.
- **Ragdoll stairs test:** the chest shot on the stairs (`trialRagdoll.test.ts`) is a chaotic fall.
  - On r180 the body stops on the steps at 5.98 s. On r183, a slightly different start pose tumbles it to the floor, where it rests at 8.67 s.
  - The test allows either outcome, but it only simulated 8 s, so it now simulates 12 s (agreed with the user).

Results after the fixes:
- typecheck: 0 errors
- `npm test`: 1180 pass, the same 7 failures as r170 (6 new tests)
- the four pins match r170 by eye: the sofa and table shadows are soft and attached, the flashlight wall shadow is clean, and the glass reflection is present
- GPU memory: 1084 MiB (+6%), 134 programs (+3).
  - Shadow maps are now depth textures instead of colour targets: renderbuffers went from 180 to 112 MiB, textures from 821 to 953 MiB.
  - The two pool spots and the flashlight that had never rendered now hold a 1024² map each.
- 1% lows: not comparable. Another agent held the CPU at 65%, so both pins averaged 57-60 fps with hitches down to single digits. Re-time at 2.4, and by hand in 4.2.

**0.187.0 (2.4).** No code changes were needed.
- **GTAO:** no retune. Between r181 and r186, `GTAOPass`'s shader diff only adds reversed-depth and orthographic paths, and the pins show the same AO as r183.
- **Shadows:** radius 2 and the 2.3 biases still hold. The sofa shadow on the carpet and the flashlight's sofa-on-wall shadow are soft and attached, with no acne or peter-panning. r187's own `initShadowTexture` fix for the empty shadow-sampler placeholder makes `pauseShadow`'s first pass redundant but harmless, so it stays.
- **R03 table glint varies per load.** In the R03 sofa pin, some loads show the bright environment reflection on the coffee table (as r170 does) and others don't. When it's missing, the lower-right blinds reflect more brightly.
  - Both are environment-map reflections: they vanish at `environmentIntensity` 0.
  - Ruled out: the light and shadow-pool state (identical on both kinds of load), stale shadow maps, GTAO, an occluder between the pendant and the table, regenerating the PMREM, and shader-program sharing.
  - Not checked: whether r170 varies the same way. The shared r170 dev server was unusable at the time.
  - Accepted as within mood (agreed with the user). The flashlight pin shows the glint on r187. Revisit if it is still visible after section 3.
- **Capture note:** resizing the browser window while the game loads leaves the camera framing about 5% too tight. Load the page at the final window size before shooting pins.
- **R03-pane timing pin:** `at` 8, 1.6, 18 and `look` 8, 1.2, 28, the same camera as the R04 screenshot pin. 1.1 did not record it.

Results:
- typecheck: 0 errors
- `npm test`: the same 7 failures as r170
- console: no three.js, shader or deprecation warnings
- the four pins match r170 by eye, apart from the R03 glint above
- 1% lows: 59.5 at the commons pin and 59.2 / 59.3 at the R03-pane pin. Later runs dropped frames while an unrelated process held the CPU at 50-68%.
- GPU memory: 1014 MiB (textures 951, renderbuffers 44, buffers 19), 134 programs. That is 6 MiB under r170 and 70 under r183.

**r187 `EffectComposer` reference (2.5).** Section 3 is compared against these, shot from the Baseline pins on the same window:
- `baseline/r187-r02-commons.jpg`
- `baseline/r187-r03-sofa.jpg` (a no-glint load)
- `baseline/r187-r04-through-glass.jpg`
- `baseline/r187-flashlight-sofa-wall.jpg`

Unrelated to the upgrade: three ambience one-shots referenced in `sounds.ts` (`archPass`, `archAlarm`, `wandBeep`) are missing from `public/assets` on `foundation`. Each page load logs a decode warning for them.

## Open Questions

- Final tuned values (shadow radius per light kind, `n8ao` and bloom parameters) are found by screenshot during implementation and recorded here before archiving.
