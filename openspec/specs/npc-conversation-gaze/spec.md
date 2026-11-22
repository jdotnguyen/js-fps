# npc-conversation-gaze Specification

## Purpose

Defines how speaking NPCs choose who to look at during multi-person conversations so dialogue feels directed at the intended listener rather than whichever character spoke previously.

## Requirements

### Requirement: Explicit addressee overrides last-speaker gaze
A dialogue line or a sequence `say` step MAY declare an explicit addressee (`to`, naming `"player"` or a character/speaker id). When a line starts with an explicit addressee, the speaking NPC SHALL look at that addressee (when in range and valid) instead of falling back to the previous speaker (`lastTalker`). A step-level `to` SHALL override a line-level `to` when both are present.

#### Scenario: Speaker addresses the player after two other NPCs speak
- **WHEN** NPC A speaks to NPC B, and NPC C then speaks a line with `"to": "player"`
- **THEN** NPC C looks at the player instead of at NPC A

#### Scenario: Speaker addresses a specific NPC across a group
- **WHEN** NPC A speaks to the player, and NPC B then speaks a line with `"to": "okafor"`
- **THEN** NPC B looks at Okafor instead of at the player

#### Scenario: Omitted addressee preserves existing fallback
- **WHEN** a dialogue line and its `say` step omit `to`
- **THEN** the speaker falls back to looking at the previous speaker (`lastTalker`), or the player if none is in range, preserving existing two-person banter behavior

#### Scenario: Listeners still look at the active speaker
- **WHEN** an NPC speaks a line with an explicit addressee
- **THEN** nearby idle listeners other than the speaker still turn to look at the active speaker
