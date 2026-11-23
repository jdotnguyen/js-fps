# Design

## Context

See `proposal.md` for motivation and scope. Five separate mechanisms currently combine to make Giles's and Tomas's (`okafor`'s) door unlocks in slice01 look distant and janky:

1. `TASK_ARRIVE = 1.5` m in `src/ai/squadBrain.ts` was raised during `2026-11-20-fix-security-path-softlocks` because `SquadMate.update()` applied soft `personalPlayer` (`1.1` m) repulsion even during panel tasks. That caused unobstructed squadmates to halt `1.5` m early and instantly snap heading via `this.body.setHeading(t.yaw)`.
2. `SquadMate.update()` continues to apply `personalPlayer` (`1.1` m) and `personalMate` (`0.9` m) pushes while `this.working` is true, physically sliding an active worker away from the panel whenever Jay walks near.
3. Door anchors in `src/data/levels/slice01.json` do not line up with their physical wall devices (`okafor_biometric` sits `1.53` m off the closed door leaves and `1.73` m from `D_R07_R09`'s jamb screen; `r07_armory_panel` is `0.24` m off-center from `D_R07_R07a`'s jamb screen; `r06_panel` sits in front of a chest-high `power_box` at `y = 1.1..1.6` m while Giles uses `crouchWork` with hands at `~0.75` m).
4. `SquadMate` sets `this.body.lookTarget = null` whenever `behaviour !== 'follow'` and never sets `Humanoid.handTargets` during tasks.
5. `HandPhysicsSolver` tilts `handTargets` IK palms with a fixed horizontal-console Euler, which twists wrists downward instead of pressing flat against a vertical wall screen.

## Goals / Non-Goals

**Goals:**
- Unobstructed door-unlock jobs walk all the way to within `0.30` m of the anchor, turn smoothly into the device, plant feet, look at the device, and physically contact the wall device with animated two-bone hand IK.
- Preserve every anti-softlock invariant from `squad-tasks` (Jay standing directly on an anchor never blocks the job; 3 s stall fallback always starts and finishes; enemy threat within `3` m on the same floor still pauses/defends and resumes cleanly).
- Preserve all `lab-wing`, `security-medbay`, and `character-motion` invariants (R06 ceiling work light cell, coolant line termination, bloom proximity, 1.2 m clear lane, R07 furniture clearances, Giles's guarded left-forearm injury behaviour, and cast motion coverage).
- Keep the design zero-new-props: interact directly with R06's existing `power_box` and R07's existing door jamb status screens (`doors.ts`).

**Non-Goals:**
- Changing R11's climax console (`r11_giles_task` / `power_restore`) or adding new 3D wall scanner/panel prop meshes.
- Removing or altering `crouchWork` for ambient crew spots in `slice01.json`.
- Authoring new mocap BVH captures (existing additive holds `giles_panel` and `okafor_console` are reused).

## Decisions

### 1. Two-tier task arrival + smooth turn-in + separation exemption (`squadBrain.ts`, `squad.ts`)
- **Decision:** Introduce a tight normal arrival threshold (`TASK_ARRIVE_CLOSE = 0.30` m) alongside the blocked-by-Jay fallback (`TASK_ARRIVE = 1.5` m) and stall timeout (`TASK_GIVE_UP = 3` s).
  - Skip soft `personalPlayer` and `personalMate` separation pushes whenever `this.behaviour === 'task'` (both while approaching and while working; physical capsule/world collision still prevents overlap).
  - On unobstructed approach, `SquadMate` walks until `d <= TASK_ARRIVE_CLOSE` (`0.30` m).
  - If Jay is physically occupying the anchor (Jay within `0.75` m of `task.at`) and the worker has stopped making progress (`stall >= 0.8` s) while `d <= TASK_ARRIVE` (`1.5` m), or if any obstruction causes `stall >= TASK_GIVE_UP` (`3` s), start the job facing the spot/device.
  - Replace the instant `this.body.setHeading(t.yaw)` snap with a smooth turn-in: `SquadTask` transitions `walking -> turning -> working` (or tracks a target work yaw while `SquadMate` steers with `{ maxSpeed: 0, turnRate: 5.0 }` until `|headingDiff| <= 0.12` rad, capped at ~0.6 s so progress never stalls). Only once aligned does the pose + hand IK ramp in.
- **Alternative considered:** Relying solely on `npcMoveTo(..., { wait: true })` in sequence JSONs. Rejected because `squad.startTask` can be invoked directly or after an interruption, and `SquadMate` also needs to turn back smoothly when resuming from a combat `paused` state.

### 2. Device target metadata resolved from level geometry (`level.ts`, `gameHost.ts`, `npcs.ts`, `squadBrain.ts`, `squad.ts`)
- **Decision:** Add an optional `device?: { pos: P3; normal: P3; width: number; height: number }` surface descriptor on `SquadTask` (populated by `NpcDirector.task()` via a resolver callback on `Level` / `GameHost`).
  - For R06 (`panel === 'D_R06_R07'` or `r06_panel`): resolve to R06's `power_box` front face center `[-2.6, 1.32, 37.30]`, outward normal `(0, 0, -1)`, active surface area `0.36 x 0.38` m.
  - For door jamb screens (`D_R07_R07a`, `D_R07_R09`, or any door with a jamb screen on the worker's room side): compute directly from the door's `cellMatrix(d.cell, d.rot)` transforming the right-jamb screen center `(1.16, 1.5, -2 + fz * 0.316)` and outward normal `(0, 0, fz)` for the face closest to the task anchor (`D_R07_R07a` -> `[5.684, 1.5, 41.16]`, normal `(-1, 0, 0)`; `D_R07_R09` -> `[5.684, 1.5, 45.16]`, normal `(-1, 0, 0)`), active surface area `0.18 x 0.22` m.
  - If no explicit device surface is resolved (e.g., headless unit tests without a level), fall back cleanly to facing `yaw` with no `handTargets` IK.
  - Only engage `handTargets` IK when the worker is actually within arm's reach of the device (`horizontalDist <= 0.95` m), so a blocked/3 s-stall fallback never stretches an arm across the room.
- **Alternative considered:** Hardcoding world coordinates inside `squad.ts`. Rejected because deriving door jamb screen coordinates from `Level`'s door transform keeps `squad.ts` level-agnostic and immune to door placement edits.

### 3. Door anchor alignment in `src/data/levels/slice01.json`
- **Decision:** Align the three door-unlock anchors directly with their wall devices:
  - `r06_panel`: `[-2.6, 0, 36.85]`, `yaw: 180` (`0.45` m in front of `power_box`'s front face at `z = 37.30`; stays in cell `[-1, 0, 9]`, preserves `x = -2.6` for `coolant_line`, keeps `bloom_decal` within `0.7` m, and preserves the `1.2` m clear lane in `labWing.test.ts`).
  - `r07_armory_panel`: `[5.15, 0, 41.16]`, `yaw: 270` (`0.53` m directly in front of `D_R07_R07a`'s jamb screen at `[5.684, 1.5, 41.16]`, clear of `z = 39..41` door leaves and furniture).
  - `okafor_biometric`: `[5.15, 0, 45.16]`, `yaw: 270` (`0.53` m directly in front of `D_R07_R09`'s jamb screen at `[5.684, 1.5, 45.16]`, `0.64` m clear of south wall `z = 45.8` and completely clear of the `z = 43..45` door leaves).
- **Alternative considered:** Adding new wall biometric/override prop meshes below the jamb screens. Rejected per user direction ("Door jamb screens fine") to keep scope focused and avoid new geometry/budget overhead.

### 4. Standing poses, additive holds, and animated hand IK (`poses.json`, `motion-profiles.json`, `motionProfiles.ts`, `animator.ts`, `humanoid.ts`, `handPhysics.ts`, `squad.ts`)
- **Decision:**
  - Add two standing authored poses to `src/data/poses.json` (and `NPC_ANIMS` in `npcActor.ts`):
    - `panel_work`: slight forward torso lean (`spine: [-10, 0, 0]`, `chest: [-6, 0, 0]`, `neck/head` slightly pitched toward chest/eye work height), elbows bent with hands raised to wall-panel height (`~1.25–1.45` m) so even without IK the silhouette reads cleanly.
    - `biometric_scan`: composed upright stance (`spine: [-3, 0, 0]`, subtle head tilt toward screen), left arm resting naturally at his side, right upper arm + forearm raised to shoulder/screen height (`~1.45–1.50` m).
  - Map `TASKS` in `src/ai/squadBrain.ts`:
    - `bypass`, `bypass_short`, `bypass_long`, `unlock_locker` -> `pose: 'panel_work'`
    - `biometric` -> `pose: 'biometric_scan'`
  - Route additive holds in `src/actors/motionProfiles.ts` and `src/data/motion-profiles.json`:
    - Add `'panel'` (or map `panel_work` via `poseTreatment` / `postureFamily`) so Giles's `panel` variant applies `giles_panel` onto `panel_work` and `biometric_scan` maps to `work` treatment (`okafor_console`), with `panel_work` and `biometric_scan` included in `Animator.ARMS_BUSY` so `handsOnSomething()` is true (keeping Giles's `guardArm` injury favouring active instead of tucking his arm into his ribs).
    - **Crucial interaction check:** In `Animator.writeWithHold()`, `pinsHands` pins the authored pose's hand positions when a posture hold is active, and `Humanoid.solveIk()` runs afterward to pull the hands to `handTargets`. When `handTargets` is active, `solveIk` wins smoothly; when `handTargets` is null (e.g. headless `injury.test.ts` testing `panel_work`), `giles_panel` + `guardArm` still produce the exact damped-left-hand vs. active-right-hand differential.
  - Extend `Humanoid` with `readonly handTargetNormals: { L: THREE.Vector3 | null; R: THREE.Vector3 | null } = { L: null, R: null }` and pass them into `HandPhysicsSolver.update()`. In `handPhysics.ts` step 3, when `ikAlignW > 0.01` and an explicit `ikNormal` is provided, align `st.palmNormal` toward `-ikNormal` (matching the existing `LimbContactSolver` wall-contact alignment with bounded anatomical ROM `<= 55°` from forearm orientation) instead of applying the horizontal-console Euler; choose `'surface'` hand shape for Tomas's scanning right palm (flat/open palm conform) and `'pinch'` / `'typing'` for Giles's active bypass fingers.
  - Drive per-task hand choreography in `SquadMate` while `state === 'working'` and within reach:
    - **Giles (`panel_work`):** Smoothly ramp `handTargetWeights.L/R` in (`0 -> 1` over `~0.35` s). Right hand cycles smoothly between 3–4 local probe/wiring points across the device face (with subtle press-and-adjust motion); left hand steadies near the lower-left edge of the box/jamb with small stabilizing shifts (which `guardArm` automatically slows and damps at infection stage >= 2). Set `plantFeet = true` and `lookTarget` to the device center.
    - **Tomas (`biometric_scan`):** Smoothly ramp `handTargetWeights.R` in (`0 -> 1` over `~0.4` s) while leaving `handTargets.L = null`. Right hand performs a brief initial tap near the lower bezel (`0..0.7` s) then settles into a steady flat-palm press centered on the jamb screen (`0.7..4.6` s), then smoothly releases (`4.6..5.0` s) as the door unlocks. Set `plantFeet = true` and `lookTarget` to the jamb screen center.
    - On `paused` or `done` (or task cancellation), clear `handTargets`, `handTargetNormals`, `plantFeet`, and `lookTarget` cleanly.

## Risks / Trade-offs

- **[Risk] Tightening `TASK_ARRIVE` could reintroduce a softlock if Jay blocks a tight doorway/corner** -> **Mitigation:** Skipping `personalPlayer` repulsion during tasks eliminates the artificial `1.1` m forcefield, and keeping both the Jay-on-anchor fallback (`<= 1.5` m after `0.8` s stall) and the unconditional `3` s stall fallback (`TASK_GIVE_UP`) guarantees the job always starts and finishes. Cover both clear arrival (`<= 0.30` m) and Jay-on-anchor arrival in `squad.test.ts`.
- **[Risk] `okafor_biometric` moved to `[5.15, 0, 45.16]` is `0.64` m from R07's south wall (`z = 45.8`) and near `r07_medbay_door` (`[4, 0, 45.35]`)** -> **Mitigation:** `0.64` m comfortably exceeds the `0.3` m capsule radius (and the south wall trim keepout), `r07_medbay_door` is `1.16` m west (used in an earlier sequence `sec_glass`), and `slice01.test.ts` furniture-clearance and navmesh-reachability tests will validate the exact placement.
- **[Risk] Switching Giles's bypass tasks from `crouchWork` to `panel_work` could break existing coverage/injury tests** -> **Mitigation:** Update `castMotionCoverage.test.ts`, `motionProfiles.test.ts`, and `injury.test.ts` to assert `panel_work` / `biometric_scan` and verify Giles's left-arm guarding differential remains strong on `panel_work`.
- **[Risk] Palm normal alignment on high vertical jamb screens (`y = 1.5` m) could twist the wrist awkwardly if elbow pole points inward** -> **Mitigation:** Keep the IK pole slightly outward/downward (`humanoid.ts:1866`) and clamp palm alignment rotation in `handPhysics.ts` within anatomical ROM, then visually verify all three doors in-browser during playtesting.
