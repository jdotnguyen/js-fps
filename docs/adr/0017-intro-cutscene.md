# ADR-0017: New-game intro cutscene (skippable, on rails)

Status: Accepted (structure, skip rule, bars, camera, cast, beats from the Nov 16 grilling) /
Proposed (exact lines, timings, numbers)

Revision 2 (2026-11-16). Rewritten after a design grilling session. Revision 1 had a silent
player, a 2:15 scene with three people in it and a look clamp. Changes are listed at the end.

## Context
Choosing New game + difficulty drops the player into an opening scene instead of straight into
control [Decided]. The player (Jay) stands guard at the docking ring as the engineer (August
Giles) and medic (Dr. Tomas Okafor) arrive for the morning shift. There is banter, then Jay
follows them to the kitchen [Decided]. The scene is skippable by holding a key for 3 s with a
filling progress bar [Decided], and black bars fade in whenever the player is on rails
[Decided]. It is real-time and first-person with no camera cuts (ADR-0009).

**What the scene is for** [Decided]: a mix of three jobs with **warmth in charge**.
1. *"I like these people."* (most of the time). The reveal at the end of the slice and Priya's
   death only hurt if the player likes Giles, Okafor and Priya first.
2. *"This place is real."* (the backdrop). A working station waking up: a supply sub, crew
   coming on shift, a cook, a radio.
3. *"Something's off."* (two or three small touches only). The horror comes much later
   (ADR-0023); the intro must not put the player on guard.

