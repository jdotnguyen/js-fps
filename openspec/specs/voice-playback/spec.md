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
Lines on the `local` channel SHALL be positioned at the speaker's head and follow the room reverb. A local line with no speaker position SHALL play centred.

#### Scenario: Squadmate behind the player
- **WHEN** Okafor speaks on the local channel while standing behind the player
- **THEN** his voice comes from behind, at his head height, with the room's reverb

### Requirement: Radio channel
Lines on the `radio` channel SHALL sound like comms: band-limited to about 300-3400 Hz, saturated and compressed, with a squelch click at the start and end and a low static bed under the line. Radio lines SHALL NOT be positioned and SHALL NOT use the room reverb.

#### Scenario: Director over the intercom
- **WHEN** Director Hale speaks on the radio channel
- **THEN** his line is heard centred with comms filtering, a squelch at each end and static underneath

### Requirement: Station PA
Station PA lines SHALL use the radio channel treatment so they read as the public address system, not as a person in the room.

#### Scenario: Quarantine announcement
- **WHEN** `pa_quarantine_01` plays
- **THEN** it has the radio filtering, centred, with no room reverb

### Requirement: Voice stops with the scene
All dialogue SHALL stop when the game returns to the title screen or restarts, so no line from a previous run is heard.

#### Scenario: Quit to title mid-line
- **WHEN** the player quits to the title screen while a line is playing
- **THEN** the line stops at once and its subtitle is hidden

### Requirement: Consistent voice casting
Each speaker SHALL keep one Gemini TTS voice and one pinned Gemini TTS model for every line they have, as listed in `docs/voice-casting-standard.md`. A speaker's lines SHALL NOT mix providers or models; recasting SHALL re-record all of that speaker's lines.

#### Scenario: Retake one of Giles's lines
- **WHEN** a single Giles line is re-recorded
- **THEN** it uses voice `Algenib` on the model pinned for Giles, not whatever model the script falls back to

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
