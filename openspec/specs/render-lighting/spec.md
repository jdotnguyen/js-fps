# render-lighting Specification

## Purpose

Defines how authored room lights become lit fixtures and real lights in the scene: which fixtures glow, which take a real light from the shared pool, the lamp light kind, and how scripted light changes reach every lit fixture.

## Requirements

### Requirement: Claimed fixtures light up
Every light slot a room claims in its level data SHALL show a lit fixture that follows that light's pattern and tint. A slot the room does not claim SHALL show a dark fixture. A kit piece built without a fixture SHALL offer no slot.

#### Scenario: All fixtures claimed
- **WHEN** a room's level data claims all six of its ceiling slots
- **THEN** all six ceiling fixtures glow and none shows a dark diffuser

#### Scenario: Unclaimed slot
- **WHEN** a room claims slots 0, 2 and 4 of six
- **THEN** slots 1, 3 and 5 show dark diffusers

### Requirement: Glow-only lights
A claimed light SHALL take a real light from the shared pool unless its level data sets `pool: false`. A glow-only light SHALL keep its glowing fixture, patterns and tints but SHALL never take a pooled light.

#### Scenario: Corner fixture set to glow only
- **WHEN** a room claims a ceiling slot with `pool: false`
- **THEN** the fixture glows and flickers with the room's pattern but casts no light, and the pool has one more light for other slots

### Requirement: Fill lights go to the current room first
The scene's fixed pool of fill lights SHALL go first to the pooled lights of the room the camera is in, nearest first, then to pooled lights of other visible rooms, nearest first. Pooled lights beyond the pool's size SHALL keep their glowing fixture but cast no light.

#### Scenario: Room seen through glass
- **WHEN** the camera is in a room with 4 pooled lights, a room with 3 pooled lights is visible through glass, and the pool holds 8
- **THEN** all 7 cast real light

#### Scenario: Pool smaller than demand
- **WHEN** the visible rooms have more pooled lights than the pool holds
- **THEN** the current room's lights are lit first and the farthest lights of other rooms cast no light while their fixtures still glow

### Requirement: Lamp lights
The light-slot kinds SHALL include `pendant`: a warm, short-range light whose source sits just below the bulb. The `pendant_light` prop SHALL offer one `pendant` slot per bulb when its `slots` param is true. Without the param, its bulbs SHALL glow as before and offer no slots.

#### Scenario: Lamp claimed as a room light
- **WHEN** a room places `pendant_light` with `slots: true` and claims its slot as a pooled light
- **THEN** light comes from the bulb's height and lights the area under the lamp more than the room around it

#### Scenario: Existing lamps untouched
- **WHEN** a room places `pendant_light` without `slots`
- **THEN** its bulbs glow as before and the room's slot list does not change

### Requirement: Scripted light changes reach every claimed light
A scripted light pattern or tint for a room SHALL apply to every light the room claims, of every kind, pooled or glow-only.

#### Scenario: Emergency in a room with lamps
- **WHEN** a sequence sets a room with ceiling lights and lamps to `alarm` with the `emergency` tint
- **THEN** the ceiling fixtures and the lamps, pooled and glow-only alike, follow the alarm pattern in emergency red

### Requirement: Backup lights
A claimed light SHALL be a backup light when its level data marks it as backup or when it is an `emergency` slot, such as an `emergency_beacon`'s. A room with no backup light SHALL treat its first claimed light as one. Under backup power only backup lights SHALL glow or cast light. Each glows a dim warm white at no more than 30% of its main-power intensity, except a light whose level data puts it on its own circuit: it SHALL keep its authored backup strength, up to its full main-power intensity, and its own colour.

#### Scenario: Room with a beacon
- **WHEN** a room claims four ceiling lights and an `emergency_beacon` slot, and the station goes to backup power
- **THEN** the four ceiling fixtures show dark diffusers and cast no light, and only the beacon glows

