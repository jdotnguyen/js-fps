# Design

## Context

See [proposal.md](proposal.md) for motivation and Phase 2b scope.

Current state in `src/data/levels/slice01.json` and `src/world/kit/transit.ts`:
- **`R13d` ("Maintenance Corridor")**: `12 m x 4 m` (`X=8..10, Z=8`, world `x ∈ [30, 42]`, `z ∈ [30, 34]`, `area: 'transit'`). Currently its floor/walls/ceiling still carry legacy `"material": "diamondRusty"`, `"material": "rustBlotch"`, and `"material": "paintDark"` overrides plus a `debris_pile` at `[37.6, 0, 31.2]` near `D_R13d_R15a` and warm-orange `#ffcf9a` lights (`slot 2` set to `dying`).
- **`R15a` ("Departure Boarding Bay")**: `12 m x 16 m x 5.0 m` (`X=11..13, Z=8..11`, world `x ∈ [42, 54]`, `z ∈ [30, 46]`, `area: 'transit'`). Has `D_R13d_R15a` on the west wall (`[42, 0, 32]`), `track_bed` (`length: 15.4`) and `transit_train_shell` (`length: 10.4, width: 3, height: 2.9, rot: 180, doorSide: 'right'`) centered at `[48, 0, 38]`, east ocean windows (`X=13`), and currently a plain `wall_panel` at the south track end `[12, 0, 11]` (`z = 46`).
- **`R16a` ("Arrival Track Dock")**: `12 m x 12 m x 5.0 m` (`X=21..23, Z=8..10`, `floorY: -0.6`), with a plain `wall_panel` at the north track end `[22, 0, 8]` (`z = 30`).

## Goals / Non-Goals

**Goals:**
- Unify `R13d` and `R15a` under the clean industrial `transit` aesthetic (`docs/surface-dressing-standard.md` and `docs/modular-grid-standard.md`).
- Keep draw calls and triangles tight using palette materials, `userData.flat` paints, `userData.glow` trims, and rule-placed decals within §4 budgets.
- Provide an event-driven `transit_blast_gate` hero piece at `R15a` south and `R16a` north that looks grounded when sealed and animates cleanly for Phase 2c's train pull-out and arrival.
- Preserve all existing anchors (`dark_corridor`, `r15a_platform`, `r15a_train_inside`), triggers (`trig_dive_dark`), doors (`D_R13d_R11`, `D_R13d_R15a`), and `slice01.test.ts` invariants.

**Non-Goals:**
- Train interior detailing, train movement, or infinite sea-tunnel scroll (Phase 2c).
- `R16a`/`R16b`/`R16c` massacre dressing, CCTV mount, or flickering horror pass (Phase 2d).
- Rewriting dialogue, VO, or finale sequences (Phase 3).

## Decisions

### D1: `R13d` Clean Industrial Transit Finish
- Remove `"params": { "material": "diamondRusty" }`, `"rustBlotch"`, and `"paintDark"` from `R13d`'s `pieces` in `slice01.json` so `R13d` inherits the `transit` palette (`cleanSlate`, `concrete`, `steelDark`, `concretePainted`).
- Remove `debris_pile` at `[37.6, 0, 31.2]` and replace with clean transit corridor dressing:
  - Wall-mounted `pipe_run` / `cable_tray` along the upper north/south service band (`y = 2.55 m`, clear of `1.75 m` capsules).
  - Clean `stencilDecal` / `sign_stencil` (`TRANSIT -> R15A`, `POWER BAY <- R11`) and `room_sign` (`R13D TRANSIT CORRIDOR`).
  - Switch `R13d`'s 2 lights to crisp industrial transit white (`#dce8f4`, `steady`, with `slot 0` marked `backup: true, backupScale: 0.4, ownColor: true` or matching `R15a` clean lighting) and 2–4 rule-placed subtle grime decals at floor-wall joins.

