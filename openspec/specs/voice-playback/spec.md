# voice-playback Specification

## Purpose

Defines how a dialogue line sounds when it plays: which recording is used, how it is placed in the world or put over comms, what happens when a recording is missing, and how the voice cast stays consistent.

## Requirements

### Requirement: Lines play their voice recording
Every dialogue line SHALL play its recorded voice file through the line's channel, with its subtitle. A line MAY list several takes; each play SHALL pick a take different from the one used last time for that line when more than one is available.

#### Scenario: Story line with a file
- **WHEN** the sequence says `intro_cook_01`
- **THEN** Bram's recorded take plays and the subtitle shows "Bram" with the line text

#### Scenario: Reaction pool
- **WHEN** a reaction line with three takes fires twice in a row
- **THEN** the second play uses a different take from the first

### Requirement: Emote fallback for missing recordings
If a line's recording is missing or fails to load, the line SHALL still play with the procedural vocal emote named by the line, so the scene's timing and mood are kept. The subtitle SHALL show as normal.

#### Scenario: VO file 404
- **WHEN** a line's mp3 cannot be fetched
- **THEN** its emote sound plays in that speaker's voice profile and the subtitle appears

### Requirement: Local channel
Lines on the `local` channel SHALL be positioned at the speaker's head and follow the room reverb, and SHALL follow the speaker's head while it moves. They SHALL be heard through the station as the voice propagation requirement describes. A local line SHALL play centred only when its speaker is deliberately disembodied; every other local speaker SHALL have a body in the level.

#### Scenario: Squadmate behind the player
- **WHEN** Okafor speaks on the local channel while standing behind the player
- **THEN** his voice comes from behind, at his head height, with the room's reverb

#### Scenario: Director in his office
- **WHEN** Hale says his office lines while the player stands in the doorway
- **THEN** his voice comes from Hale's head in the office, not from the centre of the player's head

### Requirement: Radio channel
Lines on the `radio` channel SHALL sound like comms: band-limited to about 300-3400 Hz, saturated and compressed, with a squelch click at the start and end and a low static bed under the line. Radio lines SHALL NOT be positioned and SHALL NOT use the room reverb.

#### Scenario: Director over the intercom
- **WHEN** Director Hale speaks on the radio channel
- **THEN** his line is heard centred with comms filtering, a squelch at each end and static underneath

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

### Requirement: Voice stops with the scene
All dialogue SHALL stop when the game returns to the title screen or restarts, so no line from a previous run is heard.

#### Scenario: Quit to title mid-line
- **WHEN** the player quits to the title screen while a line is playing
- **THEN** the line stops at once and its subtitle is hidden

### Requirement: Consistent voice casting
Each speaker SHALL keep one Gemini TTS voice and one pinned Gemini TTS model for every line they have, as listed in `docs/voice-casting-standard.md`. A speaker's lines SHALL NOT mix providers or models; recasting SHALL re-record all of that speaker's lines.

#### Scenario: Retake one of Giles's lines
- **WHEN** a single Giles line is re-recorded
- **THEN** it uses voice `Algenib` on `gemini-2.5-flash-preview-tts`, the model pinned for Giles, not whatever model the script falls back to

#### Scenario: Retake one of Okafor's lines
- **WHEN** a single Okafor line is re-recorded
- **THEN** it uses voice `Charon` on `gemini-2.5-flash-preview-tts`, the model pinned for Okafor

### Requirement: Subtitles setting text
The subtitles toggle SHALL describe the current voice design: teammates are fully voiced and subtitles show the words. It SHALL NOT claim that teammates speak only in non-verbal sounds.

#### Scenario: Open the accessibility settings
- **WHEN** the player looks at the subtitles toggle
- **THEN** its help text matches fully voiced dialogue

### Requirement: Recorded lines pace to their voice audio
When a dialogue line plays a decoded voice recording, its subtitle and queue timer SHALL track the recording's playback duration (floored at a brief readability minimum of 0.85 s) instead of inflating to the word-count subtitle estimate. Consecutive queued lines SHALL keep a natural conversational pause (~0.15 s). Fallback playback without a recording duration SHALL keep using the word-count subtitle estimate (`max(minDuration, words * 0.35 + 0.8)`).

#### Scenario: Fast recorded line does not hang in silence
- **WHEN** a recorded line of 6 words has a 1.4 s voice clip
- **THEN** the line ends shortly after the 1.4 s clip finishes rather than waiting over 3 s for the word-count estimate

#### Scenario: Very short recorded bark stays readable
- **WHEN** a recorded one-word line has a 0.4 s voice clip
- **THEN** the subtitle stays up for at least the 0.85 s readability floor before advancing

#### Scenario: Missing recording falls back to subtitle estimate
- **WHEN** a line has no loaded recording and plays its procedural emote fallback
- **THEN** its duration uses `max(minDuration, words * 0.35 + 0.8)` so the subtitle remains readable

