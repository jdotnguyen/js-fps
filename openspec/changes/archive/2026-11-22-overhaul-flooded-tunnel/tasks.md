# Tasks

## 1. Sunken floors and the porthole door (level-kit)

- [x] 1.1 Add `floorY` to the room schema in `src/data/types/level.ts` and build floor tiles at it. Verify with a kit test that a room with `floorY: -1.2` has its floor colliders at -1.2.
- [x] 1.2 Extend wall tiles and their finishes from `floorY` to the ceiling, with no seam at deck level. Verify with a kit test (wall colliders span -1.2..H) and a screenshot of a sunken test room.
- [x] 1.3 Add the `floor_landing` piece and confirm `stairs` with `rise: 1.2` builds five 0.24 m steps. Verify `src/world/collision.test.ts` covers the motor climbing and descending them.
- [x] 1.4 Add loader validation that fails a spawn, anchor, pickup or prop more than 0.05 m off the walkable surface below it. Verify with a test that a `y = 0` anchor over a sunken floor is rejected.
- [x] 1.5 Add the porthole variant of `pressure_slide` (round glass, visible from both sides, closed or open). Verify with a door kit test and a screenshot through the closed door.

## 2. Water body and the `water` step (standing-water)

- [x] 2.1 Add the room `water { level, floor? }` block and a `WaterBody` per room, with the footprint mask, `depthAt(x, z)` and level animation. Verify with unit tests for depth on the floor, on a submerged step and outside the footprint.
- [x] 2.2 Write the `water` surface tag from the water body instead of `water_surface` props, and delete the `water_surface` kit piece. Verify footsteps and NPC wade scaling still see `water` (existing tests), and `npm run typecheck` passes.
- [x] 2.3 Add `room` to the `water` sequence step and implement `host.water` on the room's water body. Verify with an action test that a 3 s rise reaches the target, and that a skip lands on the target.
- [x] 2.4 Save each room's water level in checkpoints and restore it, defaulting R09 to flooded when `valve_done` is set and no level was saved. Verify with a save round-trip test and an old-save test.

## 3. How the water looks and reacts (standing-water)

- [x] 3.1 Replace the surface material with the patched standard material: lit by the light pool, Fresnel, two detail normal maps. Verify with a screenshot where a flickering tube's highlight goes dark with the tube.
- [x] 3.2 Add the GPU ripple simulation (wall-masked, fixed 60 Hz, up to 64 stamps, sleeps when not visible). Verify with a test that a stamp's ring reflects off a masked wall, and a screenshot of a wake.
- [x] 3.3 Feed disturbances into the simulation: footsteps, wading legs, bullet impacts, bodies and severed parts landing, drips, the pouring pipe, and the `cameraShake` shudder. Verify in the browser that each one ripples the water (`docs/PLAYTEST.md`).
- [x] 3.4 Add the tiered planar reflection (High half resolution, Medium quarter, Low Fresnel-to-fog), run only when water is visible. Verify with screenshots per tier, and that a dry room has no reflection pass in the renderer stats.
- [x] 3.5 Add the murk patch to the merged level materials and the body material, with a no-op branch when no water is active. Verify with screenshots of the submerged stairs fading by depth, and a dry room unchanged before and after.
- [x] 3.6 Add the splash particle system and presets (step, takeoff, landing, bullet, body), each stamping the simulation. Verify in the browser for each preset.
- [x] 3.7 Make `GoreSystem` spawn an underwater blood cloud instead of a floor pool under water. Verify with a gore test that a pool request under water yields a cloud, and with a browser kill in R09.
- [x] 3.8 Add per-actor wetness (`uWetLine` rises with depth and dries at about 1 cm/s). Verify with a unit test of the wet-line update, and a screenshot of Okafor after wading. **Closed 2026-11-27:** found in the code or data; any check it asks for has no recorded run.
- [x] 3.9 Add floating junk and oil-sheen patches that bob from the ripple heights. Verify in the browser that junk bobs when the water near it is disturbed.

## 4. Movement in water (player-movement)

