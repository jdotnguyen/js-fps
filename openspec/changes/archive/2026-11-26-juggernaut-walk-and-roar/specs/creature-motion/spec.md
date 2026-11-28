# Spec Delta

## Purpose

How a rigged creature moves: it walks along a path with its hands and feet planted on the ground, reporting each touchdown, and it plays timed key-pose sequences (roars and other set pieces) over its walk.

## ADDED Requirements

### Requirement: A creature walks a path on planted limbs
A creature SHALL walk a given path at a given speed, facing along it, in a diagonal-sequence gait: a hind leg, then the opposite hand, then the other leg, then the other hand. A planted hand or foot SHALL stay where it landed until it lifts. A lifted one SHALL rise on an arc and land ahead.

#### Scenario: Walking a straight path
- **WHEN** the Juggernaut walks 3.4 m in a straight line at 0.7 m/s
- **THEN** it ends within 5 cm of the path's end, facing along the path within 5°
- **AND** every planted hand and foot moves less than 2 cm while planted
- **AND** the limbs land in the order left leg, right hand, right leg, left hand

#### Scenario: Limbs stay clear of the ground while swinging
- **WHEN** a hand or foot swings to its next plant
- **THEN** it rises at least 10 cm above the ground at mid-swing and lands on the ground within 2 cm

### Requirement: A walk starts and ends standing
A creature SHALL start a walk from standing and SHALL end it standing on all four limbs, each within 15 cm of its standing place relative to the body. After a stop, no limb SHALL move until the next walk.

#### Scenario: Stopping at the end of the path
- **WHEN** the path ends
- **THEN** the creature finishes the swings in flight, steps any limb more than 15 cm from its standing place back to it, and then stands still

### Requirement: The body moves with its steps
While walking, the creature's body SHALL rise and fall with its steps and roll toward the side bearing the load. Standing, it SHALL do neither.

#### Scenario: Bob while walking, still while standing
- **WHEN** the Juggernaut walks one full gait cycle
- **THEN** its body height varies by between 3 and 15 cm over the cycle
- **AND** standing after the walk, it varies by less than 5 mm over a second

### Requirement: Touchdowns are reported
Each time a hand or foot lands, the walk SHALL report which limb landed, where, and whether it is a hand or a foot, so the game can play a footfall there.

#### Scenario: One report per landing
- **WHEN** the Juggernaut walks a path
- **THEN** each landing is reported once, at the landing point, and no report comes while a limb is planted

### Requirement: Key-pose sequences play over the walk
A creature's pose data SHALL be able to hold named sequences of steps. Each step gives:
- a pose (or neutral);
- a blend time and a hold time;
- jaw and tongue amounts;
- a tremble: a small shaking of the head, neck and jaw, in degrees.

Playing a sequence SHALL take each step in turn, end when the last hold ends, and leave the walk's planted limbs where they are. A sequence that names an unknown pose SHALL fail when the data loads, naming the sequence and the pose.

#### Scenario: A roar while walking
- **WHEN** the Juggernaut plays its walking roar during a walk
- **THEN** its jaw opens and its head lifts, while its hands and feet keep their gait

#### Scenario: Sequence timing
- **WHEN** a sequence with steps of 0.5 s blend plus 1 s hold and 0.3 s blend plus 0.2 s hold plays
- **THEN** it reports itself finished 2.0 s after it starts, within one frame

### Requirement: The Juggernaut roars in full
The Juggernaut's long roar sequence SHALL, in order:
1. wind up, the head lowered and the shoulders raised;
2. rear back, the chest up and the head thrust forward, the jaw fully open;
3. hold, trembling, for as long as its roar sounds (at least 2.5 s);
4. settle.

It SHALL stay inside every joint limit throughout.

#### Scenario: The roar's peak
- **WHEN** the long roar reaches its hold
- **THEN** the jaw is at its open limit, the head is at least 15° higher than at the start of the roar, and every joint is inside its limits
