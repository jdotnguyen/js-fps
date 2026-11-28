# Design

## Context

See [proposal.md](proposal.md) for the user-facing pacing and wayfinding problems this change solves.

Key codebase constraints:
- **Briefing staging (`src/data/sequences/briefing_gallery.json`, `src/data/levels/slice01.json`)**: R03 is `x: 2..14, z: 14..22`, entered on the east side through auto-door `D_R02_R03` (`x = 14, z = 16`). `trig_gallery_brief` is currently a 2 m x 2 m box at `x: 7..9, z: 16.4..18.4`. `briefing_gallery` currently locks control (`move: locked`), blocks on `npcMoveTo(..., wait: true)` for `giles` and `okafor` at `1.3 m/s`, and runs 8 blocking `playerFrame` waits.
- **Squad & NPC systems (`src/ai/squad.ts`, `src/ai/npcs.ts`, `src/script/actions.ts`)**: Squadmates cannot be despawned (`despawn` warns and no-ops), but `npcMoveTo(..., instant: true)` teleports and resets seated/leaning poses, and `squadRegroup` already checks `inPlayerView` before moving a far squadmate behind Jay. `gatherIn` currently blocks up to 8 s and is used by `drop.json` and `action_climax.json` (which must remain unchanged).
- **Door mechanics (`src/world/level.ts`)**: `D_R02_R03` is a `pressure_slide` auto-door that opens for Jay (`< 2.6 m`) and NPCs (`< 1.8 m`) when `closed`, and blocks everyone when `locked`.
- **Voice casting (`docs/voice-casting-standard.md`)**: Katie Heins (`chief`) is pinned to Gemini TTS voice **`Kore`** on **`gemini-3.1-flash-tts-preview`**. New dialogue lines must be added to `src/data/dialogue/slice01.json`, generated via `scripts/vo-generate.ts`, and logged in `scripts/vo-takes.json`.
- **Wayfinding & Tutorials (`src/game/guidance.ts`, `src/ui/objectives.ts`, `src/ui/hud/objectiveHud.ts`, `src/ui/mapModel.ts`, `src/ui/tutorials.ts`, `src/ui/tutorialPrompts.ts`)**: `MapModel.doors` already encodes the full room-to-room adjacency graph (`rooms: [a, b]` and door `center`). `TutorialPrompts` hooks `intro:ended` and pauses the simulation while `blocking` is true. `src/main.ts:614` currently defines `guidance.busy()` as including `sequences?.skippable ?? false`.

## Goals / Non-Goals

**Goals:**
- Make R03 briefing entry effortless, immediate, free-roam, and glitch-free regardless of where Giles and Okafor are or which way Jay faces when walking in.
- Lock `D_R02_R03` diegetically during the briefing with a voiced Heins cue, without ever locking Giles, Okafor, or Jay on the wrong side of the door.
- Keep `briefing_gallery` skippable with identical end state (and never let a skip leave `D_R02_R03` locked).
- Provide always-visible, low-clutter wayfinding: persistent right-side objective list, `N/E/S/W` top compass with objective markers and distance, and adjacent-room-only screen markers (connecting door when 1 room away, target when in-room).
- Introduce the compass and objective list right after the intro via a non-fullscreen spotlight overlay rather than adding another heavy modal wall.

**Non-Goals:**
- Reworking `intro_shift_change`, the three round wing sequences (`rounds.json`), or `drop.json` (explicitly deferred to later changes).
- Changing `gatherIn` behavior for `drop.json` or `action_climax.json` (`scene-gathering` spec).
- Replacing the `M` station map or `Q` floor nav-pulse (both continue working alongside the compass and objective list).

## Decisions

### 1. Trigger geometry and free-roam briefing cadence
- **Decision:** Widen `trig_gallery_brief` in `slice01.json` from `[[7,0,16.4],[9,2.2,18.4]]` to `[[2.3,0,14.3],[11.8,2.6,21.7]]` (~2.2 m past `D_R02_R03`, full room depth). Remove `playerControl` lock, `playerWalkTo`, and blocking `playerFrame` steps from `briefing_gallery.json`, keeping `"skippable": true`.
- **Rationale:** Covers every possible path into R03 after 3–4 steps while keeping the doorway threshold (`x: 11.8..13.7`) safe from accidental triggers. Without `move: locked`, `CutsceneController.barsOn` stays false so no letterbox bars appear, while `skippable: true` preserves hold-to-skip parity (`intro-sequence` spec).
- **Alternative considered:** Keeping `move: slow` or locking with a fade-cut. Rejected because the player explicitly wants free-roam after just finishing the on-rails intro, and `briefing_gallery` already plays naturally in-room.