**Jay speaks** [Decided] (reverses revision 1 and ADR-0010's silent player). Friendly, warm,
kind banter, no dialogue choices (those come after the slice) [Decided]. His voice is
**steady and attentive**: few words, quietly funny, and he remembers the small details of
other people's lives [Decided]. Jay is a man [Decided].

## Decision
The intro is one ADR-0009 sequence, `intro_shift_change`, flagged `skippable: true`. It starts
on the TAG card, ends with Priya handing Jay a coffee, and returns control in the commons (R02)
after the `cp_intro` autosave. Skipping applies the sequence's end state instantly. Loading a
save or restarting after death never replays it. The morning briefing that follows is a
**separate** skippable sequence (ADR-0023).

**No length cap** [Decided]. Write it, time it, judge it. The current budget is about 3:00.
If it drags, cut the guard-post walk-bys first, never the kitchen [Assumed].

## Cast in the scene
| Who | Role here |
|---|---|
| **Jay** | The player. Speaks. Steady, notices people. |
| **August Giles** | The comedian. Hides his forearm. |
| **Dr. Tomas Okafor** | Calm, deadpan, gives "medical advice" orders. |
| **Priya Anand** | Okafor's nurse. Same weight and likeability as the other two [Decided]. Covers the medical bay so Okafor can sit down, and hands Jay his coffee [Decided]. |
| **Bram** | The cook. Runs the radio and the coffee. |
| **2-3 crew** | Walk past the guard post on their way in (e.g. Ines Ruiz, who moves out of the kitchen to make room for Priya [Assumed]). |
| **PA** | Shift-change chime and the Lab B "routine quarantine" notice. |

## Beats (about 3:00)
| ~Time | Beat | Camera / control |
|---|---|---|
| 0:00 | Fade in from the TAG Industries card while the **main theme** plays. Caption: station name, "Docking Ring", "06:40 Shift change". | Scripted |
| 0:05 | **Sub docking** [Decided]. Through the big docking-ring window a supply sub's lights rise out of the dark and it clamps on with a deep clunk. It brought the morning crew. The theme thins out to station sound (hum, vents, PA chime). | Scripted, framed on the window |
| 0:25 | **Walk-bys** [Decided]. 2-3 crew come through the dock door and pass Jay's post with one exchange each, Jay answering in his noticing style (e.g. "Morning, Ruiz. Your boy's recital go okay?"). | Scripted, eases to each speaker |
| 0:50 | The door cycles; Okafor and Giles arrive. Banter at the post: Okafor's "observation, not a diagnosis", Giles's four hours of sleep, Jay setting up Giles's jokes. | Scripted |
| 1:25 | **Walk to the kitchen.** NPCs lead, Jay auto-walks behind. Background PA: `pa_quarantine_01`, which the squad talks over and almost ignores (uneasy touch 2). Giles rubs his forearm; Okafor asks about it out of plain concern; "Slept on it wrong." (uneasy touch 1, infection ladder stage 0, ADR-0022). Passing the abyss window the **camera is turned to it** and a large shadow passes in the dark (uneasy touch 3, always plays) [Decided]. | `playerWalkTo`, scripted look |
| 2:00 | **Kitchen (R02).** Bram's radio plays the "TAG FM" tune (see Audio). Bram on the coffee. **Priya** comes in with a tray, swaps with Okafor ("Go, sit. I've got the bay."), teases Giles's coffee count. | Scripted |
| 2:25 | **Mara plant** [Decided]. Jay: "How's Mara liking the new school?" Giles answers in one proud line, then changes the subject fast ("Expensive. Coffee?"). | Scripted |
| 2:40 | **Priya hands Jay the mug** [Decided]: "Morning, Jay. Doctor's orders: one cup." Interact prompt "[E] Take coffee". Jay asks her to save him a seat at lunch [Assumed line]. Taking the mug ends the scene; if ignored for 6 s, it ends by itself. Priya leaves for the medical bay. | Scripted, move locked, interact allowed |
| end | Bars fade out, `cp_intro` autosave, tutorial pop-ups begin (ADR-0025), free time in the commons (ADR-0023). | Free |

The mug beat is interactive but not branching: it only teaches `interact`. It is now an NPC
hand-off (Priya holds the mug out), not a mug on the counter: the player's first interaction in
the game is with Priya, and the last thing they do with her before R08 [Decided].

### What the intro sets up, and where it pays off
| Set up here | Pays off |
|---|---|
| Priya covers the bay so Okafor can sit | She is in R08 because of him; Okafor's guilt has two layers (ADR-0014 beat 5) |
| Priya hands Jay the coffee, "save me a seat" | Her death in the post-title stinger (ADR-0014) |
| Mara, the school, Giles's quick deflection | "Mara" at the reveal is a name the player already knows (ADR-0022) |
| The supply sub at the window | After lockdown the same window is empty |
| The TAG FM radio tune | Still playing, cheerfully, in a ruined room after the drop (ADR-0023) |
| Forearm rub | Infection ladder stage 0 (ADR-0022) |
| Shadow at the abyss window | Unpaid in the slice; a later-chapter hook [Open] |

### Cuts from revision 1 [Decided]
- Ruiz's "Third quarantine this month" line (Ruiz is no longer in the kitchen).
- Okafor's "Routine means the paperwork was filed. It doesn't say why." moves to the
  breathing-room beat (ADR-0014 beat 5), where his suspicion of TAG fits [Assumed].
- Lines that faked a silent Jay ("A nod. I'll take it.").

## Camera while on rails [Decided]
- Whenever the bars are up, **the sequence controls the view.** There is no free look and no
  look-reactive dialogue. Revision 1's +/-70 deg clamp and "look free" mug beat are gone.
- **Mouse give:** the mouse can push the view about **6 deg** off the scripted aim. It springs
  back softly when released (critically damped, ~0.4 s), and the scripted shot always wins.
  Setting-free; it is too small to miss a framed moment.
- **Walk motion:** subtle head bob and sway on `playerWalkTo`, so the walk reads as walking,
  not a dolly.
- **Reduced motion:** bob and sway off; the 6 deg give stays; scripted turns use slower easing
  (forced first-person turns are a common motion-sickness cause).
- Sequencer: new action `playerFrame` (`target`, `duration`, `give` deg default 6, `wait`,
  `clear`) backed by `Player.frameView`. It overrides look assist and the look clamp while set
  and is released when the sequence ends. Skip end state: snap to the final aim, then release.
  [Built 2026-11-16, `actors/player.frame.test.ts`]
- Walk motion is the existing distance-driven head bob plus a faint roll sway (~0.25 deg) on
  scripted walks. [Built]
- **PA under the squad:** `say` takes `overlap: true`, which plays the line at once on a
  separate lane of the speech manager instead of queuing behind story lines; the quarantine
  notice uses it. The subtitle HUD (ADR-0012) must show two subtitles at once, the overlap one
  above. [Built, `dialogue/speech.test.ts`]

## Rails and letterbox bars (unchanged from revision 1)
- "On rails" is derived from the control stack (ADR-0004): `move` is `locked` or a scripted
  `walkTo` is active (`Player.onRails`). Bars show when **a sequence is running and** the player
  is on rails, so an enemy grab (which also locks movement) does not show them. It is not a flag
  sequences set by hand, so it cannot be forgotten.
- Slow-walk sections (`move: 'slow'`) are not on rails, so no bars. Bars mean "you cannot move".
- Bars are two black DOM/CSS bands, 11 % of viewport height each, above the HUD, below the skip
  prompt and subtitles. The interact prompt stays visible.
- Fade in 0.6 s, out 0.6 s, eased. With `reducedMotion`, a 0.15 s crossfade with no slide.
- Subtitles sit inside the bars-clear area. Jay's lines use the speaker label "Jay".
- No `cutscene` game mode: `playing` plus `onRails` is enough. Saving is disabled while `onRails`.
- **The dawdle catch** (ADR-0023) reuses this: when Giles calls "Hey!" the bars come in because
  a sequence starts a `playerWalkTo`.

## Skip control (unchanged from revision 1)
- Action `skipCutscene` in `keymap.json`. Default keys `Space`, `Enter`. Not `Escape`, not
  `Mouse0`. Remappable.
- Hold to skip: bottom-right bar fills over **3 s** (`skipHoldSeconds`, default 3, range 1.5-6,
  Settings > Accessibility). Releasing drains at 3x speed. At 100 % the skip fires.
- Hint "Hold [Space] to skip" for 4 s at scene start and again on any input during the scene.
  Only for `skippable` sequences. Shows the player's current binding.
- **Skip assist** (`skipAssist`): one press starts the same 3 s bar; pressing again or Esc cancels.
- Bar has `role="progressbar"` with `aria-valuenow`, `aria-live` "Skipping" at 100 %. Real text,
  never colour alone. Reduced motion: no easing. Reduced flashing: plain 0.4 s dissolve.
- Skip effect (`CutsceneController`): fade to black 0.4 s, `SequenceManager.skip()`, fade in 0.5 s.
- Skipping the intro does not skip the briefing; each sequence is skipped on its own.

## Sequencer support (as built in revision 1, plus the camera changes above)
- One interpreter; a cutscene is an ADR-0009 sequence with `"skippable": true`.
  `SequenceManager.skip()` ends every skippable running sequence; `SequenceManager.skippable`
  drives the prompt.
- Skipping applies each remaining step's end state once (the step in flight is cancelled and
  finished, later steps are finished without playing, finished steps are not applied again).
  End states live in the action table (`actions.ts`); instant actions just run.
