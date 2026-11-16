# ADR-0009: Sequence (scripting) system

Status: Accepted (in-world cutscenes) / Proposed (format)

## Context
The opening is quiet, then "the drop", shown as an in-world, first-person scene the player
can still interact with [Decided]. Set pieces include transformations and people killed
behind glass [Decided]. The slice ends on a scripted cliffhanger [Decided]. Chapters must
be data [Decided].

## Decision
Sequences are JSON action lists interpreted at runtime, with serial and parallel blocks,
event waits, flags, and named JS hooks for one-off logic.

## Details

### Format
```json
{
  "id": "intro_drop",
  "trigger": { "event": "trigger:r03_gallery_enter" },
  "once": true,
  "steps": [
    { "do": "playerControl", "move": "slow", "look": "free" },
    { "do": "say", "line": "giles_intro_03" },
    { "do": "wait", "s": 1.5 },
    { "parallel": [
      { "do": "lightState", "room": "R03", "pattern": "dying" },
      { "do": "sfx", "id": "power_down", "at": "R03" },
      { "do": "playerLookAt", "target": "npc:lab_researcher_01", "duration": 0.8 }
    ]},
    { "do": "npcAnim", "npc": "lab_researcher_01", "anim": "convulse", "wait": true },
    { "do": "transform", "npc": "lab_researcher_01", "to": 3, "duration": 6 },
    { "do": "glass", "id": "G_R03_R04", "state": "cracked" },
    { "do": "emit", "event": "story:first_drop" },
    { "do": "playerControl", "reset": true },
    { "do": "setObjective", "id": "obj_survive_lab" },
    { "do": "checkpoint", "id": "cp_first_contact" }
  ]
}
```

### Action types (initial set)
Flow: `wait`, `waitFor` (event, optional timeout), `parallel`, `if` (flag), `setFlag`,
`emit`, `runHook`, `loop` (with `until` event).
Player: `playerControl`, `playerLookAt`, `playerClampLook`, `playerWalkTo`, `fade`,
`cameraShake`, `timeScale`.
NPCs: `npcMoveTo`, `npcAnim`, `npcLookAt`, `npcTask` (ADR-0011), `npcFollow`, `transform`,
`spawn`, `despawn`, `attachToTrack` (for "dragged away" scenes).
World: `doorState`, `lightState`, `glass`, `water` (flood level), `sfx`, `music`, `ambience`.
Story: `say` (ADR-0010), `setObjective`, `completeObjective`, `checkpoint`, `endSlice`.

### Runtime
- Each running sequence is a cursor over steps; actions implement
  `start(ctx)`, `update(dt) -> done?`, `cancel()`.
- Multiple sequences can run; a sequence can declare `exclusive` groups to avoid
  conflicts (e.g. two that both control the player).
- **Control stack:** every `playerControl` change is pushed onto a stack owned by the
  sequence and popped on end or cancel, so control is always restored.
- **Checkpoints:** snapshot of flags, objectives, door/light states, player HP/ammo, squad
  positions, alive enemies. Death restores the snapshot and restarts sequences that were
  marked `resumeFromCheckpoint`.
- Sequences are not skippable unless they set `skippable: true` (amended by ADR-0017). Every
  action implements `finish()`, which applies its end state instantly, so a skip is
  `finish()` on all remaining steps. In-world scenes where the player keeps control (the
  drop) stay unskippable.

### Debug
- `?seq=<id>` starts a sequence (with prerequisite flags from its `debugSetup`).
- Overlay lists running sequences and their current step.

## Consequences
- New scenes need no code unless they need a new action type; one-off logic goes in hooks.

## Alternatives rejected
- Sequences as JS modules: more power but not data, harder to author later with a tool.
- Pre-rendered or camera-cut cutscenes: rejected by the "real-time, first person" decision.

## Execution steps
1. [Done] Interpreter with flow actions + validation (`src/sequence/`).
2. [Partly done] Player actions and control stack (`playerControl`, `playerLookAt`, `playerWalkTo`, `playerPlace`, `say`, `fade`, `sfx`, `checkpoint`); world actions still to do.
3. NPC actions (stub until ADR-0011), `transform` (ADR-0006), `say` (ADR-0010).
4. Objectives and checkpoints.
5. Debug overlay and `?seq=`.

## Definition of done
- The example sequence above runs end to end in a test room, and dying mid-sequence then
  respawning restores a consistent state.

## Open questions
- None blocking.

## Progress log
- 2026-11-15: Steps 1, 2, 4 and 5 implemented on branch `adr/0009-sequence` (uncommitted).
  Step 3 is stubbed: NPC actions and `transform` go through `host.npc` and warn once until
  ADR-0006/0007/0011 provide it; `say` warns until the speech manager is wired into the game
  (ADR-0010).
  - `script/actions.ts`: one table holding schema and implementation of every action;
    `script/runtime.ts`: serial/parallel cursors, control stack per sequence, exclusive
    queue, triggers, checkpoints; `script/gameHost.ts`: the only file that touches the game;
    `script/overlay.ts` + `?seq=<id>`; data in `data/sequences/`.
  - **Convention:** `wait` defaults to false on every action (the step returns at once);
    `say` is the exception and waits for the line unless `"wait": false`.
  - **Added to Level:** `setDoor`, `doorStates`, `setRoomLights`, `roomLightPatterns`,
    `anchorPosition`. **Added to Game:** `reachCheckpoint` is now public.
  - **Checkpoint restore:** doors and room lights are snapshotted in memory at each
    `checkpoint` step and put back on `game:restarted`. Flags come from the autosave as
    before. On death every sequence is cancelled (control released); those marked
    `resumeFromCheckpoint` that had not yet reached a checkpoint restart from step 0.
    **Gap:** the snapshot is not persisted, so a page reload loses door/light state (ADR-0016).
  - **Not available yet (warn once, then skipped):** `cameraShake`, `glass`, `water`, `music`,
    `ambience`, all NPC actions, `say`. Level triggers that fire sequences need the level's
    `trigger:fired` event, which already exists.
  - Verified: 123 unit tests (schema errors with paths, the ADR example end to end, control
    always released on end/cancel/failure, exclusive queue, death and restore, the shipped
    `test_drop.json`), `tsc --noEmit` clean.
  **Not verified:** running in the browser (`?debug&level=kit_test&seq=test_drop`), overlay
  appearance, performance. `vite build` could not run in the agent's Linux VM (the repo's
  node_modules are macOS builds).
