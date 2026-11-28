# Tasks

## 1. Departure console

- [x] 1.1 Add `r15a_okafor_console` to `src/data/levels/slice01.json` and `scripts/gen-slice01.mjs` (do not regenerate the level), send Okafor there in `r13d_transit_walk`, and add a test that the anchor is within 2 m of `r15a_giles_console`, standable and clear of the boarding gap; verify with `npm test -- src/world/slice01.test.ts`.

## 2. Ride timing, darkness and arrival

- [x] 2.1 Add `src/script/rideTiming.test.ts`, which runs the real `r15a_train_ride` with the ride controller and speech manager using durations read from the shipped MP3 files, and asserts: `r16_pa_01` ends at least 2 s before the arrival stage, both `R16` rooms are off before it, the finale starts within 2 s of the stop, and a deliberately lengthened PA clip causes no timeout-length stall. Verify it fails on the current script.
- [x] 2.2 In `action_climax.json`, black out `R16a`/`R16b` as the ride starts, set `tunnelSeconds` to 66 with the brake cue at 62 s, and move the arrival steps into their own `parallel` branch; verify with `npm test -- src/script/rideTiming.test.ts src/script/action.test.ts src/game/transitRide.test.ts`.
- [x] 2.3 Move `r15a_giles_04` from the arrival into the announcement branch, overlapping `r16_pa_01` from 4.8 s in; verify with `npm test -- src/script/rideTiming.test.ts src/script/action.test.ts`.

## 3. Onboard announcement

- [x] 3.1 Add the `follow` option through `speech.ts` and `voicePlayer.ts`, set it for the onboard lines in `session.ts`, and add voice player tests that a following PA line moves its source with the listener while a wall PA line stays put; verify with `npm test -- src/dialogue/voicePlayer.test.ts src/dialogue/speech.test.ts`.

## 4. Checkpoint restore

- [x] 4.1 Make `action_restore.json` restart the finale from the `Arrival Terminal` checkpoint (squad in the car, door shut, `R16` dark, cabin lights on), leave `session.ts`'s `jump=r16_finale` with a single starter, and add tests that it starts exactly once, and not at all when `r16_finale_done` is set; verify with `npm test -- src/script/action.test.ts`.

## 5. North-pillar scare

- [x] 5.1 Add the `zoom` option to `playerFrame` (`player.ts`, `actions.ts`, `host.ts`) with a magnified-shot test; verify with `npm test -- src/actors/player.frame.test.ts src/script/action.test.ts`.
- [x] 5.2 Between `r16_okafor_01` and `r16_jay_02`, drag `r16b_corpse_booth_north` behind the north-west pillar in one flicker, with no creature tease; set its position, `r16_north_pillar_look`, `r16_body_drag_to`, the arrival board and the two luggage stacks in the level data (anchors also in the generator); test the step order and that the body starts partly hidden and ends out of sight; verify with `npm test -- src/script/action.test.ts src/world/slice01.test.ts`.
- [x] 5.3 In the browser (`?level=slice01&debug&slot=scratch&jump=r16_finale`), capture the drag from Jay's seat and confirm the body starts with its legs behind the pillar, slides slowly out of sight before the dark, and the magnification releases afterwards.

## 6. Debug path and playtest notes

- [x] 6.1 Remove `&door=open` from `session.ts` and update `docs/PLAYTEST.md`: `jump=r11` with `&slot=scratch` as the end-to-end route, what each other jump is for, and current R11 to finale checks in place of the retired wave fight and Giles reveal; verify that a search of `src/` and `docs/` finds no `door=open`.

## 7. Integration

- [x] 7.1 Run `npm run typecheck` and the test files touched above, and confirm they pass.
- [x] 7.2 Play `?level=slice01&debug&slot=scratch&jump=r11` to the end of the slice: Okafor audible beside Giles, the whole announcement heard, `R16` never lit except flickers, no silent wait after arrival, the tease before Jay's warning, `CAM 10` unchanged and no new console errors. (Run before 2.3 and section 5 were revised.)
- [x] 7.3 Without `slot=scratch` in a throwaway browser profile, reach `Arrival Terminal`, reload, choose Continue, and confirm the finale starts again once; then close the browser.
