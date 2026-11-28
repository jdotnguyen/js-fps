# Tasks

## 1. Recorded VO Pacing

- [x] 1.1 Update `SpeechManager` (`src/dialogue/speech.ts`) to drive line duration from `Math.max(0.85, playback.duration)` whenever `playback.duration !== undefined` (keeping `subtitleDuration` for fallback playback) and tighten the default inter-line gap to `0.15` s; ensure `WebAudioVoicePlayer.play()` (`src/dialogue/voicePlayer.ts`) only sets `duration` when a decoded recording is present. Verify with `npm test -- src/dialogue/speech.test.ts`.
- [x] 1.2 Add unit tests in `src/dialogue/speech.test.ts` covering fast recorded VO clips (ending on audio duration instead of word-count estimate), very short recorded clips honoring the 0.85 s floor, fallback lines using `subtitleDuration`, and the ~0.15 s inter-line breath. Verify with `npm test -- src/dialogue/speech.test.ts`.

## 2. Explicit Speaker Addressee Gaze

- [x] 2.1 Add optional `to` addressee support to `DialogueLine` (`src/data/types/dialogue.ts`), `SayOptions` and `SpeechInfo` (`src/dialogue/speech.ts`), `say` sequence steps (`src/script/actions.ts`, `src/script/host.ts`, `src/script/gameHost.ts`), and `speech:started` wiring (`src/main.ts`) so `step.to ?? line.to` resolves to `'player'` or an NPC id and passes into `NpcDirector.lineStarted(speaker, addressee)`. Verify with `npm run typecheck`.
- [x] 2.2 Update `NpcDirector.lineStarted(speaker, addressee)` (`src/ai/npcs.ts`) to prefer a valid in-range `addressee` (not equal to `speaker`) over `this.lastTalker` while keeping existing fallback behavior and nearby listener gaze unchanged; add unit tests in `src/ai/listenLook.test.ts` covering explicit NPC addressee, explicit `'player'` addressee after cross-talk, omitted-addressee fallback, and listeners watching the active speaker. Verify with `npm test -- src/ai/listenLook.test.ts`.

## 3. Standing Mocap Posture Stability (Eliminate Slow Leans)

- [x] 3.1 Update `Animator` (`src/actors/animator.ts`) so standing upper-body action and fidget poses (`offer_mug` and character variants, `idle_crossed`, `talk_gesture`, `idle_hips`, `wave`, `point`, `rub_forearm`, `flex_hand`, `cough`, `glance`/`glance_other`/`*_glance`, `look_down`, `look_up`, `head_tilt`, `idle_weight`, `idle_shift`) keep the mocap locomotion/idle base (`mocapW = 1`) on pelvis, trunk, and legs while overlaying only their relevant upper-body/arm/head joints (and additive chest yaw for glance poses so `okafor_glance` still turns less than `glance`). Verify with `npm test -- src/actors/mocapPhysics.test.ts src/actors/idleLife.test.ts src/actors/motionHolds.test.ts`.
- [x] 3.2 Dampen `Animator.updateInertialPhysics` (`src/actors/animator.ts`) forward braking pitch and cornering roll at slow indoor walk speeds while preserving lateral `nudgeImpulse` spine recoil; add regression tests in `src/actors/mocapPhysics.test.ts` verifying that `offer_mug`, ambient fidgets (`idle_weight`, `idle_shift`, `head_tilt`, `idle_crossed`), and slow curved stops keep `mocapW` active and avoid large trunk pitch/yaw swings. Verify with `npm test -- src/actors/mocapPhysics.test.ts src/actors/idleLife.test.ts`.

## 4. Intro Pacing, Bram Choreography & Addressee Tagging

- [x] 4.1 Tighten the `cook_to_giles` walk waypoints in `scripts/gen-slice01.mjs` and `src/data/levels/slice01.json` (preserving clearance around Okafor, Giles, and the counter, and keeping `cook_serve_giles` on Giles's far side for the side-on hand-off). Verify with `npm test -- src/world/slice01.test.ts`.
- [x] 4.2 Tag multi-person intro dialogue lines in `src/data/dialogue/slice01.json` with explicit `to` addressees (checkpoint greetings, guard scans, corridor walk, and kitchen banter including `intro_sung_01`, `intro_okafor_01`, `intro_guard_04`, `intro_giles_01`, `intro_okafor_03`, `intro_giles_04`, `intro_cook_01`, `intro_giles_09`, `intro_okafor_06`, `intro_cook_03`, `intro_okafor_10`, `intro_giles_15`, `intro_giles_10`, `intro_priya_04`, `intro_giles_11`, `intro_giles_12`, `intro_giles_13`, `intro_priya_05`, `intro_okafor_09`, `intro_giles_14`). Verify schema and intro validation with `npm test -- src/script/intro.test.ts`.
- [x] 4.3 Tighten `src/data/sequences/intro_shift_change.json`: moderately trim opening docking and transition waits, bump the corridor walk speed slightly, overlap Bram's pour (`cook_coffee` -> `typing` -> `cook_turn_okafor`) with `intro_giles_09`/`intro_okafor_06`, overlap Bram's `cook_to_giles` serve walk with `intro_okafor_10`, keep all voiced lines intact, and leave Priya's exit anchor/walk untouched. Update/extend `src/script/intro.test.ts` to assert skip end-state parity, Bram's far-side serve order, and explicit addressee coverage. Verify with `npm test -- src/script/intro.test.ts src/script/action.test.ts`.

## 5. Integration Verification

- [x] 5.1 Run `npm run typecheck`, `npm run build`, and targeted unit tests (`src/dialogue/speech.test.ts`, `src/ai/listenLook.test.ts`, `src/actors/mocapPhysics.test.ts`, `src/actors/idleLife.test.ts`, `src/actors/motionHolds.test.ts`, `src/script/intro.test.ts`, `src/script/action.test.ts`, `src/world/slice01.test.ts`) and confirm all pass cleanly.
- [x] 5.2 Playtest the intro and Commons live in the browser (`http://localhost:5173/?slot=scratch`) to confirm natural VO pacing, speakers looking at their script addressees, Bram's smooth tight walk and lean-free coffee hand-off, and no periodic slow leans on idle crew or squadmates.
