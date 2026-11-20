# Proposal

## Why

The dive bay (R13a–e), reached through the Commons' south door, does not make sense as a place. Its centrepiece, the moon pool, is an open hole of water in the floor of a station kept at one atmosphere about 3,000 m down. At that depth the sea is at roughly 300 bar, so an open pool would flood the station, and no diver could work outside. Around it the rooms have little to do with launching or recovering anything: crates, one console, dive-suit racks. The `dive_bay` palette also bakes rust into every wall and floor, and the rooms sit in thick cyan fog. That makes the bay the only derelict-looking space in the quiet half, where the station should still feel normal, clean and scientific (ADR-0023).

## What Changes

- **The moon pool becomes a launch trunk.** A vertical lock in the floor with an inner hatch on hydraulic rams, a drained steel shaft with painted depth marks and a little standing water, and a closed outer hatch with a lit viewport at the bottom. The crew still call it "the moon pool", so no dialogue changes. The rail gets a swing gate that stays shut.
- **R13b, Moon Pool, becomes a working launch-and-recovery hall:** a gantry crane on rails, a recovered ROV (yellow float block, manipulator arm, lamps, a basket of clear sediment cores) on a deck cradle, a tether winch, a pilot console with status screens (outside pressure 302 bar, trunk state, tether, sonar), a dive-log whiteboard, a wet bench, an eyewash station and a tool shadow-board. The dive-suit rack and most crates are removed.
- **R13a, Dive Bay Access, becomes a wet vestibule:** boot wash, coverall hooks, drain grate, "WET AREA" signage.
- **R13c, Suit Room, becomes the ROV workshop:** spare thruster and arm on a bench, battery chargers, parts bins, gas cylinders and hose reels. The dive-suit racks are removed.
- **R13e, Dive Lockers, becomes the sample store:** core fridges, a frosted −80 °C freezer, a pressure sample cabinet ("HOLD AT 302 BAR") and a chain-of-custody terminal. The sample case is now stowed there, at the same spot and with the same prompt and lines, instead of in an airlock locker. A few emergency survival suits hang by the door. The radio stays.
- **R13d, Maintenance Corridor, stays dark and decayed.** It gets labelled pipes and one hissing leak. It is now the only rusty room in the bay.
- **Clean palette and calmer light.** `dive_bay` changes to the station's clean slate panels with a bolted upper band and clean treadplate with clean hazard paint. Lights become neutral white work lights, fog drops from 0.05 to about 0.015, and the only strong blue comes up from the trunk. Wear is placed as decals: wet sheen and puddles around the trunk and under the ROV, drip and salt stains.
- **Immersion effects:** an upward blue light shaft and moving caustics above the trunk, a thin mist over the water, drips from the ROV with ripples, a rotating amber beacon on the gantry, room plates and life-support panels in R13a–e.
- **Trunk secure event.** Once Sung's dive-bay lines finish, the trunk is secured: the beacon turns, a two-tone chirp, the inner hatch swings shut, a vent hiss, and the status screen reads "TRUNK SECURED". It plays once and is restored on load.
- **Sound.** R13b gets a new ambience preset, `launch_bay` (hydraulic power-pack hum, water moving in a steel shaft, winch clunks, pressure pings). New ElevenLabs clips for the bed and the trunk event.
- **Not changed:** the Commons (R02) and everything in it, the door `D_R02_R13a`, R11 and the sealed climax door `D_R13d_R11`, every other room, every dialogue line, and every anchor, trigger and NPC id that the quiet-half sequences use.

## Capabilities

### New Capabilities
- `dive-bay`: the dive bay suite (R13a–e) as a place: each room's role, the launch trunk and its states, the working equipment, the sample-case errand route, the look (finish, light, fog, wear), the trunk secure event, and the content and budgets it must preserve.

### Modified Capabilities
- `surface-textures`: the "Area material palettes" requirement's dive-bay scenario changes from rusty treadplate to clean treadplate, with rust kept only in the maintenance corridor.
- `in-world-audio`: the "Room ambience presets" requirement gains the `launch_bay` preset.

## Impact

- **Level data:** R13a–e in `scripts/gen-slice01.mjs`, then regenerated `src/data/levels/slice01.json`. Room names for R13a, R13c and R13e change. A new `floorMaterial` room option in the generator, mirroring `wallMaterial`, so R13d keeps rusty floors.
- **Kit:** `src/world/kit/slice.ts` rewrites `floor_moonpool` as the trunk (same id, width and hull cut-out), and adds the gantry, ROV, winch, pilot console, wet bench, core rack, eyewash, shadow-board, workshop bench, battery charger, core fridge, freezer, pressure cabinet, custody terminal, boot wash and beacon props. `dive_suit_rack` stays in the kit but is no longer placed in slice01. `src/world/kit/exteriorHull.ts` gets a closed trunk skirt under the hull.
- **Palette:** `src/world/kit/palettes.ts` (`dive_bay`), `palettes.test.ts`.
- **Effects:** trunk up-shaft (existing `fx/shafts.ts`), a caustics plane, a mist layer and drip particles, placed decals.
- **Script:** `src/data/sequences/rounds.json` (one `emit` appended to `dive_moment`, a new `dive_trunk_secure` sequence) and the quiet-half restore.
- **Audio:** `src/audio/ambience.ts` (`launch_bay`), `src/audio/sounds.ts`, `scripts/ambience-generate.ts` manifest, new files in `public/assets/audio/ambience/` generated with ElevenLabs.
- **Tests:** `slice01.test.ts`, `slice01JumpTops.test.ts`, `palettes.test.ts`, kit tests for the trunk, and a sequence test for the trunk event.
- **Coordination:** `dock-security-checkpoint` also edits `gen-slice01.mjs` and `slice01.json` (R01 only). The two changes touch different rooms but the same files, so whichever lands second rebases and regenerates.
