# lab-wing Specification

## Purpose
Defines the lab wing (R04 Lab B, R05 Lab Junction, R06 Pressure Door Hall) as a place: a clean, working lab wing that went bad an hour ago. Covers each room's role, the coolant line the bloom follows, what Lab B shows before and after the drop, the wing's look, and the two fight spaces with what they must keep for their sequences.

## Requirements

### Requirement: Room roles
The lab wing SHALL keep three rooms with these names and roles:
- R04 "Lab B": Voss's culture lab, with a culture column, a biosafety cabinet, a −80 freezer, an incubator stack and a storage cabinet
- R05 "Lab Junction": the wing's decon junction, with an emergency shower and eyewash, PPE lockers, a hazmat suit rack and a directory sign
- R06 "Pressure Door Hall": a compartment boundary, with a watertight bulkhead, a dogging wheel, a pressure manifold and a status board

#### Scenario: Lab B through the gallery glass
- **WHEN** the blinds go up during the drop
- **THEN** the player sees the culture column behind Voss, and lab equipment against the walls

#### Scenario: Entering R05 after the drop
- **WHEN** Jay enters R05 for the first fight
- **THEN** the emergency shower, the PPE lockers and the directory sign are visible from the doorway

### Requirement: The coolant line
A single, continuous coolant line SHALL run from Lab B's culture column, through Lab B's service wall, along R05's ceiling and down R06 to Giles's bypass panel beside the south bulkhead. Every place it passes through a wall SHALL show a wall collar. The line SHALL carry a warped service panel on Lab B's service wall.

#### Scenario: Following the line
- **WHEN** the player walks from R05 into R06
- **THEN** the same line seen on R05's ceiling continues through the wall into R06 and ends at the panel where Giles works

### Requirement: The bloom follows the line
Bloom growth SHALL sit only on or beside the coolant line:
- R04: two or more growth masses and spreads
- R05: between one and three growths
- R06: at most two growths, including one at Giles's panel

Bloom outside the culture column SHALL be hidden until the drop's burst. It SHALL be shown on any load after the drop.

#### Scenario: Before the drop
- **WHEN** the player looks into Lab B from the gallery during the briefing
- **THEN** bloom shows only inside the culture column

#### Scenario: After the drop
- **WHEN** a save made after the drop is loaded
- **THEN** the bloom outside the column is visible in R04, R05 and R06

### Requirement: Clean finish, placed wear
The wing's walls, floors and ceilings SHALL use clean, rust-free materials. Wear SHALL come only from placed decals (at most 8 grime or stain decals per room), blood placed by the drop, and the bloom.

#### Scenario: No rust materials
- **WHEN** slice01 is built
- **THEN** no wall, floor or ceiling piece in R04, R05 or R06 uses a rust material slot

### Requirement: Lockdown light that keeps fights readable
After the drop, R05 and R06 SHALL be lit by red lockdown light plus one steady white work light over each fight's focus: the middle of R05, and Giles's panel in R06. Lab B SHALL keep neutral white light. Fog density in the wing SHALL be at most 0.03.

#### Scenario: Cover-me under lockdown
- **WHEN** the cover-me fight runs
- **THEN** a steady white light falls on Giles and the floor around his panel

### Requirement: R05 fight space
R05 SHALL give the first-contact fight three visible enemy sources: the Lab B bulkhead, the west wall vent, and a floor drain grate. Cover SHALL stand against walls and in corners, leaving the middle of the room open. No new cover top in R05 SHALL be between 0.35 m and 1.0 m high unless the jump-tops review lists it.

#### Scenario: Floor spawn has a source
- **WHEN** the trickle group's floor enemy appears
- **THEN** it rises from the drain grate

### Requirement: R06 fight space
R06 SHALL give the cover-me fight four enemy sources, six enemies in all:
- a ruptured ceiling duct with bloom (1)
- a service trench grate (2)
- an east wall vent south of the room's middle (2)
- the corridor from R05 (1)

Giles's panel SHALL be beside the south bulkhead, on the coolant line. The hold point SHALL see the duct, trench and vent sources. A 1.2 m clear lane SHALL run from the north door to Giles's spot.

#### Scenario: Every source in view but one
- **WHEN** Jay stands at the hold point facing south
- **THEN** the duct, trench grate and east vent are in view, and only the corridor source is behind him

#### Scenario: The fight still resolves
- **WHEN** the six enemies are simulated against Giles and Jay
- **THEN** each one reaches a target or is resolved by the enemy-encounters rules, and the group completes

### Requirement: What the wing keeps
The rebuild SHALL keep:
- every door id in the wing
- the sequences `drop`, `contact` and `cover_me` with their lines, flags, objectives and checkpoints
- the anchor `labb_victim`, Voss's benches and her key light
- a clear sight line from the gallery glass to Voss's chest
- the radio on R05's console

#### Scenario: Voss stays visible
- **WHEN** slice01 is built
- **THEN** no new prop in Lab B blocks the straight line from the gallery glass to `labb_victim` at chest height
