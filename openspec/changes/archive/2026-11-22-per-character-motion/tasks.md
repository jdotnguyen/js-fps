# Tasks

## 1. Profiles on today's clips (no visible change)

- [x] 1.1 Define the activity and posture-family vocabulary and the profile type in `src/actors/mocap.ts`, add `src/data/motion-profiles.json` with a validator (design D2), and verify with a unit test that a malformed profile (unknown activity, unknown parent, missing gender) is rejected
- [x] 1.2 Add required `gender` to every model in `src/data/body-models.json` and to its validator (D8), and verify `bodyModelLibrary` tests fail on a missing gender and pass on the full table
- [x] 1.3 Replace `MotionSet`/`resolveMotions` with profile resolution (profile, then gendered default, then neutral; one warning per missing clip), and move the animator's hard-coded pistol/kneel/crouch ids to activity lookups. Verify with unit tests for each fallback step and the single warning (`character-motion`: missing motion falls back)
- [x] 1.4 Create a profile for every named character and both crew defaults, all pointing at today's clips. Wire `castLooks.ts`, `squadLooks.ts` and the crew look pool to them, and verify `npm test` passes and a slice01 intro screenshot pair before and after shows no change
- [x] 1.5 Add the cast coverage check (every named look id has a profile; every pose and activity it is given in level data, sequences and squad tasks resolves inside its profile) as a test, and verify it fails when a named entry's profile is removed
- [x] 1.6 Seeded per-NPC tempo, posture and phase variation for crew defaults, and verify with a test that two crew on the same profile from the same start are out of phase and repeat identically across runs

## 2. Sources and bake pipeline

- [x] 2.1 Put the Quaternius UAL glTF in `previews/sources/mocap/`; write `scripts/mocap.sources.json` (bake list: file, source, licence, take, range, target id), `scripts/mocap-fetch.mjs` (downloads exactly the takes the bake list names from CMU, Bandai and 100STYLE into `previews/sources/mocap/`) and `docs/mocap-sources.md` (links, licences, which idle, sit, lean, kneel, drink and talk takes exist per source). Verify the bake reads only from `previews/sources/` and reproduces today's `mocap-clips.json` byte for byte
- [x] 2.2 Add the BVH reader (three `BVHLoader`) with CMU, Bandai and 100STYLE bone maps, 24 fps resampling and a light low-pass filter to `scripts/bake-mocap.mjs`, and verify with a bake test that a Bandai walk and a CMU walk bake with foot contacts and stride and loop without a seam pop
- [x] 2.3 Add the limb-length IK correction pass and verify with a test that baked hands and feet stay outside the torso and other leg for every clip in the bake list
- [x] 2.4 Bake finger tracks (5 curls + thumb spread per hand) from sources that have them (D5), and verify a test reads finger tracks on a finger-recorded clip and none on a clip without
- [x] 2.5 Bake additive hold clips for posture families (D4), and verify a test that a hold clip's mean offset is zero within tolerance
- [x] 2.6 Split output into `mocap-core.json` and per-character files lazily loaded with the body and released when no body uses them (D9). Verify with a size test (start-up data at most 2 MB, per-character sizes recorded in docs) and a pack test showing no clip growth over repeated load and release (the in-browser `runtime-memory` probe runs in 7.2 once packs hold real clips)
- [x] 2.7 Credits: a clip's source, author and licence are carried into the library; add the Bandai rows to `CREDITS.md` and the in-game credits; add a credits test that fails on an uncredited or unaccepted-licence clip (`mocap-library`: clips come only from free, credited sources)
- [x] 2.8 Gate: `npm test` and `npm run build` pass; start-up bundle size recorded in design.md

## 3. Cast motion sandbox

- [x] 3.1 Add `castMotionSandbox` (D10): one row per named character plus crew m/f, one column per activity and posture family, labels, red fallback labels. Verify in the browser that every named character appears with every activity in its profile
- [x] 3.2 Add pause, scrub, 0.25/0.5/1× speed, solo row/column and the detail-pass toggle, and verify each control in the browser
- [x] 3.3 Document opening and using the sandbox in `docs/` and link it from README.md and AGENTS.md

## 4. Holding poses in character

- [x] 4.1 Apply the profile's hold clip additively on authored poses at per-family weight, followed by the contact solve, and verify with a test that hands stay on the counter in `lean_counter` and the mug stays in hand in `lean_back_mug` while the hold plays
- [x] 4.2 Drive idle life from profile style values when no hold clip exists, and verify with a test that two characters holding the same pose without hold clips move differently and neither is frozen
- [x] 4.3 Scale procedural arm, fidget and breathing layers for bodies playing their own clips, and verify with a test that generated speech gestures stay within the reduced strength while a talk clip plays
- [x] 4.4 Verify that turned, infected, dying and corpse bodies ignore their living profile with a test that a named crew member turning into a shambler plays the infected gait

