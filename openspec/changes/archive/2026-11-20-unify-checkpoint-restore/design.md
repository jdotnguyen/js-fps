# Design

## Context

See proposal.md (Why). Today:

- `Game.restartFromCheckpoint()` = `load(autosave, quiet)` + heal + fade-in + `emit('game:restarted')`.
- The title menu (`ui/menus/screens.ts`) calls `game.load(data)` only. No `game:restarted`, so none of its listeners run: `npcs.reset()`, `EnemyDirector.reset(cleared)`, `Guidance.fresh`, speech stop, and `SequenceManager.onRestart` (cancel, apply the in-memory checkpoint snapshot, resume, re-fire restore scenes).
- The squad is not part of `npcs.reset()` (`levelSpawns` excludes it). `Squad.update` re-places a mate only on its first update or when Jay moves more than 4 m in one step, and skips a mate a sequence holds (`scripted`). On a title load both paths are fragile: the jump can land in the same step that a scene holds a mate, and nothing re-arms placement on purpose.
- Level triggers are one-shot per session; only `Level.resetToData()` (new game) re-arms them.

## Goals / Non-Goals

Goals: a title load and a death restart run the same restore; the squad is placed deliberately after every restore; job beats cannot be stalled by a squadmate far behind.

Non-goals: persisting enemies, corpses, gore or the in-memory script snapshot in the save (no save schema change); changing what a death restart does to the live level; the R13d door / dive bay question.

## Decisions

**1. One private `restore(save, opts)` in `Game`.** Both `load()` (title) and `restartFromCheckpoint()` call it. It does what `load()` does today, then the fade-in and `emit('game:restarted', { checkpoint })`. Options: `fromTitle` (reset the level to data first), `heal` (death only), `toast`. Alternative considered: a new `game:loaded` event with its own listeners. Rejected: it would duplicate every restart listener and drift; the restart listeners already encode "rebuild from a checkpoint".

**2. Title load resets the level to data first.** `world.resetToData()` before placing Jay, then the restore scenes re-apply doors from flags, as on a fresh page. A death restart keeps the live level, as now, because its in-memory snapshot restores doors and lights and the beat replay depends on it. Alternative: reset on death too, re-arming triggers there. Rejected for this change: it alters death-restart behaviour the playtest checklist already covers.

**3. Squad placement is requested, not inferred.** `Squad.requestPlacement()` clears `placed`; `main.ts` calls it on `game:restarted`. The next `Squad.update` (after `sequences.update` in the loop) places every mate that is not `scripted`, so restore scenes that hold a mate (reveal_restore) keep their placement. `npcs.reset()` already released every hold before the restore scenes re-ran. The 4 m jump check stays as a fallback.

**4. `squadRegroup` sequence step.** New action in `actions.ts` with no arguments (optional `distance`, default 12 m), calling `host.squadRegroup?.(distance)` → `NpcDirector.regroup()` → `Squad.regroup(distance)`. `Squad.regroup` moves each mate, held ones included (at a beat's start the previous scene often still holds them, as `valve_turn` does when the climax starts), that is farther than `distance` from Jay and is out of his view (outside a 70 degree half-angle of his facing, or with no direct line on the nav graph) to `spawnSpot(m)`, the spot the restore placement already uses. It returns the ids moved, so the step can log them in debug. It runs before the beat's `npcMoveTo`/`npcTask` steps, which hold the mate. Alternative: teleport inside `npcTask` when the walk is long. Rejected: hidden and per-task; a visible step in the beat data is easier to reason about and reuse.

**5. Beats that get it.** First step of `cover_me` (action_contact), `medlab_door` (action_tunnel) and `climax` (action_climax). Not the reveal: it follows the climax, where both mates are already in the room.

**6. `gatherIn { room, timeout = 8 }` step.** A pending action that each update checks Jay's feet and each squadmate's position with `Level.roomAt` (via a host `inRoom(who, room)`). It ends when all three are inside. At the timeout it calls `host.squadPlaceIn(room)` → `Squad.placeIn(roomTest)`: each unscripted or held mate outside the room goes to `spawnSpot` (near Jay, behind him where possible), which is inside the room because Jay is. It then keeps waiting for Jay only, with no timeout, since he is under player control. Skip places the mates and ends. In `drop.json`, the seal moves from step 2 to just after the two `npcMoveTo` steps and a `gatherIn R03`. Alternatives: `npcMoveTo` with `wait: true` before sealing (rejected: hangs forever on a blocked path and ignores Jay stepping out); a door flag "never close on a squadmate" (rejected: hides scene timing inside the door system). Other seals today do not shut anyone out: `contact` seals the door ahead (`D_R05_R06`), and the climax seals R11 once everyone is in it.

**7. Climax arena.** `climax` seals `D_R13b_R13d` right after it opens `D_R13d_R11`, and `action_restore` seals it again when `climax_started` is set. R13d stays reachable as part of the fight: enemies come that way, and the squad-tasks and enemy-encounters rules already treat it as part of the level. A `gatherIn R11` goes between the fight's end and `climax_giles_03`, so the line, the seal and the `climax:won` reveal all follow Jay's return. Alternative: keep `D_R13d_R11` closed to Jay and enemy-only. Rejected: doors have no enemy-only state, and adding one is larger than this fix.

**8. Debug jump fade.** In the `jump` branch of `main.ts`, call `hud.setFade(0, 0.4)` after `sequences.cancelAll()`, as the `drop` branch does.

## Risks / Trade-offs

- [`game:restarted` listeners assumed a death came first] → `SequenceManager.onRestart` uses the in-memory snapshot only when its checkpoint id matches the save's; on a fresh page there is none and it only re-fires restores. `dying` is empty without a death. Checked in a unit test of `Game`.
- [Teleport seen by the player] → only mates out of view and far away move; destination prefers behind Jay.
- [Title load resets triggers the save expects fired] → triggers are gated by `requires`/`unless` flags, which the save restores, so a re-fired trigger whose beat is done does nothing.
- [Beat in progress at a room-entry checkpoint is not replayed on a title load] → the entry trigger re-fires when Jay walks in (decision 2). Persisting the script snapshot is left for later if playtests show a gap.

## Migration Plan

No data migration. Saves keep version 3. Rollback is reverting the change.
