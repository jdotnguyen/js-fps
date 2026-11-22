# Tasks

## 1. Shared cast with pinned models

- [x] 1.1 Create `scripts/lib/voCast.ts` with every speaker's label, voice, model and profile, using the reference models in design.md; verify with `npm run typecheck` and a `scripts/lib/voCast.test.ts` that checks every speaker ID used in `src/data/dialogue/*.json` has an entry with a model.
- [x] 1.2 Make `scripts/vo-generate.ts` read the cast from `voCast.ts` and drop its local `CAST`; verify `node --experimental-strip-types scripts/vo-generate.ts --mode all --dry-run` lists the same speakers and voices as before, each with its model.
- [x] 1.3 Make the reaction batches in `scripts/vo-reactions.ts` name a speaker ID instead of a voice; verify with a test that each batch's voice and model come from that speaker's cast entry.

## 2. No model fallback

- [x] 2.1 Remove `DEFAULT_MODELS`, the `--models`/`--model` flag and the switch-on-quota loop from `scripts/vo-generate.ts`, so each batch goes only to its speakers' model; verify with a test using a stubbed fetch that a daily-quota 429 marks the batch failed, skips that speaker's later batches, continues other speakers, exits non-zero, and makes no request to another model.
- [x] 2.2 Keep the per-minute 429 wait-and-retry on the same model; verify in the same test file that a per-minute 429 followed by success writes the batch on the original model.
- [x] 2.3 Do the same in `scripts/vo-reactions.ts` (remove `MODELS` and `--models`, no fallback); verify with a stubbed-fetch test that a quota error fails the batch without trying another model.
- [x] 2.4 Pair speakers into two-speaker batches only when they share a model; verify with a test that `crew_ruiz` and `crew_assistant` land in separate batches and `crew_mess` and `crew_maint` still pair.
- [x] 2.5 Make a speaker with no cast entry throw an error naming it before any request; verify with a test.

## 3. Generation record

- [x] 3.1 Append an entry to `scripts/vo-takes.json` (batch, speakers, voice, model, line IDs, timestamp) for every batch either generator makes, but not for `--resplit`; verify with a stubbed-fetch test that one generated batch adds one entry and a resplit adds none.
- [x] 3.2 Write `scripts/vo-trace.ts`, which maps the shipped clips to the old batch WAVs in `previews/vo-batches/` by file time (direct match within 3 s of a WAV for that speaker, otherwise inferred from the neighbouring WAVs' models) and reads each WAV's sample-count signature; verify with a fixture test that it labels a known batch's lines and model, infers a clip whose WAV was overwritten, and flags a clip whose neighbours disagree instead of guessing.
- [x] 3.3 Run `vo-trace.ts` and seed `scripts/vo-takes.json` for the existing clips; verify the 11-21 retakes (`sec_giles_06`–`07`, `sec_okafor_01`, `02`, `08`, `sec_jay_*`, `sec_priya_05`) come out as 3.1, and list any flagged lines for the user.

## 4. Casting standard

- [x] 4.1 Update `docs/voice-casting-standard.md`: replace the "target model 3.1" rule and the Legacy/Mixed statuses with each speaker's pinned model, document `voCast.ts`, `vo-takes.json`, `vo-trace.ts` and the sample-count signatures (A 263 / B 0 / C 14 for 2.5-flash / 3.1 / 3.8), and remove `--models` from every command; verify every command in the doc runs with `--dry-run`.

## 5. Record the missing lines

- [x] 5.1 Generate the 9 dock-guard lines (`intro_guard_01`–`06`, `guard_arch_01`–`03`) on 3.1 with `--apply`; verify each MP3 exists, `slice01.json` points to it, `vo-takes.json` names 3.1, and the `laugh` lines have no long sighs or dead air (trim if needed).
- [x] 5.2 Generate `intro_giles_alarm_01` and `intro_okafor_alarm_01` on 2.5-flash; verify as in 5.1, and the user confirms by ear that they match group-A Giles and Okafor clips.

## 6. Re-record mismatched lines

- [x] 6.1 Re-record on 2.5-flash every Giles dialogue line `vo-trace.ts` puts on another model (16 lines: the Hale + Giles batch, the 11-20 audition and `intro_giles_15`–`16`, `commons_giles_hey_02`, `rounds_giles_radio_01`, `sec_giles_06`–`07`), spreading them over days if the quota runs out; verify `vo-trace.ts` lists no Giles line off his model and the user approves by ear.
- [x] 6.2 Re-record on 2.5-flash every Okafor line `vo-trace.ts` puts on another model (25 lines: the 3.1 `vo_medic_01`–`02` batches, the 11-20 audition and `intro_okafor_10`–`11`, `sec_okafor_01`–`04`, `sec_okafor_08`); verify as in 6.1.
- [x] 6.3 Replace `react_giles_cry_01`–`03` with credited recorded cries (TTS does not do screams; the 3.8 TTS cries broke that rule), remove the `react_giles_male` TTS batch, list the files in `CREDITED_REACTION_CLIPS` and `CREDITS.md`; verify the reaction tests pass, `sec_giles_05` still points at the three files, and the user approves the cries by ear.
- [x] 6.4 Re-record on 3.1 every Jay and Priya dialogue line `vo-trace.ts` puts on another model (7 Jay, 8 Priya, including their 11-19 audition lines on 2.5-flash); verify `vo-trace.ts` lists no Jay or Priya dialogue line off 3.1.
- [x] 6.5 Re-record Jay's and Priya's TTS reaction pools (`react_jay_pain_*`, `react_priya_choke_*`) on 3.1, leaving the credited recordings (`react_jay_scare_*`, screams, cut-offs) alone; verify `vo-takes.json` names 3.1 for each and the credited files are unchanged.
- [x] 6.6 Re-record on 3.1 the two 11-19 audition lines `vo-trace.ts` puts on 2.5-flash for 3.1 speakers (`brief_hale_01`, `pa_quarantine_01`); verify `vo-trace.ts` lists no line off its speaker's model, apart from flagged clips the user has checked.

## 7. Integration check

- [x] 7.1 Run `npm run typecheck` and `npm test -- scripts/lib/voCast.test.ts` plus the generator and trace tests, then play the dock checkpoint and the Okafor/Giles security scenes in the browser using `docs/PLAYTEST.md`; verify no speaker changes voice mid-scene and update the status column in the casting standard.

## 8. Pinned accents

- [x] 8.1 Add an optional `accent` to cast entries in `scripts/lib/voCast.ts`, set Heins to General American (confirmed by ear 2026-11-21), and state it in every dialogue and reaction prompt for that speaker; verify with a `voCast.test.ts` test that Heins's prompt profile names the accent and a speaker without one is unchanged.
- [x] 8.2 Re-record `brief_heins_door` on 3.1 with the pinned accent once the 3.1 quota resets; verify `vo-takes.json` names 3.1 and the user confirms by ear that it matches her other lines.

## Workflow follow-up

- Archive the change once the user has signed off on the re-recorded clips.
