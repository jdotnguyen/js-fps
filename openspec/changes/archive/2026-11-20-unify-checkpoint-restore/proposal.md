# Proposal

## Why

Loading a save from the title screen does not rebuild the world the way a death restart does. `Game.load()` places Jay and restores the flags, items and map, but only a death restart then emits `game:restarted`, which resets the cast, the enemies, the guidance and the scripted sequences. Justin hit this in playtesting: after Continue at the Valve Room checkpoint, Giles and Okafor were not with Jay, the climax in R11 opened its doors and then waited for a Giles who was rooms away (his "Thirty seconds to get power back" line arrived as a distant whisper), and the fight never came. Every story beat that needs the squad is exposed to the same failure, so it must be fixed before more of the slice is built on it.

## What Changes

- **One restore path.** Continue and Load game from the title restore exactly as a death restart does: same reset of cast, enemies, guidance and sequences, same replay of what the checkpoint was in the middle of. A title load first returns the level to its authored state (doors, lights, triggers), as a fresh page would have it, so a quit-to-title then load does not inherit the abandoned session.
- **Squad beside Jay after every restore.** After a load or a restart, any squadmate a restore scene has not placed stands near Jay, out of his view where possible, and follows him. This no longer depends on the 4 m "Jay jumped" heuristic.
- **Regroup before squad beats.** A new sequence step `squadRegroup` brings a squadmate who is far from Jay and out of his view to a spot near him. The squad job beats (cover-me in R06, the med-lab biometric door, the R11 climax) start with it, so a squadmate who fell behind on the way can no longer stall a scene.
- **Gather before sealing.** A new sequence step `gatherIn { room, timeout }` waits until Jay and both squadmates are inside a room. After the timeout, a squadmate still outside is placed inside near Jay; the step keeps waiting for Jay himself. The Observation Gallery drop (`drop.json`) uses it before it seals `D_R02_R03`, so neither the squad nor Jay can be shut out. Today the seal is the scene's first step and races the squad's walk in.
- **Climax keeps Jay in the arena.** When the climax opens the R13d maintenance door as its second enemy entrance, it seals `D_R13b_R13d`, so Jay cannot run back into the pre-outbreak dive bay. When the fight is won, `gatherIn R11` waits for Jay and the squad before Giles's "Doors sealing" line and the seal. Today the climax can seal Jay outside R11, and the reveal then plays at a Giles in another room.
- **Debug `jump=` fade.** `?debug&jump=r05|r06|r07|r09|r11` no longer leaves the screen black: the jump clears the intro's fade, as `jump=drop` already does.

Out of scope: saving per-enemy kills, corpses or set dressing (bodies, glass blood). Checkpoint reloads regenerate the beat from flags, as now.

## Capabilities

### New Capabilities
- `checkpoint-restore`: How the game rebuilds the playthrough from a checkpoint save, from the title screen or after a death: what is reset, what is replayed, and where the squad stands afterwards.

- `scene-gathering`: How a scripted scene makes sure Jay and the squad are in the room before it seals them in.

### Modified Capabilities
- `squad-tasks`: A squad job beat first regroups a squadmate who is far from Jay and out of his view, so the job's walk always starts near Jay.

## Impact

- `src/game/game.ts`: one restore routine shared by title load and death restart.
- `src/ai/squad.ts`: placement after a restore, and a regroup method.
- `src/ai/npcs.ts`, `src/script/actions.ts`, `src/script/types.ts`, `src/script/gameHost.ts`, `src/main.ts`: the `squadRegroup` step and its wiring; the debug jump fade.
- `src/data/sequences/action_contact.json`, `action_tunnel.json`, `action_climax.json`: `squadRegroup` at the start of the three job beats.
- `src/data/sequences/drop.json`: `gatherIn R03` before the gallery door seals.
- `src/data/sequences/action_climax.json`, `action_restore.json`: the dive-bay seal and `gatherIn R11` before the climax seals R11.
- Tests: `src/ai/squad.test.ts`, a new `src/game/game.test.ts`. No save schema change; existing saves load as they are.
