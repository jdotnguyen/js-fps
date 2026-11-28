# Proposal

## Why

The view out of the station's windows does not read as one ocean. Every 4 m window tile builds its own backdrop plane, seabed strip and pair of 10 m truss columns. Long runs of glass show unevenly spaced vertical bars, a self-lit seabed that stops in a hard edge, and backdrop creatures copied in every pane at once. The sunlit cues (god-rays, caustics) also fight the deep-sea horror brief.

## What Changes

- One exterior for the whole station, built once beside the hull: a seabed under and around the station footprint, a dark water dome, and water fog of its own that does not take the room's fog colour.
- Near-black water. Nothing outside is lit except by station floodlights, light spilling from the rooms, the player's flashlight and the supply sub's headlamps. The seabed fades into the water instead of ending.
- Hull-mounted floodlights at the real windows: soft cones that cast no shadows and light a pool on the seabed. One lamp at the Docking Ring flickers now and then.
- Real glass stays only in R01 (Docking Ring), R01w (Docking Ring Walk) and R12b (Grow Hall). R02 (Commons), R12c (Seed Lab), R14c (Director's Office) and R14d (Boardroom) get **sanity screens**: displays mounted over the real glass that show a bright daytime downtown view behind half-open blinds.
- During the intro, Halcyon's headlamps and the dock floodlights light the seabed while the sub docks. This is the player's first look at the ocean, before they walk into the screened Commons.
- **BREAKING (visuals):** removed from window tiles: the per-tile abyss backdrop, the per-tile seabed strip, the per-tile truss columns and beam, the god-rays, the caustics, and the large backdrop silhouette and manta. The fish stay as they are and use the water fog.

## Capabilities

### New Capabilities
- `exterior-ocean`: what the player sees outside the station: water, seabed, exterior lighting, ocean life, and which windows are real glass or sanity screens.

### Modified Capabilities
- `intro-sequence`: the opening on the dock also requires that the sub's headlamps and the dock floodlights light the seabed while Halcyon docks.

## Impact

- `src/render/fx/`: a new station-wide exterior module (water dome, water fog, seabed terrain, floodlights, sanity screen shader). `seabed.ts` is rebuilt; `oceanLife.ts` switches to the shared water fog. `abyss.ts` stays only for the dev demo room.
- `src/world/kit/detail.ts` (`windowWall`), `structure.ts` (a new `wall_sanity_screen` tile), `exteriorHull.ts` (screen openings, exterior materials on the water fog), `level.ts` (builds and ticks the exterior), `slice.ts` (marks the sub's headlamps as exterior lamps).
- `scripts/gen-slice01.mjs` and `src/data/levels/slice01.json`: the four screened rooms switch kits, and the `backdropDepth` parameters are dropped.
- Tests in `src/world/` for window tiles, the exterior build and the level data.
