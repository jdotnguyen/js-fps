# Tasks

## 1. Check the level data

- [x] 1.1 Confirm against `src/data/levels/slice01.json` which room owns Hale's desk, the office doorway cells and the corridor outside, and record the room id for `admin_hale`. Verify with a throwaway `level.roomAt` probe at those points (not committed), or the test in 4.1. (Room is `R14c`, Director's Office: cells x 50-54, z 2-10. The glass door `D_R14b_R14c` sits in `R14b`'s cell, so the doorway is the wall plane at x=50 and nothing needs widening. The real-level test in 4.1 confirms it.)

## 2. Speech: stop a channel

- [x] 2.1 Add `SpeechManager.stopChannel(channel)` in `src/dialogue/speech.ts`: end the current line with `'stopped'` (subtitle hidden), drop the queue, remove the lane; unknown channel is a no-op. Verify in `src/dialogue/speechChannels.test.ts`: a playing line stops with its subtitle hidden, queued lines resolve `'stopped'`, and other channels keep playing.
- [x] 2.2 Update the header comment in `speech.ts` to say Jay's earshot drop applies to scenes that are not tied to a room. Verify it matches `dialogue-channels`.

## 3. Sequences: a room-bound scene

- [x] 3.1 Add optional `room` to `SequenceDef` (`src/script/types.ts`) and its validator (`schema.ts`), rejecting a non-string. Verify with schema tests for accept and reject.
- [x] 3.2 In `SequenceRuntime.update` (`src/script/runtime.ts`), end a live run as cancelled when `host.inRoom('player', def.room)` is false, and call the host to stop the run's speech channels (`seq:<id>` and `seq:<id>:*`) first. Verify in `src/script/script.test.ts` with a fake host: leaving mid-line stops it, queued lines never start, and a sequence without `room` is untouched.
- [x] 3.3 Release the NPCs the scene had posed or pointed at the player, so they idle when it ends early, reusing the existing release path if one exists. Verify with a test that Hale's gesture and look-at are cleared after the scene ends.
- [x] 3.4 Load-time check that a sequence `room` names a room in the level; warn like other bad room ids. Verify with a test using an unknown id.

## 4. Hale's office and the walk-by researcher

- [x] 4.1 Add `"room": "<id from 1.1>"` to `admin_hale` in `src/data/sequences/rounds.json`. Verify with a test against the real level (`src/world/slice01.test.ts` or a new `src/script/scenePresence.test.ts`): at the desk and in the doorway the scene runs; stepping to the corridor ends it with Jay's line never said and Hale silent.
- [x] 4.2 Cover coming back: after the scene ends early, re-entering the office does not restart it, and the `admin_card` exchange still completes the Admin round. Verify in the same test file.
- [x] 4.3 End a room scene by skipping what is left of it (`SequenceManager.endScene`), and bind `researcher_walkby` to `R02` in `rounds.json`. Verify in `src/script/scenePresence.test.ts`: Jay stays, both greetings play; Jay leaves before or between greetings, he says nothing more, `researcher_a` is despawned and `researcher_walkby_seen` is set.

## 5. Docs and playtest

- [x] 5.1 Add a short "Room-bound scenes" note to the sequence authoring doc (`docs/` file that describes sequence fields; add to `docs/PLAYTEST.md` if none), saying when to use `room` and that it ends the scene for everyone. Verify the field name and behavior match the doc.
- [x] 5.2 Run the touched tests (`npm test -- src/dialogue/speechChannels.test.ts src/script/script.test.ts`, plus the new file) and `npm run typecheck`. Verify they pass.
- [x] 5.3 Playtest Hale's office and the Commons walk-by in the browser on a scratch slot (`?slot=scratch`): walk out mid-line, mid-Jay-line and just before the door closes; confirm the voice, subtitle and posing stop, then return and confirm nothing restarts. Reuse a running dev server and close the tab afterwards. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.
