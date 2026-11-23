# Spec Delta

## Purpose

Defines how the first-person pistol and shotgun look and play: whose models they are, how the hands sit on screen, how the rest pose behaves, and how reload and pump timing follow the animations.

## ADDED Requirements

### Requirement: The weapon models are credited and commercially usable
The first-person pistol SHALL be "AnimatedPistol" and the first-person shotgun "Animated Shotgun", both by JUST (sketchfab.com/teenjust500) and used under CC BY 4.0. Both SHALL be credited in the game's credits with author, link and licence. The game SHALL NOT ship a first-person weapon model under a non-commercial licence.

#### Scenario: Credits list both models
- **WHEN** the player opens the credits
- **THEN** the pistol and the shotgun are each listed with "JUST", the model page and "CC BY 4.0"

#### Scenario: No non-commercial weapon models
- **WHEN** the shipped weapon assets are checked against `CREDITS.md`
- **THEN** none of the first-person weapon models is listed as CC BY-NC

### Requirement: Both weapons share one pair of hands
The pistol and the shotgun SHALL show the same sleeves and gloves, so switching weapons never changes what the hands look like.

#### Scenario: Switching weapons
- **WHEN** the player switches from the pistol to the shotgun
- **THEN** the arm that comes up has the same sleeve and glove as the one that went down

### Requirement: No hand or forearm floats in view
Each weapon SHALL sit close to the camera, with both sleeves entering the screen through its bottom or side edge. No forearm start, cuff or loose hand SHALL be visible apart from the gun, in the rest pose or in any animation, at every supported aspect ratio and field of view.

#### Scenario: Widescreen and narrow windows
- **WHEN** either weapon is drawn at rest at 16:9, 21:9 and 4:3, at the lowest and highest field-of-view settings
- **THEN** in each case both arms run off the bottom or side edge of the screen and no arm end or loose hand is visible

#### Scenario: Aiming, sprinting and reloading
- **WHEN** the player aims, sprints, jumps or reloads with either weapon
- **THEN** no arm end or loose hand comes into view at any moment

### Requirement: The rest pose is never frozen
With a weapon drawn and nothing else playing, the hands and gun SHALL move by a small, slow breathing motion. The motion SHALL be small enough not to disturb aiming, and SHALL be off when reduced motion is set.

#### Scenario: Standing still
- **WHEN** the player stands still with a weapon drawn for 5 seconds
- **THEN** the weapon drifts gently and never sits perfectly still

#### Scenario: Reduced motion
- **WHEN** reduced motion is on and the player stands still with a weapon drawn
- **THEN** the weapon does not breathe

### Requirement: The pistol reloads in one motion at its authored speed
The pistol SHALL reload by playing its reload animation at normal speed, 3.7 s, whether the magazine is empty or not. Rounds SHALL be added when the animation ends, and the player SHALL NOT be able to fire during it. The magazine-out, magazine-in and slide sounds SHALL land within 0.1 s of the matching movement.

#### Scenario: Partial magazine
- **WHEN** the player reloads the pistol with 4 rounds left
- **THEN** the reload lasts about 3.7 s, the magazine sounds land with the visible magazine movement, and the pistol is full when it ends

#### Scenario: Empty magazine
- **WHEN** the player reloads an empty pistol
- **THEN** the same reload plays at the same speed and the pistol is full when it ends

#### Scenario: Interrupting by switching
- **WHEN** the player switches weapon during the reload
- **THEN** the reload is cancelled and no rounds are added

### Requirement: The shotgun fires, pumps and reloads shell by shell
Firing the shotgun SHALL play one animation that includes the pump, and the spent hull SHALL leave on the pump motion, not on the shot. Reloading SHALL play an opening motion, then one loading motion per shell with the shell added on each, then a closing motion that racks the pump. Firing SHALL interrupt a reload at once when at least one shell is loaded, and the shells already loaded SHALL stay.

#### Scenario: Firing
- **WHEN** the player fires the shotgun
- **THEN** the recoil and the pump rack play as one motion and the hull is ejected as the pump moves

#### Scenario: Loading three shells
- **WHEN** the player reloads the shotgun with three shells missing and does not interrupt
- **THEN** the opening motion plays, three shells go in one at a time, the pump is racked, and the shotgun is full

#### Scenario: Firing mid-reload
- **WHEN** the shotgun has one or more shells loaded and the player fires while it is reloading
- **THEN** the reload ends at once, the shot is fired, and the shells already loaded stay in the gun

#### Scenario: Firing mid-reload with an empty gun
- **WHEN** the shotgun is empty and the player fires before the first shell is in
- **THEN** the reload continues and no shot is fired

### Requirement: Ambient occlusion never shades the first-person weapons
The first-person pistol and shotgun, with their hands, SHALL NOT be darkened, streaked or patterned by screen-space ambient occlusion, and SHALL NOT feed it. On High they SHALL look as they do on Medium, in dark and in red-lit rooms alike, and level geometry SHALL still hide them as before.

#### Scenario: High and Medium look the same
- **WHEN** the pistol is drawn in a dark, red-lit room and quality is switched between High and Medium
- **THEN** the gun and gloves look the same on both, with no streaks or repeating pattern sliding across them as the view turns

#### Scenario: A wall still hides the weapon
- **WHEN** the player stands with a weapon drawn so close to a wall that part of it passes through the wall, on High
- **THEN** the part inside the wall is hidden, as it is on Medium
