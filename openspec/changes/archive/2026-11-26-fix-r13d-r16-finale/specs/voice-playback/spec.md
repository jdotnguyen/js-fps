# Spec Delta

## MODIFIED Requirements

### Requirement: Station PA

Each Station PA line SHALL play its existing recording from one wall speaker, with a slightly boxy loudspeaker tone, directional sound and distance attenuation. The source SHALL stay at the same grille until the line finishes. An onboard train announcement is the exception: its source is the car Jay rides in, so it SHALL stay overhead of the listener until it finishes. During scripted overlap, nearby conversation SHALL remain intelligible in the foreground.

#### Scenario: Halcyon docks

- **WHEN** Jay watches Halcyon dock from his post
- **THEN** the PA chime and announcement sound from the same box to one side of the window

#### Scenario: Quarantine announcement

- **WHEN** the quarantine notice starts during the walk with Giles and Okafor
- **THEN** it plays immediately from a speaker farther along the route, both subtitles appear during the overlap, and Giles's words are easy to follow with subtitles off
- **AND** the source is heard beside and then behind Jay as he passes the box

#### Scenario: A call during rounds

- **WHEN** the quarantine repeat or gallery summons starts during free movement
- **THEN** one speaker serving the player's area carries the line from its first word to its last, even if the player enters another room

#### Scenario: Gallery lockdown

- **WHEN** the lockdown notice plays over the crew in the observation gallery
- **THEN** the notice comes from the gallery wall speaker and the crew's response is intelligible

#### Scenario: Announcement aboard the train

- **WHEN** an onboard train announcement is playing and Jay is carried or walks elsewhere
- **THEN** it stays overhead at the same loudness until its last word
