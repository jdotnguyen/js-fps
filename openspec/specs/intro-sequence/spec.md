# intro-sequence Specification

## Purpose

The new-game intro: a real-time, first-person scene on rails, played once. Jay checks the morning crew through the dock and walks with Giles and Okafor to the Commons kitchen, where Priya hands him a coffee. It exists to make the player like these people, with only a few small hints that something is off.

## Requirements

### Requirement: Intro plays once on a new game
Starting a new game on a level that has the intro SHALL play `intro_shift_change` before giving the player control. Loading a save, restarting after death, or starting a level without the intro SHALL NOT play it.

#### Scenario: New game
- **WHEN** the player starts a new game on slice01 at any difficulty
- **THEN** the intro plays from the start

#### Scenario: Load or restart
- **WHEN** the player loads a save or restarts after death
- **THEN** the intro does not play

#### Scenario: Level without the intro
- **WHEN** a new game starts on a level that has no `post_front` anchor
- **THEN** play starts directly with the player in control

### Requirement: Opening on the dock
The intro SHALL fade in from black on the Docking Ring with the main theme playing and a caption naming the station, "Docking Ring" and the 06:40 shift change. The view SHALL be framed on the dock window while the supply sub Halcyon docks and clamps on. A PA chime and line SHALL announce the docking before the airlock opens. The main theme SHALL stop before the first arrival speaks.

#### Scenario: Sub docks
- **WHEN** the intro starts
- **THEN** the view is framed on `dock_window` while the sub docks, then the PA announces the Halcyon and the airlock opens

#### Scenario: Theme gives way
- **WHEN** the PA announcement plays
- **THEN** the main theme stops, and no score plays for the rest of the intro

### Requirement: Crew arrivals pass the checkpoint
Ruiz and Sung SHALL come off the sub together. Ruiz goes first and Sung queues behind her. Each SHALL stop at the counter in front of Jay for one exchange, then walk through the arch. Sung steps up and talks while Ruiz is being scanned, and the airlock cycles for the squad as soon as Sung leaves the counter. Ruiz SHALL get a full wand scan and Sung a quick pass. Both SHALL then walk on to their own spots in the Commons.

#### Scenario: Queue order
- **WHEN** the airlock opens for the crew
- **THEN** Ruiz stops at the counter while Sung waits in the queue spot behind her, and Sung steps up only after Ruiz moves on

#### Scenario: Ruiz is scanned
- **WHEN** Ruiz reaches the guard past the arch
- **THEN** she gets a full wand scan with a pass before walking to the Commons

#### Scenario: Sung passes quickly
- **WHEN** Sung walks through the arch
- **THEN** the arch shows a pass and she walks on without a wand scan

### Requirement: Squad arrival through the checkpoint
After the crew, the airlock SHALL cycle and Okafor and Giles SHALL come through one at a time. Each badges in with Jay at the counter, then walks through the arch. Okafor SHALL pass cleanly. Giles SHALL set the arch off with his multitool, which happens every morning: the guard sighs, Okafor gets a dry line, and the beat stays warm, with no hint of illness. Both SHALL then wait on the station side near the booth's open side.

#### Scenario: One at a time
- **WHEN** Okafor and Giles arrive
- **THEN** they reach the counter and the arch one after the other, never side by side

#### Scenario: Giles sets off the arch
- **WHEN** Giles walks through the arch
- **THEN** the arch alarms, the guard and Okafor each react with a line, and Giles walks on to the station side

#### Scenario: Banter on the station side
- **WHEN** both squadmates have passed the arch
- **THEN** their banter with Jay plays while they stand on the station side, ending with Okafor's call to go to the kitchen

### Requirement: Speaker shots at the post and in the kitchen
While Jay stands at his post, and from when he walks into the Commons, the view SHALL ease to each speaker who has a body as their line starts, taking about 0.6–1.0 s. Jay's own lines and speakers without a body SHALL keep the current shot.

#### Scenario: Okafor speaks
- **WHEN** Okafor's line starts while Jay is at the post
- **THEN** the view eases to Okafor

#### Scenario: Jay speaks
- **WHEN** Jay's line starts
- **THEN** the view stays where it is

### Requirement: Mouse give on framed shots
During a framed or speaker shot, the mouse SHALL push the view at most 6° off the scripted aim. The view SHALL spring back softly, in about 0.4 s, when the mouse stops.

