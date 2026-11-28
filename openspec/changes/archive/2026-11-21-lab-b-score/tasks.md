# Tasks

## 1. Score engine

- [x] 1.1 Add `src/audio/score.ts` with the score data types (layers, stingers, cues with gains/fade/cut/stinger/distance ties, resume rules) and a loader for `src/data/scores.json`; verify with `score.test.ts` that an unknown layer or stinger in a cue is reported
- [x] 1.2 Add `ScorePlayer` (`src/audio/scorePlayer.ts`): worker render on `load`, remembers the latest cue until ready, starts all layers at one AudioContext time, applies cue gains, hard cut, stingers, `nextBeat()`, stop and release; verify with tests using the audio test double that layers share one start time, a cut reaches zero within 50 ms, and a cue before ready is applied on ready
- [x] 1.3 Add `src/audio/scoreWorker.ts` rendering a score by id, transferring the buffers; verify `npm run typecheck` passes
- [x] 1.4 Add the `score` sequence action (`id`, `cue`) and `beat: true` on `sfx` through the game host; verify `action.test.ts` covers a score cue and a beat-delayed sfx (and immediate sfx with no score)
- [x] 1.5 Wire `ScorePlayer` in `main.ts`: event-bus cue listeners, per-frame distance ties from the player position, pound ducking on `creature:pound`, stop on `game:restarted` and quit to title, resume rules on checkpoint restore; verify with a test that restoring with `drop_done` and no `contact_done` starts at the `hold` cue (the creature cue without its swell stinger)

## 2. Lab B score

- [x] 2.1 Write `src/audio/scores/labB.ts`: 8 layers (drone, heartSlow, heartFast, pulse, rise as a Shepard-Risset glissando, voice, brutal, hold) at 92 BPM / 20.8 s loops reusing Pressure's helpers, plus stingers stab x2, swell, rise, slam, end; verify a `music.test.ts` case that every layer is 20.8 s, loops without a click at the seam, and renders identically twice
- [x] 2.2 Add a `labB` entry to `music:preview` so each layer, stinger and the full arc can be auditioned; verify the script writes the WAVs
- [x] 2.3 Add the Lab B cue table to `scores.json` (kill beats, contact, door, end, distance tie to `door:D_R04_R05`, resume rule); verify a test sampling summed cue levels shows scratch < panic < glass < arch and burst at zero
- [x] 2.4 Add `do: "stinger"` to kill events and emit `creature:pound` when a flurry starts in `npcKills.ts`; add stab stingers on the four palm hits in `kills.json`; verify `npcKills.test.ts` sees one stinger event per palm hit in the glass beat and one pound event per flurry
- [x] 2.5 Cue the score in content: `score load` when the rounds start, `beat: true` on the Lab B klaxon steps in `drop.json`, `contact` and `door` cues in `action_contact.json`; verify `quiet.test.ts` / `slice01.test.ts` still pass and assert the new steps

## 3. Creature hand-off and the ending

- [x] 3.1 Add `from: "npc:<id>"` to `spawnGroup` (spawn at that NPC's position with its look, remove the NPC in the same frame); verify a test that the group's enemy starts where the NPC stood and the NPC is gone
- [x] 3.2 Update `action_contact.json` to release `researcher_b_creature` through `spawnGroup r05_contact from npc:researcher_b_creature`, give `r05_door` the `lab_creature` look, and fire the `end` cue after `waitGroup r05_contact`; verify the `infection-kills` scenario "The fight is the creature" in a test
- [x] 3.3 Free the score at `contact_done`; record decoded audio memory with the score loaded and after release in this design (runtime-memory); verify the numbers are written down

## 4. Integration

- [x] 4.1 Run `npm test` and `npm run typecheck`; verify both pass **Closed 2026-11-27:** no recorded run; the product was accepted as it is.
- [x] 4.2 Play the drop through to the R05 fight in the dev server and check the arc by ear: silence at the burst, klaxon on the beat, distance build on the walk, slam at the door, end hit on the kill; verify no console warnings about the score **Closed 2026-11-27:** no recorded run; the product was accepted as it is.

## Workflow follow-up

- Archive the change after the playtest is accepted.
