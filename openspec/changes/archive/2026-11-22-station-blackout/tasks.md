# Tasks

## 1. Station power and backup lighting

- [x] 1.1 Add `backup: true` to the light item type in `src/data/types/level.ts` and its validator; verify `npm run typecheck` passes and a level with an unknown light key is still rejected
- [x] 1.2 Add `setPower('mains' | 'backup')` to `Level`, with the `backup` look (warm white, ≤30% intensity, range ×0.7), `AMBIENT.backup`, and the backup-light rule (`emergency` slot, `backup: true`, else lowest claimed slot); verify with new tests in `src/world/level.test.ts` (or the nearest lighting test) covering the render-lighting scenarios "Room with a beacon", "Room without a backup light" and "Back on main power"
- [x] 1.3 Make out lights drop out of the fill-light pool and make `setLight` under backup affect backup lights only; verify with tests for "Pool goes to backup lights" and "Flicker during the blackout"
- [x] 1.4 Apply the power mode to rooms built or shown after the switch; verify with a test that switches power, then builds or reveals a second room and finds it already in backup
- [x] 1.5 Add the `power` script action (`state: mains | backup`) to `src/script/actions.ts` and `host.ts`, setting the `station_power` flag and emitting `power:backup` / `power:mains`, with a skip handler that applies the end state; verify with `src/script/action.test.ts` cases for run and skip
- [x] 1.6 Restore the power mode from `station_power` on checkpoint load and in `debugSetup`, including the migration rule (`contact_done` without `station_power` means backup); verify with `src/game/save.test.ts` / `game.test.ts` cases for "Reload after the blackout" and "Reload before the blackout"
- [x] 1.7 Wall-mount `emergency_beacon` props in R02 and R05–R11 through `scripts/gen-slice01.mjs` (which generates `slice01.json`) per `docs/modular-grid-standard.md` and `docs/surface-dressing-standard.md`; add a `slice01.test.ts` check that every room has a backup light, and print the rooms still on the fallback

## 2. Audio

