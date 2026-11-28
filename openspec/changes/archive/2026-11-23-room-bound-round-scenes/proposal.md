# Proposal

## Why

Playtest: Jay keeps talking to a botanist after the player has left the hydroponics room. The `scene-presence` spec already ends a scene when the player leaves its room, but only two sequences name a room (`admin_hale`, `researcher_walkby`). The other round scenes (`hydro_moment`, `dive_moment`, `admin_moment`, `hydro_store_moment`) name none, so they play to the end wherever the player goes. The rule exists and was only applied where it was first needed.

## What Changes

- The hydroponics, dive bay, admin reception and storeroom conversations end when the player leaves their space, with the same effects as `admin_hale`: voice and subtitle stop, queued lines drop, the scene counts as seen, speakers go back to idle.
- A scene may belong to more than one room, because two of these scenes straddle a doorway: the hydroponics trigger fires in the vestibule while the botanists work in the grow hall, and the dive trigger fires in the wet vestibule while Sung and the maintenance worker are in the launch hall.
- A scene that ends early still lands on its end state. The dive scene's last step secures the trunk (beacon, hatch), and that must still happen.
- Tests per scene: stay and hear it all, leave mid-line, leave before it starts, come back.

## Capabilities

### New Capabilities

None.

### Modified Capabilities
- `scene-presence`: a scene may name several rooms and counts as inside when the player is in any of them; the hydroponics, dive bay, reception and storeroom scenes are room scenes.

## Impact

- `src/data/sequences/rounds.json` (`room` on four sequences), `src/script/types.ts` and `src/script/runtime.ts` (room list), `src/script/gameHost.ts` (`inRoom` test per room), `src/script/scenePresence.test.ts` and the sequence loader's validation.
- Room ids `R12a`, `R12b`, `R12e`, `R13a`, `R13b`, `R14a` come from the level data, and a check that they exist already runs at load (`hasRoom`).
- Out of scope: a Jay line dropped when every other speaker is out of earshot (`dialogue-channels`) did not stop this scene. Why is a question in design.md.
- Independent of the stuck marker bug, which is `fix-stale-world-markers`.
