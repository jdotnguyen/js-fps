# Spec Delta

## ADDED Requirements

### Requirement: Okafor waits with Giles at the departure console
On the walk from `R11` to `R15a`, Okafor SHALL end beside Giles at the departure console: within `2 m` of Giles, turned toward Giles and the console, and clear of the platform railing and the boarding gap. Okafor SHALL stay there until both are told to board.

#### Scenario: Hearing both of them at the console
- **WHEN** Giles is working at the `R15a` departure console and Jay stands near Giles
- **THEN** Okafor is within `2 m` of Giles and Okafor's lines are heard at a normal speaking level

#### Scenario: Boarding path stays clear
- **WHEN** Jay or either squadmate walks from the `R15a` platform into Train Car A
- **THEN** nobody waiting at the console blocks the boarding gap

### Requirement: The finale follows the arrival without a stall
Every line scripted for the Stage 3 glide SHALL play while the train is arriving, and the arrival finale SHALL begin within `2 s` of the train coming to rest. A line that runs longer than its slot in Stage 2 MUST NOT make the script miss the arrival.

#### Scenario: Normal arrival
- **WHEN** the ride plays with the shipped voice clips
- **THEN** the gate sound and Okafor's arrival line play during the glide, and the finale starts within `2 s` of the stop

#### Scenario: A late line
- **WHEN** a Stage 2 line is still playing as the glide begins
- **THEN** the finale still starts as soon as that line and the arrival lines are done, with no timeout-length silence

### Requirement: Giles answers the lost call during the announcement
When Heins's transmission cuts off, Giles SHALL say `r15a_giles_04` over `r16_pa_01`, starting just after the announcement has said the traction power is lost, and SHALL say it only once.

#### Scenario: Reacting to the cut-off
- **WHEN** `r16_pa_01` reaches the pause after "traction power has been lost"
- **THEN** Giles says they have lost her while the announcement carries on, and the line is not repeated at the arrival

### Requirement: A body is dragged away before Jay's warning
After `r16_okafor_01` and before `r16_jay_02`, Jay's view SHALL turn to the far north-west pillar of `R16b` with a magnified look, and one flicker SHALL show the fallen body lying beside that pillar, its legs already behind it, dragged slowly the rest of the way out of sight. The concourse SHALL stay lit long enough to follow the drag. The Juggernaut MUST NOT appear before `CAM 10`. No flicker setting may add a second flash.

#### Scenario: Seeing the body pulled away
- **WHEN** Okafor finishes `r16_okafor_01` inside the cabin
- **THEN** one flicker shows a body with its legs behind the north-west pillar and the rest in the open, large enough to follow
- **AND** it slides slowly until none of it is in sight
- **AND** the concourse is dark again when Jay says something just moved by the north pillar

#### Scenario: The view returns
- **WHEN** the shot turns back to the speakers in the cabin
- **THEN** the view is no longer magnified

#### Scenario: Nothing is given away
- **WHEN** the finale plays up to the `CAM 10` cut
- **THEN** the creature has not been shown, and Giles and Okafor have not aimed at the concourse because of the drag

#### Scenario: The squad advance afterwards
- **WHEN** `CAM 09` and `CAM 10` play later in the same finale
- **THEN** they are framed as before and the Juggernaut walks out from its usual hiding place

### Requirement: Restoring the Arrival Terminal checkpoint starts the finale
Loading a save made at the `Arrival Terminal` checkpoint with the finale not yet finished SHALL put Jay, Giles and Okafor in Train Car B with its door closed, `R16a` and `R16b` dark and the cabin lights on, and SHALL play the arrival finale once from its start.

#### Scenario: Continue after leaving during the finale
- **WHEN** the player leaves during the finale and chooses Continue
- **THEN** the finale starts again in the parked car with `R16` dark

#### Scenario: Finale already finished
- **WHEN** a save with the finale finished is loaded
- **THEN** the finale does not play again

### Requirement: End-to-end finale playthrough from the R11 debug jump
The URL `?level=slice01&debug&jump=r11` SHALL play from the Power Bay through the departure walk, the train ride, the arrival finale, the title card and the stinger to the end of the slice, with no other parameter needed.

#### Scenario: Playing through from the Power Bay
- **WHEN** the game is opened with `?level=slice01&debug&jump=r11` and play begins
- **THEN** each stage starts the next one in order until the slice ends

## MODIFIED Requirements

### Requirement: Tunnel power-loss emergency shift and onboard PA routing
When `r15a_heins_04` cuts off during Stage 2, traction power SHALL drop: `trainPowerDown` plays, Stage 2 hallway strips, `R16a` north shroud (`transit:tunnel_power`), and dynamic passing lights (`r15b_tunnel_pass_0..3`) shift to emergency red while cabin lights stay steady. Onboard Transit PA announcements (`r16_pa_01`, `r16_pa_02`) SHALL be heard overhead at a steady level from first word to last, and `r16_pa_01` SHALL finish before the Stage 3 hand-off.

#### Scenario: Traction power drops on Heins's radio cutoff
- **WHEN** `r15a_heins_04` ends in static during Stage 2 of `r15a_train_ride`
- **THEN** `trainPowerDown` plays, hallway strips, shroud strips, and dynamic passing lights shift to emergency red, cabin lights stay steady, and `r16_pa_01` plays overhead inside the cabin before deceleration

#### Scenario: The whole announcement is heard
- **WHEN** the ride plays with the shipped voice clips
- **THEN** `r16_pa_01` ends at least `2 s` before Train Car B appears in `R16a`

#### Scenario: Moved by a stage handoff
- **WHEN** the ride moves Jay to another stage while an onboard announcement is playing
- **THEN** the announcement stays overhead at the same loudness

#### Scenario: Tunnel lighting resets cleanly
- **WHEN** the level resets (`level:reset`)
- **THEN** the Stage 2 hallway and `R16a` north shroud return to their default lit state

### Requirement: Pitch-black arrival cutscene and Train Car B downward auxiliary lights
From the ride's departure through the end of the finale, `R16a` and `R16b` SHALL be pitch black (`lightState` `off` + `tint: 'black'`) except during scripted flickers, leaving Train Car B's cabin lights as the sole interior light on arrival. The boarding door SHALL stay closed until Jay locks into cutscene mode, walks to the center opening, and looks down as two downward auxiliary lights (`r16a_train_aux_n/s`, no raw `THREE.Light`s in the shell) reveal platform blood pools.

#### Scenario: Pitch-black dock arrival and auxiliary blood reveal
- **WHEN** Train Car B docks in `R16a` and `r16_arrival_finale` begins
- **THEN** `R16a` and `R16b` are pitch black with the boarding door closed until cutscene lock, Jay walks to the center opening looking down, and `r16_pa_02` engages the two downward auxiliary lights to expose blood on the platform without recompiling shaders

#### Scenario: Never lit on the way in
- **WHEN** Train Car B glides into `R16a`
- **THEN** the room's overhead lights are already off and are never seen switching off
