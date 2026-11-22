# Design

## Context

- **Forward shading.** `WebGLRenderer` (r170) does forward shading: every lit pixel loops over every light in the scene, and the light count is compiled into each shader. Changing the count recompiles materials.
- **The fill-light pool today.** `Level` builds one `LightPool` of 8 `PointLight`s, and the lazy-loaded lab world (`labWorld.ts`) builds its own of 12 for its nearest ceiling lamps. `assign` binds them to visible rooms' pooled slots, with the current room scored 20 m closer (`priority * 400`). Unbound pool lights sit at intensity 0 but still cost a loop iteration on every pixel.
- **What `refresh-observation-gallery` added (archived 2026-11-20):**
  - the `render-lighting` capability
  - glow-only lights (`pool: false`)
  - the `pendant` lamp slot kind
  - kind-aware fluorescent buzz

  This plan builds on those.
- **Budgets in other specs.** `dive-bay` (R13 rooms within 60 draw calls, no view over 300), `dock-checkpoint` (R01 within 60) and `imported-props` (prop costs count against per-room budgets) state the caps this change removes, so each gets a MODIFIED delta.
- **Anisotropy is set at creation.** Generated and photo textures take `min(8, max)` once in `main.ts`; `decals.ts` and `screens.ts` hard-code 4; imported GLB textures keep the loader's default.
- **Shadows.** `renderer.shadowMap` is on (PCFSoft). Only the flashlight casts (1024 map, `autoUpdate` off while dark). Room geometry and props already cast and receive shadows. Humanoids cast only within `LOD_DISTANCE` (15 m), and an earlier profile found the bodies the single biggest frame cost.
- **Quality tiers** (`settings.quality`: low, medium, high) drive:
  - the pixel-ratio cap (1 / 1.25 / 1.5)
  - GTAO (High only)
  - bloom (Medium and High)

  There is no anti-aliasing. Anisotropy is `min(8, max)` on every tier.
- **Library landscape** (researched November 2026):
  - Three.js is at r187.
  - `ClusteredLighting` (Forward+) ships as an addon for `WebGPURenderer` only, since r185; spot lights were added in r187.
  - `EffectComposer` and pmndrs `postprocessing` do not run on `WebGPURenderer`. Post there is the TSL `RenderPipeline`, with GTAO, bloom, SSGI and TRAA nodes.
  - `realism-effects` is reported stale and incompatible with current Three.js.
  - `n8ao` (ambient occlusion) works with both `EffectComposer` and pmndrs `postprocessing`.
  - The Three.js manual states that `ShaderMaterial`, `RawShaderMaterial` and `onBeforeCompile` are not supported on `WebGPURenderer`.
  - pmndrs `postprocessing` plans a breaking v7 (a lighter `RenderPipeline` replacing its `EffectComposer`); no WebGPU support is announced.

## Goals / Non-Goals

**Goals:**
- One table of per-tier values that every system reads, so "what High means" is one edit.
- Shadow-casting room lights without shader recompiles during play.
- A staged path to richer light (larger pools, better post, then baked light), where each phase can stop safely.

**Non-Goals:**
- Point-light (cube) shadows or a custom shadow atlas.
- Higher-resolution texture sets (an asset task, separate).
- Changing any room's authored lighting in Phase 1, apart from the gallery follow-up.

## Phase 1 decisions

### 1. A `RENDER_TIERS` table owns the numbers
A single module, `src/render/tiers.ts`, exports these values per tier:
- `fillLights`, `shadowLights`, `shadowMapSize`
- `pixelRatioCap` (`Infinity` on High)
- `smaa`, `gtao`, `bloom`
- `anisotropy` (`'max'` on High)
- `characterShadowDistance`

`PIXEL_RATIO_CAP` and the `post.setQuality` booleans move into it. Keeping values next to each system was rejected: the point is a single edit.

### 2. Pools resize only on tier switch
`LightPool` gains `resize(n)`, and `Level` and the lab world call it when quality changes. The materials recompile once, at the menu, which is acceptable. Allocating 32 always and zeroing the extras was rejected: unbound lights still cost every pixel, so Low would pay High's price.

Low is 12, not today's 8. After the gallery follow-up, R03 has 9 pooled lights and Lab B 3 more through the glass; with 8, Lab B would go dark on Low, the problem the gallery change fixed with glow-only lights. 12 also matches the lab world's pool, so the lab is unchanged on Low. The lab world has no `shadow: true` slots, so it needs no shadow pool.

