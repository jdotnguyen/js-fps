# Design

## Context

See proposal.md for why.

**How the cuts go wrong.** `findSplits` in `scripts/vo-generate.ts` always returns exactly one segment per line. It picks cuts with a score that rewards pause length (`min(2.5, s) * 3.2`, up to 8) far more than it penalises a segment of the wrong length (`1.4 * |ln(actual / expected)|`). A long pause or sigh inside a line therefore beats a short real boundary: two lines merge, and a later one is halved. Nothing looks at the words. The only check flags a clip under 0.45x or over 3x its expected length, and `intro_jay_05`, with two lines in it, was 2.4x.

**What audio survives** (checked 2026-11-25).

| Raw batch WAV | State | Clips to fix |
| --- | --- | --- |
| `vo_chief_01` | original take | `drop_heins_02`, `drop_heins_03` (and unused `drop_heins_01`) |
| `vo_director_engineer` | original take | `brief_hale_03`, `brief_hale_04`, `admin_hale_02` to `04` |
| `vo_crew_sung_crew_botanist` | original take | `dive_sung_02`, `dive_sung_03`, `hydro_botanist_01` |
| `retake_player_01` | overwritten by a later take | the three Jay clips |
| `retake_engineer_01` | overwritten | the five train clips |
| `retake_engineer_02` | overwritten | `sec_giles_06` |

For the overwritten three, every missing word is in one of the shipped clips.

**Evidence.** What the model heard in each bad clip:

| Clip | Heard |
| --- | --- |
| `intro_jay_05` | its line, then "What's in it?" (from about 5.9 s) |
| `dive_jay_01` | "Everything all right, Director?" |
| `admin_jay_01` | "I'll write you a reference." |
| `dive_sung_02` | stops after "Lab B ordered it." |
| `dive_sung_03` | "Lab B orders a lot of mud." |
| `hydro_botanist_01` | "Locker's signed. Thanks, officer." then its line |
| `brief_hale_03` | its line, then "Thank you." |
| `brief_hale_04` | "TAG Industries appreciates you." (no "Thank you.") |
| `admin_hale_02` | stops after "Good morning." |
| `admin_hale_03` | "Your card, of course." then "Perfectly. A busy morning." |
| `admin_hale_04` | "TAG appreciates you." then its line |
| `drop_heins_02` | "Nobody touches the glass." |
| `drop_heins_03` | "Door's locked from the other side." then its line |
| `r13d_giles_02` | its line, then "There she is, Line One, still on the rails and lit up." |
| `r15a_giles_01` | "Come on, let's get aboard..." then "Door's sealed... off the dock." |
| `r15a_giles_02` | "Whoa, rear console's lighting up." |
| `r15a_giles_03` | "That's a live carrier." then "Master" (taken to be "Lost her") |
| `r15a_giles_04` | "Too much rock between us and the upper hull." |
| `sec_giles_06` | "Stay back, Tomas. It's sealed from upstairs." then its line |

The model has limits the gate has to live with. `hydro_botanist_02` was flagged at first and is correct: with a little silence added around it, the model hears its whole line. It drops "Traitor." from `intro_giles_15`, which it does hear when the first half is transcribed alone. It did not hear "Hey- hey!" in `cover_okafor_run_01`; the user confirmed by ear that it was missing (D5).

## Goals / Non-Goals

**Goals:** correct audio with the same voices, no quota spent on the re-cuts, and a gate that stops the next bad cut.

**Non-Goals:** a better splitter, checking delivery or accent, and checking non-verbal takes.

## Decisions

### D1. Re-cut existing audio with a written recipe
A small tool takes a recipe: for each output clip, an ordered list of (source file, from, to). Surviving raw WAVs are cut with the same encode filters as a normal take. Overwritten batches are assembled from copies of the shipped clips as they are at the starting commit, so running the recipe twice gives the same result and no source is overwritten before it is read. The recipe is committed.

| Output | Assembled from |
| --- | --- |
| `intro_jay_05` | head of `intro_jay_05` |
| `dive_jay_01` | tail of `intro_jay_05` |
| `admin_jay_01` | `dive_jay_01` |
| `r13d_giles_02` | head of `r13d_giles_02` |
| `r15a_giles_01` | tail of `r13d_giles_02` + head of `r15a_giles_01` |
| `r15a_giles_02` | tail of `r15a_giles_01` |
| `r15a_giles_03` | `r15a_giles_02` + head of `r15a_giles_03` |
| `r15a_giles_04` | tail of `r15a_giles_03` + `r15a_giles_04` |
| `sec_giles_06` | tail of `sec_giles_06` |

Cut times are found from silence detection and confirmed by the check in D2. A joined clip gets a short silent gap between its two sentences. A clip that moves whole to another name is copied byte for byte, with no second encode. Two spans needed a level change: "What's in it?" (-3 dB) was louder than Jay's other lines, and "Lost her." (+4 dB) much quieter than the sentence it joins.

- *Re-record.* Spends quota, changes performances the user has already heard, and the same splitter could fail again.
- *`--resplit`.* Reproduces the same cuts, and three of the recordings are gone.

### D2. Check words with local speech-to-text
ffmpeg's `whisper` filter transcribes a clip, using a model file kept under `previews/models/` (gitignored) or named by an environment variable. No audio leaves the machine and no npm package is added. A pure function compares the transcript with the line text and is unit tested on saved transcripts, so tests need neither ffmpeg nor the model.

