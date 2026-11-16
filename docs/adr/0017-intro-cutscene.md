# ADR-0017: New-game intro cutscene (skippable, on rails)

Status: Accepted (structure, skip rule, bars) / Proposed (script, timings, numbers)

## Context
Choosing New game + difficulty should drop the player into an opening scene instead of
straight into control [Decided]. The player stands guard at the docking ring as the engineer
(August Giles) and medic (Dr. Okafor) arrive for the morning shift, there is banter, then the
player follows them to the kitchen and chats [Decided]. The scene is skippable [Decided]. The
player is silent in this slice [ADR-0010]: the NPCs talk as if the player answered, with no
choices [Decided]. The scene is still real-time and first-person, no camera cuts [Decided in
ADR-0009]. Skipping needs a hold of **3 seconds** with a progress bar that fills while held
[Decided]. Whenever the player is on rails, black bars fade in [Decided].

This amends two earlier rules: ADR-0009 "no skipping of in-world scenes" now applies only to
sequences without `skippable: true`, and ADR-0014 beat 1 no longer has the player walk with
the squad under their own control.

## Decision
The intro is one ADR-0009 sequence, `intro_shift_change`, flagged `skippable: true`. Starting
a new game fades in from black, plays the sequence, then hands control back in the commons
(R02) after an autosave (`cp_intro`). Skipping applies the sequence's end state instantly.
Loading a save or restarting after death never replays it.

## Details

### Beats (about 2:15)
| Time | Beat | Control |
|---|---|---|
| 0:00 | Fade in from the TAG Industries card. Caption: station name, "Docking Ring", "06:40 Shift change" | locked |
| 0:05 | Standing guard (R01). Hum, distant PA chime, a large shadow passes the abyss window | move locked, look clamped about +/-70 deg |
| 0:35 | Door cycles; Okafor and Giles enter; view eases toward them (`playerLookAt`, weight 0.6) | same |
| 0:40 | Banter at the post | same |
| 1:05 | Walk to the kitchen: NPCs lead, player auto-walks behind at slow pace. `pa_quarantine_01` plays. Giles rubs his forearm and dismisses Okafor (foreshadow 1) | `playerWalkTo`, look clamped wide |
| 1:35 | Kitchen (R02): crew greet the player (`crew_mess_greeting_01`), coffee, small talk. One character moment each for Giles and Okafor | locked |
| 2:10 | Soft hand-off: a mug on the counter with an interact prompt "Take coffee" (E). Taking it ends the scene. If ignored for 6 s, the scene ends by itself | look free, move locked, interact allowed |
| end | Bars fade out, `cp_intro` autosave, hint "Move / Interact" | free |

The mug beat is interactive but not branching: it only teaches `interact`.

### Rails and letterbox bars
- "On rails" is derived from the control stack (ADR-0004): `move` is `locked` or a scripted
  `walkTo` is active (`Player.onRails`). Bars show when **a sequence is running and** the
  player is on rails, so an enemy grab (which also locks movement) does not show them. It
  is not a flag sequences set by hand, so it cannot be forgotten and it covers future set
  pieces.
- Slow-walk sections (the drop, `move: 'slow'`) are not on rails, so no bars. This keeps the
  bars meaning "you cannot move".
- Bars are two black DOM/CSS bands, 11 % of viewport height each (about 2.35:1 at 16:9),
  above the HUD, below the skip prompt and subtitles. The interact prompt stays visible
  (the mug beat needs it).
- Fade in 0.6 s, out 0.6 s, eased. With `reducedMotion` the bars still appear but crossfade
  in 0.15 s with no slide.
- Subtitles move inside the bars-clear area so they are never covered.
- New game mode `cutscene` is not needed: `playing` plus `onRails` is enough, so pause and
  saving keep working. Saving is disabled while `onRails`.

### Skip control
- New action `skipCutscene` in `keymap.json` and `ACTIONS`. Default keys: `Space`, `Enter`.
  Not `Escape` (pause) and not `Mouse0` (fire). Remappable like any action.
- Hold to skip: the bar at the bottom-right fills over **3 s** (setting `skipHoldSeconds`,
  default 3, range 1.5 to 6, in Settings > Accessibility). Releasing drains it at 3x speed, so a brief slip is forgiven
  but it can't be "farmed". At 100 % the skip fires.
