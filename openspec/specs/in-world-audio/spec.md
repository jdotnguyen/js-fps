# in-world-audio Specification

## Purpose

Defines the sounds that come from the station and the things in it: room ambience, the TAG FM radio, doors, footsteps, infected voices and weapons, plus the sequence steps that let scripted scenes control them.

## Requirements

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

### Requirement: Living ambience
Each ambience preset SHALL combine looping beds whose level drifts slowly with one-shot sounds (groans, knocks, creaks, pings, beeps, drips) at random intervals and random positions around, above or far from the player. The same one-shot SHALL NOT fire at fixed intervals.

#### Scenario: Standing still in a corridor
- **WHEN** the player stands in a `hull_hum` corridor for two minutes
- **THEN** distant hull groans and knocks are heard at irregular times from different directions, over a bed that never sounds like a static loop

### Requirement: Light buzz follows the lights
Rooms with lit fixtures SHALL have positional fluorescent buzz at up to four fixtures. Flickering fixtures SHALL buzz louder and can spark (`zap`) in time with the flicker. Lamp lights SHALL NOT buzz or zap and SHALL NOT count toward the four.

#### Scenario: Flickering tube
- **WHEN** a fixture in the current room flickers
- **THEN** its buzz is louder than steady fixtures and comes from the fixture's position

#### Scenario: Lamp in a lit room
- **WHEN** the current room has ceiling lights and a lit lamp
- **THEN** buzz comes only from ceiling fixtures and none from the lamp

### Requirement: Ambience follows the game mode
Ambience SHALL be silent on the title screen, held while the scene is frozen (see `game-pause`), and at full level during play.

#### Scenario: Back to title
- **WHEN** the player returns to the title screen
- **THEN** the room ambience fades out and only the menu music remains

#### Scenario: Pause and resume
- **WHEN** the player pauses and later resumes
- **THEN** the room ambience is silent while paused and carries on at full level from where it stopped

### Requirement: Scripted ambience override
A sequence SHALL be able to override the room ambience with a named preset, including `silent`, and clear the override to return to the room's own preset.

#### Scenario: Deliberate silence
- **WHEN** a sequence sets the ambience to `silent` before a scare
- **THEN** the room ambience fades to nothing until the override is cleared

### Requirement: TAG FM radio
The in-world radio SHALL play a named track from a position in the world with a small, old speaker sound (wow and flutter, hiss and crackle, band-limited speaker tone, soft saturation). At most one radio track SHALL play at a time. Starting a track SHALL replace the current one; an unknown track SHALL log a warning and play nothing. The only radio on the station SHALL be the one in the Commons kitchen; no sequence SHALL start a radio track anywhere else.

#### Scenario: Radio in the kitchen
- **WHEN** the intro reaches the kitchen and starts `tag_fm_01` at the radio prop
- **THEN** the tune comes from the radio's position with the old-speaker sound, and gets quieter as the player walks away

#### Scenario: Radio moves rooms
- **WHEN** a sequence starts `tag_fm_01` at a second position while it is already playing
- **THEN** it plays only from the new position

#### Scenario: No radio outside the kitchen
- **WHEN** the content is validated
- **THEN** every radio step that starts a track plays it at the Commons kitchen radio, and the Lab Junction, Hydroponics Storeroom and Sample Store have no radio

#### Scenario: Quiet half after the lab
- **WHEN** the player clears the contact fight and later enters Hydroponics or the dive bay
- **THEN** no radio music plays there

### Requirement: Door sounds
Doors SHALL play open and close sounds matched to their kit (pressure slide, glass slide or bulkhead) from the door's position. A door that reverses mid-travel SHALL crossfade into the opposite sound at the matching point. Denied and unlocked feedback SHALL play from the door, and repeated denied attempts within about 0.35 s SHALL play only once.

#### Scenario: Locked door spam
- **WHEN** the player presses use on a locked door five times in quick succession
- **THEN** the denied sound does not machine-gun; it plays at most once per 0.35 s

