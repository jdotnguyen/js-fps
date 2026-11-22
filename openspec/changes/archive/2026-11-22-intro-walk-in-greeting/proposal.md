# Proposal

## Why

When the airlock cycles for the squad, the guard's "Go ahead, Sung." starts a moment after the view has switched to Okafor. The speaker shot turns to whoever starts a line, so it swings to the guard and holds there while Okafor and Giles walk about 6 m in, because nobody speaks again until Okafor reaches the counter. The player wants to watch the squad come in, and they shouldn't walk the whole way in silence before greeting Jay.

The playtest of that fix turned up two more cases of the view landing on the wrong person.
- When Jay says "Morning, Giles", the view stays on whoever spoke last, which is the guard or Okafor walking past the arch. Speaker shots never move for Jay's own lines.
- While Jay talks with Sung at the counter, the guard's lines scanning Ruiz pull the view to the arch.

## What Changes

- While Okafor and Giles walk from the airlock to the counter, the view tracks Okafor instead of running a speaker shot. A line from anyone else, such as the guard finishing Sung's pass, no longer pulls the view away during the walk.
- Okafor's greeting ("Morning, Jay. Still on that door since four?") and Jay's reply move into the walk, starting about 1.5 s after Okafor sets off. Giles's "Look at that posture..." line moves into the walk too, playing as the pair close in on the counter.
- When Okafor reaches the counter, the speaker shot resumes. The guard's "Morning, Doctor." still turns the view to the guard at the arch, and the rest of the post banter is unchanged.
- While Sung steps up to the counter and talks with Jay, the view tracks Sung in the same way. The guard's lines to Ruiz no longer turn it, and the speaker shot resumes after Sung's last line.
- A speaker shot turns to the addressee of Jay's line when the line names one. All eight of Jay's intro lines get an addressee: Ruiz, Sung, Okafor, Giles (three lines), Bram and Priya.
- No voiced lines are added, cut or re-recorded. The skip end state is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `intro-sequence`: In "Squad arrival through the checkpoint", the greeting starts on the walk in instead of at the counter. In "Speaker shots at the post and in the kitchen", Jay's addressed lines turn the view to the addressee, and Sung's counter exchange and the squad's walk-in become tracking shots that other speakers' lines do not steer.

## Impact

- **Sequence data:** `src/data/sequences/intro_shift_change.json`, covering Sung's counter exchange, the squad walk-in block, and the greeting lines that follow it.
- **Dialogue data:** `src/data/dialogue/slice01.json`, adding `to` addressees on `intro_jay_01` through `intro_jay_08`. This also makes the NPC being spoken to look back at Jay through the existing addressee gaze.
- **Engine:** `src/script/actions.ts`. On a line without a body, the speaker shot falls back to the line's `to` addressee.
- **Tests:** `src/script/intro.test.ts` and `src/script/action.test.ts`.
- **Coordination:** `intro-pacing-gaze-and-lean` (still open, playtest pending) touches the same sequence file elsewhere, in its kitchen pacing and addressee tags. This change only edits the crew and squad counter blocks, and keeps the `to` addressees that change added.
