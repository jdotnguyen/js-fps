# Tasks

Each phase runs in a fresh session. Before starting a phase, run `/clear`, then set the model and effort given in its
heading (`/model`, `/effort`), then run `/openspec-apply-change split-level-data` and name the phase. Do one phase per
session. Phases 2 and 3 can run alongside 1b in separate sessions, since they touch different files.

Every phase that moves files starts with a quiet-window check. Run `git status` and `openspec list`. Go ahead only if no
file the phase moves is modified in the working tree or named by another in-flight change's tasks. Otherwise stop and
tell the user which change or file is blocking.

## 1. Phase 1a: split slice01 into room files (Sonnet 5.5, medium)

- [x] 1.1 Quiet-window check for `src/data/levels/slice01.json`, `scripts/gen-slice01.mjs` and the tests that read them.
  Verify: no dirty or claimed file, or the user is told what blocks.
- [x] 1.2 Add `assembleLevel(parts)` in `src/data/levels/` that returns today's `LevelData` from `{ level, doors, rooms }`
  using `level.json` `rooms: [ids]` for order, and fails naming both sides when a room id and a room file don't match
  (design D1, D2). Verify: unit tests for order, missing file and extra file pass.
- [x] 1.3 Write a one-time split script in `scripts/` that writes `src/data/levels/slice01/{level,doors}.json` and
  `rooms/<id>.json` from `slice01.json`, keeping `pieces` as they are. Verify: 35 room files exist, and a test that
  assembles them equals the old `slice01.json` with `deepStrictEqual`.
- [x] 1.4 Add the Node reader (`readLevelParts`) and switch `src/world/headlessSlice.ts`, `levelFileIds()` and every test
  or script that reads `levels/slice01.json` to it. Find them with `grep -rn "levels/slice01" src scripts`. Accept both
  a `<id>.json` file (kit_test) and a `<id>/` folder. Verify: the grep finds no direct reads, and the changed test files
  pass (`npm test -- <files>`).
- [x] 1.5 Add the browser reader: a per-level module that eagerly globs its folder and calls `assembleLevel`, loaded
  lazily from `src/app/levelFiles.ts` (design D2). Verify: `npm run build` shows slice01 as one lazy chunk with no
  per-room chunks, and the level loads in the running dev server (reuse :5173, `?slot=scratch`).
- [x] 1.6 Make validation errors name the room file and field path (spec: Validation names the file). Verify: a test
  with a bad kit id in one room file gets an error naming `rooms/<id>.json`.
- [x] 1.7 Freeze `scripts/gen-slice01.mjs`: make it exit with a message pointing at this change instead of writing.
  Update the level-generator-drift note. Verify: running it prints the message and writes nothing.
- [x] 1.8 Delete `slice01.json`, then drop the old-file half of the equality test, keeping a snapshot test of the
  assembled room ids and counts. Update `docs/modular-grid-standard.md`, `docs/surface-dressing-standard.md` and the
  comments in `scripts/walk-suggest.ts` and `scripts/ambience-generate.ts` to point at room files. Verify: `npm run
  typecheck` and `npm test` pass.
  Result (2026-11-26): typecheck and build pass. `npm test`: 2263 of 2279 pass; the same 16 tests fail, with
  matching messages, on a clean export of HEAD (mocapSources only lists more missing local source files there; the others are castMotionCoverage x2, heldGrip, mocapPhysics,
  motionProfiles, dockGuardRoutine, music, gather x2, credits, slice01Gallery, slice01ScriptedWalks, slice01Walks x2,
  wallClearance). The one-time split script was deleted with the old file.
- [x] 1.9 Add the "where things live" map to `AGENTS.md` (rooms, doors, level file, sequences, and for now: poses,
  bodies, sounds at their current paths). Verify: every path in the map exists.

## 2. Phase 1b: build room shells from layouts (Opus 5.5, high)

- [ ] 2.1 Port the generator's piece rules to `src/world/shell.ts`: ceilings first per cell, floor overrides and params,
  hashed wall choice, door, glass and open edge skips, `noDeadFixtures` fixtures, `extraPieces` (design D3). Verify:
  unit tests on small rooms cover each rule.
- [ ] 2.2 Write a one-time script that, for each room, builds pieces from the generator's room table and compares them
  with the room file's `pieces` as an unordered set (design D4). Verify: a report lists each room as match or diff.
- [ ] 2.3 Add `layout` to each matching room file and fix the layout of each differing room (R15b at least) until it
  matches, without taking any non-layout content from the generator. List any difference kept on purpose in the
  change's notes. Verify: the script reports every room as a match, or each listed difference is approved by the user.
- [ ] 2.4 Make `assembleLevel` build `pieces` from `layout` plus doors, then remove the stored `pieces` from room files
  and add `layout` to the level validator and `src/data/types/level.ts`. Verify: the assembled `pieces` equal the
  phase 1a pieces per room (test), and `npm test -- src/world/slice01.test.ts` passes.
