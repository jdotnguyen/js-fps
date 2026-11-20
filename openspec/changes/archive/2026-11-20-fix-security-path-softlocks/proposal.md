# Proposal

## Why

The action half from the Lab Junction (R05) to the flooded tunnel (R09) can soft-lock. The player gets stuck with Giles never unlocking the pressure door, every door in Security (R07) locked, and Okafor ignoring the med-lab door. Three faults combine to cause it:

1. **A ceiling spawn lands on the roof.** `r06_ceiling` spawns at y 3.8 in a 4 m room. On its first step the motor treats the ceiling slab's top (y 4.12) as ground within the 0.35 m step height and stands the zombie on it. Shots stop at the ceiling collider, so the zombie can't be hurt. Enemy reach only measures horizontal distance, so it still hits and grabs Jay through the slab. `waitGroup r06_cover` never finishes and `cover_done` is never set. The climax's two ceiling spawns in R11 (`r11_vent_1`, `r11_vent_2`) have the same placement.
2. **Squad panel tasks can stall.** A task starts only when the worker is within 0.85 m of its anchor, but squadmates keep 1.1 m from Jay. With Jay on the objective marker (`anchor:r06_panel`, which sits inside `trig_r06_door`) or at the door he is trying (`okafor_biometric` beside D_R07_R09), the worker hovers just out of range forever. `SquadTask` has no give-up, unlike `NpcActor.moveTo`.
3. **Early triggers are lost.** Level triggers fire once. A sequence whose `requires` flag is not set yet drops the event. D_R06_R07 opens partway through `cover_me`, before `cover_done`, so walking into R07 early spends `trig_r07_enter` and `trig_r08_glass`. The armory and glass scene then never run. A scripted fight that can't finish (fault 1) also blocks its sequence with no way out.

The tests in `action.test.ts` fire triggers in the ideal order with flags pre-set, so none of this is covered.

## What Changes

- **Emerging spawns land on the floor.** A vent or ceiling spawn that comes out above the floor drops to the walkable floor below it. It SHALL NOT snap up onto a ceiling, a roof slab or anything above the spawn point.
- **Enemy reach respects height.** An enemy strike, grab or bite connects only when the target is within reach vertically as well as horizontally, so nothing hits through floors or ceilings.
- **Squad panel tasks always start.** A worker starts on the panel when close enough given the space kept from Jay, and after a short stuck time starts where he is, as the scripted move already does. A task never waits forever to arrive. The threat that pauses a task counts only enemies on the worker's own floor level, so an enemy above a ceiling or below a floor can't hold it paused.
- **Early level triggers are kept.** A one-shot level trigger that reaches a sequence before the sequence's `requires` flag is set is held, and the sequence runs once that flag is set, if its `unless` flag is still clear. Repeatable events (such as `door:denied`) are not held; the player can trigger them again.
- **Scripted fights have a fail-safe.** A group that can't be cleared (an enemy that stops making progress or can't be reached for a set time) is resolved, so `waitGroup` and the sequence behind it complete.
- **Regression tests** for each fault: early entry into R07, Jay standing on a task anchor, a ceiling spawn under a roof slab, a reach check through a ceiling, and an unclearable group.

## Capabilities

### New Capabilities
- `squad-tasks`: squad panel jobs (Giles's bypasses, Okafor's biometric lock): reaching the panel, working, pausing under threat, and never stalling before the work starts.
- `sequence-triggers`: how sequences start from events and level triggers when gated by `requires` / `unless` flags, including events that arrive before the sequence is allowed to run.
- `enemy-encounters`: spawned enemies in scripted fights: where emerging spawns land, how far an attack reaches (horizontally and vertically), and how a group that can't be cleared is resolved so its fight ends.

### Modified Capabilities
- None. No existing spec covers squad AI, enemy spawning or sequence triggering. `player-movement` and `level-kit` are unaffected.

## Impact

- **Enemy AI:** `src/ai/enemyDirector.ts` (spawning emerging bodies), `src/ai/enemy.ts` (strike reach, stuck detection), `src/actors/motor.ts` only if the drop needs a downward-only settle.
- **Squad AI:** `src/ai/squadBrain.ts` (`SquadTask`), `src/ai/squad.ts` (task arrival and give-up).
- **Script runtime:** `src/script/runtime.ts` (holding early triggers), the `waitGroup` action in `src/script/actions.ts`; checkpoint save and restore of held triggers.
- **Content:** no sequence or level edits are needed for the fixes; `slice01.json` spawn data stays as is.
- **Tests:** `src/script/action.test.ts`, `src/ai/squad.test.ts`, `src/ai/squadBrain.test.ts`, `src/ai/enemy.test.ts`, `src/ai/enemySim.test.ts`, and the runtime tests in `src/script/script.test.ts`.
- **Out of scope:** moving the spawn points in level data, a loader check for spawns placed near ceilings, the dead `task` field on doors in `slice01.json`, and any other room or sequence.