### 3. Shadow lights are a second pool of downward `SpotLight`s
- A `ShadowPool` holds `shadowLights` spots with `castShadow = true`. Each frame, after culling, it binds them to pooled slots with `shadow: true`, using the fill pool's scoring.
- A slot bound to a shadow spot does not also take a fill light. An opted-in slot that misses the shadow pool falls back to the fill pool.
- Unbound spots get intensity 0 and `shadow.autoUpdate = false`, the flashlight's trick for skipping the shadow pass without a recompile.
- Cones point down from the slot, with a per-kind angle and penumbra (`pendant` about 60°, `ceiling` about 75°) and per-kind `bias` and `normalBias`.
- Rejected: `PointLight` shadows (6 renders each) and a shadow atlas (that belongs with Phase 2).
- Shadow maps render once per frame: `main.ts` turns off `renderer.shadowMap.autoUpdate` and sets `needsUpdate` just before the post chain renders. Otherwise every `render` call redraws every shadow map: the camera feeds and the GTAO normal pass each add a full shadow pass. Camera feeds bind no shadow spots (their opted-in lights fall back to the fill pool) and reuse the last frame's flashlight map.

### 4. Clamp the pools to the GPU
- `shadowLights` is clamped to `maxTextures - reservedMaterialUnits - 1` (the flashlight), measured from the heaviest standard material. WebGL 2 guarantees 16 units, and ANGLE on Windows usually reports exactly that.
- `fillLights` is clamped by `MAX_FRAGMENT_UNIFORM_VECTORS`.
- Both clamps log a warning.

### 5. SMAA, anisotropy, character shadows
- `SMAAPass` goes after `OutputPass` on Medium and High. Rejected: MSAA (the whole post chain would need multisampled targets) and FXAA (blurrier).
- Tier switches set texture `anisotropy` live on every texture that samples the world at an angle: generated and photo PBR sets (`materials.ts`, `textures.ts`), decals, screens and imported GLB textures. A tracked set filled at creation avoids a scene traversal per switch.
- Humanoids read `characterShadowDistance` (15 m on Low and Medium, 40 m on High) instead of the fixed `LOD_DISTANCE`.

### 6. Budgets become reports; the floor is the gate
- The `slice01` draw-call tests keep logging but drop their `<= 60` and `<= 300` assertions.
- The gate is a measurement at High on the target PC, in the heaviest scenes (the R03 drop and the commons), with 1% lows of at least 30 fps.
- First measurement (2026-11-21, developer playtest at High, full screen): 60 fps throughout, the R03 gallery and the commons included. There is an occasional sharp drop to about 20 fps lasting about a second, not tied to R03. Its cause is not yet known; one candidate is a shader compiling the first time something is seen. Task 6.2 stays open until the drop is explained and the 1% lows are timed.

### 7. Gallery follow-up
- R03's slots 0, 2, 3, 5 and 8 drop `pool: false`. Pooled, they would take the kind defaults (ceiling intensity 10, range 10) and wash out the dim gallery. So the corner ceilings get intensity 3 and range 6, below the centre pair's 5 and 8, and slot 8 matches the other lamp bulbs. The lamp bulbs (6, 7, 8) go from 4 and 4.5 to 20 and 6. At 4, a bulb puts about 1 lux on the dark carpet, so the sofa's shadow could not be seen; at 20 the table pool, the lit carpet beside the sofa and its shadow read in the High screenshots, and the room stays dim.
- Slots 1, 4, 6 and 7 set `shadow: true`.
- R03 then takes 9 pooled lights, which with Lab B's 3 fits every tier's pool (12 on Low).

## Phase 2: WebGL with pmndrs postprocessing (its own change)

```
  r170 WebGL --(stepwise upgrade)--> current WebGL --> pmndrs postprocessing + n8ao + SMAA
       |                                  |
   Phase 1 here                 fixes shadow/GTAO breaks
                                          :
                                          :  deferred, revisit only if lights still limit the look
                                          v
                                WebGPU + ClusteredLighting + TSL
```

1. **Upgrade Three.js on `WebGLRenderer` first, in steps.** The breaks are cheap to find there:
   - shadow map type: this design earlier stated that `PCFSoftShadowMap` is gone in r186 and `PCFShadowMap` is now soft. That is unconfirmed: the only reference found is an r183 fix to `PCFSoftShadowMap`. Check the migration guide for each step before changing `renderer.ts`.
   - GTAO output changes (r181, r185, r186)
   - shadow bias needs retuning (r183)
