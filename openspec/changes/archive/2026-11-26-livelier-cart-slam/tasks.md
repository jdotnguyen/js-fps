# Tasks

## 1. Prerequisites

- [x] 1.1 Confirm `adopt-physics-engine`'s uncommitted work in `npcKills.ts`, `interaction.ts`, `kills.json`, `sounds.ts`, `level.ts` and `src/audio/impacts.ts` is committed, so this change builds on it; verify with `git status` that none of those files has someone else's pending edits
- [x] 1.2 Confirm `interact` is on by default (`adopt-physics-engine` task 6.7), with design D10's settings fix: `mergeSettings` starts physics from the defaults, and a saved settings object from before (`physics: { interact: false, ... }` with no version) loads with `interact` on. Verify with a `src/core/settings.test.ts` case for each. If 6.7 is still open, do the settings fix here and note it in that change's tasks

## 2. Cart collision and loose instruments

- [x] 2.1 Split `instrument_cart` (`src/world/kit/slice.ts`): drop the instruments and replace the solid box with tray, lip, shelf and post boxes (tray top at 0.9 m, shelf top at 0.29 m, open sides between shelf and tray) (design D2); verify with a kit test that the tray and shelf collision faces match the drawn surfaces within 2 mm
- [x] 2.2 Add the `cart_item` kit next to `lab_item` (`src/world/kit/labWing.ts`) with the types in design D1 (dish, forceps, scissors, pack, vial, bowl, box, basin), one merged part per material and collision boxes at least 1 cm thick; verify with a kit test that each type builds at most two materials
- [x] 2.3 Add `dish` to `PROP_SOUNDS` (`src/data/types/level.ts`) and its voicing to `src/audio/impacts.ts` (design D7: `metal` clink when soft, `dish_spin` from about 1.5 m/s, a rest of about 3 s); verify with `src/audio/impacts.test.ts` cases for the soft and hard picks
- [x] 2.4 Place the nine instruments in `slice01.json` R08, flush on the tray and shelf, with mass, `loose` and `sound` per design D1, in the group `r08_cart`; verify with a new `src/physics/r08.test.ts` (on the `labB.test.ts` pattern) that after 3 s of stepping nothing has moved, sunk, floated or jittered, and in the browser with `?physics=off` that the cart looks dressed
  - Accepted by the author on 2026-11-26 after playing it.
- [x] 2.5 Exempt loose props from the R08 stage and lane checks in `src/world/slice01.test.ts` (design D12; spec "The stage and the lane stay clear"); verify `npm test -- src/world/slice01.test.ts` passes

## 3. Kinematic cart and its jolt

- [x] 3.1 Add kinematic physics props (`"dynamic": { "kinematic": true }`) to the level schema, `Level` and `PhysicsProps`, with a method that moves one to a pose so the body, meshes and `CollisionWorld` boxes follow, with or without physics (design D3); verify with a physics test that a loose box resting on a kinematic slab slid 5 cm moves with it, and a test that with physics off the prop's collider moves
- [x] 3.2 Mark the R08 cart kinematic, and add the authored per-impact jolt to the `slam` event data (rock, lasting slide and yaw), with the slam target following the cart's top; verify with an `npcKills.test.ts` case that after three impacts the cart is skewed by at most 0.25 m at any corner and her head is above its top at the third impact (spec "The cart jolts on each slam")

## 4. Burst, rhythm and landing