### 2. Talk-while-walking + out-of-view squad catch-up + guarded door lock
- **Decision:** Add a focused sequence action (or extend squad placement on `SequenceHost`) — e.g. `squadCatchUpIn` `{ room: "R03", at?: "anchor:gallery_enter" }` — plus a guarded lock helper (or `if` / hook):
  1. At `t = 0`: `completeObjective obj_briefing`, stage `sung` in R03 (if not already placed — actually place Sung in R03 at the end of `intro_shift_change` or via an `npcMoveTo` with `instant: true` at `commons_free` / pre-briefing so she never visibly pops inside R03 when Jay walks in!), kick off brisk non-blocking `npcMoveTo` (`speed: 2.2`, `wait: false`) for `giles -> brief_giles` and `okafor -> brief_okafor`, and immediately start `brief_heins_01`.
  2. At `t ≈ 2.5 s` (right after `brief_heins_01`): run out-of-view catch-up for any squadmate still outside R03:
     - If `!inRoom(mate, 'R03')` AND `!canSee(mate.position)`: place the mate just inside R03 (`gallery_enter`, or `spawnSpot` inside R03 behind Jay if Jay is looking at the doorway!) and re-issue brisk `npcMoveTo` (`speed: 2.2`, `wait: false`) to their mark.
     - If Jay is actively staring straight through the open doorway at a squadmate walking in from Commons: do **not** pop them; let them keep brisk-walking (`2.2–2.6 m/s`) into R03, and give a short bounded wait (or check again right before locking `D_R02_R03`) so the door never slams shut on them while they're visible in the doorway.
  3. Lock beat: once both squadmates are inside R03 (or snapped behind Jay/closed door), play `brief_heins_door` (e.g., *"Hit the lock on that door — keep the hall noise out."*) and, **only if `inRoom('player', 'R03')`**, play a lock `sfx` and set `D_R02_R03` to `locked`.
  4. On normal end AND on skip: always run `doorState D_R02_R03 closed` (so skipping mid-briefing never leaves R03 locked!) and ensure `giles` and `okafor` end at `brief_giles` / `brief_okafor` (standard `npcMoveTo` skip behavior).
