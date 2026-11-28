# Spec Delta

## ADDED Requirements

### Requirement: R11 Power Bay cautious entry and Giles's casual diagnosis
When the squad enters `R11` after completing the `R10` valve sequence, `R11` SHALL play a non-combat narrative beat instead of the legacy wave-defense climax or Giles infection cliffhanger. Jay and Okafor SHALL whisper cautiously on entry, unsure what the dark bay is; Giles SHALL calmly walk past them to the west-wall terminal (`r11_giles_task`), casually noting it is just the power bay, diagnose the tripped transit sub-grid, and voice his realization before starting the generators.

#### Scenario: Entering the dark Power Bay from R10
- **WHEN** Jay walks north through `D_R10_R11` into `R11` with `valve_done` set
- **THEN** Okafor and Jay whisper cautiously about the unfamiliar dark room while no enemies spawn
- **AND** Giles calmly walks past them to `r11_giles_task`, casually telling them it is just the power room, inspects the terminal, and calls out his diagnosis before beginning the power-up phases

#### Scenario: No Giles infection escalation or cliffhanger in R11
- **WHEN** the `R11` Power Bay sequence runs or restores from checkpoint
- **THEN** `giles.infectionStage` remains `0`, `giles.bandaged` remains `false`, `reveal:trail` is never emitted, and Giles does not confess an injury or transform

### Requirement: Phased generator startup rumble and progression to R13d
During the `R11` power-up cascade, each of the three spatial startup phases SHALL play a distinct, generated low-rumbling generator phase-startup SFX synchronized with its overhead light bank energization (`r11_bank_1a`/`1b`, `r11_bank_2a`/`2b`, `r11_bank_3a`/`3b`). Once the final phase stabilizes and `r11_powered` is set, `D_R13d_R11` SHALL open, a checkpoint SHALL save, and the active objective SHALL guide the player east through `R13d` toward the `R15a` Departure Boarding Bay.

#### Scenario: Three-phase generator rumble synchronized with light banks
- **WHEN** Giles triggers the `R11` power-up cascade from the west-wall terminal
- **THEN** phases 1, 2, and 3 each play their dedicated low-rumbling generator startup SFX alongside the west-to-east overhead light banks energizing and turbine rotors spinning up

#### Scenario: Proceeding from energized Power Bay into Maintenance Corridor
- **WHEN** the final `R11` power-up phase completes
- **THEN** `r11_powered` is set, `D_R13d_R11` is open (never sealed behind the squad), a checkpoint saves, and the objective directs Jay through `R13d` to `R15a` Departure Boarding Bay
