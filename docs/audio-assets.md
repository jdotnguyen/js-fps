# Adding a sound

How to add or replace game audio. The behaviour these steps serve is specified in
[`openspec/specs/audio-assets`](../openspec/specs/audio-assets/spec.md).
Dialogue voice lines follow [voice-casting-standard.md](voice-casting-standard.md) instead.

## 1. Generate the file (ElevenLabs SFX)

New and replacement sound effects come from ElevenLabs. Put `ELEVENLABS_API_KEY` in `.env`. Each
script has a manifest of prompts at the top; add an entry there, then generate it:

| Kind | Script | Output folder |
| --- | --- | --- |
| Ambience beds, spatial emitters, one-shots | `npm run ambience:generate -- --id <id>` | `public/assets/audio/ambience/` |
| Door motion and access feedback | `npm run doors:generate -- --id <id>` | `public/assets/audio/doors/` |
| Footsteps | `npm run footsteps:generate -- --id <id>` | `public/assets/audio/footsteps/` |
| Infected-kill body sounds (bone crunches, tearing, the burst, blood on glass, drips, the creature) | `npm run gore:generate -- --id <id>` | `public/assets/audio/gore/` |

`--list` shows the manifest, `--all` generates everything missing, and `--force` regenerates.
Do not add a new procedural synth for a new sound: procedural audio is fallback-only.

Kill sounds (`data/kills.json`, infection-kills spec) name a list of sounds per event: the first that exists plays, so a
recording still to be generated falls back to an existing stand-in (`kill_crunch` -> `fleshTear`). After
`npm run gore:generate -- --all`, `npm run gore:generate -- --register` prints the `SAMPLE_URLS` entries to add. Voss's
panting and whimpers (`voss_panic_breath`) are vocal reactions, so they come from Gemini TTS:
`node --experimental-strip-types scripts/vo-reactions.ts --only react_voss_panic`, then register
`react_voss_panic_01..03.mp3` under `voss_panic_breath`. Her screams stay the credited OpenGameArt clips.

## 2. Register it by name

Add the file to `SAMPLE_URLS` in `src/audio/sounds.ts`. Several files under one name become
variants, picked per play. If the name matches an existing procedural sound in `SOUND_SPECS`,
the file replaces it as soon as it decodes, and the procedural version stays as the fallback.
Play it by name (`audio.play('<name>', ...)`, or a sequence `{ "do": "sfx", "id": "<name>" }`).

## 3. Credit anything you did not generate

A clip from anywhere else (OpenGameArt, Freesound, a purchased pack) must be listed in
[`CREDITS.md`](../CREDITS.md) with its author, source link and licence before it ships.

## 4. Check

Run `npm run audio:audit`. It fails when a procedural sound, a registered sample or a file in
`public/assets/audio/` is not used by anything. `npm test` runs the same check.