2. **Swap the post chain to pmndrs `postprocessing`.** Its `EffectComposer` with one merged `EffectPass` replaces today's separate passes:
   - `n8ao` replaces `GTAOPass`. The transparent and `skipGtao` exclusion in `post.ts` is redone for `n8ao`.
   - its bloom replaces `UnrealBloomPass`
   - the grade shader (aberration, lift/gain, damage tint, vignette, grain) becomes a custom `Effect`
   - its SMAA effect replaces Phase 1's `SMAAPass`
   - the `Post` interface (`setSize`, `setQuality`, `render`, `grade` uniforms) stays, so callers do not change
   
   Pin the `postprocessing` version; v7 is a breaking rewrite.
3. **Why not WebGPU now.** It would remove the light count as a limit and bring SSGI and TRAA, but the port is large:

   | What must move to TSL | Count | Where |
   |---|---|---|
   | `ShaderMaterial` / `RawShaderMaterial` | 17 in 12 files | `fx/` ocean, abyss, shafts, particulates, exterior; `kit/slice.ts` (4), `sanityScreen.ts` (2), `diveBay.ts`; `cameraFeedGl.ts`; `ui/navPulse.ts`; the grade in `post.ts` |
   | `onBeforeCompile` hooks | 5 in 4 files | `bodyMaterial.ts`, `viewmodel.ts` (2), `kit/merge.ts`, `fx/exteriorLight.ts` |
   | Post chain | all | `post.ts` |
   | Render targets | 4 uses | `cameraFeed.ts` |

   Counted November 2026. In-flight shader work (`overhaul-exterior-ocean`) adds to this. Phase 1's larger pools plus Phase 3 lightmaps cover most of the same visual ground. If they do not, a later change spikes `WebGPURenderer` with `ClusteredLighting` on the R03 drop and the commons, with these go/no-go checks: frame time at High against the WebGL build, IBL with clustered lights, spot shadows alongside clustered point lights, the WebGL 2 fallback backend, and a TSL port or stand-in for every row above. The light-slot API (`render-lighting`) stays the boundary either way.

## Phase 3: baked light (optional)

Lightmaps for static architecture, baked in Blender on GLB pieces as ADR-0003 already anticipates. Dynamic lights keep everything that flickers, moves or goes red. With WebGPU deferred, this is the main way to get bounce light and more light sources into static rooms without raising the dynamic budget.

## Risks / Trade-offs

- [32 fill lights at an uncapped pixel ratio cost GPU time on every lit pixel] → Measure in the commons and the R03 drop. If the floor fails, lower High in `RENDER_TIERS` and update the render-quality table before archiving.
- [Each shadow light redraws nearby characters] → `characterShadowDistance` bounds that. Option: skip a shadow update when nothing dynamic moved in its cone.
- [Removing draw-call caps lets content bloat unnoticed] → Tests still log the heaviest rooms, and the floor catches real regressions.
- [Phase 2's pmndrs post chain is WebGL only and is thrown away if WebGPU is adopted later] → Accepted: the post chain is small (one file), and WebGPU is deferred indefinitely.
- [pmndrs `postprocessing` v7 is a breaking rewrite] → Pin the version; upgrade to v7 as its own task once it ships.
- [`n8ao` darkens transparent meshes the way GTAO did before the exclusion] → Port the `skipGtao` and transparent-mesh exclusion, and check the light shafts, decals and Lab B glass by screenshot.

## Open Questions

- The exact Three.js release to target in Phase 2 is chosen when the upgrade starts. **Answered by `upgrade-three-and-post-chain`:** r187, the newest release pmndrs `postprocessing` 6.x supports.
- Whether `PCFSoftShadowMap` is actually removed in a release Phase 2 targets (see Phase 2, step 1). **Answered by `upgrade-three-and-post-chain`:** yes, before r187.
  - r183 already deprecates it: it logs a warning and falls back to `PCFShadowMap`.
  - From r183, `PCFShadowMap` is itself soft: 5 hardware-compared taps on a Vogel disk, `shadow.radius` texels wide.
  - The renderer now uses `PCFShadowMap`, with `shadow.radius = 2` on the flashlight and every shadow-pool kind.
