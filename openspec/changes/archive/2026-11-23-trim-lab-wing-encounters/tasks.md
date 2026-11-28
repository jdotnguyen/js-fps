# Tasks

## 1. Spawn health and the drop start

- [x] 1.1 Add an optional `hp` to spawn points (`src/data/types/level.ts`, `spawner.ts`, `enemyDirector.spawn`). It replaces the variant's base health before the difficulty multiplier. Verify with a director test: 90 at `enemyHp` 1, 67.5 at 0.75, and the base health when `hp` is not set.
- [x] 1.2 Add the `drop` start (D4): spawn at the point, fall to `floorBelow`, then landing event, `corpseProne`, `getUp`, and hunt the player. Verify with an enemy sim test that a drop from y 3.3 lands on the floor (not the ceiling slab), takes about the free-fall time, emits a landing event, and targets the player. Also verify that `emerge` spawns are unchanged.
- [x] 1.3 Play `creatureLand` with a camera shake scaled by fall height on the landing event. Verify with a game-host test that the landing plays the sound once at the enemy's feet. (Verified by the director test of `enemy:landed`, once, at its feet; `enemyGame` maps it to `creatureLand` and `camera:shake`.)

## 2. Ceiling vent grate

- [x] 2.1 Add the `ceiling_vent` kit piece with `closed` / `open` / `fallen` states and the scripted grate fall (D5). Verify with a kit test of each state's meshes and colliders (no collider once fallen).
- [x] 2.2 Add the `ventState { id, state, instant? }` step and make it skip-safe; loads get the grate state back from `action_restore` (flags), like door states. Verify with a sequence test (the restore round-trip is covered by 4.3 and 6.2).
- [x] 2.3 Play `grateClatter` when the grate lands. Verify with a kit test that the clatter plays once, after the fall, and not on an instant restore.

## 3. Sounds

- [x] 3.1 Generate `ventCoverRip`, `ventCoverBurst`, `ductBang` (4 or more variants), `ductScrape` (2 or more), `creatureLand` (2) and `grateClatter` per `docs/audio-assets.md`. Register them in `src/audio/sounds.ts` and credit them in `CREDITS.md`. Verify with `npm run audio:audit`.
- [x] 3.2 Add the `labB` cues `escapeDark` and `dropHush` (drone only) to `src/data/scores.json`. Add resume entries for `drop_done && !contact_done` and `contact_done && !cover_done` at `hold`, and release the score on `cover_done`. Verify with the score tests: cue loudness within 1 dB, resume cues, release point.
- [x] 3.3 Choose the reveal stinger by ear, trying `slam`, `stab` and `ambushSting` first. Generate a `reveal` stinger only if none of them lands. Verify in the browser at the reveal, and with the audio audit if a new file is added. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.

## 4. Lab B escape (end of `drop`)

- [x] 4.1 Place the R04 `ceiling_vent`, the `labb_vent` anchor, and the duct anchors `duct_r04`, `duct_r05_1..3`, `duct_r06_0..3` along the coolant line, 0.3–0.5 m above the ceiling, per `docs/modular-grid-standard.md`. Verify with level tests that the anchors sit above the ceilings of their rooms and that the Voss sight line is still clear.
- [x] 4.2 Write the escape into `drop.json` per D1: hammer flurries with `contact_giles_01` and `contact_okafor_01`, lights `dying` then `off`, `hush`, rip, despawn, receding bangs, lights back, stinger, `hush off`, `hold`. Verify with a sequence test of the step order, the stinger within 0.1 s of the lights, and the end state after a full watch and after a skip.
- [x] 4.3 After `drop_done`, don't place the creature behind the glass, and load the R04 grate open. Verify with a restore test at `cp_drop`: no creature in R04, grate `open`, score at `hold`, and no escape steps replayed.
- [x] 4.4 Update the infection-kills tests that expect the creature to come through `D_R04_R05`. Verify with `npm test -- src/ai/npcKills.test.ts src/script/action.test.ts`.

## 5. R05 contact without a fight

- [x] 5.1 Remove the `r05_door`, `r05_vent` and `r05_drain` spawns. Keep `D_R04_R05` sealed. Rewrite `contact` per D2, with the overhead pass before `okafor_revive_rule_01` and the blackout. Verify with the `contact` sequence test: no `spawnGroup`, the bangs in order with each one nearer R06, the radio chatter within 2 s of the last bang, and `D_R04_R05` sealed throughout.
- [x] 5.2 Delete `contact_okafor_02` from the dialogue data and `scripts/vo-takes.json`, and remove its mp3. Verify with `npm test -- src/dialogue/library.test.ts` (no unused or missing lines).

## 6. R06 cover-me with the escaped creature

- [x] 6.1 Place the R06 `ceiling_vent` over `r06_duct`, in view of the hold point. Set `r06_duct` to `start: "drop"`, `look: "lab_creature"`, `hp: 90`, `count: 1`. Remove `r06_trench`, `r06_vent_e` and `r06_corridor`. Verify with the level tests that the hold point sees the grate, the 1.2 m lane is clear, and the slice01 group totals are updated in `action.test.ts`.
- [x] 6.2 Write the arrival branch into `cover_me` per D3: bangs and shake (no dust: no dust effect exists), silence, burst, grate falls, spawn, `door` cue, "Legs! Take its legs!" on landing, then `end` cue and `contact_after_01` after `waitGroup`. Verify with the `cover_me` sequence test, including skip and a restore at `cp_contact_clear`.
- [x] 6.3 Re-record `cover_giles_01` as "Twenty seconds. Maybe thirty. Keep it off me!" on Giles's pinned voice per `docs/voice-casting-standard.md`, and update its text. Verify with the dialogue library test and by ear.
- [x] 6.4 Update the enemy-encounters stuck-enemy test to the one-creature `r06_cover`. Verify with `npm test -- src/ai/enemySim.test.ts`.

## 7. R07 without the ambush

- [x] 7.1 Remove the `r07_playdead` spawn, and remove `waitGroup r07_playdead` and `despawnGroup r07_playdead` from `sec_glass`. Verify with the `sec_glass` sequence test that the glass scene starts with no 20 s wait. Add a note in `overhaul-priya-r08-death/tasks.md` that these steps are gone.

## 8. Docs and playtest

- [x] 8.1 Update `docs/PLAYTEST.md` (and `docs/HANDOFF.md` if it lists the lab fights) for the new beats. Verify the docs match the sequences.
- [x] 8.2 Play from `cp_drop` through `cp_contact_clear` into R07 in the browser on `?slot=scratch`. Check the blackout reveal and stinger, the bangs sounding overhead, the R06 drop, and whether one 90 HP creature fills the bypass. Close the tab afterwards. Record any retiming in this file. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.
- [x] 8.3 Run `npm run typecheck` and `npm test`, and confirm both pass. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.

## Workflow follow-up

- R09's cut to 2 crowd zombies is task 14.1 in `overhaul-flooded-tunnel`.
- After sign-off, sync the specs and archive the change.
