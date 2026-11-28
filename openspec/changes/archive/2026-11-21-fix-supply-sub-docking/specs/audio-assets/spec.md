# Spec Delta

## MODIFIED Requirements

### Requirement: Procedural sound is fallback-only
New sound effects and ambience SHALL be added as recorded files. Procedural audio SHALL NOT be added for new sounds, and procedural sounds that no system or content plays SHALL be removed. Existing fallbacks for sounds still in use SHALL be kept unless a procedural placeholder is explicitly retired in favour of a recorded sample-only entry (such as `subPass` and `subClamp`).

#### Scenario: Adding a new SFX
- **WHEN** a new valve-turn sound is needed
- **THEN** it is generated as a recorded file and registered by name, with no new procedural synth

#### Scenario: Retiring a legacy procedural docking sound
- **WHEN** `subPass` and `subClamp` are replaced with ElevenLabs recordings and their procedural synths are removed
- **THEN** `subPass` and `subClamp` remain valid sound names backed by `SAMPLE_URLS`, play the recorded files when loaded, degrade silently with a warning if missing, and pass the audio audit
