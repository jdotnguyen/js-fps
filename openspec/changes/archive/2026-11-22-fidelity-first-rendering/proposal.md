# Proposal

> **Status: ready to implement (Phase 1).** `refresh-observation-gallery` is archived (2026-11-20). This change records how the game gets to "real fidelity" on the developer's desktop PC, in phases, and which libraries it may import to get there. Only Phase 1 is implemented here; Phases 2 and 3 are their own changes.

## Why

The renderer still runs on budgets sized for a much smaller machine:

- 8 pooled fill lights and only the flashlight casting shadows
- a 1.5 pixel-ratio cap on High and no anti-aliasing
- tests that fail above fixed draw-call and triangle counts

None of these are Three.js limits, and they force compromises in content. In the observation gallery, for example, most fixtures are glow-only so Lab B keeps its lights through the glass. The project now targets fidelity on a desktop PC, with 30 fps (1% lows) as the only hard floor, and is open to importing libraries.

## What Changes

**Phase 1: fidelity-first budgets on today's renderer (specified here)**

- **Quality tiers own every rendering budget.** Low, Medium and High each set:
  - the fill-light and shadow-light pool sizes and shadow-map resolution
  - the pixel-ratio cap
  - anti-aliasing and ambient occlusion
  - texture anisotropy
  - how far characters cast shadows

  High is tuned for the developer's desktop PC; Low stays close to today.
- **Fill-light pool sized per tier** (Low 12, Medium 16, High 32), fixed per tier so shaders compile once per tier switch. Low's 12 lets R03 and Lab B stay lit together after the gallery follow-up and matches the lab world's pool today. The lab world sizes its pool from the tier too.
- **New shadow-light pool sized per tier** (Low 0, Medium 2, High 6, plus the flashlight on every tier).
  - Room lights opt in with `shadow: true` and cast as downward spot lights.
  - High is bounded by the GPU's texture-unit limit, which is a real hardware ceiling.
- **SMAA** on Medium and High (today there is none at any tier). High drops its pixel-ratio cap and uses maximum anisotropy.
- **BREAKING (process):** fixed draw-call and triangle caps stop failing tests and become reported metrics. The gate is the 30 fps floor at High on the target PC. The `dive-bay`, `dock-checkpoint` and `imported-props` specs, which state those caps today, are modified to match.
- **Gallery follow-up:** R03's glow-only fixtures become pooled, and the two lamps plus the two centre ceiling lights cast shadows.

**Phase 2: modern post-processing on WebGL (its own change)**

- Upgrade Three.js from r170 to current in steps, staying on `WebGLRenderer`. Known breaks along the way: GTAO output changes and shadow bias needs retuning. The design's claim that `PCFSoftShadowMap` is removed in r186 is unconfirmed and is checked during the upgrade.
- **Chosen route:** swap the post chain from `EffectComposer` to `postprocessing` (pmndrs, one merged effect pass) with `n8ao` for ambient occlusion and its SMAA effect. The colour grade becomes one of its effects. Phase 1's light pools stay.
- **Deferred:** `WebGPURenderer` with the `ClusteredLighting` addon (Forward+), the TSL `RenderPipeline`, and its SSGI and TRAA nodes. They remove the light count as a limit, but every custom shader (17 shader materials and 5 `onBeforeCompile` hooks today) and the whole post chain would have to be rewritten in TSL, on an API that still changes every release. Revisit only if Phase 1 pools plus Phase 3 lightmaps still leave the light count limiting the look.

**Phase 3: baked light for static rooms (optional, own change)**

- Lightmaps baked in Blender for static architecture, the swap-in path ADR-0003 already anticipates. Dynamic lights stay for anything that flickers, moves or goes red.

## Capabilities

### New Capabilities
- `render-quality`: what each quality tier controls and the frame-rate floor that gates rendering changes.

### Modified Capabilities
- `render-lighting`: adds tier-sized fill-light and shadow-light pools (in every world, the lab world included) and shadow opt-in for room lights.
- `dive-bay`: the R13 draw-call budget becomes a reported count; the clearance rule is unchanged.
- `dock-checkpoint`: R01's 60-per-room budget scenario becomes a reported count; the screen bank still costs at most two draw calls.
- `imported-props`: prop costs feed the reported per-room counts instead of pass/fail budgets.

## Impact

- **Phase 1 code:**
  - `src/world/lightPool.ts`
  - `src/world/level.ts`, `src/world/labWorld.ts`
  - `src/render/materials.ts`, `src/render/textures.ts`, `src/render/decals.ts`, `src/render/screens.ts`, `src/render/gltf.ts` (anisotropy)
  - `src/render/renderer.ts`, `src/render/post.ts`, `src/render/lights.ts`, `src/render/flashlight.ts`
  - a new `src/render/tiers.ts`
  - `src/actors/humanoid.ts`
  - `src/main.ts`
  - `src/data/types/level.ts`
- **Phase 1 tests:** the `slice01` draw-call assertions become reports; new tests for tier budgets and shadow-pool assignment.
- **Docs:** none; the `render-lighting` and `render-quality` specs hold these rules. Code comments that cite "ADR-0002" for the 8-light pool and pixel-ratio caps (no ADR file exists in the repo) point to these specs instead.
- **Phase 2 dependencies:** a newer `three`, `postprocessing` and `n8ao`.
- **Phase 2 risk:** pmndrs `postprocessing` is WebGL only, so this work would be redone if WebGPU is adopted later, and the library plans a breaking v7 that replaces its `EffectComposer`. Pin the version.
- **Not used:** `realism-effects`. Its latest release (1.1.2) is reported incompatible with current Three.js, and its announced version 2 is unreleased.
- **Optional, not adopted:** `three-custom-shader-material`, as a cleaner way to extend standard materials than `onBeforeCompile`. Use it for new material effects; existing hooks are not migrated.
- **Performance:** every phase is measured against the 30 fps floor at High in the heaviest scenes (the R03 drop, the commons).
