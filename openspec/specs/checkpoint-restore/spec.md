# checkpoint-restore Specification

## Purpose
Defines how the game rebuilds a playthrough from a checkpoint save, whether the player loads it from the title screen or restarts after dying, so the squad, the enemies and the scripted beats are always in a playable state afterwards.

## Requirements

### Requirement: Title load restores like a death restart
Loading a save from the title screen (Continue or Load game) SHALL rebuild the playthrough the same way a restart after death does: the cast, the enemies, the guidance and the scripted sequences SHALL be reset and restored from the save's flags and checkpoint. Spawn groups the flags mark as cleared SHALL stay cleared.

#### Scenario: Continue after a page reload
- **WHEN** the page is reloaded and the player chooses Continue on a save taken at a checkpoint
- **THEN** the same restore runs as when Jay dies and restarts at that checkpoint

#### Scenario: Restore scenes run once the load settles
- **WHEN** a save is loaded from the title screen
- **THEN** every restore sequence that listens for play starting (such as `action_restore`) runs after the reset, so doors and story props match the flags

### Requirement: Title load starts from the authored level
Before restoring a save loaded from the title screen, the level's doors, lights and one-shot triggers SHALL return to their authored state, as on a fresh page load. A restart after death SHALL keep the live level and restore it from the checkpoint as now.

#### Scenario: Quit to title, then load an earlier save
- **WHEN** the player quits to the title after opening doors and firing triggers, then loads an earlier save
- **THEN** no door, light or trigger keeps the state the abandoned session left it in, apart from what the save's flags restore

#### Scenario: Room triggers fire again after a title load
- **WHEN** a save loaded from the title puts Jay before a room whose entry trigger fired in the abandoned session
- **THEN** walking into that room fires the trigger again

### Requirement: Squad stands beside Jay after a restore
After any restore (title load or death restart), each squadmate that no restore scene has placed SHALL stand near Jay on walkable floor he can reach, behind him and out of his view where possible, and SHALL follow him from there.

#### Scenario: Continue at the Valve Room checkpoint
- **WHEN** a save taken at `cp_valve` is loaded from the title after a page reload
- **THEN** Giles and Okafor stand within a few metres of Jay in R10 and follow him into R11

#### Scenario: A restore scene keeps its placement
- **WHEN** a restore scene places a squadmate itself (Giles at the R11 console after the climax was won)
- **THEN** he stays where the scene put him

### Requirement: Debug jump shows the scene
Starting play with `?debug&jump=<beat>` SHALL clear the intro's fade, so the screen is not left black when the jump cancels the intro.

#### Scenario: Jump to the climax
- **WHEN** the dev URL `?level=slice01&debug&jump=r11` starts a new game
- **THEN** after the jump Jay sees the Control Room, not a black screen
