# Proposal

## Why

Nineteen voice clips used in the game say the wrong words: part of a neighbouring line, someone else's line, or only half of their own. A player noticed Jay saying "What's in it?" after the powdered eggs line. The voice generator records several lines in one take, cuts it at the pauses and ships whatever comes out, so a bad cut goes unnoticed. About 24 more clips are planned through the same tool (`commons-overheard-chatter`).

## What Changes

- Re-cut the 19 clips from audio the project already has, with no new voice requests:

  | Where it plays | Clips |
  | --- | --- |
  | Intro | `intro_jay_05` |
  | Briefing | `brief_hale_03`, `brief_hale_04` |
  | Dive bay | `dive_jay_01`, `dive_sung_02`, `dive_sung_03` |
  | Hydroponics | `hydro_botanist_01` |
  | Admin | `admin_jay_01`, `admin_hale_02`, `admin_hale_03`, `admin_hale_04` |
  | Lab B drop | `drop_heins_02`, `drop_heins_03` |
  | Boarding the train | `r13d_giles_02`, `r15a_giles_01` to `r15a_giles_04` |
  | Security wing | `sec_giles_06` |

- Re-record `cover_okafor_run_01`, whose take never voiced its "Hey- hey!" (added 2026-11-25 after the user listened).
- Remove the unused lines `end_jay_01` and `end_giles_04` to `06`, whose clips are broken, with their audio (the user's choice, 2026-11-25).
- Check every newly cut dialogue clip against its subtitle with local speech-to-text before it replaces a shipped clip.
- Keep earlier raw batch recordings instead of overwriting them, so a bad cut can be redone later.
- The user listens to the re-cut clips and to the remaining clips the check questions.

The list comes from transcribing all 342 clips with a small model on 2026-11-25 and reading the neighbouring lines of each suspect take. It has not been confirmed by ear, and a small error could still be hiding among the other clips.

Out of scope:

- Changing how the splitter picks its cuts.
- Re-casting or rewriting any line, and re-recording any line but `cover_okafor_run_01`.
- Reaction takes (screams, gasps), which words cannot check.
- Unused lines other than the four removed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `voice-playback`: shipped clips say their subtitle's words, new takes are checked before they ship, and raw batch recordings are kept.

## Impact

- Assets: the clips above in `public/assets/vo/`.
- Tools: `scripts/vo-generate.ts`, new helpers and a checker under `scripts/`, with tests. `scripts/vo-takes.json` is unchanged by a re-cut; the re-recorded line adds its takes.
- Dialogue data: four lines removed from `slice01.json`, and one acting direction extended in `slice01_action.json`. One test in `src/script/action.test.ts` now uses another line.
- A new optional local dependency for voice work: an ffmpeg build with the `whisper` filter and a speech model file (about 150 MB, not committed). The game and its tests do not need either.
- Docs: `docs/voice-casting-standard.md`.
- Timing: re-cut lines change length, so the scenes that play them shift slightly. The intro's length stays the same, because `intro_jay_05` plays during the walk, which sets how long that beat lasts.
- Coordination: this should land before `commons-overheard-chatter` generates its clips (task 5.2). The surviving raw recordings in `previews/vo-batches/` are gitignored and exist on this PC only.