#### Scenario: Door reverses
- **WHEN** a closing glass door is reopened halfway
- **THEN** the close sound gives way smoothly to the open sound, starting partway in

### Requirement: Footsteps by surface
Footsteps for the player and every body SHALL use the sound bank for the floor surface: concrete, metal plate, grate,
rubber or water. Steps SHALL scale with gait (pivot, walk, jog, shamble, heavy). Each actor SHALL have a slightly
different pitch so boots are distinguishable. Steps in water SHALL be wading sounds that get heavier with depth.

#### Scenario: Corridor to grating
- **WHEN** the player walks off a concrete floor onto a grate
- **THEN** the step sounds change from concrete to grate on the first step on the grate

#### Scenario: Into the water
- **WHEN** the player walks down the stairs into standing water
- **THEN** the first submerged step plays a splash, and later steps are wading sounds, heavier on each deeper step

### Requirement: Footstep range and occlusion
Other actors' footsteps SHALL be audible up to 22 m (30 m for heavy steps), fading out from about 13 m so they never cut off abruptly. A step heard through a wall or closed door SHALL be low-passed and quieter.

#### Scenario: Behind a closed door
- **WHEN** an infected walks on the other side of a closed door
- **THEN** its steps are muffled and quieter, and become clear when the door opens

### Requirement: World sound occlusion
A one-shot sound effect that comes from a position in the world SHALL be low-passed, quieter and slightly more reverberant when a wall or closed door stands between it and the player, as footsteps are. Low obstacles such as counters and crates SHALL NOT muffle it. Whether it is muffled SHALL be decided when it starts. Looping sounds, ambience, the radio, music, the player's own sounds and sounds from scripted sequences and kills SHALL NOT be muffled this way. Local dialogue SHALL NOT use this rule either: it is muffled continuously by the voice propagation in voice-playback.

#### Scenario: Groan behind a closed door
- **WHEN** an infected groans on the other side of a closed door
- **THEN** the groan is muffled and quieter than the same groan with nothing in between

#### Scenario: Door opened between groans
- **WHEN** the door between the player and a groaning infected opens, and the infected groans again
- **THEN** the new groan is clear

#### Scenario: Low obstacle
- **WHEN** an infected groans behind a waist-high counter in the same room as the player
- **THEN** the groan is not muffled

#### Scenario: A door's own sound
- **WHEN** a door opens or closes, and nothing but that door is between it and the player
- **THEN** its sound is clear from either side of the door

#### Scenario: A door beyond a wall
- **WHEN** a door in another room opens, with a wall between it and the player
- **THEN** its sound is muffled and quieter

#### Scenario: Scripted kill seen through glass
- **WHEN** a scripted kill plays its sounds in a room the player watches through glass
- **THEN** those sounds play as authored, not muffled

#### Scenario: Close source
- **WHEN** a sound plays within 0.6 m of the player
- **THEN** it is never muffled

#### Scenario: Dialogue behind a wall
- **WHEN** a squadmate speaks on the other side of a closed door
- **THEN** the line is muffled by voice propagation, and opening the door mid-line clears it during the line

### Requirement: Glass muffles lightly
A sound heard through a glass partition, with no wall or closed door also in the way, SHALL be only slightly quieter and duller: clearly audible, and much louder and brighter than the same sound behind a wall. This SHALL apply to footsteps and to the world sounds above. A wall or closed door anywhere between the sound and the player SHALL still muffle it fully.

#### Scenario: Monster at the window
- **WHEN** an infected groans or slams 1 m behind a glass partition the player stands 1.5 m in front of
- **THEN** the sound is slightly quieter and duller than with nothing in between, and clearly louder and brighter than through a wall

#### Scenario: Glass with a wall beyond it
- **WHEN** an infected groans in a room beyond a glass partition and a wall
- **THEN** the groan is fully muffled, as through a wall

