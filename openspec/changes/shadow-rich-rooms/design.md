# Design

## Context

See proposal.md for why. Current state, as of 07d0569:

- `ShadowPool` (`src/world/shadowPool.ts`) holds a fixed set of `SpotLight`s: 0 / 2 / 6 by tier, capped by `fitTierToGpu` in `src/render/tiers.ts` to the texture units left after the heaviest material and the flashlight. Each frame `Level.bindLights` collects the slots of the visible rooms. `assign` sorts the opted-in ones by `slotScore` (distance², minus a bonus for the current room) and binds the first N. Bound spots keep `shadow.autoUpdate = true`, so every bound spot redraws its map every frame. Unbound spots are paused with `pauseShadow`.
- Portal culling is frustum-clipped (`portal-frustum-culling`): rooms reachable only through off-screen portals are no longer visible, apart from the 1-hop light-bleed guard. Lights in the current room are still ranked without regard to view.
- three r187: soft `PCFShadowMap` with `shadow.radius`, `LightShadow.intensity` for fading, and `SpotLight.map` for projected patterns. The number of spot-light maps is part of the shader program key (`numSpotLightMaps`), as is the number of shadow lights. Changing either recompiles every lit material.
- Moving things that cast shadows: humanoids (skinned, and `castShadow` toggled by `characterShadowDistance`), doors, held props, gore chunks, and physics props (`adopt-physics-engine`, in flight). Kit pieces are merged per material (`kit/merge.ts`), including `pendant_light` shades.
- R03 has 4 opted-in lights (slots 1, 4, 6 and 7) and is the only room in `slice01` with any.

## Goals / Non-Goals

**Goals:**
- Spend the existing shadow budget on what is on screen, and keep it stable.
- Cut the per-frame cost of a shadow light that has nothing moving in reach to near zero, so the budget can be raised if measurement allows.
- Add shadow detail (sway, patterns, contact shadows) without changing shader programs during play.

**Non-Goals:**
- Packing several shadow maps into one atlas texture, which would lift the texture-unit ceiling (three does not support it; it would mean replacing the spot-shadow shader chunk).
- Splitting the shadow pass into a cached static map plus a dynamic overlay.
- Shadow-casting point lights (6 renders each).
- Raising `characterShadowDistance`. The contact shadow covers far characters instead.
- Authoring shadow lights for rooms other than R03. That belongs to per-room passes.

## Decisions

### D1. Rank by "lit area in view", then by room, then by distance

For each opted-in slot, the pool builds a bounding sphere of its cone (centred `range / 2` down the cone axis, with radius covering the cone's base and apex) and tests it against the camera frustum, which `Level.update` already builds for portal culling. Sort key: `(inView ? 0 : 1, isCurrentRoom ? 0 : 1, distance²)`. The fill pool keeps `slotScore` unchanged.

Testing the lit area, not the fixture's position, means a light behind the player whose pool of light lies ahead still ranks as in view (the spec's "Light behind the player that lights the view").

*Alternatives:* ranking by the fixture's screen position (wrong for lights behind the player that light the view); occlusion queries (asynchronous, add GPU readback, and portal culling already removes rooms behind walls).

### D2. Hysteresis: hold for 0.5 s

Each frame computes the ideal top-N. A bound slot that falls out of the ideal set starts a timer. It is released only after 0.5 s continuously out of the set, and then to the best unbound candidate. A bound slot is released at once (no hold) when its room stops being visible, its light goes out (power, pattern `off`), or the tier changes. The hold state lives on the slot binding, so it survives the pool being reassigned every frame.

### D2a. Unshadowed side views leave the player's allocation alone

Security camera feeds, and later room captures (`room-light-response`), draw through `Level.renderFromEye`, which binds lights with `shadows = false`. Today that calls `ShadowPool.assign([])`, which unbinds every spot. The player's next `update` binds them again.

Under D2 to D4 that would reset the holds, restart the fades, and count every spot as newly bound (so it redraws) on every frame a feed is drawn. Instead, an unshadowed bind calls `ShadowPool.suspend()`. It zeroes each spot's light intensity for that draw without touching bindings, holds, fades or redraw state, and gives none of the opted-in slots a spot. `resume()`, called at the start of the next shadowed bind, restores them.

