## MODIFIED Requirements

### Requirement: The score resumes from checkpoints
A score SHALL say from which checkpoint states it resumes and at which cue. Restoring to such a state SHALL start the
score at that cue. Restarting or returning to the title SHALL stop it.

#### Scenario: Death in the contact fight
- **WHEN** the player dies in the R06 fight and restores at `cp_contact_clear`
- **THEN** the Lab B score starts in its hold, without replaying the kill layers

#### Scenario: Restore after the escape
- **WHEN** the player restores at `cp_drop`
- **THEN** the Lab B score starts in its hold, and neither the escape nor its stinger plays again

#### Scenario: Back to the title
- **WHEN** the player quits to the title while the score plays
- **THEN** the score stops and the menu theme takes the music bus

### Requirement: The score frees its audio when done
A score SHALL release its rendered audio once the level no longer needs it.

#### Scenario: After the contact fight
- **WHEN** the cover-me scene is done
- **THEN** the Lab B score's audio is released

### Requirement: The Lab B score follows the incident
The Lab B score SHALL change its layers with each kill beat, from a drone and heartbeat at scratch to full percussion at
the arch, cut to silence at the burst, drop to the drone in the escape's blackout, hold from the escape through R05,
bring the full layers back when the creature drops into R06, and end with a final hit when the creature is killed.

#### Scenario: Layers follow the beats
- **WHEN** the kill moves from scratch to the arch
- **THEN** more layers play at each beat, and the percussion layer plays only from the arch

#### Scenario: Quiet in the dark
- **WHEN** Lab B's lights die in the escape
- **THEN** only the drone plays until the lights come back

### Requirement: The Lab B score holds a steady level
Apart from the burst's silence, the escape's blackout and its stingers, the Lab B score SHALL play at one loudness from
scratch until the creature is killed, about as loud as the menu theme or louder. It SHALL NOT follow the player's distance
or dip for the creature's blows. The room ambience SHALL step back while it plays.

#### Scenario: Same loudness at every beat
- **WHEN** the score's loudness is measured at each cue that plays layers
- **THEN** every cue is within 1 dB of the others

#### Scenario: Ambience under the score
- **WHEN** the Lab B score is playing
- **THEN** the room ambience is about 6 dB lower than without it, and back to normal once the score ends

#### Scenario: Ends when the creature dies
- **WHEN** the player kills the creature in R06
- **THEN** a final hit plays and the drone fades within about 3 s

#### Scenario: Door slam
- **WHEN** the creature bursts through the R06 vent grate
- **THEN** a slam stinger plays and the fight layers come back

## ADDED Requirements

### Requirement: The Lab B escape ends on a jump stinger
When Lab B's lights come back on after the escape and show the room empty, a loud, sudden jump stinger SHALL play
at that moment, over the Lab B score's hold. World sound apart from the escape's own sounds SHALL be silenced in the dark
before it and come back with it.

#### Scenario: The reveal
- **WHEN** Lab B's lights come back on in the escape
- **THEN** the jump stinger starts within 0.1 s of the lights, and the room sounds come back with it

#### Scenario: Only the creature in the dark
- **WHEN** Lab B is dark during the escape
- **THEN** the only sounds are the vent cover tearing, the bangs moving away overhead, the squad's lines and the drone
