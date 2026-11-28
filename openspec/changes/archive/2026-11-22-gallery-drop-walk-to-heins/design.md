# Design

## Context

See proposal.md for why. The drop is the `drop` sequence in `src/data/sequences/drop.json`, `exclusive: rails`, triggered by `trigger:gallery_enter` with `rounds_done` and without `drop_done`. Everything needed already exists as script actions:

- Letterbox bars follow `cutscene.barsOn`: a sequence is running **and** the player is `onRails`. Bars therefore come and go with `playerControl`, with no new step.
- `playerWalkTo` (with `wait` and `timeout`, which snaps Jay there if blocked) walks him to `drop_jay`.
- `squadCatchUpIn` (as used by `briefing_gallery`) moves a squadmate who is outside the room to an unseen spot, `at` an anchor, and leaves visible ones walking.
- `doorState ... ifAllIn` seals only when everyone is in the room.

`drop.json` is currently modified and uncommitted in the shared tree: it carries another agent's Lab B blackout rework (`ductBang`, `duct_r04`, the `gunDrawn` step). `holster-drop-pieces-pending` records that the `gunDrawn` step and its tests wait on that rework. This change edits the same file, so the opening and kill sections are edited in place and the blackout section is left as it is apart from a short hold around it.

## Goals / Non-Goals

**Goals:**
- A deterministic opening: Jay at `drop_jay`, squad beside him, door sealed, then the blinds line.
- Jay free during the kill, with the kill's timers unchanged.
- A short controlled hold at the ambush so the pistol and the camera are not left to chance.

**Non-Goals:**
- Changing the kill itself (`kill` step, Voss lines, alarm and bloom timing).
- Changing the blackout and ambush content owned by the Lab B rework.
- New script actions or engine work.

## Decisions

1. **Rails opening, then `playerControl` free.** (`drop_jay` moves to the middle of the gallery, 8,0,18.6, about 1.8 m from Heins, and a `playerLookAt` on Voss runs during and after the walk, instead of facing Heins.) The sequence starts with `playerControl` rails (no move, no weapons, no interact), walks Jay with `playerWalkTo drop_jay` (`wait`, `timeout` ~6 s, speed ~1.6), and releases to free look and move with weapons and interaction off once Heins's line has started. Alternative: keep `move: slow` and a forced `playerLookAt`. Rejected, because the camera pull is what the user does not want and the slow-walk bars made the scene feel locked anyway.

2. **Catch up the squad inside the walk, not before it.** `squadCatchUpIn R03 at anchor:gallery_enter` runs in parallel with the walk; `npcMoveTo` to `brief_giles` and `brief_okafor` follows, so both flank Jay. `gatherIn` and its 8 s timeout go. The sequence is on rails, so Jay cannot leave and there is nothing to wait for. Alternative: keep `gatherIn` and add the walk. Rejected: it keeps the visible straggler placement.

3. **Seal after the walk with `ifAllIn R03`.** Same guard as the briefing, so a failed catch-up never shuts a squadmate out. The `scene-gathering` rule still holds.

4. **Blinds already up; Heins stays quiet.** `rounds_return` emits `blinds:set { id: labb, state: up, instant: true }`, so they are up unseen when Jay arrives, and `quiet_restore` raises them for `rounds_done` (not only `drop_started`) so a load after the rounds matches. `drop_heins_01` ("Blinds up. ...") leaves the sequence; its VO file stays unused. Alternative: a new Heins line without "Blinds up", rejected for now as it needs fresh VO.

4a. **Trigger.** The drop listens to `trigger:gallery_brief_spot` (`trig_gallery_brief`, x up to 11.8) instead of `trigger:gallery_enter` (x up to 13.7, the doorway). `?jump=drop` in `session.ts` places Jay at `gallery_enter` minus 1 m, which is now outside that box; it moves to inside it. Alternative: shrink `trig_gallery_enter`, rejected because other sequences (commons) use it for the doorway.

4b. **Voss starts first, Okafor releases her.** The `kill` step starts at the top of the sequence, in a `parallel` with a `loop count: 1` branch that holds the walk, catch-up, seal and `say drop_okafor_01`. The `kill` step's `lines.scratch` in `drop.json` (the cue that closes the scratch beat) becomes `drop_okafor_01`. In `kills.json` `grownInside` the scratch `max` rises from 6 to about 16 so a slow walk cannot cut it short, and `voss_panic_breath` repeats about every 2.8 s through the beat. `drop_voss_01` ("it's under my skin") is still said on `kill:scratch`. `drop_okafor_02` ("She's seizing...") moves from `kill:scratch` to `kill:panic`, so it plays as she runs to the glass. The `lines.glass` cue and the glass, arch, burst and still beats are unchanged.

5. **Free kill via the existing parallel block.** The kill's `parallel` stays as it is; only the leading `playerLookAt` goes. Control is `playerControl { move: 'free', look: 'free', weapons: false, interact: false }`. `drop_okafor_01` ("Who's that in there?") is checked so it works without the look.

6. **Hold at the ambush as `playerControl` rails without bars.** Bars are tied to `onRails` (decision 1's mechanism), so a hold with no bars needs either an `onRails` variant that does not show them or a `move: none` control that is not `onRails`. The apply phase checks which `playerControl` fields give "controls held, no bars" and picks the one that does, rather than adding a step. Weapons are given with the existing `gunDrawn` step, and the drop checkpoint is unchanged.

7. **Rounds stop pre-positioning the squad.** Remove the two `npcFollow ... stay` steps at the end of `rounds_return`; `round_return` still targets `drop_jay`. Giles and Okafor then keep following Jay until the drop.

## Risks / Trade-offs

- [`drop.json` mixed with the uncommitted blackout rework] → edit only the opening and the `playerLookAt`/control steps; commit with the rework or after it, per `shared-index-commits`.
- [Catch-up pops a squadmate in view] → `squadCatchUpIn` prefers unseen spots; bars and the walk give extra cover; verify in the browser from the Commons side.
- [A slow walk outlasts the scratch beat's cap] → the cap is about 16 s against a typical 5-8 s walk; if it is ever hit she runs to the glass early, which is the old safe behaviour.
- [The long scratch beat feels repetitive] → the breath repeats on a timer and the pose loops; check in the playtest, and vary the breath sample if it grates.
- [Free look during the kill hides the glass beats] → the kill is audible and lit (scratching, alarm, flicker); watch it in a playtest with Jay facing away.
- [Hold without bars may not be expressible] → decision 6; if not, accept bars on for the 3 s hold and tell the user.
- [`gather.test.ts` and `quiet.test.ts` assert the old structure] → rewrite them to the new order (see tasks).

## Migration Plan

Data and test changes only, so there is no data migration. Saves from after `rounds_done` but before the drop now load with the blinds up (`quiet_restore`). Older saves with `drop_started` set but `drop_done` unset already restart the drop from the beginning (`session.ts` and `quiet_restore`). Saves after `drop_done` are unaffected. Rollback is reverting the two JSON files.
