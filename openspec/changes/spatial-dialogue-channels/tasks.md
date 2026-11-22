# Tasks

## 1. Speakers play from their bodies

- [x] 1.1 Add `director → hale` and `crew_maint → maint_1` to `SPEAKER_NPC` in `src/ai/speakerBodies.ts`. Resolve `crew_botanist` to the nearest living `botanist_*` in `speakerHeadAt` (`src/main.ts`). Verify in the browser that Hale's office lines come from his head and fade as you step out of the doorway.
- [x] 1.2 Add a `DISEMBODIED` speaker set and a slice01 test that fails, naming the line and speaker, for any local line whose speaker has no NPC in the level and isn't listed. Verify with `npm test -- src/world/slice01.test.ts`.

## 2. Voice propagation

- [x] 2.1 Build the level's room graph (door edges from `between`, glass edges from declared glass pairs) and add `voicePath(from, to)` returning boundaries, closed doors, glass and path length (design D2). Verify with unit tests on a small test level: same room, open door, closed door, glass, three-boundary cut-off and the open route preferred over a closed one.
- [x] 2.2 Add `audibility(path) → { gain, cutoffHz }` and its constants beside the existing ones in `src/audio/occlusion.ts`. Verify in `occlusion.test.ts` that gain is 0 at three or more boundaries or past 30 m, a closed door matches the wall cutoff, and glass matches the `GLASS_*` values.
- [x] 2.3 Add `setAudibility(gain, cutoffHz)` to `VoicePlayback`, with ramped gain and low-pass after the panner. Raise the panner's `maxDistance` and keep the reverb send after the new nodes (D5). Verify in `voicePlayer.test.ts` with the fake audio context that the nodes ramp and a muted voice sends no reverb.
- [x] 2.4 Update `docs/` audio notes if they describe dialogue as unoccluded. Verify by grepping `docs/` for the old wording.

## 3. Channels in the speech manager

- [x] 3.1 Replace `current`, the global queue and the overlap lane in `SpeechManager` with per-channel state. Add a `channel` key to `say` (unkeyed calls go to `default`), with an `overlap` call getting a one-off channel (D1). Verify in `speech.test.ts`: two channels play at once, one channel keeps its order and the 0.15 s gap, and the PA still overlaps.
- [x] 3.2 Add speaker exclusivity across channels (D3). Verify in `speech.test.ts` that a Sung line on a second channel starts right after his current line and his first channel resumes afterwards.
- [x] 3.3 Add the injected `audibilityOf`, earshot (above about −40 dB, with radio and PA always in earshot), the Jay drop rule, and a `speaking()` that reports only in-earshot lines (D4). Verify in `speech.test.ts`: Jay's line is dropped when the channel's last speaker is out of earshot, a Jay monologue still plays, and `stopAll` and `onlySpeakers` act on every channel.
- [x] 3.4 Pass the sequence run as the channel from the `say` action (`src/script/actions.ts`, `host.ts`, `gameHost.ts`). Give barks, hints, guidance and chatter their own keys. Verify with `npm test -- src/script/action.test.ts src/script/quiet.test.ts`. Also check that the intro and quiet-half tests still pass with `npm test -- src/script/intro.test.ts src/script/briefing.test.ts`.
- [x] 3.5 Make barks, hints and guidance wait only for in-earshot story lines (D4). Verify in `barks.test.ts` and `hints.test.ts` that a hint plays during a far-off scene and a bark waits for, then drops behind, a nearby one.
- [x] 3.6 Make StoryDucker duck only for in-earshot story lines. Verify in `storyDuck.test.ts`.
- [x] 3.7 Update `voice-playback`'s "one voice at a time" wording in the speech manager header and any `docs/` page that describes it. Verify by grepping for "one voice at a time".

## 4. Subtitles follow earshot

- [x] 4.1 In `SpeechManager.update`, evaluate `audibilityOf` per active line and push gain and cutoff to the playback. Emit `subtitle:show` (with remaining duration) and `subtitle:hide` on visibility transitions, using 20 m and earshot, with radio and PA exempt (D5). Verify in `speech.test.ts` by walking a fake listener into and out of range mid-line, and with a close but silent speaker.
- [x] 4.2 Wire `audibilityOf` in `src/main.ts` from `speakerHeadAt`, the camera position and `voicePath`. Verify with `npm run typecheck`.

## 5. Dive-bay stow

- [x] 5.1 Reorder `dive_stow` in `src/data/sequences/rounds.json` so the click, `completeObjective`, flag and `round:complete` come before Sung's line (D7). Rename the `round_dive` title in `src/data/objectives.json` to name the Sample Store. Verify in `quiet.test.ts` that the round completes on the use event while a dive-bay line is still playing.
- [x] 5.2 Verify in `quiet.test.ts` that trunk secure runs right after Sung's dive-bay lines while another scene's line is still playing elsewhere.

## 6. Integration playtest

- [ ] 6.1 Playtest using `docs/PLAYTEST.md`, reusing the running dev server and `?slot=scratch`. Trigger Hale's office scene, leave mid-scene and walk to the dive bay. Confirm that Hale goes silent with no subtitles, Sung starts on cue, the stow completes on E during his lines, and two nearby conversations both show subtitles. Close the tab when done.
- [ ] 6.2 Run `npm test` and `npm run typecheck` before opening the PR.

## Workflow follow-up

- Propose a separate change for the sample-case handoff cutscene: a Jay → NPC give action, an NPC holding the case and a stow animation.
- Archive this change once it's merged and playtested.
