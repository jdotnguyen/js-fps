# lab-wing Specification

## Purpose
Defines the lab wing (R04 Lab B, R05 Lab Junction, R06 Pressure Door Hall) as a place: a clean, working lab wing that went bad an hour ago. Covers each room's role, the coolant line the bloom follows, what Lab B shows before and after the drop, the wing's look, and the two fight spaces with what they must keep for their sequences.

## Requirements

### Requirement: Room roles
The lab wing SHALL keep three rooms with these names and roles:
- R04 "Lab B": Voss's culture lab, with a culture column, a biosafety cabinet, a −80 freezer, an incubator stack, a storage cabinet and a ceiling vent the creature escapes through
- R05 "Lab Junction": the wing's decon junction, with an emergency shower and eyewash, PPE lockers, a hazmat suit rack and a directory sign
- R06 "Pressure Door Hall": a compartment boundary, with a watertight bulkhead, a dogging wheel, a pressure manifold and a status board

#### Scenario: Lab B through the gallery glass
- **WHEN** the blinds go up during the drop
- **THEN** the player sees the culture column behind Voss, and lab equipment against the walls

#### Scenario: Entering R05 after the drop
- **WHEN** Jay enters R05 after the drop
- **THEN** the emergency shower, the PPE lockers and the directory sign are visible from the doorway

#### Scenario: Lab B's vent from the gallery
- **WHEN** the player looks into Lab B from the gallery after the escape
- **THEN** the open ceiling vent and its hanging grate are in view

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
R05 SHALL have no fight. No enemy SHALL spawn in R05. The creature's passage SHALL be heard above R05's ceiling, along the
coolant line, moving from Lab B toward R06. `D_R04_R05` SHALL stay sealed for the rest of the level.

#### Scenario: Floor spawn has a source
- **WHEN** Jay enters R05 after the drop
- **THEN** bangs and scrapes are heard above the ceiling, each one nearer R06 than the last, and no enemy appears in R05

#### Scenario: The Lab B door stays shut
- **WHEN** the contact scene runs and when any later save is loaded
- **THEN** `D_R04_R05` is sealed

### Requirement: R06 fight space
R06 SHALL give the cover-me fight one enemy source and one enemy: a ceiling vent grate with bloom above the room, which
bursts open and drops the escaped Lab B creature. Before it bursts, the creature SHALL be heard crossing the ceiling
toward it. Giles's panel SHALL be beside the south bulkhead, on the coolant line. The hold point SHALL see the vent grate.
A 1.2 m clear lane SHALL run from the north door to Giles's spot.

#### Scenario: Every source in view but one
- **WHEN** Jay stands at the hold point facing south
- **THEN** the ceiling vent grate is in view

#### Scenario: The fight still resolves
- **WHEN** the creature is simulated against Giles and Jay
- **THEN** it reaches a target or is resolved by the enemy-encounters rules, and the group completes

### Requirement: What the wing keeps
The rebuild SHALL keep:
- every door id in the wing
- the sequences `drop`, `contact` and `cover_me` with their flags, objectives and checkpoints
- the lines of those sequences, apart from these: `contact_giles_01` and `contact_okafor_01` move to the Lab B escape in `drop`; `contact_okafor_03` and `contact_after_01` move to `cover_me`; `contact_okafor_02` is removed
- the anchor `labb_victim`, Voss's benches and her key light
- a clear sight line from the gallery glass to Voss's chest

The Lab Junction SHALL have no radio: the R05 console radio, its `r05_radio` anchor and the `ruined_radio_off` sequence are removed.

#### Scenario: Voss stays visible
- **WHEN** slice01 is built
- **THEN** no new prop in Lab B blocks the straight line from the gallery glass to `labb_victim` at chest height

#### Scenario: No radio after the contact fight
- **WHEN** the contact scene ends and the `cp_contact_clear` checkpoint saves
- **THEN** no radio music plays in the Lab Junction, and the level has no `r05_radio` anchor

#### Scenario: The legs lesson in R06
- **WHEN** the creature lands in R06
- **THEN** Okafor says "Legs! Take its legs!", and after it dies Okafor says "The legs. Did you see? It kept coming until it couldn't stand."