#### Scenario: Room without a backup light
- **WHEN** a room claims slots 0, 2 and 4 with none marked backup, and the station goes to backup power
- **THEN** slot 0 glows dimly and slots 2 and 4 are dark

#### Scenario: Back on main power
- **WHEN** the station returns to main power
- **THEN** every claimed light returns to its own pattern, tint and intensity

#### Scenario: A light on its own circuit
- **WHEN** a room claims a ceiling light that its level data puts on its own circuit at full strength with its own colour, such as the medical bay's key light or the pump room's lights, and the station goes to backup power
- **THEN** that light keeps glowing and casting light at its main-power intensity and colour, while the room's other non-backup lights go dark

### Requirement: Station power reaches every room
A change of station power SHALL apply to every room, including rooms not currently visible and rooms built after the change. Dark fixtures SHALL free their pooled lights for other lights.

#### Scenario: Room behind a closed door
- **WHEN** the station goes to backup power while the player is in R05, and the player later walks into the Commons
- **THEN** the Commons is already under backup lighting when its door opens

#### Scenario: Pool goes to backup lights
- **WHEN** the station is under backup power
- **THEN** no pooled light is assigned to a light that is out

### Requirement: Scripted light changes under backup power
Under backup power, a scripted light pattern or tint for a room SHALL apply to that room's backup lights only. Its main lights SHALL stay out.

#### Scenario: Flicker during the blackout
- **WHEN** a sequence sets a room to `flicker` under backup power
- **THEN** that room's backup lights flicker and its main lights stay dark

### Requirement: Shadows have soft edges
Shadows cast by the flashlight and by shadow-casting room lights SHALL have soft edges, without visible stair-steps or banding.

#### Scenario: Flashlight on a chair
- **WHEN** the flashlight shines on a chair near a wall
- **THEN** the chair's shadow on the wall has a soft edge with no stair-stepped outline

#### Scenario: Sofa under the gallery lamp
- **WHEN** quality is High and the east lamp in the Observation Gallery lights the sofa
- **THEN** the sofa's shadow on the carpet has a soft edge with no stair-stepped outline

### Requirement: Fill-light pool sized by quality tier
Every world (the station level and the lab world) SHALL keep a fixed number of real fill lights for the active quality tier: 12 on Low, 16 on Medium, 32 on High. The count SHALL change only when the tier changes.

#### Scenario: Switching tier
- **WHEN** the player switches quality from Medium to High
- **THEN** the scene has 32 fill lights after the switch and the count does not change again until the next tier switch

#### Scenario: Gallery and Lab B on Low
- **WHEN** quality is Low, the camera is in R03 with its 9 pooled lights, and Lab B's 3 pooled lights are visible through the glass
- **THEN** all 12 cast real light

### Requirement: Shadow-light pool sized by quality tier
The scene SHALL keep a fixed number of shadow-casting room lights for the active tier: 0 on Low, 2 on Medium, 6 on High, never more than the GPU's texture units allow. The player flashlight SHALL cast shadows on every tier in addition to this pool.

#### Scenario: Low tier
- **WHEN** quality is Low
- **THEN** no room light casts shadows and the flashlight still does

#### Scenario: GPU limit
- **WHEN** the GPU's texture units cannot fit 6 shadow maps alongside material textures
- **THEN** the High shadow pool is reduced to what fits and a warning is logged

### Requirement: Room lights opt in to shadows
A pooled room light SHALL cast shadows only when its level data sets `shadow: true`. Shadow-casting room lights SHALL shine downward from the fixture as a cone. Shadow lights SHALL go first to opted-in lights in the visible rooms whose lit area is in the camera's view, then to those whose lit area is not. Within each group the current room comes first, then nearest first. An opted-in light that misses the shadow pool SHALL still light the room, unshadowed.

#### Scenario: Shadowed lamp
- **WHEN** a lamp over a sofa sets `shadow: true` and the shadow pool has room
- **THEN** the sofa and anyone sitting on it cast shadows on the floor inside the lamp's pool of light

