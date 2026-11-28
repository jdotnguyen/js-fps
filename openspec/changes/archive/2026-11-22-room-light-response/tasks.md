# Tasks

## 1. Baseline

- [x] 1.1 Record a baseline in the Commons, R03 and the Grow Hall at Medium and High: screenshots of the same steel, glass and character views; 1% lows; and memory under `?slot=scratch&memprobe`. Verify they are recorded in this design's Open Questions section.

## 2. Room captures (D1, D2, D4)

- [x] 2.1 Add the optional `atmosphere.capture` point to the level types and validation. Verify with a validation test that accepts a point inside the room's area and rejects one outside it.
- [x] 2.2 Build `RoomCaptures`: one face per frame via `renderFromEye`, a capture layer that hides characters, viewmodel, gore and particles, steady light patterns, then the PMREM filter on frame 7. Verify with a test, using a stub renderer, of the face-per-frame schedule and the layer mask.
- [x] 2.3 Add `lightingVersion` bumps (power, recolour, a light off or on) and the priority queue (current room, then portal neighbours). Verify with tests: an alarm bumps only the affected room; a flicker never bumps; a stale room far away is not queued.
- [x] 2.4 Add the 8-capture LRU that never evicts the current room or its neighbours, and dispose everything on level teardown. Verify with tests for eviction order, and with `npm test -- src/world/level*.test.ts` showing no leaked render targets after a restart.

## 3. Reflections hand-over (D3, D7)

- [x] 3.1 Point the station's `scene.environment` at the current room's capture, keeping the generic environment until the first capture and in the lab world and sandboxes. Verify with tests for the cold start and the lab world.
- [x] 3.2 Add the 0.5 s blend between filtered maps on a room change, holding the old environment until an uncaptured room's capture lands. Verify the blend schedule with a test, then playtest the spec's "Commons to corridor" (no flash or blank frame) with a short clip.
- [x] 3.3 Playtest the spec's "Steel in Hydroponics", "Gallery glass", "Alarm" and "Blackout" scenarios. Verify with screenshots against the 1.1 baseline.

## 4. Bounce light (D5)

- [x] 4.1 Add the level's single `LightProbe` at build time, with the asynchronous 16 px SH projection per capture. Verify with a unit test that the SH projection of a synthetic cube (warm +X, cool −X) gives a warm +X lobe, and that `renderer.info.programs` does not grow after the first frame.
- [x] 4.2 Normalise the probe to `w × preset.intensity`, scale the hemisphere to `(1 − w)`, and lerp on room change, using the active preset under backup power and recolours. Verify with a test that the combined ambient average is within ±10% of the preset.
- [x] 4.3 Playtest the spec's "Heins by the gallery lamps", and tune `w`. Verify with screenshots, and record `w` in the design.

## 5. Eye adaptation (D6)

- [x] 5.1 Add the luminance measurement and the two-stage adaptation pass (fast low-pass, then asymmetric about 3 s / 1 s), and apply `clamp(key / adapted, 0.7, 1.6)` in the grade before tone mapping. Verify with a test, on a stub luminance sequence, for the rise and fall times and the rejection of a 0.1 s flash.
- [x] 5.2 Add the "Eye adaptation" setting (default on) beside Film grain. Off forces a multiplier of 1.0 without rebuilding the chain. Verify with a settings test for the default and for old settings files, and with an existing `src/render/post.test.ts` case for the uniform.
- [x] 5.3 Calibrate `key` so the Commons and R03 at High sit at a multiplier of about 1.0. Playtest the spec's "Into a dark room", "Out into the light", "Firing in a dark room" and "Adaptation off". Verify with clips, and record `key` in the design.

## 6. Integration

- [x] 6.1 Measure the memory bound under memprobe for two full loops of the slice, and the 1% lows when entering uncaptured rooms at High. Verify memory does not grow on the second loop, record the bound in D4, and confirm the 1% lows stay at or above 30 fps.
- [x] 6.2 Run `npm run typecheck`, `npm test` and `npm run build`. Verify all pass. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.
- [x] 6.3 Run `openspec validate room-light-response --strict`. Verify it passes.

## Workflow follow-up

- Sync the `environment-lighting` and `post-processing` deltas, then archive the change after review.
