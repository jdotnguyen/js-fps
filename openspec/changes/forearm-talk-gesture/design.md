# Design

## Context

Three layers move a standing speaker's arms today (see proposal.md, Why):

```
 idle capture (profile idle)
   + talk capture            animator.ts updateMocapBase, speechW-weighted
       own clip  : 0.85 on pelvis, spine, chest, clavicles AND all six arm joints
       shared    : 0.35 on the trunk only
       giles_talk: arms only (D13), and his generated arm gesture fades to zero
   + gesture()               speechActing.ts, scaled by armsK and armLayer
       hold + beat + kick on upperArm_P, foreArm_P, hand_P (and _S)
       primary side: hash01(seed, 91) < 0.7 ? right : left
       armsK = busy * (1 - moveWeight * 0.85) * (1 - capturedSpeechArms)
   + handPhysics             wrist and finger springs fed by speechPulse
```

`gesture()` already runs with torso, tremor and most kick switched off (`TORSO_K = 0`, `TREMOR_K = 0`). So the flailing comes from the arm entries in each style and from the own-clip arm blend. Held props always sit in the right hand (`heldProps.ts`, ADR-0029). Profile `armCarry` is parsed but not read by the animator, so Priya's intro variant does not enlarge her gestures. Her `tempo` only speeds her idle and hold clocks, which drive the talk-clip phase. It does not touch walk or jog.

## Goals / Non-Goals

**Goals:**
- The rules in `specs/speech-acting/spec.md`, met with pure-data changes to the styles where possible, so they stay testable in node.
- Walk and jog output identical to today's, measured joint by joint, for every character.

**Non-Goals:**
- New mocap or re-baked clips. `motion-profiles.json` and `mocap/*.json` are untouched.
- Per-character handedness. Nobody has a recorded handedness. If one is added later, it replaces the fixed right side.
- Changing heightened emotes, the jaw, syllable timing or the head-nod spring.
- Giles. His D13 talk path stays as it is.

## Decisions

### D1. A style property for calm emotes, not a per-profile setting

`ActingStyle` gains a flag that marks a style as forearm-only. `neutral`, `question`, `relieved`, `whisper` and `laugh` set it. `laugh` was added after playtest. Its old style raised the upper arm 20° and moved both arms, and the intro's laughs are banter, so it now brings the right forearm up toward the belly from the elbow. The emote already says how big a line should be, so the rule follows the line, not the character. That keeps the rule in `speechActing.ts`, which is pure and node-tested.

*Alternative:* a talk-arms setting in `motion-profiles.json`. Rejected: every character would need it, and a character could still flail on calm lines by default.

### D2. Calm styles are rewritten to forearm and hand joints

For styles with the flag set:
- `upperArm_P` keeps at most a few degrees of forward hold (for example x ≤ 5°) and no beat, so the elbow comes slightly off the ribs without the shoulder swinging.
- `foreArm_P` carries the motion: a hold of about 40–55° flex and a beat of about 8–15° on the stresses.
- `hand_P` gets a flick in opposite phase to the elbow: flexion/extension on x, a little ulnar/radial deviation on z. `question` adds a palm-up roll.
- `whisper` holds the forearm higher (about 70°) instead of raising the upper arm to bring the hand to the mouth.
- No `_S` entries. `both` is false for every style with the flag, so `relieved` loses its second arm.

Starting values are tuned in the cast motion sandbox (`docs/cast-motion-sandbox.md`) on Okafor and Priya from the front and side. The spec's 6° upper-arm limit is the hard bound, and the tests check it.

### D3. Fixed right side for forearm-only lines

`planSpeech` sets `side: 0` when the style has the flag. The hash-based side stays for heightened lines, so their variety is unchanged. Changing `side` changes no other seeded value, because the side hash uses its own key (91).

### D4. Talk clip on the trunk only, on every line

In the own-clip branch, the animator uses `TALK_JOINTS` (pelvis, spine, chest, clavicles) on every line, and `TALK_JOINTS_OWN` is gone. The own-clip weight drops from 0.85 to 0.6 (`OWN_TRUNK_TALK_WEIGHT`), so each person keeps a captured weight shift. The `giles_talk` branch is unchanged and still plays his arms at 0.85.

*First draft:* trunk-only on calm lines only. Rejected after playtest: Priya still flailed on her kitchen `laugh` line (`intro_priya_03`), because a laugh wasn't calm, so `priya_talk` played on her arms at 0.85. The user wants no flail at all.

*Why 0.6:* found while implementing. Once the arms stop leaning with the captured trunk, `priya_talk`'s lean at 0.85 (chest 11°, spine 9°) carries her body into her resting left hand. The limb-contact solver then pushes that arm out by 9° at the upper arm and 18° at the forearm. At 0.6 her chest still sways about 8°, the hand never touches (contact weight 0), and her upper arms stay within 4° of idle. Okafor never touches at either weight.

Because the forearm gesture is now the only speech motion on those arms, it runs at full arm scale on a calm line, not at `OWN_MOTION_ARMS` (0.35). At 0.35 a 13° elbow beat would shrink to under 5°, below what the spec asks for. Heightened lines keep the damped scale.

*Alternative:* keep the arms at a lower weight, such as 0.2. Rejected: even at a low weight, CMU `19_08`'s 130° upper-arm sweep is still about 26°, well over the limit.

### D5. Arm gesture fades fully with locomotion

`armsK` uses `(1 - moveWeight)` instead of `(1 - moveWeight * 0.85)`. Without mocap, the `amp` path does the same. At full walk weight the speech layer adds nothing to the arms. The talk-clip blend is already gated at speed < 0.15. Together these keep walk and jog joint output identical to today's whenever the body is moving.

### D6. Held right hand: the free left forearm gestures

`Humanoid.speak` already moves the gesture to the left hand while the right holds a mug (`upright-mug-grip` D3b, archived). Calm lines keep that rule: the forearm-only style plays on the left forearm and wrist, and the mug hand gets nothing. The user asked to keep any left-handed decision already made, and D3b is one.

*Alternative (first draft):* mute the arm gesture entirely while holding something. Dropped because D3b already covers the case and keeps a talking character's free hand alive.

### D7. Hand solver

`handPhysics` uses `speechPulse` and `speechPrimarySide` for wrist and finger motion. With D3, its primary side is always right for calm lines. Check in the sandbox that its wrist spring and D2's `hand_P` beat don't double the flick. If they do, reduce the `hand_P` beat instead of the solver, since the solver also serves heightened lines.

## Risks / Trade-offs

- **[A forearm alone can look like a mechanical hinge]** → a soft beat (`beatSharp` near 1.2–1.5), varied strength per beat (already seeded), the settle at the end of the line, and the hand opposite in phase. Reviewed in the sandbox before the intro playtest.
- **[Talking characters lose some individuality in their arms]** → the trunk keeps each person's captured motion, and Giles keeps his accent. Heightened lines still use full gestures.
- **[`per-character-motion` is in progress and its `character-motion` spec says a talk clip's arm gestures stay visible]** → this change records the conflict. The scenario is amended in that change before it archives, or in a follow-up once both have archived (task 5.1).
- **[`relieved` loses its two-handed release]** → acceptable for calm talk. If it reads flat in playtest, a small chest lift can be added later without changing the spec.

## Migration Plan

No data migration. The behaviour switches on with the code. Rollback is a revert of the speechActing and animator edits.
