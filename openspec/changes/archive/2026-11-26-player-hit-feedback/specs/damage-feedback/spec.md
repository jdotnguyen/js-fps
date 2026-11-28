# Spec Delta

## Purpose

How the player perceives being hit: camera, aim, weapon, screen marks, voice and impact sound, each following the kind, side and size of the attack so a hit reads as a blow from somewhere and not only as a lower health number.

## ADDED Requirements

### Requirement: A hit knows what struck the player
Every enemy hit on the player SHALL carry its attack kind (swipe, bite, slam or grab) and, for a swipe, the arm that struck. The response SHALL follow the side of the view that arm comes from, as the player sees it. Hits from scripts or hazards without a kind SHALL get a generic hit response.

#### Scenario: Swipe from a facing creature's right arm
- **WHEN** a creature facing the player connects with a right-arm swipe
- **THEN** the player's hit response is the swipe response for a strike from the left of the view, where that arm is seen

#### Scenario: Swipe from behind
- **WHEN** a creature behind the player connects with a right-arm swipe
- **THEN** the player's hit response is the swipe response for a strike from the right of the view

#### Scenario: Scripted damage
- **WHEN** a script damages the player without naming an attack
- **THEN** the generic hit response plays and nothing fails

### Requirement: The camera flinches by attack kind
A hit SHALL jolt the view with a motion that depends on the attack: a swipe rolls and turns the view away from the striking arm, a bite pitches it forward and down, a slam dips it and shakes it briefly, and a grab tick makes a small tremor. The jolt SHALL grow with damage and settle within about 0.4 s.

#### Scenario: Swipe from the left
- **WHEN** a swipe from the left of the view hits the player
- **THEN** the view rolls and turns to the right, away from the arm, and is level again within about 0.4 s

#### Scenario: Bigger hits flinch harder
- **WHEN** the player takes a 25-point hit and later an 8-point hit of the same kind
- **THEN** the 25-point hit moves the view visibly further

### Requirement: A hit punches the aim and the aim springs back
A hit SHALL throw the player's aim off by a small amount in the direction of the flinch, and the aim SHALL return most of the way to where it was within about 0.4 s. A hit SHALL NOT leave a lasting turn of more than about 0.3 degrees.

#### Scenario: Aim after a swipe
- **WHEN** the player holds the crosshair on a target and takes a swipe
- **THEN** the crosshair is knocked off the target and comes back to within about 0.3 degrees of it without the player moving the mouse

### Requirement: Reduced motion softens hit motion
With Reduced motion on, the flinch, the aim punch and the weapon knock SHALL each be at most about a third of their full size. The screen marks, flash and sounds SHALL be unchanged.

#### Scenario: Reduced motion on
- **WHEN** Reduced motion is on and the player takes a swipe
- **THEN** the view and the aim move about a third as far as with it off, and the claw marks still show

### Requirement: The held weapon is knocked by a hit
A hit SHALL knock the held weapon off its rest pose, towards the side the blow came from, and the weapon SHALL settle back within about 0.4 s. Firing SHALL keep working during the knock.

#### Scenario: Knocked while aiming
- **WHEN** the player is aiming down sights and takes a bite
- **THEN** the weapon jolts out of its aim pose and returns to it, and a shot fired during the jolt still fires

### Requirement: Claw marks show on the struck side
A swipe SHALL draw claw streaks on the side of the screen it came from, running along the swing of the arm. A bite SHALL leave a smear, and a slam SHALL leave a crush mark along the bottom edge. Each mark SHALL draw on within about 0.1 s, hold briefly, then fade out within about 1.5 s of the hit.

#### Scenario: Swipe from the right
- **WHEN** a swipe from the right of the view hits the player
- **THEN** streaks appear on the right part of the screen along the swing, then fade and are gone within about 1.5 s

#### Scenario: Mark kinds differ
- **WHEN** the player is hit by a bite and later by a slam
- **THEN** the bite leaves a smear and the slam a mark along the bottom edge, and neither looks like swipe streaks

### Requirement: Claw marks stay readable
Marks SHALL keep the centre of the screen around the crosshair clear. At most three marks SHALL show at once; a new hit beyond that SHALL replace the oldest. Marks SHALL get stronger with damage, and consecutive marks SHALL vary in shape and placement.

#### Scenario: Flurry of hits
- **WHEN** the player takes five swipes within two seconds
- **THEN** no more than three marks show at any moment, no two consecutive marks are identical, and the crosshair area stays clear

### Requirement: Marks and flash clear when play stops
On death, restart, loading a save or leaving to the title, all claw marks and the hit flash SHALL clear at once. Pausing SHALL hold them as they are.

#### Scenario: Restart after a hit
- **WHEN** the player takes a hit and restarts from the checkpoint within a second
- **THEN** the restarted view shows no claw marks or hit flash

### Requirement: Jay reacts aloud to a hit
A hit SHALL play a pain reaction in Jay's voice, chosen by hit size: a sharp breath for a small hit, a grunt for a medium hit, a heavy cry for a big hit or the hit that downs him. Reactions SHALL be at least about 1 s apart, a bigger hit SHALL be able to cut off a smaller reaction, and the same take SHALL NOT play twice in a row. Reactions SHALL show no subtitle.

#### Scenario: Flurry of small hits
- **WHEN** the player takes four small hits within one second
- **THEN** Jay makes one reaction, not four

#### Scenario: Big hit after a small one
- **WHEN** a small hit's breath is playing and a big hit lands
- **THEN** the breath stops and a heavy cry plays

#### Scenario: No subtitle
- **WHEN** Jay reacts to a hit with subtitles on
- **THEN** no subtitle line appears for the reaction

### Requirement: Jay's hit reactions match his voice
Every pain reaction and low-health breath SHALL come from Jay's own cast voice and model, so they sound like the same person as his dialogue.

#### Scenario: New takes
- **WHEN** new pain reactions are generated for Jay
- **THEN** they use his pinned voice and model, and each tier has several takes to pick from

### Requirement: A hit sounds like it lands on the player
A hit SHALL play an impact sound on the player that matches the attack: claw on cloth and skin for a swipe, a wet crunch for a bite, a heavy body thud for a slam. The impact SHALL play at the moment of the hit, not after the voice reaction, and SHALL vary from hit to hit.

#### Scenario: Swipe impact
- **WHEN** a swipe hits the player
- **THEN** a claw impact plays at once, before Jay's reaction

### Requirement: Low health is heard as well as seen
At low health, a heartbeat and Jay's heavier breathing SHALL play under the mix and fade out when health recovers above the low-health line or the player is downed.

#### Scenario: Healing out of low health
- **WHEN** the player is at low health and uses a medkit that takes them above the low-health line
- **THEN** the heartbeat and heavy breathing fade out
