# Design

## Context

There are four separate faults, each in a different system: enemy spawning and attacks, squad tasks, and the script runtime. See proposal.md (Why). Their current state, as the code reads today:

- **Emerge spawns.** `EnemyDirector.spawnFrom` places vent and ceiling spawns at the authored point (y 3.8 for `r06_ceiling`, `r11_vent_1`, `r11_vent_2`) and the `Enemy` starts prone, then gets up (`start: 'emerge'`). The motor's `settleVertical` looks for ground up to `y + stepHeight` (0.35 m). From y 3.8 that reaches the 4.12 top of the ceiling slab (`ceilingTile`, solid from `h` to `h + 0.12`), and `hasHeadroom` passes because nothing lies above the slab.
- **Attack reach.** `Enemy.step` measures `dist = Math.hypot(toX, toZ)`. The windup (`setState('windup')`) and `strike` both test `dist` against `reach()` only.
- **Squad tasks.** `SquadMate.act` arrives a task only within `SQUAD_TUNING.arrive + 0.15` (0.85 m) of `task.at`. Movement adds a separation push from Jay at `personalPlayer` 1.1 m. `SquadTask` has no give-up. The threat check is `Math.hypot(dx, dz) < TASK_THREAT`, which ignores height.
- **Script runtime.** `ScriptRuntime` subscribes each trigger event and calls `fire(list, payload)`, which skips a sequence whose `requires` is unset. Level triggers are one-shot (`Level.fire` sets `t.fired`), and `Level` reset clears `fired`. Flags are a plain object written directly by `setFlag`, `setFlags` and debug setup.
- **Groups.** `waitGroup` finishes on `group:cleared`, which `EnemyDirector.onDied` emits when `spawner.died(group)` reports the group empty. `waitGroup` already takes an optional `timeout`, but a timeout leaves the stuck enemy alive and the sequence logic then runs with a live enemy still about.
- **Nav.** `Nav.nearest` scores nodes by horizontal distance plus twice the height gap, then accepts the first node with a direct line. An enemy on the roof can still snap to a floor node, so `findPath` from it can succeed and can't on its own prove reachability.

## Goals / Non-Goals

**Goals:**
- Fix each fault where it lives, so the same bug can't come back in another room. No per-room data patches.
- Keep the existing tests and content behaviour unchanged when nothing goes wrong: normal arrivals, normal spawns, triggers that arrive in order.

**Non-Goals:**
- Changing the motor's general step-up or ground search for walking bodies (Jay, squad, enemies on foot).
- Holding repeatable bus events, or adding a generic "replay events later" mechanism.
- Persisting held triggers in save files. They only live between checkpoints (see Decisions).
- Tuning fight difficulty, enemy HP or squad combat.

## Decisions

**1. Emerge spawns drop to the floor at spawn time, not by falling.**
At spawn, for `start: 'emerge'`, find the highest walkable top at or below the spawn point and set the motor there (`y = floor`, `vy = 0`, `grounded = true`) before the first step. Then run the existing prone-to-getUp emerge, so it still reads as coming out of the vent. The motor gets a small exported helper, `floorBelow(s, world, cfg)`, that runs the same box query as `standHeight` with `maxTop = s.y + SKIN`.
- *Alternative: let it fall under gravity.* The airborne settle still uses `climbLimit = stepHeight`, so the first falling frames at y ~3.79 would still pick the 4.12 slab. Fixing that means changing the motor for every body.
- *Alternative: move the spawn points down.* That fixes three points today and nothing tomorrow. The proposal leaves it out of scope.

**2. One vertical reach rule, shared by enemies and squad threat.**
Add `REACH_DY = 1.2` (feet-to-feet) in the enemy module. The windup and `strike` require `Math.abs(targetFeet.y - motor.y) <= REACH_DY` as well as the horizontal test. `TASK_THREAT` in squadBrain gets the same vertical bound: export `REACH_DY` and reuse it, so "on the same level" means the same thing in both places. 1.2 m covers Jay on a 1.0 m crate (his jump reach) with margin. Every ceiling or floor gap in the slice is at least 3.2 m.
- *Alternative: a line-of-attack ray against level colliders.* It's more exact, but costs a ray per attack, and a crate edge can block a legitimate swipe. The height test alone covers floors and ceilings.

