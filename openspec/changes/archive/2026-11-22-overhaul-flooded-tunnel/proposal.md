# Proposal

## Why

The flooded maintenance tunnel (R09) is a strong setting that doesn't hold up physically. Its floor sits at deck level like
the rooms on either side, so nothing could hold the water in. The water is an unlit teal sheet that never reflects or
reacts to the room's flickering lights, and walking through it plays muffled concrete footsteps. The valve room (R10)
that follows is a small box whose only beat is a wheel spin. This change rebuilds both rooms as one believable,
reactive space and closes the tunnel with a staged flood.

## What Changes

**R09 becomes a flooded sump**
- **Layout:** stairs lead down from the R07 door and back up to R10. The tunnel floor sits about 1.2 m below deck
  level and holds about 0.75 m of standing water.
- **Water source:** a burst pipe at the low point is what flooded it.
- **Dressing:** tide marks on the walls, wet materials, mist on the surface, floating junk, things visible underwater,
  slowly failing fluorescent tubes, a swinging fixture and sparks that hiss when they hit the water.
- **The pistol-ammo pickup:** it moves onto a steel equipment case wedged in the water. Jay reaches it with a jump.
- **Encounters:** shamblers rise out of the water, corpses float, and wading enemies can be heard around the L-bend
  before they're seen.

**Standing water becomes a real surface**
- **Looks:** the surface is lit by the room's lights, reflects the room with a planar reflection, and gets murkier with
  depth.
- **Reacts:** a ripple simulation is disturbed by everyone who wades (Jay, the squad, enemies), by bullets, falling
  bodies and drips, and by hull groans. Waves bounce off the walls and stairs.
- **Effects:** splashes, blood clouds spreading underwater, and bodies that stay wet below the depth they waded to.
- **Water level:** sequences can raise or lower it.
- **Replaces** today's `water_surface` planes, which only R09 uses.

**Movement and sound in water**
- **Jumping (BREAKING for the `player-movement` rule "no jump while wading"):** Jay can jump while wading. The jump is
  heavier, but its reach is measured from the floor under the water.
- **Wading:** speed and drag scale with how deep Jay is, not with a single water tag.
- **Downed in water:** Jay's view stays above the surface.
- **Sound:**
  - Real wading steps and a slosh loop in place of the muffled concrete steps.
  - Jump and landing splashes, and a splash on the first step into the water.
  - Bullet splashes, the pouring pipe and lapping water.
  - Sounds come from any source whose licence allows use in a commercial game, each credited, with ElevenLabs only
    for what can't be found.

**R10 becomes the pump room, closed by a staged flood**
- **The room:** pump machinery, gauges that move, a grated overlook back onto the R09 stairs, and the valve.
- **The valve cutscene:** turning the valve starts a short cutscene with the letterbox bars.
  1. The view locks on the wheel while Giles and Okafor are placed behind Jay.
  2. A red beacon switches on behind him and turns the view around.
  3. R09 floods up the stairs while a scripted shambler charges the closing door.
  4. The water drags the shambler under, and its hand slaps the door's porthole in the last shot.
- **Permanent:** R09 is sealed off for good, and the Valve Room checkpoint restores the flooded state.

**Out of scope:** R07, R08 and R11 are unchanged. Floating debris that moves physically waits for
`adopt-physics-engine`; until then, junk bobs in place.

## Capabilities

### New Capabilities
- `flooded-tunnel`: the R09 sump and the R10 pump room: layout, depths, dressing, encounters, the case pickup, the valve
  cutscene and the shambler beat, the permanent flood and what the checkpoints restore.
- `standing-water`: standing water anywhere in the level: how it looks, how it reacts to people, shots and bodies,
  splashes and wetness, and how a sequence changes its level.

### Modified Capabilities
- `player-movement`: jumping while wading, wading speed that scales with depth, and Jay's view staying above the water
  while downed.
- `in-world-audio`: footsteps and landings in water (wading steps, slosh, jump and landing splashes), replacing the
  muffled concrete step.
- `render-lighting`: a slow "failing tube" light pattern, and a single scripted light (the red beacon) switched on its
  own without changing the rest of its room.
- `level-kit`: a room floor below deck level, with walls and stairs that reach down to it, and a pressure door with a
  porthole.

## Impact

- **Level data:** R09, R10 and the R09–R10 door in `src/data/levels/slice01.json`. The `cp_flooded` and `cp_valve`
  checkpoints, the `S_ammo_r09` pickup, and the debug jump targets in `src/main.ts`.
- **Sequences:** `src/data/sequences/action_tunnel.json` (the `valve_turn` sequence is rewritten).
- **Kit and rendering:** `src/world/kit/` (sunken floors, stairs placement, porthole door, the new water kit),
  `src/render/lights.ts` (new pattern), and a new water renderer and ripple simulation under `src/render/`.
- **Script host:** `src/script/host.ts` and `src/script/actions.ts` implement the existing but unimplemented `water` step
  and add a way to switch a single light.
- **Movement:** `src/actors/player.ts` and `src/actors/motor.ts` (wading depth, jumping in water, eye height while downed).
- **Audio:** `src/audio/footsteps.ts`, `src/audio/sounds.ts`, new files under `public/assets/audio/`, `CREDITS.md`, and
  `docs/audio-assets.md` (any allowed licence first, ElevenLabs as the fallback).
- **Coordination:**
  - Refraction and murk need the opaque scene's colour and depth, so they build on `upgrade-three-and-post-chain`.
  - R09's light count is budgeted against the Low tier's 12-light pool from `fidelity-first-rendering`.
  - Floating physical debris is left to `adopt-physics-engine`.