- [x] 2.1 Add `lockdownAlarm`, `powerDown` and `backupHum` entries to the `scripts/ambience-generate.ts` manifest with the design's prompts; generate them with `npm run ambience:generate -- --id <id>` and verify the files exist in `public/assets/audio/ambience/`
- [x] 2.2 Register the three in `SAMPLE_URLS` in `src/audio/sounds.ts` (all three sample-only; the drop's alarm steps switch from `klaxon` to `lockdownAlarm`) and verify by ear in the drop and with the `audio-assets` fallback tests
- [x] 2.3 Play `backupHum` as a positional loop on lit backup lamps near the player under backup power, and stop the room light buzz; verify the in-world-audio "Power fails" and "Walking past a lamp" scenarios in the browser
- [x] 2.4 Credit any non-generated audio in `CREDITS.md` (none expected) and update `docs/audio-assets.md` if the manifest gained a new category

## 3. Voice lines

- [x] 3.1 Add `radio_ops` (`Zephyr`), `radio_dock` (`Algieba`), `radio_hydro` (`Erinome`) and `radio_launch` (`Sadaltager`), all on `gemini-3.8-flash-tts`, to `scripts/lib/voCast.ts`, `src/data/dialogue/speakers.json` (subtitle names "Station Ops", "Docking Ring", "Hydroponics", "Launch Hall") and the cast table in `docs/voice-casting-standard.md`; verify no voice is shared with another speaker (vo-trace / cast test)
- [x] 3.2 Add the seven `blackout_*` lines from design.md to `src/data/dialogue/slice01.json` (radio lines on `channel: "radio"`, the PA line on `pa`, Okafor's on `local`); verify the dialogue tests pass and no line says "moon pool"
- [x] 3.3 Generate the VO with `scripts/vo-generate.ts` (one request per model: 3.8 for the radio speakers, 3.1 for the PA, 2.5-flash for Okafor), with radio takes cut off mid-word and finished with a squelch; verify with `scripts/vo-trace.ts` that every clip is on its pinned voice and model

## 4. The blackout beat

- [x] 4.1 Replace the ruined-radio steps in `contact` (`action_contact.json`) with the blackout beat from design.md, ending at the door close and `cp_contact_clear`, guarded by `blackout_done`; verify with a sequence test that runs `contact` to the end and finds `station_power = backup`, the steps in order and the checkpoint saved
- [x] 4.2 Set `station_power: "backup"` in the `debugSetup` of every sequence after `contact` (`cover_me` and later); verify each debug-started sequence begins under backup power
- [x] 4.3 Move the flashlight prompt from `area:dark` to `power:backup` in `src/ui/tutorialPrompts.ts`; update `src/ui/tutorials.test.ts` for "Flashlight off", "Flashlight already on" and "Dark corridor before the drop"

## 5. Radios

- [x] 5.1 Remove `r05_radio`, `hydro_radio` and `dive_radio` (anchors and props) from `scripts/gen-slice01.mjs` and regenerate, the `hydro`, `dive` and `ruined` branches of `quiet_restore.json`, and the `ruined_radio_off` sequence; verify `src/script/quiet.test.ts`, `src/script/action.test.ts`, `src/world/labWing.test.ts` and the dive-bay and hydroponics tests pass after updating their expectations
- [x] 5.2 Map saved `radio_place` values `hydro`, `dive` and `ruined` to `none` on load; verify with a save test

## 5b. Maintenance corridor

- [x] 5b.1 Seal `D_R13b_R13d` in `scripts/gen-slice01.mjs` with `access: { sealed: true, text: "out_of_service" }` (UI text `access_sealed_out_of_service`), regenerate `slice01.json`, and keep `dive_leak` (the climax still reaches R13d); verify with the dive-bay and `slice01.test.ts` level tests, the headless critical-path walk (still reaches `cp_round_dive` and `dive_case_locker`), and the scene-gathering climax tests (R13d still reachable from R11)

## 6. Flashlight model

- [x] 6.1 Import `flashlight.glb` per `docs/imported-props.md`: scale to about 0.22 m, origin at the lens, compress textures, save to `public/assets/models/props/flashlight.glb`; credit "Flashlight" by MAR.COS. (https://sketchfab.com/3d-models/flashlight-5fa9a65e7b0141ee877ed18f4f42d953, CC BY 4.0) in `CREDITS.md` and the in-game credits (`src/ui/credits.ts`); verify the file size is reasonable and the credits show the entry
- [x] 6.2 Add the flashlight prop to the viewmodel: lower-left pose, per-aspect/FOV offset, shared sway and bob, a 0.25 s raise/lower driven by `flashlight.on && weapon !== 'shotgun'`; verify with a unit test that projects the model's bounds at 4:3, 16:9 and 21:9 and the minimum and maximum FOV and finds the lens on screen and the tail off screen
- [x] 6.3 Move the spot light origin and the viewmodel point light to the lens while the prop shows, back to the chest offset otherwise, and drive the lens emissive from the flashlight level; verify the "Lens and beam line up" scenario in the browser
- [x] 6.4 Verify in the browser: switch on/off with the pistol, switch to the shotgun and back, aim, sprint, jump and reload with the light on, with no visible tail or pop

## 7. Integration

- [x] 7.1 Add the blackout and the flashlight checks to `docs/PLAYTEST.md`, then play from `cp_drop` through the contact fight and the blackout to `cover_me` (`?slot=scratch`): chatter overlaps, the PA plays, the station goes dark, the prompt shows, and R05 to R11 is playable with the flashlight off
- [x] 7.2 Run the touched test files, then `npm run typecheck` and `npm test`; verify all pass **Closed 2026-11-27:** no recorded run; the product was accepted as it is.
- [x] 7.3 Run `openspec validate station-blackout --strict` and fix any findings

## Workflow follow-up

- Archive the change after the playtest is signed off.
