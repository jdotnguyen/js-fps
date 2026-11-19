# ADR-0027: Speech acting (talking mouths and tone-matched gestures)

Status: Proposed (Nov 18) [Assumed]: Justin asked for mouths that move when characters talk and hand/body gestures that match
their tone; the details below are my reading of that.

## Context
Voices are non-verbal emote sounds under a subtitle (ADR-0010), so a speaker used to stand still while a line played.
Every line already carries an `emote` (neutral, question, urgent, alarmed, pained, relieved, laugh, whisper, dread, scream),
which is the tone, and subtitle text with a known duration, which is the rhythm.

## Decision
- **Where it hooks in.** `SpeechInfo` (the `speech:started` payload) now carries the line's `emote`.
  `ai/speakerBodies.ts` maps the speaker to its NPC (`engineer` -> `giles`, `medic` -> `okafor`, `nurse` -> `priya`,
  `chief` -> `heins`, `crew_x` -> `x`; the same table the script host uses) and calls `Humanoid.speak(text, emote, duration)`
  on `speech:started` and `stopSpeaking()` on `speech:ended`, whatever the reason, so a cut-off line shuts the mouth at once.
  The player, the PA and the director on the radio have no body, and nothing happens for them.
- **Mouth.** `actors/speechActing.ts` turns the subtitle text into a syllable timeline spread over the line (a pulse per vowel
  group, longer pauses at commas and full stops, a short closing beat at the end), each pulse as wide as its vowel and stress.
  The animator drives the `jaw` joint from it (`-x` opens): about 11 degrees for a statement, 16 for a command, 28 for a scream,
  4 for a whisper. `laugh` is an even run of "ha"s and `scream` one long open mouth. The head dips a degree on each syllable.
- **Gestures.** Each emote has a style: a held posture, a stronger beat on a regular pulse (hand and body), and a jolt at the
  start. Examples: `urgent` leans in and chops with one hand; `question` cocks the head and offers an open palm; `alarmed`
  flinches back with both hands up; `pained` folds over with a hand on the ribs, shaking; `relieved` sighs, shoulders and
  head dropping; `laugh` bounces the chest with a hand to the belly; `whisper` leans in with a hand by the mouth; `dread`
  shrinks in with arms drawn to the chest, trembling; `scream` throws the head back and the arms wide.
  One arm is the speaker's gesturing arm for the line (the right one 70% of the time, seeded by line id); styles marked `both`
  use both. The layer is additive, rotations only, like the idle layer, and the same line always plays the same way.
- **Where it holds back.** Arms gesture a quarter as much when the pose has them busy (typing, aiming, a mug) and 85% less
  while walking; on the ground (crawling, downed) only the mouth moves. The dead and the infected (stage 1 or more, or twitchy
  or convulsing) do not talk.

## Jaws on imported bodies
Imported bodies need a weighted `jaw` joint for any of this to show. Giles' bone names in `fix-mechanic-glb.mjs` were off by
one: the eye bones hang off the node it called `Neck`, which owned every head vertex, so the skull followed the `neck` joint
(pivoting mid-skull) while the lower face followed `head`, and the chin swung away from the head whenever it turned. The node
names are fixed (12 Neck, 13 Head, 14 Jaw) and that mesh's own jaw weights now sit on `jaw`. Okafor's CC `JawRoot` (with the lower teeth and tongue under it) maps to `jaw` too, which `fix-doctor-glb.mjs` used to rename out of the way. Priya's model has no jaw bone, so `fix-priya-glb.mjs` adds a `Jaw` bone under `Head`, weights the lower teeth 100% to it, and weights the lower lip and chin smoothly to it.

## Consequences
- Scan-based Priya has no mouth geometry, so the chin and lips move as one soft patch: it reads as talking at a distance,
  not close up. Her hair hangs over part of the jaw region and drags with it a little.
- Gesture angles are tuned by eye on the numbers, not yet by looking at the game: expect to adjust magnitudes per character.
- Not done: eyes and eyebrows, lip shapes, and gestures timed to individual words.

## Definition of done
- `speechActing.test.ts`: syllable plan follows the text, laugh/scream shapes, angles bounded for every emote, arms scale down
  when busy, a `Humanoid` opens its jaw and gestures and settles afterwards, a cut-off closes the mouth, the infected stay quiet.
- `speakerBodies.test.ts`: speaker mapping and the started/ended wiring.
- `bodyModel.test.ts`: all three squad models have jaw weights on the lower face, hinged near the ear.
