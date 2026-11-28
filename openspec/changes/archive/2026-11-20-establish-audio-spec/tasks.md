# Tasks

## 1. Voice bus

- [x] 1.1 Add `voice` to `BusName` and `AudioEngine.buses` (base level 1) and verify with a unit test that the engine exposes five buses, all feeding master
- [x] 1.2 Route `WebAudioVoicePlayer` output to the engine's `voice` bus in `main.ts` (pass the bus as `AudioOut.master`) and verify in the browser that local and radio lines still play, with local lines keeping the room reverb send
- [x] 1.3 Update the doc comments in `engine.ts` and `voicePlayer.ts` to describe five buses and cite `openspec/specs/audio-mix`, and verify `npm run typecheck` is clean

## 2. Volume settings

- [x] 2.1 Add `musicVolume`, `sfxVolume`, `voiceVolume` (0..1, default 1) to `core/settings.ts`, and verify with a test that saved settings missing the new keys load with defaults of 1
- [x] 2.2 Apply each setting as base level × setting on its buses (SFX scales `sfx`, `ambience`, `ui`), and verify with a unit test using a stub context that changing `voiceVolume` changes only the voice bus gain
- [x] 2.3 Add Music, SFX and Voice sliders under Master volume in `ui/menus/screens.ts`, and verify in the browser that each slider changes its sounds immediately and persists after reload
- [x] 2.4 Change the subtitles toggle help text to describe fully voiced dialogue (for example "Subtitles show what is being said."), and verify no settings text mentions non-verbal sounds

## 3. Story ducking

- [x] 3.1 Add a duck gain stage on `music` and `ambience` (after the user setting) with a helper that ramps by a dB amount (~0.15 s), and verify with a unit test that ducking 4 dB sets those buses to about 0.63× and leaves the others alone
- [x] 3.2 Subscribe to `speech:started` / `speech:ended` in `main.ts`, counting active `story` lines and ducking while the count is above zero, and verify with a test that overlapping story lines keep the duck until the last one ends and that `combat`/`hint` lines never duck
- [x] 3.3 Listen in the browser to a story line over ambience and to pausing mid-line, and verify the duck is audible but not pumping and that pause plus duck recovers cleanly

## 4. Sequence music host

- [x] 4.1 Add a `music(id | null)` host to `script/gameHost.ts` that maps `main_theme` to the "Pressure" theme on the music bus (full level until stopped; `null` fades out ~2 s), and verify the intro's two `music` steps no longer log "missing" and the theme starts and fades where authored
- [x] 4.2 Reject unknown `music` ids in the sequence content check, naming the sequence and step, and verify with a test that a sequence using `{ "do": "music", "id": "nope" }` fails the check

## 5. Procedural audit and pruning

- [x] 5.1 Write `scripts/audio-audit.ts` that lists `SOUND_SPECS` entries no code/sequence/level references, `SAMPLE_URLS` entries nothing plays, and files in `public/assets/audio/` not in the registry, and verify it reports none on the current tree (matching the Nov 20 audit)
- [x] 5.2 Run the audit as a test (`src/audio/audit.test.ts`) so a dead entry fails `npm test`, and verify by temporarily adding an unreferenced spec and seeing the test fail
- [x] 5.3 Delete any procedural specs the audit flags (none today), keeping fallbacks that a recording shadows, and verify `npm test` and `npm run sounds:preview` still pass
- [x] 5.4 Add a short "Adding a sound" section to `docs/voice-casting-standard.md` §1 (or a new `docs/audio-assets.md`) covering: register by name in `SAMPLE_URLS`, generate with the ElevenLabs scripts, credit third-party clips in `CREDITS.md`; and verify the commands it lists exist in `scripts/`

## 6. Retire the audio ADRs

- [x] 6.1 Delete `docs/adr/0013-audio.md` and `docs/adr/0010-dialogue-voice-hints.md`, and verify `git status` shows both removed
- [x] 6.2 Remove the audio and voice paragraphs from ADRs 0004, 0005, 0012, 0017, 0021, 0022, 0023 and 0027, replacing each with a one-line pointer to the matching `openspec/specs/<capability>/`, and verify `grep -niE "emote|non-verbal|reverb|footstep|radio effect" docs/adr` returns only pointer lines
- [x] 6.3 Update `docs/adr/README.md` (drop the 0010 and 0013 rows and their dependency mentions, and add a line pointing audio to `openspec/specs/`) and `AGENTS.md` (say audio behaviour lives in `openspec/specs/`), and verify no Markdown link in `docs/` or `AGENTS.md` points at a deleted ADR
- [x] 6.4 Replace "ADR-0013" / "ADR-0010" citations in `src/` comments with the matching spec name, and verify `grep -rnE "ADR-?00(10|13)" src` returns nothing

## 7. Integration check

- [x] 7.1 Run `npm test` and the typecheck, then play from the title through the intro and the first fight, and verify against each spec: music on the title, the theme into the intro, TAG FM in the kitchen, the reverb change corridor to hall, muffled steps behind doors, story ducking, the damage muffle, and all four sliders
- [x] 7.2 Run `openspec validate establish-audio-spec --strict` and verify it passes

## Workflow follow-up

- Archive this change once the tasks are done, so its four specs land in `openspec/specs/`.
- Separately, sync the never-synced `surface-textures` spec from the archived `2026-11-18-adopt-photoscanned-textures` change into `openspec/specs/`.
- Follow-up change: a `dialogue-flow` spec for speech priorities, barks and hints (their only record after ADR-0010 is deleted is the code).
- Follow-up change: tension music, built on the `music` host from group 4.