- [x] 4.1 Replace the binary `wading` flag with depth scaling for speed and acceleration, and block sprint above 0.45 m. Verify with player tests for ankle, knee and thigh depth and for sprint ending in deep water.
- [x] 4.2 Allow jumping in water with scaled takeoff, a 0.90 m reach from the floor under the water, and a 0.35 s recovery after a water landing. Verify with tests for the spec scenarios (0.85 m mounts, 0.95 m blocks, repeated jumps no faster than wading).
- [x] 4.3 Keep the downed eye height above the surface. Verify with a player test for downed in 0.75 m of water.
- [x] 4.4 Update the `player-movement` scenarios in the existing motor and player tests to the new jump rule. Verify with `npm test -- src/actors/player.test.ts src/actors/motor.test.ts`.

## 5. Lights and sparks (render-lighting)

- [x] 5.1 Add the `failing` pattern to `LIGHT_PATTERNS`. Verify with tests that over 30 s it is mostly lit, goes dark at least once, never exceeds three changes a second, and is identical with reduced flashing.
- [x] 5.2 Add optional light `id`s in level data and the `light` sequence step that switches one light. Verify with an action test that the other lights in the room keep their pattern.
- [x] 5.3 Add the swinging-tube prop with a pendulum fixture and a claimed slot that follows it. Verify with a screenshot and a kit test of its slot.
- [x] 5.4 Add sparks: particles synced to a flicker light's level, plus the existing `zap` sound, with a hiss and a ring where they reach the water. Verify in the browser in R09.

## 6. Sound (in-world-audio)

- [x] 6.1 Update `docs/audio-assets.md` section 1 with the source order (CC0, CC BY, royalty-free packs, then ElevenLabs; no NC or SA). Verify the doc reads correctly next to sections 2–4.
- [x] 6.2 Source, trim and loudness-match the clips: wading steps at three depths, slosh loop, takeoff and landing splashes, first-step splash, bullet splash, spark hiss, fluorescent strike, pouring pipe, lapping, pumps, klaxon, door slam and water rise. Re-check each licence on its own page and add every outside clip to `CREDITS.md`. Verify every file has a `CREDITS.md` row or an ElevenLabs manifest entry.
- [x] 6.3 Register the clips in `SAMPLE_URLS` and play water footsteps from the new bank in place of the low-passed concrete step. Verify with a footsteps test that the water surface maps to the wading bank, and that `npm run audio:audit` passes.
- [x] 6.4 Add the positional slosh loop per wading body, with footstep range and occlusion. Verify with a footsteps test that it fades out within about 0.5 s of stopping.
- [x] 6.5 Play the takeoff, landing and drip sounds per the `in-world-audio` scenarios. Verify with tests for the case jump and the drop back into water.

## 7. R09 and R10 rooms (flooded-tunnel)

- [x] 7.1 Rebuild R09 per the design's cell plan: `floorY: -1.2`, stairs and landings at both ends, the water body at -0.45. Move `cp_flooded` to the R07 landing. Verify with a level test that the waterline sits below both thresholds, and that the landing is out of jump reach from the sump.
- [x] 7.2 Dress R09: burst pipe and pour emitter, tide marks, wet materials near the water, surface mist, things visible underwater, failing tubes (at most 6 pooled), the swinging tube and the broken fixture. Verify in the browser against the `flooded-tunnel` dressing scenarios, and the light budget with Low's 12-light pool.
- [x] 7.3 Place the steel case wedged at a pipe support with `S_ammo_r09` on top, within 0.90 m of the sump floor. Verify with a level test of the case-top height, and by picking it up in the browser.
- [x] 7.4 Convert the tunnel encounter: floor spawns rise from the water, play-dead corpses float face down, re-author spawn positions on the sunken floor. Verify with a level test that the squad and an enemy can path from R07 to R10, and in the browser that a shambler rises with a splash.
- [x] 7.5 Rebuild R10 as the pump room: pumps, moving gauges, the grated overlook onto the R09 stairs, the valve, the beacon with a light `id`, and the porthole door on `D_R09_R10`. Verify with a screenshot from the overlook showing the stairs and water.

## 8. The flood cutscene (flooded-tunnel)

