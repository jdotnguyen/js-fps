# in-world-audio Specification

## Purpose

Defines the sounds that come from the station and the things in it: room ambience, the TAG FM radio, doors, footsteps, infected voices and weapons, plus the sequence steps that let scripted scenes control them.

## Requirements

### Requirement: Room ambience presets
Each room SHALL play the ambience preset named in its level data: `hull_hum`, `commons_murmur`, `lab_hum`, `hull_groan`, `office_hvac`, `med_beeps`, `water_drip`, `pipes_knock`, `hydro_misters`, `hydro_vestibule`, `hydro_seed_lab`, `hydro_plant_room`, `hydro_storeroom`, `dive_drip`, `launch_bay`, or `silent`. A missing or unknown name SHALL use `hull_hum`. Changing presets SHALL crossfade over about 2 s.

#### Scenario: Enter the commons
- **WHEN** the player walks from a `hull_hum` corridor into the commons (`commons_murmur`)
- **THEN** the crew murmur bed fades in and the hull hum fades out over about 2 s

#### Scenario: Enter the launch trunk hall
- **WHEN** the player walks from the wet vestibule (`dive_drip`) into the Launch Hall (`launch_bay`)
- **THEN** the hydraulic hum and the water moving in the trunk fade in over about 2 s, with occasional winch clunks and pressure pings

#### Scenario: Enter the hydroponics rooms
- **WHEN** the player walks from `R12a` (`hydro_vestibule`) into `R12b` (`hydro_misters`), then into `R12c` (`hydro_seed_lab`) or `R12d` (`hydro_plant_room`)
- **THEN** each room's ambience bed crossfades over about 2 s to match that space

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
Ambience SHALL be silent on the title screen, reduced to about 35% while paused, and at full level during play.

#### Scenario: Back to title
- **WHEN** the player returns to the title screen
- **THEN** the room ambience fades out and only the menu music remains

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
Sequences SHALL be able to play a named sound (optionally at a world position), set the ambience, and start or stop the radio. A `music` step SHALL either control the music or be rejected when content is validated; it SHALL NOT be skipped silently at runtime. A sound step MAY ask to land on the score's next beat; it SHALL then play on that beat, or at once when no score is playing.

#### Scenario: Positional sequence sfx
- **WHEN** a sequence runs `{ "do": "sfx", "id": "klaxon", "at": "R03" }`
- **THEN** the klaxon plays from R03

#### Scenario: Music step
- **WHEN** a sequence contains a `music` step
- **THEN** it either changes the music or the content check fails, naming the step

#### Scenario: Klaxon on the beat
- **WHEN** the Lab B score plays and a sequence runs a klaxon step that asks for the beat
- **THEN** the klaxon starts on the score's next beat, no more than one beat later

### Requirement: Positional prop loops and synchronized burst sounds
Level props SHALL be able to declare positional looping emitters and fire synchronized positional one-shots. Positional prop loops SHALL follow the game mode (silent on title, ducked while paused, full during play), hot-swap to decoded ElevenLabs recordings, and reset cleanly on level reset or dispose. Prop one-shots SHALL respect distance culling and world sound occlusion through walls, closed doors, and glass partitions.

#### Scenario: Equipment loop respects pause and title
- **WHEN** a room prop runs a positional loop (such as a dehumidifier or kettle simmer) and the player pauses or returns to the title screen
- **THEN** the loop ducks to pause level while paused and fades to silence on the title screen

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
and crackle. The direct sound SHALL be unchanged. An intercom that is off SHALL relay nothing.

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
An exchange SHALL start only when the player is in the Commons within 5 m of the pair, both speakers are free to talk, no other exchange is playing, no higher-priority line has been audible for 2 s, no scripted Commons scene is running, the player has free control, and every recording of the exchange is ready. When both pairs qualify, the nearer SHALL speak.

#### Scenario: Between the two pairs
- **WHEN** the player is within 5 m of both pairs
- **THEN** only the nearer pair's exchange plays

#### Scenario: A pause in a Commons scene
- **WHEN** the lab researcher's walk-by is running and no one is speaking at that moment
- **THEN** no exchange starts

#### Scenario: A recording is not ready
- **WHEN** one clip of an exchange has not loaded or is missing
- **THEN** the exchange does not start, no substitute voice sound plays, and the pair keeps murmuring

### Requirement: An exchange plays once
An exchange that has started SHALL NOT play again in that playthrough, including after loading a checkpoint saved later. A pair's second after-briefing exchange SHALL NOT start until at least 20 s after its first ended.

#### Scenario: Coming back
- **WHEN** the player returns to a pair whose exchanges have all played
- **THEN** the pair only murmurs

#### Scenario: Reloading a checkpoint
- **WHEN** the player hears an exchange, a checkpoint is saved afterwards and that checkpoint is loaded
- **THEN** that exchange does not play again

### Requirement: An exchange ends early when it loses its audience
When the player leaves the Commons or moves more than 8 m from the pair, the current line SHALL finish and the rest SHALL be dropped. When a line is cut off by a higher-priority line, or a speaker stops being free to talk, the rest SHALL be dropped at once. Either way the exchange counts as played.

#### Scenario: Walking away mid-exchange
- **WHEN** the player walks 10 m from the bar pair during the second line
- **THEN** that line finishes, fading with distance, and the third line is never said

#### Scenario: Interrupted by the squad
- **WHEN** Giles speaks within earshot during an exchange
- **THEN** the exchange stops and does not resume after his line

### Requirement: Voiced pairs stay put
Until the drop starts, the members of both voiced pairs SHALL stay at their places and SHALL NOT wander to other seats.

#### Scenario: A long stay in the Commons
- **WHEN** five minutes pass before the drop
- **THEN** both pairs are still together where they started, while other crew may have changed seats

### Requirement: Conversation murmur
Every Commons conversation with at least two people taking part SHALL give a soft, wordless murmur from where they are, whether it is a set pair or a table group formed as crew move. It SHALL fade in and out over about 1 s as the conversation forms or breaks up, and two groups SHALL NOT sound identical.

#### Scenario: Walking through the lounge
- **WHEN** two table groups are talking on opposite sides of the player
- **THEN** a murmur is heard from each side, with no intelligible words

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
- **THEN** the murmur drops with the rest of the ambience

### Requirement: Commons talk ends at the drop
From the moment the drop starts, no overheard exchange SHALL start and no conversation murmur SHALL play for the rest of the playthrough.

#### Scenario: Loading a checkpoint saved after the drop
- **WHEN** a checkpoint saved after the drop is loaded and the player is within earshot of the Commons
- **THEN** no exchange or murmur is heard