### D2: `R15a` Departure Boarding Bay Architecture & Rail Signage
- **Overhead `5.0 m` Gantry Ribs**: Place 3–4 `rib_frame` or clean steel portal trusses spanning `X=11..13` (`x = 42.25..53.75`) at `y = 3.8..5.0 m` so the `5.0 m` hall reads as an engineered deep-sea rail station rather than a tall box.
- **West Platform (`X=11`, `x ∈ [42.25, 46.0]`)**:
  - **Yellow tactile hazard edge** along `x ≈ 45.85` running north-south (`z ∈ [30.4, 45.6]`), flush (`<= 0.01 m`) so it never snags capsules.
  - **Platform safety railing (`platform_railing` in `transit.ts`)**: Two waist-high (`1.05 m`) brushed-steel handrail runs along `x = 45.75` for `z ∈ [30.8, 36.6]` (north of train door) and `z ∈ [39.4, 45.2]` (south of train door), leaving a wide `2.8 m` boarding gap (`z ∈ [36.6, 39.4]`) centered on the train's west doorway (`z = 38.0`).
  - **Boarding props**: `room_sign` (`R15A DEPARTURE BAY`) beside `D_R13d_R15a`, a transit bench + ticketing/boarding kiosk cluster against the west wall (`x ≈ 42.6, z ≈ 40.8..42.5`), and a `transit_depart_board` (`CanvasScreen` 512×256) mounted at `z ≈ 34.5` or suspended overhead at `y ≈ 3.1 m` displaying `LINE 01 // TO ARRIVAL TERMINAL`, `PLATFORM A`, `STATUS: BOARDING / STANDBY`.
  - **Track-side rail signals**: Compact signal posts at the north (`z ≈ 31.0`) and south (`z ≈ 45.0`) ends of the platform with red/amber/green aspect lamps (`userData.glow` / linked to blast gate state).

### D3: `transit_blast_gate` Portal Piece (`R15a` South & `R16a` North)
- Author `transit_blast_gate` in `src/world/kit/transit.ts` (width `4.0 m`, height `5.0 m`, bore opening `3.4 m W x 3.5 m H` centered on the track):
  - **Outer armored frame & dark tunnel recess**: Thick chamfered steel portal ring (`0.45 m` deep) with yellow/black hazard chevrons, overhead `TUNNEL SECTOR 01` stencil/plate, and a deep matte-black tunnel alcove (`z` depth `~0.6 m` behind the shutter) so opening the gate reveals darkness rather than void.
  - **Animated twin shutter leaves**: Left and right armored blast doors (`dynamic` groups) that slide horizontally from closed (`x = ±0.85 m` meeting at center) to open (`x = ±2.45 m` tucked into frame pockets) over `~1.8 s`, plus dual rail aspect signal lamps (amber/red when sealed -> emerald-green when open).
  - **Event contract**: Subscribes to `transit:blast_gate` (`{ gateId?: string; open: boolean; instant?: boolean }`) and resets to sealed on `level:reset`. `R15a` south (`[12, 0, 11]`, `gateId: 'r15a_south'`) and `R16a` north (`[22, 0, 8]`, `gateId: 'r16a_north'`) replace the plain `wall_panel` pieces on those single track-end cells while keeping flanking `wall_plain` cells (`[11, 0, 11]`, `[13, 0, 11]` in `R15a`; `[21, 0, 8]`, `[23, 0, 8]` in `R16a`) intact.
  - **Collider**: Solid box collider covering the portal frame (`door/wall` envelope) when sealed, and side-pillar-only colliders (or disabled center leaf collider) when open so Phase 2c's train passes through cleanly.

### D4: Execution via `threejs-game-director`
During `openspec-apply-change`, follow `threejs-game-director`:
- Use `threejs-aaa-graphics-builder` for surface material contrast, rail signage legibility, and `5.0 m` overhead framing.
- Use `threejs-qa-release` for browser visual verification (`?debug&jump=r15a`, `?debug&jump=r16`, `?checker`, `?nopost`) and blast-gate open/close verification.

## Risks / Trade-offs

- **[Blast-gate shutter pocket clipping adjacent `R15a` / `R16a` side walls]** → Mitigation: Keep open shutter travel inside the `4.0 m` portal cell (`x ∈ [-1.95, +1.95]`) or use vertical-lift / bi-fold pocket leaves so nothing protrudes into neighboring cells (`X=11` / `X=13`).
- **[Platform safety railing blocking `r15a_platform` or squad boarding path]** → Mitigation: Leave a `2.8 m` boarding gap (`z ∈ [36.6, 39.4]`) centered on the train doorway (`z = 38.0`), keep railing at `x = 45.75` (`>= 3.2 m` east of `D_R13d_R15a`), and verify with `slice01.test.ts` capsule walk tests.
- **[`R16a` north portal colliding with `R16a` `floorY: -0.6`]** → Mitigation: Place `R16a`'s `transit_blast_gate` at `y = 0` relative to `R16a` floor (`floorY: -0.6`) with `height: 5.0` so its base seats flush on the sunken track bed.
