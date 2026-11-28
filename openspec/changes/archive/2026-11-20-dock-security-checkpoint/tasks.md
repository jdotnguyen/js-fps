# Tasks

## 1. Checkpoint props

- [x] 1.1 Add `metal_detector`, `rail`, `staff_gate` and `tray_table` to `src/world/kit/slice.ts`. The arch needs a 1.0 m clear opening, a solid box per post and a light bar that reacts to `detector:scan`. Verify with a kit test: a pass shows green, an alarm shows red and then idles, and the opening is at least 1.0 m wide.
- [x] 1.2 Add the `cctv_wall` prop: five feeds on one canvas plus a `feed:<id>` plane for the live tile. Verify with a test that a `camera:feed` event changes only the live tile, and that the prop adds at most two screen draw calls.
- [x] 1.3 Register the new prop kits wherever the kit manifest and validator need them. Verify `npm run typecheck` passes and `core/validate.test.ts` still passes.

## 2. R01 layout

- [x] 2.1 In both `scripts/gen-slice01.mjs` and `src/data/levels/slice01.json`, add the counter's return leg, the desk and the CCTV wall (removing `security_monitor`), the detector line with its gate and tray, and the new anchors `arch`, `arch_scan`, `guard_post` and `arch_exit`. Move `walkby_stop`, `walkby_queue`, `post_okafor` and `post_giles` (now the station-side waits) to their new spots. Verify by regenerating with the generator, which must produce no diff against the hand-edited JSON for R01.
- [x] 2.2 Add `slice01.test.ts` cases for the `dock-checkpoint` scenarios: the route from dock to corridor passes the arch, there is no other gap of 0.8 m or more, Jay can leave the booth by its east side without crossing the line, and the line stays under 1.2 m except the arch. Update the ADR-0017 anchor list. Verify `npm test` passes.
- [x] 2.3 Check R01's draw calls with the level debug overlay, take screenshots from `post_front` and the dock door at eye height with and without `?nopost`, and confirm the window frame of the sub is unblocked. Verify the room meets the surface-dressing definition of done (§7) and stays under 60 calls. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.

## 3. Dock guard

- [x] 3.1 Add the `dock_guard` NPC to R01 (body `guard1`, at `guard_post`), add him to `STORY_NPCS`, and move the Commons `wall_1` NPC to another crew body. Verify with `crewBodies.test.ts` (exactly one `guard1` in slice01) and an ambient-life test that the guard is never chosen to wander.
- [x] 3.2 Generalise `actors/heldProps.ts` from the mug regex to a pose-to-item table and add a procedural wand. Verify with a test that mug poses still show the mug and the wand poses show the wand.
- [x] 3.3 Hand-key the `arms_out`, `idle_wand`, `wand_up` and `wand_down` poses in `src/data/poses.json` (the script chains `wand_up` and `wand_down` into the sweep). Verify them in the poses sandbox on the `guard1` body and a crew body, and check that `placedPoses.test.ts` passes. **Closed 2026-11-27:** found in the code or data; any check it asks for has no recorded run.
- [x] 3.4 Add the `crew_guard` speaker and the guard's lines (intro scan prompts, the clear, the sigh at Giles, and 2–3 free-play reactions), plus Giles's multitool alarm exchange and Okafor's dry line, to `slice01.json` dialogue. Verify the dialogue library test resolves every line.
- [x] 3.5 Add the sound ids `archPass`, `archAlarm` and `wandBeep` to the sound registry following the `establish-audio-spec` asset rules, and add their attribution to `CREDITS.md` once the user supplies the files. Verify that a missing file only logs a warning, without throwing.

## 4. Intro script through the checkpoint

- [x] 4.1 Author the new walks with `npm run walks:suggest` (Okafor and Giles, dock → counter and counter → arch → wait; the re-authored counter walks; the first leg of `intro_jay_kitchen`) and paste them into both level files. Verify `slice01Walks.test.ts` passes.
- [x] 4.2 Rewrite the opening half of `intro_shift_change.json` to the beat order in design.md §7: Ruiz's full scan, Sung's quick pass, Okafor and Giles one at a time, Giles's alarm, and the station-side banter. Verify `slice01ScriptedWalks.test.ts` passes for every move.
- [x] 4.3 Update `intro.test.ts` for the new arrival order (counter, then arch, then Commons, one at a time), the alarm on Giles and a pass for everyone else, and the guard ending back at `guard_post`. Verify `npm test` passes.
- [x] 4.4 Add skip end-state tests: skipping mid-scan and mid-walk ends in the same state as a full watch (positions, flags, `cp_intro`, lines played, mug in hand, guard in `idle_wand`). Verify `npm test` passes.

## 5. Walk camera

- [x] 5.1 Add `target: "heading"` to `playerFrame` (schema, host, `Player`). The target is the walk follower's steering point at eye height, or the last heading when no walk runs. Add `hold` and `returnTime` to framing, keeping the current 6° behaviour as the default. Verify with `player.frame.test.ts` tests: the view follows a 90° route turn with the mouse still, is limited to ±35° and ±26°, holds for 0.5 s and then settles, existing 6° shots behave as before, and reduced motion slows the turns.
- [x] 5.2 In the intro, replace the speaker shot before the kitchen walk with the heading shot at the moment Jay leaves the booth, and go back to speaker shots once Jay walks into the Commons (Bram's greeting waits for that moment). Keep Priya's mug offer as a 6° framed shot. Verify with `intro.test.ts` tests that the walk runs the heading shot, speaker shots start at `trigger:commons_enter`, and the mug offer is framed.

## 6. Free-play arch

- [x] 6.1 Add a trigger box on the arch and a short `dock_arch` sequence. When the guard is on post and Jay is armed, the arch alarms and the guard reacts once per pass, at most once per 20 s. When Jay is unarmed, it shows a pass. If the sequence `if` step can't test whether Jay is armed, add a host condition for it. Verify with a `quiet.test.ts`-style headless test covering the three `dock-checkpoint` free-play scenarios.

## 7. Integration check

- [x] 7.1 Play the intro in a browser on a new game: watch it through, then skip it at 0%, mid-scan, mid-walk and at the hand-off. Time it, and confirm the arrivals never bunch at the arch, the walk view faces the route with leeway, and the bars come and go correctly. Verify `npm test` and `npm run typecheck` pass and note the timing in this file.
  - Done as Justin's playtests through several rounds (arrival timing, collisions, the walk camera, the kitchen entry). Skip end states are covered by `intro.test.ts` (start, mid-scan, mid-alarm, mid-walk). The intro wasn't timed with a stopwatch.

## 8. Retire ADRs (only after `establish-audio-spec` is archived)

- [x] 8.1 Compare what's left of ADR-0017 against `specs/intro-sequence` and `specs/dock-checkpoint`. Add any requirement not yet covered to the specs, then delete `docs/adr/0017-intro-cutscene.md`. Verify that every decision in the ADR maps to a requirement before deleting.
- [x] 8.2 Remove the dock and intro sections now covered by specs from ADRs 0014, 0023, 0026, 0028 and 0029, leaving their other content intact. Verify by checking that each removed passage has a matching spec requirement.
- [x] 8.3 Update `docs/adr/README.md`, repoint the source comments and doc links that cite ADR-0017 to `openspec/specs/intro-sequence`, and adjust the AGENTS.md note on where intro decisions live. Verify that `grep -rn "ADR-0017" src scripts docs` returns nothing.

## Workflow follow-up

- Archive the change once the integration check passes, so the two specs land in `openspec/specs/`.
