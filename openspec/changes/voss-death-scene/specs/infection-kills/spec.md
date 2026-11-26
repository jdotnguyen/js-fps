# Spec Delta

## MODIFIED Requirements

### Requirement: Beats follow their audio, with a time limit
A beat tied to a line or sound SHALL end when that audio ends. A beat SHALL also end after its time limit, so a missing or
failed recording never stops the kill. A beat SHALL instead be able to run a fixed length, ending at that length whether
its line or sound is shorter, longer or missing.

#### Scenario: Scream drives the arch
- **WHEN** a kill's beat waits on the victim's first scream, and the scream ends
- **THEN** the next beat begins

#### Scenario: Fixed beat ignores its audio
- **WHEN** the Lab B glass beat plays while Voss's scream is still sounding at the end of the beat's fixed length
- **THEN** the arch beat begins at that fixed length, and the scream plays on into the arch

#### Scenario: Missing recording
- **WHEN** a recording a beat waits for is missing
- **THEN** the beat ends at its time limit and the kill carries on to the next beat

### Requirement: A clip moves the body off the floor in place
While a beat plays a clip, the victim SHALL stay where the kill placed her and keep her facing at the start of the beat, unless the beat carries her along a route. Her body SHALL rise and fall with the clip, with no part of her body sinking into the floor and no pop at the start or end of the clip.

#### Scenario: Getting up from the floor
- **WHEN** a get-up clip plays on a victim lying on the floor
- **THEN** her hips rise from floor height to standing height and her feet end on the floor where she lay

#### Scenario: A route beat moves her
- **WHEN** a beat that names a route plays a clip
- **THEN** she travels along the route instead of staying where the beat started

## ADDED Requirements

### Requirement: The Lab B kill runs on a fixed clock
From the moment Okafor's question ends, each beat of the Lab B kill from panic to the end of still SHALL begin at the same
time on every run, about 13 s in all. The squad's arrival, the frame rate, the physics settings and missing recordings
SHALL NOT move any beat, event, prop cue or sound.

#### Scenario: Different arrivals
- **WHEN** the drop runs once with the squad close behind Jay and once with them far behind
- **THEN** in both runs every beat from panic on begins at the same time after Okafor's question ends, to within one frame

#### Scenario: Different frame rates
- **WHEN** the kill runs once at 30 fps and once at 144 fps
- **THEN** each beat and each authored event happens at the same time after Okafor's question ends, to within one frame of the slower run

#### Scenario: Scream missing
- **WHEN** the scream recording is missing
- **THEN** the arch, burst and still beats begin at the same times as when it plays

### Requirement: A clip beat can carry the victim along a route
A beat SHALL be able to name a route of marks, each with the beat time at which she reaches it. While it plays she SHALL
travel along the route and reach each mark at its time, wherever her clip would have taken her. She SHALL never be placed
instantly at a new position, except by a skip or a restore.

#### Scenario: On her marks
- **WHEN** a route beat says she reaches a mark 2.0 s into the beat
- **THEN** her hips are within 0.1 m of that mark, measured across the floor, 2.0 s into the beat

#### Scenario: No snap
- **WHEN** her position is sampled every frame of a route beat that is not skipped
- **THEN** it never moves more than 0.15 m between two frames at 60 fps

#### Scenario: Clip missing
- **WHEN** a route beat names a clip her body does not have
- **THEN** she still travels the route on time with the beat's authored poses, and a warning is logged once

### Requirement: Her feet stay planted while a kill moves her
While a kill beat moves the victim across the floor, a foot in contact with the floor SHALL stay where it landed until it
lifts, and SHALL NOT slide or sink. Each time a foot lands, a footstep SHALL play from that foot, suited to the floor, and
heard as any other footstep.

#### Scenario: Planted foot
- **WHEN** her foot is in contact with the floor during the staged run
- **THEN** it moves less than 3 cm until it lifts, and its sole stays within 2 cm of the floor

#### Scenario: Footsteps heard
- **WHEN** her feet land during the staged run
- **THEN** one footstep plays from each landing foot, at the moment it lands

### Requirement: Voss's staged run to the glass
In the Lab B kill's panic beat, Voss SHALL be thrown forward by a jolt from inside into the bench beside her, sweep it
clear, double over, push off, stumble and nearly go down, recover, grab the prep cart, drag it over and reach the glass.
Where she touches the bench, the cart or the floor, her hand, hip or knee SHALL meet that surface.

#### Scenario: The actions in order
- **WHEN** the panic beat plays
- **THEN** she hits the bench, sweeps it, doubles over, pushes off, stumbles, recovers, grabs the cart, pulls it over and reaches the glass, in that order

#### Scenario: Contacts touch
- **WHEN** her hand or hip strikes the bench, her hand takes hold of the cart, or her knee nearly touches down
- **THEN** that part of her is within 5 cm of the surface at the moment of contact and does not pass through it

#### Scenario: Nothing walked through
- **WHEN** her body is sampled at every frame of the panic beat
- **THEN** no part of her passes through the bench, the gurney, the cart or the glass

### Requirement: A kill victim's scream moves her jaw with its loudness
While a kill's victim screams a recorded line, her jaw SHALL open with the recording's loudness: wider when it is louder
and almost closed in its gaps and breaths, with a fast tremble at its loudest. Without a recording, the scream SHALL play
the usual open-mouthed scream.

#### Scenario: Peak of the scream
- **WHEN** Voss's scream is at its loudest
- **THEN** her jaw is at least 80% of its widest and trembles

#### Scenario: A breath in the scream
- **WHEN** the scream's loudness falls below a fifth of its peak for more than 0.15 s
- **THEN** her jaw closes to less than 30% of its widest within 0.1 s

#### Scenario: No recording
- **WHEN** the scream recording is missing
- **THEN** her jaw holds the usual scream opening for the line

### Requirement: Voss collapses down the pane
After the burst, Voss's knees SHALL give and she SHALL slide down the pane, then crumple to the floor beside the glass.
She SHALL end clear of the spot the creature stands on, and a restored or skipped kill SHALL leave her in the same place.

#### Scenario: Down the pane
- **WHEN** the still beat plays
- **THEN** her chest or shoulder stays within 5 cm of the pane as she slides down it, and no joint of hers crosses the pane

#### Scenario: Room for the creature
- **WHEN** the creature stands to pound on the glass after the kill
- **THEN** no part of Voss's body is within 0.3 m of its feet

#### Scenario: Restored in place
- **WHEN** the drop is restored from a checkpoint taken after the kill
- **THEN** Voss lies where a played kill leaves her, her hips within 5 cm of that spot
