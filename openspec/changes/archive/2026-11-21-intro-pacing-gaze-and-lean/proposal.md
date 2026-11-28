# Proposal

## Why

The opening shift-change intro (`intro_shift_change`) drags with over 40 seconds of artificial post-VO silence and sequential walk/wait stalls, Bram takes a wide detour and visibly leans before serving Giles coffee, speakers in multi-person exchanges stare at whoever happened to talk last instead of who they are addressing, and living standing models across the game periodically perform a slow sideways/backward lean during ambient fidgets. Fixing VO pacing, addressee gaze, Bram's kitchen choreography, and standing mocap posture transitions makes the opening and live NPCs feel natural without cutting voiced lines.

## What Changes

- **Natural recorded-VO pacing (`SpeechManager` / `WebAudioVoicePlayer`):** When a recorded voice clip plays, drive the line timer from the recording's actual duration (with a small readability floor and a natural conversational breath between queued lines) instead of inflating fast lines to `subtitleDuration` (`words * 0.35 + 0.8`), which currently adds 43.8 s of dead silence across 43 of 58 intro lines. Keep `subtitleDuration` as the fallback when a recording is unavailable or synth/headless playback is used.
- **Tighter intro staging & Bram's coffee choreography:** Trim excessive dead waits in `intro_shift_change.json` while preserving natural breathing room and all existing voiced lines; slightly tighten `cook_to_giles` in `scripts/gen-slice01.mjs` / `src/data/levels/slice01.json` (still approaching Giles from his far side so Jay sees the hand-off side-on) and overlap Bram's walk and serve with Okafor's and Giles's lines instead of stalling dialogue behind sequential waits. Leave Priya's exit route untouched (owned by `priya-commons-exit`).
- **Explicit speaker addressee gaze:** Add an optional `to` addressee field on `DialogueLine` and `say` sequence steps (`"player"` or an NPC/speaker id), propagate it through `SpeechInfo` and `speech:started` into `NpcDirector.lineStarted(speaker, addressee)`, and tag multi-person lines in `intro_shift_change` so speakers look at who they are actually addressing rather than `lastTalker`. Keep `lastTalker` / Jay as the fallback when `to` is omitted, and clear stale scripted `npcLookAt` locks after beats finish.
- **Eliminate standing model slow leans:** Stop ambient standing fidgets (`NpcActor.ambientGesture`, `SquadMate.idleGestures`) from kicking mocap-idle characters out of `mocapW = 1` into upright `0°` `poses.json` poses; keep the mocap trunk/lower-body active during standing upper-body action poses such as `offer_mug` by blending only the upper-body/arm/head joints over the mocap base; and dampen stop/corner inertial pitch and roll on slow indoor walks in `Animator.updateInertialPhysics`.

## Capabilities

### New Capabilities
- `npc-conversation-gaze`: Explicit addressee targeting for speaking NPCs in dialogue and sequence steps, overriding the default last-speaker listen-look heuristic.
- `standing-posture-stability`: Standing living humanoids preserve mocap trunk/lower-body stability across ambient fidgets, upper-body action poses (e.g. `offer_mug`), and slow indoor stops without involuntary leaning or twisting.

### Modified Capabilities
- `voice-playback`: Recorded voice lines pace to their actual audio duration with a short readability floor and natural inter-line breath, reserving `subtitleDuration` for fallback playback.
- `intro-sequence`: Tightened opening/kitchen pacing, tighter far-side coffee serve path for Bram overlapped with dialogue, and addressee-accurate speaker gaze throughout multi-person beats.

## Impact

- **Dialogue & speech:** `src/dialogue/speech.ts`, `src/dialogue/voicePlayer.ts`, `src/data/types/dialogue.ts`, `src/dialogue/speech.test.ts`, `src/data/dialogue/slice01.json`.
- **Sequence & level data:** `src/script/actions.ts`, `src/script/host.ts`, `src/script/gameHost.ts`, `src/data/sequences/intro_shift_change.json`, `scripts/gen-slice01.mjs`, `src/data/levels/slice01.json`, `src/script/intro.test.ts`.
- **NPC gaze & animation:** `src/main.ts`, `src/ai/npcs.ts`, `src/ai/npcActor.ts`, `src/ai/squad.ts`, `src/ai/listenLook.test.ts`, `src/actors/animator.ts`, `src/actors/animator.test.ts` (or colocated animation test).
- **Coordination:** Harmonizes with `per-character-motion`'s upper-body/additive layering in `src/actors/animator.ts` (D4/D13) and leaves Priya's Commons exit untouched for `priya-commons-exit`.
- **Out of scope:** Cutting/re-recording VO lines, altering Priya's exit spot/route, and pacing changes to 3 Rounds or The Drop (deferred).
