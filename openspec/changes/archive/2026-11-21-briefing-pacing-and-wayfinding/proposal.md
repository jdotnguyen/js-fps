# Proposal

## Why

The Observation Gallery morning briefing currently breaks early-game pacing and player orientation: its 2 m x 2 m floor trigger is easy to walk past, stepping onto it slams the player back into a locked letterbox cutscene right after the intro, and the scene then freezes in silence for 12–16 seconds while Giles and Okafor walk over from the Commons at 1.3 m/s. Meanwhile, the player has no active objective pointing them to the gallery after the intro, the top-left objective banner disappears after 5 seconds, and there is no compass or nearby objective marker to orient players through the station.

## What Changes

- **Free-roam, talk-while-walking briefing (`morning-briefing`)**:
  - Expand `trig_gallery_brief` in R03 from a 2 m x 2 m center box to full room width starting ~2.2 m (3–4 steps) past `D_R02_R03`, so walking into the gallery triggers reliably without firing from the doorway.
  - Convert `briefing_gallery` from a locked on-rails cutscene into a free-roam in-room scene (no movement lock, no letterbox bars, no blocking camera pans), while keeping it skippable (`skippable: true`) with identical end state.
  - Start Heins's opening line immediately on entry while Giles and Okafor briskly walk to their marks (`wait: false`); after her opening line, snap any straggler still far outside R03 and out of Jay's view into the room so they walk in naturally without popping in view—even if Jay backed into R03 facing the Commons.
  - Stage Sung in R03 before the briefing so her line (`brief_sung_01`) plays from a visible body in the room.
  - Add a new voiced Heins line (`brief_heins_door`, recorded on her pinned Gemini TTS voice `Kore` / `gemini-3.1-flash-tts-preview`) instructing the squad to lock the door behind them; lock `D_R02_R03` once Jay and both squadmates are inside (never locking Jay out), and unlock it when the briefing ends or is skipped.
  - Assign the three morning round objectives (`round_hydro`, `round_dive`, `round_admin`) live when Heins speaks `brief_heins_05`, and complete the new `obj_briefing` objective when the briefing begins.
  - Remove the forced rail-walk from `commons_dawdle` in `commons.json`, keeping Giles's verbal reminder without yanking player control.
- **Persistent objectives, compass, adjacent-room markers, and spotlight tutorial (`hud-wayfinding`)**:
  - Add `obj_briefing` immediately when the intro ends so players know where to go right away.
  - Move the objective HUD from a 5-second top-left banner to a persistent right-side objective list (tucked below toasts, hidden on title/map/letterbox rails), with brief highlight/checkmark transitions and `Tab` emphasis.
  - Add a minimal top-center compass strip showing only `N`, `E`, `S`, `W` cardinals plus active objective markers with distance in metres.
  - Add screen-projected objective markers that appear **only** when the player is in the same room as the objective or a directly adjacent room (1 door hop via `MapModel.doors`): in an adjacent room the marker points at the connecting door; in the same room it points at the objective's target anchor. Give the quiet-half round objectives explicit target anchors so distances and markers are pinpoint-accurate.
  - Add a non-fullscreen post-intro **spotlight callout** tutorial that pauses simulation, dims the scene behind the live HUD compass and right-side objectives, and briefly explains the compass, objective list, and nearby room markers before dismissing cleanly.

## Capabilities

### New Capabilities
- `morning-briefing`: Reliable entry trigger, free-roam talk-while-walking staging, out-of-view squad catch-up, diegetic door lock/unlock, live objective assignment, skip parity, and non-forced Commons dawdle reminder for the Observation Gallery briefing.
- `hud-wayfinding`: Persistent right-side objective list, uncluttered `N/E/S/W` compass with objective markers and distance, room-adjacency-gated screen markers (connecting door when adjacent, exact target when in-room), and the post-intro spotlight callout tutorial.

### Modified Capabilities
<!-- No existing spec requirements are weakened or contradicted: intro-sequence's separation and skippability of the briefing remain intact, and scene-gathering's drop/climax gatherIn behavior is unchanged. -->

## Impact

- **Sequences & Level Data**: `src/data/sequences/briefing_gallery.json`, `src/data/sequences/commons.json`, `src/data/levels/slice01.json`, `src/data/objectives.json`, `src/data/dialogue/slice01.json`, `public/assets/vo/brief_heins_door.mp3`, `scripts/vo-takes.json`, `docs/scripts/briefing_gallery.md`.
- **Script / Squad Integration**: `src/script/actions.ts`, `src/script/gameHost.ts`, `src/ai/npcs.ts`, `src/ai/squad.ts` (out-of-view room catch-up helper / conditional door lock guard).
- **UI & Wayfinding**: `src/ui/objectives.ts`, `src/ui/hud/objectiveHud.ts`, new compass & adjacency-marker HUD modules under `src/ui/hud/` and `src/ui/wayfinding.ts`, `src/ui/tutorials.ts`, `src/ui/tutorialPrompts.ts`, `src/ui/styles/map.css`, `src/ui/styles/hud.css`, `src/ui/styles/tutorial.css`, `src/game/guidance.ts`, `src/main.ts`.
- **Tests**: `src/script/briefing.test.ts`, `src/script/quiet.test.ts`, `src/world/slice01.test.ts`, `src/ui/objectives.test.ts` (or new wayfinding/compass unit tests), `src/ui/tutorials.test.ts`.
