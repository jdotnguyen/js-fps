# Design

## Context

See proposal.md - Why. Current state that shapes the approach (read on 2026-11-25, tree `94460a3` plus other agents' uncommitted work):

- The `commons_murmur` ambience preset plays its beds and two random one-shots. Preset one-shots land at random points around the player, so they cannot come from a table or a machine.
- `AmbientDirector` (`src/ai/ambientLife.ts`) moves unnamed crew between level spots every 30-90 s. Spots carry a kind (`sit_chair`, `sit_stool`, ...), a position and a yaw that faces the table. It reports no events.
- Bram (`cook`) is a story NPC, so the ambient director never moves him. Only `intro_shift_change`, `rounds` and `quiet_restore` command him, and the last two snap him to `cook_stand`. The intro already walks him from the room to `cook_coffee` and plays the `typing` pose there.
- The level already has the anchors needed: `cook_stand`, `cook_coffee`, `coffee_machine`, `counter`. The straight line from `cook_stand` to `cook_coffee` is about 3.9 m, behind the servery.
- `cook_stand` has yaw 0, which faces the kitchen counter, although the `intro-sequence` spec says Bram faces into the room. This change returns him to whatever the anchor says and leaves that mismatch alone.
- `AudioEngine.play` returns a handle that can be stopped, and muffles positional `sfx` one-shots through walls, doors and glass when they start.
- A skipped sequence runs no `sfx` steps.

## Goals / Non-Goals

**Goals:**

- Every sound comes from a thing or a person the player can see.
- Keep the decision logic pure and Node-testable, like `ConversationMurmur` and `OverheardDirector`.
- Leave one place where a later change can thin these sounds by briefing round.
- No level data changes: `slice01.json` carries other uncommitted work.

**Non-Goals:**

- A general system of room soundscapes or NPC routines. This is one room and one routine.
- Changing the ambience presets.
- Matching clinks to eating or drinking gestures.
- Anything in proposal.md's out-of-scope list.

## Decisions

### D1. Two pure modules

- `src/audio/commonsSounds.ts` plays chair, table and kitchen sounds. Each frame it gets the seated places, whether Bram is at his station with the kitchen allowed, whether anyone is talking, the listener position and whether the drop has started. Chair moves arrive as calls.
- `src/ai/cookBrew.ts` runs the brew over a small host: the flags and conditions, Bram's walk, pose and position, and starting and stopping the sound. The session wires both, as it does the overheard director.

*Alternative:* new one-shot placements in `AmbienceDirector`. Rejected: it knows rooms and presets, not people or props.

*Alternative:* a repeating sequence for the brew. Rejected: sequences are trigger-driven scenes, and cancelling one cleanly when another script takes Bram is harder than a routine that listens for it.

### D2. The ambient director reports chairs

`AmbientDirector` gains an optional listener, called when a real move leaves a spot and when an arrival settles on one, and a query for the settled, available agents in a room by spot kind. The controller filters to `sit_chair` in the Commons. `reset` and `interrupt` call nothing, so loads and script takeovers are silent.

*Alternative:* comparing seat occupancy between frames. Rejected: a reset would look like a room of people standing up.

### D3. Where each sound comes from

| Sound | Position |
| --- | --- |
| Chair | The spot, near the floor |
| Table | 0.45 m in front of a seated agent's spot, at table height (about 0.78 m); the agent is picked at random |
| Kitchen | The `counter` anchor, spread about 1.2 m either way along the counter |
| Brew | The `coffee_machine` anchor |

### D4. Playback

All four play as positional one-shots on the `sfx` bus, so walls, closed doors and glass muffle them with no new code, and the SFX slider covers them. Nothing starts beyond 24 m. While `speech.speaking()` is set or an exchange is running, a chair, table or kitchen sound starts at half level; that is read once, at the start. The brew handle is kept only to stop it (interrupt, drop, reset, title). Like other `sfx` one-shots, a sound already playing runs on under the pause menu.

*Alternative:* the `ambience` bus, which story lines already duck. Rejected: world occlusion excludes that bus, so walls would need their own level-only handling, and pausing or ducking is not worth that for sounds this short.

### D5. The brew routine

States: waiting, walking out, brewing, walking back.

- The wait counts down only while the player is in the Commons with free control, after the intro and before the drop. When it reaches zero the brew waits for the rest of the conditions in the spec. The first wait is 30-60 s and later ones 120-180 s, from a seeded `Rng`.
- It drives Bram's actor directly, as the ambient director and dock guard routine do: `moveTo` the `cook_coffee` anchor, the `typing` pose for 8 s with the sound, `resetPose`, `moveTo` the `cook_stand` anchor and yaw. No new clip.
- "At his station" means within 0.6 m of `cook_stand` and not walking. A walk that has not arrived after 12 s, or ends more than 0.6 m short, is abandoned. The routine keeps retrying the walk back only for a trip it started.
- `NpcDirector.command` tells the routine before applying any command to `cook`. The routine then stops the sound, clears his pose and forgets the trip, and the command does the rest.
- "After the intro" is the `introSeen` flag, for the kitchen too. The intro sets it just before its autosave. `commons_free` is set only after that save, so a loaded game does not have it; a browser run caught this on 2026-11-25.
- The drop ends the brew and walks him back. A restart or level reset ends it with no walk; `NpcDirector.reset` and the restore sequences place him.
- No brew starts until the `coffeeBrew` recording is decoded, so he never works a silent machine.

### D6. Recordings

| Name | What | Variants |
| --- | --- | --- |
| `chairScrape` | Short chair leg scrape on a hard floor | 4 |
| `tableClink` | Single cup, spoon or fork sounds, quiet | 6 |
| `kitchenClatter` | Pan set down, plates stacked, a short run of the tap | 4 |
| `coffeeBrew` | About 8 s: grind, then hiss and drip | 2 |

All mono, in `public/assets/audio/ambience/`, registered in `SAMPLE_URLS` with no procedural fallback, so a missing one is skipped. All four were found as CC0 recordings on Freesound (licence confirmed on each sound's own page, 2026-11-25), so nothing is generated: `scripts/commons-sounds-generate.ts` cuts them from the downloads in `../audio-src/commons/`. The brew is normalized to a -6 dB peak. The short clips are matched to -15 dB RMS over their loudest 100 ms with a limiter at -2 dB; see "After the first listen". Those downloads are Freesound's high-quality MP3 previews; the originals need an account. Each brew take is one bean-to-cup machine grinding, then pouring. The user judges them by ear.

### D7. The intro

An `sfx` step at the `coffee_machine` anchor goes beside each of the two places the intro puts Bram into `typing` at the machine, with its level tuned under the lines. It uses the same recordings. This step lands after `shorten-intro` is committed, since that change edits the same file (done on `25739ac`; gain 0.35).

A full unskipped run on 2026-11-26: the first brew plays 90 s in, with Jay about 21 m away in the dock ring, so it is barely audible and over before Jay reaches the Commons at 111 s. The second plays at 119 s, 3 m away, with Bram at the machine. Both are as specified; whether the first should move to Jay's arrival is open to the ear check.

### D8. Starting values

The 4-10 s table and 8-20 s kitchen intervals, the half level during talk, the 24 m cut-off, and D5's waits, 8 s, 12 s and 0.6 m are starting values. If tuning by ear changes one that a spec states, update the delta in this change.

## After the first listen

The user heard the brew and nothing else. Measured in the running game on 2026-11-26 by tapping each source before its bus: the room bed's mean was about -30 dBFS, table and kitchen sounds arrived at -55 to -58 from the middle of the room, and other groups' murmur averaged -50 to -57.

| Sound | Before | After | Change |
| --- | --- | --- | --- |
| Chair, from the middle | -41 | -29 | clips matched on loudness, gain 0.35 to 1.3 |
| Table, from the middle | -55 | -33 | clips matched on loudness, gain 0.3 to 2 |
| Kitchen, from the middle | -58 | -36 | clips matched on loudness, gain 0.3 to 2.2 |
| Nearest murmur, mean | -50 | -38 | gain 0.2 to 0.9 |

Chair, table and kitchen figures are the median of each playback's loudest 85 ms. Near their sources the three arrive at about -24 to -30. The brew and the overheard voices are unchanged.

The same session showed that `src/ai/overheard.ts` read `commons_free` for the pre-briefing phase, the flag D5 explains is missing from the intro save. It now reads `introSeen`. It also showed Giles's dawdle call cutting the bar pair off after two lines, which counts as played; part 1 accepted that, and it is unchanged.

The user accepted the result on 2026-11-26.

## Memory

Measured 2026-11-25 at `/?level=slice01&slot=scratch&nosplash&memprobe` (dev server, headless Chrome on the RX 7900 XTX at 1280x720, default settings, tutorial prompts off, Vite hot reload blocked in the tab): load, wait until decoded audio stops growing, skip the intro, stand in the kitchen for 25 s, then three samples of `window.__memprobe.sample()`, each after a forced garbage collection. The samples agreed.

| | Before | After | Same tree, new clips blocked | This change |
| --- | --- | --- | --- | --- |
| Decoded audio | 505 MB | 504 MB | 499 MB | +5 MB (+1%) |
| JS heap | 354 MB | 365 MB | 365 MB | none |
| GPU textures | 1605 MB | 1605 MB | 1605 MB | none |

Before is `f6d1441` plus other agents' uncommitted work. After was measured on 2026-11-25/26 on `da0f4fe` plus uncommitted work, so Before and After also differ by other changes. The last two columns isolate this one: the same run with requests for the 16 new clips aborted. No figure rose by more than 15%.

## Browser check

2026-11-25/26, headless Chrome, scratch slot, New Game with the intro skipped. Bram's walk and pose were seen from the room and from beside the machine; the first brew came 49 s into free play and a second 148 s after the first, from the machine. Standing on the spot Bram works from gave no brew and Bram left. Loading the autosave mid-brew cut the sound and left Bram at the station. A drop started mid-brew (briefing and rounds skipped by setting their flags, then walking into the trigger by teleport) cut the sound, sent Bram home and was followed by no Commons sound; `jump=r05` gave none either. No console errors. Not heard by ear.

## Risks / Trade-offs

- [Chairs scrape too often, since several crew roam] -> Judge by ear; if it is busy, add a minimum gap between scrapes.
- [The player stands in Bram's path, or Bram pushes past awkwardly] -> The give-up timeout, and a playtest standing at the machine and in the aisle.
- [A later script commands Bram without moving him, stranding him at the machine] -> Today every script that touches him moves him. A stranded Bram only means no more kitchen sounds or brews until a load.
- [The intro grinder competes with dialogue, or is heard unmuffled from the corridor, as sequence sounds are] -> Low level, checked by ear in the full intro.
- [Little free time before the briefing, so some players see no brew until after it] -> Accepted.
- [`npcs.ts`, `session.ts`, `sounds.ts` and `CREDITS.md` carry other agents' uncommitted work] -> Commit only this change's hunks.
