# Spec Delta

## MODIFIED Requirements

### Requirement: Room ambience presets
Each room SHALL play the ambience preset named in its level data: `hull_hum`, `commons_murmur`, `lab_hum`, `hull_groan`, `office_hvac`, `med_beeps`, `water_drip`, `pipes_knock`, `hydro_misters`, `hydro_vestibule`, `hydro_seed_lab`, `hydro_plant_room`, `hydro_storeroom`, `dive_drip`, `launch_bay`, `dock_ring`, `dock_walk`, `dock_airlock`, `obs_gallery`, `security_office`, `armory`, `surgery`, `power_bay`, `wet_vestibule`, `rov_workshop`, `sample_store`, `admin_reception`, `admin_open_office`, `directors_office`, `admin_boardroom`, `security_booth`, `transit_boarding`, `transit_tunnel`, `transit_dock`, `transit_concourse`, `transit_dispatch`, `dead_station`, or `silent`. A missing or unknown name SHALL use `hull_hum`. Changing presets SHALL crossfade over about 2 s.

#### Scenario: Enter the commons
- **WHEN** the player walks from a `hull_hum` corridor into the commons (`commons_murmur`)
- **THEN** the crew murmur bed fades in and the hull hum fades out over about 2 s

#### Scenario: Enter the launch trunk hall
- **WHEN** the player walks from the wet vestibule (`wet_vestibule`) into the Launch Hall (`launch_bay`)
- **THEN** the hydraulic hum and the water moving in the trunk fade in over about 2 s, with occasional winch clunks and pressure pings

#### Scenario: Enter the hydroponics rooms
- **WHEN** the player walks from `R12a` (`hydro_vestibule`) into `R12b` (`hydro_misters`), then into `R12c` (`hydro_seed_lab`) or `R12d` (`hydro_plant_room`)
- **THEN** each room's ambience bed crossfades over about 2 s to match that space

#### Scenario: Enter the admin wing rooms
- **WHEN** the player walks from `R14a` (`admin_reception`) into `R14b` (`admin_open_office`), then into `R14c` (`directors_office`), `R14d` (`admin_boardroom`), or `R14e` (`security_booth`)
- **THEN** each room's bespoke ambience bed and one-shot palette crossfades over about 2 s to match that space

#### Scenario: Enter the transit wing rooms
- **WHEN** the player moves through `R15a` (`transit_boarding`), `R15b` (`transit_tunnel`), `R16a` (`transit_dock`), `R16b` (`transit_concourse`), and `R16c` (`transit_dispatch`)
- **THEN** each space plays its own ambience bed and one-shot palette rather than falling back to generic `hull_hum`

#### Scenario: Unknown preset
- **WHEN** a room names an ambience preset that does not exist
- **THEN** `hull_hum` plays and the game keeps running

### Requirement: When an exchange may start
An overheard exchange or solo ambient snippet SHALL start only when the player is in that item's room within 5 m of the speaking group or solo speaker, every participant is free to talk, no other overheard item is playing, no higher-priority line has been audible for 2 s, no scripted scene belonging to that room is running, the player has free control, and every recording of the item is ready. When multiple items in the room qualify, the nearer SHALL speak.

#### Scenario: Between the two pairs
- **WHEN** the player is within 5 m of both pairs in the Commons
- **THEN** only the nearer pair's exchange plays

#### Scenario: A pause in a Commons scene
- **WHEN** the lab researcher's walk-by is running and no one is speaking at that moment
- **THEN** no exchange starts

#### Scenario: A pause in a wing's scripted scene
- **WHEN** `hydro_moment` in `R12b` or `dive_moment` in `R13b` is running and no one is speaking at that moment
- **THEN** no overheard exchange or solo snippet starts in that room

#### Scenario: A recording is not ready
- **WHEN** one clip of an exchange or solo snippet has not loaded or is missing
- **THEN** it does not start, no substitute voice sound plays, and any conversation group keeps murmuring

### Requirement: An exchange ends early when it loses its audience
When the player leaves the item's room or moves more than 8 m from the speaking group or solo speaker, the current line SHALL finish and any remaining lines SHALL be dropped. When a line is cut off by a higher-priority line, or a participant stops being free to talk, the rest SHALL be dropped at once. Either way the exchange or solo snippet counts as played.

#### Scenario: Walking away mid-exchange
- **WHEN** the player walks 10 m from a speaking pair or boardroom group during the second line
- **THEN** that line finishes, fading with distance, and the third line is never said

#### Scenario: Interrupted by the squad
- **WHEN** Giles speaks within earshot during an overheard exchange or solo snippet
- **THEN** it stops and does not resume after his line

### Requirement: Conversation murmur
Every active station conversation group with at least two people taking part (including Commons tables and pairs, Admin Open Office, Admin Boardroom, Reception, Grow Hall, and Launch Hall groups) SHALL give a soft, wordless murmur from where they are. It SHALL fade in and out over about 1 s as the conversation forms or breaks up, and two groups SHALL NOT sound identical.

#### Scenario: Walking through the lounge
- **WHEN** two table groups are talking on opposite sides of the player in the Commons
- **THEN** a murmur is heard from each side, with no intelligible words

#### Scenario: Approaching the Admin Boardroom
- **WHEN** the player stands outside or enters `R14d` before the drop while the four board members are seated together
- **THEN** a soft wordless conference murmur comes from the table, muffled through the door or glass until opened

#### Scenario: A group breaks up
- **WHEN** a member walks off and only one person is left
- **THEN** that murmur fades out

## ADDED Requirements

