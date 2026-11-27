# infection-kills Specification

## Purpose

Defines how a scripted infected death plays on camera: the kinds of kill, how the victim's body, voice, blood and sound
stay in step, and how the player can still see the victim while the gore covers the hand-off to the creature.

## Requirements

### Requirement: Three kinds of infected kill
A scripted kill SHALL name its kind: `grownInside`, `converted` or `mauled`. A `grownInside` kill SHALL leave the victim's own body as
a corpse and bring in a separate creature body. A `converted` kill SHALL turn the victim's body into an infected enemy. A
`mauled` kill SHALL have a creature that is already present kill the victim by hand, leaving her body as a corpse.

#### Scenario: Grown inside
- **WHEN** a `grownInside` kill finishes on a victim
- **THEN** the victim's body lies dead where it fell with a torn chest
- **AND** a creature body stands nearby and acts as an enemy

#### Scenario: Converted
- **WHEN** a `converted` kill finishes on a victim
- **THEN** the victim's own body is infected and acts as an enemy
- **AND** no separate creature body is spawned

#### Scenario: Mauled
- **WHEN** a `mauled` kill finishes on a victim
- **THEN** the victim's body lies dead where the attacker left it
- **AND** the attacker is the only creature body involved, and no creature comes out of the victim

### Requirement: The victim's body never visibly deforms into the creature
During a `grownInside` kill, the victim's body SHALL keep its human shape except for movement under the skin and the
chest tear. The creature SHALL first appear at the victim's chest during the burst.

#### Scenario: No stretched limbs
- **WHEN** a `grownInside` kill is at any beat before the burst
- **THEN** the victim's hands and forearms keep their rest-pose lengths

#### Scenario: Creature appears at the burst
- **WHEN** the burst beat starts
- **THEN** the creature body becomes visible at the victim's chest within the same second

### Requirement: Kill beats play in order
A `grownInside` kill SHALL play these beats in order: scratch, panic, glass (only if the victim faces a glass partition),
arch, burst, still, creature. The sequence SHALL be able to start other steps when each beat begins.

#### Scenario: Beat order
- **WHEN** the Lab B kill runs from start to end
- **THEN** the beats begin in the order scratch, panic, glass, arch, burst, still, creature

#### Scenario: Script reacts to a beat
- **WHEN** the burst beat begins
- **THEN** a sequence step waiting on that beat runs within the same frame

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

### Requirement: Convulsion builds to the burst
The victim's convulsion SHALL be weakest at the scratch beat, rise through panic and arch, peak at the burst, and stop at
the still beat apart from at most two death twitches.

#### Scenario: Peak at the burst
- **WHEN** the convulsion strength is sampled at each beat
- **THEN** it is higher at arch than at panic, highest at burst, and zero during most of the still beat

#### Scenario: Bone crunch is seen
- **WHEN** a bone-crunch sound plays during the arch beat
- **THEN** the victim's spine, chest or neck jerks at the same moment

### Requirement: Movement under the skin
Before the burst, something SHALL visibly move under the victim's skin. It starts on one forearm during scratch and reaches
the chest by the arch beat. This SHALL work on any imported body model.

#### Scenario: Forearm crawl
- **WHEN** the scratch beat plays
- **THEN** a bulge moves along the victim's forearm towards the elbow

#### Scenario: Chest push
- **WHEN** the arch beat plays
- **THEN** the victim's chest swells outward from inside before the burst

### Requirement: Heavy blood that keeps the victim visible
The burst SHALL throw blood spray, flesh chunks and a growing floor pool. Blood on a glass partition between the player and
the victim SHALL run down the glass, and no splatter SHALL stay in the band from the victim's chest to head height.

#### Scenario: Blood stops on the glass
- **WHEN** blood from the burst reaches the Lab B glass
- **THEN** it stays on the gallery side of the room's interior, sticks to the glass, and runs down

#### Scenario: Clear view band
- **WHEN** the player looks through the Lab B glass from the gallery during the still beat
- **THEN** no blood splatter covers the glass between 1.1 m and 1.8 m above the floor

#### Scenario: Reduced gore
- **WHEN** the gore setting is reduced
- **THEN** the kill still plays every beat, with dark blood and fewer chunks

### Requirement: Blood reads red under the alarm light
From the glass beat to the still beat, a white light SHALL stay on the victim, so blood shows as red and not black while
the room's alarm lighting is on.

#### Scenario: Under the emergency tint
- **WHEN** the Lab B alarm lighting is on during the burst
- **THEN** the victim is still lit by a steady white light

