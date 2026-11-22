# Proposal

## Why

Firing Jay's pistol or racking the shotgun leaves no trace in the sound: the spent brass and hulls never hit the floor. That clatter is one of the small details that make gunfire feel physical. It should also tell the player what they are standing near: brass rings on deck plate, barely ticks on office carpet and plips into a flooded corridor. The station's floors already carry acoustic surface tags for footsteps, so the information is there.

## What Changes

- Each pistol shot ejects a spent brass casing. Each shotgun pump ejects a spent hull, on the pump motion rather than on the shot. About half a second later it is heard landing on the floor beside the player.
- The landing sound comes from the surface where the casing lands, not from the floor under the player. Hard floors (concrete, metal plate) ring and bounce. Grates rattle, and a casing can drop through to a fainter clink below. Rubber and carpet give a dull tick. Shallow water gives a small plip, and deep water swallows the casing silently.
- Brass and hulls sound different: brass rings, hulls clack dully.
- Rapid fire stays clean. Only a few casing sounds play at once, and each landing varies in pitch and timing.
- Casings are audio only. No casing mesh is drawn and no physics body is created. Where a casing lands is worked out when it is ejected.
- The landing sound plays from a world point and is reached through a single entry point, so a later change can feed in NPC casings, or visible physical casings, without changing the sound side. squad-sidearms is the first such change.
- Recorded casing drops are sourced CC0-first, per `docs/audio-assets.md`, with ElevenLabs filling any surface that has no usable recording. They are registered by name and credited.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `in-world-audio`: adds requirements for spent-casing landing sounds. These cover the timing of brass and hulls, the surface where they land (hard, grate with fall-through, soft, shallow and deep water), the brass and hull character, and the limit on overlapping casing sounds.

## Impact

- **Code:** `src/app/session.ts` (the weapon event wiring), a new casing audio module beside `src/audio/footsteps.ts` that reuses its surface and water-depth lookups, and `src/audio/sounds.ts` (sample registration).
- **Events used:** `weapon:fired` for the pistol and `weapon:cue` (`pump`) for the shotgun. No change to the viewmodel.
- **Assets:** new clips under `public/assets/audio/weapons/casings/`, plus `CREDITS.md` rows and possibly an ElevenLabs manifest script.
- **Docs:** `docs/audio-assets.md` (where casing sounds come from).
- **Not affected:** enemy hearing, because a casing is not a noise event. Also unaffected: physics and rendering.
