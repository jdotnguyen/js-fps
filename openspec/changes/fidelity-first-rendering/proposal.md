# Proposal

> **Status: parked, future plan.** Not scheduled. `refresh-observation-gallery` ships first, within today's budgets. This change records how the game gets to "real fidelity" on the developer's desktop PC, in phases, and which libraries it may import to get there.

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
- **Fill-light pool sized per tier** (Low 8, Medium 16, High 32), fixed per tier so shaders compile once per tier switch.
- **New shadow-light pool sized per tier** (Low 0, Medium 2, High 6, plus the flashlight on every tier).
  - Room lights opt in with `shadow: true` and cast as downward spot lights.
  - High is bounded by the GPU's texture-unit limit, which is a real hardware ceiling.
- **SMAA** on Medium and High (today there is none at any tier). High drops its pixel-ratio cap and uses maximum anisotropy.
- **BREAKING (process):** fixed draw-call and triangle caps stop failing tests and become reported metrics. The gate is the 30 fps floor at High on the target PC.
- **Gallery follow-up:** R03's glow-only fixtures become pooled, and the two lamps plus the two centre ceiling lights cast shadows.

**Phase 2: many lights and modern effects through a library (spike first, then its own change)**

- Upgrade Three.js from r170 to current in steps, staying on `WebGLRenderer`. Known breaks along the way: `PCFSoftShadowMap` is removed (r186), GTAO output changes, and shadow bias needs retuning.
- Spike `WebGPURenderer` with the `ClusteredLighting` addon (Forward+ clustered shading, built into Three.js addons). It evaluates only the lights that reach each pixel, which removes the light count as a design limit.
- If the spike passes, migrate:
  - the post chain to the TSL `RenderPipeline`: GTAO, bloom and the colour grade, plus the SSGI and TRAA nodes
  - custom shaders to TSL
- **Fallback if the WebGPU spike fails:** stay on WebGL. Swap the post chain to `postprocessing` (pmndrs, one merged effect pass) with `n8ao` for ambient occlusion and its SMAA effect.

**Phase 3: baked light for static rooms (optional, own change)**

- Lightmaps baked in Blender for static architecture, the swap-in path ADR-0003 already anticipates. Dynamic lights stay for anything that flickers, moves or goes red.

## Capabilities

### New Capabilities
- `render-quality`: what each quality tier controls and the frame-rate floor that gates rendering changes.

### Modified Capabilities
- `render-lighting`: adds tier-sized fill-light and shadow-light pools and shadow opt-in for room lights. The capability is introduced by `refresh-observation-gallery`. If this change archives first, its delta creates the capability instead.

## Impact

- **Phase 1 code:**
  - `src/world/lightPool.ts`
  - `src/world/level.ts`
  - `src/render/renderer.ts`, `src/render/post.ts`, `src/render/lights.ts`, `src/render/flashlight.ts`
  - a new `src/render/tiers.ts`
  - `src/actors/humanoid.ts`
  - `src/main.ts`
  - `src/data/types/level.ts`
- **Phase 1 tests:** the `slice01` draw-call assertions become reports; new tests for tier budgets and shadow-pool assignment.
- **Docs:** none; the `render-lighting` and `render-quality` specs hold these rules.
- **Phase 2 dependencies:**
  - a newer `three` (with `three/webgpu` and addons)
  - or, on the WebGL fallback, `postprocessing` and `n8ao`
- **Phase 2 risk:** a renderer swap touches every custom shader and the whole post chain.
- **Not used:** `realism-effects`. It is unmaintained and reported incompatible with current Three.js; the built-in TSL SSGI/TRAA nodes cover the same ground.
- **Performance:** every phase is measured against the 30 fps floor at High in the heaviest scenes (the R03 drop, the commons).
