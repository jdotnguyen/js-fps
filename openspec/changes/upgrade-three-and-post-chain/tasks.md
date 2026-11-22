# Tasks

> Start after `fidelity-first-rendering` Phase 1 is committed. Capture the baseline (task 1.1) before changing any package.

## 1. Baseline

- [x] 1.1 On r170, take High screenshots of R02, R03 (sofa under the east lamp), R04 through the glass, and a flashlight shadow on a wall, from title-camera `__view` pins (defined here, since `fidelity-first-rendering` recorded none). Then time 1% lows at the commons and R03-pane pins, and record `?slot=scratch&memprobe` GPU memory. The drop itself is timed by hand in 4.2. Verify the images and numbers are recorded in design.md under a "Baseline" heading.

## 2. Stepwise three upgrade (three's own `EffectComposer` throughout)

- [x] 2.1 Upgrade `three` and `@types/three` to 0.175.0 and fix what breaks. Verify `npm run typecheck` and `npm test` pass, the console shows no shader warnings, and screenshots match the baseline in mood.
- [x] 2.2 Upgrade to 0.180.0 and fix what breaks. Verify as in 2.1.
- [ ] 2.3 Upgrade to 0.183.0. r183 deprecates `PCFSoftShadowMap` (it warns and falls back to the new soft PCF, whose width is `shadow.radius`), so switch `renderer.shadowMap.type` to `PCFShadowMap` here, give the flashlight and each `SHADOW_CONES` kind a `shadow.radius` tuned to the baseline's soft edge, and retune their bias and normal bias. Verify as in 2.1, plus a test that each cone kind sets its bias and a radius above 1 and that the renderer does not use `PCFSoftShadowMap`. The console must show no `PCFSoftShadowMap` deprecation warning, the sofa and flashlight shadows must have soft edges (render-lighting: Shadows have soft edges), and the flashlight shadow screenshot must have no acne or peter-panning.
- [ ] 2.4 Upgrade to 0.187.0 and retune `GTAOPass` for its r181 to r186 output changes. Recheck the 2.3 shadow radius and bias. Verify as in 2.1, and that the sofa and flashlight shadows still match the 2.3 screenshots.
- [ ] 2.5 Record the r187 `EffectComposer` screenshots as the reference for section 3. Note the shadow-map finding in `fidelity-first-rendering`'s design.md Open Questions (removed before r187, replaced by soft PCF). Verify both are written.

## 3. postprocessing chain

- [ ] 3.1 Add `postprocessing@6.39.6` and `n8ao@2.1.0` with exact versions, and pin `three` at `0.187.0`. Verify `package.json` has no caret on the three of them and `npm ci` installs cleanly.
- [ ] 3.2 Rewrite `src/render/post.ts`. The order is: `RenderPass` of the AO-eligible scene, `N8AOPostPass`, a `clear: false` `RenderPass` of the AO-excluded meshes, an `EffectPass` of bloom, the grade `Effect` and `ToneMappingEffect` (ACES Filmic), then an `EffectPass` of SMAA. Set `renderer.toneMapping` to `NoToneMapping` while the chain renders. Verify with a test that the exclusion predicate puts transparent, non-depth-writing and `skipGtao` meshes in the second render only, and that `typecheck` passes.
- [ ] 3.3 Port the grade to a custom convolution `Effect` that keeps the same uniforms (`uGrain`, `uVignette`, `uAberration`, `uLift`, `uGain`, `uDamage`, `uTime`, `uResolution`) as the objects `post.grade` returns. Verify with a test that setting `post.grade.uGrain.value` and `uDamage.value` changes the effect's uniforms, and by screenshot that the Film grain setting removes grain only and heavy damage turns the edges red (post-processing: The final grade).
- [ ] 3.4 Make `applyPostTier` toggle `n8ao` and SMAA, and rebuild the bloom `EffectPass`'s effects on a tier switch (bloom on Medium and High only). Verify with the existing `applyPostTier` test, extended so Low builds the pass without bloom, and with a High to Low switch during play that reloads nothing (post-processing: Post effects follow a tier switch without a reload).
- [ ] 3.5 Rebind the debug GUI's AO and bloom controls in `main.ts` to the `n8ao` configuration and `BloomEffect`, and update `sandbox/actorsSandbox.ts` if `createPost` changed. Verify `typecheck`, and that with `&debug` the AO toggle and bloom sliders change the image.
- [ ] 3.6 Tune `n8ao` (radius, falloff, intensity, quality) and bloom (threshold, intensity, radius) against the 2.5 screenshots. Check exposure matches, and that no AO shape appears under the light shafts or through the Lab B glass. Verify with side-by-side screenshots of R02, R03 and R04 recorded in design.md, and the post-processing spec's AO and bloom scenarios checked by eye.

## 4. Integration

- [ ] 4.1 Run `npm run typecheck` and `npm test`. Verify both pass, or that any failure is shown to be outside this change.
- [ ] 4.2 Measure at High on the target PC (full screen, pane or window visible) at the 1.1 commons and R03-pane pins, and by hand through the R03 drop with the pane visible. Verify 1% lows of at least 30 fps everywhere, the pins no worse than the 1.1 baseline by more than 10% (1.1 has no drop number, so the drop is held to the 30 fps floor only), and GPU memory within 10% of baseline. Record the numbers in design.md. If they fall short, switch `n8ao` to half resolution and measure again.
- [ ] 4.3 Record the final tuned values (shadow radius per kind, `n8ao` and bloom parameters) in design.md and close its Open Questions. Verify `openspec validate upgrade-three-and-post-chain --strict` passes.

## Workflow follow-up

- Archive `fidelity-first-rendering` before this change, so the `render-quality` spec exists when this one archives.
- A later change can adopt postprocessing v7, or move past r187, once postprocessing's peer range allows it.
