# Tasks

## 1. Protect the source audio

- [x] 1.1 Copy `vo_chief_01.wav`, `vo_director_engineer.wav` and `vo_crew_sung_crew_botanist.wav` from `previews/vo-batches/` to `previews/vo-batches/older/`; verify each copy's size and take time still match its `scripts/vo-takes.json` entry (design context table)
- [x] 1.2 Make both generators move an existing batch WAV into `older/` before writing a new one (design D4); verify a unit test keeps both recordings and that `node --experimental-strip-types scripts/vo-trace.ts` reports as before

## 2. Check clips against their text

- [x] 2.1 Add the text comparison function with tests built from the heard-versus-expected pairs in design.md and from correct pairs with misheard names; verify every bad pair is held and `npm test -- <the new test file>` passes
- [x] 2.2 Add a script that transcribes given line ids, or all of them, and prints the held clips; verify a run over the unfixed clips holds all 19 in the proposal, and skips non-verbal lines
- [x] 2.3 Wire staging, `--accept` and the unchecked notice into `vo-generate.ts` (design D3); verify with a fake transcriber that a held clip leaves the shipped file and dialogue JSON unchanged, with no voice request made
- [x] 2.4 Document the model download, the check, `--accept` and the archive in `docs/voice-casting-standard.md` sections 5, 6 and 8; verify the documented commands run as written

## 3. Re-cut the clips

- [x] 3.1 Add the recipe tool, with a test that running it twice gives the same output; verify the test passes
- [x] 3.2 Re-cut the ten clips (and `drop_heins_01`) from the surviving raw WAVs; verify the check passes each, or its heard text is shown to the user and accepted
- [x] 3.3 Assemble the nine clips from copies of the shipped clips (design D1); verify the check passes each, or its heard text is shown to the user and accepted
- [x] 3.4 Verify `git status` shows only the intended files under `public/assets/vo/`, no `audio` field changed in `src/data/dialogue/` apart from the removed lines, and each clip is mono 24 kHz MP3
- [x] 3.5 Remove the unused lines `end_jay_01` and `end_giles_04` to `06`, their clips and any recipe entry; verify nothing in `src/` refers to it and the tests that read dialogue data show no new failure
- [x] 3.6 Re-record `cover_okafor_run_01` on Okafor's pinned voice; verify the heard text has both shouts and the user accepts it by ear

## 4. Integration

- [x] 4.1 Run the check over every clip and give the user the held list; verify each is either confirmed correct by ear or fixed, and record the outcome in design.md
- [x] 4.2 Run `npm run typecheck` and `npm test`; verify type checking passes and the only test failures are ones that also happen without this change (accepted by the user 2026-11-25; listed in design.md)
- [x] 4.3 Have the user listen to every re-cut line in game or on `/voices.html`, and play the dive bay, Admin and train boarding scenes; verify the user accepts the audio and the line timing

## Workflow follow-up

- Tell the owner of `commons-overheard-chatter` that its clips go through the check, or run it over them if they were generated first.
