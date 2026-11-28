# Design

## Context

See `proposal.md` for motivation and scope. Four concrete mechanisms in the current codebase drive the issues observed during playtesting:

1. **Speech timing (`src/dialogue/speech.ts`, `src/dialogue/voicePlayer.ts`):** `WebAudioVoicePlayer.play` returns `duration = recordedBuf.duration + leadIn + (radio ? 0.16 : 0.08)` only when a decoded recording plays (`recordedBuf`). However, `SpeechManager.begin` computes `Math.max(e.duration, playback.duration ?? 0)` where `e.duration = subtitleDuration(text, minDuration) = Math.max(minDuration, words * 0.35 + 0.8)`. Across the 58 `intro_*` recordings (154.2 s actual audio), this adds **43.8 s of post-VO dead air** across 43 lines (up to +2.09 s after a single line), on top of `gap = 0.2 s`.
2. **Speaker gaze (`src/ai/npcs.ts`, `src/main.ts`):** `NpcDirector.lineStarted(speaker)` has no addressee parameter; it guesses `answer = this.lastTalker`, falling back to `'player'` only if `lastTalker` is absent or out of range. In multi-person beats (`intro_shift_change` dock checkpoint and kitchen), speakers repeatedly stare at whoever spoke last on an unrelated thread.
3. **Bram's kitchen choreography & intro waits (`scripts/gen-slice01.mjs`, `src/data/levels/slice01.json`, `src/data/sequences/intro_shift_change.json`):** `cook_to_giles` takes a wide ~3.5 m detour (`[27.35, 0, 12.3] -> [28.6, 0, 12.35] -> [29.3, 0, 11.85]`), and `intro_shift_change.json` runs Bram's coffee pour (`1.4 s`), Okafor turn, `cook_to_giles` walk (`wait: true`), and `offer_mug` (`wait: 0.7 s`) sequentially between lines, leaving multi-second silent gaps.
4. **Standing model slow leans (`src/actors/animator.ts`, `src/ai/npcActor.ts`, `src/ai/squad.ts`):** Only `idle` and `walk` are in `MOCAP_LOCO_POSES`. Core mocap clips (`idle`, `walk`) carry ~15–18° chest pitch and ~13° pelvis yaw, whereas authored `poses.json` poses (`offer_mug`, `idle_weight`, `idle_shift`, `glance`, `head_tilt`, `idle_crossed`, etc.) sit at ~0°. Every time a standing NPC plays any pose outside `MOCAP_LOCO_POSES` — Bram playing `offer_mug` right after walking, or any live NPC/squadmate firing an ambient fidget every 5–12 s — `mocapW` fades `1 -> 0` and back, producing a visible slow lean/twist. Tight indoor walk stops also amplify tilt via `updateInertialPhysics` (`accelLean` up to ±7°, `bankTarget` up to ±9°).

Active sibling changes on disk:
- `per-character-motion` touches `src/actors/animator.ts` (additive posture holds in D4, upper-body arm-only talk overlay in D13, character pose variants like `bram_offer_mug` and `okafor_glance`). Our fix uses the same upper-body overlay strategy and works for both base pose names and character-prefixed variant names.
- `priya-commons-exit` owns Priya's exit route at the end of `intro_shift_change.json`. We leave Priya's exit anchor and final walk step untouched.

## Goals / Non-Goals

**Goals:**
- Natural recorded-VO pacing across the game (no artificial 1–2 s silence after spoken clips, while keeping a comfortable conversational breath between lines and preserving `subtitleDuration` for fallback/headless tests).
- Explicit addressee targeting (`to`) for dialogue lines and `say` steps, with zero breaking changes to existing lines that omit `to`.
- Tighter, natural opening and kitchen pacing in `intro_shift_change` with Bram still serving Giles from his far side (side-on to Jay), overlapped with kitchen banter.
- Eliminate the involuntary slow lean on Bram (`offer_mug`) and across all standing live NPCs and squadmates (`ambientGesture` / `SQUAD_FIDGETS`), without breaking `idleLife.test.ts`, `motionHolds.test.ts`, or `mocapPhysics.test.ts`.

**Non-Goals:**
- Cutting or re-recording any VO lines.
- Modifying `mocap-core.json` baked clip keyframes or retargeting pipelines.
- Changing Priya's Commons exit path (`priya-commons-exit`) or pacing later chapters (3 Rounds / The Drop).

## Decisions

### D1. Recorded VO drives line duration; `subtitleDuration` stays the fallback
In `SpeechManager.begin()` (`src/dialogue/speech.ts`):
- When `playback.duration !== undefined` (set by `WebAudioVoicePlayer` only when `recordedBuf` is decoded), compute `duration = Math.max(MIN_VO_DURATION, playback.duration)` with `MIN_VO_DURATION = 0.85` s.
- When `playback.duration === undefined` (missing recording, procedural emote fallback, or test fake player without a duration), keep `duration = e.duration` (`subtitleDuration(line.text, line.minDuration)`).
- Lower default `SpeechManager.gap` from `0.2` s to `0.15` s. Because `WebAudioVoicePlayer` already appends `+0.08 s` (`+0.16 s` radio) to `recordedBuf.duration`, total natural breath between consecutive local lines is ~0.23 s — crisp and conversational without feeling rushed or jarring.
- In `WebAudioVoicePlayer.play()` (`src/dialogue/voicePlayer.ts`), ensure the missing-PA-fixture early return only attaches `duration` when `recordedBuf` is present, so fallback timing stays consistent.

