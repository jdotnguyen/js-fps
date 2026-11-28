# Proposal

## Why

Rooms `R07` (Security Office), `R07a` (Armory), `R08` (Medical Bay), and `R08b` (Surgery) still use legacy one-line palettes built on worn, peeling-paint photo textures (`paintDark`, `paintBone`, `paintTeal`) and thick fog (`0.04–0.05`), so they clash sharply with the clean, rebuilt look of `R01–R06` and `R12–R14`. A medical bay should read as visibly clean and sterile rather than grimy, and the armory currently reads as a dim, dark-walled closet with a single low amber bulb.

This is the first slice of bringing the action-half rooms (`R07` onward) up to the visual standard of the rest of Station Thalassa, starting with the security/armory and medical wing (`R07`, `R07a`, `R08`, `R08b`).

## What Changes

- **Clean `security` and `medbay` area palettes** in `src/world/kit/palettes.ts`, eliminating every worn/peeling-paint slot (`WORN_SLOTS`) from both areas:
  - `security` (`R07`): cool institutional `cleanSlate` walls, `cleanWall` (or `cleanTeal`) upper band, `officeCeiling`, `steelBrushed` trim, `rubber` floor, and `cleanSlate`/`steelDark` door surrounds and panels.
  - `R07a` Armory: lighter `cleanWall` wall override and `officeCeiling`, so opening `D_R07_R07a` reveals a crisp, bright weapons room instead of a dark alcove.
  - `medbay` (`R08`, `R08b`): clean `tileWall` lower walls (`wall_tiles`), clinical `cleanTeal` upper band (replacing the current rusty `paintDark` upper band above the tiles), `officeCeiling`, `steelBrushed` trim, `labTile` floor, and `cleanWall`/`steelDark`/`steelBrushed` door surrounds, panels, and glass bar.
- **Clean prop materials** for props in these rooms that still hardcode worn paint: update `med_bed`, `console_bank`, and `armory_rack` to respect the clean area palette (`cleanWall`, `steelDark`, `cleanTeal`) instead of hardcoded `paintBone`/`paintDark`/`paintTeal`, matching the pattern already used by `locker`, `desk`, `console`, `lab_bench`, and `storage_shelf`.
- **Lighting and atmosphere overhaul** within the 8-light shared pool (`render-lighting` spec):
  - Reduce fog density across `R07` (`~0.022`), `R07a` (`~0.018`), `R08` (`~0.018`), and `R08b` (`~0.022`) to match the rebuilt wings (`0.012–0.025`).
  - Give `R07a` Armory proper illumination: a brighter overhead work light plus a dedicated rack light (`pendant_light` with `slots: true` or wall/rack light) aimed at the east shotgun rack, plus an emissive rack header strip so the Breacher pops on sight.
  - Keep `R07` (3 pooled) + `R08` (3 pooled) + `R07a` (2 pooled) = 8 pooled lights total so no light starves across the glass, and claim secondary ceiling fixtures in `R07` and `R08` as `pool: false` glow-only so there are no dark dead housings while preserving `R08`'s cart-focused lighting hierarchy.
- **Purposeful room dressing additions** that reinforce each room's function while preserving every clearance, sightline, and anchor required by `overhaul-priya-r08-death` and `slice01.test.ts`:
  - `R07` Security Office: wall clock, security notice/roster board on the west wall, small desktop items (`mug`, `desk_wand`) on the watch desk and last-stand desk.
  - `R07a` Armory: bright rack lighting and clean `ARMORY` header/dressing.
  - `R08` Medical Bay: sterile medical dressing along the south wall (`bio_wash_station` scrub sink, imported `lab_cabinet` supply cabinet) and a wall clock, staying clear of the 2.5 m centre-pane stage and the east creature lane.
  - `R08b` Surgery: clean white/teal clinical finish, clean `med_bed`, and clean overhead surgical lighting while keeping `stinger_cam` and `r08_lurk` clear.

## Capabilities

### New Capabilities
- `security-medbay`: Defines the clean visual identity, lighting budget, atmosphere, and purposeful room dressing of `R07` Security Office, `R07a` Armory, `R08` Medical Bay, and `R08b` Surgery while preserving all gameplay clearances and `medbay-attack` staging constraints.

### Modified Capabilities
- `surface-textures`: Adds area-palette requirements ensuring `security` and `medbay` use rust-free, peeling-paint-free materials, `medbay` keeps a clean clinical tile/teal finish, and `R07a` Armory uses lighter clean walls.

## Impact

- Code: `src/world/kit/palettes.ts`, `src/world/kit/props.ts` (`med_bed`), `src/world/kit/slice.ts` (`console_bank`, `armory_rack`), `scripts/gen-slice01.mjs`.
- Data: `src/data/levels/slice01.json` (regenerated via `node scripts/gen-slice01.mjs`).
- Tests: `src/world/kit/palettes.test.ts` (update legacy `medbay` assertions and add `WORN_SLOTS`-free checks for `security` and `medbay`), plus targeted room-look and clearance checks in `src/world/slice01.test.ts` and `src/world/wallClearance.test.ts`.
- Coordination: Compatible with the in-progress `overhaul-priya-r08-death` change; preserves all `R07`/`R07a`/`R08`/`R08b` doors, anchors, clear lanes, viewing strip, 2.5 m centre-pane stage, and `R08` cart key-light focus.
- Out of scope: Rooms `R09` (Flooded Maintenance Tunnel), `R10` (Valve Room), and `R11` (Control Room) — those will follow in a separate change once `R07`/`R08` are verified.