#### Scenario: Queued lines keep a natural breath
- **WHEN** two recorded story lines are queued back to back
- **THEN** the second line starts after a brief conversational pause (~0.15 s) instead of cutting in instantaneously or stalling for seconds

### Requirement: Each speaker's pinned model is recorded with their voice
The model pinned for each speaker SHALL be recorded next to that speaker's voice in the cast data the VO generators read, and listed for every speaker in `docs/voice-casting-standard.md`. Vocal reaction pools SHALL use the pinned model of the speaker they belong to.

#### Scenario: A new speaker is added
- **WHEN** a speaker is added to the cast without a pinned model
- **THEN** generating VO for that speaker fails with an error naming the speaker, and no clip is written

#### Scenario: Reactions follow the speaker's model
- **WHEN** Jay's scare and pain reactions are generated
- **THEN** they use the model pinned for Jay, not a separate default list

### Requirement: VO generation never falls back to another model
When the pinned model for a batch hits its quota or rejects a request, VO generation SHALL stop that speaker's work and report which batches were not generated. It SHALL NOT retry the batch on a different model, and it SHALL leave clips already written for that speaker unchanged.

#### Scenario: Daily quota runs out mid-run
- **WHEN** the pinned model's daily quota runs out after three of Okafor's five batches
- **THEN** the run reports the two remaining batches as not generated, no Okafor clip is made on another model, and the three finished batches are kept

#### Scenario: A batch combines two speakers
- **WHEN** two speakers are paired into one request to save quota
- **THEN** they share the same pinned model, or they are sent as separate requests

### Requirement: Shipped clips can be traced to their model
Each VO generation run SHALL record, for every batch it generates, the batch name, its line IDs, the speaker, the voice and the model used, in a file kept with the repository.

#### Scenario: Checking which model made a clip
- **WHEN** someone needs to know which model made `intro_giles_alarm_01.mp3`
- **THEN** the record names the batch, speaker, voice and model for that line without needing the raw WAV

### Requirement: A speaker's accent is pinned once it is known
When a speaker's accent has been confirmed by listening to their existing lines, it SHALL be recorded in the cast data next to their voice and model, and every TTS prompt for that speaker, dialogue or reaction, SHALL state it. A speaker with no recorded accent SHALL get no accent instruction, rather than a guessed one.

#### Scenario: A one-line Heins retake
- **WHEN** a single new Heins line is generated on its own
- **THEN** the prompt tells the model to use a General American accent, so the line does not drift to another accent

#### Scenario: Speaker with no confirmed accent
- **WHEN** a line is generated for a speaker whose accent has not been confirmed
- **THEN** the prompt adds no accent instruction

### Requirement: Every local speaker has a body
Each speaker with a local-channel line SHALL map to an NPC that stands in the level where the line is said, unless the speaker is listed as disembodied. The level tests SHALL fail for a local line whose speaker has no body and is not listed, naming the line and the speaker.

#### Scenario: Unmapped speaker
- **WHEN** a local line is added for a speaker that maps to no NPC in slice01 and is not listed as disembodied
- **THEN** the level tests fail and name the line and its speaker

#### Scenario: Maintenance tech in the dive bay
- **WHEN** the maintenance tech says "Lights are out down the back corridor again"
- **THEN** the voice comes from the tech standing in the dive bay

### Requirement: Voices carry through the station
A local voice SHALL travel from its speaker to the player through rooms and doorways. In the same room, or through an open doorway, it SHALL fade with distance as before. Each room boundary on the way SHALL make it duller and quieter, and a closed door much more so. Three or more boundaries away, or more than about 30 m along the way, it SHALL be silent. Glass between adjacent rooms SHALL dull it only slightly.

#### Scenario: Next room, door open
- **WHEN** Giles talks in the next room with the door between them open
- **THEN** the player hears him slightly muffled and quieter than in the same room, still clearly from Giles's side

#### Scenario: Behind a closed door
- **WHEN** a speaker talks in the next room with the door closed
- **THEN** the voice is strongly muffled and quiet, and becomes clear when the door opens

#### Scenario: Across the station
- **WHEN** Hale speaks in his office while the player is in the dive bay
- **THEN** nothing of his voice is heard

#### Scenario: Walking away mid-line
- **WHEN** the player walks out of a room while a line is playing in it
- **THEN** the voice dulls and fades as boundaries are crossed, during the line, not only at its next line

### Requirement: Subtitles follow the player's earshot
A local line's subtitle SHALL show only while its speaker is within 20 m of the player and its voice is audible. For a local `background` line the distance SHALL be 6 m instead of 20 m. For a `background` PA line, the subtitle SHALL show only while the player is within 12 m of the playing PA wall grille and the grille is audible through room propagation. All proximity checks SHALL be re-checked during the line: walking into range shows the subtitle for the rest of the line, and walking out hides it. Radio subtitles and non-background (`story`) PA subtitles SHALL show wherever the player is.

#### Scenario: A conversation far behind
- **WHEN** a scene plays 25 m from the player in a room they can still faintly hear
- **THEN** no subtitle for it is shown

