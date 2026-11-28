# Tasks

## 1. Level-data guard (fails first)

- [x] 1.1 Add `src/world/glassVisibility.test.ts`: for every level in `src/data/levels/` (`slice01.json`, `kit_test.json`), map each `wall_glass_partition` piece's cells and `rot` to a cell edge, find the room on the other side, and assert both rooms list each other in `visibleFrom`; failure messages name both rooms and the edge. Verify it fails today on `slice01.json`, naming R03/R04, R07/R08, R12b/R12c, R14b/R14c and R14b/R14d.
- [x] 1.2 Add a negative case to the same test with a two-room in-memory level holding one-way glass, and verify it reports both room ids and the `x,z,side` edge.

## 2. Two-way `glass()` in the generator

- [x] 2.1 In `scripts/gen-slice01.mjs`, make `glass()` record `[owner, nx, nz]`, and after all rooms are declared, resolve the room owning cell `(nx, nz)` and add owner and neighbour to each other's `visibleFrom` (deduplicated, as `opening()` does). Verify the generator throws a clear error if no room owns the neighbour cell.
- [x] 2.2 Remove the hand-written glass-only `visibleFrom` from R04, R08, R12c, R14c and R14d; leave R01a's untouched. Regenerate `src/data/levels/slice01.json` and verify the diff touches only `visibleFrom` on R03, R04, R07, R08, R12b, R12c, R14b, R14c and R14d.
- [x] 2.3 Run `npm test` and verify the glass visibility test from group 1 now passes and `slice01.test.ts`, `lightSlots.test.ts`, `labWing.test.ts` and `labWingFights.test.ts` still pass.
- [x] 2.4 Add a cull case (in `slice01.test.ts` or beside `lightSlots.test.ts`, using the level loader): with the current room R04, R03 is visible and R02 is not; with the current room R03, R04 is visible. Verify with `npm test`.

## 3. Overlays visible from behind the glass

- [x] 3.1 In `src/world/kit/slice.ts`, set `side: THREE.DoubleSide` on `crackMaterial` and `bloodGlassMaterial`. Verify `npm test` and `npm run typecheck` pass.

## 4. In-game check

- [x] 4.1 Play to the `contact` sequence, step into Lab B after `D_R04_R05` opens and look north: verify the gallery (walls, furniture, lit fixtures) and the glass are drawn, the cracks and Voss's blood show on the glass, and no commons NPCs float in a void. Note whether `D_R02_R03` is open and whether the doorway shows black; if it does, record it as a follow-up (NPC-by-room hiding) rather than fixing it here. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.
- [x] 4.2 In the same spot, check that R04/R05 stay readable for the fight with R03's lights now in the pool, and that frame time with the debug profiler is not noticeably worse than looking south. Only if the fight lighting suffers, mark the gallery's ceiling slot lights `pool: false` and re-check. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.
- [x] 4.3 Add a Lab B "look back through the glass" check to `docs/PLAYTEST.md` under the lab-wing checks, and verify it reads alongside the existing R05/R06 entries.
