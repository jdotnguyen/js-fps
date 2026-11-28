# Tasks

Order of work: the room first (1), then the kill engine, glass marks and assets (2-4), then the switch-over to the new scene (5), the stinger (6) and integration (7).

## 1. Room staging

Layout and coordinates: design.md decisions 10-12 and the staging table.

- [x] 1.1 Add a prop-placement check to `src/world/slice01.test.ts` before moving anything: every prop collider in R07, R07a, R08 and R08b lies within its room's inner wall faces, and none lies within 1.2 m in front of `D_R06_R07`, `D_R07_R07a`, `D_R07_R09` or `D_R08_R08b`; verify it fails today on the R07 console bank, the R08 lab bench, the R08b specimen tank and the SEC-07 lockers
- [x] 1.2 Add the `instrument_cart` kit piece to `src/world/kit/slice.ts` (about 1.0 x 0.55 m, top 0.9 m, lower shelf, instrument tray, casters, metal collider, climbable top recorded in `slice01JumpTops.test.ts` if it lands in a reachable space); verify in the kit sandbox that it renders and its collider matches its size
- [x] 1.3 In `scripts/gen-slice01.mjs`, replace the east medbay pane with `D_R07_R08` (`glass_slide`, sealed, `text: 'lockdown'`) and add it to the 1.1 door check; leave the other two panes and their `glass_blood` props as they are so the current scene keeps working; regenerate `slice01.json` and verify the door joins R07 and R08 and the current `sec_glass` still plays
- [x] 1.4 Re-stage R07 as in the staging table: the console bank out of the wall with the `cctv_wall` above it, chairs, the SEC-07 lockers on the north wall east of the entry, the last-stand desk with `health_r07`, bodies moved out of the viewing strip, the crate removed, and `r07_glass_jay` / `r07_glass_giles` / `r07_glass_okafor` moved plus the new `r07_medbay_door`; verify the 1.1 check passes for R07 and a level test finds the spine and viewing strip free of colliders
- [x] 1.5 Re-stage R07a: the rack on the east wall facing the door with `shotgun_pickup` on it, the second rack, the storage shelf with `ammo_r07a`, `r07_panel` on the north wall; verify the 1.1 check passes for R07a and a test for "The shotgun is in view" (the pickup is in front of a player standing in the armory doorway, within 30 degrees of the door's normal)
- [x] 1.6 Re-stage R08 and R08b: the cart at about (0, 0, 47.4) with anchors `r08_cart_top`, `r08_grab`, `r08_throw_point`, `r08_reach`; the beds and vitals console on the west wall; the lab bench, shelf and gurney on the south wall; `priya_glass`, `r08_drag_mid`, `r08_drag_turn` re-placed along the lane; the R08b tank replaced by a shelf on the east wall; the R08 light slots set as in the table; verify the 1.1 check passes for both rooms, the "Only the cart in front of the pane" and "Clear lane" scenarios as level tests, and that the stinger's opening frame from `stinger_cam` still shows the bed and `priya_hide`
- [x] 1.7 Sightline: verify that the cart top is less than 2.5 m from `r07_glass_jay` at eye height, and that a raycast from Jay's eye to `r08_cart_top` hits nothing but the centre pane ("Nothing in the way")

## 2. Kill engine: the `mauled` kind

- [x] 2.1 Add `mauled` to `KILL_KINDS`, add the `impacts` beat end, and add the event kinds `pin`, `grip`, `attackerPose`, `haulTo`, `throw` and `slam` with their fields to `src/data/types/kills.ts`; verify that `npm test` passes and that a `kills.json` style using an unknown event fails validation with a clear message
- [x] 2.2 Teach `KillRun` the `impacts` beat end (one tick per slam, with a `max` fallback) and per-impact line lists; verify with new cases in `killRun.test.ts` (three impacts end the beat; a missing slam still ends it at `max`)
- [x] 2.3 Accept `attacker` on the `kill` step in `npcs.ts` / `npcKills.ts`, hold the attacker for the length of the kill, and implement `pin` and `attackerPose`; verify with an `npcKills.test.ts` case where the pinned attacker's hand is within 0.25 m of the victim
- [x] 2.4 Implement the kinematic grip (the victim's root follows the attacker's hand through the gripped joint, clamped to 0.5 m per frame, heading away from the hand) and `release`, as `NpcActor` methods next to `towBehind`; verify with tests for "Hauled by the hair" and "Dragged by the ankle" (gripped joint within 0.1 m over a 3 s walk)
- [x] 2.5 Implement `haulTo` (the attacker walks to an anchor with the grip held, speed capped at 1.4 m/s) and `slam` (windup and impact pose, head held on the target plane for about 0.08 s, kick, spurt, pool, crunch variant, `kill:impact {n}` hook); verify with a test that three slams emit `kill:impact` 1..3 in order on the right frames
- [x] 2.6 Implement `throw` (release, carry the body along an arc to a glass point, contact, slide to the floor) and cut the victim's line on impact with a 0.15 s fade; verify with tests for "Thrown into the pane" and "Silenced by the third slam"
- [x] 2.7 Add a check that blood from a `mauled` kill starts within 0.4 m of the victim; verify with the "Blood starts on her" test
- [x] 2.8 Add the `noticed` field (`kind: 'stare'`, `at`, `hold`, `target`) to `mauled` styles in `src/data/types/kills.ts`, and a `stare` attacker pose in `src/data/poses.json`; verify that a style with an unknown `noticed.kind` fails validation with a clear message
- [x] 2.9 Implement the stare in `KillRun` / `npcKills.ts`: at `at` (or on a `kill:notice` event, whichever comes first) the attacker stops, poses `stare`, turns head and body toward the target's eye, holds for `hold`, then goes on; at most once per kill; later `kill:notice` events are ignored; the approach is time-budgeted so the stare's hold is made up by a catch-up walk capped at 1.4 m/s; verify with `killRun.test.ts` / `npcKills.test.ts` cases for "Brought forward", "Only once" and "Fixed beat clock" (the grab begins at the same time with an early stare and without one)
- [x] 2.10 Update `openspec/specs/infection-kills` behaviour notes in `docs/HANDOFF.md` (kill kinds: three) and verify the doc names `mauled` and its beats

## 3. Glass marks follow contact

- [x] 3.1 Add a `crack` glass mark kind (star decal variants, random rotation, on the pane face) to the gore glass-mark renderer and `glassMark` in `npcKills.ts`; verify in `posesSandbox`/`actorsSandbox` that a crack sits centred within 0.15 m of the given point
- [x] 3.2 Give `streak` a `dir: 'pull'` option that runs along the pane in the drag direction; verify with a unit test on the mark's start and end points
- [x] 3.3 Derive the `mauled` kill's gore clip from its glass anchor so marks and gore stop at the pane face (about z 45.72); verify the "Nothing on Jay's side" scenario with a test that clips a burst at the anchor's plane

## 4. Poses, sounds, voice

- [x] 4.1 Author the victim poses `kill_grabbed`, `kill_hauled`, `kill_slammed`, `kill_thrown`, `kill_slide`, `kill_reach` in `src/data/poses.json`; verify each in `posesSandbox` on the Priya body with no stretched limbs
- [x] 4.2 Add sounds: head-impact crunch variants (at least 3), metal cart impact, body against glass, and a hand squeak on glass, with stand-ins wired in `src/audio/sounds.ts`; verify with `npm run audio:audit`, which shows each sound resolves, and that consecutive crunches differ
- [x] 4.3 Write the new and changed lines in `src/data/dialogue/slice01_action.json`: `sec_okafor_02` with no name ("Hey! Over here- the door!"), `sec_okafor_03` stays as his one "Priya!", new `sec_okafor_08` ("The door. Jay, the door!"), `sec_giles_06` ("It's sealed from upstairs. I can't- Tomas, I can't override it!"), `sec_jay_01` ("Hey! HEY! Get off her!"), `sec_jay_02` ("...no."), `sec_giles_07` ("Christ. Oh, Christ."), `sec_priya_05` ("Open it, open it, please-"), `sec_priya_06` [full scream], `sec_priya_07` [cut-off cry], the stinger line `stinger_priya_06` [a wet, rattling breath], and Jay's bang pool `sec_jay_bang_01`..`04` ("Behind you!", "HEY! HERE!", "Turn around- turn around!", "Over here, you-!"; none use her name). Also `sec_okafor_01` loses her name ("Medical's through that glass. My nurse was on shift."), since it plays inside `sec_glass`. Removing `stinger_priya_01/02/04/05` moves to 6.2, where the stinger stops using them. Verify with a test that counts "Priya" in medic lines used by `sec_glass` and finds exactly one, and that no `sec_jay_bang_*` line contains "Priya"
- [x] 4.4 Generate VO for the new lines with `npm run vo:generate -- --mode audition --apply` following `docs/voice-casting-standard.md`; verify that each new line's `audio` file exists in `public/assets/vo/`

## 5. Switch-over: the R08 scene

- [x] 5.1 Switch-over: give the two remaining panes ids `medbay_w` / `medbay_c`, remove their `glass_blood` props, and add anchor `medbay_c_glass` on the centre pane face; update the `glass_blood` count assertion in `slice01.test.ts`; regenerate `slice01.json` and verify by grep that no `"id": "medbay"` glass prop remains. Land this together with 5.4 so the old scene is never left without its glass
- [x] 5.2 Add the `medbay_bang` interact box on the centre pane emitting `interact:medbay_bang`; verify the box exists in the regenerated level and that a level test resolves it
- [x] 5.3 Add the `mauled` style for Priya to `src/data/kills.json` (plead, grab, haul, slam ×3, throw, reach, drag, still, with glass marks, light and reduced-gore values); verify that it validates and that `npcKills.test.ts` plays it end to end in beat order
- [x] 5.4 Rewrite `sec_glass` in `action_security.json`: spawn `r08_thing` with the creature look, set player control (locked, look free, weapons off, interact on during plead), run the bang listener (thud and shake on every bang; a `sec_jay_bang_*` shout with a 2.5 s cooldown; on the first bang after the attacker enters R08, emit `kill:notice`), have Okafor go to `r07_medbay_door` and try `D_R07_R08` with its denied sound, run one `kill` step with `attacker: r08_thing`, and put the Okafor, Giles and Jay lines on beat hooks; delete the old fixed `gore`, `glass:blood`, `glass` and `npcDrag` steps; verify with a sequence test for "Banging changes nothing", "Shouts do not pile up", "Stare on the first bang", "Stare without a bang", "Only once", "The beat timing holds", "Prompt goes with the grab", "Denied", "Dragged past the door", "Both faces" and "All four voices"
- [x] 5.5 End state: surgery door closes, at least 2 s of no voice, then `sec_okafor_04`; Priya's corpse at `priya_hide`; attacker despawned; verify the "Aftermath" scenario in a sequence test
- [x] 5.6 Skip and restore: make the skip path and `action_restore` (from `sec_done`) place the corpse, remove the attacker and restore the centre pane's marks (recorded list or authored end set, decided here); verify the "Skipped mid-slam" and "Restore after R08" scenarios
- [x] 5.7 Update `docs/PLAYTEST.md` (R07 checklist: contact, grip, three slams, single cracked pane, bang prompt, name once) and verify that it no longer mentions three-step blood climbing every pane or `clipAt 46.05`

## 6. The stinger

- [x] 6.1 Add the `convertedRise` style (still, twitch, turn, rise, face) to `kills.json`, with `face` turning the head toward a target anchor; verify with a `killRun.test.ts` beat-order case
- [x] 6.2 Rewrite `stinger_priya` in `action_climax.json`: Priya's corpse at `priya_hide`, no `r08_thing`, run `convertedRise` on her, static 1.2 s after the `face` hook, then the existing close and `endSlice`; remove `stinger_priya_01/02/04/05` from the dialogue; verify the "Opening frame", "She gets up", "Silent turn", "Back to the title" and "Skipped" scenarios with a sequence test
- [x] 6.3 Update `docs/characters.md`: Priya dies in R08 and the bloom raises her body in the stinger, which replaces the 2026-11-16 survival note, and her relationship line goes back to "her death in R08". Update the stinger line in `docs/PLAYTEST.md` and `docs/HANDOFF.md`; verify by grep that no doc still says she survives R08

## 7. Integration

- [x] 7.1 Run `npm test` and `npm run typecheck` with everything above in place; verify both pass
- [x] 7.2 First playtest, 2026-11-21: slams and throw kept; the grab jump, the particles, the crack, the missing impact splatter and the drag failed (proposal Why). Groups 8-13 rework them; the final playtest is 13.3

Groups 8-13 rework the built scene after that playtest (design decisions 14-21). Where they conflict with a checked task above, they win.

## 8. Arrival-gated beats (no jump)

- [x] 8.1 Add a per-frame position probe to the `mauled` tests in `npcKills.test.ts` that fails on any attacker step over 0.3 m outside skip/restore; verify it fails today on the grab's `pin`
- [x] 8.2 Add `startWhen: 'inReach'` (with `reach`) to beat types in `src/data/types/kills.ts` and teach `KillRun` to hold the previous beat until it is met, up to `max`, then walk the attacker the rest of the way; verify with `killRun.test.ts` cases for "Late arrival" and "Fixed beat clock"
- [x] 8.3 Make `pin` a walk during play and a placement only for skip/restore; verify 8.1 passes for the whole R08 style and the "Skipped mid-slam" test still passes

## 9. The new beats

- [x] 9.1 Author poses in `src/data/poses.json`: victim `kill_backaway` (hands up, backing walk), `kill_impaled`, `kill_carried`; attacker `maul_impale`, `maul_carry`; verify each in `posesSandbox` on Priya's and the creature's bodies with no stretched limbs, and the impale in the cast motion sandbox
- [x] 9.2 Add a `chest` claw hold (impale and carry) and the hand-over to `head` at the slam to the grip; verify "Carried on the claw" and "Held for the slams" in `npcKills.test.ts`
- [x] 9.3 Rework the R08 `mauled` style in `kills.json` to plead (backaway, approach along the glass), impale (`startWhen: inReach`, sound, spurt, burst, pool), carry, slam, throw, still (pool grows; attacker walks out and is despawned); remove `reach` and `drag`; verify "Beat order", "Backing away", "In reach first", "No jump" and "Left on the floor" end to end
- [x] 9.4 Add impale and wet-flesh sounds (at least 2 variants) and creature sounds from the surgery to `src/audio/sounds.ts` following `docs/audio-assets.md`, with attribution in `CREDITS.md`; verify with `npm run audio:audit`

## 10. Blood and glass

- [x] 10.1 Replace the gore `Points` cloud with instanced droplet billboards (soft round alpha, size range, velocity stretch, reduced-gore path) in `src/actors/gore.ts`; verify with `gore.test.ts` (one draw call, buffer size unchanged) and by eye in the actors sandbox that no square specks show
- [x] 10.2 Make landing drops leave decals on the floor, prop tops and registered glass planes, within a bounded decal budget; verify "Drops leave marks" in `gore.test.ts` and memory with `?slot=scratch&memprobe` against the previous baseline
- [x] 10.3 Throw splatter: a splat ring at the contact point with no jitter or clear-band shift after the slams, streak runs under it, and a slide smear; verify "Splatter at the impact" with a test on mark positions
- [x] 10.4 Replace `crackTexture` with the safety-glass crack (crush disc, radial and ring fractures, alpha and normal maps, a far-face copy); verify "Crack centred on the impact" still passes and check "Seen from the corridor side" and "The light catches it" by eye in the actors sandbox
- [x] 10.5 Check Lab B with the new drops: `npm test -- src/ai/npcKills.test.ts` and by eye at `?jump=drop`; verify its blood still stops on the glass and keeps the 1.1-1.8 m band clear

## 11. Lead-in and free movement

- [x] 11.1 Add anchors `priya_r07_hide`, `priya_wait`, `priya_cower`, `r08_impale`, `r08_along` and `priya_rest` in `scripts/gen-slice01.mjs`, remove `r08_drag_*`, `priya_glass`, `priya_hide` and the surgery stinger anchors, and extend the clear-lane test along the glass; regenerate `slice01.json` and verify "Clear lane", "Only the cart in front of the pane" and "Seen through the glass" as level tests
- [x] 11.2 Source a panicked run and a stumble for Priya per `docs/mocap-sources.md` (attribution in `CREDITS.md`) and review them in the cast motion sandbox; verify with `castMotionCoverage.test.ts` that Priya's body has both clips
- [x] 11.3 In `cover_me` (`action_contact.json`), place Priya at `priya_r07_hide` at the start, and after `waitGroup r06_cover` play the run block (Okafor's call, line 3 in design decision 29; look nudge; run with stumble and line 4; door open, through, close, sealed), with her destination `priya_wait` at its new spot by the west beds (decision 23). In the same edit, cut the R06 infection beat (decision 22). Verify "She runs", "The door seals behind her", "Jay sees her go" and "Her name is kept" with a sequence test
- [x] 11.4 Restore: from `cover_done` without `sec_done`, place Priya at `priya_wait` with `D_R07_R08` sealed; from `sec_done`, place her corpse at `priya_rest` with the pool and marks; verify "Restore before the attack" and "Restore after R08"
- [x] 11.5 (Superseded in part by group 19: the trigger, the start of the scene, the line hooks and the aftermath follow decisions 23-30. The free-movement, bang box and seal parts below still apply.) Rewrite `sec_glass`: `gatherIn R07`, seal `D_R06_R07`, `playerControl move: slow, look: free, weapons: false, interact: true`, no `playerWalkTo`; bang boxes on the centre and west panes; line hooks moved (decision 21); at the end, reopen `D_R06_R07`; verify "Sealed in", "Walking around", "Not watching", "Banging changes nothing", "Prompt goes with the impale", "Her name once", "Aftermath" and "Out of the office" with sequence tests
- [x] 11.6 (Replaced by group 15, which writes and records the full script in decision 29, including the run call.)

## 12. The stinger in the medical bay

- [x] 12.1 Re-aim CAM 04 for the stinger at `priya_rest` and move `stinger_priya` to it, keeping `convertedRise`; verify "Opening frame", "She gets up" and "Skipped" with the stinger sequence test
- [x] 12.2 Update `docs/characters.md` (she lies by the glass; no drag), `docs/PLAYTEST.md` (R06 run, R07 free movement, the impale, the splatter, CAM 04 stinger) and `docs/HANDOFF.md`; verify by grep that no doc still describes the ankle drag or the surgery feed

## 13. Integration

Run this group last, after groups 14-19.

- [x] 13.1 Run `npm test` and `npm run typecheck`; verify both pass
- [x] 13.2 Take the dressing-standard screenshots of R07, R07a and R08 (each entry door at 1.62 m, with and without `?nopost`) after the anchor moves
- [x] 13.3 Play `/?level=slice01&debug&jump=r06` through the scene and the end of the slice in the browser. Check by eye: the run and the seal, walking during the attack, the walk past Jay and the stare, no jump, the impale and carry, slams in view, the splatter and crack on the centre pane only, nothing on Jay's side, the corpse left by the pane, and the CAM 04 stinger. Also check by eye and ear: R08 lit and R07 dark under backup power; the rescue sections in order, with no dead air; Priya muffled until the intercom clicks on, then clear anywhere in R07; the surgery sounds building and the tray's silence; "Sit." and "That's my line." playing as tense, not as a joke; Okafor clear but across the room; the overload on the scream and slams; the score on the monitor's beat; the aftermath (intercom off, notebook, cardigan, the two lines); and no Giles infection beats. Time the rescue from entry to the surgery door. Use `?slot=scratch` and close the tab afterwards. Record findings in `docs/PLAYTEST.md`

## 14. Giles is not infected here

- [x] 14.1 Find every reader of `giles.infectionStage` and `giles.bandaged` (`src/actors/animator.ts`, `handPhysics.ts`, `src/ai/npcActor.ts`, `npcs.ts`, `squad.ts`, `squadBrain.ts`, `src/app/session.ts`) and every test that expects stage 1 or 2 before the tunnel. Remove the R06 beat (decision 22; done with 11.3 if that lands first) and the R07 beats from `sec_glass`, and update those tests. Verify the "No arm lines" scenario with a sequence test, and that Giles's behaviour from the tunnel on (stage 3, set there) is unchanged

## 15. The script and VO

- [x] 15.1 Write the lines in design decision 29 into `src/data/dialogue/slice01.json` and `slice01_action.json`, with ids, speakers, `[IC]` lines on Priya, and the bracketed delivery notes in the VO direction field. Change `sec_priya_01`, `sec_okafor_02` and `sec_giles_06` in place. Delete the cut lines, their mp3s and their `vo-takes.json` rows, after checking that no other sequence uses them. Verify with tests: "Her name once", "No other names from Okafor", every line referenced by `cover_me` and `sec_glass` exists, and no deleted id is referenced anywhere
- [x] 15.2 Generate VO for the new and changed lines in audition mode (`npm run vo:generate -- --mode audition`) per `docs/voice-casting-standard.md`, on each speaker's pinned voice. Review lines 21-23 by ear for tension: Okafor holding himself together, Priya's nervous laugh breaking into a sob, nothing that reads as a joke. Re-take as needed, then `--apply`. Verify each line's audio exists and that the shipped clips trace to their model

## 16. Level: light, anchors, props

- [x] 16.1 In `scripts/gen-slice01.mjs`, give R08's slots 0-2 `backupScale: 1` and `ownColor: true` (design decision 24), leaving R07, R07a and R08b as they are. Regenerate and verify: "Medical bay on its own circuit" and `render-lighting` "A light on its own circuit" with `stationPower.test.ts` cases (the existing `backupScale` test covers the engine; add one for R08's level data), the 8-light pool scenario still passes, and "Lit room seen from the dark", "The surgery stays dark" and "Jay can be seen" by screenshot and brightness measurement at `?slot=scratch`
- [x] 16.2 Add the decision 23 and 25-30 level items: move `priya_wait` to the west beds, add `priya_door`, `priya_sit`, `r07_intercom` and its grille prop, the console bank's lockdown order text (decision 27), and the `cardigan` prop on a chair by the vitals console. Regenerate and verify the "Nothing in the walls", "Doors are clear", "Clear lane" and "On the screen" scenarios as level tests, and that `priya_door` and `priya_sit` are reachable on the navmesh

## 17. Audio engine: intercom and projected voice

- [x] 17.1 Add the room intercom to `src/audio/`: an id, source rooms and a speaker anchor from level data, off and live states, relaying positioned one-shots and voices that start in the source rooms to the speaker through a comms chain (band-limit like the radio channel, saturation, a `crackleBuffer` bed) with gentle falloff, plus the click and static on switching. Verify `in-world-audio` "A sound in the source room", "Off", "Switched on" and "Switched off" with unit tests on the audio graph, and "Heard anywhere in the room" by ear
- [x] 17.2 Add the overload follower (more saturation and crackle density while the input is loud, recovering within about 0.5 s, capped, never clipping the master). Verify "A scream" and "Back to normal" with a unit test on the follower's output, and check the master peak with `npm run audio:audit`
- [x] 17.3 Relay local voices through a live intercom, keeping voice propagation for the direct voice, and extend the subtitle earshot to the speaker's room and rooms opening onto it. Verify `voice-playback` "Priya over the intercom" and "From the armory doorway" with tests
- [x] 17.4 Add the projected-voice override (one speaker, a distance, cleared at the end of the sequence) and sequence actions for `intercom` (`on` / `off`) and `voiceProject` in `src/script/actions.ts` and `host.ts`. Verify "Across the room", "Nearer than the set distance" and "After the scene" with tests, and the actions in `src/script/action.test.ts`

## 18. Sounds and the medbay score

- [x] 18.1 Source the surgery sounds (drip, instrument rattle, tray fall, wet breathing, a travelling scrape, door handle) and the intercom click and static per `docs/audio-assets.md`, register them in `src/audio/sounds.ts`, and record attribution in `CREDITS.md`. Verify with `npm run audio:audit`, and that the tray fall is distinct from the slam crunches
- [x] 18.2 Make the `med_beeps` monitor beep a steady 0.8 s interval (re-cut if needed). Generate the `medbay` score's layers per `adaptive-music` and add it to `src/data/scores.json` with the layers and cues in design decision 31, including the distance-driven `glass` layer. Verify "Her motif", "Silence at the fall", "Silence at the stare", "Ends with the intercom", "One clock", "The monitor does not race", "Walking up to the glass" and "The last time" in `scorePlayer.test.ts` or a sequence test

## 19. The scene

- [x] 19.1 Fold `armory_auto`, `sec_glass_near` and `sec_rescue` into `sec_glass`, triggered by `trigger:r07_enter` after `cover_done` (decision 23): gather and seal, free control and the bang prompt from the start, then sections A-F with Priya's moves, Okafor's first door attempt, Giles's console read and the intercom switch, the surgery sounds from decision 26 with Priya's reactions, the tray hush, the sit, and the armory bypass with the coffee exchange in parallel, then the emerge gate (lines done, armory open, Jay out of R07a or 10 s). Project Okafor's voice for the whole sequence. Verify with sequence tests: "Denied on arrival", "Giles reads the order", "Before and after the switch", "Triage", "Her own words back", "She sits", "The tray", "She reacts", "Not seen", "She is alive and talking first", "The armory opens first" and "Jay is in the armory"
- [x] 19.2 Section G: the `mauled` kill as in groups 8-9, with the line hooks in the decision 29 table, the surgery handle and door before the plead, and score cues `emerge`, `stare`, `impale`, `slam`, `throw` and `still`. Verify "Her death on the intercom" and "All four voices" with sequence tests, and that the 11.5 scenarios still pass
- [x] 19.3 The aftermath (decision 30): the silence, Okafor's hand on the glass, the intercom off, the notebook, lines 44 and 45, Giles silent, then unseal, reset, `sec_done`, `obj_medlab` and `cp_security_done`. Verify "Aftermath", "The last line", "Her cardigan", "Switched off" and "Out of the office" with sequence tests
- [x] 19.4 Restore and skip: from `cp_cover_done`, Priya crouched at `priya_wait`, `D_R07_R08` sealed, intercom off, and the scene replays from section A. From `sec_done`, intercom off, the corpse and marks as in 11.4, and the score not playing. A skip during the rescue jumps to the end state. Verify "Restore before the attack", "Restore after R08" and "Skipped mid-slam", plus a new case for a skip during section C
- [x] 19.5 Poses and anims: Priya crouched, standing at the glass, hands shown, turning, flinching, sitting against the wall, getting up; Okafor `hand_on_glass` and `notebook_write`; Giles typing at the console. Author them in `src/data/poses.json` or source them per `docs/mocap-sources.md`, and review each in the cast motion sandbox on the right body
- [x] 19.6 Docs: update `docs/PLAYTEST.md` (the R07 checklist: rescue sections, intercom, surgery sounds, score, aftermath), `docs/HANDOFF.md`, and the R08 lines for Priya and Okafor in `docs/characters.md` ("Surfaces as" and the supporting-cast row: the rescue, the intercom, "I told her she was fine."). Leave Giles's infection write-up for the cliffhanger change. Verify by grep that no doc still quotes "Work. We work." or "Christmas came early"

## 20. The run as the scene's opening cutscene (2026-11-23 playtest)

- [x] 20.1 Move Priya's run from `cover_me` to the start of `sec_glass` (design decision 14, amendment): Jay held with the bars, the squad caught up behind him, the view on her, the door opening as she reaches it and sealing as soon as she is through. `cp_cover_done` and its restore keep her at `priya_r07_hide`. Verify "She runs", "The door seals behind her", "Jay sees her go" and "Restore before the attack" in `action.test.ts`, and by eye at `jump=r06` / `jump=r07`
- [x] 20.2 Second pass: stepping into R07 stops `cover_me` and its lines and starts the cutscene at once (new `stopSequence` action; `cover_done` and `cp_cover_done` come with the win). Jay runs 3-4 steps after her (`playerWalkTo` `distance`). The monitor beep is not relayed by the intercom (`sfx relay: false`, design decision 25 amendment). Verify with `action.test.ts` ("R07 straight after the fight", "playerWalkTo with distance") and `intercom.test.ts` ("Not relayed")

## 21. Resume is not a restore (decision 32)

- [x] 21.1 Add `from` to the `game:mode` payload in `src/game/game.ts`, and make `action_restore` (and any other restore sequence keyed on play starting) match `from: 'title'`. Check that a death restart still re-runs them through the runtime's restart path. Verify `checkpoint-restore` "Resume after a pause" and "Restore scenes run once the load settles" with tests

## 22. The glass side comes from the room (decision 33)

- [x] 22.1 In `glassFor`, take the pane's normal toward the victim's room (its floor side) and fall back to her position only when no room is known, then clamp the throw's resting point so the slide and corpse poses stay on her side of the pane. Verify `infection-kills` "Thrown from the wrong side" and "The body stays on her side" in `npcKills.test.ts`

## 23. Armoured glass and weapons (decision 34)

- [x] 23.1 Enable weapons at the `slow` control step after the gather in `sec_glass`. Make the R07-R08 panes stop rounds with a chip mark, spark and thunk, count a hit as a bang for the creature's notice (no shout), and keep Okafor and Giles from taking Jay's damage during the scene. Verify `medbay-attack` "Walking around", "Shooting the glass" and "The squad is not hit" with tests

## 24. The turn-around gesture (decision 35)

- [x] 24.1 Add a `turnRate` option to `npcLookAt`, the `priya_turn_away` anchor (via `gen-slice01.mjs`), and the `priya_hands_back_freeze` and `priya_hands_turn_back` poses, then stage the turn in section C, timed to the words of `sec_okafor_13`. Verify `medbay-attack` "She turns around" with a sequence test and `npcLookAt` with `turnRate` in `action.test.ts`. Review the turn in the cast motion sandbox

## 25. Pacing (decision 36)

- [x] 25.1 Trim the pauses inside the rescue clips to the caps in decision 36 (the master mp3s, with `vo-takes.json` notes), add the overlaps and move Giles's console walk under "It locked...", and shorten the wait after the intercom switch. Verify `medbay-attack` "The rescue is tight" with a sequence test on the A-to-armory span, and by ear

## 26. The creature's exit (decision 37)

- [x] 26.1 Add `r08_surgery_in` and `r08_surgery_out` (via `gen-slice01.mjs`), route the exit and the entrance through them, and give the exit the `maul_prowl` pose at about 1.7 m/s with one look at the glass. Verify `medbay-attack` "It leaves through the door" with a test that no track segment crosses a wall collider

## 27. Kill events cue only live scores (decision 38)

- [x] 27.1 Make `ScorePlayer.onEvent` cue only scores that are loaded and not released or fading. Verify `adaptive-music` "A released score stays quiet" and "Voss's kill still drives Lab B" in `scorePlayer.test.ts`

## 28. Playtest fixes, second pass (decisions 39-41)

- [x] 28.1 Okafor at the glass during the still beat with the new line `sec_okafor_22` (generated per `docs/voice-casting-standard.md`), and the hold after it cut to 1.2 s. Verify the `medbay-attack` aftermath scenarios in `action.test.ts`
- [x] 28.2 Warm R09's shaders as Okafor starts `tunnel_okafor_01` (`render:warm`, compiled with a render target bound). Verify in the browser that no program compiles and no long task runs when `D_R07_R09` opens
- [x] 28.3 `squadCatchUpIn` `force`, and the R06 seal moved into the bars after Jay's steps. Verify "Sealed in" in `action.test.ts` and the forced catch-up in `squad.test.ts`

## Workflow follow-up

- Archive the change after playtest sign-off, then check that `openspec/specs/medbay-attack`, `slice-stinger` and the updated `infection-kills` exist.

> Note (trim-lab-wing-encounters, 2026-11-22): `sec_glass` in `action_security.json` no longer has `waitGroup r07_playdead` (timeout 20) or `despawnGroup r07_playdead`; the R07 play-dead ambush is gone. Keep them out when this change is resumed or merged.