- [x] 4.5 Scene variants (D11): profile `variants` with `sequence`, `task`, `flag` and `stage` conditions, published by the sequence runner and squad task system, layered over the everyday profile with a 0.3 s blend. Verify with tests that a variant's clip plays only while its condition holds and that `npcAnim` steps resolve through the active variant first
- [x] 4.6 Extend the coverage check (1.5) to scene variants: every pose and action in the D11 table, and in any sequence added later, resolves to the character's profile or one of its variants. Verify it fails when a variant is removed
- [x] 4.7 Injury weight (D12): `setInjury(stage, exposure)` on the body, exposure from observation, tasks and ladder tells in `squad.ts`. Verify with tests: watched at stage 0 gives no favouring; 4 s unwatched raises it and a look lowers it within 1 s; the reveal gives full weight whoever is watching
- [x] 4.8 Add an injury row to the cast motion sandbox with stage and exposure sliders, and verify in the browser that every stage and exposure combination plays without pops

## 5. Detail bones

- [x] 5.1 Move hand personalities into the profiles (`hands`), migrate the four existing values unchanged, add Voss, Bram, Ruiz, Heins and Sung, and add Giles's stage-scaled `twitch`. Verify with tests: no two named characters share a personality; at rest Hale fidgets more and rests tighter than Okafor; Giles's twitch rises with each stage
- [x] 5.2 Feed clip finger tracks (2.4) to the hand solver as its shape target and add the wrap radius from held-prop bounds. Verify with tests that a finger-tracked clip drives the curls, no finger enters the mug in `lean_back_mug`, and empty hands rest in a loose curl
- [x] 5.3 Spine/neck distribution and thigh twist in the post-pose pass (D6), with no per-frame allocation. Verify with tests: `lean_back` on a 3+-segment spine has no segment over half the bend; 90° hand roll keeps at least 70% wrist width on every named rig with twist bones
- [x] 5.4 Severed limbs carry their detail bones in their last pose, and verify with a test that a severed forearm's piece keeps its fingers and the stump has no stretched finger geometry
- [x] 5.5 Turn on the hand rig for Voss's body (`office3`, `handRig`), and re-prepare Bram, Heins, Ruiz and Sung with weighted finger chains (or per-finger strips for fused fingers) and forearm twist bones (D7), extending the scan-body seam and stretch checks to the hands. Verify with `bodyModel.test.ts` rig checks for every named body and a curl stretch test (no 3 mm+ edge over 2.5× rest length). Landed for Voss, Bram and Heins; Ruiz and Sung keep their scans' own fused hands (design: "Found while landing the hand rigs")
- [x] 5.6 Add `?detail=0` and verify in the sandbox that toggling it switches the detail pass off and on

## 6. Each character's own motion

- [x] 6.1 Giles: bake and assign his everyday clips and holds (exhausted), his `intro`, `panel`, `console` and `reveal` variants and his left-arm injury set (D12), and verify his sandbox row has no fallback cells and his idle, talk and walk differ from every other named character's (profile uniqueness test)
- [x] 6.2 Okafor: same as 6.1 (normal, slow, composed; `intro`, `console`, `revive` variants and his glance)
- [x] 6.3 Priya, everyday and intro: same as 6.1 (feminine + active; everyday clips and holds, `intro` variant); her placeholder entry in `castLooks.ts` is replaced. Her R08 cells stay on the fallback until 6.4
- [x] 6.4 Priya, R08 death scene (after the death-scene rewrite lands): bake and assign her `r08` and `downed` variants for whatever the rewritten scene asks of her, and verify the coverage check passes on the rewritten sequence and her sandbox row has no fallback cells. Deferred: closed with this change unbaked; the R08 rework (the Priya R08 death redesign) takes it over
- [x] 6.5 Voss: same as 6.1 (feminine + exhausted; `labb` variant), and verify her `kill_burst` sequence still plays unchanged
- [x] 6.6 Bram: same as 6.1 (elderly/masculine; `intro` variant: counter work and serving), and verify the intro kitchen serve and coffee hand-off still land the mug in the hand
- [x] 6.7 Ruiz: same as 6.1 (youthful; `checkpoint` variant), and verify the `imported-body-models` intro-pose scenarios still pass
- [x] 6.8 Heins, Hale and Sung: same as 6.1 (active with `post` variant / nervous with `briefing` variant / heavy)
- [x] 6.9 Crew defaults: bake masculine and feminine default sets from all three actors, and verify in the sandbox and the R02 mess room that mixed crew pick the right default and don't move in step

- [x] 6.10 Select and bake a quieter `giles_talk` excerpt (D13). Compare the mechanic model's idle and talk shoulder carriage at stage 0, exposure 0. Correct a speech-only clavicle offset against idle, or inspect rest axes and retargeting if the hunch is present at idle.
- [x] 6.11 Fade Giles's generated upper-arm speech gestures and their clavicle contribution as his standing talk capture takes over. Keep speech-driven jaw movement and small head accents.
- [x] 6.12 Review a calm line followed by silence from the front and side in the cast motion sandbox. Check relaxed shoulders at the first and last words, hands down for most of the line and a one-handed accent settling during a pause. Repeat in the injury row at a later stage and check that his left arm still guards at the configured D12 weight.

## 7. Integration

- [x] 7.1 Play the slice from intro to the climax with every named character on screen at least once, and verify no fallback warnings in the console, no visible pops, and that Giles's arm looks normal when watched in the intro and favours it unwatched later; record before/after captures of the intro kitchen and the squad walk in `previews/`. Not run: closed unverified at the user's call; only the slice opening was seen, during the memory probe
- [x] 7.2 Run `npm test`, `npm run build` and the memory probe, and record the results and the final library sizes in design.md

## Workflow follow-up

- Sync the specs and archive the change after review.