### D3. Fade with `shadow.intensity`, out then in

On hand-over, the outgoing spot fades `shadow.intensity` from 1 to 0 over 0.2 s, keeping its slot and light intensity. The spot then rebinds to the new slot and fades from 0 to 1 over 0.2 s. Out-then-in needs no spare spot. The total stays within the spec's 0.6 s. While a spot is fading out, its new slot lights unshadowed from the fill pool, as an unbound opted-in slot does today.

*Alternative:* cross-fading on a reserved spare spot costs one spot permanently, which is a third of Medium's budget.

### D4. Cached shadow maps with a moving-caster registry

Every pool spot runs with `shadow.autoUpdate = false`. Each frame the pool sets `needsUpdate` for a bound spot only if:

1. it was bound or rebound this frame, or the tier or map size changed;
2. the light moved (sway, D6) or its pattern turned (fan, D7); or
3. a registered moving caster overlaps the spot's reach sphere and has moved or deformed since the spot's last redraw, or was inside at the last redraw and is now outside (one clearing redraw, so no ghost is left).

`Level` owns a `ShadowCasters` registry: entries are `{ object, bounds(): Sphere, version(): number }`, where `version` changes whenever the caster's shape or placement changes.

- Humanoids register on spawn and bump their version every animated frame while alive or settling. Skinned bodies deform even while standing. They unregister on dispose.
- Doors bump only while moving. Held props, gore chunks and physics props bump only while their transform changes (a matrix compare, or the physics engine's sleep state once `adopt-physics-engine` lands).
- A humanoid whose `castShadow` is off (beyond `characterShadowDistance`) does not count.

The flashlight keeps `autoUpdate = true`, because it moves with the camera.

The win depends on the room. Empty rooms and rooms with idle props redraw nothing. A lamp over a talking character still redraws every frame. The debug overlay (D9) shows the redraw count, so this can be measured.

*Alternative considered:* a static map cached once, plus a dynamic-only pass composited in the shader. It would make occupied rooms cheap too, but means replacing three's shadow chunk and doubling the texture units per light. It is out of scope (see Non-Goals).

### D5. Tier counts change only on measurement

Once D4 lands, measure R03 and the commons at High on the desktop PC with the overlay and a frame-time trace. If the 1% lows have headroom and `fitTierToGpu` allows, raise Medium and/or High, and add a `render-quality` delta for the tier table to this change before editing `tiers.ts`. Otherwise leave the counts as they are and record the measurement in this design.

### D6. Swaying pendants reuse the kit's slot swing, with a shared jolt

`overhaul-flooded-tunnel` landed a slot swing in the kit (`SlotSwing` in `kit/types.ts`): a piece gives a light slot a pivot, an amplitude and a period, and the piece and the level rotate their parts with the same time-based `swingAngle`, so the housing, the glow and the pooled light stay together. Sway builds on it rather than adding a second mechanism.

- `pendant_light` takes a `sway` parameter: `true` for the default 0.06 rad, or an amplitude in radians. Its period follows the cable (`2π√(drop / g)`). A swaying bulb's cable, caps and shade go into one pivot group that `PieceBuilder.dynamic` keeps out of the merge (about 3 extra draw calls per swaying lamp; the surface-dressing docs budget this). The slot carries the swing, so the level's glow and the pooled light follow it, and the shadow spot sees the slot move and redraws (D4).
- A `SlotSwing` may carry a `jolt`: a damped oscillator (angle, velocity, time) that `swingAngle` advances to the frame time and adds to the authored swing. The level copies the swing with a spread, so the piece and the level share one jolt object, and advancing it twice in a frame is a no-op.
- Jolts add angular velocity to every swing within reach: the player's shotgun shot within 3 m (scaled by distance), a hitscan shot whose ray passes within 0.3 m of a bulb, and a `lightJolt` sequence action for a room.

Sway runs on every tier. On Low the fill light and the shade move without a shadow.

### D7. Patterns: a fixed set of patterned spots and generated textures

Because `numSpotLightMaps` is in the program key, the first `cookieSpots` pool spots (Medium 1, High 2, Low 0) always carry a map. Without a pattern it is a 1×1 white texture, so the count never changes during play.

In D1, opted-in slots with a `cookie` are offered the patterned spots first, ranked by the same key. If a slot with a pattern doesn't get a patterned spot, it can still take a plain one and cast its shadow without the pattern. If a slot with no pattern takes a patterned spot, it gets the white map.

`fitTierToGpu` counts 2 texture units per patterned spot. It cuts the patterned spots before cutting shadow spots.

Patterns are generated at load into small single-channel textures (256², with mipmaps), in a new `src/render/cookies.ts`:
- `grille`: slats;
- `fan`: blades and hub;
- `cracked`: crack lines over a lens falloff;
- `lens`: the flashlight's hot spot, faint ring and smudges.

Generating them means no asset files, credits or downloads.

A fan turns by rotating the spot's shadow-camera `up` vector around the cone axis. The projection matrix that places the pattern comes from the shadow camera, and three only refreshes it when the shadow redraws, so a turning fan redraws every frame (D4, rule 2).

The flashlight carries the `lens` map on every tier, which adds one texture unit to the flashlight's existing reservation in `fitTierToGpu`.

### D8. Contact shadows: one instanced soft disc per character

Each frame, an `InstancedMesh` of soft radial-gradient quads (multiply blend, depth-tested, `depthWrite` off, no shadow casting, AO-excluded) places one disc under each visible standing, walking or seated humanoid:
- on the floor height under its hips (from the nav or collision floor query the movement code already uses);
- sized from its footprint (`footprintOf`);
- fading out with the body's height above the floor (jumping, falling, lying corpses).

Under a real shadow, D8 cannot read the shadow map, so the disc's strength scales down when the body is casting a real shadow and stands inside a bound shadow spot's reach. The result is only a soft contact edge, never a double-dark blob.

Walls and ceilings are never touched, because the disc lies flat on the floor.

*Alternatives:* screen-space contact shadows (another full-screen pass, and n8ao already darkens contact areas on High only); per-character projected decals (one draw call each, with no gain for a soft disc).

### D9. Debug overlay

A lil-gui toggle in the Level folder of the existing debug GUI (`session.ts`). Like `levelDebug`, it is a dynamic import, so it ships as its own chunk that the game fetches only with `?debug`. It shows:
- a wireframe cone per bound shadow spot (green while fully on, yellow while fading);
- a range sphere per bound fill light (blue);
- a red cross on claimed slots that got no light;
- a HUD line: shadow spots bound / redrawn this frame / patterned, fill lights bound / slots claimed, current room.

The redrawn count comes from counting `needsUpdate` set in D4.

## Risks / Trade-offs

- [A light swaps from a spot cone to a point fill when it loses its shadow, which changes its shape on walls above the fixture] → The cones are wide (60 to 75°) and point down, so the difference is mostly on the ceiling. If it shows in R03, fade the light's intensity across the swap, as for the shadow.
- [Skinned characters redraw every frame, so a crowded room gains little from caching] → Accepted. D5 measures before raising counts, and the overlay makes the cost visible.
- [A missed version bump leaves a stale shadow, such as a door frozen half-open in its shadow] → Each caster kind gets a test that moving it marks overlapping spots for redraw. Tier switches and rebinds always redraw.
- [Patterned spots take texture units from shadow spots on GPUs with few units] → `fitTierToGpu` drops patterned spots first and logs a warning, as it does for shadow spots.
- [Unmerged swaying lamps add draw calls] → Budgeted at about 3 calls each in the surface-dressing docs. Sway is opt-in per lamp.
- [`adopt-physics-engine` is in flight and will add physics props] → The registry interface is generic. That change, or a follow-up, registers its bodies. Until then, physics props are registered by transform compare.

## Migration Plan

All new level fields are optional, and existing data renders as before, apart from D1's view ranking and the fades. No save-format change. To roll back, revert the change. No data migration.

## Open Questions

- The exact contact-disc strength and size per character model. Tune in R03 with Heins and the squad, under High and Low.
- Whether D5's measurement justifies raising the shadow counts. **Answered (2026-11-22): no.** See Measurements below.

## Measurements (2026-11-22)

Desktop PC (AMD Radeon RX 7900 XTX, ANGLE/D3D11, 16 fragment texture units), Playwright Chromium at 1280×720, `?level=slice01&debug&slot=scratch&jump=r05`, tutorials off, the player placed in each view, 2 s warm-up, then 6 s sampled. The display is vsync-locked at 60 Hz, so "1% low" is capped at 60. "Cost" is the frame's own work: the game's animation-frame callback plus a `gl.finish()` wait, which gives an uncapped per-frame cost to set against the 33.3 ms of the 30 fps floor. The baseline is the shared checkout without this change (served on 5173). The other agents' processes were running, so allow about ±1 ms of noise.

| View | Baseline Medium avg / p99 (ms) | This change Medium | Baseline High | This change High |
| --- | --- | --- | --- | --- |
| R03 door | 5.2 / 8.3 | 4.6 / 9.7 | 8.1 / 13.1 | 5.3 / 7.7 |
| R03 sofa | 5.0 / 7.5 | 5.0 / 8.5 | 7.0 / 10.3 | 5.7 / 7.4 |
| R03 far end | 5.5 / 9.0 | 5.0 / 9.2 | 7.1 / 9.2 | 6.0 / 8.9 |
| R02 west | 5.0 / 8.1 | 4.7 / 6.3 | 7.3 / 11.6 | 6.7 / 11.8 |
| R02 east | 9.1 / 15.0 | 4.0 / 5.6 | 6.2 / 8.6 | 7.2 / 22.9 (one spike: 1% low 29.9) |

Findings:

- Every view stays well inside the floor's 33.3 ms. The single R02 east spike on High (one frame near 23 ms work, a dropped vsync frame) did not repeat in the baseline or on Medium. It is the one number to re-check in 10.2.
- Shadow-map redraws per frame in R03: 2 on Medium and 4 on High, every frame, all from things that really move: Heins is alive and idling on the stage, and the swaying lamp pair is bound. Caching saves nothing in R03 because R03 is always occupied. The Commons has no opted-in lights, so it shows nothing either way.
- Bodies and doors in neighbouring rooms behind walls (R02, R05) also count as inside a light's reach, since the reach is a sphere. A follow-up could skip casters in rooms that are not visible.
- **Texture units, not frame time, are the limit.** Since r187 every `MeshStandardMaterial` program also binds three's `dfgLUT`, which `materialTextureUnits` did not count. The heaviest materials (hull plates, lab decals) are therefore 8 units, not 7. With the flashlight's 2 (shadow and lens) and High's 6 shadow maps that is 16 of 16, so High keeps 6 shadow lights and **no patterned spot** on this GPU. Medium keeps its 1. Before the fix, High linked those materials at 17 units and their shaders failed validation. The count is fixed in `tiers.ts`.

Decision (D5): the tier counts stay as they are. Raising them is blocked by texture units on this GPU, not by frame time.

Decision (user, 2026-11-22): on a 16-unit GPU, High keeps all 6 shadow lights and drops its patterned spot; the cut order stays patterns first. Medium keeps its one. The alternatives were 5 shadow lights plus 1 pattern on High, or dropping the flashlight lens to free a unit on every tier.

Full suite (2026-11-22, task 10.1): typecheck and `npm run build` pass. `npm test`: 1473 pass, 11 fail. Ten of them fail the same way on a clean checkout of 0c7f9fe, the commit this branch starts from: the mug hold pose, the R03 slot count (HEAD now has 4 pendant slots), dock_guard's motion binding, Lab B cue loudness, the mocap bake check, the chair sit, two slice01 walk tests, scripted walks, and wall-mounted prop clearance. The eleventh ("profiles on today's clips") failed only in the concurrent full run and passes when its file runs alone. 10.1 stays open until HEAD's own failures are fixed.
