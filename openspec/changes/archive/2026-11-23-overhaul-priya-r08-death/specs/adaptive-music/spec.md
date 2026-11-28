# Spec Delta

## ADDED Requirements

### Requirement: The medbay score follows the scene
The medbay score SHALL start when the security office scene starts and SHALL change its layers with each section. It SHALL
carry a warm motif for Priya through the rescue, cut to silence apart from the medical bay monitor at the surgery's fall
and at the creature's stare, build through the walk and the kill, and end when the intercom is switched off.

#### Scenario: Her motif
- **WHEN** the triage and the armory sections play
- **THEN** the Priya motif layer plays, and it does not play during the kill

#### Scenario: Silence at the fall
- **WHEN** the tray falls in the surgery
- **THEN** every score layer drops out within 0.2 s for about 2 s, and the monitor beep is still heard

#### Scenario: Silence at the stare
- **WHEN** the creature stops and stares at the player
- **THEN** every score layer drops out for the stare's hold, and the monitor beep is still heard

#### Scenario: Ends with the intercom
- **WHEN** Okafor switches the intercom off in the aftermath
- **THEN** the medbay score has ended, with no layer still playing

### Requirement: The medbay score keeps the monitor's time
The medbay score's beat SHALL match the interval of the medical bay's vitals monitor beep, and the monitor SHALL keep that
steady interval through the scene while the score builds over it.

#### Scenario: One clock
- **WHEN** the medbay score plays during the rescue
- **THEN** the score's beat interval equals the monitor beep's interval to within 10 ms

#### Scenario: The monitor does not race
- **WHEN** the score builds during the kill
- **THEN** the monitor beep's interval is unchanged

### Requirement: Distance to the glass drives the glass layer
The medbay score's glass layer SHALL grow louder as the player gets closer to the medical bay panes and quieter as he
moves away, within the security office.

#### Scenario: Walking up to the glass
- **WHEN** the player walks from the back of the security office to the viewing strip during the rescue
- **THEN** the glass layer is louder at the strip than at the back of the room

### Requirement: Her motif returns in the aftermath
In the aftermath, the Priya motif SHALL play once more, slower and detuned, under the silence, and SHALL end before
Okafor's first aftermath line.

#### Scenario: The last time
- **WHEN** the aftermath begins
- **THEN** the Priya motif plays slower and detuned, and has stopped before "I told her she was fine." starts

### Requirement: Bus events cue only live scores
A game event SHALL cue only a score that is loaded and has not been released or begun fading out. A game event SHALL NOT
load or restart a score. A sequence's score step SHALL load or start a score as before.

#### Scenario: A released score stays quiet
- **WHEN** Priya's kill reaches its still beat after the Lab B score was released in R06
- **THEN** the Lab B score does not play, and only the medbay score is heard

#### Scenario: Voss's kill still drives Lab B
- **WHEN** the drop loads the Lab B score and Voss's kill emits its beat events
- **THEN** the Lab B score follows each beat's cue as before
