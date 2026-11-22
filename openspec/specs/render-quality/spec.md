# render-quality Specification

## Purpose

Defines what the Low, Medium and High quality tiers control and how rendering changes are judged: High is tuned for maximum fidelity on the developer's desktop PC, and the frame-rate floor is the only hard performance gate.

## Requirements

### Requirement: Tiers set the rendering budget
Each quality tier SHALL set these values, and switching tier SHALL apply them without a reload:

| Setting | Low | Medium | High |
|---|---|---|---|
| Fill lights / shadow lights | 12 / 0 | 16 / 2 | 32 / 6 |
| Shadow map size | 512 | 1024 | 2048 |
| Pixel ratio cap | 1 | 1.25 | none |

#### Scenario: High on a high-DPI display
- **WHEN** quality is High on a display with a device pixel ratio of 2
- **THEN** the game renders at a pixel ratio of 2

#### Scenario: Live switch
- **WHEN** the player changes quality from High to Low during play
- **THEN** pixel ratio, light counts and shadow resolution change to Low's values without reloading the level

### Requirement: Anti-aliasing on Medium and High
Medium and High SHALL smooth geometry edges with an anti-aliasing pass at the end of the post-processing chain. Low SHALL render without it.

#### Scenario: Edges on High
- **WHEN** quality is High and the camera looks at a thin steel rail against a dark wall
- **THEN** the rail's edges are smoothed rather than stair-stepped

### Requirement: Texture filtering and character shadows by tier
High SHALL use the GPU's maximum texture anisotropy and let characters cast shadows up to 40 m from the camera. Low and Medium SHALL keep anisotropy at up to 8 and character shadows at up to 15 m.

#### Scenario: Floor at a grazing angle on High
- **WHEN** quality is High and the player looks along a long textured floor
- **THEN** the floor texture stays sharp into the distance at the GPU's maximum anisotropy

### Requirement: Frame-rate floor gates rendering changes
On the developer's desktop PC at High, the 1% low frame rate SHALL stay at or above 30 fps in the heaviest scene of the slice. Rendering and content changes SHALL be judged against this floor, not fixed draw-call or triangle counts.

#### Scenario: Measuring a lighting change
- **WHEN** a change adds lights or shadow casters to a room
- **THEN** it is measured in the heaviest scene at High on the target PC and is accepted only if the 1% lows stay at or above 30 fps

### Requirement: Draw calls and triangles are reported
The level tests SHALL report draw calls and triangles per room and the heaviest visible view, and SHALL NOT fail because a fixed count is exceeded.

#### Scenario: A dense room
- **WHEN** a room is furnished past 60 draw calls
- **THEN** the level tests pass and log the room's draw-call and triangle counts