#### Scenario: Steps behind the glass
- **WHEN** someone walks on the other side of a glass partition
- **THEN** their steps are only slightly quieter and duller

### Requirement: Infected voices
Infected SHALL groan from where they stand when they notice someone, and one infected near the player (within about 24 m) SHALL groan on its own every few seconds. Consecutive groans SHALL NOT repeat the same clip. Infected that are dead, playing dead or getting up SHALL stay silent.

#### Scenario: Ambush stays quiet
- **WHEN** an infected is playing dead near the player
- **THEN** it makes no groan until it wakes

### Requirement: Weapon sounds follow the animation
Weapon handling sounds (magazine out and in, slide, pump) SHALL be triggered by cue points in the weapon animation, not by timers, so sound and motion stay in sync at any frame rate.

#### Scenario: Shotgun pump
- **WHEN** the shotgun fires and its pump animation plays
- **THEN** the rack and slam sounds land on the pump motion

### Requirement: Sequence sound steps
Sequences SHALL be able to play a named sound (optionally at a world position), set the ambience, and start or stop the radio. A `music` step SHALL either control the music or be rejected when content is validated; it SHALL NOT be skipped silently at runtime. A `music` step MAY set the level its track plays at, from silent to full (the default); naming the playing track again SHALL ease it to the new level without restarting it. Pausing SHALL hold the track with the rest of the scene, and the pause menu SHALL play the menu theme at its own pause level. A sound step MAY ask to land on the score's next beat; it SHALL then play on that beat, or at once when no score is playing.

#### Scenario: Positional sequence sfx
- **WHEN** a sequence runs `{ "do": "sfx", "id": "klaxon", "at": "R03" }`
- **THEN** the klaxon plays from R03

#### Scenario: Music step
- **WHEN** a sequence contains a `music` step
- **THEN** it either changes the music or the content check fails, naming the step

#### Scenario: Music dips under a sound
- **WHEN** the main theme is playing and a sequence runs a `music` step naming it with a lower level
- **THEN** the theme eases down to that level and carries on, and the next `music` step that gives no level plays at full

#### Scenario: Pause during scene music
- **WHEN** the player pauses while a scene has the main theme playing at a lowered level, then resumes
- **THEN** the pause menu plays the menu theme, and the scene's track carries on at its lowered level from where it stopped

#### Scenario: Klaxon on the beat
- **WHEN** the Lab B score plays and a sequence runs a klaxon step that asks for the beat
- **THEN** the klaxon starts on the score's next beat, no more than one beat later

### Requirement: Positional prop loops and synchronized burst sounds
Level props SHALL be able to declare positional looping emitters and fire synchronized positional one-shots. Positional prop loops SHALL follow the game mode (silent on title, held while the scene is frozen, full during play), hot-swap to decoded ElevenLabs recordings, and reset cleanly on level reset or dispose. Prop one-shots SHALL respect distance culling and world sound occlusion through walls, closed doors, and glass partitions.

#### Scenario: Equipment loop respects pause and title
- **WHEN** a room prop runs a positional loop (such as a dehumidifier or kettle simmer) and the player pauses or returns to the title screen
- **THEN** the loop is held while paused, carrying on from the same point on resume, and fades to silence on the title screen

#### Scenario: Prop burst occluded by wall or glass
- **WHEN** a prop fires a synchronized positional one-shot in `R12b` while the player is behind a glass partition in `R12c` or behind a solid wall in `R12e`
- **THEN** the one-shot is lightly muffled through glass and fully muffled through a solid wall or closed door

### Requirement: The lockdown alarm is a real station alarm
The drop's alarm SHALL be its own recorded ElevenLabs sound, `lockdownAlarm`: a heavy, industrial, two-tone alarm with a hard attack and a metallic tail that reads as a real emergency, not a synth tone. It is separate from the pump room's looping `klaxon`.

#### Scenario: The drop's alarm
- **WHEN** the drop sequence plays its alarm steps at the gallery glass
- **THEN** the recorded alarm plays from there, on the score's beat as before

