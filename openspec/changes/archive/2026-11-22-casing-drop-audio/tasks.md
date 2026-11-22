# Tasks

## 1. Casing sounds

- [x] 1.1 Find CC0 (then CC BY) casing-drop recordings for each bank in design D3: brass and hull on concrete, metal plate, grate and soft, plus shallow water. Check each clip's licence on its own page. Keep the raw downloads outside the repo. Verify by listing every candidate with its source URL and licence in the PR notes.
- [x] 1.2 For any bank still missing, add an ElevenLabs manifest script in the style of `scripts/footsteps-generate.ts` (`npm run casings:generate -- --list` shows every bank) and generate it. Verify by `--list` reporting every bank as present.
- [x] 1.3 Trim, loudness-match against `pistolShot` and `footConcrete`, and encode at least 4 variants per bank into `public/assets/audio/weapons/casings/`. Register them in `SAMPLE_URLS` in `src/audio/sounds.ts`. Verify by `npm test -- src/audio/sounds.test.ts src/audio/audit.test.ts` passing, and every file loading in the dev server with no 404.
- [x] 1.4 Add a `CREDITS.md` row for every third-party clip, and a casing row to the table in `docs/audio-assets.md` if 1.2 added a script. Verify with `npm test -- src/ui/credits.test.ts` and by reading the doc row's command as written.

## 2. Landing resolution

- [x] 2.1 Add a pure function that takes an ejection point, the shooter's right vector, a seed and the collision and water lookups. It returns the landing point, the surface class (`concrete | metal | grate | soft | shallow | deep`), the delay and an optional fall-through second landing (design D1, D2). Verify with unit tests: carpet to the right of bare floor resolves `soft`; a wall 0.3 m to the right clamps the offset; delays stay within 0.35 to 0.7 s; depth 0.01 reads as a floor surface, 0.2 as `shallow`, 0.5 as `deep`; a grate over a deck sometimes yields a second landing, a grate over nothing never does; the same seed gives the same result.
- [x] 2.2 Add the mapping from kind and surface class to bank, rate and gain (D3, D6): `deep` gives no sound, `null` and `metal` give the metal bank, hull water is pitched down. Verify with unit tests over every combination, and a test that soft banks are at least 8 dB under concrete.

## 3. Playback

- [x] 3.1 Add the casing audio module with its single entry point, its scheduling, the no-immediate-repeat variant pick, the ±6% rate jitter, the 8 m range and the 4-voice cap with a 50 ms fade of the oldest voice (D3, D4). Verify with unit tests against a fake audio engine: five landings within 100 ms leave at most 4 voices and fade the oldest; two consecutive plays from one bank never use the same variant; a landing 9 m from the listener does not play.
- [x] 3.2 Wire it into `src/app/session.ts`: `weapon:fired` with `pistol` ejects brass from the camera's right side, and `weapon:cue` `pump` ejects a hull. Dry fire and `weapon:shellInsert` eject nothing. Keep casings out of `director.noise`. Verify with a test, or a focused session-wiring test if one exists, that one pistol shot gives one brass landing, one shotgun shot gives one hull only after the pump cue, and the enemy director receives exactly one `gunshot` noise and no casing noise.

## 4. Playtest

- [x] 4.1 In the browser (`?slot=scratch`), following `docs/PLAYTEST.md`, fire the pistol and the shotgun on concrete, deck plate, a grate over a lower deck or water, office carpet (including the bare strip by the gallery glass), shallow water and deep water. Confirm each spec scenario by ear, including a full magazine fired fast. Record any gain tweaks in the PR, and close the tab afterwards.
- [ ] 4.2 Run `npm run typecheck`, then `npm test` once before opening the PR, and verify both pass.
