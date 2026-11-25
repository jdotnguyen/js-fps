# squad-scripted-combat Specification

## Purpose

Defines scripted squad combat presentation outside active AI gunfights: pre-allocated weapon-mounted dynamic flashlights, live scripted aiming that coexists with locomotion and scripted firing, and CCTV-readable scripted pistol bursts.

## Requirements

### Requirement: Pre-allocated weapon-mounted squad flashlights
Each squadmate (`giles`, `okafor`) SHALL own a pre-allocated weapon-mounted `SpotLight` (intensity `0` by default, no scene light count change, no volumetric cone mesh) toggled via `squad:flashlight` and reset to off on `level:reset`. While active, the spotlight SHALL originate at the held weapon muzzle and aim directly at `body.aimTarget` when set, falling back to the weapon bore forward vector otherwise.

#### Scenario: Toggling squad flashlights without shader recompiles
- **WHEN** `squad:flashlight` enables or disables flashlights for `giles` and `okafor`
- **THEN** their pre-allocated spotlights switch intensity between `0` and active with no added or removed scene lights and no rear-facing volumetric cone artifacts, resetting to off on `level:reset`

#### Scenario: Flashlight tracks elevated aim targets
- **WHEN** a squadmate has `flashlightOn` active and `body.aimTarget` is elevated above eye level
- **THEN** the weapon spotlight pitches up to point directly at `body.aimTarget`

### Requirement: Live scripted aim coexists with locomotion and firing bursts
Scripted aiming (`squad:aim` / `setScriptedAim`) SHALL keep a squadmate's gaze and weapon aimed at a live world target even while `scripted` is true or a scripted firing burst is active, updating the active burst's target each frame. Turning the body heading toward the aim target SHALL run only when stationary (`speed < 0.005`) and SHALL update heading directly without zeroing walk velocity.

#### Scenario: Aiming while walking forward
- **WHEN** a squadmate has a live scripted aim target and receives a `npcMoveTo` walk command
- **THEN** the squadmate walks smoothly at the commanded speed without stalling while keeping the weapon and gaze aimed at the target

#### Scenario: Redirecting aim mid-burst
- **WHEN** `squad:aim` changes the target while a `squad:scripted_fire` burst is still firing
- **THEN** both the squadmate's aim, weapon spotlight, and remaining burst shots track the new target immediately

### Requirement: Boosted scripted pistol bursts
Scripted firing (`squad:scripted_fire` / `scriptedFire`) SHALL fire timed pistol bursts toward a target point even while `scripted` is true, emitting `squad:fired` with configurable burst count, interval, and muzzle-flash intensity boost so shots remain clearly readable on dark CCTV feeds.

#### Scenario: Scripted burst emits boosted muzzle flashes
- **WHEN** `squad:scripted_fire` triggers for `giles` and `okafor` with an elevated `boost`
- **THEN** both squadmates fire staggered pistol bursts toward the target with boosted muzzle-flash illumination and gunshot audio