### Requirement: Power sounds
A recorded power-down sound SHALL play when the station goes to backup power, and each lit backup lamp SHALL play a low electrical hum from its position while the station is under backup power. Both SHALL be recorded files with no procedural fallback.

#### Scenario: Power fails
- **WHEN** the station switches to backup power
- **THEN** a power-down sound (relays dropping, generators winding down) plays at the player, and the room's light buzz stops

#### Scenario: Walking past a lamp
- **WHEN** the player walks past a lit backup lamp under backup power
- **THEN** its hum gets louder as they approach and fades as they leave

### Requirement: Wading slosh
While a body moves through standing water, it SHALL play a positional slosh loop that follows its speed and depth and
fades out when it stops. Other bodies' slosh SHALL follow the same range and occlusion rules as their footsteps.

#### Scenario: Stopping in the water
- **WHEN** Jay stops moving in the water
- **THEN** his slosh fades out within about half a second, leaving only the water settling

### Requirement: Jumping and landing in water
A jump that starts in water SHALL play a takeoff splash. Landing in water SHALL play a splash scaled to the fall height
in place of the landing footstep. Landing on a dry top after a jump from the water SHALL play that top's landing
footstep followed by water dripping off Jay.

#### Scenario: Jump onto a case
- **WHEN** Jay jumps from the water onto a steel case
- **THEN** a takeoff splash plays, then a metal landing step and dripping

#### Scenario: Landing back in the water
- **WHEN** Jay drops from the case back into the water
- **THEN** a landing splash plays, and no dry landing footstep plays

### Requirement: Spent casings land after the gun ejects them
Each pistol shot SHALL eject a spent brass casing, and each shotgun pump SHALL eject a spent hull on the pump motion, not on the shot. The casing SHALL be heard landing 0.35 s to 0.7 s after it leaves the gun, from a point on the floor 0.4 m to 1.5 m to the shooter's right. A dry fire SHALL eject nothing. Inserting shells during a reload SHALL eject nothing.

#### Scenario: Pistol shot
- **WHEN** Jay fires the pistol once while standing on a concrete floor
- **THEN** a single brass casing is heard landing to his right about half a second after the shot

#### Scenario: Shotgun hull on the pump
- **WHEN** Jay fires the shotgun and the pump animation racks it
- **THEN** the hull is heard landing after the pump's rack-back, not at the moment of the shot

#### Scenario: Dry fire
- **WHEN** Jay pulls the trigger on an empty pistol
- **THEN** no casing sound plays

### Requirement: Casing sound follows the surface it lands on
The landing sound SHALL be chosen from the acoustic surface at the landing point, not from the surface under the shooter. Concrete and metal plate SHALL ring and bounce. Metal plate SHALL ring longest. Rubber and carpet SHALL give a short dull tick with no bounce, clearly quieter than the same casing on concrete. A point with no surface tag SHALL use metal plate, as footsteps do.

#### Scenario: Standing on the edge of a carpet
- **WHEN** Jay stands on bare floor at the edge of the office carpet with the carpet to his right, and fires the pistol
- **THEN** the casing makes the soft carpet tick, not the hard-floor ring

#### Scenario: Deck plate against carpet
- **WHEN** Jay fires the same number of pistol shots once on metal plate and once on carpet
- **THEN** the casings on plate ring and bounce, and the casings on carpet are short, dull and clearly quieter

### Requirement: Casings fall through grates
A casing landing on a grate SHALL rattle on the grate. When the grate covers a floor or water below, within 3 m, the casing SHALL sometimes fall through and land again on that lower surface, more quietly and duller, after the extra fall time. A grate over nothing within 3 m SHALL play only the rattle.

#### Scenario: Grate over a lower deck
- **WHEN** Jay fires a burst of pistol shots while standing on a grate above a lower deck
- **THEN** each casing rattles on the grate, and some are heard again, fainter, landing on the deck below

