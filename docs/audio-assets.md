# Adding a sound

How to add or replace game audio. The behaviour these steps serve is specified in
[`openspec/specs/audio-assets`](../openspec/specs/audio-assets/spec.md).
Dialogue voice lines follow [voice-casting-standard.md](voice-casting-standard.md) instead.

## 1. Find or generate the file

Look for a recording you may use before generating one, in this order:

1. **CC0** (public domain): OpenGameArt, Freesound with the CC0 filter.
2. **CC BY** (credit required): fine, with its `CREDITS.md` line.
3. **Royalty-free game packs** that allow use in a commercial game without credit (for example the Sonniss GDC
   bundles).
4. **ElevenLabs**, for whatever none of the above has.

Never use a clip under a non-commercial (NC) or share-alike (SA) licence. Check the licence on the clip's own page
when you download it, not from a search result or a pack listing, and record it in `CREDITS.md` (step 3).
Loudness-match a downloaded clip to the sounds it plays beside and run it through the room's reverb before keeping it.

To generate with ElevenLabs, put `ELEVENLABS_API_KEY` in `.env`. Each script has a manifest of prompts at the top;
add an entry there, then generate it:

| Kind | Script | Output folder |
| --- | --- | --- |
| Ambience beds, spatial emitters, one-shots | `npm run ambience:generate -- --id <id>` | `public/assets/audio/ambience/` |
| Door motion and access feedback | `npm run doors:generate -- --id <id>` | `public/assets/audio/doors/` |
| Footsteps | `npm run footsteps:generate -- --id <id>` | `public/assets/audio/footsteps/` |
| Infected-kill body sounds (bone crunches, tearing, the burst, blood on glass, drips, the creature), and the player's own hit impacts and low-health heartbeat | `npm run gore:generate -- --id <id>` | `public/assets/audio/gore/` |
| Spent-casing landings (brass and shotgun hulls, per floor surface). Its manifest mixes CC0 cuts, whose raw downloads live in `../audio-src/casings/`, with ElevenLabs prompts | `npm run casings:generate -- --id <id>` | `public/assets/audio/weapons/casings/` |
| Physics impacts (loose props hitting things, severed pieces landing), all cut from CC0 recordings whose raw downloads live in `../audio-src/physics/` | `npm run impacts:generate -- --id <id>` | `public/assets/audio/physics/` |

`--list` shows the manifest, `--all` generates everything missing, and `--force` regenerates.

The squad's covering-fire gunshot (`squadPistolShot`, `public/assets/audio/weapons/squad-pistol-shot.mp3`) is a
downloaded clip, not generated: "pistol shot" by mrfriends on Pixabay, raw download in
`../audio-src/weapons/mrfriends-pistol-shot-233473.mp3`. It was made mono, its leading silence and silent tail trimmed
(1.35 s, a 0.2 s fade-out), and raised 3.3 dB into a -1 dB limiter; the game varies its pitch ±4% per shot.

Do not add a new procedural synth for a new sound: procedural audio is fallback-only.

Kill sounds (`data/kills.json`, infection-kills spec) name a list of sounds per event: the first that exists plays, so a
recording still to be generated falls back to an existing stand-in (`kill_crunch` -> `fleshTear`). After
`npm run gore:generate -- --all`, `npm run gore:generate -- --register` prints the `samples` entries to add. Voss's
panting and whimpers (`voss_panic_breath`) are vocal reactions, so they come from Gemini TTS:
`node --experimental-strip-types scripts/vo-reactions.ts --only react_voss_panic`, then register
`react_voss_panic_01..03.mp3` under `voss_panic_breath`. Her screams stay the credited OpenGameArt clips.

## 2. Register it by name

Add the file to `samples` in the area file it belongs to, under `src/audio/sounds/`:

| File | Sounds |
| --- | --- |
| `ambience.ts` | Station room beds, spatial emitters, hull, water, console, hydroponics and med bay one-shots |
| `commons.ts` | The Commons chairs, tables, kitchen, coffee and murmur |
| `creatures.ts` | Creature voices, gaits and movement, including the vent escape |
| `docks.ts` | The dock checkpoint, the dive bay launch hall and the supply sub |
| `doors.ts` | Door motion and access feedback |
| `flood.ts` | Standing water, the flooded tunnel and pump room, the valve cutscene |
| `footsteps.ts` | Boot steps and wading |
| `impacts.ts` | Loose props and severed pieces hitting things |
| `kills.ts` | Infected-kill body sounds and the R08 and Lab B scenes |
| `player.ts` | The flashlight, hits on the player, the low-health heartbeat and breathing |
| `power.ts` | The station blackout and the R11 power bay |
| `roomLife.ts` | Living-station room beds, emitters and room-life foley |
| `transit.ts` | The departure bay, the transit ride and the R16 arrival |
| `ui.ts` | Menu sounds |
| `weapons.ts` | Weapons and spent casings |

A new area gets a new file, listed once in `src/audio/sounds/index.ts`. Only one area file may define a name
(`src/audio/soundAreas.test.ts` checks this). `src/audio/sounds.ts` only re-exports the index, so code keeps importing
from it.

Several files under one name become variants, picked per play. If the name matches an existing procedural sound in an
area file's `specs`, register the file in that same area: it replaces the procedural sound as soon as it decodes, and
the procedural version stays as the fallback.
Play it by name (`audio.play('<name>', ...)`, or a sequence `{ "do": "sfx", "id": "<name>" }`).

**Occlusion.** A one-shot `audio.play` on the `sfx` bus with a `position` is muffled automatically
when a wall or closed door is between it and the player (in-world-audio spec, "World sound
occlusion"); through a glass partition only, it is just slightly quieter and duller ("Glass muffles
lightly"). Pass `occlude: false` for a sound that must play as authored or that already handles
occlusion itself. Sequence and kill sounds, footsteps, loops and the other buses are never muffled
this way.

## 3. Credit anything you did not generate

A clip from anywhere else (OpenGameArt, Freesound, a purchased pack) must be listed in
[`CREDITS.md`](../CREDITS.md) with its author, source link and licence before it ships.

## 4. Check

Run `npm run audio:audit`. It fails when a procedural sound, a registered sample or a file in
`public/assets/audio/` is not used by anything. `npm test` runs the same check.