*Alternative considered:* Lowering `subtitleDuration` formula globally (e.g. `0.22 s/word`). Rejected: when VO is missing or muted, readers still need comfortable subtitle reading time, and a word-count heuristic still mismatches fast vs. deliberate voice acting.

### D2. Explicit addressee (`to`) on `DialogueLine` and `say` steps
- Add `to: optional(str)` to `DialogueLine` (`src/data/types/dialogue.ts`), `SayOptions`, and `SpeechInfo` (`src/dialogue/speech.ts`), plus `to: optional(str)` to the `say` action in `src/script/actions.ts` and `ScriptSpeechOptions` in `src/script/host.ts`.
- Precedence: `step.to ?? line.to ?? undefined`.
- In `src/main.ts`, resolve `info.to` through the same speaker/NPC mapping (`'player'` stays `'player'`, `'npc:<id>'` strips `'npc:'`, speaker ids like `'engineer'`/`'medic'`/`'nurse'`/`'crew_cook'` map via `npcIdForSpeaker`, and direct NPC ids like `'giles'`/`'okafor'`/`'cook'`/`'priya'`/`'dock_guard'` pass through if `npcs.has(id)`).
- Pass the resolved addressee into `npcs.lineStarted(speaker, addressee)` (`src/ai/npcs.ts`). Inside `lineStarted`, if `addressee` is defined, differs from `speaker`, and is a valid target (`'player'` or an existing NPC within `LISTEN_RANGE`), use `addressee` as the speaker's `answer`; otherwise fall back to the existing `this.lastTalker` / `'player'` logic.
- Annotate multi-person lines in `src/data/dialogue/slice01.json` (line-level `to` for lines with one clear addressee in the script, e.g., `intro_sung_01 -> player`, `intro_okafor_01 -> player`, `intro_guard_04 -> okafor`, `intro_giles_01 -> okafor`, `intro_okafor_03 -> player`, `intro_giles_04 -> player`, `intro_cook_01 -> player`, `intro_giles_09 -> cook`, `intro_okafor_06 -> cook`, `intro_cook_03 -> okafor`, `intro_okafor_10 -> cook`, `intro_giles_15 -> cook`, `intro_giles_10 -> okafor`, `intro_priya_04 -> giles`, `intro_giles_11 -> priya`, `intro_giles_12/13 -> player`, `intro_priya_05 -> player`, `intro_okafor_09 -> player`, `intro_giles_14 -> player`, etc.).

*Alternative considered:* Adding `npcLookAt` steps before every `say` in sequence JSON. Rejected: verbose, brittle if lines reorder, and `npcLookAt` locks override `talkLook` until explicitly cleared with `"target": "none"`.

