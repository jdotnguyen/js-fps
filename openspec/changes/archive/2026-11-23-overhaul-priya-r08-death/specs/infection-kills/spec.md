# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: Two kinds of infected kill`
- TO: `### Requirement: Three kinds of infected kill`

## MODIFIED Requirements

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

## ADDED Requirements

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