### Requirement: Station-phase reactive ambience
Room ambience SHALL respond to the station phase (`morning`, `lockdown`, `blackout`) and power restoration. Under `morning`, rooms play their working beds with no horror moans. Under `lockdown` and `blackout`, inhabited crew and office presets SHALL crossfade over about 2 s to dead or reduced-power variants (`dead_station` or power-reduced beds), and `power_bay` SHALL scale up once power is restored. Checkpoint loads SHALL start immediately in that checkpoint's phase.

#### Scenario: Morning rounds in Dive Bay stay calm
- **WHEN** the player explores `R13a`, `R13c`, or `R13e` before the drop
- **THEN** each room plays its working bed and equipment or drip cues, and no `distantMoan` plays

#### Scenario: Station enters blackout
- **WHEN** main power fails and the station switches to `blackout`
- **THEN** active room ambience crossfades to its blackout state within about 2 s and working office or crew foley stops

#### Scenario: Reloading a post-blackout checkpoint
- **WHEN** the player loads a checkpoint saved under backup power
- **THEN** the room opens in its `blackout` ambience state rather than fading from a morning bed

### Requirement: Wing and room-life foley
Populated and working rooms beyond the Commons (Admin `R14a`/`R14b`/`R14d`/`R14e`, Security `R07`, Docking Ring `R01`, Pressure Door Hall `R06`, and Transit `R15a`–`R16c`) SHALL emit irregular, positional room-life foley on the `sfx` bus anchored to relevant props or zones, respecting distance culling, wall/door/glass occlusion, and talking attenuation. Living-crew foley (Admin typing, desk chimes, paper rustles, office chair creaks) SHALL stop permanently at the drop.

#### Scenario: Walking through Open Office during rounds
- **WHEN** the player walks through `R14b Open Office` during the morning shift with no story dialogue playing
- **THEN** positional keyboard bursts, chair creaks, and soft desk chimes are heard from the desk areas at irregular intervals

#### Scenario: Behind a closed Admin door
- **WHEN** the player stands outside `R14b Open Office` with its door closed while office foley plays inside
- **THEN** the office sounds are muffled and quieter than inside the room

#### Scenario: Office foley stops at the drop
- **WHEN** the drop has started and the player is near `R14b` or `R14d`
- **THEN** no typing, phone chime, paper rustle, or office chair creak starts

### Requirement: Multi-room overheard exchanges
Populated quiet-half rooms beyond the Commons SHALL host voiced `background` exchanges for their conversation groups (`admin_hall` in `R14b`, `admin_boardroom` in `R14d`, `admin_reception` in `R14a`, `hydro_grow` in `R12b`, and `dive_launch` in `R13b`). Each exchange SHALL play once per playthrough (persisted in save flags), SHALL keep its members in place and facing each other until `drop_started`, and SHALL end permanently when the drop starts.

#### Scenario: Lingering in the Boardroom
- **WHEN** the player enters `R14d Boardroom` after the morning briefing and stands within 5 m of the conference table
- **THEN** the boardroom murmur stops and the board members speak their first meeting exchange in order from each speaker's head

#### Scenario: Grow Hall chatter waits for the scripted greeting
- **WHEN** the player first enters `R12b` and `hydro_moment` is running
- **THEN** the botanist overheard exchange does not start until `hydro_moment` has finished

#### Scenario: Drop silences all ambient crew exchanges
- **WHEN** `drop_started` is true or a post-drop checkpoint is loaded
- **THEN** no overheard exchange or conversation murmur starts anywhere on the station

### Requirement: Solo ambient work snippets
Working solo NPCs (`exec_2` and `exec_4` in `R14b`, `botanist_3` in `R12c`, `diver_2` in `R13e`, and `dock_guard` in `R01`) SHALL speak short, quiet `background` work or desk-call snippets when the player lingers within 5 m during the quiet half. Each snippet SHALL play once per playthrough from that NPC's body with mouth and gesture acting, SHALL NOT turn bystanders' gaze, and SHALL stop permanently at `drop_started`.

#### Scenario: Overhearing a solo desk call in Open Office
- **WHEN** the player lingers within 5 m of `exec_2` in `R14b` while no other exchange or higher-priority line is playing
- **THEN** `exec_2` speaks a short quiet desk-call snippet once, never repeating after reload

#### Scenario: Solo snippet drops after the drop
- **WHEN** `drop_started` is true and the player stands near `dock_guard` or any other solo ambient speaker
- **THEN** no solo ambient snippet starts

### Requirement: Ambient Station PA announcements
An ambient Station PA director SHALL play periodic, non-repeating `background` announcements from the wall `pa_speaker` grille serving the player's area during free control outside combat and scripted scenes. During `morning` (after the intro), routine TAG notices SHALL play every 75–150 s; under `lockdown` or `blackout`, degraded automated warnings SHALL play every 120–210 s. Announcements SHALL skip when no PA grille is nearby and stop on title return, restart, or interruption.

#### Scenario: Routine TAG notice during morning rounds
- **WHEN** the player explores Hydroponics or Admin for two minutes during `morning` with no story line or combat active
- **THEN** a routine TAG PA announcement plays from the room's wall grille, with boxy loudspeaker tone and room reverb

#### Scenario: Sparse automated fault warning after blackout
- **WHEN** the station is under `blackout` and the player spends three quiet minutes in an area with a PA grille outside combat
- **THEN** an automated emergency or fault PA warning plays from the nearest grille, and no cheerful morning notice plays

#### Scenario: Scripted story line interrupts ambient PA
- **WHEN** a story line or squad combat bark starts within earshot while an ambient PA announcement is playing
- **THEN** the ambient PA stops at once and never blocks or queues behind the story line