**3. Squad tasks: a 1.5 m arrival radius and a 3 s no-progress give-up.**
- In `SquadMate.act`, arrive the task when within `TASK_ARRIVE = 1.5` m of `task.at`. That is beyond the 1.1 m personal space plus the body footprint, so Jay standing on the anchor can no longer hold the worker off.
- While the task is `walking`, track the best distance to `task.at`. If it hasn't improved by 0.1 m for `TASK_GIVE_UP = 3` s, arrive where he stands and turn to face `task.at`.
- Keep `SquadTask` a pure state machine: arrival stays the mate's decision, and the threat bound comes from Decision 2.
- *Alternative: drop the Jay push while on an errand.* It's narrower, but the worker would then walk through Jay, and it doesn't cover blocking by crates or the other mate.

**4. The runtime holds early level-trigger events and checks them when flags may have changed.**
- In `ScriptRuntime`, the `trigger:fired` path (level triggers only) calls a variant of `fire` that adds a sequence to a `held` set when the only thing stopping it is an unset `requires`. Direct bus subscriptions keep today's drop behaviour.
- Flags are a plain object written from several places, so `held` is re-checked at the start of `update(dt)`. For each held id whose `requires` is now set: drop it if `unless` is set, otherwise `begin` it and drop it.
- `begin` already refuses duplicates (`isRunning`, `queue`, `once`), and the entry is removed on that pass, which covers "at most once".
- `onRestart` and `cancelAll` clear `held`. Restarting re-arms level triggers (`Level` reset clears `fired`), so nothing is lost.
- The same level trigger can reach a sequence twice, as `trigger:fired` and as the bus event of its emit name. The bus path never holds, so only one entry is made.
- *Alternative: a Proxy on `flags` that notifies on write.* It's exact, but `flags` is the game's own object, shared with saves and debug tools. A per-frame scan of a set that is almost always empty costs nothing.
- *Alternative: re-arm the level trigger (`fired = false`).* Jay is usually still inside the box, so it wouldn't fire again until he left and came back.
- *Why not persist `held`?* Snapshots are taken at checkpoints (`takeSnapshot`), and a checkpoint restart re-arms the triggers. A save made while something is held restores to the checkpoint state, where the trigger can fire again.

**5. Unreachable group enemies are removed by the director.**
- Every 1 s, for each live enemy with a `group`, the director decides whether it is reachable. It is reachable when (a) a walkable nav sample point (`nav.nodes`, about 1 m apart on both the navmesh and the navgraph) lies within 1 m across and 0.6 m in height of its feet, and (b) `nav.findPath` from it to at least one target (Jay or a living squadmate) returns a route.
- Accumulate `unreachableT`, and reset it when the enemy is reachable. At 10 s, if Jay can't see it, remove it. The view test is `inPlayerView` in perception.ts, shared with `Squad.canSee`; the director passes a real collider line test, so a ceiling slab hides the body. At 30 s, remove it regardless.
- Removal goes through the normal death path (`Enemy.cull` calls `die`, then `onDied`, and the body is disposed with no gore), so `spawner.died`, `group:cleared` and the `enemy:died` listeners behave as for a kill. Emit `enemy:culled { id, group }` for debugging and tests.
- Check (a) is what catches the roof case. `findPath` alone succeeds from the roof (Context), and `floorBelow` is no help either: from feet on the slab it returns the slab itself. (The first draft of this design used `floorBelow` here, and implementation showed it could never fail.)
- *Alternative: rely on `waitGroup` timeouts in content.* That puts a magic number in every fight and leaves a live enemy behind when the sequence carries on.

## Risks / Trade-offs

- [A crawler or dragger sits low (`y` near the floor) while Jay is on a 1 m crate. That is still within 1.2 m.] → No change in behaviour; covered by the crate scenario.
- [The 1.5 m task radius places Giles visibly further from the panel when nobody is in the way.] → Arrival happens as soon as he's within 1.5 m, but the walk target is still `task.at`. When the spot is free he usually walks the last bit before the next think, so keep the authored yaw and accept the small offset when it isn't.
- [A cull fires on a legitimate enemy that is pathing slowly through a door being opened.] → It needs 10 continuous seconds with no route. Doors re-epoch nav (`door:state` → `navEpoch++`), and the timer resets as soon as a route exists.
- [Held sequences start where the player no longer is. For example, `armory_auto` would send Giles to the armory panel while Jay is back in R06.] → This is acceptable; it's the beat the player missed. It also matches what the sequence would do if Jay had waited.
- [A sequence's `requires` flag is set by debug or `setFlags` and runs a held sequence unexpectedly in a dev session.] → Only when its level trigger already fired this run, which is the intended meaning.
- [The view test can't see the culled body in a dark room and removes it in front of the player.] → 10 s unreachable plus out of view is conservative. The 30 s path only matters for an enemy stuck in plain view, where removing it is still better than a soft-lock.
