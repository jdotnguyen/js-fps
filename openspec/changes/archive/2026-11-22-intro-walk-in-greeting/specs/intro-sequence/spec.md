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

#### Scenario: Giles sets off the arch
- **WHEN** Giles walks through the arch
- **THEN** the arch alarms, the guard and Okafor each react with a line, and Giles walks on to the station side

#### Scenario: Banter on the station side
- **WHEN** both squadmates have passed the arch
- **THEN** their banter with Jay plays while they stand on the station side, ending with Okafor's call to go to the kitchen

### Requirement: Speaker shots at the post and in the kitchen
While Jay stands at his post, and from when he walks into the Commons, the view SHALL ease to each speaker who has a body as their line starts, taking about 0.6–1.0 s. When Jay speaks to someone named as the line's addressee, the view SHALL ease to that person instead. Jay's other lines and speakers without a body SHALL keep the current shot. Two exchanges are exceptions. While Sung talks with Jay at the counter, the view SHALL track Sung, and other speakers' lines SHALL NOT turn it. During the squad's walk in from the airlock to the counter, the view SHALL track Okafor in the same way. The speaker shot SHALL resume after each exception ends.

#### Scenario: Okafor speaks
- **WHEN** Okafor's line starts while Jay is at the post
- **THEN** the view eases to Okafor

#### Scenario: Jay speaks to someone
- **WHEN** Jay's line addressed to Giles starts while the view is on Okafor or the guard
- **THEN** the view eases to Giles

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
