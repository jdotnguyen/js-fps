# ADR-0016: Save system and game state

Status: Accepted (save model, slots) / Proposed (schema details)
Supersedes: ADR-0001 "Persistence: no save system in the slice [Open]".

## Context
Justin asked for a launch menu and saved state for games and settings, including
difficulty. Dead Space tension depends on *where* you can save. Chapters will be added
for a long time, so saves must survive game updates.

## Decision
- **Checkpoint autosave + save stations** [Decided]. The game autosaves when the player
  reaches a checkpoint. Manual saves happen only at in-world save terminals (never
  mid-fight, never from the pause menu).
- **Three slots** [Decided]. Each slot is one playthrough and keeps two entries: its latest
  autosave and its last manual save. Loading offers both.
- **Continue** loads the most recent entry across all slots.
- Saves and settings live in `localStorage` as versioned JSON. [Assumed]
- Difficulty is stored **per save** (the playthrough's difficulty) and can be changed from
  the pause menu at any time (ADR-0008). Settings are global.

## Details

### Save schema (version 1)
```json
{
  "version": 1, "kind": "auto", "slot": 0, "savedAt": "2026-11-16T03:20:00.000Z",
  "playTime": 754.2, "difficulty": "standard",
  "chapter": "slice01", "level": "demo-room",
  "checkpoint": "cp_window", "location": "Lab B - observation window",
  "player": { "position": [0, 1.62, 1.2], "yaw": 0.1, "pitch": -0.05, "health": 100, "flashlightOn": true },
  "flags": { "cp:cp_start": true, "cp:cp_window": true }
}
```
- Keys: `js-fps:save:slot<N>:auto`, `js-fps:save:slot<N>:manual`, `js-fps:save:lastSlot`.
- `flags` is the extensible bag for story state (sequence flags, doors, pickups) until
  ADR-0009 checkpoint snapshots define richer state.
- Every read goes through a validator; a damaged entry is reported as "damaged" in the
  menu (with a delete option) and never crashes the game.
- **Migrations:** `version` increases whenever the schema changes; `MIGRATIONS[n]` turns a
  version-n object into version n+1. A save from a *newer* game version is reported, not
  loaded.

### Game modes
`title` (attract camera drifts down the corridor behind the menu, ambience playing) ->
`playing` (simulation runs, pointer locked) <-> `paused` (Esc / lost pointer lock; scene
keeps rendering, ambience ducked). Save terminals open an in-game save screen and pause.

### Menus (plain DOM, keyboard navigable)
- Title: Continue (if any save), New Game, Load Game, Settings.
- New Game: choose slot (overwrite confirm) -> choose difficulty -> play.
- Load Game: per slot, the autosave and manual save with location, difficulty, play time and
  date; delete with confirm; damaged entries flagged.
- Pause: Resume, Difficulty, Settings, Load Game, Quit to Title (warns that progress since
  the last save is lost).
- Settings: mouse sensitivity, invert Y, field of view, quality, film grain, master volume,
  subtitles, reduced flashing, reduced motion. Saved immediately.

## Consequences
- Every future system that changes world state must write into the save's `flags` (or a
  dedicated field added through a migration) to persist.
- `localStorage` is per-browser and per-origin; there is no cloud sync. [Open: export/import]

## Execution steps
1. Storage wrapper, save schema + validator + migrations, SaveStore (Node-tested).
2. Difficulty presets data file (ADR-0008 values) + validator.
3. Game state machine; checkpoint autosaves; save terminal in the demo room.
4. Menu framework and screens; toasts; settings applied live.

## Definition of done
- New game -> walk past the checkpoint -> quit -> Continue resumes at the checkpoint.
- Manual save at the terminal appears in Load Game for that slot next to the autosave.
- Corrupting a save in DevTools shows "damaged" in the menu instead of crashing.
- All settings persist across reloads.

## Progress log
- 2026-11-15: Implemented. `core/storage.ts`, `game/save.ts` (schema v1, validator, migrations,
  SaveStore, damaged-entry reporting), `data/difficulty.json` + validator (ADR-0008 presets),
  `game/game.ts` (modes, checkpoints, save terminal interaction, attract camera, pause
  ducking), `ui/menus/` (title, new game, load, settings, difficulty, pause, save station),
  toasts, a save terminal on the left wall near the start, three checkpoints in the demo
  corridor (entrance, window, pressure door).
  Verified in sandbox: 63 unit tests incl. round-trip, newest-entry selection, damaged JSON and
  invalid fields reported (not thrown), newer-version refusal, migration chain, slot clearing,
  shipped difficulty.json. **Not yet verified:** the menus in a browser, pointer-lock flows.

