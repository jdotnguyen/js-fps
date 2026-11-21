# surface-textures Specification

## Purpose

Defines how level surfaces get their look: imported photo texture sets per material slot, tiled at real-world scale, chosen per area palette, and produced by one import command, with the procedural generators kept as the fallback.

## Requirements

### Requirement: Photo texture sets per material slot
The renderer SHALL build each material slot listed in the texture manifest from imported photo texture files (colour, OpenGL normal, packed AO/roughness/metalness) when those files exist.

#### Scenario: Slot with imported files
- **WHEN** the game loads and `public/assets/textures/paintDark/` contains colour, normal and ORM images
- **THEN** the `paintDark` material uses those images, with AO read from the ORM red channel

#### Scenario: Slot with missing files
- **WHEN** a manifest slot's files are missing or fail to load
- **THEN** that slot falls back to its procedural generator and a single warning is logged
- **AND** the game still loads

### Requirement: World-scale texture tiling
Kit geometry SHALL tile each photo texture at the physical size given by the manifest's `metersPerTile`, so the same material shows at the same scale on every surface.

#### Scenario: Tile floor scale
- **WHEN** a `floor_tiles` piece uses `labTile` with `metersPerTile` 1.5
- **THEN** a 4 m floor piece shows the texture repeated about 2.7 times along each side

### Requirement: Area material palettes
Wall and floor pieces SHALL take their materials from the room's area palette unless the level data overrides them for that piece.

#### Scenario: Dive bay floors
- **WHEN** the dive bay area is built
- **THEN** its floors use clean treadplate, with grating around the launch trunk, and no rusty treadplate

#### Scenario: Dive bay maintenance corridor
- **WHEN** the dive bay's maintenance corridor (R13d) is built
- **THEN** the level data overrides its walls and floor with rust materials, so it alone in the dive bay looks decayed

#### Scenario: Lab B after the outbreak
- **WHEN** the outbreak sequence event fires
- **THEN** Lab B's floor material changes from `labTile` to `tileBroken`

#### Scenario: Lab wing walls
- **WHEN** the lab wing (R04, R05, R06) is built
- **THEN** its walls use clean panel materials with a slate service band, and no rust or peeling-paint material

### Requirement: Import pipeline
The project SHALL provide one command that converts the raw downloaded texture sets into the game's slot format, and the raw downloads SHALL stay out of the repository.

#### Scenario: Re-importing
- **WHEN** a developer runs `npm run textures` with the raw sets in `../textures`
- **THEN** every manifest slot gets `color.jpg`, `normal.jpg` and `orm.jpg` at its configured size
- **AND** no Blender, USD, displacement or DirectX-normal files are copied into `public/`
