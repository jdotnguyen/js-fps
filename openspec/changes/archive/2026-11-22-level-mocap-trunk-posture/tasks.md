# Tasks

## 1. Posture check

- [x] 1.1 Add a Node test that measures every standing idle and talk clip in `mocap-core.json` and `src/data/mocap/*.json`: average world pitch of the pelvis, spine and chest, plus the lower and upper back bends, using the design D3 method. It fails a clip whose pelvis is more than 10° from upright or whose upper back bends more than 12° backwards, and reports the clip id and its angles. Verify with `npm test -- <that file>`: it fails on `bram_idle` and `bram_talk` only, and its numbers match the design.md table to within 1°.

## 2. Bake option

- [x] 2.1 Add `levelTrunk` to the clip entries in `scripts/mocap.sources.json` and implement design D2 in `scripts/bake-mocap.mjs`. It runs after retargeting and before the seam blend, clearance fix and additive step. Pelvis tilt goes to 0, chest lean is kept up to 10° forward and spread evenly over both backs, thighs and neck are counter-rotated, and the pelvis height is refit. Verify that a clip without the flag bakes byte-for-byte the same (re-bake and diff another pack), and that the bake log still reports no clearance problems.
- [x] 2.2 Cover the option in `scripts/bvhBake.test.ts` (or alongside it) with a synthetic swayback clip. Check that after levelling the pelvis and back bends are within the limits, the feet's world positions move less than 1 cm, the head keeps its rotation relative to the chest to within 1°, and the motion around the average (frame-to-frame differences) is unchanged. Verify with `npm test -- scripts/bvhBake.test.ts`.
- [x] 2.3 Document `levelTrunk` where the manifest fields are described (`docs/mocap-sources.md`) and say when to use it. Verify that the documented field name matches the manifest.

## 3. Bram

- [x] 3.1 Set `levelTrunk` on `bram_idle`, `bram_talk`, `bram_hold`, `bram_work`, `bram_coffee` and `bram_drink`, and re-bake the `bram` pack. Verify that the 1.1 check passes for the whole cast, `mocapPacks.test.ts` passes, and the pack size stays within 5% of 227 KB.
- [x] 3.2 Keep `bram_hold` (now levelled) as Bram's hold for every posture family in `src/data/motion-profiles.json` (design D4). Verify with `npm test -- src/actors/castMotionCoverage.test.ts src/actors/motionHolds.test.ts`, and check that the cast motion sandbox shows no fallback (red) cells in his row that it didn't show before this change.
- [x] 3.3 Re-run `npm test -- src/actors/bramServe.test.ts src/actors/heldGrip.test.ts src/actors/armPoses.test.ts`. The mug stays in hand and within 10° of upright, and his offering hand lands within 3 cm. If his hand has drifted, re-tune his `bram_offer_mug` override rather than loosening the test. Then try him in `armPoses.test.ts`'s hands-on-hips case and add him if he passes (design D5).

## 4. In-game check

- [x] 4.1 (2026-11-22: front-on sandbox check of idle, talk, aim, drink and work done; the sandbox can't turn to a side view in the browser pane. The user looked at the intro and accepted it as good enough; no before/after captures were saved.) Compare Bram before and after in the cast motion sandbox (`docs/cast-motion-sandbox.md`): idle, talk, walk-to-idle, `offer_mug`, `typing`. Then play `intro_shift_change` through the kitchen beat on the running dev server (reuse `http://localhost:5173/`, `?slot=scratch`). Verify by eye that his hips sit under his chest with no butt-out, chest-forward curve, and that his weight shifts and gestures still read. Save before/after captures to `previews/` and close the tab when done.
- [x] 4.2 Run `npm run typecheck` and `npm test`. Both pass. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.