### Requirement: Casings in water
A casing that lands where standing water is at least 2 cm deep and shallower than 45 cm SHALL make a small water plip instead of a floor sound. Where the water is 45 cm or deeper, the casing SHALL land silently.

#### Scenario: Shallow flooded corridor
- **WHEN** Jay fires the pistol while wading ankle-deep
- **THEN** each casing makes a small plip and no hard-floor ring

#### Scenario: Thigh-deep water
- **WHEN** Jay fires the pistol while standing thigh-deep
- **THEN** no casing sound plays

### Requirement: Brass and hulls sound different
Pistol brass SHALL sound bright and metallic on every surface. Shotgun hulls SHALL sound duller and lower, a plastic clack with a metal-base knock and fewer bounces. The two SHALL NOT share recordings.

#### Scenario: Same floor, both guns
- **WHEN** Jay fires the pistol and then the shotgun on the same concrete floor
- **THEN** the pistol casing tings and rolls, and the shotgun hull clacks once or twice

### Requirement: Casing sounds vary and stay clean under rapid fire
Consecutive casing landings SHALL NOT repeat the same recording at the same pitch. No more than 4 casing sounds SHALL play at once. When a fifth starts, the oldest SHALL fade out within 50 ms rather than cut off. Casing sounds SHALL be positional at the landing point and audible up to 8 m.

#### Scenario: Emptying a magazine
- **WHEN** Jay fires a full pistol magazine as fast as he can
- **THEN** each casing is distinct, the clatter never builds into a wash, and no casing sound clicks or pops off

#### Scenario: Out of range
- **WHEN** a casing lands more than 8 m from the listener
- **THEN** it is not heard

### Requirement: Casings are not a noise to enemies
A landing casing SHALL NOT count as a noise for infected hearing. The gunshot that ejected it already does.

#### Scenario: Noises from one shot
- **WHEN** Jay fires one pistol shot and its casing lands
- **THEN** the infected hear exactly one noise, the gunshot, and nothing for the casing

### Requirement: Squad gunshots
Each squad shot SHALL play a squad gunshot from the shooting mate's pistol muzzle. It SHALL be positional and muffled through walls and closed doors as other world sounds are. It SHALL be clearly distinguishable from Jay's own pistol shot, so that covering fire never sounds like Jay firing. Consecutive squad shots SHALL vary in pitch.

#### Scenario: Covering fire to the left
- **WHEN** Giles fires at an infected while standing 3 m to Jay's left
- **THEN** Jay hears a gunshot from the left that is distinct from his own pistol

#### Scenario: Through a door
- **WHEN** Okafor fires on the other side of a closed door
- **THEN** his gunshots are muffled and quieter

### Requirement: Squad brass
Each squad shot SHALL eject a brass casing from the shooting mate's pistol. It SHALL land and sound by the same rules as Jay's brass: timing, the surface where it lands, grates, water, variation, the voice limit and the 8 m range. Squad and player casings SHALL share the 4-voice limit.

#### Scenario: Squad mate on carpet
- **WHEN** Okafor fires while standing on the office carpet, within 4 m of Jay
- **THEN** his casings make the soft carpet tick

#### Scenario: Both firing on deck plate
- **WHEN** Jay and Giles fire pistols together on metal plate
- **THEN** both sets of casings ring, and no more than 4 casing sounds play at once

### Requirement: A live intercom relays a room
A room intercom SHALL link a source room to a speaker in another room. While it is live, every positioned world sound and
voice that starts in the source room, or in a room opening only onto it, SHALL also play from the speaker with a comms tone
and crackle. The direct sound SHALL be unchanged. An intercom that is off SHALL relay nothing. The speaker, its crackle and
its switch sounds SHALL be heard from where it hangs like any other sound there: muffled and quieter while a wall or closed
door stands between it and the player, slightly duller through glass alone, and clear otherwise. This SHALL follow the
player as he moves and as doors open and close, within a fraction of a second.