- End states: `wait`, `waitFor`, `loop`, `cameraShake`, `timeScale`, `sfx` do nothing;
  `playerLookAt` jumps to its final aim; `fade` and `water` jump to their level; `playerWalkTo`
  teleports; `say` marks the line played and stops speech; NPC actions are sent with
  `instant: true`; `if` skips the branch it would have taken.
- `playerPlace` (`at`, `yaw`, `pitch`) pins where control returns.
- `sequence:ended` carries `skipped`.
- Flags set: `introSeen`, `pa_quarantine_played`, `giles_forearm_seen`, `mara_mentioned`,
  `priya_met`. Checkpoint `cp_intro`.
- New NPC action: `npcOffer` (`npc`, `item: 'mug'`, `prompt`, `timeout`) for the hand-off.
  Emits `intro:coffee_taken`; end state on skip: the mug is in Jay's hand, Priya at her exit
  anchor.
- Debug: `?debug&seq=cutscene_test`, and the debug panel button.

## Audio
- **Main theme** over the TAG card and sub docking, thinning to nothing by the walk-bys.
  No score afterwards [Decided].
- **TAG FM radio** in the kitchen: a light, upbeat, original station-radio tune that crew hum
  to [Decided]. Played through a radio effect: band-limited small-speaker tone, light crackle,
  slight wow/flutter (Web Audio, positional). Plan: Claude composes a short draft loop in code;
  if Justin finds it not good enough, fall back to a royalty-free easy-listening track (Pixabay,
  or incompetech CC-BY with credit) through the same radio effect [Decided].
- Sub docking: low hull groan, clamp clunk, a pressure hiss.

## Names the world must provide
| Kind | Names |
|---|---|
| Anchors | `dock_door`, `dock_window`, `post_front`, `abyss_window_walk`, `kitchen_door`, `kitchen_stand`, `counter`, `counter_giles`, `counter_okafor`, `priya_enter`, `priya_offer`, `priya_exit` |
| NPCs | `giles`, `okafor`, `priya`, `cook` (Bram), `walkby_1..3` |
| NPC actions | `npcMoveTo`, `npcAnim` (`rub_forearm`, `offer_mug`, `drink`), `npcOffer` |
| Props | `supply_sub` (procedural hull, lights, clamp animation), `radio`, `mug`, `tray`, `coffee_machine`, `counter` |
| Events | `cutscene:caption`, `intro:coffee_ready`, waits for `intro:coffee_taken` (6 s timeout) |

## Assets needed (all procedural, nothing blocks the build)
| Need | From |
|---|---|
| Giles, Okafor, Priya, Bram, 2-3 crew | `buildHumanoid`, fixed seeds (Priya: outfit `medic`, cardigan) |
| Poses: idle, gait, gesture, drink, rub-arm, offer-mug | pose library |
| Supply sub | new, simple procedural hull + light rig + clamp |
| Radio, mug, coffee machine, tray, counter | new, simple procedural pieces |
| Docking door with TAG logo, windows | existing kit, `render/logo.ts` |

