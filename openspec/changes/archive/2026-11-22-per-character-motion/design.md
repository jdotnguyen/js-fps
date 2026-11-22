# Design

## Context

See proposal.md for why. What shapes the approach:

- **One skeleton drives everything.** `src/actors/skeleton.ts` defines 21 joints. 17 source files (animator, poses, foot IK, hand physics, limb contact, speech acting, cast tells, kills, squad enemies, body geometry and model prep) and all 100 authored poses in `src/data/poses.json` are written against those joint names. `adopt-physics-engine` builds its ragdolls from the same skeleton.
- **Imported bodies are already re-skinned onto it.** `bodyModel.ts` maps each model's bones onto the 21 joints. Rigs today:

  | Named character | Model | Rig |
  |---|---|---|
  | Giles | `mechanic` | 85 bones: full fingers, 4 spine, helpers |
  | Okafor | `doctor` (scan-body prep) | 64: full fingers, forearm twist |
  | Priya | `priya` (CC) | 102: full fingers, thigh/calf twist |
  | Hale | `hale` | 59: full fingers, 3 spine, 3 neck |
  | Voss | `office3` stand-in | 89: full fingers, face bones |
  | Bram, Heins, Ruiz, Sung | scans | 24: one stub bone per hand |

  None of the models ship animation clips.
- **The clip library** is 10 clips (266 KB JSON, 24 fps) baked by `scripts/bake-mocap.mjs` from one Quaternius glTF that sits in a tool's scratch folder outside the repo.
- **The per-character hook exists but is thin.** `MotionSet` has four slots (idle, talk, walk, jog). Postures (pistol, kneel, crouch) are hard-coded clip ids in `Animator.updateMocapBase`, and every other authored pose is held static, with only procedural idle life on top.

## Goals / Non-Goals

**Goals:**
- One data-driven profile per named character covering every activity, with readable differences between characters.
- Detail bones (fingers, twist, spine/neck segments) animate on every named body.
- Reproducible bakes from sources inside the project.

**Non-Goals:**
- Per-character gameplay skeletons (option D from exploration): rejected, see D1.
- Facial animation beyond the existing jaw. Face bones on `office3` stay at rest.
- Replacing authored poses with captured ones. Poses remain the contract for scripts and sequences.
- The player (Jay) has no visible body, so no profile. A profile is added if Jay ever gets one.
- Infected, kill and corpse motion (unchanged, see `character-motion` spec).

## Decisions

### D1. Keep the 21-joint skeleton as the driver; detail bones are a skin-only layer
Every body keeps being posed through the shared 21 joints. After the pose is final (mocap base, authored pose, procedural layers, IK), a **detail pass** writes the extra bones each rig carries: fingers, twist and extra spine/neck segments. Gameplay code never sees them.

*Alternative: per-character native rigs.* Rejected. It would multiply the 17 joint-aware modules and 100 poses by up to six rig shapes, and it buys no motion, since no model ships clips. Individuality comes from clip data, not bone count.

### D2. Motion profiles replace `MotionSet`
A profile lives in `src/data/motion-profiles.json` and is validated at load like other data tables:

```
profile {
  id, gender: 'm' | 'f', inherits?: profileId      // named profiles inherit their gendered default
  clips:  { [activity]: clipId }                    // locomotion and actions
  holds:  { [postureFamily]: clipId }               // idle life layered under authored poses
  style:  { tempo, fidgetRate, armSwing, armCarry, headPitch, posture, asymmetry }
  variants?: { [variantId]: { when: Condition, clips?, holds?, style? } }   // D11
}
```

*Activities* (the "slots" talked about in exploration: one entry per thing a character can be asked to do) come from one vocabulary in `mocap.ts`: `idle`, `talk`, `walk`, `jog`, `turnL`, `turnR`, `kneel`, `crouch`, `aimPistol`, `wave`, `point`, `drink`, `work`, plus anything later levels add. *Posture families* group the authored poses by base: `stand`, `sit_chair`, `sit_stool`, `sit_sofa`, `lean_wall`, `lean_back`, `lean_counter`, `kneel`, `crouch`. The `*_glance`, `*_talk` and `*_drink` variants share their family's hold clip.

Resolution order for any activity: character profile, then gendered default, then the built-in neutral clip. Each miss logs one warning, which keeps `resolveMotions` semantics. The hard-coded pistol/kneel/crouch ids in the animator become activity lookups.

The coverage check (spec: activities covered) walks level data, sequence files and squad task definitions for every pose and activity each named look id is given, and fails on any that resolves past the character's own profile.

*Alternative: keep `MotionSet` and add fields.* Rejected. Fixed fields can't express posture holds, and every new activity would mean a type change.

### D3. Sources and casting
Checked against the downloaded file lists (task 2.1): the Bandai sets hold **no** standing idle, talk, sit, lean, kneel, drink or work takes and no finger joints, so they can't be the main source.

- **CMU Graphics Lab Motion Capture Database** (no restrictions; BVH from the cgspeed conversion; 144 subjects): **the main source for everyday motion.** Standing idles, talking and gesturing in conversation, sitting, drinking, kneeling, crouching, leaning, and daily actions. Each named character's idle, talk and holds come from a different subject, which is where most of the individuality comes from.
- **Bandai Namco Research Motion Dataset 2** (CC BY-NC 4.0): walk, walk-turn-left/right, run, wave and raise-hand takes in 7 styles (normal, active, exhausted, youthful, elderly, masculine, feminine), 30 fps, no fingers. The source for styled walks, turns, runs and gestures, and for the gendered crew defaults.
- **Bandai Namco Research Motion Dataset 1** (CC BY-NC 4.0): walk, run, dash, bow, bye, guide and call in 15 styles (including tired, sad, proud, old). Used for extra walk styles and greeting and guiding gestures.
- **100STYLE** (CC BY 4.0, 60 fps, one performer, 100 locomotion styles): only the few walk styles no other source has, mainly asymmetric and favouring gaits for Giles's injury (D12). The full download is 15 GB, so only the BVH files of chosen styles are kept.
- **Quaternius UAL** (CC0, one performer, has finger joints): keeps the clips in use today and fills gaps (sitting enter/exit, interact, pick up, pistol). Its finger tracks feed the hand solver (D5).

Cost control: only the takes named in the bake list are downloaded and kept (a few hundred MB at most). Each character uses roughly 15–30 clips, and anything without a fitting capture falls back to style values, which the sandbox marks.

Distinctness comes from **performer × style**: each named character's everyday clips come from their own CMU subject, and their walk from a Bandai style, actor or 100STYLE style no other named character uses. Starting cast, tuned in the sandbox:

| Character | Base style | Notes on style values |
|---|---|---|
| Giles | exhausted (actor A) | faster fidgets; everyday arms normal, injury only through D12 |
| Okafor | normal (actor B) | slow tempo, low fidget rate, upright |
| Priya | feminine + active (actor C) | quick tempo, open arm carry |
| Voss | feminine + exhausted (actor A) | head down, hands held in |
| Bram | elderly / masculine (actor B) | relaxed, wide stance, slow |
| Ruiz | youthful (actor C) | head carriage up and turning, curious |
| Heins | active (actor A) | squared shoulders, firm posture |
| Hale | normal (actor C) | high fidget rate, hand-wringing hold |
| Sung | masculine (actor A) | heavy, long stride |
| crew default m / f | masculine / feminine (all actors) | seeded tempo ±8%, posture and phase offsets per NPC id |

