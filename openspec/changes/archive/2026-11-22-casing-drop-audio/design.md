# Design

## Context

- The viewmodel emits `weapon:fired` for each shot and `weapon:cue` with `cue: 'pump'` when the shotgun racks (`src/render/viewmodel/viewmodel.ts`). `src/app/session.ts` turns both into sounds.
- Floors carry an acoustic tag (`ColliderSurface`: `concrete | metal | grate | rubber | water`), read with `collisionWorld.surfaceAt(x, y, z)`. Office carpet (`floor_carpet` in `src/world/kit/slice.ts`) is tagged `rubber`. Water depth comes from `level.water.depthAt(x, y, z)`. `FootstepAudio` (`src/audio/footsteps.ts`) already combines the two, with `WET = 0.02` and `WADE_DEEP = 0.45`.
- `collisionWorld.raycast(ox, oy, oz, dx, dy, dz, max)` exists and is already used per shot for the water effect.
- Positional one-shots on the `sfx` bus are muffled behind walls automatically (in-world-audio, "World sound occlusion"). Samples are registered by name in `SAMPLE_URLS`, and several files under one name become variants (audio-assets, "Variants").
- squad-sidearms will add NPC pistols, which also need casing sounds.

## Goals / Non-Goals

**Goals:**
- One casing-audio module with a single entry point: "a casing of kind K left the gun at point P with sideways direction R". Everything after that is handled inside it: where the casing lands, what it lands on, the sound, timing and the voice cap.
- Make it testable in Node with no audio context: landing resolution and sound choice are pure functions.

**Non-Goals:**
- Drawing casings, or physics bodies for them. If visible brass comes later, it calls the same entry point with a known landing point.
- NPC casings. squad-sidearms calls the entry point.
- A separate `carpet` surface tag. Carpet and rubber share `rubber`, which gives the right result for both.

## Decisions

### D1. Resolve the landing point when the casing is ejected, not over time

At ejection, pick an offset to the shooter's right: lateral 0.4 to 1.5 m, forward -0.2 to +0.5 m, seeded per shot. Then cast a ray straight down from the ejection height to find the floor, read `surfaceAt` and `depthAt` there, and schedule the sound at `t = sqrt(2h / g)` plus a small seeded jitter, clamped to 0.35 to 0.7 s. A wall between the gun and that offset shortens the offset to the wall, so a casing never lands on the far side of a wall.

*Alternative:* simulate a point mass with bounces each frame. Rejected because it costs more for no audible gain, while baked multi-bounce recordings sound better than composed single impacts.

### D2. Grate fall-through is a second ray

If the first hit is `grate`, continue the ray from just below the grate, for up to 3 m. With a seeded probability of about 0.4, and only if something is hit, schedule a second, quieter landing on that lower surface (about -8 dB, low-passed) after the extra fall time. Otherwise play only the grate rattle.

### D3. Whole recorded drops, one bank per kind and surface class

Each variant is a complete drop with its bounces baked in. The banks are:

| | hard (concrete) | metal plate | grate | soft (rubber/carpet) | shallow water |
|---|---|---|---|---|---|
| brass | `casingBrassConcrete` | `casingBrassMetal` | `casingBrassGrate` | `casingBrassSoft` | `casingWater` |
| hull | `casingHullConcrete` | `casingHullMetal` | `casingHullGrate` | `casingHullSoft` | `casingWater` (pitched down) |

`casingWater` is a single bank shared by both kinds. A plip is too small to tell brass from plastic, and the hull plays at a lower rate. Deep water (≥ `WADE_DEEP`) plays nothing. `null` and `metal` use the metal bank, matching `soundForSurface`. A `water` tag with zero depth reads as shallow, again matching footsteps.

Aim for at least 4 variants per bank. Each play also gets a rate jitter of ±6%, and the module never plays the same variant twice in a row for a bank.

*Alternative:* one impact sample replayed per bounce. Rejected because it sounds mechanical, and real drops have a roll and a skitter that are hard to compose.

### D4. Voice cap inside the module

The module keeps its own list of playing casing voices. When a fifth starts, the oldest gets a 50 ms gain ramp to zero. The cap lives here, not in the shared mixer, because casings are the only sound with this burst pattern.

### D5. Sourcing

Weapon sounds are an asset class that already uses third-party recordings (audio-assets, "One provider per asset class"), so casings follow `docs/audio-assets.md`: CC0 first (Freesound's CC0 filter has many shell-casing drop sets on concrete and metal), then CC BY. ElevenLabs fills whichever banks have no usable recording, most likely `Soft`, `Grate` and `casingWater`. If ElevenLabs is needed, add a manifest script in the style of `scripts/footsteps-generate.ts` (`npm run casings:generate`), and add a row to the table in `docs/audio-assets.md`. Loudness-match every clip against the gunshots and footsteps, and check it through room reverb.

### D6. Mix placement

Use the `sfx` bus, positional at the landing point, with low reverb send (about 0.15) and a max distance of 8 m. Jay's own casings land within 1.5 m, so the "Close source" rule means they are never muffled. Base gain is set so brass on concrete sits clearly under the gunshot's tail and on a par with a walking footstep. Soft banks sit about 8 to 10 dB lower.

## Risks / Trade-offs

- [The gunshot masks the casing] → The 0.35 s minimum delay puts the landing after the shot's transient. Tune the gain during playtest, not by spec.
- [The downward ray hits a prop top, such as a desk or crate] → This is correct behaviour (brass lands on the desk). The surface read is whatever is tagged there, and untagged reads as metal. Accept it.
- [Few CC0 carpet or water drops exist] → The ElevenLabs fallback is already planned (D5).
- [Landing point varies frame by frame] → Every random choice is seeded per shot, so tests are deterministic.