#### Scenario: Pushing against a shot
- **WHEN** the player moves the mouse hard during a framed shot
- **THEN** the view moves no more than 6° off the aim and returns to it once the mouse is still

### Requirement: Walk to the kitchen on rails
When Jay leaves the booth, he SHALL walk on rails from his post to the kitchen in R02, leaving by the booth's open side. Giles and Okafor walk ahead to the kitchen counter. During the walk, the quarantine PA SHALL play over the squad's banter, Giles SHALL rub his forearm, and Okafor SHALL ask about it.

#### Scenario: The walk
- **WHEN** Okafor's kitchen line ends
- **THEN** Jay walks on rails from `post_front` to `kitchen_stand`, and the squad arrives at the counter

#### Scenario: Blocked walk
- **WHEN** Jay's walk is blocked and he has not arrived within the walk's timeout
- **THEN** he is placed at `kitchen_stand` and the intro continues

#### Scenario: PA over the banter
- **WHEN** the quarantine PA plays during the walk
- **THEN** it plays at once over the squad's lines, and both subtitles show together with the PA above

### Requirement: Heading shot on the walk
As Jay leaves the booth, the speaker shot SHALL end. From there until Jay walks into the Commons, the view SHALL face a point a little ahead along Jay's route at eye height and turn smoothly with the route. The mouse SHALL push the view up to about 35° sideways and 26° vertically. The view SHALL hold for about 0.5 s after the mouse stops, then settle back over about 1 s.

#### Scenario: Facing where the rails go
- **WHEN** Jay walks the route's turn into the Commons without touching the mouse
- **THEN** the view turns with the route and stays facing ahead

#### Scenario: Looking around
- **WHEN** the player pushes the mouse to look at a speaker beside the route
- **THEN** the view moves up to the leeway limit and does not snap to the speaker

#### Scenario: Letting go
- **WHEN** the player stops moving the mouse after looking aside
- **THEN** the view holds for about 0.5 s, then settles back to facing ahead

#### Scenario: Speakers do not steer the walk view
- **WHEN** a squadmate's line starts during the walk
- **THEN** the view does not turn to them

### Requirement: Kitchen scene
In the kitchen, Bram greets the squad, Priya comes in, sends Okafor to sit and teases Giles, and Jay asks about Giles's daughter Mara. The squad wait at the counter until Jay walks into the Commons, and Bram's greeting starts then. From the moment Jay comes through the Commons door, the view SHALL turn to whoever speaks first, Bram, Okafor or Giles, then follow each speaker in turn, Priya included, as speaker shots. The TAG FM radio SHALL start when Jay reaches the kitchen.

#### Scenario: Walking in
- **WHEN** Jay comes through the Commons door
- **THEN** the view stops facing along the route, and turns to the next person who speaks

#### Scenario: Bram greets as Jay walks in
- **WHEN** the squad reach the counter before Jay is in the Commons
- **THEN** Bram's greeting waits until Jay walks in, so the first line lands as he enters

#### Scenario: Priya walks in
- **WHEN** Priya enters the kitchen
- **THEN** the view turns to her, and then follows whoever speaks

#### Scenario: Radio
- **WHEN** Jay arrives at `kitchen_stand`
- **THEN** the TAG FM radio starts playing in the Commons

### Requirement: Bram serves the squad
Bram SHALL already be making coffee when Giles and Okafor come in. They SHALL walk round him and settle back against the counter, turned toward each other. Bram SHALL hand Okafor a mug beside him, then go round to Giles's far side, so Jay sees the hand-off side-on, before going back to his station.

#### Scenario: Coffee for the squad
- **WHEN** the squad are at the counter and Bram's greeting is done
- **THEN** Bram hands Okafor a mug, then Giles from Giles's far side, and both hold their mugs, leaning back against the counter

### Requirement: Coffee hand-off
The intro's last beat SHALL be a framed shot of Priya holding out a mug, with a "Take coffee" interact prompt. Taking the mug, or waiting 6 s, SHALL end the hand-off with the mug in Jay's hand. Priya then leaves for the medical bay after a closing exchange.

#### Scenario: Taking the coffee
- **WHEN** the player presses interact on the prompt
- **THEN** the mug moves to Jay's hand and the closing lines play