- [x] 4.1 Add `PhysicsProps.burst` (design D4: 3D reach, outward and flattened, weighted along the cart's long axis, a share toward the pane, an upward share, off-centre, seeded spin) and pass it through `KillWorld`; verify with `src/physics/interaction.test.ts` cases for the spec's "Impact throws what is near" and "Stronger impact throws further"
- [x] 4.2 Add the optional `burst` and `windup` fields to `slam` events in `src/data/types/kills.ts` (validated: only on `slam`), fire the burst when that slam lands, and skip it for an instant kill; verify with a `killRun.test.ts` or `npcKills.test.ts` case that a skipped kill bursts nothing
- [x] 4.3 Retime the slam beat in `kills.json` (design D5) and set the three bursts' reach and strength (design D4 table); verify with an `npcKills.test.ts` case that the second gap is at least 0.3 s longer than the first (spec "The slams build in rhythm")
- [x] 4.4 Run the three bursts headlessly in `src/physics/r08.test.ts` and assert the spec's outcomes: some top items leave and one returns on hit 1, at least half of the top on the floor 1 s after hit 2, a shelf item on the floor 2 s after hit 3, at least one striking the centre pane or within 0.5 m of its foot, and none past the pane, a wall or the floor once at rest. Run the file alone (`npm test -- src/physics/r08.test.ts`)
- [x] 4.5 Add the `knock` to the `throw` beat (design D9); verify in the r08 test that no instrument rests within her body's footprint at `priya_rest`

## 5. Sounds

- [x] 5.1 Source `cart_slam` (3 variants), `cart_rattle` (2-3 variants) and `dish_spin` per `docs/audio-assets.md`: CC0 or CC BY recordings first, ElevenLabs via `scripts/gore-generate.ts` otherwise. Loudness-match them to the head crunches, register them in `src/audio/sounds.ts`, and add `CREDITS.md` rows for anything downloaded; verify by listening in the browser through the intercom
  - Accepted by the author on 2026-11-26 after playing it.
- [x] 5.2 Play `cart_slam` (variant `(n - 1) % 3`) and `cart_rattle` in `KillDirector.impact()` in place of `cart_impact` and `cart_glass_break`, adding the variant argument to `KillWorld.sfx` (design D6); verify with an `npcKills.test.ts` case that three impacts play three different steel variants and no glass break (spec "Each slam sounds different")
- [x] 5.3 Delete `cart-glass-break.mp3`, its `SAMPLE_URLS` entry, its `CREDITS.md` row and its mention in `gore-generate.ts`. Keep `cart_impact` only if it became a `cart_slam` variant, otherwise delete it the same way; verify `npm run audio:audit` passes
- [x] 5.4 Check the instrument landings in the browser: clinks for each material, the dish spinning down where it lands, all heard through the intercom with the player's back to the glass, and no clink dropped during hit 2 (raise the voice cap only if one is); record what was changed in design D7
  - Accepted by the author on 2026-11-26 after playing it.

## 6. View jolt and skip layout

- [x] 6.1 On `kill:impact`, when the player is in R07, call `player.addKick` with a small dip that grows with the hit (design D8); verify with a session or player test that his position and control are unchanged, and in the browser with reduced motion on and off
  - Accepted by the author on 2026-11-26 after playing it.
- [x] 6.2 Add the `layout` kill event and `"after"` poses on props (level schema, `Level`, `PhysicsProps.place`: set the transform, zero the velocities, sleep) (design D11). The placement must not report impacts, so a restored kill stays silent. Verify with a physics test that placed props are at their poses, asleep and silent, and with physics off that their meshes are there
- [x] 6.3 Record the `after` poses from a headless run of the bursts, check by hand that none lies under `priya_rest` or past the pane, and write them into `slice01.json` with the cart's end-of-jolt pose; add `layout` to the slam beat. Verify with `src/script/action.test.ts` cases for the spec's "Skipped mid-slam", "Restore after R08" and "Restore before the attack" scenarios
  - Verified in `src/ai/npcKills.test.ts` (a skipped kill lays out `r08_cart`, throws and moves nothing), `src/physics/r08.test.ts` (the layout, still and silent, with and without physics) and in the browser (`jump=r09`, physics on and `?physics=off`: every prop at its `after` pose). The existing `action.test.ts` restore cases already check the instant mauled kill that runs it; no new case was added there, since its host mocks the kill.
- [x] 6.4 Update `docs/physics.md` (burst, kinematic props, `layout`) and the R08 lines of `docs/PLAYTEST.md`; verify the documented URL flags and keys work as written

## 7. Integration

- [x] 7.1 Play the R07/R08 scene in the browser from `cp_cover_done` with default settings, then with settings saved before the default changed, then with `?physics=off`, from the viewing strip and from the far corner. Confirm every `medbay-attack` scenario this change adds or modifies, and that nothing logs an error. Record the R08 draw calls and physics step time against the budgets in `docs/physics.md`
  - Accepted by the author on 2026-11-26 after playing it.
  - Done so far: one live run from `jump=r07` (default settings): the three slams threw every instrument to the floor, the cart ended at its authored pose, no console errors and every new sound decoded. Left: watching it close up, listening (5.1, 5.4), the old-settings and `?physics=off` runs, and draw calls and step time.
- [x] 7.2 Skip the scene during the slam beat, and restore a checkpoint after it, with physics on and off; confirm the scattered layout, the skewed cart and silence on load. Run the files touched by this change, then `npm test` once and `npm run build`
  - Accepted by the author on 2026-11-26 after playing it.
  - Done so far: restore after the scene in the browser, physics on and off (layout correct, no errors). `npm run build` passes. `npm test`: 2102 of 2120 pass after fixing the two tests this change broke (`trolley.test.ts`, `labB.test.ts`); the other 16 failures are outside R08 (other work in the checkout). Left: skip during the slam beat in the browser.

## Workflow follow-up

- Archive after `adopt-physics-engine`, whose `physical-interaction` capability this change's delta adds to.
