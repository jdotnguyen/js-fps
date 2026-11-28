# Proposal

## Why

The stretch from Lab B to the flooded tunnel has too many enemies. It has 17 between R05 and R09 (4 in R05, 6 in R06, 1 in R07, 6 in R09), so the creature that killed Voss is forgotten as soon as it comes through the door. The R06 drop-in also isn't believable: the duct enemy appears face down on the floor with no vent, no sound and no fall. One creature that you follow by ear from Lab B to R06 is scarier than a crowd.

## What Changes

- **Lab B escape (end of `drop`, seen from the gallery):** the creature hammers the gallery glass a few more times, and then Lab B's lights die. In the dark the player hears a vent cover torn off and banging move away above the ceiling. The lights flicker back on: Lab B is empty, its ceiling grate hangs open, and a jump stinger hits. Giles's "Is that one of the lab techs?" and Okafor's "Not any more." move here.
- **BREAKING (story):** the creature no longer comes through `D_R04_R05`. That door stays sealed.
- **R05 has no fight:** `r05_contact` and `r05_trickle` are removed. The knocks on the Lab B door, the door opening and the trickle wave are cut from `contact`. Deleted: `contact_okafor_02` ("More. Behind the benches."). Bangs pass overhead along the coolant line toward R06, and the blackout beat follows as before.
- **R06 has one fight, the escaped creature:** the other five `r06_cover` enemies are removed. While Giles works the panel, bangs travel across the ceiling toward the room, there's a silence, and the new ceiling vent grate bursts and falls. The creature drops out with the Voss creature body and 90 HP. The legs lesson moves here: "Legs! Take its legs!" when it lands, and "The legs. Did you see?..." after it dies. `cover_giles_01` is re-recorded as "Keep it off me!".
- **R07:** the `r07_playdead` ambush, its wait and its despawn are removed.
- **R09:** cut to 2 crowd zombies. This is done as a task in `overhaul-flooded-tunnel`, which owns those spawns, not in this change.
- **New engine support:** a per-spawn `hp`, a `drop` start (fall from the spawn point and land), a ceiling vent grate piece that can break and fall, and duct anchors for a trail of sounds.
- **New sounds:** vent cover rip, duct bangs, duct scrape, creature landing, grate clatter, and a jump stinger if the existing ones don't land.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `infection-kills`: the creature stays behind the glass until it **escapes** in a Lab B blackout, not until it is released through the door. The creature the player later fights is still that creature, now in R06.
- `lab-wing`: R05 is no longer a fight space. R06's fight has one source and one enemy. Lab B gets a ceiling vent. What the wing keeps changes for `contact` lines.
- `enemy-encounters`: adds dropping enemies and per-spawn health, and updates scenarios that name removed spawns.
- `adaptive-music`: the Lab B score holds from the escape to R06, brings the fight layers back when the creature drops, and ends when it dies in R06. A jump stinger plays on the reveal.
- `station-power`: the blackout beat follows the creature's passage over R05, not the end of an R05 fight.

## Impact

- Data: `src/data/levels/slice01.json` (spawns, R04 and R06 vent grates, duct anchors), `src/data/sequences/drop.json`, `action_contact.json`, `action_security.json`, `src/data/scores.json`, `src/data/dialogue/slice01*.json`, `scripts/vo-takes.json`.
- Code: `src/data/types/level.ts` (spawn `hp`, `drop` start), `src/ai/spawner.ts`, `src/ai/enemyDirector.ts`, `src/ai/enemy.ts`, a world kit piece for the ceiling vent grate, the door/prop state used to break it.
- Audio: new assets under `public/assets/audio/`, entries in `src/audio/sounds.ts`, `CREDITS.md`, following `docs/audio-assets.md`.
- Tests: `src/script/action.test.ts` (contact, cover_me, sec_glass), `src/ai/enemySim.test.ts`, `src/world/slice01.test.ts`, the score tests.
- Coordination: `overhaul-flooded-tunnel` (R09 spawns and the `labB` score's flood cues), and `overhaul-priya-r08-death` (paused, touches `sec_glass` in `action_security.json`).