### D4. Holding authored poses in character
For each posture family, the profile's hold clip is baked as an **additive** clip: each frame's offset from the clip's mean pose. At runtime it's applied on top of the authored pose at a per-family weight, followed by the existing contact solve (foot lock, hand-on-surface IK, seat pin), so hands on counters and mugs stay put. Without a hold clip, the existing idle-life layer runs, driven by the profile's style values instead of the generic seed.

*Alternative: replace authored poses with full captured poses.* Rejected. Poses are hand-placed against specific furniture and props, and a raw capture would break those contacts.

### D5. Hands: extend the existing solver
`handPhysics.ts` already does per-finger second-order springs (MCP to PIP to DIP), grip and gesture shapes from poses, speech and IK, tenodesis coupling, forearm twist sharing on rigs that carry twist bones, and per-character **hand personalities** (`CAST_HAND_PERSONALITIES`: Giles, Okafor, Priya, Hale), with seeded ones for everyone else. This change builds on it instead of adding a second finger system:

- **Personalities move into the profile** (`hands: { tension, stiffness, fidget, restCurl, twitch? }`) so each character's motion lives in one place. The four existing values migrate unchanged, and Voss, Bram, Ruiz, Heins and Sung get their own: Bram heavy, slow cook's hands; Ruiz quick and curious; Heins firm and still; Voss tight and trembling; Sung thick-gloved and loose. `twitch` scales with infection stage for Giles (his fingers twitch from day -1).
- **Finger tracks:** clips baked from sources with finger joints (Quaternius) carry 12 floats per frame (a curl per finger and a thumb spread, per hand). The solver uses them as its shape target instead of the pose's shape, and its springs and personality stay on top.
- **Grip:** the solver's existing shapes stay. A wrap radius taken from the held prop's bounds is added so no finger enters a mug, pistol or clipboard.

