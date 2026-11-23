# Tasks

## 1. Baseline

- [x] 1.1 Record a baseline in R03 and the commons at Medium and High on the desktop PC: 1% lows, frame time, bound shadow spots, and screenshots from the door, the sofa and the far end. Open the game with `?slot=scratch&memprobe`. Verify the numbers and shots are recorded in this design's Open Questions section.

## 2. Debug overlay (D9)

- [x] 2.1 Add the lighting overlay to the debug GUI: shadow cones, fill ranges, unlit-slot markers and the HUD line. Verify it shows R03's 4 opted-in slots and the correct bound count on Medium and High, and that in `npm run build` its code is only in its own lazily loaded chunk, which the game fetches only with `?debug` (as `levelDebug` is).

## 3. View-aware allocation, hold and fades (D1-D3)

- [x] 3.1 Rank opted-in slots by lit-area-in-view, then current room, then distance, using the frustum `Level.update` already builds. Verify with new `src/world/shadowPool.test.ts` cases for the spec's "Light behind the player" and "Light behind the player that lights the view" scenarios.
- [x] 3.2 Add the 0.5 s hold with immediate release on room culled, light out or tier switch. Verify with tests for "Walking between two lamps" (one hand-over), "A quick glance" (no swap), and immediate release on blackout.
- [x] 3.3 Fade `shadow.intensity` out then in on hand-over (0.2 s each). Verify with a test stepping time through a hand-over: intensity never jumps by more than one frame's share, and the hand-over completes within 0.6 s.
- [x] 3.4 Make unshadowed side views (camera feeds, captures) suspend the pool instead of unbinding it (D2a). Verify with a test: a feed bind every frame causes no hand-overs, no fade restarts and no extra redraws, and spots are dark during the feed's draw.
- [x] 3.5 Update the spec's "Shadow pool full" and "Shadowed lamp" coverage in the existing shadow-pool tests. Verify `npm test -- src/world/shadowPool.test.ts` passes.

## 4. Cached shadow maps (D4)

- [x] 4.1 Add the `ShadowCasters` registry to `Level`, and redraw rules 1 to 3 in `ShadowPool`, with every pool spot on `autoUpdate = false`. Verify with tests: an idle room redraws nothing after the first frame; a caster moving in reach redraws; a caster leaving gets one clearing redraw.
- [x] 4.2 Register humanoids (version bump while animating; skipped while `castShadow` is off), and unregister on dispose. Verify with a test, and check `npm test -- src/world/level*.test.ts` for leaks of registry entries after a restart.
- [x] 4.3 Register doors (bump while moving), held props, gore chunks and dynamic props (transform compare). Verify each with a test that moving it marks only overlapping spots.
- [ ] 4.4 Playtest R03: Heins walks under a lamp and out with no ghost shadow; a door opening under a shadow light; the overlay's redraw count drops to 0 with the room empty. Verify with screenshots.

## 5. Measure and decide counts (D5)

- [x] 5.1 Re-measure as in 1.1 with caching on. If there is headroom within the floor and `fitTierToGpu`, add a `render-quality` delta raising the counts, then update `tiers.ts` and `src/render/tiers.test.ts`. Otherwise record "unchanged" with the numbers. Verify the decision and numbers are recorded in this design.

## 6. Swaying lights (D6)

- [x] 6.1 Add the `sway` parameter to `pendant_light` (`true` or an amplitude) and an optional shared `jolt` to `SlotSwing`. Verify with kit tests that a swaying lamp offers a swinging slot whose pivot is the cable mount, that `sway` absent leaves the lamp merged and still, and that advancing a jolt twice at one time changes nothing.
- [x] 6.2 Build a swaying bulb's cable, caps and shade as one unmerged pivot that the piece ticks with `swingAngle`, the jolt included. Verify with a level test that the slot, the glow and the shade move together, and that the shadow spot on it redraws while it swings.
- [x] 6.3 Add jolts from a shotgun shot within 3 m, a hitscan ray passing within 0.3 m of a bulb, and a `lightJolt` sequence action. Verify with tests for each source, and that the swing settles back to the authored amplitude.
- [ ] 6.4 Author a swaying lamp over R03's sofa in `slice01.json`. Playtest: the sofa's shadow swings on High; the shade and its light swing together on Low; a shotgun shot nearby makes it swing harder. Verify with screenshots or a short clip.

## 7. Light patterns (D7)

- [x] 7.1 Generate the `grille`, `fan`, `cracked` and `lens` patterns in `src/render/cookies.ts`. Verify with a unit test of size, mipmaps and non-uniform content.
- [x] 7.2 Give the first `cookieSpots` pool spots a fixed map (white when unpatterned), rank patterned slots onto them first, and count 2 units per patterned spot in `fitTierToGpu`. Verify with tests for "Two patterned lights on Medium", "Patterned light misses the pool", and the GPU-limit cut order. Verify no material recompiles when patterns move between spots: the number of spot maps (part of three's program key) stays constant across hand-overs in a unit test; `renderer.info.programs` is checked in the browser in 7.5.
- [x] 7.3 Turn the fan pattern by rotating the shadow camera's `up`, marking the spot moved. Verify the overlay shows that spot redrawing each frame, and only that spot.
- [ ] 7.4 Add the `lens` pattern to the flashlight on every tier. Verify the spec's "Beam on a flat wall" and "Low tier" scenarios in a playtest screenshot.
- [ ] 7.5 Author one patterned light in R03 (a grille or a fan). Verify in a playtest screenshot on Medium and High, and that `renderer.info.programs` does not grow across a shadow hand-over.

## 8. Contact shadows (D8)

- [x] 8.1 Add the instanced contact-shadow discs: floor height under the hips, sized from the footprint, fading with height, and weakened under a real shadow. Verify with tests for placement, the height fade, and the weakening rule.
- [ ] 8.2 Playtest the spec's "Far end of the gallery", "Low tier" and "Under a shadow light" scenarios with Heins and the squad. Verify with screenshots, and tune the strength and size (the Open Question).

## 9. Docs

- [x] 9.1 Add a "Shadow lights, sway and patterns" section to `docs/surface-dressing-standard.md`: when to opt a light in, the in-view ranking, the cost of `sway` (about 3 draw calls) and the `cookie` options. Verify the section names every new level field and its values.

## 10. Integration

- [ ] 10.1 Run `npm run typecheck`, `npm test` and `npm run build`. Verify all pass.
- [ ] 10.2 Final check against the `render-quality` floor in the heaviest scene at High, plus a memprobe run. Verify the 1% lows are at or above 30 fps with no memory growth, and record the result.
- [x] 10.3 Run `openspec validate shadow-rich-rooms --strict`. Verify it passes.

## Workflow follow-up

- Sync the `render-lighting` and `player-flashlight` deltas (and any `render-quality` delta from 5.1), then archive the change after review.
