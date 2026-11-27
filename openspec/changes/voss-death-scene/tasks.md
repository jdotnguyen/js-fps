# Tasks

## How to run this change

Run one section per session. Before each section, run `/clear`, set the model and effort named in its heading
(`/model`, `/effort`), then run `/openspec-apply-change voss-death-scene` and name the section. Don't start a second
section in the same session. If a session grows long inside a section, use `/compact`, not `/clear`. Before ending a
section, write anything the next section needs (times, take choices, anchor names) under "Section notes" in
`design.md`, name any uncommitted files, and offer to commit the section's files (see the shared-checkout commit note).
Run `/clear` only after that.

Section order: 1, then 2, then 3 and 4, then 5, then 8, then 9. Sections 6 and 7 can run any time after 1, each in its
own session.

**Gates, checked at the start of every section.** Run `git status`, `git log --oneline -15` and `openspec list`. Stop
and tell the user which change or file is blocking if:

- `keep-crossed-arms` is not committed. It was committed as a209f41 and archived on 2026-11-26, so this check should
  pass.
- The section edits `R03.json` or `R04.json` (sections 4, 5 and 7) and `split-level-data` phase 1b is not committed.
  Phase 1b is the work that adds `layout` to the room files and deletes `scripts/gen-slice01.mjs`.
- `split-level-data` phase 2 or 4 is in progress: some of its tasks are ticked but not all of them, or its files are
  dirty. If a phase is fully committed, use its new paths (design D14). Phase 3 (sound area files) is committed.
- A file the section edits has uncommitted hunks from another change.

## 1. Fixed clock and drop deadlines (Sonnet 5.5, high)

- [x] 1.1 Check the gates. Verify: each gate passes, or the user is told what blocks.
- [x] 1.2 Add `clockT` to `KillRun`: the time since the first beat after `scratch` began, summed from the same `dt`
  (design D1). Verify: a `killRun.test.ts` case shows `clockT` is 0 when `panic` begins and stops while `update` is not
  called.
- [x] 1.3 In `kills.json` `grownInside`, make `panic` (4.6 s), `glass` (3.6 s) and `still` (1.8 s) `until: time`.
  For now, keep `toGlass`, at a speed that gets her to the glass by 4.0 s. Verify: `npcKills.test.ts` cases for the
  infection-kills "fixed clock" scenarios pass: two runs with scratch ending at 3 s and at 12 s, runs at 30 and 144 fps,
  and a run with the scream missing, all giving the same beat start times to within one frame. The existing Lab B
  tests still pass.
- [x] 1.4 Change the `drop.json` beat waits as design D7 describes. Verify: a `src/script/quiet.test.ts` case with
  Okafor's question ending 12 s into the drop shows "She's seizing", the flicker, the alarm and the post-burst lines
  each starting on their beat (gallery-drop "The drop's lines and lights follow her clock").
- [x] 1.5 Update the Lab B drop entry in `docs/PLAYTEST.md`: the beats after Okafor's question now run on a fixed
  clock. Verify: `npm run typecheck` passes, and `npm test -- src/ai/killRun.test.ts src/ai/npcKills.test.ts
  src/script/quiet.test.ts` passes.

## 2. Clips that travel, planted feet, footsteps (Opus 5.5, high)

- [x] 2.1 Check the gates. Verify: as in 1.1.
- [x] 2.2 Add beat `track` segments (clip with `from`/`to`/`speed`/`blend`, or a pose) to `src/data/types/kills.ts`,
  `KillRun` and the humanoid kill-clip path, with `clip` kept as shorthand (design D2). Verify: unit tests cover segment
  order, blends, holding the last frame, and a missing clip falling back to the beat's poses with one warning.
- [x] 2.3 Add beat `route` (design D3): marks with times, facing, clips playing in place, and instant placement at the
  last mark. Verify: tests for the infection-kills "On her marks", "No snap" (at most 0.15 m per frame at 60 fps) and
  "Clip missing" scenarios, and for "A route beat moves her".
- [x] 2.4 Add the route speed check that warns when a segment is more than 35% off its clip's own root speed. Verify:
  a test triggers the warning once and stays silent within range.
- [x] 2.5 Add the `touch` event (design D4) for hands, hips, knees and chest. Verify: tests on Voss's body and on a
  second female body model show the part within 5 cm of its mark during `hold`, and a release with no pop (under 3 cm
  per frame).
- [x] 2.6 Lock her feet from clip contacts during route beats, with the overstretch release (design D5). Verify: tests
  for the "Planted foot" scenario: under 3 cm of drift while in contact, sole within 2 cm of the floor, and no change to
  beats without a route.
- [x] 2.7 Fire footsteps from kill-clip contacts through the NPC footstep path. Verify: a test for "Footsteps heard"
  counts one footstep per landing, at the landing frame, with the floor's surface.
