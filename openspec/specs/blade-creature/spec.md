# blade-creature Specification

## Purpose

Defines how the four-armed blade creature looks and moves wherever it appears: its stance, gaits, jaw, belly arms, footing, blades, screams and hit shapes, and how it is reviewed.

## Requirements

### Requirement: One creature in every appearance
The creature SHALL use the same body, stance and motion in the Lab B drop, the R06 fight, Priya's death in R08, the R10 charge and pry, and the R11 fight. Its size MAY differ between appearances. Other characters and creatures SHALL look and move as before.

#### Scenario: Same creature, five rooms
- **WHEN** the creature appears in any of those five scenes
- **THEN** it stands, moves, screams and attacks as this capability describes

#### Scenario: Others are unchanged
- **WHEN** a crew member, a squadmate or a crowd infected is shown
- **THEN** their rig, poses and motion are the same as before

#### Scenario: Model fails to load
- **WHEN** the creature's model cannot be loaded
- **THEN** a stand-in body takes its place, one warning is logged, and every scene it is in still completes

### Requirement: It stands in its own stance
At rest the creature SHALL stand hunched forward on bent legs, its blade arms raised and forward of its body, ready to strike. It SHALL NOT stand upright with its blades hanging at its sides. The stance SHALL fit under the ceiling and through the doorways it uses.

#### Scenario: Standing still
- **WHEN** the creature stands idle for 1 s or more
- **THEN** its upper back leans forward at least 20 degrees, both knees are bent, and both blade tips are above knee height and ahead of its hips

### Requirement: It never moves like a person
The creature SHALL NOT play captured human motion or the human walk cycle, whether scripted or hunting, including when it gets up.

#### Scenario: Scripted walk
- **WHEN** a sequence walks the creature to a mark
- **THEN** it moves with its own gait and keeps its blades up

#### Scenario: Unfolding at the burst
- **WHEN** the creature unfolds out of Voss and stands
- **THEN** it rises in its own way into its stance, with no human get-up

### Requirement: Its feet meet the floor
While the creature has both legs, the lowest point of each planted foot SHALL stay within 3 cm of the floor under it, standing and moving.

#### Scenario: Standing
- **WHEN** the creature stands on level floor
- **THEN** neither foot is more than 3 cm below or above the floor

#### Scenario: Running
- **WHEN** the creature runs on level floor
- **THEN** no foot sinks more than 3 cm into the floor at any frame

### Requirement: Its steps match its speed
The creature SHALL prowl at walking speeds and charge at running speeds, changing smoothly between them. A planted foot SHALL NOT slide visibly, and a charge SHALL lean lower than the stance with the blades drawn back or thrust ahead.

#### Scenario: Planted foot at a charge
- **WHEN** the creature charges at 3.2 m/s or 7.2 m/s in a straight line
- **THEN** a planted foot moves less than 10 cm across the floor while it is planted

#### Scenario: Change of speed
- **WHEN** the creature goes from standing to a charge and back
- **THEN** no joint snaps by more than 30 degrees between two frames at 60 frames per second

#### Scenario: A kill that slows its steps
- **WHEN** a kill slows the creature's steps while it keeps its speed, as R08's rush does
- **THEN** it takes longer strides, and a planted foot still moves less than 10 cm while it is planted

### Requirement: Its body moves with its steps
The creature SHALL NOT glide. Its body SHALL rise and drop with each step, lift each swinging foot clear of the floor, and roll its hips over the planted leg. The charge SHALL move it far more violently than the prowl.

#### Scenario: Not gliding
- **WHEN** the creature prowls at 1.35 m/s or charges at 3.2 m/s or 7.2 m/s in a straight line
- **THEN** its pelvis rises and falls by at least 5 cm (prowl) or 8 cm (charge) each step, each swinging foot clears the floor by at least 10 cm (prowl) or 18 cm (charge), and its hips roll by at least 6 degrees from side to side

### Requirement: Its feet stay planted wherever it is
The creature's planted feet SHALL hold the floor while a scripted kill drives it and however far it is from the camera, not only near the camera in free movement.

#### Scenario: Priya's death, start to finish
- **WHEN** the creature walks R08's route at its scene speeds, from the surgery door through the rush, the carry and the walk back
- **THEN** a planted foot moves less than 10 cm while it is planted, and no foot sinks more than 3 cm into the floor

#### Scenario: Far down the R09 hall
- **WHEN** the creature charges up the R09 hall more than 10 m from the camera
- **THEN** its planted feet hold the floor as they do near the camera

### Requirement: It steps round when it turns
When the creature turns on the spot or turns sharply while slow, it SHALL step its feet round with the turn. It SHALL NOT pivot on still feet.

