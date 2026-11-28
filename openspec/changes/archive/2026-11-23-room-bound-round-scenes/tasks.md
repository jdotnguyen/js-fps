# Tasks

## 1. Engine: a scene can name several rooms

- [x] 1.1 Add failing cases to `src/script/scenePresence.test.ts` for a two-room scene (stay inside both rooms, move between them, leave both, start while in the second room only); verify they fail today
- [x] 1.2 Let `room` be a string or a list in `src/script/types.ts` and the sequence loader's validation; make `playerLeft` in `src/script/runtime.ts` true only when the player is in none of them, and check each id at load with `hasRoom`; verify the 1.1 cases pass and the existing single-room tests still do

## 2. Bind the round scenes

- [x] 2.1 Set `room` in `src/data/sequences/rounds.json`: `hydro_moment` to `["R12a", "R12b"]`, `dive_moment` to `["R13a", "R13b"]`, `admin_moment` to `R14a`, `hydro_store_moment` to `R12e`; confirm the botanist, Sung and maintenance NPC rooms from the level data first and adjust; verify no load warning about unknown rooms
- [x] 2.2 Add scene tests in `scenePresence.test.ts` using the shipped data: hydroponics stay (all five lines), hydroponics leave before Jay's reply, dive leave mid-Sung with `trunk:secure` still emitted, a scene that would start while the player is outside does not start and keeps `once`, return does not replay; verify they pass
- [x] 2.3 Confirm the speakers go back to idle on early end for the three NPC scenes, by the `releaseNpcs` call in the test log, as `admin_hale` does

## 3. The earshot question

- [x] 3.1 Read the `dialogue-channels` earshot drop and find why Jay's reply was not dropped when the botanist was out of range; record the answer in design.md and either fix it in this change (if it is the same flaw) or open a separate change

## 4. Check

- [x] 4.1 Run `npm test -- src/script/scenePresence.test.ts src/script/runtime.test.ts` and `npm run typecheck`
- [x] 4.2 Playtest at `?slot=scratch`: walk into the grow hall, leave while the botanist is mid-line, and confirm nothing more plays and the botanist goes back to work; repeat for the dive bay; then stay for a full run of each. Reuse a running dev server and close the tab after **Closed 2026-11-27:** no recorded run; the product was accepted as it is.
- [x] 4.3 Add one line to `docs/PLAYTEST.md` for leaving a round scene

## 5. A started line finishes (added after review)

- [x] 5.1 Add `letFinish` to `SpeechManager.stopChannels` and pass it for a scene ending; verify with a `speechChannels.test.ts` case (the queue drops, the playing line ends by itself, other scenes play on)
- [x] 5.2 Update `scenePresence.test.ts` for the lines that used to stop at once (Hale, botanist, assistant); verify they now finish and nothing after them plays
