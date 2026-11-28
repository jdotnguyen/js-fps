# Design

## Context

See proposal.md for the motivation. How things work today:

- The viewmodel group holds the pistol and shotgun rigs and also the held flashlight and its lens. `visible()` hides the whole group, so it cannot be used to hide only the gun. The `enabled()` check lowers the gun and blocks fire, reload and aim.
- `player.reset()` calls `control.reset()`, which returns to `FREE_CONTROL` (`weapons: true`). Every load, restart and death goes through it, and the restore sequences never set `weapons`. Setting `weapons: false` in the intro alone would therefore leave Jay armed after any load.
- `drop.json` already sets `weapons: false` on entry and calls `playerControl reset` at its end, about ten seconds after the reveal.
- Game flags are saved with checkpoints, and `drop_done` is already set by `?jump=` debug paths past the drop.
- The viewmodel plays the `Weild` draw (with the cock sound) on its first visible frame, and again whenever a gun is switched in.

## Goals / Non-Goals

**Goals:**
- No gun is in view from a new game until the first duct bang of the drop, on every route into the game (new game, load, restart, death, `?jump=`).
- One source of truth for "armed" that survives saves.

**Non-Goals:**
- A new draw animation or sound, or a new pistol model (being swapped separately). The existing `Weild` draw is reused.
- Changing the shotgun pickup or ammo rules.
- Any hostile before the drop.

## Decisions

**D1. Armed is a saved flag, not control-stack state.** A new flag `gunDrawn`, set by `drop.json` at the first `ductBang`, and `enabled()` becomes `control.weapons && (flags.gunDrawn || flags.drop_done)`. Alternative: set `weapons: false` in the intro and each restore. That needs a step in every restore sequence and breaks silently when a new one is added, because the default after `control.reset()` is armed. Deriving it from the flag fails safe: before the drop, any route has no gun in view.

**D2. `|| drop_done` covers old saves and debug jumps.** Saves made after the drop, and `?jump=` stages, already carry `drop_done`. They need no migration and no extra flag. `?jump=drop` carries only `rounds_done`, so it shows no gun, as intended.

**D3. Draw on the first `ductBang`, inside the sequence.** The drop gets a `setFlag gunDrawn` and a `playerControl { weapons: true }` in the same step group as the `anchor:duct_r04` `ductBang`. Its existing `weapons: false` rail stays and the final `reset` remains. The flag makes the viewmodel show the gun and play its draw; the control push lets fire work once the player has input again. The tail of the drop (ambush sting, duct scrapes, light changes, about 6 s) plays with the gun in hand, and input is still on rails.

**D4. Hide only the gun, with a new `armed` dependency on the viewmodel.** The viewmodel gets an optional `armed()` callback. While it is false the gun rig is hidden and the first-frame draw is skipped. When it turns true the rig is shown and the existing `Weild` draw plays, which gives the beat its draw and cock sound for free. Alternatives: the lowered pose (rejected: it leaves the gun showing at the bottom of the screen); hiding the whole viewmodel through `visible()` (rejected: it would also hide the held flashlight and move the beam origin). `enabled()` also requires the flag, so fire, reload and aim stay off.

**D5. The combat prompt stays where it is.** The `combat` prompt (Fire / Reload) is raised by `TutorialPrompts` on `combat:first`, which `EnemyDirector` emits when an enemy first alerts on a target. No enemy exists before the drop, so the prompt already cannot show while no gun is in view. A guard test asserts that no sequence emits `combat:first` before the drop.

## Risks / Trade-offs

- [The armed rule is read in two places, `enabled()` and `armed()`] → both call one helper (`sidearmUp` over `sidearmAllowed`) in `session.ts`, with unit tests for each flag combination.
- [A death during the drop restarts from the last checkpoint, which is before the drop, and no gun is in view] → intended, since the drop replays.
- [A weapon switch finishing while unarmed would set a rig visible again] → switching needs input and `enabled()` is false while unarmed, so it cannot start. Checked in the playtest.
- [A manual jump or cheat sets `weapons` back on before the drop] → `enabled()` still requires the flag, so the gun stays down.

## Migration Plan

No data migration. Saves after the drop load armed through `drop_done`. Rollback is reverting the sequence and the `armed`/`enabled()` wiring.