- [x] 8.1 Check whether `spawn` and `npcMoveTo` can drive an enemy as a named actor with AI off. If not, add the `runHook` enemy-script fallback. Verify with a sequence test that drives a spawned shambler to an anchor.
- [x] 8.2 Add `skippableAfter` and the save-level `seen` list that checkpoint restores never roll back. Verify with runtime tests: not skippable on first play, and skippable after watching even when an earlier checkpoint is restored.
- [x] 8.3 Rewrite `valve_turn` in `action_tunnel.json` per the D9 shot list (lock, frame the wheel, place the squad unseen, despawn the tunnel group, spawn the shambler, beacon, turn, rise, seal, rise behind the door, porthole, lines, checkpoint). Verify with a sequence test of the end state after a full watch.
- [x] 8.4 ~~Add the shambler's drag-under clip and the porthole hand-slap prop.~~ Superseded by 12.10 (R09 no longer floods, no porthole hand) and D13 (the elite).
- [x] 8.5 Make skip apply the full end state, including the shambler despawn and the beacon. Verify with a sequence test that a skip at several points matches a full watch.
- [x] 8.6 Add the `r10_flood` debug jump in `src/main.ts`, and document it with the R09/R10 section of `docs/PLAYTEST.md`. Verify that `?debug&jump=r10_flood` starts just before the valve.
- [x] 8.7 Restore checks: `cp_flooded` brings back pre-flood water with the door closed but openable; `cp_valve` brings back R09 flooded, the door sealed, the beacon on and the squad in R10. Verify with checkpoint-restore tests.

## 9. Refraction (after `upgrade-three-and-post-chain`)

- [ ] 9.1 Once the new post chain lands, add High-tier refraction from its input colour buffer, offset by the ripple normals. Verify with a High-tier screenshot of the submerged stairs bending under ripples, and that Low and Medium are unchanged. **Dropped 2026-11-27, not built:** no refraction. The product was accepted as it is.

## 10. Integration checks

- [x] 10.1 Play R07 to R11 in the browser per `docs/PLAYTEST.md` (wading, the case jump, encounters, cutscene, skip on replay, both checkpoints). Attach screenshots and a short clip of the flood. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.
- [x] 10.2 Measure R09 on High on the desktop PC with `?slot=scratch&memprobe`, and confirm 30 fps 1% lows with the reflection pass on. If needed, drop High to quarter-resolution reflections and record the numbers in `design.md`. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.
- [x] 10.3 Run `npm run typecheck`, `npm test` and `npm run audio:audit`, and confirm all pass. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.

## 11. Industrial tunnel surfaces (added after the first R09 playtest)

- [x] 11.1 Give R09 bare concrete walls (only plain wall tiles, so no wall vent ends up under the water). Verify with a generator check that every R09 wall tile is `wall_plain` with `material: concrete`.
- [x] 11.2 Make R09's landings and stair treads open steel grating you can see the water through (`grate: true` on `floor_landing` and `stairs`), with the same colliders. Verify with a kit test that the grated landing and treads use the grating material and keep their colliders.
- [x] 11.3 Add a `tag_stencil` wall prop (sprayed TAG Industries lockup, tunnel name and depth markings, worn) and place it on R09's concrete above the waterline and in R10. Verify with a kit test and the level placement checks.
- [x] 11.4 Add a `cable_tray` prop (a grated tray hung from the ceiling with sagging cables) and run trays and high pipe runs along R09's ceiling. Verify with a kit test of its hangers and in the level build.

## 12. Flood cutscene playtest fixes

