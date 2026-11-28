# Tasks

## 1. Baseline and script

- [x] 1.1 Get the user's approval of the script in design.md D7, folding in any edits, before any voice request; verify the approved text is what design.md shows
- [x] 1.2 Before changing anything, record decoded audio memory and JS heap in the Commons after all clips have loaded, using `?slot=scratch&memprobe`; verify the figures are written into design.md

## 2. Background priority

- [x] 2.1 Add the `background` priority and the speech manager's yielding, drop, `speaking()` and 6 m subtitle rules (design D3, specs `dialogue-channels` and `voice-playback`); verify with new cases in `speechChannels.test.ts` covering each scenario, and that bark and hint tests still pass
- [x] 2.2 Keep background lines out of the listen-look and the conversation camera (design D4); verify a test shows bystanders and the view unmoved while the speaker's body still speaks, and that music is not ducked

## 3. Overheard director

- [x] 3.1 Add `src/data/overheard.json`, its validator and the 24 lines in `commons_overheard.json` with their `audio` paths; verify a test checks line ids, groups, speakers and phases, and `npm test -- src/dialogue/library.test.ts src/ai/speakerBodies.test.ts` passes
- [x] 3.2 Build the director's start, one-at-a-time, once-only, early-end and drop rules (design D5, spec `in-world-audio`); verify unit tests with fake speech and flags cover each exchange scenario
- [x] 3.3 Suspend a chat group's filler turns during its exchange and keep both voiced pairs from wandering until the drop; verify tests show no filler speech mid-exchange and both pairs in place after five simulated minutes
- [x] 3.4 Wire the director into the session, including the running-Commons-scene check and reset on new game; verify a test that a heard exchange stays heard after saving and loading a checkpoint

## 4. Murmur

- [x] 4.1 Build the murmur controller (design D6): per-group loops, fades, make-way levels, room propagation, game mode and the drop cut-off; verify unit tests with a fake audio surface cover each murmur scenario
- [x] 4.2 Add three murmur recordings (CC0 first, otherwise `ambience:generate`), register them, credit any not generated and wire the controller into the session; verify `npm run audio:audit` passes

## 5. Voices

- [x] 5.1 Audition the four voices, add them to `scripts/lib/voCast.ts` and the table in `docs/voice-casting-standard.md`; verify the user approves the voices and `npm test -- scripts/lib/voCast.test.ts` passes
- [x] 5.2 Generate the 24 clips with `vo-generate.ts --ids ... --apply` and listen to every flagged one; verify all 24 files exist and `vo-trace.ts` reports none off their pinned model

## 6. Integration

- [x] 6.1 Run `npm run typecheck` and `npm test`; verify both pass. Done 2026-11-25: typecheck passes; `npm test` 1950 of 1966, the 16 failures all also fail on the clean commit `a97d09c` and the user accepted them
- [x] 6.2 Play from New Game to the drop on headphones, lingering at both pairs before and after the briefing, walking away mid-line, and listening during the radio, the walk-by and from the neighbouring rooms; tune levels and timings, add the steps to `docs/PLAYTEST.md`, and verify the user accepts the mix
- [x] 6.3 Repeat the memory measurement from 1.2 and record both figures and the difference in design.md, giving the reason if decoded audio rose by more than 15%