#### Scenario: Turning to stare
- **WHEN** the creature stops and turns 90 degrees to face the player
- **THEN** each foot lifts and is placed again at least once during the turn, and neither foot twists more than 30 degrees on the floor while planted

### Requirement: It gets going and settles
The creature SHALL build up into a gait over at least one step when it starts moving, and SHALL settle over at least one step when it stops, with no foot left mid-stride.

#### Scenario: Stopping from a charge
- **WHEN** the creature stops from a 3.2 m/s charge
- **THEN** it takes at least one settling step, and once stopped both feet are planted

### Requirement: Its jaw opens
The creature's lower jaw SHALL open and close on its own, without tearing the head. It SHALL open wide for a scream or a strike and hang slightly open at rest.

#### Scenario: Wide open
- **WHEN** the jaw opens fully
- **THEN** the lower jaw swings at least 30 degrees from closed, the skull stays still, and no triangle edge of 3 mm or longer stretches to more than 2.5 times its rest length

### Requirement: Its belly arms and spine are alive
The creature's small belly arms SHALL move on their own, twitching and grasping at rest and flaring during screams and strikes. They SHALL stay rooted in the torso.

#### Scenario: At rest
- **WHEN** the creature stands idle for 5 s
- **THEN** each belly hand moves at least 2 cm against the torso, and no belly arm leaves its root

#### Scenario: Screaming
- **WHEN** the creature screams
- **THEN** the belly arms spread wider than at rest

### Requirement: It screams where it can be seen
When the creature screams it SHALL coil, rear up with both blade arms raised, throw its head back and open its jaw wide, hold that shaking while the scream is loudest, and settle back to its stance or go into its next move. The performance SHALL last at least 2 s.

#### Scenario: A full scream
- **WHEN** a scream plays
- **THEN** within 0.8 s both blade tips are above its shoulders and its jaw is open at least 30 degrees, and it holds that for at least 1 s

#### Scenario: Skipped scene
- **WHEN** a scene with a scream is skipped
- **THEN** the creature is in the scene's end state with no scream left playing on it

### Requirement: Its strikes read as blade attacks
Windups, strikes, slams and grabs SHALL be made with the blade arms, with a windup the player can see before the blow lands. Attack timing, reach and damage SHALL stay as before.

#### Scenario: Swipe in the R06 fight
- **WHEN** the creature attacks Jay
- **THEN** a blade draws back before it swings through, and the blow lands at the same moment and range as before

### Requirement: Its blades stay out of the world
The blades SHALL NOT pass visibly through floors, walls, ceilings, glass or door frames. Forcing the R10 door and running a blade through a victim are the exceptions.

#### Scenario: Scripted scenes
- **WHEN** the Lab B pounding, Priya's death or the R10 charge plays
- **THEN** no point of either blade is more than 5 cm inside a floor, wall, ceiling, pane or door frame at any frame

#### Scenario: Through a doorway
- **WHEN** the creature walks through a doorway
- **THEN** it lowers or gathers its blades enough to pass

### Requirement: Losing limbs still works
Cutting the creature's limbs SHALL work as before. A severed forearm SHALL take its blade with it, and a creature without the use of its legs SHALL crawl or drag itself.

#### Scenario: Arm cut off
- **WHEN** a forearm is severed, by gunfire or by the R10 door
- **THEN** the forearm and its whole blade fall together, and the stump shows no stretched geometry

#### Scenario: Legs lost in R06
- **WHEN** the player takes the creature's legs
- **THEN** it keeps coming along the floor and the fight can be finished

### Requirement: Shots hit what is drawn
The creature's hit shapes SHALL follow its drawn body: its head, torso, legs, and the full length of both blade arms. A hit on a blade or forearm SHALL count as a hit on that forearm.

#### Scenario: Shot at the middle of a blade
- **WHEN** a shot passes through the middle of a drawn blade
- **THEN** it registers on that arm

#### Scenario: Shot past the body
- **WHEN** a shot passes more than 15 cm clear of everything drawn
- **THEN** it misses

#### Scenario: The fights stay winnable
- **WHEN** the R06 and R11 fights are simulated with the squad
- **THEN** both resolve as the encounter rules require

### Requirement: A sandbox shows the creature
A sandbox page SHALL show the creature at each of its sizes beside a 1.78 m figure. It SHALL let the viewer play each stance, gait, speed, attack and scream, open the jaw, show hit shapes and the floor, and pause, step a frame and play at 0.25x to 1x speed.

#### Scenario: Judging the scream
- **WHEN** the viewer plays the scream and steps through it
- **THEN** each phase can be seen from any angle, with the jaw, blades and belly arms visible
