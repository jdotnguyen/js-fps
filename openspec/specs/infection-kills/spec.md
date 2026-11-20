# infection-kills Specification

## Purpose

Defines how a scripted infected death plays on camera: the kinds of kill, how the victim's body, voice, blood and sound
stay in step, and how the player can still see the victim while the gore covers the hand-off to the creature.

## Requirements

### Requirement: Two kinds of infected kill
A scripted kill SHALL name its kind: `grownInside` or `converted`. A `grownInside` kill SHALL leave the victim's own body as
a corpse and bring in a separate creature body. A `converted` kill SHALL turn the victim's body into an infected enemy.

#### Scenario: Grown inside
- **WHEN** a `grownInside` kill finishes on a victim
- **THEN** the victim's body lies dead where it fell with a torn chest
- **AND** a creature body stands nearby and acts as an enemy

#### Scenario: Converted
- **WHEN** a `converted` kill finishes on a victim
- **THEN** the victim's own body is infected and acts as an enemy
- **AND** no separate creature body is spawned

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
failed recording never stops the kill.

#### Scenario: Scream drives the arch
- **WHEN** the victim's first scream ends
- **THEN** the arch beat begins

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
After a `grownInside` kill behind a glass partition, the creature SHALL hammer on the glass beside the victim's body, in
flurries of blows that are heard on the glass, until the level releases it. When it is released, the enemy the player
fights SHALL be that creature (the same body, coming from where it stood), not a different infected.

#### Scenario: Pounding on the glass
- **WHEN** the Lab B kill has ended and the player watches from the gallery
- **THEN** the creature stands at the glass beside Voss's body and hits it again and again, each blow sounding on the glass

#### Scenario: The fight is the creature
- **WHEN** the contact scene opens the Lab B door
- **THEN** the enemy that comes through it has the creature's body and starts from where the creature stood at the glass
- **AND** no other body is left standing behind the glass

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
