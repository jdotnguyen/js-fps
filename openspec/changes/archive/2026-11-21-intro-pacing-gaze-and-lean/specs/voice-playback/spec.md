# Spec Delta

## ADDED Requirements

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