#### Scenario: Heard from the next room
- **WHEN** the Lab B intercom is live and the player stands in the Commons with the gallery door closed
- **THEN** what it relays is faint and muffled, it opens up as the door slides open, and it is clear once he is in the gallery

#### Scenario: A sound in the source room
- **WHEN** an intercom from the medical bay is live and an instrument tray falls in the surgery beyond it
- **THEN** the fall is also heard from the speaker in the security office, band-limited and with crackle

#### Scenario: Heard anywhere in the room
- **WHEN** a sound is relayed while the player stands in the corner of the speaker's room farthest from the speaker
- **THEN** the relayed sound is clear and easy to hear

#### Scenario: Off
- **WHEN** the intercom is off and a sound plays in the medical bay
- **THEN** nothing is heard from the speaker, and the sound reaches the player only directly

### Requirement: The intercom clicks and hisses
Switching an intercom on SHALL play a click and a short burst of static from its speaker, and switching it off SHALL play a
click. While it is live, a low crackle bed SHALL play from the speaker even when the source room is quiet.

#### Scenario: Switched on
- **WHEN** a sequence switches the medical bay intercom on
- **THEN** a click and a burst of static play from the speaker, and a low crackle continues after it

#### Scenario: Switched off
- **WHEN** a sequence switches the intercom off
- **THEN** a click plays from the speaker and the crackle stops

### Requirement: The intercom overloads on loud sounds
When a relayed sound is loud, such as a scream or a heavy impact, the speaker's output SHALL distort more and crackle
harder for as long as the sound stays loud, then recover. Overload SHALL never silence the relayed sound or push the
master output into clipping.

#### Scenario: A scream
- **WHEN** a full scream is relayed
- **THEN** the speaker's output is audibly more distorted and crackly during the scream than during quiet speech, and the scream stays audible

#### Scenario: Back to normal
- **WHEN** a loud relayed sound ends
- **THEN** within about 0.5 s the speaker's distortion and crackle return to their quiet level

### Requirement: Overheard exchanges in the Commons
The Commons bar pair and wall pair SHALL each have one voiced exchange for the time before the briefing (once the intro has ended) and two for the time after it. An exchange SHALL be spoken by the pair as `background` lines in written order, each from its speaker, with a short natural pause between lines. The two SHALL look at each other as in any conversation.

#### Scenario: Lingering at the bar
- **WHEN** the intro has ended and the player stops 3 m from the bar pair
- **THEN** they speak their pre-briefing exchange in order, each voice coming from its own speaker

#### Scenario: After the briefing
- **WHEN** the player returns after the briefing to a pair whose pre-briefing exchange was never heard
- **THEN** the pair speaks only after-briefing exchanges

#### Scenario: During the intro
- **WHEN** the player walks past either pair while the intro is playing
- **THEN** no exchange starts

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

### Requirement: An exchange plays once
An exchange that has started SHALL NOT play again in that playthrough, including after loading a checkpoint saved later. A pair's second after-briefing exchange SHALL NOT start until at least 20 s after its first ended.

#### Scenario: Coming back
- **WHEN** the player returns to a pair whose exchanges have all played
- **THEN** the pair only murmurs

#### Scenario: Reloading a checkpoint
- **WHEN** the player hears an exchange, a checkpoint is saved afterwards and that checkpoint is loaded
- **THEN** that exchange does not play again

### Requirement: An exchange ends early when it loses its audience
When the player leaves the item's room or moves more than 8 m from the speaking group or solo speaker, the current line SHALL finish and any remaining lines SHALL be dropped. When a line is cut off by a higher-priority line, or a participant stops being free to talk, the rest SHALL be dropped at once. Either way the exchange or solo snippet counts as played.

#### Scenario: Walking away mid-exchange
- **WHEN** the player walks 10 m from a speaking pair or boardroom group during the second line
- **THEN** that line finishes, fading with distance, and the third line is never said

