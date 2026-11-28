# Spec Delta

## ADDED Requirements

### Requirement: R11-to-R15a walk-and-talk banter with free player roam
Once `R11` finishes energizing and `D_R13d_R11` opens, Giles and Okafor SHALL walk ahead out of `R11`, east through `R13d` Maintenance Corridor, and through `D_R13d_R15a` into `R15a` while Jay retains full free-roam control. Along the walk they SHALL exchange banter with Jay about the plan after boarding (heading to `R16` for the deep-lift/evacuation shuttles, tunnel safety, and checking weapons before arrival).

#### Scenario: Squad leads from R11 through R13d to R15a while Jay roams freely
- **WHEN** `r11_power_bay` completes and opens `D_R13d_R11`
- **THEN** Giles and Okafor walk north through `D_R13d_R11`, east through `R13d`, and through `D_R13d_R15a` into `R15a`, delivering their walk-and-talk plan banter while Jay can freely follow, explore, or run ahead without movement locks

### Requirement: R15a Departure Boarding Bay narrative entry and squad boarding
When Jay enters `R15a` after restoring power in `R11`, the boarding sequence SHALL trigger while keeping player movement free. Giles and Okafor SHALL comment on the powered departure car and walk across the `R15a` platform through the boarding gap into Train Car A, taking cabin positions while waiting for Jay to step aboard.

#### Scenario: Entering R15a from the Maintenance Corridor
- **WHEN** Jay steps east through `D_R13d_R15a` into `R15a` with `r11_powered` set
- **THEN** `trigger:r15a_enter` fires, Giles and Okafor speak their boarding lines and walk into Train Car A across the boarding gap, and player movement remains unlocked

#### Scenario: Boarding Train Car A launches the 3-stage transit ride
- **WHEN** Jay walks inside Train Car A (`trigger:r15a_boarded`) with `r11_powered` set
- **THEN** `obj_transit_board` completes, `D_R13d_R15a` locks behind the squad, Train Car A seals its boarding door, `r15a_south` opens, and the 3-stage abyssal transit ride starts with Stage 2 cruise extended to fit the radio exchange

### Requirement: Rear-bulkhead comms terminal state feedback during the ride
The `train_comms_terminal` on the rear bulkhead of the transit train cars SHALL respond to `transit:comms_state` events (`idle`, `ringing`, `active`, `lost`) by updating its status indicator emissive state so the player has a clear visual cue when an incoming radio hail arrives, connects, and drops out, resetting to `idle` on `level:reset`.

#### Scenario: Comms terminal signals an incoming hail and later drops out
- **WHEN** `transit:comms_state` is emitted with `ringing`, then `active`, and finally `lost`
- **THEN** the rear-bulkhead terminal indicator shifts from pulsing amber (`ringing`) to steady green/teal (`active`) and then dim red (`lost`), returning to `idle` on `level:reset`

### Requirement: Stage 2 Heins radio exchange and synchronized transit ride audio
During Stage 2 (`sea_tunnel`) of the 3-stage transit ride, Security Chief Katie Heins (`chief`) SHALL hail Train Car A/B over the `radio` channel through the rear-bulkhead comms terminal, exchanging dialogue with Jay, Giles, and Okafor before breaking up into static as the train decelerates toward `R16a`. Distinct generated SFX SHALL accompany the boarding door sealing, blast gates opening and closing, train pull-out, tunnel cruise, comms hail, and arrival braking.

#### Scenario: Heins radio exchange plays during Stage 2 cruise
- **WHEN** the 3-stage transit ride enters Stage 2 (`sea_tunnel`)
- **THEN** the rear-bulkhead comms terminal chimes and activates, Heins speaks over the filtered `radio` channel warning that `R16` went dark after evacuation teams headed down, Jay/Giles/Okafor respond locally inside the cabin, and her transmission breaks into static as the car begins decelerating toward the closed `R16a` gate

#### Scenario: Transit ride audio plays across all three stages
- **WHEN** the 3-stage transit ride runs from departure pull-out through tunnel cruise to `R16a` stop
- **THEN** generated SFX play for the boarding door close, `r15a_south` and `r16a_north` blast gates, train pull-out, Stage 2 tunnel cruise bed, comms ring/static, and Stage 3 braking stop

### Requirement: R16a arrival handoff and checkpoint
When Train Car B comes to rest at the `R16a` platform at the end of Stage 3, `r16a_north` SHALL seal behind the car, Train Car B's boarding door SHALL remain closed, `transit_ride_done` SHALL be set, a checkpoint (`cp_r16_arrived`) SHALL save, and `transit:arrived_r16` SHALL be emitted for the arrival finale sequence to take over.

#### Scenario: Train Car B stops at R16a and hands off to the arrival finale
- **WHEN** `TransitRideController` transitions to `arrived` at the end of Stage 3
- **THEN** `r16a_north` seals, Train Car B's boarding door stays closed, `transit_ride_done` is set to `true`, checkpoint `cp_r16_arrived` saves, and `transit:arrived_r16` is emitted

### Requirement: Squadmates hold their cabin positions during the ride
From the moment the transit ride starts until Train Car B comes to rest at `R16a`, each squadmate (Giles, Okafor) SHALL stay where the ride placed them inside the cabin. They SHALL NOT follow Jay, dodge his aim cone, give way, path, or be relocated by `squadRegroup`, `squadCatchUpIn`, `gatherIn` timeouts, load placement, or far-and-unseen catch-up, and a sequence ending SHALL NOT hand them back to the follow AI mid-ride. Only contact with Jay's body MAY move them (a soft shove out of his capsule through level collision); they SHALL NOT walk back to their spot afterwards. The ride lock is separate from the cutscene `scripted` hold, so releasing a cutscene never clears it, and it is cleared when the ride ends or resets.

#### Scenario: Standing in the cabin through every stage
- **WHEN** Jay stands or walks anywhere in the cabin from pull-out through the tunnel cruise to the `R16a` stop, without touching either squadmate
- **THEN** Giles and Okafor do not move, step aside, or leave the car, and no scene step, cutscene release or catch-up places them elsewhere

#### Scenario: Walking into a squadmate
- **WHEN** Jay walks into Giles or Okafor during the ride
- **THEN** that squadmate is nudged out of Jay's way and stays at the new spot, and the squad AI resumes only after the car comes to rest at `R16a`
