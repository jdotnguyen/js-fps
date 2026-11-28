# Tasks

## 1. One restore path

- [x] 1.1 In `src/game/game.ts`, add a private `restore(save, { fromTitle, heal, toast })` that holds today's `load()` body, then fades in and emits `game:restarted { checkpoint }`. With `fromTitle`, call `world.resetToData?.()` before placing Jay.
- [x] 1.2 Make `load(save)` (title menu) call `restore` with `fromTitle: true` and the "Autosave loaded" / "Save loaded" toast; make `restartFromCheckpoint()` call it with the checkpoint heal and the "Restarted" toast. Keep `load(save, quiet)` callers working.
- [x] 1.3 Add `src/game/game.test.ts`: a title load emits `game:restarted` with the save's checkpoint after `game:mode playing`, resets the level to data, and restores flags; a death restart emits it once and does not reset the level.

## 2. Squad placed after every restore

- [x] 2.1 In `src/ai/squad.ts`, add `requestPlacement()` (clears `placed`) so the next update puts every unscripted mate near Jay.
- [x] 2.2 In `src/main.ts`, call `squad.requestPlacement()` on `game:restarted`.
- [x] 2.3 In `src/ai/squad.test.ts`: after `requestPlacement()` a far mate is placed near Jay on the next update; a `scripted` mate is left where he is.

## 3. Regroup step

- [x] 3.1 In `src/ai/squad.ts`, add `regroup(distance = 12): SquadId[]`: move each unscripted mate farther than `distance` from Jay and out of his view (outside a 70 degree half-angle of his facing, or no direct nav line) to `spawnSpot`; return the ids moved.
- [x] 3.2 Expose it as `NpcDirector.regroup(distance)` in `src/ai/npcs.ts`, `SequenceHost.squadRegroup?(distance)` in `src/script/types.ts`, wired in `src/script/gameHost.ts`.
- [x] 3.3 Add the `squadRegroup { distance? }` action to `src/script/actions.ts` (instant; a missing host feature warns once; skipping runs it too).
- [x] 3.4 In `src/ai/squad.test.ts`: a far mate behind Jay is moved near him; a far mate in Jay's view is not; a mate within 12 m is not.

## 4. Beats regroup first

- [x] 4.1 Add `{ "do": "squadRegroup" }` as the first step of `cover_me` (`action_contact.json`), `medlab_door` (`action_tunnel.json`) and `climax` (`action_climax.json`).
- [x] 4.2 Check the sequence schema/validation tests accept the new step (`src/script/script.test.ts`, `action.test.ts`).

## 5. Gather before sealing

- [x] 5.1 In `src/ai/squad.ts`, add `placeIn(inside: (p) => boolean): SquadId[]`: move each mate for whom `inside` is false to `spawnSpot`, whether or not a scene holds him.
- [x] 5.2 Host wiring: `SequenceHost.inRoom?(who: 'player' | 'giles' | 'okafor', room)` and `squadPlaceIn?(room)` in `src/script/types.ts` / `gameHost.ts` (room test via `Level.roomAt`).
- [x] 5.3 Add the `gatherIn { room, timeout? }` action to `src/script/actions.ts`: pending until all three are inside; at the timeout place the squad and keep waiting for Jay; skip places the squad and ends.
- [x] 5.4 In `drop.json`, move `doorState D_R02_R03 sealed` after the two `npcMoveTo` steps and a new `{ "do": "gatherIn", "room": "R03" }`.
- [x] 5.5 Tests: an action test with a fake host covers wait / timeout placement / waiting on Jay / skip; `squad.test.ts` covers `placeIn`.

## 6. Debug jump fade

- [x] 6.1 In the `jump` branch of `src/main.ts`, call `hud.setFade(0, 0.4)` after `sequences?.cancelAll()`.

## 8. Climax arena

- [x] 8.1 In `action_climax.json` `climax`: seal `D_R13b_R13d` right after `D_R13d_R11` opens; add `{ "do": "gatherIn", "room": "R11" }` after the fight's parallel block, before `climax_giles_03`.
- [x] 8.2 In `action_restore.json`: when `climax_started` is set, seal `D_R13b_R13d`.
- [x] 8.3 Tests: the climax data seals the dive bay with the north entrance and gathers in R11 before sealing; the R11 climax and whole-action-half tests in `action.test.ts` still pass.
- [x] 8.4 `docs/PLAYTEST.md`: R11 checks for the sealed Moon Pool door and the gather before the reveal.

## 7. Verify

- [x] 7.1 `npx tsc --noEmit` is clean.
- [x] 7.2 The test suite passes (`node --experimental-strip-types --test "src/**/*.test.ts"`, run in batches within the shell timeout).
- [x] 7.3 Add a "Load from title" section to `docs/PLAYTEST.md`: Continue at `cp_valve` after a page reload (squad with Jay, climax plays), `?debug&jump=r11` shows the room, and quit-to-title then load, and running ahead into the Observation Gallery (door waits for the squad).