### D6. Twist and spine distribution
Forearm twist sharing already exists in `handPhysics.ts`. This change adds thigh twist (40% of the shin's roll) where a rig has thigh twist bones (Priya), and spine/neck distribution: bend from the shared `spine`/`chest`/`neck` joints is re-spread over the rig's extra segments by rest-length share (Giles 4 spine, Hale 3 spine and 3 neck). It runs in the same post-pose pass as the hand solver, with no allocation per frame.

*Found during implementation:* model preparation (`bodyModel.ts`) folds extra spine and neck bones and thigh twist bones into the shared joints' skin weights; only finger and forearm-twist bones survive as bones (`handRig`). So no extra segments exist at runtime. The distribution pass therefore spreads bend across the shared chain instead (spine and chest evenly, neck 45 / head 55, products kept so the chest and head keep their orientation), and thigh twist is carried by the skin weights. Forearm twist sharing stays in `handPhysics.ts`.

### D7. Upgrading the thin scan rigs
`scripts/lib/scan-body.mjs` already supports zero-weight `extra` bones. For Bram, Heins, Ruiz and Sung, the prep places finger chains from the hand's mesh (finger tips are found as extremal vertex clusters beyond the palm) and weights the hand region by distance to each chain segment, smoothed across the palm. Fused fingers fall back to one bone per finger, weighted by angular sector around the hand axis. A forearm twist bone is weighted along the forearm. The existing seam and stretch checks from the scan-body skinning spec are extended to the hand.

### D8. Gender
`data/body-models.json` gains `gender: 'm' | 'f'` per model, required and validated. The crew look pool reads it to pick the default profile. Procedural fallback bodies use their outfit seed's gender.

### D9. Bake pipeline
- `bake-mocap.mjs` gains a BVH reader based on three's `BVHLoader` (already installed, runs in Node), with source-specific bone maps (Bandai, Quaternius).
- Clips are resampled to 24 fps. A **bake list** in `scripts/mocap.sources.json` names, for every clip, its source file, take, frame range, actor, style, licence and target id. A second file (`previews/sources/MANIFEST.md`, mirrored as `docs/mocap-sources.md`) gives download links.
- Retargeting keeps the current approach (rest-relative rotations, pelvis height scaled to 1.78 m). Two additions: a limb-length correction pass that reruns hand and foot IK against the source's world positions, so contacts survive proportion changes, and a loop seam blend.
- Output is split into `mocap-core.json` (neutral and gendered defaults, plus Giles and Okafor, loaded at start) and `mocap-<character>.json`, which is lazily imported with that character's body.

*Alternative: one big JSON.* Rejected. Nine characters × about 25 clips at roughly 26 KB each is about 6 MB, too much for start-up and for `runtime-memory`.

### D10. Cast motion sandbox
A new `castMotionSandbox` entry alongside `actorsSandbox` and `posesSandbox`:
- Rows are named characters plus the crew m/f defaults. Columns are the activity and posture-family vocabulary.
- Each cell is a body instance with a floor label. Cells using a fallback get a red label.
- Controls: pause, scrub, 0.25×/0.5×/1× speed, solo a row or column, and a toggle for the detail pass (to compare before and after).
- Bodies are instanced from the shared library, so the grid stays within the sandbox's own budget. Rows load lazily as the camera reaches them.

### D11. Scene variants
A variant is a partial profile with a `when` condition: `{ sequence: id }`, `{ task: id }`, `{ flag: name }` or `{ stage: [min, max] }` (any combination, all must hold). Active variants are layered over the everyday profile in declaration order. Entering or leaving one blends over 0.3 s. The sequence runner and squad task system already know which sequence and task are active, so they publish them to the animator, and nothing in the sequence files changes. A sequence step that asks for a pose (`npcAnim`) looks it up in the active variant first, then the everyday profile.

What the slice's sequences, squad tasks and level placements ask of each named character (from `src/data/sequences/*.json`, `squadBrain.ts` tasks and `levels/slice01.json`). Everything here becomes a variant clip or hold:

| Character | Scene / task | Asked to do | Variant |
|---|---|---|---|
| Giles | `intro_shift_change` | walk in, `rub_forearm`, `lean_back`, `lean_back_mug`, `drink` | `intro`: kitchen lean and coffee holds |
| Giles | `bypass`, `bypass_short` (R05, R06) | `crouchWork` | `panel`: crouched panel work, two-handed below stage 2 |
| Giles | `power_restore` | `typing` | `console`: standing console work |
| Giles | `action_contact`, `action_security`, `action_tunnel` | `flex_hand`, `rub_forearm`, `cough` | ladder tells, see D12 |
| Giles | `action_climax` before he turns | reveal beat | `reveal`: injury at full weight (D12) |
| Okafor | `intro_shift_change` | `lean_back`, `lean_back_mug`, `drink` | `intro` |
| Okafor | `biometric` task | `typing` | `console` |
| Okafor | squad revives | `kneel_revive` | `revive`: kneeling, hands working |
| Okafor | `briefing_gallery`, `action_contact`, `action_tunnel` | `glance` | his own glance (slow, steady) |
| Priya | `intro_shift_change` | walk, `offer_mug` | `intro` |
| Priya | `action_security` | `typing`, `idle`, look-at, `squad_downed`, dragged | `r08`: frightened idle at the console, downed struggle, struggling while dragged |
| Priya | `action_restore`, `action_climax` | `squad_downed` | `downed` |
| Bram | `intro_shift_change` | walk, `typing` (kitchen counter), `offer_mug` | `intro`: counter work, serving |
| Bram | `quiet_restore` | walk | everyday |
| Ruiz | `intro_shift_change` | walk, `arms_out` (checkpoint scan), `idle` | `checkpoint`: arms out, restless |
| Sung | `intro_shift_change`, `rounds` | walk, look-at | everyday walk and look-at (diver gear weight) |
| Heins | post (level placement), `briefing_gallery` | `idle_crossed` | `post`: arms-crossed hold |
| Hale | `rounds`, `briefing_gallery` | `talk_gesture`, `idle_hips`, look-at | `briefing`: presenting, nervous hands |
| Voss | Lab B (seen in `briefing_gallery` through the glass), `drop` | `typing`, then the kill | `labb`: frightened, hurried work at the bench |

New sequences add rows here, and the coverage check (task 1.5) fails until they have one.

### D12. Giles's concealed injury
The injury is a variant like any other, plus a weight that changes at runtime, so it isn't on all the time:

- **Clips:** a set of left-arm-favouring clips and holds (arm carried in, reduced swing, protective grip on the forearm, one-handed panel work, a wince). Baked from exhausted/injured-style takes where they exist, otherwise authored as additive offsets on his everyday clips. Only the left arm, shoulder and head carry them.
- **Weight:** `injury = mix(concealed[stage], unhidden[stage], exposure)`. The starting tables, tuned in the sandbox:

  | stage | 0 | 1 | 2 | 3 | reveal |
  |---|---|---|---|---|---|
  | concealed | 0 | 0.05 | 0.15 | 0.35 | 1 |
  | unhidden | 0.3 | 0.45 | 0.6 | 0.8 | 1 |

- **Exposure** rises to 1 over 1.5 s once he has gone 4 s with neither the player nor Okafor looking at him (in view cone and line of sight within 10 m), and while he's alone on a task. It drops to 0 within 1 s when someone looks at him, unless the stage table's concealed value is already high.
- **Spikes:** an existing ladder tell (`rub_forearm`, `flex_hand`, `cough`, from `squadBrain.ts` `INFECTION_LADDER`) pushes exposure to 1 for its duration, and a task that loads the left arm (`panel` at stage 2+) holds it there.
- **Inputs** come from `squad.ts` (infection stage, observation, tells) through a small `setInjury(stage, exposure)` call on the body, so the animator doesn't know about the story.

The same mechanism is available to any character (`variants.<id>.weight: 'injury'`), but only Giles uses it in this change.

### D13. Giles's everyday standing dialogue

Use Giles's relaxed standing idle as the reference for calm lines. The original 4.2 s excerpt of CMU `19_08` spanned about 138° and 127° of left and right upper-arm rotation. Its clavicles sat about 12° and 15° from their idle orientations throughout the take.

`giles_talk` uses 2.75–7.91 s of CMU `40_11`. The left hand briefly rises while the right stays low. Only the upper arms, forearms and hands take the captured motion. Keeping the idle pelvis, trunk and clavicles removes the sideways lean visible when the full upper body played the excerpt. As this capture takes over, Giles's generated arm gestures and their coupled clavicle motion fade to zero. The jaw and head still follow speech, and D12 controls left-arm guarding.

Reviewed a six-second calm line and the return to silence on the mechanic model from the front and side. At stage 0 his shoulders kept their idle carriage as his left hand rose and settled. At stage 3 with exposure 0 his left arm retained the concealed injury weight of 0.35 through the line.

## Risks / Trade-offs

- **[Four BVH skeletons (CMU, Bandai, 100STYLE) and one glTF, each with its own axes and proportions]** → a per-source bone map plus the limb-length IK pass (D9). Every new source gets checked in the sandbox before it's used in a profile.
- **[CMU's older takes are noisier]** → prefer the higher-numbered subjects, run a light low-pass filter on the bake, and pick takes in the sandbox.
- **[Not enough distinct performers]** → CMU's 144 subjects cover everyday motion, and style values (D2) add per-character tempo, posture and arm carry on top.
- **[Missing postures: sitting and leaning are thin in free data]** → additive holds where captures exist, style-driven idle life otherwise (D4). The sandbox marks every fallback so gaps are visible.
- **[Fused scan fingers may tear when curled]** → the sector fallback (D7) and the stretch check in the spec. A scan whose hands still fail keeps a mitten (one bone for all fingers) and is listed in docs.
- **[CC BY-NC]** → accepted by the project owner (not for sale). Credits are enforced by the credits check, so the licence obligations can't silently lapse.
- **[Download size grows]** → lazy per-character files (D9) and the 2 MB start-up limit.
- **[Giles's injury reads as a bug]** (an arm that looks broken for no reason) → it rises only unobserved or under load, eases in and out, and the sandbox gets an injury row with stage and exposure sliders to tune it.
- **[Animator complexity]** → profiles are data. The animator only gains a lookup and one additive layer. The detail pass is a separate module after the final pose.

## Migration Plan

1. Profiles are introduced with every character pointing at today's clips, so the game is visually unchanged. `MotionSet` call sites move over, and Priya's placeholder entry becomes her profile.
2. New clips land per character. Each character switches when their row looks right in the sandbox.
3. The detail pass ships behind `?detail=0` (on by default) for comparison and rollback.
4. Rollback for motion: `?motion=default` forces the gendered defaults for everyone.

## Open Questions

- The exact style, actor and take for each character (D3 table) is a starting point and gets tuned in the sandbox. Swapping a take doesn't change specs or tasks.
- The D12 weight tables, view distance and timings are starting values to tune in the sandbox and in play.

## Found while landing Giles (task 6.1)

- **Picking CMU windows.** CMU takes open on a T-pose and performers pace and turn, so a window is only usable where the feet stay planted, the heading holds and the start pose matches the end. The bake closes a loop by spreading the start/end difference over the clip, so a poor window bends the arms (segment error of 19° against 2° for a good one). Check the bake's printed segment error and look at the clip in the sandbox before assigning it.
- **Giles's idle must hang his arms.** A hands-at-waist idle hides the injury layer (D12), which is written against hanging arms.
- **Talk captures.** The animator blended a talk clip at 35% on the trunk only, so a character's own talk capture was invisible. Characters with a talk clip of their own now play it on the arms as well, at 0.85.
- **Work and drink are pose treatments (decided 2026-11-21).** `typing`/`sit_typing` are the `work` activity and `drink`/`*_drink` the `drink` activity (`poseTreatment` in `motionProfiles.ts`). When a profile's clip for that activity is an **additive** clip, the animator layers it over the authored pose the way it layers a posture hold (D4): same weight, the hands pinned back onto the keyboard or mug, a seated pelvis kept on the seat. It replaces the family hold for that pose. A full (non-additive) clip is never layered, so the neutral `work`/`drink` clips change nothing, and bake `work`/`drink` clips with `"additive": true`.
- **Open: `turnL`, `turnR`, `wave`, `point`** are still in the vocabulary with nothing that plays them. No slice sequence asks for them yet.
- **Revive is published as a squad task (decided 2026-11-21).** `squad.ts` emits `squad:taskStarted` / `squad:taskDone` with task `revive` (`REVIVE_TASK`) for as long as Okafor's revive job lasts, however it ends: finished, given up, or him knocked down. The check runs at the top of each mate update, before the scripted and downed early returns. A revive interrupts a panel job (revive beats task), so when it ends `main.ts` sets his motion task back to any job he still has. Okafor's `revive` variant should be keyed on `{ task: 'revive' }`.
- **Bandai clips baked at half their stride (fixed 2026-11-21).** Bandai's BVH files give every joint position channels holding its full local position, offset included. three's `BVHLoader` adds the offset again, so every bone loaded twice as long, and the bake, scaling the doubled legs to the reference height, halved the travel: every Bandai walk came out at about 0.6 m/s with a 0.6 m stride while its legs swung as for 1.2 m/s, and played at 2-2.6× at squad speed. `loadBvh` now detects files whose child-joint channels repeat their offsets and takes the offset back out (`absolutePositions` in `scripts/lib/bvhBake.mjs`), and the BVH bake tests fail without it. Corrected Bandai walks travel 1.0-1.3 m/s with strides of 1.2-1.4 m and stance slip like CMU's. CMU is unaffected (only its root has position channels).
- **Giles's walk is Bandai-2 `walk_exhausted_020`.** Compared all 23 exhausted takes and both Bandai-1 tired takes after the fix. 020 travels 1.27 m/s (1.02× at the squad's 1.3 m/s walk), with a low seam, even stance and a 5.6° forward lean. The Bandai-1 tired takes lean 26-35°, too hunched for a man hiding that he is unwell. His jog (`run_exhausted_001`) now bakes at 2.0 m/s, so it plays at 1.7× at the squad's 3.4 m/s jog, about where the shared jog (2.1 m/s) sits.
- **Giles as landed.** Everyday: idle CMU `77_02`, talk CMU `19_08` (since moved to `40_11` by another session), walk Bandai-2 `walk_exhausted_020`, jog `run_exhausted_001`, work CMU `79_19` (playing piano: standing, both hands at waist height), drink CMU `79_41` (sipping coffee), and his stand hold from `77_02` on every posture family. Variants: `intro` (sequence `intro_shift_change`: the coffee capture as his `lean_back` hold, slower tempo), `panel` (tasks `bypass`, `bypass_short`, `bypass_long`, `unlock_locker`: crouched two-handed ground work from CMU `77_06`), `console` (tasks `power_restore`, `reroute`: head down over the console, fewer fidgets), `reveal` (stage 4: tense looking-around hold from CMU `77_01`, slumped, head down). His sandbox row has no fallback cells.
- **`aimPistol` names the shared `pistol_idle`.** Giles never carries a gun in the slice, so his profile names the shared clip on purpose to make it his own treatment and keep the sandbox row green. Revisit if he is ever given one.
- **The injury set is authored offsets, not clips (D12's fallback).** No free source has a left-arm-favouring take, so his injury stays the procedural layer in `Animator.updateInjury`. Two changes make the panel scenario hold:
  - In poses whose hands rest on something (busy arms, the `work`/`drink` treatments, families that pin hands), the arm is no longer drawn in. Only the shoulder, head and chest favour it, so he doesn't pull his hand off the panel.
  - A world-space guard (`Animator.guardArm`, called by the body after its hand-contact solve) eases the injured hand toward a slow copy of its own path, at full strength from weight 0.35 up.
  
  At the R06 bypass (stage 2, loaded, weight 0.6) his left hand now travels 5.1 cm in 4.6 s against the right's 9.7 cm (7.5 cm unhurt). Before, it travelled 26–44 cm: the hold dragged it, and the hand-contact push switched on and off against his body.
- **Variant conditions take lists.** `when.sequence` and `when.task` accept an id or a non-empty list, so one variant covers every task that asks for the same work.
- **Additive scale in the bake list.** `"additiveScale"` (0..1) shrinks an additive clip's offsets at bake time, for a capture whose motion is right in kind but too big to layer under a pose: `giles_panel` 0.35 (its pelvis otherwise swings 23° at 30 cm/s), `giles_reveal` 0.5 (neck turns up to 52°), `giles_hold` 0.6 (pelvis shifts up to 14 cm).
- **Locked-knee performers.** CMU subject 79 never bends the knee, so the bake had no hinge plane to calibrate the legs from and stopped. When no frame of a take bends the knee, the knee is now taken to point straight ahead of the hips. Takes with bent knees bake byte for byte as before.
- **Posture lean is shared evenly.** The profile's `posture` value now bends spine and chest 3° each per unit (was 2° and 4°), so the trunk curves instead of kinking at the chest. The total lean is unchanged.

## Found while landing Okafor (task 6.2)

- **Okafor as landed.** Everyday:
  - **Idle:** CMU `18_08` 4.8–7.9 s, subject A standing and listening in a conversation. It has 0.5 cm of pelvis sway and the lowest retarget error of any clip (0.6°).
  - **Talk:** the same take, 8.8–15.8 s (measured bursts of gesture). Giles's talk is subject B of the same conversation, `19_08`.
  - **Walk:** Bandai-2 `walk_normal_007`, the most upright normal take (3.4° lean, 1.27 m/s).
  - **Jog:** `run_normal_003` (3.7 m/s, plays at 0.92× at the squad's 3.4 m/s jog).
  - **Console work:** CMU `40_11` (waiting for a bus, scaled to 0.4).
  - **Drink:** CMU `23_13` (drinks a soda, scaled to 0.6).
  - **Everyday hold:** his idle, on every posture family.
  
  Style is slow, still and upright (tempo 0.85, fidget rate 0.4, posture +0.3). Variants:
  - `intro` (sequence `intro_shift_change`): the soda capture as his `lean_back` hold.
  - `console` (task `biometric`): head lower, stiller.
  - `revive` (task `revive`): kneeling with his hands working, from CMU `23_03`, subject B kneeling to comfort someone. His everyday kneel hold stays his ordinary hold, because `squad_downed` is in the kneel family and a downed Okafor must not play the revive.
  
  His sandbox row has no fallback cells, and `aimPistol` names the shared clip as for Giles.
- **First idle pick rejected in the sandbox.** CMU `40_10` (waiting for a bus) baked cleanly, but bends his knees and pushes his hips back as he shifts his weight (12.5 cm of pelvis sway), which reads as restless. Look at an idle in the sandbox before keeping it; the bake's numbers don't catch this.
- **Neck turn in CMU holds.** People waiting or chatting keep looking around: the bus-wait console hold turned the neck up to 40°, the soda hold 28°. Scaled to about 16°.
- **Profiles can swap poses everywhere.** `poses` now works on a profile as well as on a variant (default, then the character's own, then variants in effect). Okafor's `glance` and `glance_other` become `okafor_glance` and `okafor_glance_other` (new in `poses.json`): led by the head and neck, with spine and chest at 1° and 3° against the shared glance's 6° and 8°, and a small dip of the head. This covers sequences and ambient idle life alike. A coverage test checks that every swapped pose exists. A swapped-in pose also blends at the character's tempo (`Humanoid.setPose`), so his glance turns over 0.35 s instead of 0.3 s: steadier and slower.

## Found while landing Priya, everyday and intro (task 6.3)

- **Priya as landed.** Her clips are the first character pack (`src/data/mocap/priya.json`, 6 clips, 144 KB, its own 129 KB build chunk), loaded with her body; the core stays at 27 clips.
  - **Idle:** CMU `22_13` 5.0–7.5 s (subject 22, standing still, 1.0° error).
  - **Talk:** CMU `19_08` 13.0–17.2 s (subject B of the 18/19 conversation, explaining with hand gestures). It's the window Giles used before another session moved his talk to `40_11`; Okafor's idle and talk are subject A of the same conversation.
  - **Walk:** Bandai-2 `walk_feminine_014` (1.37 m/s, upright, cleanest seam of the feminine set).
  - **Jog:** `run_feminine_005`, the only upright run (9.5° lean against 21–37°). It plays at 1.23× at squad jog speed.
  - **Drink:** CMU `22_13` 3.5–7.3 s.
  - **Hold:** CMU `22_18` (leaning with hands on a high stool) on every posture family, and as her `work` treatment. It's subject 22's liveliest hold; their standing hold is almost still.
  
  Style is quick and open (tempo 1.12, fidget rate 1.25, arm carry 1.15, posture +0.2). The `intro` variant (sequence `intro_shift_change`) brightens it further for walking in and offering the mug. Her R08 cells are covered by her everyday clips until task 6.4 adds `r08` and `downed` (the coverage check requires only `intro` from her for now). Her cast entry's placeholder note is replaced.
- **No free woman's conversation capture.** CMU's one labelled female subject (106) has takes of 0.6–5 s, and the usable stretches bake with 17–24° error. Subject 141's takes are 2–6 s and pace about. So Priya's style values carry "feminine", along with her body and her feminine walk and run.
- **Seated takes hide in conversation labels.** `22_21` and `23_21` ("conversation") are both played at a high stool. The first talk pick baked cleanly (6.3°) but put her in a half-squat. A hip height well under 70% of head height in the scan means the performer isn't standing; check it before baking a standing activity.
- **Pack loaders must stay plain imports.** Adding a JSON import attribute to the generated pack loaders (so Node tests could load packs) builds fine, but the Vite dev server serves the pack as JavaScript, so the browser rejects it and the game's start-up, which awaits the packs, fails. This was live on the shared dev server for a few minutes before I reverted it. `mocapPacks.test.ts` now fails on any attribute in `packs.ts`; tests add packs through static JSON imports.

## Found while landing Voss (task 6.5)

- **Voss as landed.** Her clips are the `voss` pack (7 clips, 195 KB).
  - **Idle:** CMU `40_10` 1.0–6.0 s. A different stretch of the bus-wait take Okafor turned down, standing with arms down, uneasy weight shifts and glances around, which suits her.
  - **Walk:** Bandai-2 `walk_exhausted_019`.
  - **Jog:** `run_exhausted_006`.
  - **Bench work:** CMU `13_20` (washing windows, hurried trunk motion, scaled to 0.5).
  - **Drink:** CMU `13_09` (scaled to 0.5).
  - **Seated holds:** CMU `13_05` (on a stepstool, hands at the chin).
  - **Other holds:** her idle, scaled to 0.3, because the performer's neck turns up to 53° looking for the bus.
  - **Talk:** names her idle. She has no conversational lines; her two lines are spoken inside her kill, which ignores the living profile.
  
  Style is head down, arms held in, fidgety and slumped (head pitch +8°, arm carry 0.8, fidget rate 1.6, posture -0.35). Her `labb` variant (sequences `briefing_gallery` and `drop`, where she is watched through the glass) makes her hurried and more frightened. Subject 40 also supplies Okafor's console hold and Giles's current talk, though from different stretches.
- **Her kill is unchanged.** `src/ai/killProfile.test.ts` plays the whole Lab B kill twice after two seconds of bench work, on her profile and on the plain feminine default, and compares her body frame by frame:
  - Every beat starts on the same frame.
  - From the panic beat on, every joint matches within 0.04° and her position exactly.
  - Only the first second of the scratch beat differs. It is her body blending out of her own bench motion: 8° shrinking to 0.1° over 1.5 s, with no larger frame-to-frame step than the default's.
  - Before the kill her own motion does show (the comparison is live).

## Fixed: every BVH-baked character shrugged (2026-11-21)

- **Symptom.** Giles, Okafor, Priya and Voss all held their shoulders hunched up, all the time.
- **Cause.** The BVH bake copied each source performer's clavicle direction literally. CMU and Bandai skeletons run the clavicle up from the sternum, while the shared skeleton runs it out and down (-15.9° at rest). Every BVH-baked clip therefore carried its shoulders 15–40° high on average: CMU idles and talks at +10° to +23°, Bandai walks and runs at -1° to -7°. The Quaternius clips the crew use sit at -15° to -19°.
- **Fix.** `bakeBvh` calibrates the shoulders against the chest, as it already did heads against the neck and hands against the forearm. On average a clip now carries its shoulders at the shared rest, and the performer's shrugs and rolls come through as movement around it. CMU's BVH conversion holds the shoulder fixed to the chest, so CMU clips add no shoulder movement; Bandai keeps 2.4° of its 3.7°.
- **Result.** After re-baking, every clip averages -15.2° to -16.9°. On living bodies the four characters measure -15° to -20° idle, talking, leaning and typing, against the crew's -15° to -18°.
- **Tests.** `scripts/clipChecks.test.ts` checks that every baked clip stays within 4° of rest on average, and that CMU and Bandai bakes keep the shoulders at rest and keep the source's shoulder movement.
- **Lesson.** The bake's segment-error figure didn't catch this, because the shoulder isn't one of its measured segments. Look at shoulder carriage when adding a new source.

## Found while landing Bram (task 6.6)

- **Bram as landed.** His clips are the `bram` pack (8 clips, 227 KB), all from CMU subject 80 (a performer recorded doing kitchen and everyday tasks) except his walk and run.
  - **Idle and everyday hold:** `80_37` (watching TV, standing with his hands together at belly height, like hands on an apron). The hold is scaled to 0.6.
  - **Talk:** `80_14` 8.5–12.3 s (teaching, gesturing around chin height). The take's earlier stretch raises the hand above the head, which looked odd for a cook chatting.
  - **Walk:** Bandai-2 `walk_masculine_009`. Bandai's elderly walks move at 0.8–0.9 m/s (1.45–1.65× at the 1.3 m/s NPC walk speed) and stoop 17–20°; this is the least stooped masculine walk, at 1.26 m/s.
  - **Jog:** `run_masculine_003`.
  - **Counter work:** `80_32` (slicing).
  - **Drink:** `80_40` (drinking from a bottle, scaled to 0.5).
  
  Style is slow and relaxed with an open arm carry and no slump. His `intro` variant (sequence `intro_shift_change`) swaps his counter work for `80_31` (making coffee). His shoulders sit at the shared rest in every clip.
- **The serve and hand-off still land.** `src/actors/bramServe.test.ts` builds him on his real body with his pack, outside and inside the intro. In `offer_mug`, `idle_mug` and `lean_back_mug` the mug stays in his right hand and within 10° of upright every frame, and his offering hand lands within 3 cm of where it lands on the default motion.
- **Fixed: released packs were never reloaded.** A body holds its character's pack and the last body releases it, but packs were only loaded at start. So after a death restart or checkpoint restore rebuilt the NPCs, Priya, Voss and Bram fell back to default motion for the rest of the session. `Humanoid` now loads a missing pack when it builds a body for that character, holds it once it arrives, and switches to its own motion with a 0.3 s blend. Until then it uses the default quietly, without fallback warnings. The loader comes from the body context, so tests can supply one; `mocapPacks.test.ts` covers the restart case.
- **Seen while landing him, not caused by this work.** `heldGrip.test.ts` "Authored hold poses already hold the mug near level" fails on `bram/idle_mug` (40° swing). It fails the same with Bram's profile stripped and with his pack hidden, so it comes from other sessions' concurrent edits to `animator.ts` and `humanoid.ts`. The other session's `dock_guard` test (which uses profile-level pose swaps) expects 8 cm lower hand placement than its pose gives.

## Found while landing Ruiz (task 6.7)

- **Ruiz as landed.** Her clips are the `ruiz` pack (4 clips, 95 KB).
  - **Idle and everyday hold:** CMU `137_28` 18.6–22.6 s ("Normal Wait": thumbs at the belt, glancing left and right across about 85°, chin slightly up). The hold is scaled to 0.5. Style is quick, upright, chin up and a little fidgety.
  - **Walk and jog:** Bandai-2 `walk_youthful_027` (1.32 m/s, upright) and `run_youthful_007`. The local copy of Bandai-2 had no youthful takes until now; they come from the same repository through the bake list. The youthful walks lean 0–5°, against 10–16° for the active ones.
  - **Talk:** her idle, as Voss's. CMU has no standing conversation take that isn't already someone's (subjects 18 and 19 are Okafor's and Priya's) or that loops: the "Story" takes run 3 s, "direct traffic" is semaphore, and `23_21` is seated.
  - **Drink and work:** none. She never drinks or works in the game, so she keeps the shared clips there (the sandbox shows those two cells red). The teen coffee-mug take (`137_17`) shuffles too much to loop (10–16° segment error).
- **Rejected first take: `139_03`.** "Looking around" scored well (1.5° segment error, broad head turns), but subject 139 is the sneaking set: in the sandbox she stood crouched and bent forward. Head height in the take was 91% of standing, against 97–100% for upright takes; check that number before picking an idle. The "Gangly Teen Wait" (`137_19`) and `141_20` shuffle and turn too much to loop.
- **The checkpoint scan.** `arms_out` has no posture family, so a hold never reaches it, and the shared pose stops mocap entirely (she stood frozen). Her `checkpoint` variant (sequence `intro_shift_change`) swaps in `ruiz_arms_out`: arms out at 82° with the chin up. Like `*_offer_mug` and `*_glance`, any `*_arms_out` pose now plays as a standing arms overlay, so her legs and trunk keep her idle under it. At 78° her sway dropped her hands 16 cm under her shoulders; 82° keeps them within 13 cm (the shared pose: 11 cm). `src/actors/ruizCheckpoint.test.ts` covers the swap, arm height and spread, and checks that her head moves more than twice as much as on the shared pose.
- **Coverage rule gap.** `castMotionCoverage` counts a stand hold as covering any plain authored pose, including `arms_out`, which a hold never actually reaches. The scene-variant test now builds its synthetic Ruiz without holds.
- **Imported-body-models intro poses still pass** (`bodyModel.test.ts` scan-body checks). In the sandbox, her body showed no coverall pulling away in her hands-at-the-belt idle, the `lean_back` cell (with its mug) or the walk. The elbows-out idle shows the scan's bulky sleeves, but nothing tears. `idle_hips` and `talk_gesture` were not looked at on their own.

## Found while landing Heins, Hale and Sung (task 6.8)

- **Heins** (`heins` pack, 4 clips, 56 KB)
  - **Idle and hold:** CMU `111_28` 1.0–3.0 s ("Standing still": hands at her sides, 2 mm sway, 0.7° segment error). The hold is scaled to 0.5.
  - **Walk and jog:** Bandai-2 `walk_active_001` and `run_active_005`.
  - **Talk:** her idle; her lines are on the radio.
  - **Style:** upright (posture 0.4) and still.
  - **`post` variant** (sequences `briefing_gallery`, `drop`): stiller still (fidget 0.3, posture 0.5).
  - **Her level placement** (`idle_crossed` in R03) can't be a variant condition. She holds the shared crossed-arms pose there over her own idle, at her everyday style.
  - **Rejected:** `111_28` 10.5–13 s, a folded-arms stretch that bakes cleanly (0.6°). On her body it came out as both hands floating in front of her chest, and swapping her `idle_crossed` for it lost the crossed arms.
- **Hale** (`hale` pack, 5 clips, 148 KB)
  - **Idle and hold:** CMU `82_08` 1.26–6.34 s (stand still, glancing about 80° side to side). The hold is scaled to 0.6.
  - **Talk:** `29_04` 21.37–25.5 s (subject 29 telling the "Alaskan vacation" story: hands working in front at waist height, head nodding, 2.1° segment error).
  - **Walk and jog:** Bandai-2 `walk_normal_013` (1.30 m/s, 0.9° segment error) and `run_normal_005`. He used to walk the shared formal walk; this replaces it.
  - **Style:** fidgety, slightly asymmetric.
  - **`briefing` variant** (sequences `rounds`, `briefing_gallery`): quicker (tempo 1.15) and more restless (fidget 2.4). His hands are already the most fidgety in the cast (hand fidget 0.68).
- **Sung** (`sung` pack, 4 clips, 68 KB)
  - **Idle and hold:** CMU `111_28` 6.26–8.76 s. It's the same performer as Heins, but not her window.
  - **Walk:** Bandai-2 `walk_masculine_008`: the longest stride at the slowest cadence among the masculine walks, for the diving gear.
  - **Jog:** `run_masculine_005`.
  - **Talk:** his idle.
  - **Style:** slow (tempo 0.85), wide arm carry (1.2), no scene variants.
- **Side lean is a pick criterion.** Hale's first takes stood hip-shot. `113_21` leans 5° on average (14° at worst), and `19_08` 2.3–4.8 s leans 12° (19° at worst). In the sandbox he tilted 10–15° all the time; on the current takes it's 1–2°. Every window of `19_08` that stays under 5° lean raises a hand above the face. The scratch `lean.mjs` and `talksweep.mjs` measure lean, hand height and loop gap per window.
- **Talk windows must not overlap another character's.** Hale's first talk was `18_08` 11.8–14.8 s, inside Okafor's talk (`18_08` 8.8–15.8 s).
- **Rejected for idles:**
  - `137_41` "Strong Man Wait": the head stays turned 40–50° to one side.
  - `86_15` "hand motions": seated.
  - The `18_10`/`19_10` quarrels: they walk about.
- **Shared authored poses don't read (found here, not caused by this work).** `idle_crossed` leaves the hands apart in front of the chest instead of crossing the arms, and `idle_hips` holds the hands out from the body instead of on the hips. It looks the same on the crew default bodies, so it's the authored poses (or their retargeting), not anyone's motion. It affects Heins's post in R03 and Hale's rounds.
- **Coverage test:** "a landed character must cover every request" used Hale as its not-yet-landed example; it now strips Hale's clips itself. `motionProfiles.test.ts` covers the three profiles and their variants.

## Fixed: crossed arms and hands on hips didn't read (2026-11-21)

- **Cause.** Both authored poses bent the elbow (`foreArm` X) with no upper-arm twist, so the forearm folded straight forward. `idle_crossed` left the hands apart in front of the chest, and `idle_hips` held them out from the body, 40–47 cm from the spine.
- **New authored angles.** I solved them on the procedural crew body: point the upper arm at a target elbow, then search upper-arm twist and elbow bend for a target wrist, in a level frame at the chest.
- **Fixed angles weren't enough.** Under the standing arms overlay the trunk plays each character's own idle, and the reach depends on the build. Bram's chest sits 15 cm ahead of his hips, and Heins's forearms only reach the midline. So the animator now pins the hands after writing the pose (`anchorHandsOnHips`, `anchorCrossedArms`), eased in and out with the pose:
  - **Hands on hips:** each wrist goes 11 cm out from its hip joint, 16 cm up and 3 cm back, with the elbow drawn out wide.
  - **Crossed arms:** the right wrist tucks behind the left arm, then the left lies on the right biceps. Each wrist goes in from the other arm's outer edge, and the hand flexes down over that arm.
- **Contact kept rolling the forearms.** The hand-contact solve re-solved each arm with its own anatomical elbow hint, which pulled the elbows back and rolled the forearms. A new `keepElbows` input (on while either pose holds) keeps the elbow direction the pose set.
- **Rejected along the way:**
  - **Aiming the hand in world space to wrap behind the other arm:** the hand solver clamps that wrist deviation.
  - **A searched wrist rotation:** it meant different things on each rig.
- **Coverage.** `src/actors/armPoses.test.ts` holds both poses for 3 s on the procedural crew body, Heins, Hale, Ruiz and Bram (Bram for crossed arms only), each on their own idle. In the sandbox both poses now read as named on Hale, Heins, Ruiz and the crew bodies.
- **Ruiz's arms bent like noodles under her own idle** (thumbs at the belt, elbows at 90°). Her old motion kept the arms nearly straight, which hid both causes. Fixed in her body (`scripts/fix-ruiz-glb.mjs`, `scripts/lib/scan-body.mjs`); you confirmed the result in the sandbox.
  - **Elbow blend.** The scan skinning spread the upper-arm/forearm hand-over across most of the arm: forearm weight went from 30% to 70% of the arm's length, and was 18% at the right elbow joint. A new elbow rule re-splits those two weights by distance from the elbow along the arm, over ±3.5 cm.
  - **Shoulder joints.** They were low (1.46 m), and the left one sat 7 cm inside the torso, off the sleeve's axis. Both now sit on the sleeve axes at 1.49 m, and the right elbow moved onto its sleeve. The armpit split moved up with them to 1.37 m: at 1.36 arm and torso blend below the armpit line, and at 1.38 the shoulder stretches 2.7× when the arms rise.
  - **Build script.** It now calls ImageMagick 7's `magick` when present. On Windows, `convert` is the system disk tool.
  - **Sandbox.** Picking a row in the cast motion sandbox now flies the camera to it. Rows load only near the camera, so rows far back, like Ruiz's, never appeared from the dropdown.
- **Limits.** Bram can't stand hands on hips: his idle's forward-leaning chest leaves his arms nearly straight, so the elbows can't bow out; he never does it in the game. The fingers still rest fairly open on the other arm and the hips.

## Found while landing the crew defaults (task 6.9)

- **Pools, not one clip.** Profiles gain `pools`: per activity, a list of takes; each body picks one by its seed (`new Rng('motion-pick:<seed>')`). A pool wins over the same profile's `clips` entry. Medic-outfit crew keep the formal walk, because the walk pool gives way to `formal`.
  - **Don't use the bare string hash for the pick.** FNV-1a's top bits barely move between ids that differ only in their last character (`crew:mess:0` to `:9` all fell on the first take).
- **The defaults' takes.** `crew_m` and `crew_f` each pool three walks and three runs, in the core library (12 clips; core grew from 756 KB to 896 KB).
  - **No performer labels.** Bandai doesn't label its three performers and aligns their proportions, so the pools take three clean takes with different gaits (speed, stride, cadence) to spread across them.
  - **Masculine:** walks 019, 012 and 023; runs 002, 004 and 006.
  - **Feminine:** walks 007, 015 and 011; runs 001, 002 and 004.
  - **Not reused:** Bram's 009 and Sung's 008 masculine walks, and Priya's 014 feminine walk.
  - **Levelled masculine walks.** Bandai's masculine walks all lean forward 12–21°, and generic men looked stooped. The crew masculine walks use the bake's `levelTrunk`, which brings their chest from 13–18° down to 10° with the legs untouched. The feminine walks are upright already.
  - **Idle and talk stay shared.** Bandai has no standing takes. Each body still varies them by its seeded tempo (±8%), posture and start phase.
- **R02, as the game builds it.** `src/actors/crewDefaults.test.ts` builds each generic crew member placed in the Commons the way the level spawns them (the crew look pool's body, that body's recorded gender). Each one plays its body's gendered default, between them they use at least three walks, and no two share a start phase and tempo. The file also covers the take spread, seeded determinism and named characters ignoring the pools.
- **Seen in the sandbox** (on a snapshot build; other sessions' edits kept reloading the dev server): both default rows walk their pooled takes, and the masculine one now walks upright.

## Found while landing the hand rigs (task 5.5)

- **Fists tore where the scans fuse fingers.** On the first hand rigs the fist stretch test (`bodyModel.test.ts`: no edge of 3 mm or more over 2.5× in a full fist) failed on Bram (4.1×), Heins (5.8×) and Ruiz (8.3×). The cause was fused fingers and contacts in the scans: Bram's thumb tip rests on his palm and his fingers lie together, Heins's right thumb tip lies on her index finger, and Ruiz's right hand grips the cut-away toolbox handle.
- **`splitHands` cuts them apart** (`scripts/lib/hand-rig.mjs`, run by every prep script before `rigHands`), the way `splitArms` parts the arms from the torso.
  - **Labelling:** each hand is labelled as the rig labels it (palm, thumb, four strips), and each triangle takes the member most of its corners have.
  - **What gets cut:** a vertex is duplicated where two members that must move apart meet there: two fingers, the thumb and a finger, a fingertip on the palm (past 40% of the finger, or 70% for the thumb), or a palm triangle reaching a finger past 1.1 palm lengths. Members joined at their root there (a finger and the palm at its knuckle) stay on one copy, so the cut stops at the knuckles.
  - **Caps:** each cut is closed with a zipper strip in the colour of its rim. Both sides get the same strip, so they share the closing edge across the knuckles. Independent caps left 30–42 mm open edges, which failed Ruiz's "arms move without dragging the torso" check.
  - **Rig labels:** `rigHands` reuses the cut's frame and labels. The copies sit exactly on their originals, so labelling them again by position would put both on one finger.
- **Rig fixes the cut exposed:**
  - **Weight smoothing:** membership smoothing counts neighbours by inverse edge length, and neighbours off the hand count as palm. Bram's decimated hand has 7 cm edges from the wrist to the thumb tip, which gave wrist vertices a quarter of his thumb.
  - **Thumb tip:** a patch of strip vertices that never reaches the knuckles but borders the thumb is the thumb's. Heins's thumb tip sat past the thumb's length limit and was weighted as index.
  - **Base joint:** the base joint is the per-axis median of the strip's nearest 15% to the knuckle line, fitted to the strip without crumbs under 5% of it. A plate of Heins's cyborg hand put her left middle finger's base 4 cm above the finger.
  - **Cut originals:** a cut vertex's original keeps its own member's label. Taking the smallest member's label turned the hub of Ruiz's toolbox cap into a middle-finger vertex in his palm.
- **Seen in the sandbox** (snapshot build, the fist forced through the hand solver's `hulk` shape):
  - **Cap colour:** the caps first took a rim texel, from the crease between fingers that the scan textures shade dark. Once Bram's fingers parted, each cap showed as a dark brown fin. Caps now take the texel of their own finger's surface 5 mm or more from the cut, nearest the cap's middle.
  - **Heins:** her wrist gap and the loose look of her knuckle pieces are in the cyborg mesh itself. Her body from before the hand rig shows both.
  - **Ruiz:** both her hands shred in her everyday idle, not only in a fist. The solver eases the scan's fist toward a relaxed curl, and the fused strips pull apart into shards with their caps showing. Before task 5.5 her hands had no finger bones and stayed as scanned, so on her the rig is a step back in normal play.
- **Decision: Ruiz and Sung keep their scans' own hands** (fused fists and gloves; neither is significant enough to need finger motion). Their `body-models.json` entries drop `handRig`, and the fist test and the finger-bone rig check leave them out. The imported-body-models spec allows this exception. `fix-ruiz-glb.mjs` passes `hands: false`, and a rebuild reproduces her pre-rig body byte for byte. `fix-sung-glb.mjs` and `sung.glb` are as committed.
- **Result:** Bram 2.28× and Heins 2.31× pass. Ruiz is at 4.03× (it was 8.3×). Ruiz's other scan-body checks still pass.
- **Still open: fused fists.**
  - **Ruiz's right hand** is one closed blob round the toolbox handle's hole: the fingertips merge into the palm heel and the hole's fan cap fills the middle. No surface path or thickness test separates fingertip from palm there, and the strip chains run straight through the curl.
  - **Ruiz's left hand** is a coarse, fused relaxed curl with 14–20 mm edges across the finger joints.
  - **Sung's hands** are gloved mittens, and his right still holds the trimmed blueprint tube.
  - **Tried and dropped:** sharing one chain across the four strips of a mitten (worse: 6.8× on Sung), per-finger instead of shared finger lengths (worse on Heins and Sung), and wider joint blends (no change).
  - **What these hands need:** a mitten rig built for them, a re-sculpted scan, or the test accepting a fused fist's tear.
- **Sung's source is missing.** The committed `sung.glb` was built from restore50's "Construction Worker In Safety Gear" (see its `asset.extras` and `CREDITS.md`). `previews/modern_service_technician_src.glb` is a different restore50 scan ("Modern Service Technician"), which is why rebuilding from it lost his left foot's weights. A script that added the hand rig to his built body reproduced it exactly without the rig, but with the rig his fist reached 3.07×. It was dropped along with his hand rig.

## Measurements

- **Group 2 gate (2026-11-20):** start-up chunk `index-*.js` 1,130.24 kB (316.09 kB gzip), which includes the core clip library (`mocap-core.json`, 287.1 kB raw: 10 clips plus Quaternius finger tracks). No character packs yet. `npm test`: 938 of 939 pass. The one failure is the R07/R08 prop-placement test in `slice01.test.ts`, from level edits made in parallel, outside this change.
- **Close-out (2026-11-22, task 7.2).**
  - **`npm test`:** 1,331 of 1,341 pass. None of the 10 failures comes from this change:
    - `heldGrip`: Bram's `idle_mug` mug level (37°). This was already seen while landing him (40°), with his profile and pack ruled out.
    - `dock_guard` motion binding, and the dock-guard chair reach (a foot leaves the floor during the pull).
    - The R08 `mauled` kill (`npcKills`, twice): this is the paused Priya R08 rework.
    - The R03 light slots (`slice01Gallery`).
    - The three slice01 scripted-walk tests: level edits made in parallel.
  - **Grip-frame test fix:** it used Bram as its unrigged hand. Bram now has finger bones, so the test uses Ruiz, and `castModelTestKit`'s list of unrigged bodies now names Ruiz and Sung.
  - **`npm run build`:** the typecheck stops on `src/render/water/ripples.ts`, another session's untracked water work (a `Uint8Array` passed as `BufferSource`). `vite build` alone succeeds: the start-up chunk `index-*.js` is 1,957.87 kB (524.95 kB gzip), and all JS chunks total 8,967 kB.
  - **Library sizes:**
    - **Core library:** `mocap-core.json` is 895.5 kB.
    - **Character packs:** Bram 227.6 kB, Voss 190.6 kB, Priya 181.1 kB, Hale 148.4 kB, Ruiz 95.3 kB, Sung 67.8 kB, Heins 56.2 kB (967.0 kB in all). They load per character, and Bram's, Priya's and Voss's are split into their own chunks.
  - **Memory probe:** built game, `?slot=scratch&memprobe`, High, Standard difficulty, sampled in place. This is not the full churn protocol of the runtime-memory spec (10 minutes of enemy spawns, kills and gore, then settle), and it has no earlier like-for-like baseline to compare against.
    - **Loaded title:** JS heap 270 MB; 64 GPU textures, 343.9 MiB; buffers 5.4 MiB; decoded audio 208 MB.
    - **New game, intro (cast loading):** heap 278 MB; buffers 5.5 MiB; audio 337 MB.
    - **Slice opening, 40 s in, then 30 s settled:** heap 277 MB, then 265 MB; GPU textures 95, then 110 (447.8 MiB, then 498.5 MiB); buffers 14.2 MiB, then 19.1 MiB; audio 337 MB.

