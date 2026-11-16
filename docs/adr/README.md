# Architecture Decision Records

These ADRs turn `DESIGN.md` into executable, ordered work for the first vertical slice
(10-15 min tech demo). Execute them **in numeric order**; each lists its dependencies.

## Provenance tags

Every decision line is tagged so it is clear who made it:

- **[Decided]** Justin chose this in the design Q&A. Do not change without asking.
- **[Assumed]** Claude filled a gap with a sensible default. Justin can overrule any of these
  cheaply before that ADR is executed. Review these first.
- **[Open]** Deliberately undecided. Must not block the slice.

## Format of each ADR

Context, Decision, Details (numbers, schemas, APIs), Consequences, Alternatives rejected,
Execution steps, Definition of done, Open questions.

## Index and execution order

| # | Title | Depends on |
|---|---|---|
| 0001 | Project reset and code architecture | - |
| 0002 | Rendering, lighting and post-processing | 0001 |
| 0003 | Modular level kit and data-driven levels | 0001, 0002 |
| 0004 | Player controller and interaction | 0003 |
| 0005 | Weapons | 0004 |
| 0006 | Humanoid bodies and dismemberment | 0002, 0005 |
| 0007 | Enemy AI, navigation and variants | 0003, 0006 |
| 0008 | Difficulty and resource economy | 0005, 0007 |
| 0009 | Sequence (scripting) system | 0003, 0004 |
| 0010 | Dialogue, voice and hints | 0009 |
| 0011 | Squad AI and specialists | 0006, 0007, 0009, 0010 |
| 0012 | HUD, menus, settings and accessibility | 0004, 0005, 0010 |
| 0013 | Audio | 0001, 0003 |
| 0014 | Slice content: map, beat sheet and script | all above |
| 0015 | Performance budget, verification and workflow | applies to all |
| 0016 | Save system and game state | 0001, 0008, 0012 |
| 0017 | New-game intro cutscene (skippable, on rails) | 0004, 0006, 0009, 0010 |
| 0018 | Squad characters: personalities, backstory, infection arc | 0010, 0011, 0014 |

0013 (audio) can run in parallel with 0004-0008 once 0003 exists.
0015 is a standing rule set: read it before starting any ADR.

## Language

The project is TypeScript (ADR-0001). File names written as `.js` in any ADR mean `.ts`.

## Status values

Proposed -> Accepted -> In progress -> Done. All start as **Accepted** for [Decided] parts and
**Proposed** for [Assumed] parts until Justin confirms.
