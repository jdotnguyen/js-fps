## ADDED Requirements

### Requirement: Tunnel power-loss emergency shift and onboard PA routing
When `r15a_heins_04` cuts off during Stage 2, traction power SHALL drop: `trainPowerDown` plays, Stage 2 hallway strips, `R16a` north shroud (`transit:tunnel_power`), and dynamic passing lights (`r15b_tunnel_pass_0..3`) shift to emergency red while cabin lights stay steady. Onboard Transit PA announcements (`r16_pa_01`, `r16_pa_02`) SHALL route overhead inside the train cabin so they remain clearly audible before Stage 3 deceleration.

#### Scenario: Traction power drops on Heins's radio cutoff
- **WHEN** `r15a_heins_04` ends in static during Stage 2 of `r15a_train_ride`
- **THEN** `trainPowerDown` plays, hallway strips, shroud strips, and dynamic passing lights shift to emergency red, cabin lights stay steady, and `r16_pa_01` plays overhead inside the cabin before deceleration

#### Scenario: Tunnel lighting resets cleanly
- **WHEN** the level resets (`level:reset`)
- **THEN** the Stage 2 hallway and `R16a` north shroud return to their default lit state

### Requirement: Pitch-black arrival cutscene and Train Car B downward auxiliary lights
As Stage 3 enters `R16a`, both `R16a` and `R16b` SHALL drop to pitch black (`lightState` `off` + `tint: 'black'`), leaving Train Car B's cabin lights as the sole interior light. Train Car B's boarding door SHALL stay closed until Jay locks into cutscene mode, walks to the center opening, and looks down as two pre-allocated downward exterior auxiliary lights (`r16a_train_aux_n/s`, zero raw `THREE.Light`s in the shell) reveal platform blood pools.

#### Scenario: Pitch-black dock arrival and auxiliary blood reveal
- **WHEN** Train Car B docks in `R16a` and `r16_arrival_finale` begins
- **THEN** `R16a` and `R16b` are pitch black with the boarding door closed until cutscene lock, Jay walks to the center opening looking down, and `r16_pa_02` engages the two downward auxiliary lights to expose blood on the platform without recompiling shaders

### Requirement: Massacre flicker reveal, horror audio pacing, and cabin banter
On platform blood discovery, a smooth-onset low-bass horror hit (`r16HorrorHit`, 80 ms fade-in) SHALL play, followed by quiet `r16Build` rising under `r16_jay_01` and a `3.8 s` pan up. At eye level, full `r16HorrorHit` and 3x overhead flickers (`reducedFlashing` safe) SHALL reveal `R16b` as Jay backs up to `r16_train_back`, with no body drag (`r16_pillar_body` stays put). Speaker-tracked cabin banter SHALL fade to black with `r16Cut` as `r16_giles_02` ends, leaving surveillance score-free.

#### Scenario: Blood discovery, slow pan up, and flicker reveal
- **WHEN** the downward auxiliary lights expose blood on the `R16a` platform floor
- **THEN** `r16HorrorHit` hits smoothly, `r16Build` fades in quietly under `r16_jay_01` and the `3.8 s` pan up, and the 3x overhead flicker reveals the `R16b` massacre as Jay backs up without dragging `r16_pillar_body`

#### Scenario: Speaker-tracked cabin banter and cut to black
- **WHEN** the flicker drops back to pitch black and cabin dialogue begins
- **THEN** Jay's view tracks each speaker (`r16_giles_01` trimmed to a ~`0.35 s` internal pause; Giles lines generated individually), and the view fades to black with `r16Cut` as `r16_giles_02` ends so weapon-draw transitions stay hidden

### Requirement: CAM 09 armed squad advance and northwest-pillar gunfire
After the blackout, fullscreen `CAM 09  ARRIVAL DOCK` SHALL show Giles and Okafor walking up the stairs into `R16b` at `1.15 m/s` holding `aim_pistol` with forward weapon spotlights (no rear cone) while all surveillance dialogue uses the `radio` filter. Both squadmates SHALL stay aimed west down the concourse until `0.25 s` into `r16_okafor_03` (*"to the right!"*), then snap right to aim and fire boosted muzzle-flash bursts at the northwest-most pillar (`[63.5, 1.8, 31.2]`).

#### Scenario: Armed advance with weapon flashlights on CAM 09
- **WHEN** `CAM 09  ARRIVAL DOCK` activates and Okafor calls `"Flashlights on."`
- **THEN** Jay's flashlight is off and viewmodel is hidden, Giles and Okafor walk up the stairs holding `aim_pistol` with forward weapon spotlights (no rear cone), and all callouts play through the `radio` filter

#### Scenario: Delayed snap-right and gunfire at northwest-most pillar
- **WHEN** `ductScrape` plays and Okafor yells `r16_okafor_03`
- **THEN** both squadmates stay aimed down the concourse until `0.25 s` into `r16_okafor_03`, then turn right onto the northwest-most pillar (`[63.5, 1.8, 31.2]`) and open fire with boosted CCTV-readable muzzle flashes

### Requirement: CAM 10 high-aimed Juggernaut face reveal and hard blackout to cliffhanger
After gunfire begins, fullscreen `CAM 10  CONCOURSE` (`[71.2, 2.0, 28.8]` -> `[70.0, 1.5, 38.6]`) SHALL cut in with both squadmates immediately aiming high (`r16_monster_face_aim` at `Y = 5.4`, then `juggernautHead` `+ 0.8 m`) so only the creature's face is lit. The `5.1 m` skinned `monster_juggernaut.glb` SHALL glide over `5.2 s` from `[64.8, 0, 34.6]` to `[68.2, 0, 34.6]` (`yaw: 95`, clear of the foreground right pillar) with a 4 s roar before an instant blackout and `story:cliffhanger`.

#### Scenario: Juggernaut face reveal on CAM 10 and cliffhanger handoff
- **WHEN** `CAM 10  CONCOURSE` cuts in during scripted gunfire
- **THEN** both squadmates keep their weapon flashlights pitched high on the creature's face as the `5.1 m` Juggernaut glides out beside the foreground right pillar without clipping, `r16MonsterRoar` plays, and an instant blackout to dead silence emits `story:cliffhanger` -> `title_card` -> `stinger_priya` -> `endSlice`

### Requirement: Debug jump access for the R16 arrival finale
The debug launcher SHALL support `?debug&jump=r16_finale` to inspect the full `R16a`/`R16b` arrival cutscene, surveillance camera finale, and cliffhanger handoff directly in the browser without playing earlier station rooms.

#### Scenario: Launching the R16 arrival finale directly
- **WHEN** the game launches with `?debug&jump=r16_finale`
- **THEN** Jay starts inside Train Car B in pitch-black `R16a` with `r16_arrival_finale` running cleanly through the auxiliary lights, flicker reveal, `CAM 09`/`CAM 10` Juggernaut reveal, and `story:cliffhanger` handoff