- [x] 2.8 Document `track`, `route` and `touch` in `src/data/types/kills.ts`'s doc comments and in the one-shot clips
  paragraph of `docs/mocap-sources.md`. Verify: `npm run typecheck` passes, and `npm test -- src/ai/killRun.test.ts
  src/ai/npcKills.test.ts src/actors/animator.test.ts` passes.

## 3. Holding it together (Opus 5.5, high)

- [x] 3.1 Check the gates. Verify: as in 1.1.
- [x] 3.2 Pick the laboured-wait take from the design's candidates, following `docs/mocap-sources.md`. Fetch it with
  `mocap-fetch`, add it to `scripts/mocap.sources.json` in the `voss` pack, and bake it (if `zombie_walk.glb` is still
  missing, bake through a temporary manifest). Credit it in `CREDITS.md`. Verify: the per-clip diff shows only Voss's new
  clip changed, and `npm test -- src/actors/mocapPosture.test.ts` passes for it.
- [x] 3.3 Add the looping clip segment and the arm-only `layer` (design D6), and the `look` kill event for glances.
  Verify: unit tests show joints outside the layer following the base clip exactly, and the head turning to the target
  within its hold.
- [x] 3.4 Rewrite `scratch`: the base clip, the arm-only scratch poses (rework the arms of `kill_scratch_0`/`_1` in
  `poses.json`), glances at the player and squad, and no head kicks. Verify: tests for the gallery-drop "Only her hands
  are fast" (hand at 3 Hz or more, head and hips at 0.3 m/s or less) and "She looks at them" scenarios.
- [x] 3.5 Add her hunched, arm-holding pose to `poses.json` and set it from `drop_approach`. Verify: a
  `src/script/quiet.test.ts` case for "Hunched before Jay arrives" covers both arriving after the rounds and loading a
  save from between the rounds and the drop.
- [x] 3.6 Review the wait in the cast motion sandbox (`docs/cast-motion-sandbox.md`) and in a private
  `npm run playtest:serve` build with the user. Verify: the user approves, and every server and browser opened is
  closed.

## 4. The staged run and the collapse (Opus 5.5, high)

- [x] 4.1 Check the gates, including that phase 1b is committed. Verify: as in 1.1.
- [x] 4.2 Pick and bake the stumble, recovery and hurt-walk takes as in 3.2, and credit them. Verify: as in 3.2.
- [x] 4.3 Add the contact and collapse poses to `poses.json` (bench hit, sweep, doubled over, push off, knee down, cart
  grab, cart pull, pane slide, `corpseGlassSlump`). Keep the names `kill_glass_0` and `kill_glass_1`. Verify: the pose
  validation tests pass, and the blade creature's pose map still resolves.
- [x] 4.4 Add the route and contact anchors to `R04.json` (bench edge, push off, stumble, knee, cart handle,
  `voss_rest`), keeping clear of the bench, the gurney and the cart. Verify: `npm test -- src/world/slice01.test.ts` and
  the slice walk tests pass.
