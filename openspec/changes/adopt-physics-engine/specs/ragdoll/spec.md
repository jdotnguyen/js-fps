# Spec Delta

## Purpose

Gives humanoid bodies physical behaviour: falling and lying as ragdolls when killed, respecting severed limbs, freezing when settled, and (when powered) resisting hits and blending with authored animation for play-dead and getting up.

## ADDED Requirements

### Requirement: Killed bodies fall physically
With death ragdolls on, a killed humanoid SHALL fall as a ragdoll carrying its velocity and the killing hit's impulse, collide with the level and other bodies, and come to rest without passing through walls, floors or props.

#### Scenario: Shot in the chest on stairs
- **WHEN** a walking shambler is killed by a chest shot while on a stair
- **THEN** it falls back along the shot direction and comes to rest on the stairs or at their foot

#### Scenario: Killed next to a bench
- **WHEN** a shambler is killed beside a bench
- **THEN** its body drapes over or slumps against the bench instead of passing into it

### Requirement: Ragdolls respect severed parts
A ragdoll SHALL include only the body parts still attached, and a part severed from a ragdoll SHALL leave as severed debris.

#### Scenario: Legless body
- **WHEN** a shambler with both legs severed is killed
- **THEN** its ragdoll has no legs and the stumps stay attached to the pelvis

#### Scenario: Shooting a corpse
- **WHEN** a ragdolled corpse's arm is shot off
- **THEN** the arm leaves as severed debris and the rest of the ragdoll reacts to the hit

### Requirement: Joints stay within human limits
Ragdoll joints SHALL stay within anatomical limits. No joint SHALL bend backwards, and no body SHALL jitter visibly once at rest.

#### Scenario: Knee
- **WHEN** a ragdoll falls onto its knees
- **THEN** no knee bends forward past straight

#### Scenario: At rest
- **WHEN** a ragdoll has come to rest
- **THEN** no part of it moves more than 1 mm per second

### Requirement: Settled corpses are frozen
A ragdoll at rest SHALL freeze into a static pose within 8 seconds of death and SHALL then cost no simulation time until something touches it. No more than 6 ragdolls SHALL be active at once. Beyond that, the oldest active one SHALL be frozen early.

#### Scenario: Many kills at once
- **WHEN** 8 shamblers are killed within one second
- **THEN** at most 6 ragdolls are active at any moment and every body ends frozen

#### Scenario: Restart from checkpoint
- **WHEN** the player restarts from a checkpoint after killing enemies
- **THEN** no ragdoll, physical body or collider from before the restart remains

### Requirement: Authored kills stay authored
Scripted kill set pieces and sequence-driven corpse poses SHALL play as authored, and SHALL NOT be ragdolled unless their data asks for it.

#### Scenario: Voss kill
- **WHEN** the Voss kill sequence plays
- **THEN** her body follows its authored beats and only the gore pieces are physical

### Requirement: Powered ragdolls react to hits
With powered ragdolls on, a living humanoid hit by a shot SHALL be pushed physically at the hit part and SHALL return to its animated pose within 0.6 seconds. A killed one SHALL lose strength over 0.3 to 0.8 seconds rather than going limp at once.

#### Scenario: Shoulder hit
- **WHEN** a walking shambler is shot in the left shoulder
- **THEN** its upper body twists away from the shot and it returns to its walk within 0.6 seconds

#### Scenario: Death
- **WHEN** a powered shambler is killed
- **THEN** it visibly sags and stumbles for at least 0.3 seconds before collapsing as a ragdoll

### Requirement: Play-dead and getting up blend with physics
With powered ragdolls on, a play-dead body SHALL lie as a frozen ragdoll indistinguishable from a real corpse, and getting up SHALL blend from its lying pose into the get-up animation without popping.

#### Scenario: Play-dead rises
- **WHEN** a play-dead shambler that fell as a ragdoll starts to get up
- **THEN** no bone jumps more than 5 cm between frames during the blend into the get-up animation
