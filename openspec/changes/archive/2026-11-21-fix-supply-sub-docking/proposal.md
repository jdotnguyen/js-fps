# Proposal

## Why

After the `exterior-ocean` overhaul darkened the ocean outside the station, the supply submarine Halcyon disappeared from view during the intro docking sequence, its 10× scaled model (`145 m`) stretched its 1024×1024 texture into a blur while pushing both bow spotlights off-screen behind the dock airlock and underground into the seabed, and its two docking sounds (`subPass` and `subClamp`) remain local procedural synths rather than muffled underwater ElevenLabs recordings.

## What Changes

- Restore the supply submarine to its accurate dock-fit proportions (`SUB_SCALE = 1`, `14.5 m` length) so the hull, docking cradle clamps, sail running lights, and bow spotlights fit the dock window cleanly and the existing hull texture regains crisp density without texture upscaling.
- Re-center the supply submarine's berth in `slice01` so the hull, cradle clamps, and bow headlamps sweep across and frame inside the Docking Ring (`R01`) window rather than sitting behind the Dock Airlock (`R01a`).
- Make the submarine subtly readable as a dark silhouette emerging from the dark ocean (without brightening the water or seabed) via wet specular response in the exterior lamp shader, subtle grazing illumination from the Docking Ring floodlights, and visible sail running lights.
- Restore the submarine's two bow spotlights with properly mounted positions, tilt, range, and soft-edged volumetric beams with drifting marine snow so both beams cut through the dark water and paint two moving pools across the seabed below `R01` during docking.
- **Remove** the local procedural `subPass` and `subClamp` synths from `src/audio/sounds.ts` and replace them with ElevenLabs-generated, muffled underwater-through-hull recordings (`oneshot-sub-pass.mp3`, `oneshot-sub-clamp.mp3`) registered in `SAMPLE_URLS`.

## Capabilities

### New Capabilities
<!-- None; all behavior changes belong to existing capabilities. -->

### Modified Capabilities
- `intro-sequence`: Clarify that the supply sub docks at dock-fit proportions framed inside the dock window, reads subtly in the dark ocean via dock floodlight graze and running lights, and projects two visible bow spotlight beams that sweep lit pools across the seabed while muffled underwater docking sounds play.
- `audio-assets`: Allow replacing legacy procedural docking synths (`subPass`, `subClamp`) with ElevenLabs recorded samples and removing those unused local procedural synths rather than keeping them as fallbacks.

## Impact

- **Submarine model & kit piece**: `src/render/fx/subModel.ts`, `src/world/kit/slice.ts`, `docs/modular-grid-standard.md`.
- **Exterior lighting & beam shader**: `src/render/fx/exteriorLight.ts`, `src/render/fx/exterior.ts`.
- **Level authoring**: `scripts/gen-slice01.mjs`, `src/data/levels/slice01.json`.
- **Audio & generation scripts**: `src/audio/sounds.ts`, `src/audio/doorAudio.ts`, `scripts/ambience-generate.ts`, `public/assets/audio/ambience/oneshot-sub-pass.mp3`, `public/assets/audio/ambience/oneshot-sub-clamp.mp3`.
- **Tests**: `src/world/slice01.test.ts`, `src/render/fx/exteriorLight.test.ts`, and `npm run audio:audit`.
