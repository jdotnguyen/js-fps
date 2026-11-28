# Proposal

## Why

Every reflective surface in the station shows the same fake studio. One generic `RoomEnvironment` is filtered once at startup (`src/app/session.ts`) and used as the reflection for every room. Steel, glass and wet floors therefore never pick up a room's colour: Hydroponics' green, the gallery's warm lamps, the alarm red or the blackout. Ambient light is a flat two-colour hemisphere per room preset, so characters and props don't take on the light around them. Exposure is also fixed, so walking from the bright Commons into a dark corridor never reads the way eyes would see it. With r187 and the pmndrs post chain in place, all three can be fixed without new lights.

## What Changes

- **Per-room reflections.** Each room is captured once into its own reflection environment, from its centre (or an authored point), lit as it actually is. The room the camera is in supplies the reflections, and the swap cross-fades when the camera changes rooms. A room is captured again when its lighting changes: station power, an alarm tint, lights switched off.
- **Room-coloured bounce light.** The same capture yields a room's bounce light. Characters and props in the room the player is in pick up its colours from the direction they come from: a warm lamp side, a green grow-light side. The authored ambient preset still sets the overall strength, so rooms keep their tuned brightness.
- **Eye adaptation.** Exposure adjusts slowly to how bright the view is. It brightens over a few seconds in a dark room and drops faster in a bright one. The range is capped, so dark rooms stay dark and the blackout still calls for the flashlight. Brief flashes such as muzzle flashes and sparks don't pump the exposure. A Settings toggle turns adaptation off.
- **The generic studio environment is removed** from the station level. The lab world and the sandboxes keep it unless they opt in.

## Capabilities

### New Capabilities

- `environment-lighting`: how each room's surroundings light and reflect in it. Covers per-room reflections and their hand-over between rooms, room-coloured bounce light, and keeping both current when a room's lighting changes.

### Modified Capabilities

- `post-processing`: adds eye adaptation, its limits and its Settings toggle, to the post chain's behaviour.

## Impact

- **Code:**
  - `src/app/session.ts`: drops the global studio environment for the station, and adds the Settings toggle.
  - `src/world/level.ts`: room captures, the current-room hand-over, recapture triggers, and the light probe beside the existing hemisphere ambient.
  - `src/render/post.ts`: luminance and adaptation passes; the grade applies the adapted exposure before tone mapping.
  - `src/core/settings.ts` and `src/ui/menus/screens.ts`: the "Eye adaptation" toggle, beside "Film grain".
  - New: a room capture module, and a reflection blend pass.
- **Data:** an optional per-room capture point in level data (`atmosphere`), with validation.
- **Specs:** new `environment-lighting`; `post-processing` delta.
- **Memory:** one filtered reflection map per captured room, so the number kept at once is bounded. Checked with `?slot=scratch&memprobe` against `runtime-memory` (no growth over a session; released on return to title).
- **Performance:** a capture is a few room renders spread over frames, never all in one frame. Judged against the `render-quality` floor in R03 and the commons at High.
- **Independent of `shadow-rich-rooms`:** it touches different code, except `level.ts`, where each change edits a different part, and captures do not use shadow spots. They can land in either order.
- **Not in this change:** box-projected (parallax-corrected) reflections, screen-space reflections, baked lightmaps, volumetrics.
