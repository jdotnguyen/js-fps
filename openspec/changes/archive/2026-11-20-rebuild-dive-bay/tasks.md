# Tasks

## 1. Baseline and level groundwork

- [x] 1.1 Before any edit, copy the current `src/data/levels/slice01.json` to a scratch location outside the repo, and record R13a–e draw calls from the level debug overlay plus screenshots from each R13 doorway at eye height, with and without `?nopost`. Verify the scratch copy and the screenshots exist and the counts are noted in this file.
- [x] 1.2 Add a `floorMaterial` room option to `scripts/gen-slice01.mjs`, mirroring `wallMaterial` (it sets `params.material` on that room's floor tiles). Verify that regenerating with no room using it gives a JSON identical to the baseline.
- [x] 1.3 Replace `AREA_PALETTES.dive_bay` in `src/world/kit/palettes.ts` with the clean palette in design.md §3. Give R13d `wallMaterial: 'rustBlotch'`, `ceilingMaterial: 'paintDark'` and `floorMaterial: 'diamondRusty'`. Update `palettes.test.ts` (rusty areas become `['tunnel']`), and add a test that R13d's tiles carry the rust overrides while R13a, R13b, R13c and R13e tiles use no rust slot. Verify `npm test` passes.
- [x] 1.4 Change the `DIVE` atmosphere to fog 0.015, make R13b's lights neutral work lights with the flicker slot steady, set R13b's ambience to `launch_bay` (it falls back to `hull_hum` until group 7 lands), and rename R13a, R13c and R13e to Wet Vestibule, ROV Workshop and Sample Store. Leave R13d's atmosphere and light as they are. Verify by regenerating: the diff against the baseline JSON touches only R13a–e entries, and `slice01.test.ts` passes.
- [x] 1.5 Update the R13 rows in ADR-0014 ("map as built") and ADR-0023 (dive bay hub) to the new room names and roles, with a pointer to `openspec/specs/dive-bay`. Verify the docs mention no dive-suit room and no open pool.

## 2. Launch trunk

- [x] 2.1 Rewrite `floor_moonpool` in `src/world/kit/slice.ts` as the trunk in design.md §2: coaming ring, hinged inner hatch with viewport and rams, `hullPlate` shaft with depth marks, outer hatch viewport glow, standing water at −2.85 m, and the rail with a modelled-shut east gate. The rail is the only collider; the hatch has none, because colliders are static. Add kit tests for: no water mesh above −2 m, rail colliders closed on all four sides, and no collider over the shaft opening. Verify `npm test` passes.
- [x] 2.2 Make the trunk piece listen for `trunk:state` (`open` | `closed`) and animate the hatch over about 4 s, snapping without animation when the event is flagged as a restore. Verify with a kit test that the hatch ends at the right angle for each state, and that a restore event jumps straight to it.
- [x] 2.3 Add the closed trunk skirt and outer hatch plate under the hull for `pool` cells in `src/world/kit/exteriorHull.ts`. Verify with a hull test that the pool cell's bottom has no open hole, and check from an exterior window in the browser that nothing looks open.

## 3. R13b equipment

- [x] 3.1 Add the props `gantry_crane` (ceiling runway beams, bridge, trolley, hoist and hook), `rov` (frame, yellow float block, arm, lamps, core basket) with `rov_cradle`, `tether_winch`, `wet_bench`, `core_rack`, `eyewash_station` and `shadow_board`, using flat colours and the glow material wherever possible. Verify with kit tests that each builds, and that the gantry adds no floor colliders.
- [x] 3.2 Add `pilot_console`: a three-screen bank on one canvas showing a sonar sweep, telemetry with 302 BAR, tether length and trunk state. It redraws at a few Hz and on `trunk:state`. Add a `whiteboard` prop with the dive-log text. Verify with a test that `trunk:state closed` changes the trunk text to "TRUNK SECURED", and that the console costs one screen draw call.
- [x] 3.3 Re-dress R13b in the generator to the layout in design.md §5. Remove the suit rack, the old console and most crates. Keep `moon_pool`, `cp_round_dive`, `diver_1_spot` and `dive_case_pickup` fixed, and keep `diver_1` and `maint_1` within 0.5 m of their current spots. Verify the critical-path walk in `slice01.test.ts` still reaches `cp_round_dive`, a two-capsule walk from the R13a door to the R13e door does not stall, and R13b reports 60 draw calls or fewer.
- [x] 3.4 Update `slice01JumpTops.test.ts` for the new R13b tops. Verify `npm test` passes.

## 4. R13a, R13c, R13e and R13d

- [x] 4.1 Add props `boot_wash`, `coverall_hooks` and `drain_grate`, and dress R13a, replacing the DIVE locker and keeping the x 24 centreline clear for `dive_entry` and `priya_start`. Verify the intro's Priya start still validates in `intro.test.ts`, and R13a stays within 60 calls.
- [x] 4.2 Add props `workbench` (with a spare thruster and arm), `battery_charger`, `parts_bins`, `gas_cylinder_rack` and `hose_reel`, and dress R13c, removing both suit racks and the locker. Verify that no `dive_suit_rack` is placed in slice01, and R13c stays within 60 calls.
- [x] 4.3 Add props `cold_store` (the stow unit with a custody terminal, marked LAB B), `core_fridge`, `freezer` (with frost), `pressure_cabinet` ("HOLD AT 302 BAR") and `survival_suits`, and dress R13e with the stow unit at `dive_case_locker`. Keep the radio, `diver_2` and the `round:dive_case` and `trigger:dive_lockers_enter` triggers. Verify `slice01.test.ts` walks to `dive_case_locker` and the round completes in the quiet-half test.
- [x] 4.4 In R13d, add pipe labels and the leak point (steam quad and the `trigger:dive_leak` box). Leave its light, fog and `area:dark` trigger as they are. Verify the dark-area test still passes and the flashlight prompt fires in the browser.

## 5. Signage and wear

- [x] 5.1 Build one sign atlas per room (room plate, life-support panel, stencils) and the pipe label strips for R13b and R13d, using `stencilDecal` and `paintedDecal`. Verify each room adds one sign draw call (two for R13b and R13d with labels), and the R13b plate reads "R13B · LAUNCH TRUNK 1".
- [ ] 5.2 Place wear decals by rule: wet sheen and puddles around the trunk and under the ROV, drip stains under the gantry hook, and salt rings at drains, 4–8 per clean room. Verify the counts are inside the surface-dressing budget and the checkerboard pass (`?checker`) shows no stretched squares on the new pieces. **Dropped 2026-11-27, not built:** puddles and salt rings are placed, drip stains are not. The product was accepted as it is.

## 6. Effects

- [x] 6.1 Add the upward trunk shaft with `createShaft`, the caustics plane (an additive cell-noise shader fading with distance and off while the hatch is closed), and the two mist planes inside the shaft. Verify with a test that the caustics uniform drops to 0 on `trunk:state closed`, and check in the browser that the trunk is the only strongly blue part of R13b. **Closed 2026-11-27:** found in the code or data; any check it asks for has no recorded run.
- [x] 6.2 Add ROV drips (12 falling points and a ripple ring decal) and the gantry beacon (rotating cone and fixture material, a steady glow under `reducedFlashing`). Verify with a test that the beacon does not rotate with `reducedFlashing` on, and that R13b stays within 60 calls.

## 7. Audio

- [x] 7.1 Add the six manifest entries in design.md §8 to `scripts/ambience-generate.ts`, then generate each with `npm run ambience:generate -- --id <id>` using the ElevenLabs key from `.env` (never printed or committed). Listen to each clip, and regenerate with `--force` and an adjusted prompt until it loops cleanly (bed) or reads clearly (one-shots). Verify the files exist in `public/assets/audio/ambience/`.
- [x] 7.2 Register the clips in `SAMPLE_URLS` with the fallbacks in design.md §8, and add the `launch_bay` preset to `src/audio/ambience.ts`. Verify with an ambience test that `launch_bay` resolves and an unknown name still gives `hull_hum`, and that `npm run audio:audit` passes.
- [x] 7.3 Add the `dive_leak` sequence (`trigger:dive_leak` → `sfx leakHiss` at the leak anchor, 20 s cooldown). Verify with a headless sequence test that two entries within 20 s play the hiss once.

## 8. Trunk secure event

- [x] 8.1 Append `emit trunk:secure` as the last step of `dive_moment` in `rounds.json` without changing its other steps, and add the `dive_trunk_secure` sequence from design.md §7, setting `dive_trunk_secured`. Verify with a headless test that the event starts only after `dive_sung_02` and `dive_maint_01` have ended, plays the chirp, hatch and vent sounds at `anchor:moon_pool`, emits `trunk:state closed` and sets the flag.
- [x] 8.2 Restore the secured trunk on load: in the quiet-half restore, emit a restore-flagged `trunk:state closed` when `dive_trunk_secured` is set. Verify with headless tests that a load after the event shows the hatch closed without replaying it, and that entering before the briefing leaves the trunk open.

## 9. Integration check

- [x] 9.1 Play a new game in the browser from the Commons through the dive bay round: case pickup, the secure event, stowing in R13e and the dark corridor. Take the surface-dressing definition-of-done screenshots from every R13 doorway, with and without `?nopost`, and compare them with the 1.1 baseline. Verify `npm test`, `npm run typecheck` and `npm run build` pass, that the final JSON diff against the baseline touches only R13a–e, and note the draw calls per room in this file. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.

## Notes

- **Baseline (1.1, before any edit):**
  - Draw calls per room (headless `roomStats`): R13a 16, R13b 37, R13c 17, R13d 15, R13e 16.
  - Most visible from the room's first anchor: R13a 164, R13b 95, R13c 33, R13d 119, R13e 32.
  - The JSON copy is kept outside the repo, in the session scratch folder.
  - Screenshots were taken in the browser from the R13a entry, the R13b north and east doors, R13c, R13e and R13d.
  - What the baseline shows: rust-blotch walls in every room, dark cyan haze, the pool reads as a tiled pit, and R13e holds AIRLOCK lockers.

- **2.3:** No window in slice01 looks under the hull, so the skirt is checked by the grid hull test (raycasts from below and the side), not by eye.
- **Palette fix (1.3, found in the browser):** `servicePaint` is a peeling-rust photo, so the walls use `cleanSlate` with a `boltPanel` upper band instead. `boltPanel` as the main wall read almost black in the browser.

- **3.4:** `slice01JumpTops.test.ts` prints a review list and stores no expectations, so it needed no edit. R13b now lists the pilot desk (0.78 m), the wet bench edge (0.93 m, 33% headroom under the shelf), the pipe run and a crate. The bay has no fight, so these are acceptable.

- **Group 4:**
  - R13a reuses the existing `boot_wash_mat` as its drain grate; no separate `drain_grate` prop.
  - A new slice01 test checks that the R13 props stay inside their rooms, don't overlap, and leave the NPCs clear.
  - Another new test checks the room roles: no dive-suit racks, the cold store at the stow point, the leak and its trigger.
  - The flashlight prompt in R13d is left for the 9.1 browser pass. The `area:dark` trigger itself is unchanged and still tested.

- **Group 6:** The caustics strip on the gantry beam was dropped. The ceiling plane covers the area over the trunk, and R13b is at 58 of 60 draw calls. The beacon reads the reduced-flashing setting through `render/flashing.ts`, which `Level.update` sets every frame.

- **Audio (7.1):** All six clips were generated via ElevenLabs into `public/assets/audio/ambience/` (`bed-launch-bay.mp3`, `oneshot-winch-clunk.mp3`, `oneshot-trunk-chirp.mp3`, `oneshot-trunk-hatch.mp3`, `oneshot-trunk-vent.mp3`, `oneshot-leak-hiss.mp3`). Each clip was listened to and `bed-launch-bay.mp3` was verified at its loop seam; `winchClunk` was refined and regenerated with `--force` so it reads as a heavy hoist lock clunk and cable creak rather than rapid clicking.
  - New sample names are sample-only, like the dock's `archPass`. There are no procedural twins, so the per-name fallbacks in design.md §8 apply only where a preset bed names a fallback.
- **Trunk event (8.1):** `dive_trunk_secured` is set as soon as the hatch is told to close, so a save taken mid-event still restores a closed trunk.

## Workflow follow-up

- Sync the delta specs into `openspec/specs/` (`dive-bay` new; `surface-textures` and `in-world-audio` modified) and archive the change after the integration check.
- If `dock-security-checkpoint` lands first, rebase the generator edits and regenerate before 9.1.