#### Scenario: Interrupted by the squad
- **WHEN** Giles speaks within earshot during an overheard exchange or solo snippet
- **THEN** it stops and does not resume after his line

### Requirement: Voiced pairs stay put
Until the drop starts, the members of both voiced pairs SHALL stay at their places and SHALL NOT wander to other seats.

#### Scenario: A long stay in the Commons
- **WHEN** five minutes pass before the drop
- **THEN** both pairs are still together where they started, while other crew may have changed seats

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

### Requirement: Murmur makes way for an exchange
While a pair is speaking an exchange its own murmur SHALL be silent and other murmurs SHALL be quieter, returning when the exchange ends.

#### Scenario: The bar pair starts talking
- **WHEN** the bar pair's exchange begins
- **THEN** their murmur stops, the nearby wall murmur drops, and the words are easy to follow

### Requirement: Murmur sits in the room
Murmur SHALL play on the `ambience` bus and fade with distance. Room boundaries and closed doors SHALL make it quieter, and it SHALL be silent where a local voice would be silent. It SHALL follow the game mode as ambience does.

#### Scenario: Behind a closed door
- **WHEN** the player stands in a neighbouring room with the Commons door closed
- **THEN** the murmur is far quieter than inside the Commons, or silent

#### Scenario: Paused
- **WHEN** the game is paused in the Commons
- **THEN** the murmur stops with the rest of the ambience and carries on from the same point on resume

### Requirement: Commons talk ends at the drop
From the moment the drop starts, no overheard exchange SHALL start and no conversation murmur SHALL play for the rest of the playthrough.

#### Scenario: Loading a checkpoint saved after the drop
- **WHEN** a checkpoint saved after the drop is loaded and the player is within earshot of the Commons
- **THEN** no exchange or murmur is heard

### Requirement: Chairs scrape in the Commons
When a Commons crew member who wanders between seats gets up from a chair to move, or sits down on one, that chair SHALL scrape once. Stools, sofas and wall leans SHALL make no scrape, and neither SHALL anyone who is placed or reset without being seen to sit or stand.

#### Scenario: A diner moves tables
- **WHEN** a diner gets up from a chair, walks to another table and sits on a chair there
- **THEN** a scrape is heard from the first chair as they get up and from the second as they sit

#### Scenario: Moving to the sofa
- **WHEN** a crew member walks from a stool to a sofa
- **THEN** no chair scrape is heard

#### Scenario: Loading a save
- **WHEN** a load puts the crew back in their seats
- **THEN** no scrape is heard

### Requirement: Cups and cutlery at occupied tables
While crew sit on chairs in the Commons, a cup or cutlery sound SHALL come now and then from the table in front of one of them, at random intervals of about 4 to 10 s. With nobody on a chair there SHALL be none.

#### Scenario: Standing by a full table
- **WHEN** the player stands near a table with seated crew for a minute
- **THEN** several irregular clinks are heard from that part of the room

#### Scenario: An empty room of chairs
- **WHEN** no crew member is sitting on a chair
- **THEN** no table sound plays

### Requirement: Kitchen sounds while Bram is at his station
After the intro, while Bram stands at his station and no scripted Commons scene is running, pans, plates or the tap SHALL be heard from the kitchen counter at random intervals of about 8 to 20 s.

#### Scenario: Bram at work
- **WHEN** the intro has ended and Bram is at his station
- **THEN** irregular kitchen sounds come from the counter

#### Scenario: Bram away from the counter
- **WHEN** Bram is walking to the coffee machine or working it
- **THEN** no kitchen sound starts

#### Scenario: During the intro
- **WHEN** the intro is playing
- **THEN** no random kitchen sound starts

#### Scenario: Loading the save made as the intro ends
- **WHEN** the player loads the save made as the intro ends
- **THEN** kitchen sounds and brews happen as they would have without the load

