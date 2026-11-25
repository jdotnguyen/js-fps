## ADDED Requirements

### Requirement: Tunnel power-loss emergency shift and reserve coasting PA
Immediately when Heins's final radio warning (`r15a_heins_04`) cuts off into static during Stage 2 of the transit ride, the tunnel SHALL drop into emergency power mode: a heavy traction-power shutdown sound SHALL play, the Stage 2 scrolling hallway strips and `R16a` north shroud strips SHALL shift from cool white to dim emergency red (`transit:tunnel_power`), Train Car B's interior warm cabin lights SHALL remain steady without flickering, and an automated Transit PA announcement (`channel: "pa"`) SHALL announce rail traction power loss and reserve coasting to the nearest stop (`R16a` Arrival Terminal) for safety shutdown. The Stage 2 ride duration SHALL accommodate the full power-loss announcement before Stage 3 deceleration begins.

#### Scenario: Traction power drops on Heins's radio cutoff
- **WHEN** `r15a_heins_04` ends in static during Stage 2 of `r15a_train_ride`
- **THEN** a traction power-down SFX plays, the scrolling hallway strips and `R16a` north shroud shift to dim emergency red, cabin lights stay steady with no flicker, and the Transit PA announces reserve coasting to the nearest stop before the train decelerates into `R16a`

#### Scenario: Tunnel lighting resets cleanly
- **WHEN** the level resets (`level:reset`)
- **THEN** the Stage 2 hallway and `R16a` north shroud return to their default lit state

### Requirement: Pitch-black arrival cutscene and Train Car B downward exterior auxiliary lights
As Stage 3 glides into `R16a`, both `R16a` and `R16b` SHALL be pitch black (`tintRoomLights(..., 'black')` / overhead lights off), leaving Train Car B's steady cabin lights as the sole interior illumination. Jay SHALL be held in a cutscene framing the right-side (west) windows looking down toward the dark `R16a` platform floor as Train Car B docks and `r16a_north` seals behind it. Once docked, a Transit PA announcement SHALL report auxiliary exterior lighting activation, and two pre-allocated downward exterior auxiliary lights on Train Car B SHALL switch on (`transit:train_aux_lights`), illuminating the platform floor beside the boarding gap to reveal pools of blood without adding or removing scene lights.

#### Scenario: Pitch-black dock arrival and auxiliary blood hint
- **WHEN** Train Car B glides into `R16a` and comes to rest
- **THEN** `R16a` and `R16b` are pitch black while Train Car B's cabin lights stay steady, Jay's cutscene view frames the dark platform floor outside the right-side windows, and after the Transit PA announces auxiliary lights, two downward exterior lights illuminate blood on the platform floor without triggering a shader recompile

### Requirement: Bass-hit flicker massacre reveal and edge-of-frame body drag
The arrival buildup score SHALL preload at docking and start shortly after the bass hit that marks the discovery of blood on the platform. It SHALL play through the massacre reveal and cabin conversation, then cut as the view fades out ahead of `CAM 09  ARRIVAL DOCK`. The surveillance feeds SHALL use dialogue and sound effects without the buildup score.

After Jay reacts to spotting blood under the auxiliary lights, the cutscene camera SHALL pan smoothly up to eye level looking west across the stairs into `R16b`. On arrival at eye level, a heavy bass horror impact SHALL hit as `R16a` and `R16b` overhead lights flicker bright two to three times—revealing the blood-drenched massacre and fallen crew—before dying back to pitch black (respecting `reducedFlashing` with clean non-strobing fades). During the reveal window, a fallen body near the right edge of the concourse view SHALL be smoothly dragged away into shadow.

#### Scenario: Pan up to eye level and flicker reveal
- **WHEN** Jay notices the blood on the platform floor and the camera pans up toward `R16b`
- **THEN** a heavy bass horror hit coincides with `R16a` and `R16b` lights flickering bright 2–3 times to expose the blood and corpses before dropping back to pitch black, while an edge-of-frame corpse on the right side of the concourse is dragged away into shadow

### Requirement: Squad weapon-mounted dynamic flashlights and scripted concourse firing
Following brief tense cabin banter in which Giles and Okafor decide to step out and tell Jay to stay inside the train, Train Car B's boarding door SHALL open, Jay's flashlight SHALL switch off and Jay's weapon viewmodel SHALL be hidden, and the view SHALL cut to fullscreen surveillance camera `CAM 09  ARRIVAL DOCK`. As Giles and Okafor step onto the platform and announce `"Flashlights on."`, pre-allocated dynamic weapon-mounted spotlights attached to their aimed sidearms SHALL switch on aimed west into `R16b` as they advance up the stairs. When they spot movement in the dark concourse, they SHALL open fire with boosted CCTV-readable muzzle flashes and pistol shots while all surveillance-view dialogue plays through the `radio` channel filter.

#### Scenario: Surveillance cut and weapon flashlights on
- **WHEN** Giles and Okafor step out of Train Car B onto the `R16a` platform
- **THEN** Jay's flashlight is off and weapon viewmodel is hidden, fullscreen `CAM 09  ARRIVAL DOCK` activates, and on `"Flashlights on."` both squadmates activate dynamic weapon-mounted spotlights aimed west into `R16b` while advancing up the stairs

#### Scenario: Radio-filtered surveillance dialogue and gunfire
- **WHEN** Giles and Okafor advance into the pitch-black `R16b` concourse under surveillance view
- **THEN** the squad's callouts play through the `radio` audio filter, and both squadmates fire westward with bright muzzle flashes

### Requirement: Pillar-cam 0.5 s big-monster reveal and hard blackout to cliffhanger
As soon as Giles and Okafor open fire in `R16b`, the fullscreen surveillance feed SHALL cut to a second camera angle (`CAM 10  CONCOURSE`) framed tight on an `R16b` concourse pillar: Giles and Okafor's weapon-flashlight beams and bright muzzle flashes SHALL illuminate the left side of the frame, and a large `hero` monster SHALL step out from behind the pillar on the right side of the frame for approximately `0.5 s` before a hard cut to pitch black and dead silence (cutting SFX immediately). The blackout SHALL emit `story:cliffhanger`, triggering the existing `title_card` (`THALASSA / SLICE ONE`) -> `stinger_priya` (`CAM 04 MEDBAY`) -> `endSlice` chain.

#### Scenario: Pillar-cam split reveal and cut to Thalassa title card
- **WHEN** Giles and Okafor begin shooting in `R16b`
- **THEN** the feed cuts to `CAM 10  CONCOURSE` showing flashlight/muzzle-flash light on the left and the `hero` monster revealing from behind the pillar on the right for ~`0.5 s`, followed immediately by a hard blackout to dead silence and `story:cliffhanger` -> `title_card` -> `stinger_priya` -> `endSlice`

### Requirement: Debug jump access for the R16 arrival finale
The debug launcher SHALL support `?debug&jump=r16_finale` to inspect the full `R16a`/`R16b` arrival cutscene, surveillance camera finale, and cliffhanger handoff directly in the browser without playing earlier station rooms.

#### Scenario: Launching the R16 arrival finale directly
- **WHEN** the game launches with `?debug&jump=r16_finale`
- **THEN** Jay starts inside Train Car B in pitch-black `R16a` with `r16_arrival_finale` running cleanly through the auxiliary lights, flicker reveal, surveillance cameras, 0.5 s monster reveal, and `story:cliffhanger` handoff