### D3. Standing upper-body pose overlay on mocap base (fixes the slow lean)
In `src/actors/animator.ts`:
- Classify standing upper-body / fidget poses into overlay masks (supporting both base names and profile-resolved variants such as `bram_offer_mug` or `okafor_glance` via base-name matching):
  - **Arms + head overlay** (`offer_mug`, `idle_crossed`, `talk_gesture`, `idle_hips`, `wave`, `point`, `rub_forearm`, `flex_hand`, `cough`): keep `mode = 'loco'` and `targetW = 1` so pelvis, spine, chest, thighs, shins, feet, and root stay on the mocap base, while blending `this.current` onto `shoulder_L/R`, `upperArm_L/R`, `foreArm_L/R`, `hand_L/R`, `neck`, `head` (smoothly driven by `this.current`'s staggered pose transition).
  - **Head / glance overlay** (`glance`, `glance_other`, `look_down`, `look_up`, `head_tilt`): keep `mode = 'loco'` and `targetW = 1` on pelvis, spine, legs, and arms; blend `neck`/`head` from `this.current`, and apply ONLY the authored pose's chest yaw delta additively onto the mocap chest (so `glance` vs `okafor_glance` retains its subtle chest turn difference without stripping mocap chest pitch/roll!).
  - **Weight-shift fidgets** (`idle_weight`, `idle_shift`): keep `mode = 'loco'` and `targetW = 1` on the mocap idle (which already contains natural organic weight shifts) with at most a tiny additive head/shoulder micro-offset, rather than dropping `mocapW` to `0`.
- Also in `NpcActor.ambientGesture` (`src/ai/npcActor.ts`) and `SquadMate.idleGestures` (`src/ai/squad.ts`): keep the existing fidget pools and `idleLife.test.ts` pose contracts working, because the `Animator` overlay guarantees none of them ever drop `mocapW` out of mocap idle!
- In `Animator.updateInertialPhysics` (`src/actors/animator.ts`) and `Humanoid.updateKinematics` (`src/actors/humanoid.ts`): compute true single-frame acceleration `(vx - prevWorldVel) / dt` before low-pass smoothing acceleration (eliminating 5×–10× FPS-dependent amplification), keep `leanLatSpring` targeting `0` (driven only by `nudgeImpulse` so centripetal turning never leans outward), and scale `speedLean`, `accelLean`, and `bankTarget` gently at indoor walk speeds.
- In `FootIkSolver` (`src/actors/footIk.ts`), `sampleLocomotion` (`src/actors/mocap.ts`), and `Animator.updateTurnInPlace` (`src/actors/animator.ts`): tighten `MAX_PIN_DRIFT` (`0.42 -> 0.14 m`) and `MAX_PELVIS_DROP` (`0.085 -> 0.045 m`), smoothly relax excess pin drift beyond an idle deadzone (`0.045 m`) back under the hips, release swing-foot contacts above `0.04–0.28 m/s`, and drive pivot foot lift up to `0.25 m/s` so characters step instead of leaning whole-body over glued feet.
- In `NpcActor` (`src/ai/npcActor.ts`): keep authored curves (`cook_to_giles`) tight with collision-only avoidance (`0.35 m`), tighten arrival stop settle (`accel: 7`, `turnRate: 3.4`), and defer placed poses (`lean_*`, `sit_*`) until arrival facing aligns within ~20°.

*Alternative considered:* Zeroing mean chest pitch/pelvis yaw in `mocap-core.json`. Rejected: alters every baked clip in `per-character-motion` and still leaves per-character idles (`giles_idle`, `okafor_idle`) mismatched against `0°` `poses.json` poses. Keeping the character's mocap trunk active and overlaying only upper-body/arm/head joints works for EVERY character's unique idle clip automatically!

### D4. Tighter intro pacing & Bram's far-side coffee serve
- **Waypoints (`scripts/gen-slice01.mjs` -> regenerate `src/data/levels/slice01.json`):** Tighten `cook_to_giles` from `['cook_turn_okafor', [27.35, 0, 12.3], [28.6, 0, 12.35], 'cook_serve_giles']` to a closer arc around Okafor/Giles (checking clearance from `giles_kitchen` / `okafor_kitchen` / counter colliders so Bram never clips Giles or the counter) while still ending at `cook_serve_giles` on Giles's far side so Jay sees the hand-off side-on.
- **Kitchen serve overlap (`src/data/sequences/intro_shift_change.json`):**
  - Start Bram's pour (`cook_coffee` -> brief `typing` -> `cook_turn_okafor`) in parallel with `intro_giles_09` and `intro_okafor_06` instead of waiting until after Okafor finishes speaking, eliminating the dead `1.4 s` wait + two sequential walk stalls.
  - Overlap Bram's walk (`cook_to_giles`, `speed: 1.55`) with `intro_okafor_10` ("Cheers, Bram. You're a saint."), then trigger `offer_mug` + a crisp `0.45 s` beat -> `lean_back_mug` + `intro_giles_15` ("Traitor. Thanks, Bram.") + `idle`.
- **Opening/dock/walk dead-wait trims (`src/data/sequences/intro_shift_change.json`):**
  - Trim the opening sub-docking waits moderately (`4 + 4 + 1 + 1` = 10 s -> e.g. `2.5 + 2.5 + 0.6 + 0.6` = ~6.2 s, keeping the visual arrival beat of Halcyon docking without feeling dead).
  - Trim redundant post-scan and transition waits slightly (`0.8 + 0.3` -> `0.5`, `0.6` -> `0.35`, corridor walk speed `1.3` -> `1.45 m/s`) while keeping every single voiced line, every checkpoint scan beat, and skip end-state parity verified by `src/script/intro.test.ts`.

## Risks / Trade-offs

- **[Upper-body overlay on `offer_mug` could shift mug hand world position slightly relative to mocap chest pitch]** -> `offer_mug` is a non-contact held gesture (no counter IK anchor); verify in `src/actors/mocapPhysics.test.ts` / browser that Bram and Priya hold out their mugs cleanly in front of them at natural chest height.
- **[`per-character-motion` also edits `src/actors/animator.ts`]** -> Keep our changes localized to a small overlay helper + `updateMocapBase` + `updateInertialPhysics`, using profile-resolved pose names (e.g., stripping `<char>_` prefix or matching `basePoseName`) so any new character variant poses added by `per-character-motion` work seamlessly.
- **[`scripts/gen-slice01.mjs` regeneration could touch unrelated dirty changes in `slice01.json`]** -> Check `git diff src/data/levels/slice01.json` before regenerating and verify whether other agents modified `slice01.json`; update both `scripts/gen-slice01.mjs` and the `cook_to_giles` entry cleanly.
- **[Overlap timing in kitchen if VO plays faster than Bram walks]** -> Use a `parallel` block so `intro_okafor_10` and `cook_to_giles` run simultaneously and synchronize cleanly right before `offer_mug`, guaranteeing Bram has arrived before offering Giles the mug regardless of headless vs. real-audio playback speed.
