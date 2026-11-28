## Why

The Observation Gallery drop starts the moment Jay touches the gallery trigger box, wherever he stands and whatever Giles and Okafor are doing. The two walk there on their own after the rounds (`npcFollow ... stay`), so they can be late, stuck or in his sightline, and `gatherIn` then places them after 8 seconds where he may see it. The result is an unreliable opening for the game's first big beat. Giving the scene a short, controlled opening that puts everyone where they need to be fixes this at its source.

## What Changes

- The drop starts only once Jay is a few steps inside the gallery (`trigger:gallery_brief_spot`, the briefing's box, after `rounds_done`, before `drop_done`), not at the doorway (`trigger:gallery_enter`). It opens with a short rails segment with black bars: Jay walks to `drop_jay`, now the middle of the gallery about 1.8 m from Heins, with his view on Voss throughout.
- During that walk, Giles and Okafor are caught up into R03 with `squadCatchUpIn` (unseen or behind Jay where possible) and then flank him. This replaces `gatherIn` and the straggler timeout.
- `D_R02_R03` seals at the end of the walk, once all three are inside.
- The blinds are already up when Jay arrives: they rise instantly when the rounds finish (`rounds_return`), and a load after `rounds_done` restores them up. Heins no longer says "Blinds up" (`drop_heins_01` leaves the scene).
- Voss is already distressed as the drop starts: she says "it's under my skin" and keeps up her stressed, laboured breathing and scratching while Jay walks in, until Okafor's "Who's that in there? Is that Voss?" ends. Then she runs to the glass. `drop_okafor_02` plays as she runs.
- After Okafor's line, Jay has free roam (move and look free, weapons and interaction off) through the Voss kill. The forced `playerLookAt` pull toward Voss is removed; the kill, alarms, lights and lines keep their timers.
- A short hold of about 3 seconds returns at the lights-out, vent and ambush beat, with bars off. Weapons are given on `gunDrawn` as now, then control returns and `cp_drop` is taken.
- `rounds_return` no longer sends Giles and Okafor to `stay` at the gallery anchors; the drop owns their placement.

## Capabilities

### New Capabilities
- `gallery-drop`: how the Observation Gallery drop opens (walk to Heins on rails, squad placement, door seal, blinds already up, Voss's distress until Okafor's line), when Jay is free during the Voss kill, and the short hold at the ambush.

### Modified Capabilities
- `scene-gathering`: the gallery drop no longer waits with `gatherIn` before sealing `D_R02_R03`; it catches the squad up during the walk and seals at its end.

## Impact

- `src/data/sequences/drop.json`: new opening, free-roam kill, ambush hold. This file also carries another agent's uncommitted Lab B blackout rework, so edits must be made on top of it rather than from `HEAD`.
- `src/data/sequences/rounds.json`: remove the two `npcFollow ... stay` steps at the end of `rounds_return`, and raise the Lab B blinds there.
- `src/data/sequences/quiet_restore.json`: blinds up from `rounds_done`, not only `drop_started`.
- `src/data/kills.json`: the `grownInside` scratch beat repeats the breath, ends on Okafor's line and lasts longer.
- `src/app/session.ts`: `?jump=drop` places Jay inside the new trigger box.
- `src/script/gather.test.ts` (asserts `gatherIn R03` right before the seal) and `src/script/quiet.test.ts` (the drop tests) need updating.
- Skip and restore paths: `session.ts` `?jump=drop`, `quiet_restore`, `test_drop.json`.
- Dialogue that played under a forced look (`drop_okafor_01`, "Who's that in there?") must still read when Jay faces elsewhere.
- Docs: the drop lines in `docs/PLAYTEST.md`.
- No engine changes expected; every step used already exists.
