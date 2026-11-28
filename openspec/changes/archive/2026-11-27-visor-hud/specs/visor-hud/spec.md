# Spec Delta

## Purpose

Shows the player's health, stamina and ammo as a projection on Jay's security visor, a pair of reactive panels and a faint visor rim, so the player reads their state at a glance and feels each hit, heal, shot and reload without leaving the first-person view.

## ADDED Requirements

### Requirement: Two visor panels and a faint rim
While playing, the HUD SHALL show a biomonitor panel bottom-left and a weapon panel bottom-right, each drawn as light projected on curved glass: tilted in perspective toward the screen centre, additive with a soft glow and faint scanlines. Faint corner brackets and a thin edge arc SHALL mark the visor rim. Nothing else SHALL frame or cover the view.

#### Scenario: Playing with a weapon drawn
- **WHEN** the player is in control with the pistol drawn
- **THEN** the biomonitor panel shows bottom-left, the weapon panel shows bottom-right, and the four rim brackets show at the screen corners

#### Scenario: Room left for the objective list
- **WHEN** the objective list, a toast and subtitles are on screen together with both panels
- **THEN** none of them overlaps another

### Requirement: Panels hide outside play
The panels and the rim SHALL hide on the title screen, while the map is open, while cutscene letterbox bars are up and on the game-over fade. The weapon panel SHALL also hide while no weapon is held.

#### Scenario: Cutscene starts
- **WHEN** the letterbox bars come up
- **THEN** both panels and the rim are hidden until the bars go down

#### Scenario: No weapon yet
- **WHEN** the player has not picked up a weapon
- **THEN** the biomonitor panel shows and the weapon panel does not

### Requirement: Numbers are always shown
Every panel state SHALL show its value as text: health as a number, loaded and reserve rounds as numbers, and the bleed-out seconds while downed. Colour, motion and pips SHALL never be the only cue.

#### Scenario: Low health
- **WHEN** health is 22
- **THEN** the biomonitor shows `22` beside the bar as well as its warning colour

### Requirement: Health in four segments
The health bar SHALL be split into four equal segments of 25 points, filled to the current health. At or below the low-health threshold (30) the bar SHALL take a warning colour.

#### Scenario: Health 60
- **WHEN** health is 60
- **THEN** two segments are full, the third is 40% full and the fourth is empty

#### Scenario: Crossing the threshold
- **WHEN** health falls from 31 to 29
- **THEN** the bar takes its warning colour

### Requirement: Damage leaves a chip trail
When health drops, the lost span SHALL stay visible as a pale chip for about 0.4 s and then drain down to the new health over about 0.5 s. A further hit while a chip is showing SHALL extend the same chip from where it now stands. The chip SHALL count only play time.

#### Scenario: One hit
- **WHEN** a hit takes health from 80 to 62
- **THEN** a pale chip covers 62 to 80, holds, and drains to 62 within about a second

#### Scenario: Paused mid-chip
- **WHEN** the pause menu opens while a chip is draining
- **THEN** the chip stays where it is until play resumes

### Requirement: Healing fills up with a delta
When health rises from a medkit or a revive, the bar SHALL fill from the old value to the new one over about 0.5 s, and a `+N` figure SHALL rise from the bar and fade.

#### Scenario: Medkit
- **WHEN** a medkit takes health from 40 to 65
- **THEN** the bar fills from 40 to 65 and `+25` rises and fades beside it

### Requirement: Heartbeat trace follows health
The biomonitor SHALL show a scrolling ECG trace and a BPM figure. The heart rate SHALL rise as health falls, and at or below the low-health threshold the trace SHALL take the warning colour and turn irregular. The trace SHALL advance only in play time.

#### Scenario: Full against low health
- **WHEN** health is 100 and later 20
- **THEN** the BPM figure and the beat rate at 20 are clearly higher than at 100, and the trace at 20 is in the warning colour

### Requirement: Stamina shows only while not full
A thin stamina bar SHALL show under the health bar while stamina is below full and fade out once it is full again. While the player is exhausted and cannot sprint, the bar and its label SHALL turn amber.

#### Scenario: Sprinting
- **WHEN** the player sprints from full stamina
- **THEN** the stamina bar fades in and drains

#### Scenario: Exhausted
- **WHEN** stamina runs out
- **THEN** the bar shows amber until sprinting is allowed again

### Requirement: Downed state inside the biomonitor
While the player is downed, the biomonitor SHALL replace its health bar with the bleed-out countdown in whole seconds, a prompt to wait for the medic and the revives left (when limited). No separate status box SHALL show.