- [x] 12.1 Aim the view, the valve's use box and the `r10_flood` jump at the wheel's hub (it was 1 m to the right). Verified by the jump-anchor level test.
- [x] 12.2 Lock the R09–R10 door at the start of the cutscene so the charging shambler cannot open it before it seals. Verified in the cutscene sequence test.
- [x] 12.3 A loud alarm blast with the red beacon, 1.6 s before the view turns, and a tense sting as the shambler charges (ElevenLabs `alarmBlast`, `floodStinger`). Verified in the cutscene sequence test and the audio audit.
- [x] 12.4 Panic from Okafor and Giles during the charge and after the seal (`flood_okafor_01/02`, `flood_giles_01/02`, Gemini TTS on their pinned model); release the camera with the controls so the quiet lines are free-look. Verified in the cutscene sequence test.
- [x] 12.5 Stop the water surface and murk 0.2 m short of the footprint's walls so the flood never shows on R10's side of the overlook. Verified by the murk and surface tests.
- [x] 12.6 R10 to match the tunnel: concrete walls, a TAG stencil, a cable tray and a hung pipe run overhead. Verified by the level tests.
- [x] 12.7 A valve-turning sound as the wheel turns (ElevenLabs `valveTurn`); Giles and Okafor wait at the door, facing it, either side of Jay's view of the porthole; no casual lines after the panic (the Mara lines are no longer played). Verified in the cutscene sequence tests.
- [x] 12.8 Playtest round: the door stands open when the cutscene starts and slams as the water reaches the top step; the shambler shrieks as it charges (ElevenLabs `creatureCharge`) and pounds on the sealed door twice (`doorPound`) before the hand; the pump room turns red (room lights to the alarm, two more beacons) for the flood and on every later load; Okafor's panic lines louder (per-line `gain`) and him nearer. Verified in the cutscene sequence tests and the audio audit.
- [x] 12.9 R09 lit in red: five alarm beacons high on its walls (above the flooded level), marked `ownColor` so backup power dims them but keeps them red; R10's beacons likewise. Verified by the station-power and level tests.
- [x] 12.10 Playtest redesign: R09 no longer floods (no water rise, no porthole hand); the door slams in the charging shambler's face, it pounds and retreats. At the R11 bulkhead it bursts back through the R09 door (jump-scare `ambushSting`), and the door shears its forearms off (`npcSever`, `creatureSeverShriek`). Script-opened doors hold open; cutscene sounds take a `gain`; R10 runs on its own circuit (`backupScale`). Verified in the sequence, level and station-power tests and the audio audit.

## 13. Cutscene timing, the elite and the pry (design D13)

- [x] 13.1 Add the `doorPry` step (`id`, `open`, `s`) and level support for a forced part-open door that keeps its state; the next `doorState` closes from there. Verify with a level door test and a sequence test, including skip.
- [x] 13.2 Add the `flood_elite` cast look (the `necromorph` hero-tier body) and spawn it in `valve_turn` and `r10_ambush`. Verify with a cast look test.
- [x] 13.3 Add the `pry_reach`, `pry_clamp` and `pry_wrench` poses for the blade arms (the small extra hands stay still). Verify with the pose tests and in the browser. Browser pass: the blades come up through a 0.4 m gap in a V and the forearms shear off onto the pump-room floor; a closer look in the cast motion sandbox is still worth doing.
- [x] 13.4 Retime `valve_turn` off its lines: Okafor's two lines in order, the door sealing on "Seal it now!", the charge arriving just after the leaves meet, Giles's wheel line dropped, control released before "Is it gone?". Verify with a sequence test that no line but "Is it gone?" starts after the seal.
- [x] 13.5 Keep the score playing with `floodAlarm`, `floodCharge`, `floodHold` and `floodOut` cues on `labB`, and generate `floodSlamHit` (ElevenLabs, its hit trimmed to 0.9 s) to replace `floodStinger`. Verify with the score and audio audit tests and a measurement of the hit's offset.
- [x] 13.6 Rewrite `r10_ambush` as the pry: blades into the seam, clamp, wrench with `doorPry` and a new `doorPry` sound, the slam from the part-open position, the sever. Verify with the sequence test and in the browser.

## 14. Fewer tunnel enemies (from trim-lab-wing-encounters)

- [ ] 14.1 Cut the `r09_tunnel` group to 2 crowd zombies (shamblers on the `necromorphCrowd` bodies) rising from the water. Remove the other floor spawns, the vent spawn and both floating play-dead corpses. Leave the scripted flood shambler and the elite alone. Verify with a level test that `r09_tunnel` totals 2, and with the `valve_turn` sequence test that `despawnGroup r09_tunnel` still runs. **Dropped 2026-11-27, not built:** the `r09_tunnel` group was not cut to 2. The product was accepted as it is.
