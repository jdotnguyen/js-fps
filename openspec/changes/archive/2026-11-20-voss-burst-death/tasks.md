# Tasks

## 1. Voss as a named cast member (design D6)

- [x] 1.1 Add `CAST['voss']` in `src/actors/castLooks.ts` with a fixed female imported model (stand-in `office2` or `office3`, `handRig` on) and set `researcher_b` to `look: "voss"` in `src/data/levels/slice01.json`; verify with a `castLooks`/`slice01.test.ts` case that `researcher_b` gets the same female model for two different seeds
- [x] 1.2 Map `crew_lab` to `researcher_b` in `src/ai/speakerBodies.ts`; verify with a test that `drop_voss_01` resolves to `researcher_b`, and in-game that her jaw moves and the line is positioned at her head
- [x] 1.3 Update `docs/characters.md` (Voss's body and speaker mapping) and verify `npm run typecheck` and `npm test` pass

## 2. Kill step and beat data (design D2)

- [x] 2.1 Add `data/kills.json` with a validator (one `grownInside` style: beats, pose sequence, convulse target, cue, time limit) and verify a validator test rejects a beat with no time limit
- [x] 2.2 Add the `kill` sequence step (`npc`, `kind`, `creature`) to `src/script/actions.ts` and `src/ai/npcs.ts`, running beats in order and emitting `kill:<beat>` events; verify a script test that the beats fire in the order scratch, panic, glass, arch, burst, still, creature
- [x] 2.3 Make each beat end on its audio cue or its time limit, whichever comes first; verify with a test where the waited-for recording is missing and the kill still completes
- [x] 2.4 Keep `transform` as the `converted` kind and verify the existing `converted` behaviour with a test that no creature spawns

## 3. Body motion (design D3)

- [x] 3.1 Author pose sequences `kill_scratch_arm`, `kill_backpedal`, `kill_glass_pound`, `kill_arch`, `kill_burst` in `src/data/poses.json` and verify each in the poses sandbox on the Voss model
- [x] 3.2 Replace the flat convulse curve for kills with a per-beat eased target in `humanoid.ts`/`animator.ts`; verify with a test that sampled convulsion rises panic < arch < burst and is zero for most of still
- [x] 3.3 Fire `Animator.kick` on spine/chest/neck with each crunch sound, with directions in group space; verify with a test that a crunch produces a kick in the same frame, and visually on the imported rig with threejs-devtools `skeleton_details`
- [x] 3.4 Leave hand-print smears at glass contact (knocking the bench props over moved to `adopt-physics-engine` task 6.5, which adds dynamic props); verify by the director test of palm smears and the stage screenshots

## 4. Under-skin movement (design D4)

- [x] 4.1 Add up to 4 bone-relative bulge centres to `bodyMaterial.ts` (normal displacement after skinning, plus a vein darkening mask); run the shader-reviewer agent over the GLSL and binding before running it
- [x] 4.2 Drive the bulges from the beats (forearm during scratch, chest during arch); verify by screenshot on the Voss model and on one other imported body

## 5. Burst, corpse and creature hand-off (design D1)

- [x] 5.1 Add a torn-corpse state to `Humanoid` (chest hidden or stumped, hands at rest length) and verify a test that hand and forearm scales stay at 1 through every `grownInside` beat
- [x] 5.2 Spawn the creature (`necromorph_slasher` by default, set by the step) curled at the chest joint at 0.6 scale, unfolding to 1.0 and then switching to enemy behaviour; verify a test that it is visible within one second of `kill:burst` and acts as an enemy after `kill:creature`

- [x] 5.3 After the kill, the creature walks beside her body and hammers on the glass in flurries (glass thuds, creature clicks between flurries) until it is despawned; verify a test that it pounds after a played and a restored kill and stops when despawned
- [x] 5.4 Make the contact fight the creature: spawn points take a `model`, and `r05_door` spawns the `necromorph` body from the creature's spot at the glass (contact despawns the NPC creature as it spawns); verify a slice01 test on the spawn point and the action-sequence data test

## 6. Blood and light (design D5)

- [x] 6.1 Add a chest burst to `GoreSystem` (burst, chunks and spurt aimed at the glass with the Lab B `GoreClip`, plus a growing pool) within ADR-0015 budgets; verify the reduced-gore path still plays with dark blood and fewer chunks (`goreClip.test.ts` or a new gore test)
- [x] 6.2 Add glass splatter decals with one low arterial streak that runs down over about 6 s and a no-splatter band from 1.1 m to 1.8 m; verify a test that no decal is placed inside the band, and a screenshot from the gallery during the still beat
- [x] 6.3 Hold Lab B's white key light steady on Voss from glass to still, with a 2-frame dip at the burst; verify by screenshot under the alarm tint that blood reads red

## 7. Kill sounds (design D7)

- [x] 7.1 Add `scripts/gore-generate.ts` (same shape as `ambience-generate.ts`) with prompts for `kill_crunch` x4, `kill_tear`, `kill_burst`, `blood_splat_glass` x3, `blood_drip` (loop) and `creature_clicks`, plus an npm script; verify `npm run gore:generate -- --list` prints the manifest
- [x] 7.2 Generate the files (locally, or after `api.elevenlabs.io` is allowed for the agent) into `public/assets/audio/gore/`, register them in `src/audio/sounds.ts`, and verify the audio audit test passes and repeated crunches pick different variants
- [x] 7.3 Generate `voss_panic_breath` and whimpers with Gemini TTS in Voss's pinned voice (`scripts/vo-reactions.ts`), keep her existing credited screams, and update `docs/audio-assets.md`; verify `npm test`

## 8. Lab B sequence and integration

- [x] 8.1 Rebuild `src/data/sequences/drop.json` on the `kill` step: lines, lights, klaxons and the `glass labb cracked` beat wait on `kill:<beat>` events, not fixed waits; update `src/script/quiet.test.ts` to assert the beats in order and verify `npm test` passes
- [x] 8.2 Play the drop end to end from `cp_drop`'s preceding checkpoint and capture a Parallax checkpoint per beat; verify the scream lands on the arch, the creature is visible at the burst, and her head and chest stay visible through the glass

## Workflow follow-up

- Swap the stand-in body for a licensed lab-coat model once one is chosen, and add it to `CREDITS.md`.
- Archive the change after review.
