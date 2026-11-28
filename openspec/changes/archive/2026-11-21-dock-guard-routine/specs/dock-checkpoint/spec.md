# Dock checkpoint delta

## MODIFIED Requirements

### Requirement: Dock guard

During arrivals the guard SHALL work on the station side facing the arch, use the unique `guard1` body, and carry the wand. His scripted duty SHALL continue at the booth desk after the queue clears. Ambient life SHALL never move him.

#### Scenario: Guard holds his post

- **WHEN** ambient life chooses NPCs to wander
- **THEN** the dock guard is never chosen

#### Scenario: No body twin

- **WHEN** slice01 loads
- **THEN** exactly one NPC uses the `guard1` body

#### Scenario: Waiting for the next arrival

- **WHEN** Jay watches the guard between arrivals
- **THEN** the wand rests low by his thigh, his elbow relaxes, and his weight settles over one planted foot
- **WHEN** the next person approaches
- **THEN** the guard turns his head toward them before shifting his weight to attend to them

### Requirement: Wand scan

When the guard scans someone, the person SHALL stop past the arch with arms out. The guard SHALL track the pass with his gaze and sweep the wand in one fluid movement with a beep. The person SHALL then lower their arms and walk on.

#### Scenario: Full scan

- **WHEN** the intro gives Ruiz a full scan
- **THEN** she stands arms out while the guard raises the wand, follows the sweep down with his body, and the wand beeps during the scan
- **AND** he lowers the wand as he clears her and she walks on

#### Scenario: Skipped mid-scan

- **WHEN** the intro is skipped during a scan
- **THEN** the person ends at their destination with arms down, the guard is seated at his desk, the chair is pulled up and the wand rests on the desk

### Requirement: Arch reacts in free play

During post-intro free play before the drop, the arch SHALL alarm when Jay walks through carrying a weapon. The seated guard SHALL acknowledge the alarm from the desk with a glance and a line at most once per pass, with at least 20 seconds between spoken reactions.

#### Scenario: Jay walks through armed

- **WHEN** Jay walks through the arch with a weapon in free play and the reaction is available
- **THEN** the arch alarms and the guard looks up and says one of his reaction lines from his seat

#### Scenario: Jay walks through unarmed

- **WHEN** Jay walks through the arch without a weapon
- **THEN** the arch shows a pass and the guard says nothing

#### Scenario: Back and forth

- **WHEN** Jay walks through armed twice within 20 seconds
- **THEN** the arch alarms both times but the guard speaks only the first time

## ADDED Requirements

### Requirement: Guard returns to the security desk

After dismissing Giles, the guard SHALL walk into the booth, set the wand on the desk, pull the existing chair into working position and sit at the keyboard facing the CCTV wall.

#### Scenario: The last arrival clears the arch

- **WHEN** Giles clears the arch after the guard's coffee line and Jay starts leaving the booth
- **THEN** the guard takes the open route to the desk without obstructing Jay or delaying the conversation

#### Scenario: Taking the chair

- **WHEN** the guard reaches the desk
- **THEN** the wand passes from hand to desktop, his hand reaches the chair back before the chair moves, and hand and chair travel together during the pull
- **AND** he turns into position, lowers onto the seat with his feet on the floor, and settles facing the screens

#### Scenario: Skipping the walk, pull or sit

- **WHEN** the intro is skipped during any part of the return to the desk
- **THEN** the guard, chair and wand reach the same final positions and poses as after a full watch
