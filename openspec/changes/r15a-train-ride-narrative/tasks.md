# Tasks

## 1. Level Triggers, Cabin Anchors & Comms Terminal Feedback

- [ ] 1.1 Add `trigger:r15a_enter` (on the `R15a` west boarding platform inside `D_R13d_R15a`), `trigger:r15a_boarded` (inside Train Car A's cabin), and squad cabin anchors (`r15a_train_giles`, `r15a_train_okafor`) to `src/data/levels/slice01.json`, and verify `npm test -- src/world/slice01.test.ts` passes.
- [ ] 1.2 Wire `transit:comms_state` (`idle` | `ringing` | `active` | `lost`) and `level:reset` handling on `train_comms_terminal` in `src/world/kit/transit.ts` to drive the rear-bulkhead status LED emissive color/pulse, add unit coverage in `src/world/kit/transit.test.ts`, and verify `npm test -- src/world/kit/transit.test.ts` passes.

## 2. Dialogue Script & Pinned Gemini TTS Voice Generation

- [ ] 2.1 Add the 18 `R13d` walk-and-talk, `R15a` boarding, and Stage 2 Heins radio dialogue lines (`r13d_okafor_01`–`02`, `r13d_giles_01`–`02`, `r13d_jay_01`, `r15a_giles_01`–`04`, `r15a_okafor_01`–`03`, `r15a_jay_01`–`02`, `r15a_heins_01`–`04` with `channel: "radio"` on Heins) to `src/data/dialogue/slice01_action.json`, and run `node --experimental-strip-types scripts/vo-generate.ts --ids ... --dry-run` to confirm batches on pinned models (`gemini-2.5-flash-preview-tts` and `gemini-3.1-flash-tts-preview`).
- [ ] 2.2 Generate the 18 VO clips with `--apply`, listen/spot-check any `<-- CHECK` flagged clips for dead air or accent drift (especially Heins's pinned General American accent), measure clip durations, and verify `node --experimental-strip-types scripts/vo-trace.ts` reports zero off-model clips.

## 3. Transit Ride ElevenLabs SFX & Audio Loop Wiring

- [ ] 3.1 Add prompts for `trainDoorClose`, `blastGateOpen`, `blastGateClose`, `trainPullout`, `trainTunnelCruise`, `trainBrakeStop`, and `trainCommsRing` to `scripts/ambience-generate.ts`, generate the MP3 assets in `public/assets/audio/ambience/`, and register all seven in `src/audio/sounds.ts`.
- [ ] 3.2 Wire `trainTunnelCruise` loop start/stop in `src/app/session.ts` (tied to `transit:ride_state` `sea_tunnel` -> start, `arrived` / `idle` / `level:reset` -> stop/fade), verify `npm run audio:audit` passes with zero unused or missing assets.

## 4. Boarding & 3-Stage Transit Ride Narrative Sequences

- [ ] 4.1 Author `r13d_transit_walk` (triggered on `r11_power_bay` completion when `D_R13d_R11` opens), `r15a_boarding` (`trigger:r15a_enter`, `requires: r11_powered`), and `r15a_train_ride` (`trigger:r15a_boarded`, `requires: r11_powered`) in `src/data/sequences/action_climax.json` following the approved beat-by-beat timeline in `design.md`, keeping Jay free-roam through `R11` -> `R13d` -> `R15a`, tuning `tunnelSeconds` to match the measured VO clip durations so Heins's cutoff lands right as Stage 2 deceleration begins, and emitting `transit_ride_done` / `cp_r16_arrived` / `transit:arrived_r16` on arrival.
- [ ] 4.2 Update `src/data/sequences/action_restore.json` (handling `r11_powered` + `transit_ride_done` restore states) and `src/app/session.ts` (`?debug&jump=r15a` sets `r11_powered: true`, `?debug&jump=transit_ride` triggers the narrated ride sequence cleanly), add unit tests in `src/script/action.test.ts` and `src/game/transitRide.test.ts`, and verify `npm test -- src/script/action.test.ts src/game/transitRide.test.ts` passes.

## 5. Integration & Browser Playtest Verification

- [ ] 5.1 Run `npm run typecheck`, `npm run audio:audit`, and `npm test -- src/script/action.test.ts src/game/transitRide.test.ts src/world/kit/transit.test.ts src/world/slice01.test.ts` and confirm all pass.
- [ ] 5.2 Playtest end-to-end in the browser from `?debug&jump=r15a` (walk across platform, watch Giles & Okafor board, step into Train Car A, ride all 3 stages with Heins radio exchange over the rear-bulkhead comms terminal, verify SFX, LED state, timing, and clean stop in `R16a` with boarding door closed and `r16a_north` sealed).

## 6. Squadmates hold cabin positions during the ride

- [x] 6.1 Add `SquadMate.rideLocked` (`src/ai/squad.ts`), set and cleared by `TransitRideController` instead of `scripted`; locked mates skip follow, give-way, catch-up, `placeNearPlayer`, `regroup`, `placeIn` and `catchUpIn`, and the NPC director skips them (`src/ai/npcs.ts`); Jay's player-separation pass still nudges them.
- [ ] 6.2 Playtest `?debug&jump=transit_ride`: Giles and Okafor stay put through all stages, shove aside only when walked into, and never leave the car.
