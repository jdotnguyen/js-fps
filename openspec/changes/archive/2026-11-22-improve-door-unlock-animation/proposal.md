# Proposal

## Why

When Giles and Tomas (`okafor`) unlock doors in slice01 (R06 pressure door `D_R06_R07`, R07 armory door `D_R07_R07a`, and R07 med-lab door `D_R07_R09`), they stop far away from the devices, snap their heading in one frame, slide backward if Jay walks near them, and play mismatched poses in mid-air without touching or looking at the hardware. Tightening squad task arrival without reintroducing softlocks, aligning the three door-unlock anchors with their physical wall devices, and driving standing wall-interaction poses with hand IK and gaze makes these scripted beats look grounded and physical.

## What Changes

- **Tight unobstructed task arrival & smooth turn-in:** Walk all the way to the panel anchor (`<= 0.30 m`) when unobstructed instead of halting at `1.5 m`, ignore soft player/squadmate repulsion pushes during task approach and active work so Jay watching nearby never shoves a worker off a panel, and smoothly turn toward the device before beginning the work pose (no single-frame `setHeading` snap). Preserve the anti-softlock fallback when Jay physically blocks the anchor or no progress is made for 3 s.
- **Aligned door-unlock anchors:** Center the three door-unlock anchors in `src/data/levels/slice01.json` directly in front of their physical wall devices at natural arm reach (`~0.45–0.53 m`):
  - `r06_panel` in front of R06's `power_box` (`[-2.6, 0, 36.85]`, `yaw: 180`),
  - `r07_armory_panel` centered in front of `D_R07_R07a`'s jamb status screen (`[5.15, 0, 41.16]`, `yaw: 270`),
  - `okafor_biometric` moved from the closed doorway center (`[4.4, 0, 44.0]`) to directly in front of `D_R07_R09`'s jamb status screen (`[5.15, 0, 45.16]`, `yaw: 270`), clear of the sliding leaves and south wall.
- **Standing wall-device poses & character motion:** Replace crouched/desk-typing door tasks with standing wall-height poses:
  - Giles (`bypass`, `bypass_short`, `bypass_long`, `unlock_locker`): standing `panel_work` pose layered with his `giles_panel` additive hold, preserving his guarded left-forearm injury behaviour (`guardArm` works mostly with his right hand from stage 2 onward).
  - Tomas (`biometric`): composed standing `biometric_scan` pose layered with `okafor_console`, raising his right hand to press and hold his palm flat against the vertical jamb screen while his left arm stays relaxed at his side.
  - Keep `crouchWork` intact for ambient crew spots; R11's climax console (`r11_giles_task` / `power_restore`) is out of scope.
- **Device-targeted hand IK, vertical-wall palm alignment, and gaze:** Wire `SquadMate` panel tasks to set `lookTarget` on the device, enable `plantFeet`, and drive animated `handTargets` IK (with smooth weight ramp in/out and pause/resume clearing) onto the actual `power_box` / jamb status screen surface. Extend `Humanoid` and `HandPhysicsSolver` with optional per-hand `handTargetNormals` so palms orient naturally against vertical walls rather than assuming a horizontal desk.

## Capabilities

### New Capabilities

_(None — this refines existing squad-task and character-motion capabilities.)_

### Modified Capabilities

- `squad-tasks`: Update panel job arrival, turn-in, separation exemption while working, and physical device contact/gaze while preserving Jay-blocking and 3 s stall anti-softlock guarantees.
- `character-motion`: Update Giles's door-bypass activity and Tomas's biometric-lock activity to standing wall-device poses (`panel_work` and `biometric_scan`) with vertical-wall hand contact while preserving Giles's guarded left-arm injury behaviour.

## Impact

- **Squad AI & tasks:** `src/ai/squadBrain.ts`, `src/ai/squad.ts`, `src/ai/npcs.ts`, `src/ai/squad.test.ts`
- **Level & door device targets:** `src/data/levels/slice01.json`, `src/world/level.ts` (exposing jamb screen / panel device surface targets), `src/script/gameHost.ts`, `src/world/labWing.test.ts`, `src/world/slice01.test.ts`
- **Actors, poses & hand IK:** `src/data/poses.json`, `src/data/motion-profiles.json`, `src/actors/motionProfiles.ts`, `src/actors/animator.ts`, `src/actors/humanoid.ts`, `src/actors/handPhysics.ts`, `src/ai/npcActor.ts`, `src/actors/castMotionCoverage.test.ts`, `src/actors/injury.test.ts`, `src/actors/motionProfiles.test.ts`, `src/actors/handPhysics.test.ts`
