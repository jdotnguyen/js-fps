# Proposal

## Why

Heins stands at the R03 briefing with her arms crossed, and every 5-12 seconds she drops them for 1.4-3.2 seconds and
crosses them again. Her resting pose is `idle_crossed`, but each idle gesture it can pick (`glance`, `glance_other`,
`idle_weight`, `look_down`) is a plain standing pose that puts the arms elsewhere. Characters resting with their hands
on their hips (`idle_hips`: Hale in R14c, a diver in R13b) drop their hands the same way. The reverse also reads badly
across the cast: `idle_crossed` is itself a short fidget, so people fold their arms for a few seconds and unfold them.

## What Changes

- A character resting with crossed arms keeps them crossed while it glances left or right or looks down. It uses new
  crossed-arm gesture poses that move only the head and neck.
- A character resting with its hands on its hips keeps them there while it glances left or right or looks up, in the
  same way.
- A scripted glance on such a character keeps its arms too.
- Crossed arms are no longer a short idle fidget. Standing NPCs, squadmates and seated NPCs no longer fold their arms
  for a few seconds and then drop them. Arms are crossed only where a level or script puts a character in that pose.
- Nothing changes for a character resting in any other pose.

Out of scope:

- A held mug (`idle_mug`) uses the same plain gestures. It is a separate follow-up.
- Walking with a crossed-arm or hands-on-hips resting pose. No scene does it today.
- How speech gestures look on crossed arms or hands on hips.
- Any change to Heins's model or rig (change `rebuild-heins-rig`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `character-motion`: adds requirements that crossed arms and hands on hips stay put through idle gestures, and that
  crossing the arms is not a brief fidget.
- `standing-posture-stability`: crossed arms leave the list of ambient fidgets in "Standing upper-body poses preserve
  the mocap base trunk"; the trunk rule still covers a character resting with placed arms.

## Impact

- `src/data/poses.json`: three poses extending `idle_crossed` and three extending `idle_hips`.
- `src/ai/npcActor.ts`: the idle gesture lists. `src/ai/squad.ts`: the squad fidget list.
- `src/actors/animator.ts`: both pose families count as arms overlays and keep their hand anchoring.
- Tests: `src/ai/npcs.test.ts`, `src/ai/squad.test.ts`, `src/actors/armPoses.test.ts`.
- Removing an entry from a gesture list changes which gesture the seeded picker chooses next, so other idle gestures
  fall at different moments than before.
- No model, level, save data or dependency changes.