- **Staging Sung without pop-in:** In `intro_shift_change.json`, Sung walks off to `crew_sung_commons`; when `commons_free` starts (after the intro finishes, while Jay is in Commons looking at Bram/Priya/squad — or in `slice01.json` once Jay approaches `trig_commons_to_gallery` when Sung is out of view, or simply moving Sung's post-intro destination to an R03 briefing anchor like `brief_sung`), Sung is already waiting in R03 before Jay opens `D_R02_R03`. Having Sung walk to `brief_sung` (R03) or placing her there when `briefing_gallery` hasn't run yet is far cleaner than popping her inside R03 after Jay enters. Wait: if `intro_shift_change` already sends Sung to `crew_sung_commons` (required by `intro-sequence` spec: *"Both SHALL then walk on to their own spots in the Commons"*), we keep `intro_shift_change` untouched and have `commons_free` send Sung walking to `anchor:brief_sung` in R03 right after the intro ends (so she naturally heads to the briefing room ahead of Jay!). If Jay beats her there, she walks in right alongside/ahead of the squad.
- **Alternative considered:** Reusing `gatherIn R03` before Heins talks. Rejected because `gatherIn` blocks dialogue for up to 8 seconds, recreating the exact dead-air bug.

### 3. Persistent right-side objective list + live briefing hand-out
- **Decision:**
  - Add `obj_briefing` to `src/data/objectives.json` (`"title": "Observation gallery: attend the morning briefing"`, `"target": "anchor:brief_jay"`, `"area": "gallery"`). Start it at the beginning of `commons_free` (right when `intro_shift_change` ends); complete it at the start of `briefing_gallery`.
  - In `briefing_gallery.json`, place `setObjective` for `round_hydro`, `round_dive`, and `round_admin` immediately before/beside `brief_heins_05` (using a `parallel` block or firing right as `brief_heins_05` starts) so they pop onto the right-side HUD while Heins speaks them.
  - Refactor `ObjectiveHud` (`src/ui/hud/objectiveHud.ts`) and `ObjectiveBanner` (`src/ui/objectives.ts`) from an auto-hiding 5 s top-left banner into a persistent right-side list (`.objective-hud` anchored at `right: 1.5rem`, positioned cleanly under `.toasts`, right-aligned border accent). Keep a transient `recentlyDone` buffer (~3.5 s) so completed objectives briefly display with a green `✓` before disappearing, and keep `recentlyAdded` highlight + `Tab` pulse animation.
  - Hide `.objective-hud` via CSS/visibility when `.cine.on` (letterbox bars), map open, or title screen.
- **Alternative considered:** Putting objectives at top-right above toasts. Putting `.toasts` at top-right (`top: 1.5rem`) and `.objective-hud` below (or stacked in one right-side flex column so toasts and objectives can never overlap!) guarantees zero collision even when multiple toasts fire at once (e.g., checkpoint + pickup). Using a shared right-rail container or reserving top margin cleanly prevents overlap.

### 4. Uncluttered `N / E / S / W` compass + room-adjacency screen markers
- **Decision:** Split pure math from DOM rendering (matching the repo's `mapModel.ts` / `objectives.ts` / `tutorials.ts` pattern so everything is unit-tested in Node without DOM/Three.js):
  - **Pure module (`src/ui/wayfinding.ts`)**:
    - `compassMarks(playerPos, playerYaw, targets)`: computes relative signed bearing `[-PI, PI]` for the 4 cardinals (`N = 0 rad / -Z`, `E = -PI/2 / +X`, `S = PI / +Z`, `W = +PI/2 / -X` — matching Three.js camera yaw convention `forward = (-sin(yaw), -cos(yaw))`) and each active objective target, returning normalized horizontal strip position `[-1, 1]`, `clamped: boolean`, and rounded metre distance.
    - `roomAdjacency(doors: readonly MapDoor[])`: builds an undirected `Map<string, MapDoor[]>` from `MapModel.doors`.
    - `worldMarkerTarget(playerRoom, objectiveRoom, objectivePos, doors)`:
      - If `playerRoom === objectiveRoom`: returns `{ kind: 'target', pos: objectivePos }`.
      - Else if a door in `doors` directly connects `playerRoom` and `objectiveRoom`: returns `{ kind: 'door', pos: { x: door.center[0], y: door.deck * MAP_DECK_H + 1.4, z: door.center[1] } }` (choosing the nearest connecting door if multiple exist).
      - Else (`>= 2` rooms away, or unknown room): returns `null` (marker hidden).
  - **Concrete quiet-half objective targets (`src/data/objectives.json` + `src/game/guidance.ts`)**:
    - `obj_briefing` -> `anchor:brief_jay` (in R03)
    - `round_hydro` -> `anchor:hydro_log` (in R14)
    - `round_admin` -> `anchor:hale_desk` (in R12)
    - `round_dive` -> dynamic target in `guidance.targetOf()`: `anchor:dive_case_pickup` while `!holds('sample_case')`, then `anchor:dive_case_locker` once `holds('sample_case')` (or optional `altTarget` / flag-aware target in `objectives.json`).
  - **HUD renderers (`src/ui/hud/compassHud.ts`, `src/ui/hud/worldMarkerHud.ts`)**:
    - `.compass-hud`: slim top-center visor strip (`width: min(26rem, 62vw)`, `top: 1rem`) showing only `N`, `E`, `S`, `W` ticks plus objective diamond pips with metre readouts.
    - `.world-markers`: projects active visible targets through the active `THREE.PerspectiveCamera` into viewport coordinates (hidden when behind the camera or outside a small edge margin, since the top compass already shows off-screen direction!).
- **Alternative considered:** Showing in-world markers based on Euclidean distance (e.g., `< 20 m`). Rejected because rooms in a compact underwater station overlap closely across bulkheads—a 20 m radius would show markers through walls for rooms 3 doors away. Using `MapModel.doors` adjacency implements the exact "same or adjacent room" rule cleanly.

### 5. Non-fullscreen post-intro spotlight callout
- **Decision:** Extend `TutorialPrompts` (`src/ui/tutorials.ts`, `src/ui/tutorialPrompts.ts`, `src/ui/styles/tutorial.css`) with a **`spotlight` presentation mode** for a new `wayfinding` prompt chained right after `look` (or triggered on `intro:ended`):
  - Renders a darkened backdrop (`.tutorial.spotlight`, `background: rgb(2 6 8 / 0.62)`, no blur on the HUD!) at `z-index: 11`, pausing simulation via the existing `tutorials.blocking` mechanism.
  - Adds a `.hud-spotlight` class on `#ui` (or directly on `.compass-hud` and `.objective-hud`) elevating **only** the live compass strip and right-side objective list to `z-index: 12` with a soft visor outline glow so they read clearly above the dim backdrop.
  - Displays a compact callout card anchored below the compass / near the right side (not a giant centered full-screen modal) with 3 crisp bullets:
    - **Compass (top):** shows objective direction and distance.
    - **Objectives (right):** stays visible with your current tasks.
    - **Room markers:** appear in-world only when you're one room away.
  - Dismissible with `Space`, `Enter`, `Tab`, or mouse click (and `Esc` still pauses as usual), saved to `tutorialsSeen` under `'wayfinding'`.
  - Make sure `ObjectiveHud` and `CompassHud` stay rendered while the `wayfinding` spotlight is open (even while `tutorials.blocking` is true!) so the player sees the real `obj_briefing` entry and live compass bearing highlighted in place.
- **Alternative considered:** Full-screen centered tutorial modal. Rejected by the user in favor of highlighting the actual live HUD widgets over a dark backdrop while paused.

### 6. `commons_dawdle` and `guidance.busy()` cleanup
- **Decision:**
  - In `src/data/sequences/commons.json`, remove the forced rail-walk (`commons_dawdle`) or convert it to a non-locking verbal nudge (`commons_giles_hey_01` / `commons_giles_hey_02` without `playerControl: locked` or `playerWalkTo`) so players exploring Commons are never yanked onto rails.
  - Keep `guidance.busy()` hiding hints/barks during `briefing_gallery` (`sequences?.skippable`), while allowing `ObjectiveHud`, `CompassHud`, and `WorldMarkerHud` to remain visible during free-roam sequences (they key off `!player.onRails && !mapOpen`, not `guidance.busy()`!).

## Risks / Trade-offs

- **Risk: `D_R02_R03` locks while Giles or Okafor is still stuck outside R03** → Mitigation: Run out-of-view catch-up *before* locking `D_R02_R03`, and if Jay was staring at them through the doorway, allow a short bounded grace window (or wait until `inRoom` holds / door slides closed to snap) before setting `locked`. On skip, always place them at `brief_giles` / `brief_okafor` and set `D_R02_R03` to `closed`.
- **Risk: `D_R02_R03` locks Jay outside R03 if he backs out in the first 2 seconds** → Mitigation: Guard the `doorState locked` step with `inRoom('player', 'R03')` (skip locking if Jay stepped out).
- **Risk: Free-roam `skippable: true` vs Spacebar jump** → Mitigation: Hold-to-skip already requires holding Space for `skipHoldSeconds` (default 3 s) and drains at 3x speed on release, so normal jump taps never trigger a skip. Still, verify in playtest that the skip prompt doesn't feel intrusive during free-roam.
- **Risk: Existing tests assert `briefing_gallery` locks movement (`control.state.move === 'locked'`) and `commons_dawdle` walks on rails** → Mitigation: Update `src/script/briefing.test.ts` and `src/script/quiet.test.ts` to assert the new free-roam briefing contract, guarded door lock/unlock, live objective hand-out, and non-locking dawdle reminder.
- **Risk: Gemini TTS free-tier daily quota (10 requests/day on `gemini-3.1-flash-tts-preview`) for `brief_heins_door`** → Mitigation: Single 1-line request on `Kore` / `gemini-3.1-flash-tts-preview` (`node --experimental-strip-types scripts/vo-generate.ts --ids brief_heins_door --apply`), and `voice-playback` emote fallback keeps gameplay working even if audio generation is deferred.