### Requirement: Body sounds for the kill
A `grownInside` kill SHALL play recorded sounds for bone crunches, the flesh tearing, the burst, blood hitting glass and the
floor, and the creature. Each sound SHALL be played by name, and crunches and glass splats SHALL each have several variants.

#### Scenario: Repeated crunches differ
- **WHEN** three bone crunches play in the arch beat
- **THEN** no two of them in a row use the same recording

#### Scenario: Recording not yet generated
- **WHEN** a kill sound's recording does not exist
- **THEN** the kill plays without it and one warning names the missing sound

### Requirement: The creature stays behind the glass until it breaks out
After a `grownInside` kill behind a glass partition, the creature SHALL hammer on the glass where the victim stood, in
flurries of blows that are heard on the glass, until the level makes it escape. The escape SHALL happen in the dark: the
room's lights die, the creature is gone when they come back, and the room's ceiling vent is left open. The enemy the
player later fights SHALL be that creature (the same body), not a different infected.

#### Scenario: Pounding on the glass
- **WHEN** the Lab B kill has ended and the player watches from the gallery
- **THEN** the creature stands at the glass where Voss stood and hits it again and again, each blow sounding on the glass

#### Scenario: Forearms bang on the pane
- **WHEN** a blow of the pounding lands
- **THEN** both forearms swing forward together onto the pane, its wrists within 10 cm of the surface and its blades upright along the glass rather than pointing into it, with no part of either blade more than 5 cm through it

#### Scenario: Gone when the lights come back
- **WHEN** the Lab B escape plays and Lab B's lights come back on
- **THEN** no creature is in Lab B, Voss's body is still beside the glass, and Lab B's ceiling vent grate hangs open

#### Scenario: The fight is the creature
- **WHEN** the creature drops into R06 during the cover-me fight
- **THEN** it has the creature's body
- **AND** no other body is left in Lab B

### Requirement: The creature pounds from where it appears
Behind a glass partition, the creature SHALL appear on the spot it hammers from, square to the pane where the victim
stood, and SHALL NOT walk or slide before hammering. Its first blow SHALL follow as soon as it is on its feet.

#### Scenario: No step to the glass
- **WHEN** the creature has unfolded out of Voss's chest
- **THEN** it has not moved from the spot where it appeared, and its first blow lands within 1 s

#### Scenario: Clear of the window frames
- **WHEN** the creature hammers on the Lab B glass
- **THEN** it stands in the middle window bay, and its blades meet the pane between that bay's two frames

### Requirement: Voss looks and sounds like Voss
The Lab B researcher SHALL be Dr. Lena Voss on every run: one fixed female body. Lines spoken by her speaker SHALL move
her jaw and body and play from her head position.

#### Scenario: Same body every run
- **WHEN** the slice loads twice with different seeds
- **THEN** the Lab B researcher uses the same female body model both times

#### Scenario: Her line comes from her
- **WHEN** her line "Help me. Please. It's under my skin." plays
- **THEN** her jaw moves with the line
- **AND** the voice comes from her head position behind the glass, not from the centre of the screen

### Requirement: Kill beats can cue the score
A kill beat SHALL be able to fire a named score stinger at an authored time in the beat, the same way it fires sounds.

#### Scenario: Stabs on the palms
- **WHEN** the glass beat plays and Voss's palms hit the glass four times
- **THEN** a score stinger fires at each hit

### Requirement: Creature blows are reported
Each flurry of blows by a creature behind the glass SHALL raise one game event when it starts, so other systems can react
to it.

#### Scenario: Flurry starts
- **WHEN** the creature behind the Lab B glass starts a new flurry
- **THEN** one pound event fires naming the creature

### Requirement: A kill beat can play a captured clip
A kill beat SHALL be able to play a captured motion clip on the victim once, from its first frame to its last, at an authored speed that may change during the beat, then hold the last frame. The beat SHALL be able to end when the clip ends, and SHALL still end at its time limit.

#### Scenario: The beat ends with its clip
- **WHEN** a beat plays a 3 s clip at speed 0.75 and ends when the clip ends
- **THEN** the beat lasts 4 s and the victim holds the clip's last frame

#### Scenario: A missing clip never stops the kill
- **WHEN** a beat names a clip the victim's body does not have
- **THEN** a warning is logged once, the beat plays its authored poses instead, and the kill continues

### Requirement: A clip moves the body off the floor in place
While a beat plays a clip, the victim SHALL stay where the kill placed her and keep her facing at the start of the beat, unless the beat carries her along a route. Her body SHALL rise and fall with the clip, with no part of her body sinking into the floor and no pop at the start or end of the clip.

