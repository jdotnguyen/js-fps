# Tasks

## 1. Forearm-only calm styles

- [x] 1.1 Add the forearm-only flag to `ActingStyle` and set it on `neutral`, `question`, `relieved` and `whisper`. Rewrite their hold and beat to forearm and hand joints as in design D2, with no `_S` entries and `both` false. Add a `speechActing.test.ts` case that runs `gesture()` over a 4 s line for each calm emote and asserts the primary upper-arm output stays within 6°, the forearm varies by at least 8°, the hand moves, and nothing is written to a secondary arm joint.
- [x] 1.2 In `planSpeech`, fix `side` to right for forearm-only styles and keep the hash for the others (design D3). Verify with a test that plans twenty seeded calm lines (all right) and twenty `urgent` lines (still mixed), and that `tilt` and the mouth cues for a given seed match before and after.
- [x] 1.3 Verify heightened emotes are unchanged: a test that records `gesture()` output for `urgent`, `alarmed`, `pained`, `dread` and `scream` at fixed times and compares it with the values from before the change.

## 2. Animator: talk capture, locomotion, held props

- [x] 2.1 In the own-talk-clip branch, use the trunk-only joint set for lines whose style is forearm-only, keeping weight 0.85 and leaving the `giles_talk` branch first and unchanged (design D4). Add a `mocapPhysics.test.ts` case: Okafor and Priya speaking a calm `neutral` line while standing keep both upper arms within 6° of their idle pose, and Giles's arm joints during a calm line match his output before the change.
- [x] 2.2 Fade the speech arm layer fully with locomotion weight (design D5). Add a test that compares Priya's and Okafor's arm joints while walking and jogging, speaking and silent, and asserts they are equal within float tolerance. Also check that the jaw still opens.
- [x] 2.3 Keep calm lines on the free left hand while the right holds a mug (design D6, upright-mug-grip D3b). Verify with a `heldGrip.test.ts` case: a body in `lean_back_mug` speaking a calm line gestures with the left forearm (left upper arm within 6° of idle), gets no right-arm speech offset, and keeps the mug within 10° of vertical.
- [x] 2.4 Run `npm test -- src/actors/speechActing.test.ts src/actors/mocapPhysics.test.ts src/actors/heldGrip.test.ts src/actors/motionHolds.test.ts` and `npm run typecheck`. Verify both pass. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.
- [x] 2.5 After playtest (Priya flailed on her kitchen `laugh` line): play every own talk capture except `giles_talk` on the trunk only at 0.6, on every line, and make `laugh` forearm-only (design D1, D4). Verify with a `mocapPhysics.test.ts` case that Okafor's and Priya's captures leave the arms alone on `laugh`, `urgent` and `neutral` lines, and a `speechActing.test.ts` case that a laugh moves only the right forearm and hand, with the upper arm within 6°.

## 3. Tuning and review

- [x] 3.1 In the cast motion sandbox, tune the D2 values on Okafor and Priya (front and side views, a 4–6 s `neutral` line and a `question` line). Check that the hand solver's wrist spring and the `hand_P` beat don't double the flick (design D7). Verify by recording the final values in the speechActing.ts comments and keeping the 1.1 limits green.
- [x] 3.2 Update the speech-acting section of `docs/cast-motion-sandbox.md` (or `docs/characters.md` if speech is described there) to say how calm lines gesture. Verify the doc names the forearm-only emotes and the Giles exception.

## 4. Integration

- [x] 4.1 Play the intro on the reused dev server (`?slot=scratch`, per `docs/PLAYTEST.md`). Verify that Tomas and Priya lift the right forearm and flick the wrist on calm lines with no shoulder swing, that Priya's walk looks the same as before, and that Giles's talk is unchanged. Close the tab afterwards. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.
- [x] 4.2 Run `npm test` and verify the full suite passes. **Closed 2026-11-27:** no recorded run; the product was accepted as it is.

## 5. Spec coordination

- [x] 5.1 Amend the `character-motion` scenario "Talking with captured gestures" (from `per-character-motion`) so that on calm lines only the trunk follows a character's own talk clip, with Giles as the exception. Make the edit in that change if it hasn't archived yet, or in `openspec/specs/character-motion/spec.md` if it has. Verify with `openspec validate` on whichever was edited.

## Workflow follow-up

- Archive the change once the intro playtest is signed off, and check that `openspec/specs/speech-acting/spec.md` is created with its Purpose.
