# Spec Delta

## MODIFIED Requirements

### Requirement: What the wing keeps
The rebuild SHALL keep:
- every door id in the wing
- the sequences `drop`, `contact` and `cover_me` with their lines, flags, objectives and checkpoints
- the anchor `labb_victim`, Voss's benches and her key light
- a clear sight line from the gallery glass to Voss's chest

The Lab Junction SHALL have no radio: the R05 console radio, its `r05_radio` anchor and the `ruined_radio_off` sequence are removed.

#### Scenario: Voss stays visible
- **WHEN** slice01 is built
- **THEN** no new prop in Lab B blocks the straight line from the gallery glass to `labb_victim` at chest height

#### Scenario: No radio after the contact fight
- **WHEN** the contact fight ends and the `cp_contact_clear` checkpoint saves
- **THEN** no radio music plays in the Lab Junction, and the level has no `r05_radio` anchor