#### Scenario: Getting up from the floor
- **WHEN** a get-up clip plays on a victim lying on the floor
- **THEN** her hips rise from floor height to standing height and her feet end on the floor where she lay

#### Scenario: A route beat moves her
- **WHEN** a beat that names a route plays a clip
- **THEN** she travels along the route instead of staying where the beat started

### Requirement: Convulsion layers over captured motion
During a clip beat, the beat's convulsion and its `kick` events SHALL add to the clip's motion and SHALL NOT replace it. The convulsion SHALL read as spasms and tremor, not flicker, when seen through a 30 fps camera feed.

#### Scenario: Twitches during the rise
- **WHEN** a kick event fires on the victim's shoulder during a clip beat
- **THEN** her shoulder jerks and her body carries on with the clip

### Requirement: Priya rises with captured motion
In the slice's ending stinger, Priya's converted body SHALL get up from the floor with a captured get-up, slowed and uneven, with light convulsion and a few sharp twitches, then face the camera. Her rise SHALL NOT step through held poses.

#### Scenario: The stinger rise
- **WHEN** the ending stinger reaches Priya's rise
- **THEN** she gets up in one continuous captured motion over at least 3 s and then turns to face CAM 04

### Requirement: A mauled attacker can notice someone behind the glass
A `mauled` style MAY name a `noticed` reaction that the attacker plays once while it approaches the victim. The only
reaction defined is `stare`: the attacker stops, turns its head and body to a target (the player), holds still for an
authored time, and goes on. The reaction SHALL play at an authored point in the approach unless a sequence brings it
forward, SHALL play at most once per kill, and SHALL NOT change when any later beat begins.

#### Scenario: Brought forward
- **WHEN** a sequence asks the attacker to notice before the authored point
- **THEN** the stare plays then, and does not play again at the authored point

#### Scenario: Fixed beat clock
- **WHEN** the same `mauled` kill runs once with the stare brought forward and once without
- **THEN** every beat after the approach begins at the same time in both runs

### Requirement: Mauled kill beats play in order
A `mauled` kill SHALL play these beats in order: plead, impale, carry, slam, throw, still. During plead the victim backs away
and the attacker walks to her. The slam beat SHALL hit the victim's head on its target three times. As with other kinds, a
sequence step SHALL be able to start when each beat begins.

#### Scenario: Beat order
- **WHEN** the R08 kill runs from start to end
- **THEN** the beats begin in the order plead, impale, carry, slam, throw, still

#### Scenario: Three slams
- **WHEN** the slam beat plays
- **THEN** the victim's head strikes the slam target three separate times, each with its own impact sound and blood

#### Scenario: Script reacts to an impact
- **WHEN** a slam impact lands
- **THEN** a sequence step waiting on that impact runs within the same frame

### Requirement: The attacker only takes hold when it has walked into reach
A beat in which the attacker first takes hold of the victim SHALL begin only once the attacker has walked to within arm's
reach of her. While a `mauled` kill runs, the attacker SHALL never be placed instantly at a new position; only a skip or a
restore may place it.

#### Scenario: Late arrival
- **WHEN** the attacker is still walking toward the victim when the plead beat's authored time runs out
- **THEN** the impale waits until it is in reach, up to the beat's time limit, and the attacker walks the rest of the way

#### Scenario: No snap
- **WHEN** the attacker's position is sampled every frame of a `mauled` kill that is not skipped
- **THEN** it never moves more than 0.3 m between two frames

### Requirement: The attacker is in contact with the victim
From the impale beat until the throw releases her, the attacker's body SHALL stand within arm's reach of the victim's body.
No blood from the attack SHALL start at a point more than 0.4 m from the victim's body.

#### Scenario: No attack from across the room
- **WHEN** the distance between the attacker's holding hand or claw and the victim's body is sampled at each frame of the impale, carry and slam beats
- **THEN** it never exceeds 0.25 m

#### Scenario: Blood starts on her
- **WHEN** any spray, spurt or chunk is thrown during a `mauled` kill
- **THEN** it starts within 0.4 m of the victim's body

### Requirement: The attacker holds the victim
While the attacker holds the victim, the held part of her body SHALL stay at the attacker's hand or claw, and the rest of her
body SHALL hang from that point. She SHALL be held impaled through the torso on its claw during impale and carry, and by the
head during slam.

#### Scenario: Carried on the claw
- **WHEN** the attacker walks during the carry beat
- **THEN** the victim's torso stays within 0.1 m of the attacker's claw at every frame

#### Scenario: Held for the slams
- **WHEN** the slam beat plays
- **THEN** the victim's head stays within 0.1 m of the attacker's gripping hand between impacts