- [x] 4.5 Write `panic` as design D1 describes: track, route, touches, kicks, and `sweep`/`tip` events with no prop
  effect yet (section 5 wires them). Drop `toGlass` and `knock` from it. Verify: tests for "The actions in order",
  "Contacts touch" (5 cm) and "Nothing walked through" (sampled against the headless slice's R04 colliders).
- [x] 4.6 Write the `still` collapse (design D13), and limit the lean onto `glass.stand` to `glass` and `arch`. Verify:
  tests for "Down the pane", "Room for the creature" (0.3 m), and "Restored in place" (5 cm). The palm print, clear
  band and pounding tests still pass.
- [x] 4.7 Tune the D1 times with the user in a private `npm run playtest:serve` build (`?debug&slot=scratch`), and record
  the final times in design.md's section notes. Verify: the user approves the run and collapse, the fixed-clock tests
  still pass with the final times, and every browser opened is closed.

## 5. Props on cue (Opus 5.5, high)

- [x] 5.1 Check the gates, then read `docs/physics.md`. Verify: as in 1.1.
- [x] 5.2 In `R04.json`, make the bench glassware loose with `after` poses (`labb_bench`), make the cart kinematic with
  an `after` pose (`labb_cart`), and give its load `after` poses (`labb_cart_load`). Verify: the physical-interaction
  tests "At rest before the kill", "Her bench" and "Seen from the gallery with physics off" pass, and so do the slice
  walk tests.
- [x] 5.3 Add the `tip` event (design D8), and burst or lay out the cart's load when it starts. Verify: a test for "The
  cart on its frame" shows the same start frame and rest pose with physics on and off.
- [x] 5.4 Add the `sweep` event (design D9). Verify: tests for "Played kill" (nothing ends inside the bench, the floor
  or the glass) and "Physics off" (the objects appear at their `after` poses at the sweep).
- [x] 5.5 Lay out all three groups in a skipped or restored kill. Verify: tests for "Restored kill" and "Restart before
  the kill", plus a `quiet.test.ts` restore case.
- [x] 5.6 Duck the impact sounds of objects a scripted crash throws (design D10). Verify: an `src/audio/impacts.test.ts`
  case shows ×0.35 during the 1.5 s window and full gain after it.
- [x] 5.7 Check both physics modes in a private `npm run playtest:serve` build. Verify: the cart and bench behave as the
  spec says in both modes, and every browser opened is closed.

## 6. The scream jaw (Sonnet 5.5, high)

- [x] 6.1 Check the gates. Verify: as in 1.1.
- [x] 6.2 Add the pure loudness envelope function in `src/audio/` (design D11). Verify: a unit test with a made-up
  buffer (tone, gap, tone) gives the expected envelope, attack and release.
- [x] 6.3 Drive the jaw from the envelope for a kill victim's `scream` lines in `speechActing.ts`, with the tremble and
  the no-recording fallback. Verify: tests for "Peak of the scream" (80% or more), "A breath in the scream" (under 30%
  within 0.1 s) and "No recording". Other speakers' screams are unchanged.
- [x] 6.4 Look at the scream in a private `npm run playtest:serve` build. Verify: the user approves, and every browser
  opened is closed.

## 7. Sealed observation glass (Sonnet 5.5, high)

- [x] 7.1 Check the gates, including that phase 1b is committed. Verify: as in 1.1.
- [x] 7.2 Grep every reader of `acoustic`, widen it to `'glass' | 'sealed'`, and let `wall_glass_partition` take
  `wallParams.acoustic` (design D12). Verify: tests show a sealed pane still clips gore and still has glass friction.
- [x] 7.3 Add the `'sealed'` occlusion result and `occlude: 'sealed'` for kill and sequence sounds, and mark the three
  `R03.json` sides. Verify: `src/audio/occlusion.test.ts` cases for "Intercom off", "Hands on the pane" (a source 0.3 m
  from the pane is not sealed-muffled) and "Other glass unchanged", and the in-world-audio "Scripted kill behind sealed
  glass" scenario.
- [x] 7.4 Add the `'sealed'` voice portal state and mark the gallery-to-Lab B portal in `level.ts`. Verify:
  `src/audio/voicePath.test.ts` cases show sealed costing at least as much as a closed door, and the voice-playback
  "Voss behind the sealed glass" scenario holds (her subtitle still shows through the intercom).
- [x] 7.5 Update `docs/modular-grid-standard.md` (the `wallParams.acoustic` field) and listen to the drop from the
  gallery with the user in a private `npm run playtest:serve` build. Verify: for "Lab B through the intercom", the user
  hears Lab B mainly through the intercom; every browser opened is closed; `npm test -- src/audio/` passes.

## 8. Designed sounds and her voice (Sonnet 5.5, medium)

- [x] 8.1 Check the gates. Verify: as in 1.1.
- [x] 8.2 Generate the bench sweep, cart crash, body into the bench, knee to the floor, palms on the glass and her scuffs
  with ElevenLabs, following `docs/audio-assets.md`, and add them to `samples` in `src/audio/sounds/kills.ts`. Verify:
  the audio asset tests pass, and each file is within the doc's size limits.
- [x] 8.3 Record her gasps and grunts in her existing `crew_lab` voice, following `docs/voice-casting-standard.md`.
  Copy each raw batch take to `previews/vo-batches/voss-death-scene/` as soon as it is generated. Verify: the VO checks
  in that doc pass, and the takes are in the shipped sound list.
- [x] 8.4 Put the sounds on their D1 times in `kills.json`, replacing the stand-in ids. Verify: an `npcKills.test.ts`
  case shows each sound firing at its time and none missing. Credit every new sound in `CREDITS.md`.

## 9. The whole drop (Opus 5.5, medium)

- [ ] 9.1 Check the gates. Verify: as in 1.1.
- [ ] 9.2 Play the drop in a private `npm run playtest:serve` build four times: with the squad close and far, and with
  physics on and off. Log the beat times against `clockT`. Verify: the beat times match to within one frame across the
  runs, and the user approves the scene; every browser opened is closed.
- [ ] 9.3 Check each scenario in this change's specs against a test or the 9.2 runs, and list any not covered. Verify:
  the list is empty, or the user accepts each item on it.
- [ ] 9.4 Run `npm test` once at the default concurrency and `npm run build`. Verify: both pass, apart from failures
  that also fail on a clean export of HEAD, which are listed.

## Workflow follow-up

- After the user approves 9.2, sync the specs and archive the change. Then tell the user that `split-level-data` phase 2
  is no longer blocked by this change.
