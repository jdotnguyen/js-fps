# Spec Delta

## MODIFIED Requirements

### Requirement: Squad arrival through the checkpoint
After the crew, the airlock SHALL cycle and Okafor and Giles SHALL come through one at a time. Okafor SHALL greet Jay while he is still walking in from the airlock, and Jay answers before Okafor reaches the counter. Giles SHALL get a line in as the pair close in. Each then stops at the counter in front of Jay, then walks through the arch. Okafor SHALL pass cleanly. Giles SHALL set the arch off with his multitool, which happens every morning: the guard sighs, Okafor gets a dry line, and the beat stays warm, with no hint of illness. Both SHALL then wait on the station side near the booth's open side.

#### Scenario: One at a time
- **WHEN** Okafor and Giles arrive
- **THEN** they reach the counter and the arch one after the other, never side by side

#### Scenario: Greeting on the walk in
- **WHEN** Okafor walks in from the airlock toward the counter
- **THEN** his greeting to Jay starts about 1.5 s after he sets off, Jay's reply follows, and both play before or as he reaches the counter rather than after he stops there

#### Scenario: Giles speaks as they close in
- **WHEN** Giles follows Okafor in from the airlock
- **THEN** his line about Jay's posture plays during the walk in, before the guard's line greeting Okafor at the arch

#### Scenario: Straight on to the arch
- **WHEN** the guard has greeted Okafor at the arch
- **THEN** Giles walks into the arch without any banter with Jay first

#### Scenario: Giles sets off the arch
- **WHEN** Giles walks through the arch
- **THEN** the arch alarms, the guard and Okafor each react with a line, and Giles walks on to the station side

#### Scenario: Banter on the station side
- **WHEN** both squadmates have passed the arch
- **THEN** the only talk left on the station side is Okafor's call to go to the kitchen

### Requirement: Speaker shots at the post and in the kitchen
While Jay stands at his post, and from when he walks into the Commons, the view SHALL ease to each speaker who has a body as their line starts, taking about 0.6–1.0 s. When Jay speaks to someone named as the line's addressee, the view SHALL ease to that person instead. Jay's other lines and speakers without a body SHALL keep the current shot. Two exchanges are exceptions. While Sung talks with Jay at the counter, the view SHALL track Sung, and other speakers' lines SHALL NOT turn it. During the squad's walk in from the airlock to the counter, the view SHALL track Okafor in the same way. The speaker shot SHALL resume after each exception ends.

#### Scenario: Okafor speaks
- **WHEN** Okafor's line starts while Jay is at the post
- **THEN** the view eases to Okafor

#### Scenario: Jay speaks to someone
- **WHEN** a line of Jay's with an addressee starts while a speaker shot is on someone else
- **THEN** the view eases to the addressee

#### Scenario: Jay speaks
- **WHEN** a line of Jay's with no addressee starts
- **THEN** the view stays where it is

#### Scenario: The guard speaks while Sung talks with Jay
- **WHEN** the guard's lines to Ruiz start while Sung is at the counter talking with Jay
- **THEN** the view keeps tracking Sung and does not turn to the guard or Ruiz

#### Scenario: The guard speaks during the squad's walk in
- **WHEN** the guard's line clearing Sung starts after the airlock has opened for the squad
- **THEN** the view keeps tracking Okafor as he walks in and does not turn to the guard

#### Scenario: The guard greets Okafor at the arch
- **WHEN** Okafor has reached the counter and the guard's "Morning, Doctor." line starts
- **THEN** the view eases to the guard

### Requirement: Kitchen scene
In the kitchen, Bram greets the squad and serves them, then Priya comes in, sends Okafor to sit and teases Giles before she offers Jay a coffee. The squad wait at the counter until Jay walks into the Commons, and Bram's greeting starts then. From the moment Jay comes through the Commons door, the view SHALL turn to whoever speaks first, Bram, Okafor or Giles, then follow each speaker in turn, Priya included, as speaker shots. The TAG FM radio SHALL start when Jay reaches the kitchen.

#### Scenario: Walking in
- **WHEN** Jay comes through the Commons door
- **THEN** the view stops facing along the route, and turns to the next person who speaks

#### Scenario: Bram greets as Jay walks in
- **WHEN** the squad reach the counter before Jay is in the Commons
- **THEN** Bram's greeting waits until Jay walks in, so the first line lands as he enters

#### Scenario: From the coffee to Priya
- **WHEN** Giles has his mug
- **THEN** Priya comes in next, with no talk of the kettle or the eggs between

#### Scenario: Priya walks in
- **WHEN** Priya enters the kitchen
- **THEN** the view turns to her, and then follows whoever speaks

#### Scenario: Priya turns to Jay
- **WHEN** Giles has answered Priya about his coffee count
- **THEN** Priya moves to offer Jay a mug, with no other exchange between

#### Scenario: Radio
- **WHEN** Jay arrives at `kitchen_stand`
- **THEN** the TAG FM radio starts playing in the Commons

### Requirement: End of the intro
When the intro ends, control SHALL return in the Commons, the `cp_intro` checkpoint SHALL save, and these flags SHALL be set: `introSeen`, `pa_quarantine_played`, `priya_met`, and `radio_place` = `commons`. The morning briefing is a separate sequence and SHALL NOT start as part of the intro.

#### Scenario: Watched to the end
- **WHEN** the intro finishes
- **THEN** the player has control in the Commons, `cp_intro` is saved, and all of the listed flags are set

### Requirement: Paced intro beats with addressee-accurate gaze
The intro SHALL avoid multi-second dead-air stalls between docking, checkpoint, walk, and kitchen beats. In multi-person intro exchanges (dock checkpoint, corridor walk, and kitchen banter), each speaking NPC SHALL look toward the person they are addressing in the script rather than staring at whoever happened to speak last on a different thread.

#### Scenario: Sung greets Jay after Ruiz's guard scan
- **WHEN** Sung steps up to the counter and greets Jay (`intro_sung_01`) right after the dock guard clears Ruiz
- **THEN** Sung looks toward Jay rather than toward the dock guard

#### Scenario: Kitchen banter crosses between three or more speakers
- **WHEN** Giles remarks to Okafor about Priya (`intro_giles_10`), Priya offers coffee to Jay (`intro_priya_05`), or Okafor and Giles wrap up with Jay (`intro_okafor_09`, `intro_giles_14`)
- **THEN** each speaker looks at their intended addressee (Okafor or Jay) rather than at the previous speaker

#### Scenario: Skipped intro keeps exact end state
- **WHEN** the intro is skipped at any point after the pacing and gaze updates
- **THEN** the end state (positions, flags, checkpoint, played lines, and mug in Jay's hand) matches watching to the end
