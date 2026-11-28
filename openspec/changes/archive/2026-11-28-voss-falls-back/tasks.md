# Tasks

## 1. The backward fall

- [x] 1.1 In `kills.json` `grownInside`, return the still beat to `corpseSupine` (die at 0 with blend 0.55, the chest pool at 0.3 s, the drip at 0.5 s, the twitches at 0.7 and 1.25 s), drop its pane track, route, glass touches and body-on-glass sound, and hold `corpseSupine` in the creature beat without its twitches; verify `npm test -- src/ai/killRun.test.ts` (at most two death twitches) passes
- [x] 1.2 Give the burst beat its recoil route (glass stand to 0.12 s, then `voss_rest` by 0.6 s), move `voss_rest` in `R04.json` to [8, 0, 23] and remove `labb_pane`, `labb_slide` and `labb_slump`; verify the headless probe shows the pounding creature's feet 0.33 m from her and the restored hips 0 cm from the played rest
- [x] 1.3 In `labBRun.test.ts`, replace "Down the pane" with "Falls back from the glass" and "Out of her front" (spec scenarios), keep "Room for the creature" and "Restored in place"; drop `body_glass_hit` from Lab B's on-pane sounds in `labBSealed.test.ts`; verify both new tests fail on the 265d302 data and pass now
- [x] 1.4 Rewrite the collapse line of the drop in `docs/PLAYTEST.md` and verify it names the backward fall, the face-up rest and the `cp_drop` check

## 2. In the game

- [x] 2.1 From the gallery reference view ([8.4, 1.62, 21.15] toward [8, 0.95, 22.5]), capture the burst through the landing at 60 fps and verify at 1x that the creature first shows at her chest and she falls back behind it
- [x] 2.2 Capture the same from a second standing view with a clear sightline and verify the same reading
- [x] 2.3 With `&physics=off`, play the drop through, then restart from `cp_drop`, and verify Voss lies where the played kill left her and the creature's escape still plays
- [x] 2.4 Run `npm run typecheck` and `npm test -- src/ai/labBRun.test.ts src/ai/npcKills.test.ts src/ai/killProfile.test.ts src/script/quiet.test.ts src/script/skip.test.ts src/ai/labBSealed.test.ts src/ai/killRun.test.ts`, and verify they pass

## Workflow follow-up

- Sync the delta into `openspec/specs/infection-kills/spec.md` and archive the change once it is reviewed.