#### Scenario: Shadow pool full
- **WHEN** more visible lights opt in than the shadow pool holds, and all of their lit areas are in view
- **THEN** the farthest opted-in lights light the room without shadows

#### Scenario: Light behind the player
- **WHEN** quality is Medium, the player stands in R03 between two opted-in lights behind them and two in front, and the lit areas of only the two in front are in view
- **THEN** the two lights in front cast shadows, even though the two behind are nearer

#### Scenario: Light behind the player that lights the view
- **WHEN** an opted-in light behind the player throws light onto the floor in front of them
- **THEN** it ranks as in view, and the player's and nearby characters' shadows it casts can be seen

### Requirement: Failing-tube light pattern
Room lights SHALL offer a `failing` pattern: a tube that holds on for several seconds, stutters with a few blinks, and
sometimes goes dark for one to four seconds before stuttering back on. Its brightness SHALL never change more than
three times a second, so it stays the same with reduced flashing on.

#### Scenario: A failing tube over time
- **WHEN** a light with the `failing` pattern is watched for 30 s
- **THEN** it spends most of the time lit, stutters a few times, and goes fully dark at least once before coming back

#### Scenario: Reduced flashing
- **WHEN** reduced flashing is on and a `failing` light stutters
- **THEN** it changes no more than three times in any second, the same as with reduced flashing off

### Requirement: A single scripted light
A sequence step SHALL be able to switch one named light on or off, with a pattern, tint, and optional auxiliary circuit `power` scale in `[0, 1]`, without changing any other light in its room. When `power` is omitted under station `backup` power, the light SHALL keep its backup-power circuit scale; when `power` is provided, the named light SHALL use that auxiliary power scale even while the rest of the station remains on `backup` power, and a subsequent switch to `mains` or level reset SHALL clear the override.

#### Scenario: The red beacon
- **WHEN** a sequence switches on the R10 beacon with the `alarm` pattern and emergency tint
- **THEN** the beacon sweeps red while the room's ceiling lights keep their own pattern and colour

#### Scenario: Energizing a single bay light under backup power
- **WHEN** the station is under `backup` power and a sequence step sets a named non-backup light in `R11` to `steady` with `power: 1`
- **THEN** that named light glows and casts real light at full strength while other un-energized lights in `R11` and other rooms remain under `backup` power

#### Scenario: Restoring station mains clears per-light power overrides
- **WHEN** a named light was energized with an explicit `power` override under `backup` power and station power later returns to `mains` or the level resets
- **THEN** the override is cleared and the light returns to normal station-power control

### Requirement: Shadow lights are held steadily
A light holding a shadow SHALL keep it until another opted-in light has outranked it for at least 0.5 s. Shadows SHALL NOT swap between lights in consecutive frames as the camera moves or turns.

#### Scenario: Walking between two lamps
- **WHEN** quality is Medium and the player walks slowly past the midpoint between two pairs of opted-in lights in R03
- **THEN** the shadows hand over from one pair to the other once, not back and forth

#### Scenario: A quick glance
- **WHEN** the player turns away from a shadowed light and back within 0.5 s
- **THEN** that light keeps its shadow throughout

### Requirement: Shadows fade in and out
A light that gains or loses its shadow SHALL fade that shadow in or out over 0.2 to 0.4 s rather than switching it in one frame. A tier switch MAY apply at once.

#### Scenario: Shadow hand-over
- **WHEN** a shadow passes from one light to another
- **THEN** the old shadow fades out and the new one fades in, the whole hand-over taking no more than 0.6 s, and neither appears or vanishes in a single frame

### Requirement: Shadows stay correct while things move
The shadow of a moving thing (a character, a door, a held or thrown prop, a gore chunk, a swaying lamp) SHALL follow it every frame within a shadow light's reach. When it leaves that reach, or stops moving, its old shadow SHALL NOT remain behind. Shadows of static walls and furniture SHALL stay as they are.

