# Tasks

> Phase 1 only. `refresh-observation-gallery` is archived, so this can start. Phase 2 work (the Three.js upgrade and the post-chain swap) lives in its own change.

## 1. Tier table

- [x] 1.1 Add `src/render/tiers.ts` with `RENDER_TIERS` holding the render-quality spec's values, and move `PIXEL_RATIO_CAP` and the `post.setQuality` booleans onto it; verify with a unit test of each tier's values and that `applyQuality` uses the device pixel ratio uncapped on High
- [x] 1.2 Add startup clamps for fill lights (`MAX_FRAGMENT_UNIFORM_VECTORS`) and shadow lights (`maxTextures` minus measured material units minus the flashlight) with warnings; verify with a unit test that feeds low capability numbers and checks the clamped counts and warning

## 2. Fill-light pool by tier

- [x] 2.1 Give `LightPool` a `resize(n)` and have `Level` size it from the active tier and resize on quality change; verify with a test that Medium to High yields 32 pool lights and `assign` never changes the count
- [x] 2.2 Size the lab world's pool (`labWorld.ts`, 12 today) from the active tier and resize it on quality change; verify with a test that the lab world has 12 pool lights on Low and 32 on High

## 3. Shadow-light pool

- [x] 3.1 Add `shadow: optional(bool)` to the room light schema in `src/data/types/level.ts`; verify with a `levelValidator` test that `shadow: true` passes and a non-boolean is rejected
- [x] 3.2 Implement `ShadowPool` (downward `SpotLight`s, per-kind cone and bias, tier map size, `autoUpdate` off when unbound), bound after culling, current room first, with fill-pool fallback; verify with tests for binding order, fallback when full, Low binding nothing, and a constant shadow-light count during play
- [x] 3.3 Make patterns and tints drive bound shadow spots like fill lights; verify with a test that `setRoomLights(room, 'alarm')` and `tintRoomLights(room, 'emergency')` change a bound spot's intensity curve and colour
- [x] 3.4 Make humanoid `castShadow` use the tier's character shadow distance; verify with an actor test at 20 m (casts on High, not on Medium)

## 4. Quality features

- [ ] 4.1 Add `SMAAPass` after `OutputPass` on Medium and High; verify with a post test that it is enabled per tier, and visually on a thin rail at High
- [x] 4.2 Apply tier anisotropy (GPU max on High) at load and on tier switch to generated and photo PBR textures (`materials.ts`, `textures.ts`), decals (`decals.ts`, fixed at 4 today), screens (`screens.ts`, fixed at 4 today) and imported GLB textures (`gltf.ts`); verify with a test that a texture of each kind reports the tier's anisotropy after a switch

## 5. Budgets and the gallery follow-up

- [x] 5.1 Turn the `slice01` draw-call assertions (60 per room, 300 visible) into logged reports, as the modified `dive-bay`, `dock-checkpoint` and `imported-props` specs require; verify the tests pass, still print the heaviest rooms, and `importedBudget.test.ts` still checks recorded prop costs
- [x] 5.3 Replace code comments that cite "ADR-0002" for the 8-light pool and pixel-ratio caps (`lightPool.ts`, `renderer.ts`) with references to the `render-lighting` and `render-quality` specs; verify with a search that no comment still claims an 8-light pool
- [x] 5.2 In R03, drop `pool: false` from slots 0, 2, 3, 5 and 8 and set `shadow: true` on 1, 4, 6 and 7; verify with a level test that R03 has 9 pooled lights and 4 shadow requests, and on High that the sofa casts a shadow under the east lamp

## 6. Phase 1 integration

- [x] 6.1 Run `npm test` and `npm run typecheck`; verify both pass. Typecheck passes and every test this change touches passes. 7 tests in other in-flight work still failed on 2026-11-21 (held grip, dock_guard motion, the R08 mauled kill, slice01 walks); none touch rendering, and the developer accepted them as outside this change.
- [ ] 6.2 Measure at High on the target PC in the commons and the R03 drop (pane visible, time requestAnimationFrame over a few seconds); verify 1% lows of at least 30 fps and record them in design.md, or lower High's numbers and update the render-quality spec before archiving

## 7. Phase 2 hand-off (implementation is a separate change)

- [x] 7.1 Inventory every `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile` and custom pass; recorded in design.md Phase 2, step 3
- [x] 7.2 Propose the Phase 2 change, with the stepwise Three.js upgrade on `WebGLRenderer` as its first task (shadow map type check, GTAO and shadow-bias retune, before and after screenshots of R02, R03 and R04) followed by pmndrs `postprocessing` with `n8ao`, SMAA and the grade as an `Effect`, as design.md Phase 2 describes; verify it validates with `openspec validate`

## Workflow follow-up

- Phase 3 (Blender lightmaps) gets its own change once Phase 2 is decided.