#### Scenario: Going down
- **WHEN** the player is downed with 20 s of bleed-out and 1 revive left
- **THEN** the biomonitor shows the countdown from 20, the wait-for-the-medic line and `1` revive left

#### Scenario: Revived
- **WHEN** the medic revives the player
- **THEN** the biomonitor returns to the health bar and fills up to the revive health

### Requirement: Weapon panel shows rounds as pips
The weapon panel SHALL show the held weapon's name, a line-art silhouette, the loaded and reserve counts, and one pip per magazine slot: 12 for the pistol, 6 shell icons for the shotgun. Filled pips SHALL equal the loaded rounds. At a quarter of the magazine or less the count SHALL take a warning colour, and at zero the danger colour.

#### Scenario: Pistol after three shots
- **WHEN** the pistol has fired 3 of a full 12
- **THEN** 9 pips are filled, 3 are empty, and the panel reads `9` over the reserve

### Requirement: Firing and dry fire
Each shot SHALL blink its pip out. A dry fire SHALL flash the empty pip row in the danger colour and show `EMPTY` with the reload key.

#### Scenario: Trigger on an empty magazine
- **WHEN** the player fires with 0 loaded and rounds in reserve
- **THEN** the pip row flashes and `EMPTY · [R]` shows, with `R` replaced by the bound reload key

### Requirement: Reload refills the pips
A pistol reload SHALL clear the pips when the magazine leaves and refill them over the reload's length. A shotgun reload SHALL fill one shell icon each time a shell is inserted. The counts SHALL settle on the values the weapon reports when the reload ends, and a reload frozen by the pause SHALL freeze the refill.

#### Scenario: Shotgun with two shells loaded
- **WHEN** the player reloads the shotgun from 2 loaded
- **THEN** a shell icon fills with each inserted shell until 6, or until the reload is cancelled

### Requirement: Weapon swap and ammo pickup
Changing weapons SHALL switch the panel to the new weapon with a brief glitch transition. Picking up ammo for the held weapon SHALL show a rising `+N` beside the reserve count. Ammo for another weapon is announced by the pickup message alone.

#### Scenario: Ammo pickup
- **WHEN** the player holds the pistol and picks up 12 pistol rounds
- **THEN** the reserve count rises by 12 and `+12` rises and fades beside it

#### Scenario: Ammo for the other weapon
- **WHEN** the player holds the pistol and picks up shotgun shells
- **THEN** a pickup message names the shells and the pistol's counts stay as they are

### Requirement: Visor inertia
The panels SHALL shift a few pixels against camera turns, pitch and head bob and spring back to rest, at most 12 px from rest at 1080p. With Reduced motion on, the panels SHALL stay at rest.

#### Scenario: Quick turn
- **WHEN** the player flicks the view right
- **THEN** the panels lag left by a few pixels and settle back once the turn stops

#### Scenario: Reduced motion
- **WHEN** Reduced motion is on and the player turns
- **THEN** the panels do not move

### Requirement: Hits jolt the visor
A hit SHALL jolt the panel nearer the struck side and tear its signal for about 0.2 s, scaled by damage. When the hit carries no side, both panels SHALL jolt slightly. With Reduced flashing on, the tear SHALL not flicker; with Reduced motion on, the jolt SHALL not move the panel.

#### Scenario: Swipe from the left
- **WHEN** a swipe strikes the player's left side
- **THEN** the biomonitor panel jolts and tears, and the weapon panel barely reacts

### Requirement: Boot-up
The first time the panels appear in a session, and after a load or checkpoint restore, they SHALL boot up line by line over about 1 s. With Reduced flashing on, they SHALL fade in instead.

#### Scenario: Intro ends
- **WHEN** play begins after the intro
- **THEN** the rim brackets, then the panel frames, then their readouts come on in turn

### Requirement: Calm mode
With calm mode on, after about 6 s at full health, full stamina, a full magazine and no hit, shot, reload, sprint or weapon change, the panels SHALL dim to a faint level while keeping their numbers legible. Any of those events, or health or loaded rounds falling below full, SHALL bring them back at once. With calm mode off, the panels SHALL stay at full opacity.

#### Scenario: Idle exploration
- **WHEN** the player walks at full health with a full magazine for 6 s
- **THEN** the panels dim

#### Scenario: A creature attacks
- **WHEN** a hit lands on a dimmed HUD
- **THEN** both panels return to full opacity at once

### Requirement: HUD settings
The settings SHALL offer HUD opacity, HUD scale and calm mode (on by default). They SHALL apply at once and persist with the other settings.

#### Scenario: Scale change
- **WHEN** the player sets HUD scale to 125%
- **THEN** both panels and the rim draw 25% larger at once and keep that size next session
