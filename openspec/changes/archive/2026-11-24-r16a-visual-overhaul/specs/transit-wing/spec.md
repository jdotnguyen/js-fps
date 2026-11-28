# Spec Delta

## ADDED Requirements

### Requirement: Arrival Track Dock clean industrial finish, signage, and platform dressing
`R16a` ("Arrival Track Dock") SHALL preserve the clean `transit` area palette on its base walls, floor, and ceiling while adding overhead gantry framing and hung service pipe runs, an illuminated arrival status board, `R16A` room signage, directional concourse wayfinding (`ARRIVAL CONCOURSE`), track-side conduit/rail signals, and purposeful platform prop clusters (seating, luggage/cargo, utility cabinets) tucked along the north and south platform margins. Placed architecture and props SHALL preserve the full `12 m` open west stair seam and keep an unobstructed central exit path (`>= 1.2 m` clear width) from the train boarding gap (`z = 35`) across the platform and up the west stairs into `R16b`.

#### Scenario: Viewing the dressed Arrival Track Dock from the train doorway
- **WHEN** Jay steps west out of Train Car B onto the `R16a` platform under full lighting
- **THEN** he sees clean industrial transit walls and flooring, overhead gantry ribs and service pipes across the `5.0 m` volume, an illuminated arrival status board, `R16A` and concourse wayfinding signage, and platform prop clusters flanking the north and south margins with a clear path straight ahead to the west stairs

#### Scenario: Walking from the train doorway to the concourse stairs
- **WHEN** a player or squad capsule walks from inside Train Car B out through the boarding gap and up the west stairs into `R16b`
- **THEN** it completes the walk on real colliders with at least `1.2 m` clear width and no snagging on gantry legs, signage, or platform props

### Requirement: Ocean window and exterior floodlights behind the arrival train
`R16a`'s east wall behind the track (`x = 22`, facing west into the dock) SHALL feature real `wall_window` ocean glazing with exterior floodlights pointing out into the dark abyss (matching `R01` and `R15a`), so a player standing on the platform or inside the concourse looking east sees the docked train silhouetted against the lit abyssal exterior.

#### Scenario: Looking east behind Train Car B into the dark ocean
- **WHEN** Jay stands on the `R16a` platform or in `R16b` looking east past Train Car B
- **THEN** real ocean windows span the east wall behind the track with exterior floodlight beams illuminating the dark abyss outside, without introducing any seam gap or exposing other station rooms

### Requirement: Blood-drenched horror surface dressing and rigged fallen crew bodies
While keeping base wall and floor textures clean, `R16a` (platform floor, west stairs, north/south walls, and track-edge area) and the adjacent `R16b` concourse threshold SHALL be heavily splattered with glossy dark-crimson photographic blood decals (floor pools, spatter, smears, and vertical wall/pillar leaks). Varied high-fidelity fallen crew bodies (using the shared 21-joint `Humanoid` rig and cached `BodyModelLibrary` crew models across multiple dead poses in `poses.json`, with dark-crimson blood textures composited onto their body materials) SHALL lie grounded flush on the floor without floating, clipping, or blocking movement. A hero fallen body (`r16_pillar_body`) SHALL lie beside one of the nearest `R16b` concourse pillars in clear view from Train Car B and SHALL be script-movable so a subsequent arrival beat can pull it behind the pillar.

#### Scenario: Viewing the blood scene and rigged fallen bodies from the dock
- **WHEN** `R16a` and `R16b` are illuminated (under full lighting or a scripted flash)
- **THEN** dense dark-crimson blood pools, spatter, smears, and wall/pillar leaks are visible across `R16a` and `R16b`, and varied bloodied crew corpses lie naturally grounded on the floor in distinct dead poses with `r16_pillar_body` visible beside a facing `R16b` pillar

#### Scenario: Pulling the pillar body behind the pillar via script
- **WHEN** a scripted sequence drags or repositions `r16_pillar_body` behind the nearest `R16b` pillar
- **THEN** `r16_pillar_body` moves smoothly behind the pillar in its dead pose with no floating, no AI/idle-life movement, and without blocking the central concourse aisle

### Requirement: Arrival Track Dock full lighting, blackout/flash readiness, and rotating red pillar beacons
`R16a` SHALL provide full clean overhead illumination (with named light IDs, at least one shadow-casting hero light over the platform/boarding area, and warm/cool contrast against the unlit south dark bore) while supporting instant pitch-black blackout (`tintRoomLights('R16a', 'black')` / `setRoomLights('R16a', 'off')`) and per-light flash switching (`setLight`). Rotating red emergency beacons (`transit_rotating_beacon`) SHALL be mounted on the facing inner faces of the `R16b` concourse pillars (and flanking `R16a` dock faces), emitting rotating red volumetric beams and pulsing emergency light when enabled via `transit:r16_beacons` (falling back to a steady red lens when `reducedFlashing` is enabled) and resetting to off on level reset. Debug preview (`?debug&jump=r16`) SHALL support inspecting normal full lighting as well as blackout and rotating red beacon modes.

#### Scenario: Full clean lighting on default inspection
- **WHEN** `R16a` is inspected under default lighting (`?debug&jump=r16`)
- **THEN** its named overhead lights illuminate the dock cleanly with shadow depth over the platform, while the south tunnel bore remains unlit and fades to black

#### Scenario: Pitch-black arrival, selective light flash, and rotating red pillar beacons
- **WHEN** a script or debug preview blacks out `R16a`/`R16b`, flashes a subset of named lights, and emits `transit:r16_beacons` `{ on: true }`
- **THEN** the dock and concourse drop to pitch black on blackout, individual named lights flash cleanly on demand, and the red beacons on the facing pillars spin their volumetric beams (or hold a steady red lens when `reducedFlashing` is active), resetting to off on level reset