The comparison must tolerate spelling and spacing ("med lab's" heard as "Midlabs") while catching a missing or added phrase as short as "Thank you". Compare normalised characters, and also look for the first and last words of the neighbouring lines in the take. Tune it until it holds every row of the evidence table, and record what it still questions among correct clips. A first word-level pass over all 342 clips questioned 55. It missed three of the 19 (`brief_hale_03`, `brief_hale_04`, `r15a_giles_04`), found by reading the neighbouring lines of each suspect take, and most of its other flags were screams, misheard words or lines the game never plays.

- *A hosted transcription API.* Better accuracy, but costs quota and sends audio out.
- *Length and pause heuristics only.* These are what failed.

### D3. Gate by staging
New clips are encoded into a gitignored staging folder. Passing clips move into `public/assets/vo/` and are wired. Failing clips stay in staging with a report, and `--accept <ids>` ships them after the author listens. Without the model, clips ship as before and the run lists each as unchecked.

- A batch records only the clips it ships in `vo-takes.json`. The note beside a held clip keeps its batch, so accepting it adds the record then, and every shipped clip stays traceable.
- All of a batch's clips are encoded before any is transcribed, because `vo-trace.ts` matches a clip to its recording by a file time within 3 s.
- `--mode all` treats a held clip as present, so it does not spend quota on it again.

**The comparison as built** holds a clip when a run of six or more characters is missing or added, when three or more characters of a neighbouring line sit at either end, or when under 60% of characters match. A missing or added word shorter than that, away from a neighbour, passes.

### D4. Archive raw recordings in a subfolder
Before writing a batch WAV that already exists, move the old one to `previews/vo-batches/older/` with its file time in the name. The newest keeps the plain name, so `--resplit` is unchanged. `vo-trace.ts` reads only the top folder, so it is unaffected.

### D5. Two changes after the first listen (2026-11-25)
`cover_okafor_run_01` is re-recorded as a one-line take: its surviving raw recording (`retake_medic_run_10_11.wav`) starts at "It's us", so there was nothing to re-cut. The first new take voiced one "Hey" and still passed the check, because a missing word that short is under the threshold. Its acting direction now asks for both shouts, and the second take is heard as "Hey, hey, it's us! It's us!".

The user accepted the second take by ear.

The unused lines `end_jay_01` and `end_giles_04` to `06` are removed: their clips are broken and nothing plays them. Their past takes stay listed in `vo-takes.json`.

## Check results

Run 2026-11-25. Before the re-cut the check held 31 of 308 spoken clips: all 19 in the proposal and 12 others. The re-cut recipe gives byte-identical clips when run again. After the re-cut, the re-record and the removals, and with the 24 `commons-overheard-chatter` clips now present (all pass), it checks 328 and holds 6.

The user listened on 2026-11-25 and accepted the re-cut clips, including `r15a_giles_04`, whose "Lost her." the model hears as "Master".

| Clip | Played in game | Heard | Outcome |
| --- | --- | --- | --- |
| `bark_limb_03` | yes | "I came off that right off." | accepted by ear |
| `intro_giles_15` | yes | "Thanks, Bram." | accepted by ear; the model drops "Traitor.", which it hears from the first half alone |
| `blackout_radio_ops_02` | yes | "...Lonchol..." for "Launch Hall" | accepted by ear |
| `sec_okafor_02` | yes | "Hey, over here, the door." | accepted by ear |
| `sec_okafor_21` | yes | "Midlabs do there." | accepted by ear |
| `hydro_store_jay_01` | yes | "Huh. Caught. Cattle..." | accepted by ear |

No held clip is left open. `cover_okafor_run_01` was also questioned and is re-recorded (D5).

## Test results

Final run 2026-11-25: `npm run typecheck` passes. `npm test` runs 1991 tests and 16 fail. All 16 also failed at commit `a97d09c` without this change, and the user accepted them for this change:

| Test file | Failing |
| --- | --- |
| `scripts/mocapSources.test.ts` | 1 |
| `src/actors/castMotionCoverage.test.ts` | 2 |
| `src/actors/heldGrip.test.ts`, `mocapPhysics.test.ts`, `motionProfiles.test.ts` | 1 each |
| `src/ai/dockGuardRoutine.test.ts` | 1 |
| `src/audio/music.test.ts` | 1 |
| `src/script/gather.test.ts` | 2 |
| `src/ui/credits.test.ts` | 1 |
| `src/world/slice01Gallery.test.ts`, `slice01ScriptedWalks.test.ts`, `wallClearance.test.ts` | 1 each |
| `src/world/slice01Walks.test.ts` | 2 |

## Risks / Trade-offs

- [The surviving raw WAVs are overwritten before this is built] -> Copying them aside is the first task. They are gitignored and exist on one PC.
- [The small model misses an error or invents one] -> The user listens to every re-cut clip and to the questioned ones.
- [A joined clip sounds spliced or uneven] -> Join only at silences with short fades, compare loudness, and re-record that one line alone if it still sounds wrong. A single-line take has no cut to get wrong.
- [Another session generates voice at the same time] -> Land D3 and D4 before `commons-overheard-chatter` task 5.2, or run the check over its clips afterwards.
