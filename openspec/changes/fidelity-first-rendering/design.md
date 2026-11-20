# Design

## Context

- **Forward shading.** `WebGLRenderer` (r170) does forward shading: every lit pixel loops over every light in the scene, and the light count is compiled into each shader. Changing the count recompiles materials.
- **The fill-light pool today.** `Level` builds one `LightPool` of 8 `PointLight`s. `assign` binds them to visible rooms' pooled slots, with the current room scored 20 m closer (`priority * 400`). Unbound pool lights sit at intensity 0 but still cost a loop iteration on every pixel.
- **What `refresh-observation-gallery` adds first:**
  - the `render-lighting` capability
  - glow-only lights (`pool: false`)
  - the `pendant` lamp slot kind
  - kind-aware fluorescent buzz

  This plan builds on those.
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

## Goals / Non-Goals

**Goals:**
- One table of per-tier values that every system reads, so "what High means" is one edit.
- Shadow-casting room lights without shader recompiles during play.
- A staged path to "no practical light limit", where each phase can stop safely.

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
`LightPool` gains `resize(n)`, and `Level` calls it when quality changes. The materials recompile once, at the menu, which is acceptable. Allocating 32 always and zeroing the extras was rejected: unbound lights still cost every pixel, so Low would pay High's price.

### 3. Shadow lights are a second pool of downward `SpotLight`s
- A `ShadowPool` holds `shadowLights` spots with `castShadow = true`. Each frame, after culling, it binds them to pooled slots with `shadow: true`, using the fill pool's scoring.
- A slot bound to a shadow spot does not also take a fill light. An opted-in slot that misses the shadow pool falls back to the fill pool.
- Unbound spots get intensity 0 and `shadow.autoUpdate = false`, the flashlight's trick for skipping the shadow pass without a recompile.
- Cones point down from the slot, with a per-kind angle and penumbra (`pendant` about 60°, `ceiling` about 75°) and per-kind `bias` and `normalBias`.
- Rejected: `PointLight` shadows (6 renders each) and a shadow atlas (that belongs with Phase 2).

### 4. Clamp the pools to the GPU
- `shadowLights` is clamped to `maxTextures - reservedMaterialUnits - 1` (the flashlight), measured from the heaviest standard material. WebGL 2 guarantees 16 units, and ANGLE on Windows usually reports exactly that.
- `fillLights` is clamped by `MAX_FRAGMENT_UNIFORM_VECTORS`.
- Both clamps log a warning.

### 5. SMAA, anisotropy, character shadows
- `SMAAPass` goes after `OutputPass` on Medium and High. Rejected: MSAA (the whole post chain would need multisampled targets) and FXAA (blurrier).
- Tier switches set texture `anisotropy` live.
- Humanoids read `characterShadowDistance` (15 m on Low and Medium, 40 m on High) instead of the fixed `LOD_DISTANCE`.

### 6. Budgets become reports; the floor is the gate
- The `slice01` draw-call tests keep logging but drop their `<= 60` and `<= 300` assertions.
- The gate is a measurement at High on the target PC, in the heaviest scenes (the R03 drop and the commons), with 1% lows of at least 30 fps.

### 7. Gallery follow-up
- R03's slots 0, 2, 3, 5 and 8 drop `pool: false`.
- Slots 1, 4, 6 and 7 set `shadow: true`.
- R03 then takes 9 pooled lights, which with Lab B's 3 fits the Medium and High pools.

## Phase 2: library route (spike, then its own change)

```
  r170 WebGL --(stepwise upgrade)--> current WebGL --(spike)--> WebGPU + ClusteredLighting
       |                                  |                          |
   Phase 1 here                 fixes PCFSoft/GTAO breaks      lights stop being a budget
                                          |
                                (spike fails) --> WebGL + pmndrs postprocessing + n8ao
```

1. **Upgrade Three.js on `WebGLRenderer` first, in steps.** It is needed either way, and the breaks are cheap to find there:
   - `PCFSoftShadowMap` is gone in r186, and `PCFShadowMap` is now soft
   - GTAO output changes (r181, r185, r186)
   - shadow bias needs retuning (r183)
2. **Spike `WebGPURenderer` with `ClusteredLighting`** on the R03 drop and the commons, behind a URL flag.

   Go/no-go checks:
   - frame time at High against the WebGL Phase 1 build
   - environment lighting (IBL) works with clustered lights
   - spot-light shadows coexist with clustered point lights
   - the WebGL 2 fallback backend renders correctly
   - every custom shader has a TSL port or a stand-in
3. **If go:** a new change ports the post chain to the TSL `RenderPipeline` (GTAO, bloom, grade, plus TRAA and SSGI nodes) and the custom shaders to TSL. The light-slot API (`render-lighting`) stays the boundary, so level data and game code do not change. The pools become clustered lights with the same slot semantics.
4. **If no-go:** stay on WebGL and swap `EffectComposer` for pmndrs `postprocessing` with `n8ao` and SMAA, keeping the Phase 1 pools.

## Phase 3: baked light (optional)

Lightmaps for static architecture, baked in Blender on GLB pieces as ADR-0003 already anticipates. Dynamic lights keep everything that flickers, moves or goes red. This is worth it after Phase 2, when the dynamic budget is no longer what limits the look.

## Risks / Trade-offs

- [32 fill lights at an uncapped pixel ratio cost GPU time on every lit pixel] → Measure in the commons and the R03 drop. If the floor fails, lower High in `RENDER_TIERS` and update the render-quality table before archiving.
- [Each shadow light redraws nearby characters] → `characterShadowDistance` bounds that. Option: skip a shadow update when nothing dynamic moved in its cone.
- [Removing draw-call caps lets content bloat unnoticed] → Tests still log the heaviest rooms, and the floor catches real regressions.
- [Phase 2 lands on a fast-moving API: WebGPU and TSL change every release] → Pin the version, keep the WebGL fallback building, and spike before committing.
- [Phase 2 rewrites every custom shader and the whole post chain] → The spike inventories them first; the go/no-go includes a TSL port or stand-in for each.

## Open Questions

- The exact Three.js release to target in Phase 2 is chosen when the spike starts.