## Consequences
- Jay's lines add about 8-10 lines; the draft script needs a rewrite (24 lines become ~35).
- Priya's survival through R08 and death in the stinger change ADR-0014 and `docs/characters.md`.
- The drop no longer follows the intro; ADR-0023 fills the quiet half.

## Alternatives rejected
- Silent Jay with NPCs reacting to imagined nods: wears thin over three minutes.
- Look-reactive dialogue: dropped once the camera became fully scripted.
- Free look during the mug beat: breaks "the sequence owns the view while the bars are up".
- Hold Esc to skip; single-press skip; pre-rendered camera; bars set by hand (as before).

## Execution steps
1. [Done] Skipping in the interpreter (`skippable`, `skip()`, end states, `playerPlace`, `onRails`).
2. [Done] Letterbox bars, `skipCutscene`, settings, skip prompt UI, `SkipHold`, `cutscene_test`.
3. [Done] Scripted camera: `playerFrame` with 6 deg give and spring-back; walk sway;
   reduced-motion variants; PA overlap lane.
4. `buildHumanoid` subset: Giles, Okafor, Priya, Bram, 3 extras; idle, gait, offer-mug.
5. R01 guard post (with dock window and sub) and R02 kitchen blockout; new props.
6. `npcOffer` action and the Priya hand-off.
7. Rewrite `drafts/intro_shift_change.json` and the `intro_*` lines against the beats above;
   time it; promote out of `drafts/`.
8. TAG FM radio: Claude's code-composed draft loop plus the radio effect; Justin judges.
9. Tests: skip at 0 %, mid-walk and during the hand-off all end in the same state.

## Definition of done
- New game on every difficulty plays the scene; holding skip for 3 s ends in the same state
  as watching it (positions, flags, checkpoint, played lines, mug in hand).
- Bars fade in and out exactly when the player is on rails, in any sequence.
- While the bars are up, the mouse moves the view by at most 6 deg and springs back.
- Skip works with assist mode and remapped keys; the bar is readable at 200 % UI scale.
- A playtester can name Priya after the scene.

## Open questions
- Final lines and timings (written in step 7).
- What the shadow at the abyss window is (later chapter).
- Exact walk-by crew and their lines.

## Changes from revision 1
Jay speaks; Priya added and given the mug hand-off; Mara plant; supply sub and walk-bys open the
scene; the shadow moved to the walk and always plays; camera fully scripted with 6 deg give and
walk bob; no length cap; TAG FM radio; Ruiz and two Lab B lines cut; the briefing split into its
own sequence.

## Progress
### 2026-11-17: NPC actions and `npcOffer` (step 6)
- `host.npc` is implemented by `ai/npcs.ts` (`NpcDirector`): `npcMoveTo` (paths, ends facing the
  anchor's yaw), `npcAnim` (rub_forearm, flex_hand, offer_mug, drink, glance, cough, gesture, typing,
  or any pose by name), `npcLookAt`, `npcFollow`, `npcTask`, `transform`, `spawn`, `despawn`,
  `attachToTrack` (needs a track provider). Every one honours `instant: true` (teleport, final pose)
  and resolves for `wait`. `npc:<id>` targets resolve to the head. Giles and Okafor are borrowed
  from the squad while a sequence drives them and handed back when no sequence runs.
- `npcOffer { npc, item, prompt, timeout, event, wait }` (waits by default): the NPC holds the item
  out, an interact prompt sits in front of her, taking it emits `event` (default
  `<sequence>:offer_taken`); timeout or skip ends with flag `held:<item>` and the NPC standing.
  The intro draft now uses it for Priya's mug (`intro:coffee_taken`, 6 s) instead of `waitFor`.
- Not seen in a browser.

## Progress (Part A built)

- A new game now loads `slice01` and plays the intro; `?level=kit_test` and `?level=demo` still
  work (the intro is skipped for levels without it via `hasIntro`). `newGame` calls
  `world.resetToData()`.
- `intro_shift_change` and `briefing_gallery` moved out of `drafts/` (the empty folder could not be
  deleted); imports and tests updated. The intro sets `radio_place=commons`; `commons_free` starts
  when it ends cleanly, and `commons_dawdle` is the skippable on-rails catch.
- `cameraFeed` action (schema, types, runtime, host) renders a remote camera to a texture on mesh
  `feed:<id>` with a CCTV pass, throttled; a GL failure disables feeds, not the game.
- [Assumed] feed resolution/throttle and the dawdle timings. Not seen in a browser.
