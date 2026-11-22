# Tasks

## 1. Walk-in tracking shot and greeting on the walk

- [x] 1.1 In `src/data/sequences/intro_shift_change.json`, replace the walk-in `playerFrame {target: "speaker", initial: "npc:okafor"}` with a tracking shot `playerFrame {target: "npc:okafor", duration: 1}`. After Okafor's `npcMoveTo anchor:walkby_stop` resolves, start `playerFrame {target: "speaker", initial: "npc:okafor"}` (design D1). Verify with `npm test -- src/script/intro.test.ts`, where the existing shot-order test ("speaker shots at the post...") must still pass.
- [x] 1.2 In the same walk-in `parallel`, add a branch that waits about 1.5 s and then says `intro_okafor_01`, `intro_jay_03` and `intro_giles_01`. Remove those three `say` steps from their current places after the walk, and leave every other line and NPC move where it is (design D2). Check the clip lengths in `public/assets/vo/` so the greeting ends near Okafor's arrival. Verify with `npm test -- src/script/intro.test.ts`, where the move-order, no-duplicate-line and skip end-state tests must pass.
- [x] 1.3 Add tests to `src/script/intro.test.ts` (design D3). The walk-in shot must target `npc:okafor`. No `"speaker"` shot may start between the airlock opening for the squad and Okafor reaching `walkby_stop`. `intro_okafor_01`, `intro_jay_03` and `intro_giles_01` must play inside the same `parallel` as Okafor's arrival walk, in that order, before `intro_guard_04`. Verify with `npm test -- src/script/intro.test.ts`.

## 2. Jay's addressed lines and Sung's exchange

- [x] 2.1 In `src/script/actions.ts` `beginConversation`, when a line's speaker has no body and its `to` names someone other than the player, aim at the addressee (`speakerTarget(to)`, else `npc:<to>` when it resolves) (design D4). Add `src/script/action.test.ts` cases: Jay's line `to: 'giles'` turns the shot to Giles, Jay's line without `to` keeps the shot, and an NPC line with `to` still aims at its speaker. Verify with `npm test -- src/script/action.test.ts`.
- [x] 2.2 Tag `intro_jay_01`..`intro_jay_08` in `src/data/dialogue/slice01.json` with `to` (ruiz, sung, okafor, giles, giles, cook, giles, priya). Extend the intro addressee test so that every Jay line in the intro has an addressee. Verify with `npm test -- src/script/intro.test.ts`.
- [x] 2.3 In `src/data/sequences/intro_shift_change.json`, make Sung's counter exchange a tracking shot on `npc:sung` that starts as she steps up, then resume the speaker shot after `intro_sung_02` (design D5). Add an intro test that no `"speaker"` shot is running between Sung stepping up and `intro_sung_02`. Verify with `npm test -- src/script/intro.test.ts`.

## 3. Integration check

- [x] 3.1 Run `npm run typecheck` and `npm test -- src/script/intro.test.ts src/script/action.test.ts src/script/skip.test.ts`, and confirm they pass. Typecheck errors in files this change doesn't touch are reported, not fixed.
- [x] 3.2 Playtest the intro on a static snapshot build served on its own port, so other agents' edits don't hot-reload it. Check each of these:
  - The view stays on Sung while she talks with Jay.
  - The view stays on Okafor and Giles while they walk in, even when the guard clears Sung.
  - Okafor greets Jay mid-walk at a natural volume, and Jay replies before Okafor stops.
  - "Morning, Doctor." turns the view to the guard.
  - "Morning, Giles" turns the view to Giles.

  Close the tab and stop the server afterwards.

## Workflow follow-up

- Archive the change to merge the `intro-sequence` delta into `openspec/specs/intro-sequence/spec.md`.
