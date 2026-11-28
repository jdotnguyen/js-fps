# Proposal

## Why

An audit of the repository and `public/assets/` identified several unreferenced files left behind by superseded assets and prototypes (`giles.glb`, unused brand SVGs, unreferenced VO takes, an unplayed sound sample registration, and `src/world/testRoom.ts`). Removing these keeps the shipped bundle and source tree clean without changing any runtime behavior.

## What Changes

- Remove superseded squad model `public/assets/models/squad/giles.glb` (Giles uses `mechanic.glb`).
- Remove 4 unreferenced brand SVGs from `public/assets/brand/`: `tag-wide.svg`, `tag-wide-transparent.svg`, `tag-mark-transparent.svg`, and `j00k80-mark.svg`.
- Remove 8 unreferenced VO MP3s from `public/assets/vo/`: `react_giles_cry_01.mp3`, `react_giles_cry_02.mp3`, `react_giles_cry_03.mp3`, `react_priya_choke_03.mp3`, `stinger_priya_01.mp3`, `stinger_priya_02.mp3`, `stinger_priya_04.mp3`, and `stinger_priya_05.mp3` (and prune any orphaned references in `scripts/` if needed).
- Remove unused `leakHiss` sample registration from `src/audio/sounds.ts` (and `public/assets/audio/ambience/oneshot-leak-hiss.mp3` if unused).
- Remove dead source file `src/world/testRoom.ts`.

## Capabilities

### New Capabilities

<!-- None: pure asset and dead-code cleanup with no spec-level behavior change. -->

### Modified Capabilities

<!-- None: no requirement changes. Set `skip_specs: true` in `.openspec.yaml` if skipping delta specs. -->

## Impact

- `public/assets/models/squad/giles.glb` (~229 KB)
- `public/assets/brand/*.svg` (~28 KB)
- `public/assets/vo/*.mp3` (~145 KB)
- `src/audio/sounds.ts` (`leakHiss`) and `public/assets/audio/ambience/oneshot-leak-hiss.mp3`
- `src/world/testRoom.ts`
