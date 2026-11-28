# Tasks

## 1. Placed arms stay placed

- [x] 1.1 Add `idle_crossed_glance`, `idle_crossed_glance_other`, `idle_crossed_look_down`, `idle_hips_glance`,
      `idle_hips_glance_other` and `idle_hips_look_up` to `src/data/poses.json`, each extending its resting pose and
      setting only neck and head (design D1). Verify with a new test in `src/actors/armPoses.test.ts` that every arm
      joint of each variant equals its base's.
- [x] 1.2 Add the pose-family predicate to `src/actors/animator.ts` and use it in `standingOverlayKind` (before the
      glance suffix test), `anchorCrossedArms` and `anchorHandsOnHips` (D2). Verify in `armPoses.test.ts` that the
      `idle_crossed` and `idle_hips` checks pass for each variant on the same bodies as their base, and that through
      base -> variant -> base each wrist stays within 3 cm, against the other arm or its hip, of an identical body that
      plays no gesture (the idle sway alone moves some builds further than that).
- [x] 1.3 Point the `idle_crossed` and `idle_hips` lists in `AMBIENT_GESTURES` at their variants. Verify with tests in
      `src/ai/npcs.test.ts` that an actor resting in each pose, simulated for 120 s, plays only poses of that family and
      at least two different gestures, and that a scripted `glance` stays in the family and returns to the base.

## 2. No brief crossing

- [x] 2.1 Remove the crossed poses from the `idle`, `idle_weight`, `sit_chair` and `sit_sofa` gesture lists and from
      `SQUAD_FIDGETS` (D3). Verify with tests that standing and seated NPCs (`npcs.test.ts`) and idle squadmates
      (`squad.test.ts`), simulated for 5 minutes, never take a crossed pose.
- [x] 2.2 Run `npm test -- src/ai/npcs.test.ts src/ai/squad.test.ts src/actors/armPoses.test.ts
      src/actors/placedPoses.test.ts src/actors/castMotionCoverage.test.ts src/actors/idleLife.test.ts
      src/actors/mocapPhysics.test.ts src/actors/limbContact.test.ts` and verify they pass. Report any failure that was
      already there before this change.

## 3. Check in the game

- [x] 3.1 Run `npm run typecheck` and `npm test`, and verify both pass or list the failures that predate this change.
- [x] 3.2 Run `npm run playtest:serve` in the background and open the URL it prints, with `?slot=scratch`, in your own
      headless browser (never ports 5173 or 4300, which are the player's). Watch each of Heins at the R03 briefing, the
      diver in R13b and Hale in R14c for at least a minute, including while they speak. Verify arms stay crossed or on
      the hips, head gestures read, and nothing pops at a gesture's start or end. The served build is frozen, so serve it
      again after any fix. Afterwards close the browser and run `npm run playtest:serve -- stop <port>`.
