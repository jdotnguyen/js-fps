# sequence-triggers Specification

## Purpose

Defines how scripted sequences start from game events and one-shot level triggers when they are gated by `requires` and `unless` flags, so a trigger the player reaches too early is not lost.

## Requirements

### Requirement: A gated sequence starts when its event arrives and its flags allow it
A sequence SHALL start when its trigger event arrives, its `match` fields agree, its `requires` flag is set (when it has one) and its `unless` flag is clear (when it has one).

#### Scenario: Flags already allow it
- **GIVEN** `cover_done` is set and `armory_open` is clear
- **WHEN** Jay enters `trig_r07_enter`
- **THEN** `armory_auto` starts at once

#### Scenario: Unless flag set
- **GIVEN** `armory_open` is set
- **WHEN** Jay enters `trig_r07_enter`
- **THEN** `armory_auto` does not start

### Requirement: An early level trigger is held until its sequence may run
When a one-shot level trigger fires and a sequence listening to it is held back only by a `requires` flag that is not set, the sequence SHALL be held. It SHALL start once that flag is set, if its `unless` flag is still clear, whether or not Jay is still in the trigger.

#### Scenario: Jay walks into Security before the cover fight ends
- **GIVEN** D_R06_R07 is open and `cover_done` is not yet set
- **WHEN** Jay enters `trig_r07_enter` and `trig_r08_glass`, and later `cover_me` sets `cover_done`
- **THEN** `armory_auto` and `sec_glass_near` each start once, after `cover_done` is set

#### Scenario: Unless flag set while held
- **GIVEN** `armory_auto` is held waiting for `cover_done`
- **WHEN** `armory_open` is set before `cover_done`
- **THEN** `armory_auto` does not start when `cover_done` is set

### Requirement: Repeatable events are not held
An event that is not a one-shot level trigger SHALL NOT be held when a sequence's flags do not allow it; it SHALL be ignored for that sequence, as now.

#### Scenario: Med-lab door tried too early
- **GIVEN** `sec_done` is not set
- **WHEN** Jay tries D_R07_R09 and the door answers `door:denied`
- **THEN** `medlab_door` does not start then or later from that try, and a later try after `sec_done` starts it

### Requirement: A held trigger lasts until it runs or the checkpoint restarts
A held trigger SHALL start its sequence at most once. Restarting from a checkpoint SHALL drop every held trigger, since the level re-arms its triggers on restart.

#### Scenario: Death while held
- **GIVEN** `armory_auto` is held waiting for `cover_done`
- **WHEN** Jay dies and the game restarts from `cp_contact_clear`
- **THEN** nothing is held, and entering `trig_r07_enter` again is handled under the flags as they then stand
