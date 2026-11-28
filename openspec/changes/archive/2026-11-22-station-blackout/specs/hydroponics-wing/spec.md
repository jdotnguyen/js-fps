# Spec Delta

## MODIFIED Requirements

### Requirement: Distinct room and equipment sounds across Hydroponics
Each Hydroponics room SHALL play its own ElevenLabs ambience preset (`R12a`: `hydro_vestibule`, `R12b`: `hydro_misters` without constant baked-in sprayer hiss, `R12c`: `hydro_seed_lab`, `R12d`: `hydro_plant_room`, `R12e`: `hydro_storeroom`) alongside positional equipment loops for trough water trickle, the dehumidifier, fertigation pumps, and the `R12e` kettle. The Storeroom SHALL have no radio and no `hydro_radio` anchor.

#### Scenario: Walking from the Grow Hall into the Storeroom
- **WHEN** the player unlocks `hydro_store` and enters `R12e`
- **THEN** the ambience crossfades from `hydro_misters` to `hydro_storeroom`
- **AND** a soft kettle simmer is audible near the desk, with no radio playing

#### Scenario: Nutrient Room mechanical soundscape
- **WHEN** the player enters `R12d`
- **THEN** the ambience crossfades to `hydro_plant_room`
- **AND** positional dehumidifier and fertigation pump loops play from their equipment