- [ ] 2.5 Add a test that every numeric light slot points at the same fixture position as before the change. Verify:
  the test passes and fails when the ceiling order is reversed.
- [ ] 2.6 Delete `scripts/gen-slice01.mjs`, update docs that mention it, and delete the level-generator-drift memory note.
  Measure the shell build time once on load. Verify: `grep -rn gen-slice01` finds only archived changes, and the build
  time is under 5 ms.
- [ ] 2.7 Playtest per `docs/PLAYTEST.md`: walk R02, R04 (Lab B), R08, R11, R15b and R16b and compare against
  screenshots taken before 2.4. Verify: no missing or extra walls, floors or fixtures. Close the browser afterwards.

## 3. Phase 2: cast, creature and pose folders (Sonnet 5.5, medium)

- [ ] 3.1 Quiet-window check for `poses.json`, `body-models.json`, `motion-profiles.json`, `blade-creature.json`,
  `src/data/mocap/`, `src/data/creatures/`. rebuild-heins-rig and keep-crossed-arms must have landed. Verify: as in 1.1.
- [ ] 3.2 Add a combining loader for pose files that builds one pose table and fails on a duplicate name, naming both
  files (design D5). Verify: unit test for the merge and for the duplicate error.
- [ ] 3.3 Write a one-time split script: character-prefixed poses to `cast/<name>/poses.json`, `blade_*` to
  `creatures/blade/poses.json`, the rest to `poses/<family>.json`. Named bodies to `cast/<name>/body.json`, profiles to
  `cast/<name>/motion.json`, `blade-creature.json` to `creatures/blade/creature.json`, juggernaut files into
  `creatures/juggernaut/`. Verify: merged tables `deepStrictEqual` the old files.
- [ ] 3.4 Point `scripts/bake-mocap.mjs` at `cast/<name>/mocap.json` and regenerate the pack import table. Verify: a bake
  dry run writes to the new paths, and `npm run build` still shows one chunk per pack.
- [ ] 3.5 Switch every reader (`bodyModelLibrary.ts`, `animator.ts`, `bladeTestKit.ts`, pose and motion loaders, the cast
  motion sandbox) and delete the old files. Fix the comments that name old paths (`castLooks.ts`, `animator.ts`).
  Verify: `grep -rn "poses.json\|body-models.json\|motion-profiles.json\|blade-creature.json" src scripts docs` finds only
  updated references, `npm run typecheck` passes, and the touched test files pass.
- [ ] 3.6 Update `docs/mocap-sources.md`, `docs/cast-motion-sandbox.md`, `docs/voice-casting-standard.md` (body
  gender lookup) and the AGENTS.md map. Verify: every documented path exists. Open the cast motion sandbox once and
  close it.

## 4. Phase 3: sound area files (Sonnet 5.5, medium)

- [ ] 4.1 Quiet-window check for `src/audio/sounds.ts`. Verify: as in 1.1.
- [ ] 4.2 Split `SOUND_SPECS` and `SAMPLE_URLS` into `src/audio/sounds/<area>.ts` files along the existing section
  comments, with a hand-kept `index.ts`. `sounds.ts` re-exports it (design D6). Verify: `npm run typecheck` passes, and
  `SoundName` still rejects an unknown name (a `@ts-expect-error` line in a test).
- [ ] 4.3 Add a test that no sound name appears in two area files. Verify: it passes, and fails when a name is copied
  into a second area.
- [ ] 4.4 Update `docs/audio-assets.md` and the AGENTS.md map to say where a new sound goes. Verify: the audio test
  files pass (`npm test -- src/audio/`).

## 5. Phase 4: set pieces out of level.ts (Opus 5.5, high)

- [ ] 5.1 Quiet-window check for `src/world/level.ts` and the sequences that drive the moved scenes (`drop.json`, the
  flood and cart sequences). Verify: as in 1.1.
- [ ] 5.2 Define the `SetPiece` interface and level handle, and the hand-kept `src/world/setpieces/index.ts` (design D7).
  Verify: typecheck passes with an empty list.
- [ ] 5.3 Move the Lab B floor break into `setpieces/labBFloor.ts`. Verify: the Lab B tests and `quiet.test.ts` pass, and
  the drop plays the same in the browser.
- [ ] 5.4 Move the flood's swinging fixtures and sparks. Verify: the flooded-tunnel tests pass, and R09/R10 look and
  sound the same in the browser.
- [ ] 5.5 Decide whether the after-groups and kill-aftermath props are a set piece or a generic mechanism (design open
  question) and move them or leave them. Note the decision in design.md. Verify: the cart slam tests pass.
- [ ] 5.6 Add a test that `level.ts` contains no room ids or scene names, and update the AGENTS.md map. Verify: the test
  passes. Run `npm test` once with the default concurrency, then do a full playtest per `docs/PLAYTEST.md`, closing
  the browser afterwards.

## Workflow follow-up

- Sync the `content-layout` spec and archive the change after phase 4 lands (or archive after phase 3 and move
  phase 4 into its own change if it stalls).
