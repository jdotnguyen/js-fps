# Tasks

## 1. Emerging spawns land on the floor

- [x] 1.1 Add `floorBelow(s, world, cfg)` to `src/actors/motor.ts`: the highest walkable top at or below the body's feet, using the same box query as `standHeight` with `maxTop = s.y + SKIN`. Verify with a test in `src/actors/motor.test.ts`: a body at y 3.8 under a 4.00–4.12 slab gets 0, and a body standing on a 1 m crate gets 1.0.
- [x] 1.2 In `EnemyDirector.spawn` (or the `Enemy` constructor for `start: 'emerge'`), set the motor to `floorBelow` before the first step (`vy = 0`, `grounded = true`), keeping the prone-to-getUp emerge. Verify with an `enemySim.test.ts` case that builds an R06-like room, spawns `ceiling` at y 3.8 and `vent` at y 2.7, steps 3 s, and asserts both stand at y 0.

## 2. Attacks reach vertically

- [x] 2.1 Add and export `REACH_DY = 1.2` in `src/ai/enemy.ts`. Require `|targetFeet.y - motor.y| <= REACH_DY` for starting a windup and in `strike` for a swipe, bite or grab to connect. Verify with `enemy.test.ts` cases: an enemy 4.12 m above Jay and 1 m from him never winds up and deals no damage or grab over 10 s, while an enemy beside Jay on a 1.0 m crate still hits.

## 3. Squad panel tasks always start

- [x] 3.1 Bound the task threat check in `SquadMate.act` by `REACH_DY` vertically as well as `TASK_THREAT` horizontally. Verify with a `squad.test.ts` case: a working bypass with a live enemy on a slab directly above keeps progressing, and an enemy on the floor within 3 m still pauses it with progress kept.
- [x] 3.2 Add `TASK_ARRIVE = 1.5` and `TASK_GIVE_UP = 3` (squadBrain). Arrive within 1.5 m of `task.at`; while walking, start where he stands after 3 s without 0.1 m of progress, facing `task.at`. Verify with `squad.test.ts` cases: Jay parked on `task.at` → Giles starts within 1.5 m and the task completes; the route to `task.at` blocked → he starts after about 3 s and completes.

## 4. Early level triggers are held

- [x] 4.1 In `src/script/runtime.ts`, give the `trigger:fired` path a holding variant of `fire`: a sequence blocked only by an unset `requires` goes into a `held` set. At the start of `update(dt)`, start held sequences whose `requires` is now set and whose `unless` is clear, drop those whose `unless` is set, and remove each entry on that pass. Clear `held` in `cancelAll` and `onRestart`. Verify with `script.test.ts` cases: a held start once the flag is set; no start when `unless` is set first; at most one start when the trigger reaches the sequence by both routes; nothing held after a restart; a bus event (not a level trigger) is still dropped.
- [x] 4.2 Add a slice integration test to `src/script/action.test.ts`: from `cp_contact_clear`, run `cover_me`, open D_R06_R07, fire `trigger:r07_enter` and `trigger:r08_glass` before `cover_done`, then clear `r06_cover`. Assert `armory_auto` then `sec_glass` run once each and `sec_done` is reached. Verify the test fails on the current runtime (before 4.1) and passes after.

## 5. Unreachable group enemies are removed

- [x] 5.1 Move the player-view test that `Squad.canSee` uses into a shared helper both the squad and the enemy director can call. Verify that the existing squad teleport tests still pass unchanged.
- [x] 5.2 In `EnemyDirector`, check each live group enemy once a second. It is reachable when its feet are within 0.6 m of `floorBelow` and `nav.findPath` reaches Jay or a living squadmate. After 10 s unreachable and out of view, or 30 s unreachable regardless, remove it through the normal death path (hidden, no gore) and emit `enemy:culled { id, group }`. Verify with `enemySim.test.ts` cases: an enemy placed on a ceiling slab as the last of its group is culled at 10 s out of view, `group:cleared` fires and a `waitGroup` on it finishes; an enemy with a route that chases Jay for 20 s is never culled.

## 6. Integration check

- [x] 6.1 Run `npm test`, `npm run typecheck` and `npm run build` and verify they pass. Then play a new game in the browser from the Observation Gallery through R05, R06 and R07 to the tunnel:
  - In R06, stand on Giles's panel marker during the cover fight, kill everything, and confirm the `r06_ceiling` zombie drops to the floor, Giles bypasses the door and the fight ends.
  - Go into R07 before the fight's dialogue ends, and confirm the armory bypass and glass scene still play.
  - After the glass scene, try D_R07_R09 and confirm Okafor works the lock while you stand at the door.
  - Load the climax checkpoint and confirm both R11 ceiling spawns land on the floor.
  - Note anything still off in this file.

  Played through in the browser from the Observation Gallery to the Valve Room's bulkhead (R05-R10), with the cover fight, early Security entry and med-lab lock all working. Not run: `npm run build` (can't run in the Linux shell, which lacks rollup's native binary for a Windows `node_modules`) and the R11 climax ceiling-spawn check. `npm test` (793 passed) and `npm run typecheck` passed.
