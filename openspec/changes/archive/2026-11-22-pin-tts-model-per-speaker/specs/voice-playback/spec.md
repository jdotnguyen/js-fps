# Spec Delta

## MODIFIED Requirements

### Requirement: Consistent voice casting
Each speaker SHALL keep one Gemini TTS voice and one pinned Gemini TTS model for every line they have, as listed in `docs/voice-casting-standard.md`. A speaker's lines SHALL NOT mix providers or models; recasting SHALL re-record all of that speaker's lines.

#### Scenario: Retake one of Giles's lines
- **WHEN** a single Giles line is re-recorded
- **THEN** it uses voice `Algenib` on `gemini-2.5-flash-preview-tts`, the model pinned for Giles, not whatever model the script falls back to

#### Scenario: Retake one of Okafor's lines
- **WHEN** a single Okafor line is re-recorded
- **THEN** it uses voice `Charon` on `gemini-2.5-flash-preview-tts`, the model pinned for Okafor

## ADDED Requirements

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