### Requirement: Bram makes a brew
After the intro, Bram SHALL now and then walk from his station to the coffee machine, work it for about 8 s while the machine grinds, hisses and drips from where it stands, then walk back to his station and face as he did before. The first brew SHALL come within 60 s of time the player spends free in the Commons, and later ones about 2 to 3 minutes of such time apart.

#### Scenario: Waiting in the Commons
- **WHEN** the player stays free in the Commons for a minute after the intro with no one speaking
- **THEN** Bram walks to the machine, the brew is heard from it, and Bram returns to his station

#### Scenario: Player elsewhere
- **WHEN** the player stays outside the Commons
- **THEN** Bram does not start a brew

### Requirement: When a brew may start
A brew SHALL start only while the player is in the Commons with free control, no line is being spoken, no overheard exchange is running, no scripted Commons scene is running, and Bram is free at his station. A brew that is due while one of these fails SHALL wait for all of them.

#### Scenario: A line is playing
- **WHEN** a brew is due while a story line, hint or bark is audible, or a pair is saying an exchange
- **THEN** Bram stays at his station until the talk has ended

#### Scenario: Leaving mid-brew
- **WHEN** the player leaves the Commons while Bram is brewing
- **THEN** Bram finishes and returns to his station

### Requirement: A brew gives way
A scripted command to Bram, the drop or a checkpoint load SHALL end a brew and its sound at once. A script then has full control of Bram, and the brew SHALL NOT resume or move him afterwards. If Bram cannot reach the machine within about 12 s, he SHALL give up without the sound and return to his station.

#### Scenario: A scene takes Bram
- **WHEN** a script moves Bram while he is walking to the machine or working it
- **THEN** the brew sound stops and Bram does what the script says
- **AND** he is not walked back to the machine later by that brew

#### Scenario: The drop starts mid-brew
- **WHEN** the drop starts while Bram is brewing
- **THEN** the sound stops and Bram returns to his station

#### Scenario: Loading mid-brew
- **WHEN** a checkpoint is loaded while Bram is brewing
- **THEN** the sound stops and Bram is where the story has left him

#### Scenario: The player stands in the way
- **WHEN** the player blocks Bram from the machine
- **THEN** Bram gives up, no brew is heard, and he goes back to his station once the way is clear

### Requirement: The coffee machine sounds in the intro
When Bram works the coffee machine in the intro, the machine SHALL be heard from where it stands, quietly enough that the lines stay clear. A skipped intro SHALL NOT play it afterwards.

#### Scenario: Walking into the kitchen scene
- **WHEN** the intro shows Bram working the coffee machine
- **THEN** the machine is heard and every line over it is easy to follow

#### Scenario: Skipping the intro
- **WHEN** the player skips the intro before Bram reaches the machine
- **THEN** no intro brew sound plays

### Requirement: Commons room sounds sit in the room
Chair, table, kitchen and brew sounds SHALL come from their place in the room, fade with distance and be muffled by walls and closed doors as other world sounds are. Repeats SHALL vary in recording or pitch. While a line is audible or an exchange is being said, chair, table and kitchen sounds that start SHALL be quieter.

#### Scenario: Behind a closed door
- **WHEN** a clink sounds while the player is in a neighbouring room with the door closed
- **THEN** it is muffled and quieter, or not heard

#### Scenario: Talk over the clatter
- **WHEN** a pair is saying an exchange as a table sound starts
- **THEN** the sound is quieter than usual and the words are easy to follow

#### Scenario: Back to title
- **WHEN** the player returns to the title screen during a brew
- **THEN** no room sound is heard

### Requirement: Commons room sounds end at the drop
From the moment the drop starts, no chair, table or kitchen sound SHALL start and Bram SHALL NOT brew for the rest of the playthrough.

#### Scenario: Loading a checkpoint saved after the drop
- **WHEN** a checkpoint saved after the drop is loaded and the player is within earshot of the Commons
- **THEN** no chair, table, kitchen or brew sound is heard

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
