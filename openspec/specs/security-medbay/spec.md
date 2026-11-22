# security-medbay Specification

## Purpose
Defines the visual look, lighting budget, atmosphere, and purposeful room dressing of the security and medical wing (`R07` Security Office, `R07a` Armory, `R08` Medical Bay, and `R08b` Surgery), bringing them up to the clean standard of the rest of Station Thalassa while preserving all gameplay clearances and `medbay-attack` staging.

## Requirements

### Requirement: Clean architectural finish across R07, R07a, R08, and R08b
The walls, ceilings, floors, trim, door surrounds, door panels, and glass partition framing in `R07` (Security Office), `R07a` (Armory), `R08` (Medical Bay), and `R08b` (Surgery) SHALL use clean, rust-free, peeling-paint-free materials. Wear SHALL come only from scripted story beats (such as blood and glass damage during the attack), never from base architectural textures.

#### Scenario: Sterile medical bay and surgery
- **WHEN** `R08` (Medical Bay) and `R08b` (Surgery) are built
- **THEN** their lower walls use clean white wall tiles, their upper wall band above the tiles uses clean clinical teal, their ceilings use the clean office ceiling, their floors use clean lab tile, and no surface uses a worn or peeling-paint material slot

#### Scenario: Clean institutional security office
- **WHEN** `R07` (Security Office) is built
- **THEN** its walls use clean slate with a clean upper band, its ceiling uses the clean office ceiling, its glass partition and door frames use clean slate and brushed steel trim, and no surface uses a worn or peeling-paint material slot

#### Scenario: Brighter armory walls
- **WHEN** `R07a` (Armory) is built
- **THEN** its walls override the security palette with lighter clean wall panels (`cleanWall`) and a clean office ceiling so the armory reads visibly lighter than `R07`

### Requirement: Clean prop finishes in security and medical rooms
Props placed in `R07`, `R07a`, `R08`, and `R08b` SHALL use clean materials consistent with the room's clean palette instead of worn or peeling paint.

#### Scenario: Medical beds read sterile
- **WHEN** a `med_bed` prop is built in a room with a clean palette
- **THEN** its bed frame and monitor housing use clean architectural materials rather than `paintBone` or `paintDark`

#### Scenario: Security console bank and armory racks read clean
- **WHEN** `console_bank` or `armory_rack` is built in a room with a clean palette
- **THEN** its cabinet, bezel, and storage cases use clean materials rather than `paintDark` or `paintTeal`

### Requirement: Lighting and fog fit the shared pool
`R07`, `R07a`, `R08`, and `R08b` SHALL use clear, low-density fog (`<= 0.025`) matching the station's rebuilt wings, and their combined simultaneous pooled fill lights across `R07`, `R07a`, and `R08` SHALL not exceed 8 so no visible light starves across the glass or into the open armory. Secondary ceiling fixtures SHALL be claimed as glow-only (`pool: false`) rather than left as dark diffusers.

#### Scenario: Shared 8-light pool is never exceeded
- **WHEN** the player stands in `R07` with `R08` visible through the glass and `D_R07_R07a` open into `R07a`
- **THEN** the total count of pooled lights across `R07`, `R07a`, and `R08` is at most 8
- **AND** `R08` keeps its primary key light focused over the instrument cart while `R07` stays slightly dimmer than `R08` so the medical bay reads clearly through the glass

#### Scenario: Armory is brightly lit and frames the shotgun
- **WHEN** `D_R07_R07a` opens and the player looks into `R07a`
- **THEN** `R07a` is lit by a bright overhead ceiling light and a dedicated rack light illuminating the east shotgun rack so the Breacher stands out immediately

#### Scenario: Clear sight through the glass
- **WHEN** the level loads
- **THEN** `fogDensity` is at most `0.025` in `R07`, `R07a`, `R08`, and `R08b`

### Requirement: Purposeful dressing preserves every clearance and sightline
Purposeful room additions in `R07`, `R07a`, `R08`, and `R08b` (such as medical scrub/storage fixtures, security wall boards, wall clocks, and desktop items) SHALL stay inside each room's inner wall faces, stay clear of wall trim keepouts, and preserve every door clearance, walk spine, viewing strip, attack stage, creature lane, and camera sightline required by existing sequences and tests.

#### Scenario: Security office additions keep paths and wall trim clear
- **WHEN** `R07` loads with its security dressing additions
- **THEN** no prop collider enters the central spine (`x: -1.5..1.5`), the glass viewing strip (`z: 44.6..45.75`), or within `1.2 m` of `D_R06_R07`, `D_R07_R07a`, `D_R07_R09`, or `D_R07_R08`
- **AND** no wall-mounted prop overlaps wall pilasters, trim rails, or cable trays

#### Scenario: Medical bay additions keep the stage and creature lane clear
- **WHEN** `R08` loads with its clinical dressing additions (such as a scrub sink, glass-door supply cabinet, and wall clock)
- **THEN** `instrument_cart` remains the only prop collider within `2.5 m` of the centre pane
- **AND** the east creature lane and all `R08`/`R08b` camera sightlines and anchors remain clear
