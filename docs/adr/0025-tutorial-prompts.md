# ADR-0025: Tutorial prompts

Status: Accepted (from the Nov 16 grilling) / Proposed (styling, numbers)

## Context
After two-plus minutes on rails ([intro-sequence spec](../../openspec/specs/intro-sequence/spec.md)), the player gets control in the commons and should
learn the controls there [Decided]. Justin wants blocking pop-ups that blur and pause the game
and name the control, disappearing only when the player actually presses it [Decided].
Pop-ups that are great on a first play are annoying on a third, and the game will be tested
constantly.

## Decision
- **Blocking pop-ups** [Decided] for the basics, each tied to a moment:

| Pop-up | Fires when |
|---|---|
| Move | Bars fade in the commons (R02) after the intro |
| Look | Right after Move is done |
| Interact | First time the player looks at something usable (notice board, coffee machine) |
| Flashlight | First dark space: the dive-bay maintenance corridor (ADR-0023) [Assumed; moved from the drop now the drop is later] |
| Fire / Reload | First contact (R05) |

- **Sprint and crouch** get a small hint that does not pause the game, during the rounds
  [Decided: "not forced"].
- **Setting** `tutorialPrompts`: First time only / Always / Off, default **First time only**
  [Decided]. "First time" is per profile and saved (ADR-0016); a "Reset tutorials" button sits
  next to it.

## Details
- A pop-up pauses the simulation (not the audio bed), blurs the scene, and shows the action
  name and the **player's current binding** (never a hardcoded key), with an icon.
- It is dismissed **only by pressing the named action**. Esc does not dismiss it; the named key
  is always the way out, so nobody is stuck. Pressing the action also performs it (e.g. one
  step of movement) [Assumed].
- Real dialog: focus moves to it, `role="dialog"`, `aria-live` announcement of the text.
- Reduced motion: no blur, a plain dim overlay instead.
- Pop-ups never fire while on rails; a pop-up due during a sequence waits until it ends.
- Implementation: `TutorialPrompts` listens for game events (`intro:ended`, `look:usable`,
  `area:dark`, `combat:first`) and checks `profile.tutorialsSeen`.

## Execution steps
1. `TutorialPrompts` module, overlay UI, pause/blur, dismiss-on-action.
2. Setting, profile persistence and reset.
3. Hook the five triggers; non-blocking sprint/crouch hints.

## Definition of done
- On a fresh profile each pop-up appears once at its moment and only its action dismisses it.
- With First time only, a second new game shows none; with Off, none ever; with Always, all.
- Works with remapped keys and at 200 % UI scale.
