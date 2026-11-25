# Tasks

## 1. Tunnel Emergency Red Lighting, Exterior Train Aux Lights & Level Anchors

- [x] 1.1 Add `transit:tunnel_power` (`normal` | `emergency`) handling on the `R15b` scrolling hallway and `R16a` north shroud in `src/world/kit/transit.ts` (tinting emissive rib/guide strips to dim emergency red and resetting on `level:reset`), plus two pre-allocated downward exterior auxiliary `SpotLight`s on Train Car B driven by `transit:train_aux_lights` (`intensity = 0` by default, zero scene light count change), add unit coverage in `src/world/kit/transit.test.ts`, and verify `npm test -- src/world/kit/transit.test.ts` passes.
- [x] 1.2 Add the `R16a`/`R16b` cutscene look, surveillance camera, squad advance, body-drag, gunfire target, and monster-reveal anchors (`r16_floor_blood_look`, `r16_concourse_look`, `r16_pillar_body_dragged`, `r16_exit_giles`, `r16_exit_okafor`, `r16_squad_giles_advance`, `r16_squad_okafor_advance`, `r16_cam09_pos`, `r16_cam09_look`, `r16_cam10_pos`, `r16_cam10_look`, `r16_fire_target`, `r16_monster_hide`, `r16_monster_reveal`) to `src/data/levels/slice01.json`, and verify `npm test -- src/world/slice01.test.ts` passes.

## 2. Squad Weapon-Mounted Flashlights, Scripted Firing & Dead-Body Drag

- [x] 2.1 Add pre-allocated weapon-mounted dynamic `SpotLight`s + subtle volumetric beam cones on `giles` and `okafor` in `src/ai/squad.ts` (toggled via `squad:flashlight`, aimed along their weapon/aim vector, reset on `level:reset`), plus scripted pistol firing (`squad:scripted_fire` with boosted CCTV-readable muzzle flashes), add unit tests in `src/ai/squad.test.ts`, and verify `npm test -- src/ai/squad.test.ts` passes.
- [x] 2.2 Ensure dragging a dead NPC (`r16_pillar_body`) via sequence action smoothly translates its position without leaving its frozen `corpseProne` pose or triggering gait/idle animation, add unit coverage in `src/script/action.test.ts`, and verify `npm test -- src/script/action.test.ts` passes.

## 3. Dialogue VO & ElevenLabs SFX

- [x] 3.1 Add the 11 new R16 PA, cabin, and radio-filtered surveillance dialogue lines (`r16_pa_01`–`02` on `channel: "pa"`, `r16_jay_01`–`02`, `r16_giles_01`–`02`, `r16_okafor_01` on `channel: "local"`, and `r16_okafor_02`–`03` and `r16_giles_03`–`04` on `channel: "radio"`) to `src/data/dialogue/slice01_action.json`, generate all clips on their pinned Gemini TTS models (`scripts/vo-generate.ts --ids ... --apply`), spot-check for dead air, and verify `node --experimental-strip-types scripts/vo-trace.ts` reports zero off-model clips.
- [x] 3.2 Add prompts for `trainPowerDown`, `r16HorrorHit`, and `r16MonsterRoar` to `scripts/ambience-generate.ts`, generate the MP3 assets in `public/assets/audio/ambience/`, register them in `src/audio/sounds.ts`, and verify `npm run audio:audit` passes with zero missing or unused assets.

## 4. R15b Power-Loss Extension, R16 Arrival Finale Sequence & Debug Jump

- [x] 4.1 Extend `r15a_train_ride` in `src/data/sequences/action_climax.json` so Heins's static cutoff triggers `trainPowerDown`, `transit:tunnel_power { mode: 'emergency' }`, and `r16_pa_01` (tuning `tunnelSeconds` to the measured VO length), blacks out `R16a`/`R16b` before Stage 3 enters `R16a`, and locks Jay into the downward platform-floor cutscene framing on arrival.
- [x] 4.2 Author `r16_arrival_finale` (triggered on `transit:arrived_r16`) in `src/data/sequences/action_climax.json` covering the `r16_pa_02` auxiliary downward exterior lights blood hint, `"Wait... is that blood?!"` -> slow pan up -> `r16HorrorHit` + 3x bright flicker reveal (respecting `reducedFlashing`) + edge-of-frame `r16_pillar_body` drag -> pitch black -> cabin banter -> door open + Jay flashlight/viewmodel off -> fullscreen `CAM 09  ARRIVAL DOCK` -> `"Flashlights on."` + squad weapon flashlights & advance -> radio-filtered yelling & gunfire -> hard cut to `CAM 10  CONCOURSE` (left gun/flashlight glow, right pillar 0.5 s `hero` monster reveal + `r16MonsterRoar`) -> instant blackout & dead silence -> `story:cliffhanger`.
- [x] 4.3 Wire `?debug&jump=r16_finale` in `src/app/session.ts` and `action_restore.json` cleanup for `r16_finale_done`, add end-to-end sequence tests in `src/script/action.test.ts`, and verify `npm test -- src/script/action.test.ts` passes.
- [x] 4.4 Pass active live `cameraFeeds` camera positions into `npcs.update` (`NpcEnv`) and keep `body.killing` visible past `NPC_TUNING.hideDistance` in `src/ai/npcActor.ts` so Priya is visible and animated on `CAM 04 MEDBAY` from `R16a` (87.7 m away), fix `NpcDirector.spawnFromLevelAsync()` in `src/ai/npcs.ts` to forward `s.dead === true, s.blood === true` to `create()`, add unit tests in `src/ai/npcs.test.ts`, and verify `npm test -- src/ai/npcs.test.ts` passes.

## 5. Integration & Browser Playtest Verification

- [x] 5.1 Run `npm run typecheck`, `npm run audio:audit`, and `npm test -- src/script/action.test.ts src/world/kit/transit.test.ts src/ai/squad.test.ts src/world/slice01.test.ts` and confirm all pass.
- [ ] 5.2 Playtest end-to-end in the browser via `?debug&jump=transit_ride` and `?debug&jump=r16_finale`, verifying the red tunnel power-loss + PA announcement, pitch-black `R16a`/`R16b` arrival, downward auxiliary blood pools, bass-hit 3x flicker + right-edge body drag, `CAM 09` weapon flashlights & radio-filtered panic, `CAM 10` left-muzzle / right-pillar 0.5 s monster reveal, hard blackout to dead silence, and clean handoff into `THALASSA / SLICE ONE` -> Priya `CAM 04` stinger -> end credits.
