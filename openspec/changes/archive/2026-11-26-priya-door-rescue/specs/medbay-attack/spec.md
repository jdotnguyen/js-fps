# Spec Delta

## MODIFIED Requirements

### Requirement: Priya runs into the medical bay
Priya SHALL hide in the security office through the R06 cover fight. When Jay first enters the security office after the
fight, a cutscene SHALL play: Jay SHALL be held where he stands with the cutscene bars shown, the squad SHALL be brought into
the room behind him, and the view SHALL follow her as she panics and runs for the medical bay door, stumbling at least once.
She SHALL go through `D_R07_R08`, which SHALL close and seal right behind her, before Jay gets control back. As she starts to
run she SHALL shout "Don't shoot! Don't shoot!", and Okafor SHALL call after her as she reaches the door. Inside, she SHALL
stop and turn to face the door.

#### Scenario: She runs
- **WHEN** Jay enters the security office after the R06 cover wave is cleared
- **THEN** Priya runs from the security office into the medical bay through `D_R07_R08`, stumbling on the way

#### Scenario: She shouts, then he calls after her
- **WHEN** she starts to run
- **THEN** her "Don't shoot! Don't shoot!" begins within 0.5 s, and Okafor's "Hey- hey! It's us! It's us!" begins after it, no more than 0.5 s before she reaches `D_R07_R08`

#### Scenario: She turns at the door
- **WHEN** she is through `D_R07_R08`
- **THEN** she stops within 1.5 m inside the door, facing it, and does not go on to the beds

#### Scenario: The door seals behind her
- **WHEN** Priya is through `D_R07_R08`
- **THEN** the door closes and is sealed by the lockdown at once, and Jay and the squad cannot open it

#### Scenario: Jay sees her go
- **WHEN** she starts to run
- **THEN** Jay is held with the cutscene bars shown, a squadmate calls out, the view follows her, and the squad is in the room behind him

#### Scenario: Jay cannot follow her
- **WHEN** Jay tries to move during the run
- **THEN** he does not move on his own until the door has sealed behind her; the cutscene moves him 3-4 running steps after her, toward the door, and no further

#### Scenario: No waiting at the door
- **WHEN** Jay steps into the security office while the squad is still talking after the R06 fight
- **THEN** that talk stops at once and the cutscene starts

#### Scenario: Her name is kept
- **WHEN** the run plays
- **THEN** Okafor does not say her name

### Requirement: She waits in the medical bay
From her run until Okafor tells her to sit, Priya SHALL stay in the medical bay just inside `D_R07_R08`, in view through its
glass and away from the surgery door. The creature SHALL be heard in the surgery at least once before the attack and SHALL
NOT be seen.

#### Scenario: Seen through the glass
- **WHEN** control returns to Jay after her run
- **THEN** Priya is in the medical bay within 1.5 m of `D_R07_R08`, visible through its glass, and not in front of `D_R08_R08b`

#### Scenario: Something in the surgery
- **WHEN** Jay is in the security office before the attack
- **THEN** at least one creature sound plays from the surgery, and no creature is visible

### Requirement: A rescue attempt comes before the creature
When the scene begins, Priya SHALL be standing just inside the medical bay door in the lit medical bay. The squad SHALL try
to reach her before the creature appears: Okafor at the door, Giles at the console. The creature SHALL come out of the
surgery only after the rescue's lines are done and the armory is open, and not before Jay has left the armory or 10 s have
passed.

#### Scenario: She is alive and talking first
- **WHEN** the scene plays without a skip
- **THEN** Priya and Okafor exchange at least eight lines before the surgery door opens

#### Scenario: Okafor goes to her at the door
- **WHEN** the rescue begins
- **THEN** Okafor walks to `D_R07_R08`, facing her through it, and Priya does not walk to the window

#### Scenario: The armory opens first
- **WHEN** the surgery door opens
- **THEN** `D_R07_R07a` is already open and Giles is no longer at its panel

#### Scenario: Jay is in the armory
- **WHEN** the rescue lines are done while the player is inside the armory
- **THEN** the surgery door stays shut until he steps out of the armory or 10 s pass, whichever comes first

### Requirement: Okafor checks her over and talks her down
Through the glass, Okafor SHALL ask Priya to show her hands and turn around, ask if anything scratched or bit her, and tell
her she is fine. After the surgery noise frightens her, he SHALL talk her down with "Sit down by the beds. Breathe with me.
In... and out.", and she SHALL answer "...Okay. Okay." on a shaky breath.

#### Scenario: Her own words back
- **WHEN** the tray falls in the surgery and her panicked breathing has played
- **THEN** Okafor's "Sit down by the beds. Breathe with me. In... and out." plays, then Priya's "...Okay. Okay."

#### Scenario: No medical advice
- **WHEN** the scene plays from Priya's run to the creature coming out
- **THEN** no line contains "medical advice" or "That's my line"

#### Scenario: She sits
- **WHEN** Okafor tells her to sit
- **THEN** she walks to the west wall by the beds and sits there until the creature comes out

#### Scenario: The rescue is tight
- **WHEN** the scene plays from Priya's first line to the armory opening
- **THEN** no pause inside a line is longer than 0.6 s, except written beats, which are at most 1.0 s
- **AND** Giles walks to the console while Priya is speaking, and the span is no more than 80 s (about 78 s with no lines cut; accepted 2026-11-23)
