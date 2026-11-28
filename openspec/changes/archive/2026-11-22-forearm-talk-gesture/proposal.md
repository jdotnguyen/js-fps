# Proposal

## Why

Tomas Okafor and Priya flail their arms when they talk, Priya most visibly in the intro. Their own talk captures are CMU conversation takes chosen for "explaining with hand gestures". `priya_talk` is the `19_08` excerpt that D13 of `per-character-motion` measured at about 138° and 127° of upper-arm rotation and took off Giles for being too big. Both captures play at 0.85 on all six arm joints. On top of them the generated speech layer swings the upper arm from the shoulder on every beat, and it picks the left arm for about 30% of lines at random. A person talking calmly mostly lifts the right forearm from the elbow and turns the wrist over on the stresses. That is the motion this change asks for.

## What Changes

- **Calm lines gesture below the elbow.** For calm emotes (`neutral`, `question`, `relieved`, `whisper`, and `laugh`, since the intro's laughs are banter), the generated speech gesture moves only the right forearm (elbow flex, held and beating on the stresses) and the right hand (a wrist flick, plus a palm turn for questions). The upper arm stays within a few degrees of where the idle puts it. The left arm plays its idle and nothing else.
- **Talk captures move the trunk only, on every line.** A character's own talk clip still plays on pelvis, spine, chest and clavicles, so each person keeps their own weight shift while talking. It no longer drives the arms on any line, big ones included (Priya flailed on a kitchen laugh line while it did). This applies to every character, not only Tomas and Priya. Giles is the exception: his reviewed one-handed `giles_talk` accent (D13) stays as it is.
- **Always the right hand.** The per-line random choice of gesturing arm (70% right, 30% left) is removed for calm lines. No character has a recorded handedness, so the right hand is the default.
- **No speech arm gesture while walking or jogging.** The generated arm layer fades to zero with locomotion weight, so walk and jog arm swing (Priya's walk in particular) stay exactly as they are now.
- **A hand holding something does not gesture.** If the right hand holds a mug (`idle_mug`, `lean_back_mug` and their talk variants), the free left forearm gestures instead, as `upright-mug-grip` D3b already decided. The mug hand stays still, so `held-props` keeps its mug-upright guarantee.
- **Big lines keep their generated gestures.** `urgent`, `alarmed`, `pained`, `dread` and `scream` keep their current generated whole-arm gestures, without the talk clip on the arms.

## Capabilities

### New Capabilities
- `speech-acting`: what a body does while it speaks a line: jaw and syllable timing, head accents, which arm gestures and how much, how emote sets the size of the gesture, and how speech gestures combine with talk captures, held props and locomotion.

### Modified Capabilities
None in `openspec/specs/`. The `character-motion` capability is still being written by the in-progress `per-character-motion` change. Its requirement "Captured motion is not buried under generated motion" and scenario "Talking with captured gestures" say a talk clip's arm gestures stay visible. That scenario needs amending: a talk clip now drives only the trunk, except for Giles (see tasks).

## Impact

- **Code:** `src/actors/speechActing.ts` (calm styles become forearm-only, fixed right side for calm lines, a new flag on `ActingStyle` that marks a style as forearm-only), `src/actors/animator.ts` (talk-clip blend: trunk-only on every line except for Giles; arm gesture fades to zero with locomotion; held-prop hand check), and `src/actors/handPhysics.ts` if its speech wrist motion has to be tied to the new beats.
- **Data:** none. `motion-profiles.json` and the mocap clips are unchanged, and walk and jog clips are untouched.
- **Tests:** `src/actors/speechActing.test.ts` (calm emotes: upper-arm offsets small, left arm zero, always right), animator tests in `src/actors/mocapPhysics.test.ts` (talk clip trunk-only for Okafor and Priya on a calm line, Giles unchanged, no arm gesture while walking), `src/actors/heldGrip.test.ts` (the mug stays upright while talking).
- **Other changes:** `per-character-motion` (its `character-motion` talk-capture scenario needs amending), `intro-pacing-gaze-and-lean` (the intro is where the change is reviewed).
