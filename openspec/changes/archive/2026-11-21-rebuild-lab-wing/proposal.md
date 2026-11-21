# Proposal

## Why

The lab wing (R04 Lab B, R05 Lab Junction, R06 Pressure Door Hall) is where the action half starts, and the three rooms read as one generic rusty box.

- The `labs` palette puts the peeling, rusted `labPanel` photo on every wall. Lab B, which the player sees *clean* through the gallery glass during the briefing, already looks abandoned for years.
- R05 holds a crate stack, a debris pile and a console. R06 holds three crates, a pipe and a valve. Neither says what the room is for.
- The story's thread (the bloom got into the coolant loop that runs through Lab B's service wall, and Giles cut his arm on the panel there) appears nowhere in the level.

`import-lab-props` now provides real props and the bloom's growth, so the wing can become a believable lab that went bad an hour ago.

## What Changes

- **A clean lab-wing palette.** `labs` changes to clean washable panels, a slate service band, steel trim and lab tile, in the same family as the gallery and hydroponics. Damage comes only from placed decals, blood and the bloom, never from the base material. The existing outbreak swap of Lab B's floor to `tileBroken` stays.
- **The coolant line.** A new procedural prop: an insulated coolant pipe with brackets, valves and a sight glass. It runs from Lab B's culture column, through the service wall, along R05's ceiling and down R06 to the bulkhead panel, so the player can follow the bloom's route.
- **The bloom spreads along the coolant line**, thickest at its source and thinning out (`bloom_growth_*` meshes plus `bloom` decals):
  - **Lab B:** a mass around the column and the service wall.
  - **R05:** patches where the line leaks.
  - **R06:** a trace that reaches the bulkhead panel Giles works on.
  - Lab B's growth outside the column appears only after the drop. R05 and R06 are only ever entered after it.
- **R04 Lab B becomes Voss's culture lab** (BSL-3 style):
  - a culture column (bioreactor) in place of the specimen tank
  - a biosafety cabinet, a −80 freezer, a CO2 incubator stack and the lab cabinet
  - the warped service panel on the coolant line
  - quarantine tape and a negative-pressure gauge reading red
  - It stays readable through the glass for the drop, and keeps every placement `voss-burst-death` relies on.
- **R05 becomes the lab wing's decon junction:**
  - an emergency shower and eyewash, PPE lockers and a hazmat suit rack
  - biohazard bins and a lab-wing directory with floor arrows
  - signs of evacuation: dropped PPE and clipboards, a tipped sample cart
  - a red lockdown strobe
  - The radio stays on the console. The first-contact fight keeps its beats, with cover redesigned for its approaches.
- **R06 is redesigned as a compartment boundary, around the cover-me fight:**
  - **The south door** becomes a real watertight bulkhead with a dogging wheel, a pressure manifold, a status board reading "SEALED — SECURITY SIDE", and Giles's bypass panel (the imported power box) on the coolant line.
  - **The fight's approaches move** where they serve immersion: a ruptured ceiling duct where the bloom has broken through, a service trench grate, a wall vent, and the corridor behind.
  - **Cover changes:** a pump skid, a gas-cylinder cage, switchgear and a cable drum replace the crates.
  - **Unchanged:** six enemies, the 20 s job and the beats.
- **Light and atmosphere:**
  - neutral white work light in Lab B
  - red lockdown light with one white work light kept in R05 and R06, so the fights stay readable
  - fog down from 0.06 to about 0.025
- **Not changed:**
  - R03 (Observation Gallery) and its glass, blinds and briefing
  - every door id, and the `drop`, `contact` and `cover_me` sequences' beats, lines, flags and checkpoints
  - Voss's death and the creature (owned by `voss-burst-death`)
  - Voss's voice log, her badge and the initials on the service-panel tag (owned by the later `lab-wing-story-beats` change)

## Capabilities

### New Capabilities
- `lab-wing`: the lab wing (R04–R06) as a place:
  - each room's role and equipment
  - the coolant line and how the bloom follows it
  - what the player can see of Lab B before and after the drop
  - the look (palette, wear, light, fog)
  - the R05 and R06 fight spaces (approaches, cover, climbable tops)
  - what the wing must keep for its sequences

### Modified Capabilities
- `surface-textures`: the "Area material palettes" requirement gains lab-wing scenarios: clean walls and floors before any damage, wear only from placed decals, and the existing Lab B outbreak floor swap kept.

## Impact

- **Level data:** R04, R05 and R06 in `scripts/gen-slice01.mjs`, then a regenerated `src/data/levels/slice01.json`.
  - R06's vents, spawn points, `r06_hold` and `r06_panel` move.
  - R05's spawns may move.
  - Wall-vent tiles change accordingly.
- **Kit:** new procedural props in `src/world/kit/` (culture column, coolant line and its fittings, biosafety cabinet, freezer, incubator stack, emergency shower, PPE locker, hazmat rack, directory sign, bulkhead wheel and manifold, status board, pump skid, cylinder cage, trench grate, ruptured duct). The imported props are placed through their stand-ins.
- **Palette:** `src/world/kit/palettes.ts` (`labs`) and `palettes.test.ts`.
- **Imported props:**
  - Props 1 m or larger are re-imported at 512 px per metre (`scripts/props.sources.json`, `npm run props`).
  - Stand-ins gain a `material` param, so the bloom meshes share the `bloom` slot (`src/world/registry.ts`, `kit/importedProps.ts`).
  - Both changes keep the `imported-props` requirements as they are.
- **Sequences:**
  - `action_contact.json` (`cover_me`), only where spawn or anchor ids change
  - one `emit bloom:spread` in `drop.json`
  - a restore so Lab B's bloom shows after the drop on load
- **Tests:**
  - `slice01.test.ts` (budgets, the lab palette, sign placement)
  - `slice01JumpTops.test.ts` (review list)
  - `script/action.test.ts`
  - `enemySim.test.ts` (if spawns move)
  - `mapModel.test.ts` (if wall vents move)
  - new kit tests
- **Docs:** `docs/PLAYTEST.md` (R05 and R06 checks).
- **Memory:** the first rooms to draw the `bloom` slot and the imported props. GPU texture memory is re-measured (runtime-memory spec).
- **Coordination:**
  - Implementation starts after `voss-burst-death` lands (it edits Lab B's lights, glass decals, Voss's cast and `slice01.json`) and after `import-lab-props` is archived (this change uses its `imported-props` spec).
  - `adopt-physics-engine` (not started) may change how prop colliders work. If it lands first, this change follows it.