### Requirement: The throw lands where it is aimed
The throw beat SHALL release the victim and carry her body to a named point on a glass partition. Her head or shoulders
SHALL strike the pane at that point, and her body SHALL then slide down the pane to the floor and stay there. The throw SHALL
come from the side of the pane that faces the victim's room, wherever she stands when the kill starts, and no part of her
body SHALL cross the pane.

#### Scenario: Thrown from the wrong side
- **WHEN** a mauled kill against a pane starts with the victim on the far side of it from her room
- **THEN** the throw still lands her in her room, at the base of the pane

#### Scenario: The body stays on her side
- **WHEN** the throw beat and the still beat end
- **THEN** no joint of her body is past the pane's plane

#### Scenario: Thrown into the pane
- **WHEN** the throw beat ends
- **THEN** the victim's head or upper back touched the pane within 0.3 m of the aimed point
- **AND** her body comes to rest on the floor against the base of the pane, and is not moved again by the kill

### Requirement: The victim's voice worsens with each beat
A `mauled` kill SHALL let each beat name the victim's line or sound. Across the slam beat, her voice SHALL go from a full
scream, to a cut-off cry, to a wet gasp, and be silent after the third impact. She SHALL make no voiced sound after the slam
beat apart from at most two breaths.

#### Scenario: Silenced by the third slam
- **WHEN** the third slam impact lands
- **THEN** any line the victim is speaking stops within 0.2 s
- **AND** no scream or word from her plays for the rest of the kill

### Requirement: Glass marks follow contact
During any kill, blood and damage on a glass partition SHALL appear only on the pane the victim touches, at the point where
her hand, head or body meets it. Handprints SHALL come from her hands; an impact crack and a blood splatter from a throw; and
a smear from her slide down the pane. No mark SHALL appear on a pane she did not touch.

#### Scenario: Only the struck pane
- **WHEN** the R08 kill has ended
- **THEN** the centre medbay pane carries blood and one crack
- **AND** the west pane and the medical bay door carry no blood and no crack

#### Scenario: Crack centred on the impact
- **WHEN** the throw strikes the pane
- **THEN** a single crack radiates from within 0.15 m of her head's point of contact

#### Scenario: Splatter at the impact
- **WHEN** the throw strikes the pane
- **THEN** blood spatter lands on the pane's surface around the point of contact, within 0.3 m of it, and runs down the pane from there
- **AND** a smear follows her body down the pane as she slides to the floor

### Requirement: Impact cracks look like broken safety glass
A crack on a glass partition SHALL look like struck safety glass: a crushed, frosted centre where the impact landed, fine
radial fractures from it crossed by rings, and clear glass between the fractures. The fracture lines SHALL catch the light, and
SHALL NOT read as a flat white drawing on the pane.

#### Scenario: Seen from the corridor side
- **WHEN** the player looks at a crack through the pane under the room's light
- **THEN** the centre is frosted, thin fracture lines run out from it with rings across them, and the glass between the lines stays see-through

#### Scenario: The light catches it
- **WHEN** the player moves sideways in front of the crack
- **THEN** the fracture lines brighten and dim with the viewing angle, as glass edges do

### Requirement: Blood looks like liquid
Blood thrown during a kill SHALL read as liquid: rounded drops of varied size in dark red, stretched along the way they fly,
falling under gravity. Drops that land on the floor, a prop or a glass pane SHALL leave a mark there. No blood SHALL show as
square or flat-coloured specks.

#### Scenario: Drops, not specks
- **WHEN** a spray or spurt is thrown and the player looks at it from 2 m
- **THEN** each visible drop is rounded with soft edges, drops differ in size, and fast drops are stretched along their path

#### Scenario: Drops leave marks
- **WHEN** blood drops from a kill land on the floor, the cart or a pane
- **THEN** a blood mark appears where they landed and stays after the drops are gone

#### Scenario: Reduced gore
- **WHEN** gore is set to reduced
- **THEN** the drops keep the same shape and are dark, with fewer of them

### Requirement: The view to the slam stays clear
Until the throw beat, no blood on the struck pane SHALL cover the straight line from the middle of the viewing strip to the
victim's head on the slam target. Gore SHALL stop at the pane's own face and never show on the player's side.

#### Scenario: Watching the slams
- **WHEN** the player looks through the centre pane at the slam target from the viewing strip during the slam beat
- **THEN** the victim's head and the attacker's arm are not hidden by blood on the glass

#### Scenario: Nothing on Jay's side
- **WHEN** any blood is thrown during the R08 kill
- **THEN** none of it appears on the corridor side of the medbay glass

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
