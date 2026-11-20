# Tasks

> Parked: start after `refresh-observation-gallery` is archived.

## 1. Tier table

- [ ] 1.1 Add `src/render/tiers.ts` with `RENDER_TIERS` holding the render-quality spec's values, and move `PIXEL_RATIO_CAP` and the `post.setQuality` booleans onto it; verify with a unit test of each tier's values and that `applyQuality` uses the device pixel ratio uncapped on High
- [ ] 1.2 Add startup clamps for fill lights (`MAX_FRAGMENT_UNIFORM_VECTORS`) and shadow lights (`maxTextures` minus measured material units minus the flashlight) with warnings; verify with a unit test that feeds low capability numbers and checks the clamped counts and warning

## 2. Fill-light pool by tier

- [ ] 2.1 Give `LightPool` a `resize(n)` and have `Level` size it from the active tier and resize on quality change; verify with a test that Medium to High yields 32 pool lights and `assign` never changes the count

## 3. Shadow-light pool

- [ ] 3.1 Add `shadow: optional(bool)` to the room light schema in `src/data/types/level.ts`; verify with a `levelValidator` test that `shadow: true` passes and a non-boolean is rejected
- [ ] 3.2 Implement `ShadowPool` (downward `SpotLight`s, per-kind cone and bias, tier map size, `autoUpdate` off when unbound), bound after culling, current room first, with fill-pool fallback; verify with tests for binding order, fallback when full, Low binding nothing, and a constant shadow-light count during play
- [ ] 3.3 Make patterns and tints drive bound shadow spots like fill lights; verify with a test that `setRoomLights(room, 'alarm')` and `tintRoomLights(room, 'emergency')` change a bound spot's intensity curve and colour
- [ ] 3.4 Make humanoid `castShadow` use the tier's character shadow distance; verify with an actor test at 20 m (casts on High, not on Medium)

## 4. Quality features

- [ ] 4.1 Add `SMAAPass` after `OutputPass` on Medium and High; verify with a post test that it is enabled per tier, and visually on a thin rail at High
- [ ] 4.2 Apply tier anisotropy (GPU max on High) at load and on tier switch; verify with a test that material textures report the tier's anisotropy after a switch

## 5. Budgets and the gallery follow-up

- [ ] 5.1 Turn the `slice01` draw-call assertions (60 per room, 300 visible) into logged reports; verify the tests pass and still print the heaviest rooms
- [ ] 5.2 In R03, drop `pool: false` from slots 0, 2, 3, 5 and 8 and set `shadow: true` on 1, 4, 6 and 7; verify with a level test that R03 has 9 pooled lights and 4 shadow requests, and on High that the sofa casts a shadow under the east lamp

## 6. Phase 1 integration

- [ ] 6.1 Run `npm test` and `npm run typecheck`; verify both pass
- [ ] 6.2 Measure at High on the target PC in the commons and the R03 drop (pane visible, time requestAnimationFrame over a few seconds); verify 1% lows of at least 30 fps and record them in design.md, or lower High's numbers and update the render-quality spec before archiving

## 7. Phase 2 spike (decision only; implementation is a separate change)

- [ ] 7.1 Upgrade `three` from r170 to the current release in steps on `WebGLRenderer` (switch to soft `PCFShadowMap`, retune GTAO and shadow bias); verify `npm test` passes and before and after screenshots of R02, R03 and R04 match in mood
- [ ] 7.2 Inventory every `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile` and custom pass, with a TSL port estimate for each; verify the list is recorded in this design's Phase 2 section
- [ ] 7.3 Build a `?webgpu` spike of the R03 drop and the commons with `WebGPURenderer` and `ClusteredLighting`; verify and record the go/no-go checks from the design (frame time against Phase 1 at High, IBL, spot shadows with clustered lights, WebGL 2 fallback)
- [ ] 7.4 Record the decision (WebGPU migration, or the WebGL fallback with pmndrs `postprocessing` and `n8ao`) in this design's Phase 2 section and propose the follow-up change; verify the design links the spike results

## Workflow follow-up

- Phase 3 (Blender lightmaps) gets its own change once Phase 2 is decided.
