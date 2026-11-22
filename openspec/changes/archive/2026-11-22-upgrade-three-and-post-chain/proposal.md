# Proposal

## Why

Phase 1 (`fidelity-first-rendering`) raised the budgets on Three.js r170 and its example `EffectComposer`. The game is now 17 releases behind (r187 is current), and the post chain runs four separate full-screen passes (GTAO, bloom, the grade, SMAA) on top of the output pass. This change does Phase 2 of that plan: get current on `WebGLRenderer`, then move post-processing to one merged chain with better ambient occlusion, without changing how the game looks or plays.

## What Changes

- **Upgrade `three` and `@types/three` from 0.170 to 0.187 in steps** (to 0.175, 0.180, 0.183, then 0.187), with typecheck, tests and screenshots at each step.
  - **BREAKING (look):** `PCFSoftShadowMap` was removed by r187 and falls back to `PCFShadowMap` with a warning. In r187, `PCFShadowMap` is itself soft: a 5-tap Vogel-disk filter whose width is `shadow.radius`. The renderer switches to `PCFShadowMap`, and the flashlight and shadow-pool spots get a radius tuned to keep today's soft edges.
  - Shadow bias (changed in r183) and GTAO output (r181 to r186) are retuned at the steps where they change.
  - `SMAAPass` takes no constructor arguments in r187; Phase 1's call is updated.
  - Checked against r187 already: every shader chunk our 5 `onBeforeCompile` hooks patch still exists, and so does the literal line `viewmodel.ts` replaces. `Clock` is deprecated (r183), but `src` does not use it.
- **Replace the post chain with pmndrs `postprocessing` 6.39.6 and `n8ao` 2.1.0**, both pinned exactly. postprocessing's peer range is `three >= 0.168 < 0.188`, so r187 is the newest it supports.
  - `n8ao` replaces `GTAOPass`, still on High only. Glass, light shafts, decals and other meshes that skip AO stay out of it.
  - postprocessing's bloom replaces `UnrealBloomPass` (Medium and High).
  - The grade (aberration, lift/gain, damage tint, vignette, film grain) becomes a custom `Effect`, merged with bloom and tone mapping into one pass.
  - postprocessing's SMAA replaces Phase 1's `SMAAPass` (Medium and High).
  - The `Post` interface (`setSize`, `setQuality`, `render`, the `grade` uniforms) keeps its shape. The debug GUI's ambient occlusion and bloom controls are rebound to the new effects.
- **Not in this change:** `WebGPURenderer`, the TSL `RenderPipeline` and clustered lighting stay deferred (see `fidelity-first-rendering` design, Phase 2 step 3). So do Blender lightmaps (Phase 3).

## Capabilities

### New Capabilities
- `post-processing`: what the post chain does to the rendered frame: which surfaces ambient occlusion applies to, bloom, the final grade and its player-facing controls, and live tier switching of these effects.

### Modified Capabilities
- `render-lighting`: adds soft-edged shadows for the flashlight and room shadow lights, so the look survives the shadow-map type change.

## Impact

- **Dependencies:** `three` 0.170.0 → 0.187.0 and `@types/three` to match, plus new `postprocessing` 6.39.6 and `n8ao` 2.1.0, pinned without a caret. postprocessing's v7 is a breaking rewrite; adopting it is a later change.
- **Code:**
  - `package.json`, `package-lock.json`
  - `src/render/post.ts` (rewritten)
  - `src/render/renderer.ts` (shadow map type)
  - `src/render/flashlight.ts`, `src/world/shadowPool.ts` (shadow radius and bias)
  - `src/main.ts` (debug GUI bindings)
  - `src/sandbox/actorsSandbox.ts` (uses `createPost`)
  - any file the upgrade steps break
- **Specs:** the `render-quality` delta in `fidelity-first-rendering` (AO on High only, bloom on Medium and High, SMAA on Medium and High) still holds and is not restated here.
- **Tests:** post tier toggling stays covered by `applyPostTier`. New tests cover the AO exclusion list and the grade's controls. The level tests are re-run at every upgrade step.
- **Performance:** measured against the `render-quality` floor (1% lows of 30 fps or more at High), in the commons and the R03 drop, before and after. GPU memory is checked with `?slot=scratch&memprobe`.
- **Risk:** pmndrs `postprocessing` is WebGL only, so this work would be redone if `WebGPURenderer` is adopted later (accepted in the `fidelity-first-rendering` design).
