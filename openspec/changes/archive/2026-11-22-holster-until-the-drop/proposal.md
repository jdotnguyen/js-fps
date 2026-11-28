# Proposal

## Why

Jay carries a drawn pistol from the first frame of the Commons, through a quiet morning of rounds and a briefing, even though nothing hostile exists until the drop. The gun undercuts the "ordinary shift" mood the intro and rounds build. It also gives the drop's blackout reveal, where the lights die and the creature is gone, no payoff for the player. Starting unarmed and getting the gun at the first sign of the threat turns that moment into a beat.

## What Changes

- Jay starts the game unarmed. No gun is in view (the lowered pose is not used) from the new game through the intro, briefing and rounds, and while the drop plays out. The flashlight still shows as usual.
- In the `drop` sequence, the pistol comes up on the first `ductBang` at `anchor:duct_r04`, which follows the blackout, the vent cover rip and the creature's despawn. The viewmodel plays its existing draw (`Weild` clip and cock sound) as the gun appears.
- "Unarmed" is derived from a saved flag, not from the control stack. A new flag `gunDrawn` is set by the drop at that `ductBang`. The armed check handed to the viewmodel treats `gunDrawn || drop_done` as armed, so old saves, `cp_drop` and later checkpoints, and the `?jump=` debug paths that set `drop_done` all come back armed. Loads and restarts before the drop come back with no gun in view.
- The Fire / Reload (`combat`) tutorial prompt needs no change: it fires on `combat:first`, the first enemy contact, which cannot happen before the drop. No prompt about firing appears while Jay is unarmed.
- Tests: the drop test asserts that the gun is drawn on the first `ductBang`, not before. A new test covers a load before the drop coming back with no gun in view.

Nothing is **BREAKING**. Existing saves taken after the drop are unaffected.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `intro-sequence`: adds a requirement for Jay's armed state from the new game through the drop, when the pistol comes up, and that loads and restarts honour it.

## Impact

- `src/data/sequences/intro_shift_change.json` and `src/data/sequences/drop.json` (control steps and a `setFlag` on the first `ductBang`).
- `src/app/session.ts` (the armed check handed to the viewmodel) and `src/render/viewmodel/viewmodel.ts` (a new `armed` dependency that hides only the gun).
- `src/script/quiet.test.ts` plus a new load-before-the-drop test.
- No overlap with in-flight changes. `docs/PLAYTEST.md` gains a manual check of the reveal.
- Out of scope: a new draw animation or sound, a new pistol model (being swapped separately), changes to the shotgun pickup, and any enemy before the drop.
