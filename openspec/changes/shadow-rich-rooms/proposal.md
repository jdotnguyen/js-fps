# Proposal

## Why

Shadows do more for the station's mood than anything else in the lighting, yet a room only gets a few: 2 shadow lights on Medium and 6 on High. They go to the lights nearest the camera, whether or not their light is on screen. A shadow can also appear or vanish in a single frame as the player walks, and every shadow light redraws its map every frame even when nothing in its reach has moved. Now that the r187 upgrade and frustum-clipped portal culling have landed, the shadow pool is the next limit on how rich a room can look. This change spends it on what the player sees, makes each shadow light cheaper, and adds shadow detail that needs no new lights.

## What Changes

- **Shadow lights go to what is on screen.** Within the visible rooms, an opted-in light whose lit area is in view ranks ahead of one whose lit area is not. Distance and the current room still break ties. A light keeps its shadow until a better candidate has outranked it for a short hold, so walking around does not swap shadows back and forth.
- **Shadows fade instead of popping.** A light that gains or loses its shadow fades it in or out over a fraction of a second.
- **Shadow maps are cached.** A shadow light redraws its map only when something that moves is inside its reach, when it moves itself, or when it is newly bound. Walls and furniture are drawn once. This makes room for more shadow lights, but the tier counts change only if measurements show headroom (see design).
- **Swaying lights.** A pendant can be authored to sway, and a shotgun shot nearby, a bullet hitting the fixture or a scripted jolt can set a lamp swinging. The shade and its light move together, so shadows swing across the room.
- **Light patterns (cookies).** A shadow-casting light can project a pattern: a grille, a vent fan whose blades turn, a cracked lens. The flashlight beam gets a subtle lens pattern.
- **Characters stay grounded.** Every character gets a soft contact shadow at its feet on every tier, including characters beyond the character-shadow distance and rooms with no shadow light.
- **A lighting debug overlay** (debug builds only): each light's cone and range, whether it holds a shadow, a fill light or nothing, and how many shadow maps were redrawn this frame.
- **Pilot room:** R03, Observation Gallery. Its four shadow lights, the sofa and Heins are the reference scene for every step.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `render-lighting`: shadow lights are allocated by view with a hold, and shadows fade on hand-over. Adds cached shadows that stay correct while things move, swaying lights, light patterns and character contact shadows.
- `player-flashlight`: the beam projects a subtle lens pattern.

## Impact

- **Code:**
  - `src/world/shadowPool.ts`: on-screen ranking, the hold, fades and cached redraws.
  - `src/world/level.ts`: passes the camera frustum to the pool, registers moving casters, sways pendants.
  - `src/render/flashlight.ts`: the lens pattern.
  - `src/world/kit/slice.ts` (`pendant_light`): a swaying pendant is built unmerged.
  - `src/actors/humanoid.ts`: the contact shadow, plus moving-caster registration.
  - Doors, gore chunks and held props register as moving casters.
  - The level data types and validation get the `cookie` and `sway` light fields.
  - `src/render/tiers.ts`: counts the texture units that patterned spots use.
  - New: a cookie texture module and the debug overlay.
- **Data:** `src/data/levels/slice01.json` (R03 pilot: a swaying lamp and one patterned light). Cookie patterns are generated in code, so no new asset files or credits.
- **Specs:** `render-lighting`, `player-flashlight`. The `render-quality` tier table is unchanged unless the measurement task justifies raising the shadow counts. If it does, that edit is added to this change as a `render-quality` delta before it is made.
- **Performance:** judged against the `render-quality` floor (30 fps 1% lows at High on the desktop PC), in R03 and the commons, before and after. GPU memory is checked with `?slot=scratch&memprobe`.
- **Docs:** `docs/surface-dressing-standard.md` gains a section on authoring shadow lights, sway and cookies.
- **Not in this change:** per-room reflections, light probes and eye adaptation (`room-light-response`), baked lightmaps, volumetric lighting, and brief action lights.