- The hint "Hold [Space] to skip" appears for 4 s at scene start, and again on any key press
  or mouse movement during the scene. It only shows for `skippable` sequences.
- Accessibility (ADR-0012):
  - **Skip assist** setting (`skipAssist`, boolean): when on, one press starts
    the same 3 s bar automatically; pressing again or Esc cancels it. For players who
    cannot hold a key.
  - The prompt is real text plus the bar, never colour alone. Bar has
    `role="progressbar"` with `aria-valuenow`, and an `aria-live` message "Skipping" at 100 %.
  - Prompt shows the player's current binding, not a hardcoded key.
  - Reduced motion: bar fills without easing. Reduced flashing: the skip fade is a plain
    0.4 s dissolve to black, no flash.
- Skip effect (`CutsceneController`): fade to black 0.4 s, call `finish()` on every remaining step, fade in 0.5 s.

### Sequencer support (extends ADR-0009)
- Every action gets `finish()` beside `start`, `update`, `cancel`. It applies the action's
  final state instantly (move NPCs to their marks, set flags, mark lines as played,
  set music state). A sequence skips by calling `finish()` on all steps from the cursor on.
- Sequence option `skippable: boolean` (default false) and `endState` for the debug view.
- Lines skipped are marked played in the dialogue library so barks do not repeat them.
- Flags set by the intro: `introSeen`, `pa_quarantine_played`, `giles_forearm_seen`.
- Game: `newGame()` calls `sequencer.play('intro_shift_change')` instead of
  `enterPlaying()` directly; the sequence's `checkpoint` step writes `cp_intro`.
- Debug: `?seq=intro_shift_change`, and `?seq=intro_shift_change&skip` to test the end state.

### Assets needed (all procedural, nothing blocks the build)
No separate asset-design phase is required. ADR-0006 `buildHumanoid(spec)` already defines
the body, outfits and pose library, and the intro needs only a small subset of it:
| Need | From |
|---|---|
| Giles (outfit `engineer`), Okafor (outfit `medic`) | `buildHumanoid`, fixed seeds |
| 3 crew (outfit `crew`, different seeds) | `buildHumanoid` |
| Poses: idle, gait, gesture, drink, rub-arm (additive) | pose library, new |
| Props: chair, desk (as table), vending_machine, console, locker | existing kit |
| Props: mug, coffee machine, tray, counter | new, simple procedural pieces |
| Docking door with TAG logo, abyss window | existing door/window kit, logo from `render/logo.ts` |
Visual finish (faces, hair, cloth) is polished later; only the **rig contract** must be
fixed now (joint names, height, eye height, hand sockets) so real models can replace the
procedural ones without touching sequences.

## Consequences
- The opening reaches the player in two minutes with no playable content, so skipping is
  important for replays and for streamers/testers.
- `finish()` on every action is extra work for every new action type; tests cover it.

## Alternatives rejected
- Hold Esc to skip: conflicts with pause.
- Single-press skip: too easy to trigger by accident.
- Pre-rendered or cut-scene camera: rejected by ADR-0009.
- Bars set manually per sequence: they get forgotten and drift from the real control state.

## Execution steps
1. [Done] Sequencer core (ADR-0009 steps 1-2) with `finish()`, `skippable`, control stack, `onRails`: `src/sequence/`, 13 tests.
2. [Done] Letterbox bars driven by `onRails`; `skipCutscene` action, settings, skip prompt UI, `SkipHold` (7 tests), `?debug&seq=cutscene_test` to try it in the demo room.
3. `buildHumanoid` subset (ADR-0006 step 1): two named crew plus three extras, idle and gait.
4. R01 guard post and R02 kitchen blockout, new props (mug, coffee machine, tray, counter).
5. `intro_shift_change.json` and its lines in `slice01.json`; hook `newGame()`.
6. Tests: skip at 0 %, mid-walk and during the mug beat all end in the same state.

## Definition of done
- New game on every difficulty plays the scene; holding the skip key for 3 s ends in the same
  state as watching it (positions, flags, checkpoint, played lines).
- Bars fade in and out exactly when the player is on rails, in any sequence.
- Skip works with assist mode and with remapped keys; the progress bar is readable at 200 %
  UI scale.

## Open questions
- Final banter text and timings (written after step 5, per ADR-0014).
- Kitchen layout (counter versus tables) once R02 is blocked out.
