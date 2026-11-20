# Spec Delta

## Purpose

Defines how authored room lights become lit fixtures and real lights in the scene, including how many real and shadow-casting lights each quality tier provides.

## ADDED Requirements

### Requirement: Fill-light pool sized by quality tier
The scene SHALL keep a fixed number of real fill lights for the active quality tier: 8 on Low, 16 on Medium, 32 on High. The count SHALL change only when the tier changes.

#### Scenario: Switching tier
- **WHEN** the player switches quality from Medium to High
- **THEN** the scene has 32 fill lights after the switch and the count does not change again until the next tier switch

### Requirement: Shadow-light pool sized by quality tier
The scene SHALL keep a fixed number of shadow-casting room lights for the active tier: 0 on Low, 2 on Medium, 6 on High, never more than the GPU's texture units allow. The player flashlight SHALL cast shadows on every tier in addition to this pool.

#### Scenario: Low tier
- **WHEN** quality is Low
- **THEN** no room light casts shadows and the flashlight still does

#### Scenario: GPU limit
- **WHEN** the GPU's texture units cannot fit 6 shadow maps alongside material textures
- **THEN** the High shadow pool is reduced to what fits and a warning is logged

### Requirement: Room lights opt in to shadows
A pooled room light SHALL cast shadows only when its level data sets `shadow: true`. Shadow-casting room lights SHALL shine downward from the fixture as a cone. Shadow lights SHALL go to opted-in lights in the current room first, nearest first, then to other visible rooms. An opted-in light that misses the shadow pool SHALL still light the room, unshadowed.

#### Scenario: Shadowed lamp
- **WHEN** a lamp over a sofa sets `shadow: true` and the shadow pool has room
- **THEN** the sofa and anyone sitting on it cast shadows on the floor inside the lamp's pool of light

#### Scenario: Shadow pool full
- **WHEN** more visible lights opt in than the shadow pool holds
- **THEN** the farthest opted-in lights light the room without shadows
