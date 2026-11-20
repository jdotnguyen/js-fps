# Architecture Decision Records

These ADRs turn `DESIGN.md` into executable, ordered work for the first vertical slice
(10-15 min vertical slice). Execute them **in numeric order**; each lists its dependencies.

## Provenance tags

Every decision line is tagged so it is clear who made it:

- **[Decided]** Justin chose this in the design Q&A. Do not change without asking.
- **[Assumed]** Claude filled a gap with a sensible default. Justin can overrule any of these
  cheaply before that ADR is executed. Review these first.
- **[Open]** Deliberately undecided. Must not block the slice.

## Format of each ADR

Context, Decision, Details (numbers, schemas, APIs), Consequences, Alternatives rejected,
Execution steps, Definition of done, Open questions.

## Specs replace ADRs for audio

Audio and voice behaviour (the mix, sound assets, voice playback and in-world sound) is specified with
OpenSpec in [`openspec/specs/`](../../openspec/specs/), not in ADRs. ADR-0010 (dialogue, voice and hints)
and ADR-0013 (audio) were retired on 2026-11-20 by the `establish-audio-spec` change.

## Index and execution order

| # | Title | Depends on |
|---|---|---|
| 0001 | Project reset and code architecture | - |
| 0003 | Modular level kit and data-driven levels | 0001, 0002 |
| 0004 | Player controller and interaction | 0003 |
| 0005 | Weapons | 0004 |
| 0006 | Humanoid bodies and dismemberment | 0002, 0005 |
| 0007 | Enemy AI, navigation and variants | 0003, 0006 |
| 0008 | Difficulty and resource economy | 0005, 0007 |
| 0009 | Sequence (scripting) system | 0003, 0004 |
| 0011 | Squad AI and specialists | 0006, 0007, 0009 |
| 0012 | HUD, menus, settings and accessibility | 0004, 0005 |
| 0014 | Slice content: map, beat sheet and script | all above |
| 0016 | Save system and game state | 0001, 0008, 0012 |
| 0018 | Actor separation (body-vs-body collision) | 0004, 0006, 0007 |
| 0019 | Leg wounds (stagger, limp, then dismember and fall) | 0006, 0007 |
| 0020 | Turn-then-move steering for crawlers and draggers | 0006 |
| 0021 | Hero tier behaviour (heavy gait, slam, toughness, weak spot) | 0006, 0007, 0019 |
| 0022 | Squad characters: personalities, backstory, infection arc | 0011, 0014 |
| 0023 | The quiet half: commons, briefing and morning rounds | 0014, 0024, 0025 |
| 0024 | Map, objectives and access gating | 0003, 0004, 0012, 0016 |
| 0025 | Tutorial prompts | 0004, 0012, 0016 |
| 0026 | Imported body models for the crowd | 0006, 0007 |
| 0027 | Speech acting: talking mouths and tone-matched gestures | 0006, 0026 |
| 0028 | Navmesh pathing and authored walks | 0007, 0009 |
| 0029 | Ambient life: activity spots, conversations, ambient director | 0006, 0009, 0027, 0028 |

## Language

The project is TypeScript (ADR-0001). File names written as `.js` in any ADR mean `.ts`.

## Status values

Proposed -> Accepted -> In progress -> Done. All start as **Accepted** for [Decided] parts and
**Proposed** for [Assumed] parts until Justin confirms.
