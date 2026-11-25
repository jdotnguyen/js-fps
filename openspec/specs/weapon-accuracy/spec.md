# weapon-accuracy Specification

## Purpose

Defines dynamic weapon accuracy for first-person firearms—hold-to-focus ADS settling, rapid-fire bloom in both hipfire and ADS, and movement/turning disturbance—together with a matching two-bracket dynamic crosshair HUD.

## Requirements

### Requirement: Rapid fire increases spread in both hipfire and ADS
Each weapon shot SHALL add accuracy bloom that widens the weapon's shot cone, whether firing from the hip or aiming down sights. Firing again before bloom has recovered SHALL compound the spread up to a per-weapon cap, and pausing between shots SHALL allow bloom to decay smoothly back to the weapon's baseline spread.

#### Scenario: Rapid hipfire widens spread
- **WHEN** the player fires the pistol multiple times in rapid succession from the hip
- **THEN** each consecutive shot has a wider spread cone than a single rested hipfire shot, up to the weapon's bloom cap

#### Scenario: Rapid ADS fire widens spread
- **WHEN** the player aims down sights and fires multiple shots in rapid succession
- **THEN** each shot adds bloom that widens the spread cone and breaks any built-up focus

#### Scenario: Pausing allows bloom to recover
- **WHEN** the player stops firing after building bloom
- **THEN** the weapon's spread decays smoothly back to its rested baseline for the current stance

### Requirement: Holding steady while aiming down sights focuses accuracy
Aiming down sights SHALL transition from hipfire spread to an initial ADS spread and then tighten further over a deliberate hold-to-focus window down to a high-accuracy focused spread. Focus SHALL tighten spread only and SHALL NOT alter weapon damage or apply hidden critical multipliers.

#### Scenario: Pistol reaches focused accuracy when held steady
- **WHEN** the player holds aim down sights with the pistol while standing still and holding the view steady for the focus window
- **THEN** the spread cone tightens continuously from the initial ADS spread to the focused near-pinpoint spread

#### Scenario: Shotgun tightens choke when held steady
- **WHEN** the player holds aim down sights with the shotgun while steady for the focus window
- **THEN** the pellet spread cone tightens from the initial ADS choke to the focused choke

#### Scenario: Firing resets built-up focus
- **WHEN** the player fires a weapon while partially or fully focused
- **THEN** focus drops and must settle again before returning to the focused spread

### Requirement: Fast movement and sharp camera turns disturb focus
Rapid player movement or sharp camera turning SHALL slow or pause focus accumulation, and sprinting, reloading, or switching weapons SHALL clear built-up focus. Small aiming micro-adjustments SHALL be tolerated so tracking a slow-moving target does not wipe focus.

#### Scenario: Sprinting, reloading, or switching weapons clears focus
- **WHEN** the player has built focus and begins sprinting, starts a reload, or switches weapons
- **THEN** focus resets to zero and must be re-acquired when aiming again

#### Scenario: Sharp flicks disturb focus while micro-adjustments do not
- **WHEN** the player tracks a slow target with gentle mouse motion while aiming down sights
- **THEN** focus continues to accumulate
- **WHEN** the player makes a rapid large-angle camera flick while aiming down sights
- **THEN** focus gain stalls or sheds while the fast turn occurs

### Requirement: Hitscan spread and crosshair radius stay synchronized
The spread angle applied to player hitscan shots SHALL be the same dynamic spread angle reflected by the crosshair, and the crosshair bracket radius SHALL project that angular spread onto the viewport using the active camera field of view.

#### Scenario: Wider spread produces wider brackets and wider shot cone
- **WHEN** bloom increases from rapid fire or decreases during focus
- **THEN** both the hitscan cone and the rendered crosshair bracket radius expand or contract proportionally

#### Scenario: FOV changes preserve angular honesty
- **WHEN** the camera field of view changes (such as ADS zoom or changing the FOV setting)
- **THEN** the crosshair bracket radius scales to match the projected angular spread at the active FOV

### Requirement: Crosshair displays a center dot with two curved side brackets
When armed during gameplay, the crosshair SHALL render a center dot flanked by two curved side brackets (left and right arcs, with no top or bottom ticks). When full focus is reached, the two brackets SHALL tighten snugly onto the center dot and brighten to crisp white.

#### Scenario: Armed hipfire and ADS display two side brackets
- **WHEN** the player is armed and playing in hipfire or ADS
- **THEN** the crosshair shows a center dot and two curved left/right brackets whose circumference tracks the current spread

#### Scenario: Full focus tightens and brightens the brackets
- **WHEN** focus reaches 100% while aiming down sights
- **THEN** the side brackets sit snugly against the center dot and brighten to crisp white

### Requirement: Non-firing states, cutscenes, and reduced motion are handled cleanly
When unarmed (before the sidearm is drawn), the crosshair SHALL display only the center dot without weapon brackets. While sprinting or reloading, the brackets SHALL fade out leaving only a faint center dot. During cutscenes, the crosshair SHALL remain hidden. With reduced motion enabled, the bracket radius SHALL still reflect true spread accurately without spring overshoot or bounce.

#### Scenario: Unarmed player sees dot only
- **WHEN** the player does not have a weapon drawn
- **THEN** only the center dot is visible and no weapon brackets are shown

#### Scenario: Sprinting or reloading fades brackets
- **WHEN** the player sprints or reloads an armed weapon
- **THEN** the side brackets fade out, leaving a faint center dot, and return smoothly once ready to fire

#### Scenario: Cutscene hides crosshair
- **WHEN** a cutscene with letterbox bars is active
- **THEN** the entire crosshair is hidden

#### Scenario: Reduced motion disables bounce while keeping honest spread
- **WHEN** reduced motion is enabled and the player fires or focuses
- **THEN** the bracket radius tracks the true spread smoothly without spring overshoot