#### Scenario: Ignoring the prompt
- **WHEN** the player does nothing for 6 s
- **THEN** the hand-off ends by itself with the mug in Jay's hand

### Requirement: End of the intro
When the intro ends, control SHALL return in the Commons, the `cp_intro` checkpoint SHALL save, and these flags SHALL be set: `introSeen`, `pa_quarantine_played`, `giles_forearm_seen`, `mara_mentioned`, `priya_met`, and `radio_place` = `commons`. The morning briefing is a separate sequence and SHALL NOT start as part of the intro.

#### Scenario: Watched to the end
- **WHEN** the intro finishes
- **THEN** the player has control in the Commons, `cp_intro` is saved, and all of the listed flags are set

### Requirement: Letterbox bars while on rails
Black bars SHALL show at the top and bottom of the screen, each 11% of viewport height, whenever a sequence is running and the player is on rails (movement locked, or a scripted walk active). They SHALL fade in and out over 0.6 s, or crossfade in 0.15 s with reduced motion. Saving SHALL be disabled while on rails.

#### Scenario: Scripted walk
- **WHEN** a sequence starts a scripted walk for Jay
- **THEN** the bars fade in, and they fade out when he has control again

#### Scenario: Grabbed by an enemy
- **WHEN** an enemy grab locks Jay's movement outside any sequence
- **THEN** no bars show

#### Scenario: Slow walk is not on rails
- **WHEN** a sequence slows Jay down but leaves him in control of movement
- **THEN** no bars show, because bars mean Jay cannot move

### Requirement: Walk motion and reduced motion
Scripted walks SHALL have head bob and a faint roll sway of about 0.25°. With reduced motion on, bob and sway SHALL be off and scripted turns, including the heading shot's turns, SHALL ease more slowly.

#### Scenario: Reduced motion
- **WHEN** reduced motion is on and Jay walks on rails
- **THEN** the view has no bob or sway, and turns follow the route more slowly

### Requirement: Hold to skip
The intro SHALL be skippable by holding `skipCutscene` (default Space or Enter, remappable) for `skipHoldSeconds` (default 3, range 1.5–6). Releasing early SHALL drain the bar at 3x speed. A hint naming the current binding SHALL show for 4 s at the start and again on any input. With skip assist on, one press SHALL start the bar, and a second press or Esc cancels it.

#### Scenario: Hold
- **WHEN** the player holds the skip key for the full hold time
- **THEN** the screen fades to black over 0.4 s, the intro jumps to its end state, and it fades back in over 0.5 s

#### Scenario: Released early
- **WHEN** the player releases the skip key before the bar is full
- **THEN** the bar drains at 3x speed and the intro continues

#### Scenario: Escape and the mouse do not skip
- **WHEN** the player presses Escape or clicks during the intro
- **THEN** the skip bar does not start

#### Scenario: Accessible bar
- **WHEN** the skip bar is filling
- **THEN** it is exposed as a progress bar with its current value, announces "Skipping" when full, and does not rely on colour alone

### Requirement: Skip ends in the watched end state
Skipping at any point SHALL leave the same state as watching to the end: positions, flags, checkpoint, lines marked as played, and the mug in Jay's hand. Skipping the intro SHALL NOT skip the briefing.

#### Scenario: Skip during a scan
- **WHEN** the intro is skipped while the guard is scanning someone
- **THEN** the end state matches a full watch, with the guard back at his post

#### Scenario: Skip mid-walk
- **WHEN** the intro is skipped during the walk to the kitchen
- **THEN** the end state matches a full watch

#### Scenario: Skip during the hand-off
- **WHEN** the intro is skipped while Priya is holding out the mug
- **THEN** the mug ends in Jay's hand, Priya ends at her exit spot, and the view is released facing where the shot was aimed

#### Scenario: Briefing after a skip
- **WHEN** the intro is skipped
- **THEN** the briefing still plays when it would normally start, and can be skipped on its own

### Requirement: Jay speaks without choices
Jay SHALL speak in the intro, labelled "Jay" in subtitles. The intro SHALL offer no dialogue choices.

#### Scenario: Jay's lines
- **WHEN** one of Jay's lines plays
- **THEN** its subtitle shows the label "Jay" and no choice prompt appears
