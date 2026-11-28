# Spec Delta

## ADDED Requirements

### Requirement: The pistol is textured at 2048 px
The first-person pistol's colour, roughness/metalness and normal textures SHALL be at least 2048 x 2048 px, taken from the author's own textures at that size and not enlarged from smaller copies.

#### Scenario: Shipped model
- **WHEN** the textures of the pistol's gun material in the shipped model are measured
- **THEN** each is at least 2048 x 2048 px

#### Scenario: Close view
- **WHEN** the player aims the pistol on High at 4K
- **THEN** scratches, grain and serrations on the slide are visibly crisper than with the 1024 px textures

### Requirement: The pistol carries no decals or logos
The first-person pistol SHALL NOT show decals, stickers, novelty lettering or third-party logos on any surface, at rest or in any animation. Where artwork was removed, the surface SHALL read as the same worn metal as its surroundings.

#### Scenario: Pistol drawn
- **WHEN** the player holds the pistol at rest or aims it, on any quality setting
- **THEN** the slide and frame show bare worn metal, with no skull emblem, "BANG" lettering or fragment of either

#### Scenario: Reloading
- **WHEN** the player reloads the pistol and the magazine comes into view
- **THEN** the magazine shows no decal

#### Scenario: No ghost outline
- **WHEN** a light or reflection moves across a repaired surface
- **THEN** no square, diamond or lettering outline shows where a decal was