#### Scenario: Heins walks out of a lamp's reach
- **WHEN** Heins walks under a shadowed lamp in R03 and then out of its reach
- **THEN** his shadow follows him under the lamp, and no shadow of him is left on the floor after he has gone

#### Scenario: Door opening under a shadow light
- **WHEN** a door inside a shadow light's reach opens
- **THEN** its shadow moves with the door as it opens and rests where it stops

### Requirement: Swaying lights
A hanging lamp whose level data sets `sway` SHALL swing gently on its cable. Its shade, its light and its shadow SHALL move together. A shotgun shot within 3 m, a bullet passing the shade, or a scripted jolt SHALL set a hanging lamp swinging harder, easing back to its authored sway.

#### Scenario: Authored sway
- **WHEN** R03's pendant over the sofa sets `sway` and casts shadows
- **THEN** the shade swings slowly, and the sofa's shadow moves with it across the carpet

#### Scenario: Shot near a lamp
- **WHEN** the player fires the shotgun 2 m from a hanging lamp
- **THEN** the lamp swings visibly harder, its shadows swing with it, and it settles back over a few seconds

#### Scenario: Swaying light on Low
- **WHEN** quality is Low and a swaying lamp casts no shadow
- **THEN** the shade and its light still swing together

### Requirement: Light patterns
A shadow light whose level data sets `cookie` SHALL project that pattern (at least a grille, a vent fan and a cracked lens). A fan pattern SHALL turn. Patterned lights SHALL take the patterned shadow lights first, at least 1 on Medium and 2 on High. A patterned light without one SHALL light without the pattern.

#### Scenario: Vent fan
- **WHEN** a light behind a vent sets `cookie: "fan"` and holds a shadow
- **THEN** the floor shows the fan's blades turning in its light

#### Scenario: Patterned light misses the pool
- **WHEN** quality is Low and a light sets `cookie: "grille"`
- **THEN** it lights the room evenly, without the grille pattern

#### Scenario: Two patterned lights on Medium
- **WHEN** quality is Medium and two patterned lights in view both hold shadows
- **THEN** the higher-ranked one shows its pattern and the other casts its shadow without a pattern

### Requirement: Characters are grounded
Every standing, walking or seated character SHALL have a soft contact shadow under it on every tier, so that no character looks as if it floats. That includes characters beyond the character-shadow distance and in rooms without shadow lights. The contact shadow SHALL NOT appear on walls or the ceiling, and SHALL NOT double-darken under a real shadow.

#### Scenario: Far end of the gallery
- **WHEN** quality is Medium and Heins stands 20 m from the camera, beyond the character-shadow distance
- **THEN** a soft darkening under his feet grounds him on the floor

#### Scenario: Low tier
- **WHEN** quality is Low, where no room light casts shadows
- **THEN** every visible character still has a contact shadow

#### Scenario: Under a shadow light
- **WHEN** a character stands inside a shadow light's pool and casts a real shadow
- **THEN** the floor at its feet is no darker than the real shadow with a soft contact edge

### Requirement: The set of real lights stays constant during play
The number of real lights of each kind that the scene counts, with how many cast shadows and how many project a pattern, SHALL NOT change during play. Hiding, removing or moving away from whatever carries a light SHALL darken that light without removing it from the count. Only a graphics quality change MAY alter the set. Developer tools are exempt.

#### Scenario: Squad out of range
- **WHEN** one or both squad members are far enough from the view to be hidden
- **THEN** the scene counts the same lights as when both stand beside the player

#### Scenario: Weapon light on a visible squad member
- **WHEN** a sequence switches on a squad member's weapon light while that member is visible
- **THEN** the light shines from their muzzle along their aim and follows them as they move, including on the moving train

#### Scenario: Weapon light on a hidden squad member
- **WHEN** a squad member whose weapon light is on is hidden
- **THEN** that light adds no light to the scene until the member is shown again