#### Scenario: Walking into a conversation
- **WHEN** the player walks within 20 m of a speaker mid-line and can hear them
- **THEN** the subtitle appears for the rest of that line

#### Scenario: Close but sealed off
- **WHEN** a speaker is 12 m away behind several walls and their voice is silent
- **THEN** no subtitle is shown

#### Scenario: Briefing over the intercom
- **WHEN** Hale's morning briefing plays on the radio channel
- **THEN** its subtitles show wherever the player is

#### Scenario: Story PA anywhere on station
- **WHEN** the scripted quarantine or lockdown `story` PA line plays while the player is 20 m from the active grille
- **THEN** its subtitle still shows

#### Scenario: Ambient PA near the grille
- **WHEN** a `background` PA announcement plays from a wall grille 6 m away in the player's room
- **THEN** its subtitle shows while the player stays within 12 m and in earshot

#### Scenario: Walking away from an ambient PA grille
- **WHEN** the player walks more than 12 m away from the playing wall grille or closes a heavy door behind them mid-announcement
- **THEN** the `background` PA subtitle hides for the rest of that line

#### Scenario: Overhearing from a distance
- **WHEN** a local background line plays 8 m from the player in the same room
- **THEN** it is heard faintly with no subtitle

#### Scenario: Leaning in on a background line
- **WHEN** the player walks within 6 m of the speaker mid-line
- **THEN** its subtitle appears for the rest of that line

### Requirement: Voices on a live intercom
A local line spoken in a room covered by a live intercom SHALL also play from the intercom's speaker, with the intercom's
comms tone. It SHALL still play at the speaker's head through voice propagation as before. Its subtitle SHALL show while
the player is in the speaker's room or a room opening onto it, as well as within the line's usual earshot.

#### Scenario: Priya over the intercom
- **WHEN** Priya speaks in the medical bay while its intercom is live and the player stands in the security office
- **THEN** her line is heard clearly from the intercom speaker with comms tone and crackle, and its subtitle shows

#### Scenario: From the armory doorway
- **WHEN** she speaks while the player stands in the armory next to the security office with its door open
- **THEN** her line is heard from the intercom speaker and its subtitle shows

### Requirement: A scene can project a voice
A sequence SHALL be able to project one speaker's voice for its length: while projected, that speaker's local lines SHALL be
no quieter than at a set distance, keeping their direction and room reverb, and SHALL never be louder than at the real
distance when the player is nearer. The projection SHALL end when the sequence ends.

#### Scenario: Across the room
- **WHEN** a sequence projects Okafor's voice at 3.5 m and he speaks 7 m from the player in the same room
- **THEN** his line is as loud as at 3.5 m and comes from his direction, with the room's reverb

#### Scenario: Nearer than the set distance
- **WHEN** the player stands 1 m from Okafor while his voice is projected
- **THEN** his line plays as an ordinary line from 1 m

#### Scenario: After the scene
- **WHEN** the sequence that projected Okafor's voice has ended
- **THEN** his lines fade with distance as ordinary local lines do

### Requirement: Shipped clips say their line
The recording wired to a spoken dialogue line SHALL contain that line's words, all of them, and no words from another line. This applies to every line the game can play. Non-verbal reactions are exempt.

#### Scenario: A line next to another in the same take
- **WHEN** Jay says "They're powdered, Giles. You ask every single morning." in the intro
- **THEN** the recording ends with that line, and "What's in it?" is heard only in the dive bay, as its own line

#### Scenario: A line with a pause inside it
- **WHEN** Heins says "Blinds up. Hale wants eyes on it. Nobody touches the glass."
- **THEN** the whole line is in one recording, and the next recording starts with her next line

### Requirement: New takes are checked before they ship
Before a newly cut dialogue clip replaces a shipped clip or is wired to a line, voice generation SHALL transcribe it and compare it with the line's text. A clip with words missing or added SHALL be held back and reported with what was heard, leaving the shipped clip and the line unchanged. The author SHALL be able to accept a held clip by naming it, after listening.

#### Scenario: A bad cut
- **WHEN** a generated clip also contains the start of the next line
- **THEN** it is not written over the shipped clip, and the run reports its line id, the expected text and the heard text

#### Scenario: A misheard name
- **WHEN** a held clip is correct and the author accepts it by its line id
- **THEN** it ships and is wired like any other clip

#### Scenario: No speech-to-text available
- **WHEN** generation runs on a machine without the speech-to-text model
- **THEN** the run states that its clips are unchecked, naming each one, and does not report them as verified

#### Scenario: A non-verbal line
- **WHEN** the line is only a gasp, a scream or a bracketed sound
- **THEN** it is not compared with its text

### Requirement: Raw batch recordings are kept
Voice generation SHALL NOT destroy an earlier raw batch recording. When a new recording takes the same batch name, the earlier one SHALL remain available for re-cutting.

#### Scenario: Two retakes for one speaker
- **WHEN** a speaker's lines are retaken twice, in separate runs
- **THEN** both raw recordings exist afterwards, and re-splitting without new voice requests uses the newer one
