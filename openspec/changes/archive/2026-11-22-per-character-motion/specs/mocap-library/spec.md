# Spec Delta

## Purpose

Defines the baked motion-capture clip library that every living character plays: which free sources it may use, where those sources live, how clips are retargeted onto the shared skeleton, and how they are credited and kept within size.

## ADDED Requirements

### Requirement: Clips come only from free, credited sources
Every clip in the library SHALL come from a source that costs nothing and whose licence the project accepts: CC0, CC BY, CC BY-NC, or a release with no restrictions on use. Each clip SHALL record its source, author and licence, and each source SHALL have a row in `CREDITS.md` and an entry in the in-game credits.

#### Scenario: Credits check
- **WHEN** the credits check runs over the clip library
- **THEN** every clip names a source with an accepted licence
- **AND** every source named by a clip has a `CREDITS.md` row and an in-game credit

#### Scenario: Unlicensed clip
- **WHEN** a clip with no source, or with a licence outside CC0, CC BY, CC BY-NC and no-restriction releases, is baked
- **THEN** the bake fails and names the clip

### Requirement: Bake sources live in the project
Every source file the bake reads SHALL live under `previews/sources/` (kept out of git), or be an asset already committed to the repository, with a manifest in the repository listing each file, where to download it and its licence. The bake SHALL NOT read from paths outside the project.

#### Scenario: Fresh checkout
- **WHEN** a developer downloads the files the manifest lists into `previews/sources/` and runs the bake
- **THEN** the bake reproduces the committed library

#### Scenario: Missing source
- **WHEN** a source the manifest lists is not present
- **THEN** the bake stops, names the missing file and where to get it, and leaves the committed library untouched

### Requirement: glTF and BVH sources retarget onto the shared skeleton
The bake SHALL read glTF/GLB and BVH sources and retarget them onto the shared 21-joint skeleton at the reference height. It SHALL keep foot contacts and stride for locomotion clips and make looping clips loop without a visible seam.

#### Scenario: BVH walk
- **WHEN** a BVH walk cycle is baked
- **THEN** the clip plays on every body with the feet planted during stance (no sliding beyond the existing foot-lock tolerance)
- **AND** its last frame flows into its first without a pop

#### Scenario: Different source proportions
- **WHEN** a source performer's limb proportions differ from the shared skeleton's
- **THEN** the baked clip keeps hands and feet off the body (no arm through the torso, no foot through the other leg)

### Requirement: Finger motion is kept where the source has it
When a source records finger joints, the bake SHALL keep a finger track for each hand (a curl per finger and a thumb spread) alongside the 21-joint tracks. Clips without finger data SHALL carry none.

#### Scenario: Source with fingers
- **WHEN** a clip whose source records fingers is baked
- **THEN** the baked clip carries finger tracks for both hands

### Requirement: The library stays within its size limit
The clip data loaded at game start SHALL be no larger than 2 MB uncompressed. A character's own clips SHALL be loaded with that character's body when they are not needed at start, and released with it.

#### Scenario: Size check
- **WHEN** the library is built
- **THEN** the data loaded at start is 2 MB or less
- **AND** the size of each character's clip set is recorded

#### Scenario: Leaving a level
- **WHEN** every body that uses a character's clips has been removed
- **THEN** that character's clip data is released (runtime-memory: no growth over a session)
