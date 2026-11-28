# Design

## Context

See proposal.md for why. What the code does today (2026-11-26):

- `grownInside` in `src/data/kills.json` has seven beats. `scratch` ends when the cue line `drop_okafor_01` ends (the
  sequence maps it in `drop.json`, `lines.scratch`), with a 16 s limit. `panic` ends on `until: arrive`: a `toGlass`
  event walks her with `actor.moveTo` at 2.2 m/s, so her arrival depends on navigation and frame timing. `glass` ends
  when `drop_voss_02` ends (`react_voss_scream_04.mp3`, 5.0 s), which its 4 s limit always cuts first. `arch`, `burst`
  and `still` are already fixed (`until: time`). `creature` waits on the creature getting up.
- `KillRun` (`src/ai/killRun.ts`) advances beat time by the frame's `dt`, fires events on the first frame at or past
  their `t`, and loops two or more poses every `period`. It can play one captured clip in place (`clip`, `speed`,
  `until: clip`), added for Priya's rise.
- `Humanoid.beginKill()` turns off mocap, foot IK, hand contact and idle life for the whole kill, so a kill plays no
  footsteps and her feet slide.
- `npcKills.ts` leans her onto `glass.stand` each frame once she has arrived, for every beat after `panic`.
- The drop's lines and lights wait on `kill:<beat>` with timeouts counted from the start of the drop (9 s for `panic`,
  up to 21 s for `still`). When the squad comes in late, `scratch` can run past 9 s, and "She's seizing" fires before
  she moves.
- Props: `R04.json` has a loose prep cart (`labb_cart`) with nine loose items, and fixed glassware on the bench at
  x ≈ 5.5 (`lab_bench`, 2.5 m west of her). The `knock` event throws whatever she passes. The R08 kill already has the
  tools this change reuses: kinematic props driven by `moveProp`, `after` resting poses grouped and applied by the
  `layout` event in a skipped or restored kill, and `burst` throws.
- Audio: kill sounds (`session.ts` `sfx` hook) and sequence sounds (`gameHost.ts`) pass `occlude: false`. Glass
  colliders carry `acoustic: 'glass'`, which costs a light 2500 Hz, ×0.75 muffle (`occlusion.ts`). Voices take
  `VoiceGraph` portal paths, where a glass portal costs the same light muffle. The live Lab B intercom relays every
  positional one-shot and voice that starts in R04. The observation glass is the south wall of the gallery:
  `R03.json` `layout.wallOverride` `1,5,s`, `2,5,s`, `3,5,s` → `wall_glass_partition`.
- Speech acting builds the jaw from the line's text. The `scream` emote is one long open mouth.

## Goals / Non-Goals

**Goals:**
- Everything from the end of Okafor's question to the end of `still` happens at the same time on every run, and the
  tests can say so.
- Captured takes carry her travel and body motion, while the contacts land on the real surfaces whatever body model and
  take are used.
- Each new mechanism (beat tracks, routes, touches, the scripted prop track, sealed glass, the loudness-driven jaw) is
  generic and driven by data, with the Lab B kill as its first user.

**Non-Goals:**
- No ragdolls (`add-physics-ragdolls`), no change to the blade creature's unfold or pounding, no new spoken lines, and no
  change to the R08 kill or to any glass other than Lab B's.
- The fixed clock does not cover `scratch`, which still waits for Okafor's question, or `creature`, which waits for the
  creature's own fixed unfold.

## Decisions

### D1. The clock is the kill's own beat time, from the end of `scratch`

`panic`, `glass` and `still` become `until: time` beats, like `arch` and `burst`. The beats keep their names and order,
so every `waitFor kill:<beat>` keeps working. `KillRun` exposes `clockT`, the time since the first beat after `scratch`
began. It is summed from the same `dt` as beat time, so a pause freezes it. The tests use it to check the spec's
"same time on every run". Starting targets (§4 tunes them with the user, and the total stays about 13 s):

| Beat | Length | What happens (beat time) |
| --- | --- | --- |
| panic | 6.5 s | 0.0 jolt from inside; 0.4 hip hits the bench; 0.55 sweep; 0.8-1.95 doubled over, coughing blood at 1.15 and 1.58; 1.95 push off; 2.15-3.1 stumble; 3.3 knee down, coughing blood at 3.65 and 3.98; 4.35 recover; 5.05 grab the cart; 5.5 cart goes over; 5.5-6.4 to the glass (times set in the §4.7 review) |
| glass | 3.6 s | palms at 0.4, 0.8, 1.2, 1.6 (prints, stingers as today); face to the pane at 2.0; the scream starts at 0.0 and plays on 1.4 s into `arch` |
| arch | 2.4 s | as today |
| burst | 0.6 s | as today |
| still | 1.8 s | 0.0-0.4 knees give; 0.4-1.2 slides down the pane; 1.2-1.8 crumples; `die` at 1.8 |

*Alternative:* one timeline separate from the beats. Rejected: the beats, their events and the sequence's waits already
exist, and the spec fixes the beat order.

### D2. A beat can hold a track of clips and poses

The staged run needs several takes and hand-made contact poses inside one beat (the spec's beat order rules out extra
beats). A beat may give `track: [{ at, clip, from?, to?, speed?, blend? } | { at, pose, blend? }]`. Each segment starts at
its beat time and blends from the one before it. A clip segment plays its take from `from` to `to`, in seconds of the
take, and holds the last frame until the next segment starts. A missing clip falls back to the beat's `poses`, with one
warning, as `clip` does today. The existing single `clip` stays as shorthand for a one-segment track.

### D3. Routes own her position, and clips play in place

A beat may give `route: [{ mark, t, face? }]`. The marks are room anchors (`R04.json`), plus `glass` for the stand
point the kill already works out. Her floor position follows a centripetal Catmull-Rom curve through the marks, timed
by `t`, and eases in and out at stops. She faces her direction of travel unless `face` gives a mark or a yaw. Clip
segments play with their root travel across the floor removed: the hips keep their height and sway, but the route
moves her. A skipped or restored kill puts her at the last mark of the last route beat.

*Alternative:* keep `actor.moveTo` (today's `toGlass`). Rejected: its arrival depends on pathing and frame timing.
*Alternative:* use the clip's own root motion and bend it toward the marks. Rejected for now: free takes never line up
with the bench and the cart, and correcting them is the same work as following a route with worse control. To keep the
feet from sliding, a check warns when a route segment's speed is more than 35% away from its clip's own root speed.

### D4. Contacts are reached by IK, not baked into poses

New kill event `touch`: `{ t, part: 'hand_L' | 'hand_R' | 'hip_L' | 'hip_R' | 'knee_L' | 'knee_R' | 'chest', mark, hold, blend }`.
It pulls that part's limb chain onto a mark or a surface point, holds it for `hold` seconds, then lets go. Limbs use the
existing two-bone solver (`footIk.ts`). The hip and chest move the pelvis or the spine. The poses give the body its
shape, and `touch` makes the contact land within 5 cm whatever the body's proportions. Contact marks are anchors in
`R04.json` (bench edge, cart handle, floor) or points on the glass.

### D5. Feet plant from the clip's contacts while a route moves her

During a route beat, `beginKill`'s "no foot IK" rule is lifted. Clip segments carry foot contact curves (the mocap
bake already makes them for footsteps). While a foot's contact is at least 0.5, its world position is locked by IK. The
lock is released over 0.1 s when the leg would overstretch, so it never pops. Pose segments count both feet as planted
unless the pose lifts a foot more than 5 cm. The landings go through the same footstep callback NPCs use
(`humanoid.ts`, contact-synced footsteps), so surface, range and occlusion all apply. Beats with no route are
unchanged.

### D6. Waiting motion: a looping base clip with an arm-only scratch layer

The shimmy comes from swapping whole-body poses every 0.2 s. `scratch` now plays a looping laboured-wait clip as its
base (new `loop: true` on a clip segment, for beats with no fixed end), and its scratch poses move to an arm-only layer:
`layer: { poses, period, joints: ['shoulder_L', 'upperArm_L', 'foreArm_L', 'hand_L', …] }`. The joints outside the
layer keep the base clip. `look` events turn her head and eyes to `player`, `npc:giles` or `npc:okafor` for a set time
(the glances). Head kicks leave `scratch`; forearm kicks stay. Before the drop, `drop_approach` sets her hunched,
arm-holding pose with the sequence's NPC pose step, as it does `typing` today. That sequence runs again after a load
between the rounds and the drop, so the pose comes back too.

### D7. The drop waits on her clock

Each `drop.json` branch that waits on a beat after `scratch` first waits for `kill:panic`, with an 18 s timeout (the
scratch limit plus 2 s). It then waits for its own beat, with a timeout of that beat's D1 start time plus 1 s. Each
line, light and alarm therefore starts on its beat, and the timeouts only cover a broken kill. "She's seizing" stays on
`kill:panic`.

### D8. The cart falls on a scripted track, in both physics modes

The cart becomes `dynamic: { mass: 14, kinematic: true }` with an `after` pose (group `labb_cart`), like `r08_cart`.
New kill event `tip`: `{ t, prop, s, keys: [[u, slide, yaw, roll]], edge }`. It drives the prop from its current pose
to its `after` pose through the keys, rolling about its bottom edge with an ease-in like falling. It goes through the
existing `moveProp` hook, which sets the drawn pose and the kinematic body together, so the fall is identical with
physics off. When the tip starts, the cart's load is thrown with `burst` if physics is on, or laid out from its `after`
group (`labb_cart_load`) if it is off. Her `touch` on the handle during 3.3-3.6 s pulls the cart's first key toward her.

*Alternative:* a dynamic cart given an impulse. Rejected: it isn't frame-exact and does nothing with physics off.

### D9. The bench sweep is a directed burst

The fixed glassware on the bench at x ≈ 5.5 becomes loose, with `after` poses in group `labb_bench`. New kill event
`sweep`: `{ t, from: mark, dir: [x, z], reach, strength }`. With physics on, it throws the loose objects within reach
along `dir`. This is `PhysicsProps.burst` with a direction instead of "away from the impact". With physics off, it lays
out `labb_bench`. `finishNow` lays out `labb_bench`, `labb_cart` and `labb_cart_load` through the existing `layout`
event, so a restore shows the aftermath. The old `knock` event leaves `panic`.

### D10. Designed crashes over quieter impacts

Each crash is a kill `sfx` event at its D1 time: sweep, cart, body into the bench, knee to the floor, palms on the
glass, scuffs, gasps and grunts. Objects thrown by a `sweep`, `tip` or `burst` are marked for 1.5 s. While marked,
their physics impact sounds play at ×0.35 gain. The cap on impact sounds playing at once stays as it is.

### D11. The scream jaw follows the recording's loudness

When a line with the `scream` emote starts and its speaker is a running kill's victim, the voice player hands speech
acting a loudness envelope: RMS over 20 ms windows of the decoded buffer, normalised to its 95th percentile, with 15 ms
attack and 60 ms release. The jaw opens to `envelope × style.jaw`. Above 0.7 it adds a 20 Hz tremble of up to 2°.
The style's head, neck and arm acting are unchanged. With no decoded buffer (a missing file, headless runs), it falls
back to today's open-mouth scream. The envelope function is pure and lives in `src/audio/`, and the mouth function
lives in `speechActing.ts`. Both are tested with made-up buffers.

*Alternatives:* a live `AnalyserNode`, rejected because it can't be tested headless and is tied to the audio graph;
precomputed envelope files, rejected because they need a build step for one line.

### D12. Sealed glass is a collider and portal property

- Data: `R03.json` `layout.wallParams` gives `{ "acoustic": "sealed" }` to `1,5,s`, `2,5,s` and `3,5,s`.
  `wall_glass_partition` passes it through to its collider. `acoustic` widens to `'glass' | 'sealed'`. Every reader of
  `acoustic === 'glass'` (`frictionOf`, the footsteps, gore and the occluder) counts `sealed` as glass for everything but
  sound.
- One-shots: the occluder returns a new `'sealed'` result, a 400 Hz cutoff at ×0.22 gain, which is stronger than a closed
  door (520 Hz, ×0.42). A wall still wins over it. Kill and sequence sounds change from `occlude: false` to
  `occlude: 'sealed'`, so only sealed glass muffles them, and everything else stays as authored.
- On the pane: the occluder's ray already stops 0.35 m short of the source (`SOURCE_CLEARANCE`), so a sound within
  0.3 m of the pane never reaches it and keeps the light glass treatment, or none for a kill. A test pins this.
- Voices: `VoiceGraph` gets a `'sealed'` portal state, costed like a closed door in route choice and in
  `voiceAudibility`. `level.ts` marks the gallery-to-Lab B glass portal sealed from the same wall params.
- The intercom's relay and its speaker are unchanged.

### D13. The collapse ends at a rest mark clear of the creature

`still` is a route beat. It slides her 0.3-0.5 m west along the pane while a `touch` keeps her chest on the glass
(0.4-1.2 s), then crumples into a new lying pose, `corpseGlassSlump`. `die` holds that pose at 1.8 s. The last mark,
`voss_rest`, sits at least 0.3 m plus her body's extent from where the creature's feet stand (`glass.stand`). A
restored kill puts her at `voss_rest`, not at `glass.stand` as it does today. The lean onto `glass.stand` runs only
during `glass` and `arch`.

### D14. Paths, gates and sessions

The tasks name today's paths. `split-level-data` phase 3 was committed on 2026-11-27, during this change (an exception
the user approved), so sounds live in `src/audio/sounds/<area>.ts`; the Lab B body sounds go in `kills.ts`. If phase 2
is committed before this change starts, use its new homes too (`cast/voss/poses.json` and `cast/voss/mocap.json`).
Phases 2 and 4 must not be in progress at any point while this change runs. Phase 2's own quiet-window check blocks it
while these tasks name its files. Each task section runs in its own session, under the gates at the top of `tasks.md`.

## Risks / Trade-offs

- [The free takes fit the actions poorly] → The track uses short pieces of each take. Contact poses and `touch` IK
  carry every contact. §3 and §4 review the motion in the cast motion sandbox with the user before wiring it into the
  kill.
- [Foot sliding where the route's speed differs from the clip's] → The D3 speed check, foot locks (D5), and picking
  takes close to the route's speed.
- [Bandai takes are CC BY-NC 4.0] → `voss_walk` and `voss_jog` already use Bandai 2. Prefer CMU (no restrictions) when
  both fit, and record every take in `CREDITS.md`.
- [13 s feels rushed or slow] → The spec says "about 13 s". §4 tunes the D1 lengths with the user, and §9 checks the
  total.
- [Widening `acoustic` breaks code that reads `=== 'glass'`] → §7 starts by grepping every reader and adds a test that a
  sealed pane still clips gore and still has glass friction.
- [The kinematic cart blocks a walk later] → Lab B is behind a locked door during the drop. §5 runs the slice walk tests
  with the cart's `after` pose in place.
- [IK contacts look wrong on another body model] → The `touch` tests run on Voss's body and on a second female body
  model.

## Migration Plan

Data and code ship together, one section per commit. Saves taken after the drop restore through `finishNow`. Saves
taken before it replay the drop. No save format changes. To roll back, revert a section's commit. The drop still runs
with earlier `kills.json` data, because every new field is optional.

## Open Questions

- Which capture takes carry the wait, the stumble and the recovery. §3 and §4 pick them from the candidates: CMU
  `91_26`/`105_26` hurt stomach walk, `104_13` stumble walk, `91_59`/`105_59` small stumble, `142_16`/`142_17` scared,
  and `40_10` (her idle) slowed. Changing the take doesn't change the approach.
- The exact D1 times, tuned in §4.

## Section notes

Each section adds what the next one needs here before its session ends: measured times, take choices, anchor names.

### Section 1 (2026-11-26)

- Beat starts on the clock: panic 0, glass 4.6, arch 8.2, burst 10.6, still 11.2, creature 13.0 s. Seen in the real
  slice headless (20-144 fps) and in a browser build.
- `KillRun.clockT` counts from the frame `panic` begins. A fixed beat hands its leftover frame time to the next beat, so
  lengths never add up late.
- "Same time on every run" is tested on that clock (`npcKills.test.ts`, `onTheClock`), plus: `panic` begins within one
  frame of the question's end. Measured from the line's end itself, two frame rates can differ by up to two frames.
- Changing a D1 time (§4.7) also means: the matching `drop.json` wait (start + 1 s), the clock table in
  `quiet.test.ts`, the `due` table in `npcKills.test.ts`, the step in `killRun.test.ts` "Fixed beat ignores its audio",
  and the PLAYTEST drop line.
- `toGlass` speed is 2.32 m/s: she arrives 3.70-3.83 s into `panic`. If she has not arrived by 4.6 s the glass beat is
  skipped.
- The knocked cart's crash sound (`labB.test.ts` "the crash is heard") flips with small speed changes. At 60 fps it
  passed at 2.23, 2.25-2.27, 2.29, 2.31, 2.32, 2.45 and 2.7, and failed at 2.24, 2.28, 2.3, 2.34-2.38, 2.4, 2.5, 2.6,
  2.8 and 3.0. It also flips with frame rate (HEAD failed at 30 and 90 fps, 2.32 fails at 30). §4.5 and §5 replace it.
- `drop.json` still passes `lines.glass: drop_voss_02` to the kill; the glass beat no longer reads it.
- Heins's "Door's locked" is heard only once her scream ends, about 5 s after the glass beat starts, so during the arch.
  His step follows the scream's `wait: false` step as before.
- `still` still dies at 0 s; the D1 collapse and the `die` at 1.8 s are §4.6.

### Section 2 (2026-11-26)

- `kills.json` is unchanged: `grownInside` still walks with `toGlass`. §4.5 writes the first `track`, `route` and `touch`.
- Track pieces (`at`, `clip`/`pose`, `from`, `to`, `speed`, `blend`) start on the beat clock. A piece started part way
  through a frame is already that far into its take, so 30 and 144 fps agree. Speed keys count from the piece's own
  start. A clip piece holds its `to` frame. There is no `loop` yet (§3.3), so the tests lay `voss_walk` end to end.
- Route timing (`src/ai/killRoute.ts`): she cruises along each leg with `EASE_S` = 0.4 s smooth ramps at stops. A
  whole-leg ease would peak at 1.5× the average and outrun the take. For a leg from rest to rest, the cruise is
  length / (time − 0.4). Choose mark times so the cruise is close to the clip's speed. The speed check compares the
  cruise against the clip's own speed: `voss_walk` goes 1.16 m/s on Voss (`Humanoid.killClipRootSpeed`).
- A mark is a kill step mark, `glass` (the stand point), or a room anchor id (resolved as `anchor:<id>`). `face` is a
  mark or a yaw in degrees.
- `touch` puts the part's joint on the mark: the wrist for a hand, the hip joint, the knee (shin origin), or the chest
  joint. §4.4 should author anchors where those joints go, not where the skin meets the surface. A hand mark must be
  within arm's reach (Priya's shoulder to wrist is 0.41 m), because a hand touch does not lean her body.
  `mark: "glass"` puts the joint on the plane 6 cm off the pane (`Glass.at`). The chest joint sits well inside her
  front, so the §4.6 slide down the pane needs an offset or a mark set back from the glass.
- Foot locks (D5) are full from contact 0.5 until the contact falls below it. At toe-off the planted leg reaches full
  stretch and the lock lets go over 0.1 s. That is normal, and the "Planted foot" test counts a stance as ending there.
- The lean onto `glass.stand` is skipped during route beats (a route owns her position). The rest of §4.6's limit
  (only during `glass` and `arch`) is still to do.
- A route turns her with `Humanoid.turnHeading`, at 6 rad/s at most. `setHeading` would reset her planted feet every
  frame.

### Section 3 (2026-11-26)

- The wait take is CMU `79_68` "cold" (`voss_wait`, 1.58-8.62 s, baked as a loop; seam picked by matching the trunk and
  legs). Her feet stay within 3 cm, she stands hunched (pelvis 25° and chest 18° forward on average) and rocks side to
  side about 15 cm at 1.2 Hz, played at speed 0.4. Its upper back bends 20° back against the lower back (bent at the
  hips, chest lifted to look ahead), the shape the standing-idle swayback check flags; `mocapPosture.test.ts` has its
  own check for it (leaning forward all the way up, level side to side). Runners-up if the user dislikes it: `79_73`
  scared (mild hunch, shuffles up to 9 cm, looks around a lot), `40_10` slowed (her idle, upright), `80_45` crying
  (calm, upright, chest back). Swapping is data only: the bake list entry and a splice into `src/data/mocap/voss.json`.
- The bake still needs the temporary manifest (`zombie_walk.glb` is missing). With `--out` the packs are not written,
  so this section baked with Voss's clips moved into the scratch core, diffed every clip, and spliced `voss_wait` in.
  The docs size table was updated by hand (voss 8 clips, 257.5 KB).
- `loop: true` on a clip piece wraps between `from` and `to` (default the whole take). A beat's `layer` sets its poses
  on its `joints` only, after the base pose and before kicks, convulsion and look, and fades on and off over 0.25 s
  (`Animator.LAYER_FADE`). Outside the layer the body is the base clip exactly (tested to 1e-6 rad).
- `look` events use `target` (`player`, `npc:<id>`, or a mark/anchor) and `hold` (default 1.2 s). The head, neck and
  chest turn about 78% of the way to a target 60° off; there are no eyes to do the rest. `KillWorld.find` now wraps a
  squadmate on first use (as the script resolver does), so `npc:okafor` and `npc:giles` resolve in the game. The Lab B
  test harness has no squad, so those two glances warn there.
- `scratch` now: fallback pose `voss_hunch_hold`, track `voss_wait` speed 0.4 looping, layer `kill_scratch_0`/`_1`
  every 0.15 s (3.3 Hz) on both arms, convulsion 0, forearm kicks kept, head kicks gone, `gaze: self:hand_L` (her head
  rests on her left wrist between glances) with `headPace` 0.6 (look springs at 0.6 time, so coming up off the arm to
  a glance stays under 0.3 m/s), glances at 1.8 (Jay), 4.6 (Okafor), 7.6 (Jay), 10.6 (Giles), 13.4 s (Jay).
- Review 1 (user): the first arm poses squeezed both elbows to her midline, her head looked ahead, and her hand missed
  her arm. Reworked on her imported model (`office3`) by a search measuring skin to skin: left `upperArm_L [35,-60,10]`,
  `foreArm_L 70` (elbow at her side, forearm across her waist, 3 cm clear of her body), the same in both poses; right
  `upperArm_R [0,40|20,-15]`, `foreArm_R 105`, `hand_R [35,0,-10]`: elbow fixed at her side, the upper arm turning
  20° sweeps her fingers from 51% to 90% along the forearm, 0.3 cm off the skin, wrist 3.5 cm above its line. The hold
  pose uses `[0,30,-15]`, `foreArm_R 88` (0.2-0.3 cm). A test pins the contact on her model. Her run to the glass is
  still the old flailing `panic` (section 4).
- `voss_hunch_hold` (set by `drop_approach`): hunched, left forearm across her waist, right hand resting on it.
- Pre-existing failures seen on a clean HEAD export, not this change's: `castMotionCoverage.test.ts` (2, Giles's
  `rub_forearm` in the intro), `motionProfiles.test.ts` (dock_guard hand height), `slice01Gallery.test.ts` (R03 light
  slots), `mocapPhysics.test.ts` (flood_elite crew clips).

### Section 4 (2026-11-27)

- Her spot moved (user's choice): `labb_victim` is now (6.45, 0, 26.3), beside the bench, still facing the glass and
  behind the middle pane. From (8, 26.5) the bench was 2.1 m away and the run would have needed about 2.3 m/s. The
  "Voss stays visible" check in `labWing.test.ts` still passes.
- Takes (all CMU, in the `voss` pack, one-shot): `voss_stumble` 104_13 0.4-4.55 s (pieces 0.25-0.95 lurch, 1.25-2.1
  stumble, 3.55-4.15 lunge), `voss_recover` 142_16 42.5-46.5 s (0.85-1.75: up from a crouch while moving),
  `voss_hurt_walk` 105_26 3.75-7.5 s was baked as an option for the last leg, then removed in §4.7 (the lunge stayed). The
  pack is 10 clips, 338.1 KB. Every other clip bakes the same (`okafor_pistol`/`giles_pistol` differ only
  because they are hand-made, not baked).
- R04 anchors: route `labb_bench_edge`, `labb_stumble`, `labb_knee`, `labb_cart_side`, `labb_to_glass`, `labb_pane`,
  `labb_slide`, `labb_slump`, `voss_rest`; contacts (joint positions, not skin) `labb_bench_hip`, `labb_bench_top`,
  `labb_push_off`, `labb_knee_floor`, `labb_cart_handle`; `labb_bench_sweep` is the sweep's `from`. Her path goes round
  the cart's east side; the cart did not move.
- Poses (fitted on her imported body by a search that keeps every capsule out of the room): `kill_bench_hit`,
  `kill_sweep`, `kill_doubled` (propped on her left forearm on the bench), `kill_push_off`, `kill_knee_down`,
  `kill_cart_grab`, `kill_cart_pull`, `kill_pane_lean` (one more than listed: chest and cheek on the pane before the
  slide), `kill_pane_slide` (kneeling against the pane, arms straight up it), `corpseGlassSlump` (on her left side along
  the foot of the wall, head west). The creature beat holds `corpseGlassSlump` too.
- Panic times (beat time): jolt 0.0, hip on the bench 0.36-0.42 (sfx 0.4), sweep 0.55, doubled 0.8, push off 1.18-1.56,
  stumble 1.42, knee down 2.12-2.45 (sfx 2.25), rise 2.45, cart grab 3.15-3.45, tip 3.6, lunge 3.6, at the glass 4.5.
  Still: onto the pane 0-0.4, slide down to her knees 0.4-1.2 (0.24 m west, stopped short of the mullion at x 7.35),
  back off the glass 1.2-1.4, crumple west 1.28-1.8, `die` 1.8.
- New mechanisms: a route leg between two facings (or from the start to a first mark with one) keeps that facing (a
  sidestep), in `killRoute.ts`; `touch` on `glass` takes the nearest point of the pane each frame, `gap` m off it, and a
  `touch` with `slide` holds the part at the mark's height (the body projects onto the plane before the IK,
  `Humanoid.setKillTouch(..., plane)`). A chest touch on the pane was tried and dropped: the spine bends from the hips to
  reach it and her head swings through the glass, so the poses and the route put her chest there instead.
- The window frame: the partition's sill (0.35 m) and its mullions (x 7.35 and 8.65 for the middle pane) stand 0.1 m
  proud of the glass. She cannot slide west past 7.35 against the pane, so she slides to 7.68 and crumples west low,
  after stepping back. The creature stands at (8, 22.78), feet 0.65-0.9 m off the glass; she ends 0.4+ m from them.
- Tests: `src/ai/labBRun.test.ts` (one played run on the headless slice with her and the creature's imported bodies:
  the actions in order, contacts within 5 cm, nothing walked through, down the pane, room for the creature, restored in
  place), on `src/ai/labBKillTestKit.ts`. Her body is measured by hit capsules; a bone more than 3 cm inside counts as
  through. Fingers still graze the bench top in the lurch (under that), and hands clip the mullions and the sill for a
  few frames as she crumples (not covered by the spec's tests; for the §4.7 look).
- `npcKills.test.ts` now runs on Lab B's real anchors (moved so the glass is at z = 0).
- For §5: `sweep` and `tip` are in the schema and fire on time but do nothing. The cart must tip away from her path
  (to the west-north-west): she passes its east-south-east side and is still there at 3.6 s. Her hand holds the handle
  3.15-3.45 s, so the first key can pull the cart toward her then. The two knock tests in `src/physics/labB.test.ts`
  are `todo` until the tip replaces them; until then the cart stays upright while `propCartCrash` plays.
- Pre-existing, also on a clean HEAD export: `slice01Walks.test.ts` (2, `guard_return_desk`) and
  `slice01ScriptedWalks.test.ts` (7 of 56 walks). `music.test.ts` "labB: every cue ... same loudness" fails on
  `r16Build` (-23.2 dB), a score cue this change does not touch.
- §4.7 review, round 1 (user): she starts beside the middle of the bench, and the run is longer and harder, with
  coughed blood, VO, light flicker and a bass hit at each blow. Changes:
  - `labb_victim` (6.45, 0, 26.8); the bench contacts moved 0.45 m north with her (`labb_bench_edge` z 26.6,
    `labb_bench_hip` 26.58, `labb_bench_top` 26.47, `labb_bench_sweep` 26.45), `labb_push_off` (5.82, 1.03, 26.2).
  - Two poses: `kill_doubled_cough` (folded harder over the bench, mouth open, right hand up to her chest) and
    `kill_knee_cough` (on her right knee, right arm across her chest, left hand on her left knee, head down).
  - `panic` is 6.5 s (+1.9 s): jolt 0.0, hip on the bench 0.36-0.42 (sfx and bass hit 0.4), sweep 0.55, doubled 0.8,
    coughs 1.15 and 1.58 (over the bench), push off 1.93-2.3, stumble 2.15, knee down 3.15-3.3 (sfx and bass hit 3.3),
    coughs 3.65 and 3.98 (on her knee), pool 4.1, rise 4.35, cart grab 5.05-5.35, tip and bass hit 5.5, lunge 5.5, at
    the glass 6.4. Beat starts on the clock: panic 0, glass 6.5, arch 10.1, burst 12.5, still 13.1, creature 14.9 s. The
    `drop.json` waits are 7.5 (glass), 11.1 (arch), 13.5 (burst) and 14.1 (still).
  - New: `gore` kind `cough` (a tight 26-drop spray from her mouth along her heading; `GoreSystem.burst` has a `spread`
    argument), the Lab B score's `hit` stinger (two variants: a sub dropping from 55 or 49 Hz, a low tom and a dark
    thump), and `light` `dip` twice, 0.1 s apart, at each blow (the room flicker from `drop.json` goes on under it).
  - VO (§8.3 brought forward for these three): batches `react_voss_gasp`, `react_voss_grunt`, `react_voss_cough` in
    `crew_lab`'s voice (`Leda`, 3.8), one request per take (`--per-take`), as sounds `voss_gasp`, `voss_grunt`,
    `voss_cough`. Raw takes copied to `previews/vo-batches/voss-death-scene/`. §8.3 still owes nothing more for her run
    unless the review asks for other takes.
  - For §5: the grip is now 5.05-5.35 s and the tip 5.5 s; her sliding hand starts at z 26.47, across the flasks at
    (5.42, 26.52) and (5.58, 26.78), so those two are the ones the sweep throws.
- §4.7 approved by the user (2026-11-27) with the round 1 times above; no further changes.

### Section 5 (2026-11-27)

- R04: the seven things on the top of her bench are loose (`labb_bench_flask_a/b/c`, `_bottle_a/b`, `_tray`, `_beaker`),
  moved to y 0.93 (the bench's collision top) so they rest flush. The shelf above and the far bench stay fixed. The cart
  is `kinematic` (an obstacle again) with an `after` pose on its west side: rolled -90° about its long axis over its
  bottom edge 0.25 m from its origin, 8° more yaw, 4 cm further out. No walk or scripted walk enters Lab B, and the
  creature's way out (the vent) is east of it.
- The sweep throws only `labb_bench_beaker` (onto its side on the bench top) and `labb_bench_flask_b` (to the floor):
  `reach` 0.45 from `labb_bench_sweep`, `dir` [-1, 0.2], `up` 0.3 (`SWEEP_UP` in `npcKills.ts`). The tip:
  `s` 0.7, `edge` 0.25, `burst` reach 1.2, strength 0.7, up 0.35, thrown from the cart's origin along its fall. The
  `after` poses of `labb_bench` and `labb_cart_load` were recorded from a headless played kill (the scratch script
  reused `labBTestKit.ts`); `labB.test.ts` "Played kill" fails if a played kill throws anything else. Re-record them
  when the sweep, the tip or the items change.
- New: `src/ai/killTip.ts` (the track: yaw about the origin, roll about the edge, leftover slide; roll u², slide and
  yaw smoothstep, or `keys`), `BurstOptions.dir`/`out`, `KillWorld.burst` returns true when physics took it,
  `KillWorld.afterPose` / `Level.afterPose`, event fields `group`, `edge`, `keys`, and `burst` on a tip.
  `ImpactAudio.duck(id)` (`SCRIPTED_DUCK` ×0.35 for 1.5 s) is applied to sweep and tip throws only, not to the R08
  slams (non-goal). The tip's corners dip at most 1.2 cm below the floor mid-fall because of the added yaw.
- `panic` lays out `labb_bench`, `labb_cart` and `labb_cart_load` at t 0 (acts only in a restored or skipped kill).
- Browser check (private build, `jump=drop`, headless Chrome): the cart left its place 5.507-5.510 s into `panic` with
  physics and 5.508 s without, and ended in the identical pose; with physics off the swept and spilled things appear at
  0.556 s and 5.508 s. With physics on, the load creeps 0.6 mm as physics wakes and the swept beaker nudges the tray
  1.7 mm; nothing visible. No user look yet: §9.2 plays the whole drop with physics on and off.
- Tests: `src/physics/labB.test.ts` (rewritten on `src/physics/labBTestKit.ts`: at rest, her bench, seen with physics
  off, the cart on its frame at 60 and 30 fps, played kill, physics off, restored with and without physics, restart),
  `src/ai/killTip.test.ts`, the duck in `impacts.test.ts`, the schema cases in `killRun.test.ts`, and a
  `quiet.test.ts` case that hands the restored drop's own kill step to the director in the real Lab B. The two `todo`
  knock tests are gone. Walk failures are the pre-existing ones (`guard_return_desk`, 7 of 56 scripted walks).
- For §8: the cart crash `sfx` still fires at 5.5 s from her left hand, as the cart starts over; it lands at 6.2 s.
  The spec wants "one designed cart crash from the cart at the scripted moment": §8.4 may want it on the landing, and
  from the cart. The kinematic cart makes no impact sounds of its own any more, so the old `propCartCrash` from physics
  is gone; the stand-in `propCartCrash` id in the `sfx` event still plays.

### Section 6 (2026-11-27)

- D11 assumed speech acting runs during the scream. It does not: `Animator.updateSpeech` drops the line while a body
  convulses (the glass beat 0.5, the arch 0.9), so before this section her open mouth was only the poses (-32 to -45°)
  with the convulsion shaking it. The scream jaw is therefore its own channel (`Animator.screamLine`/`endScream`),
  written over the jaw after the pose, and her head, neck and arms move exactly as before.
- The switch is `screamJaw: true` on a kill style, set on `grownInside` only: R08's mauled kill has scream lines too, and
  the non-goals leave it alone. The spec's "a kill's victim" reads as a victim of a kill that asks for it.
- `src/audio/loudness.ts`: 20 ms RMS windows 5 ms apart, over the 95th percentile; attack and release are the time to
  cover 90% of a step (as time constants, a 60 ms release misses the 0.1 s breath scenario). The jaw is
  `screamJawAt` (`speechActing.ts`): envelope x 28° (`ACTING.scream.jaw`) with up to ±2° at 20 Hz above 0.7. The voice
  player measures the take it plays; `speech:started` carries it to `Humanoid.speak`.
- `react_voss_scream_04.mp3` has no breath inside it: from 0.4 to 4.6 s it stays at 0.57-1.0, so her jaw runs about
  16-28°. Headless and in a browser build it follows within 2° of the envelope, and returns to the pose when the line
  ends. The user approved this width (§6.4, 2026-11-27). If §9.2 finds it too narrow in the whole scene, widen it per
  kill (the style's flag becomes degrees).
- Tests: `src/audio/loudness.test.ts`, the D11 cases in `speechActing.test.ts`, and the passing-through cases in
  `speech.test.ts` and `speakerBodies.test.ts`.

### Section 7 (2026-11-27)

- D12's on-pane rule did not hold by itself: the pane collider is 0.25 m thick, so a ray stopping 0.35 m short still
  crosses it. The occluder now measures the source's distance to the pane's box: within 0.3 m
  (`SEALED_PANE_REACH`) is on the pane. Measured in a headless played kill: palms 0-0.18 m, her chest onto the pane
  0.05 m, the creature's blows 0.01 m; everything else from the room is 0.4 m or more and muffled.
- `blood_splat_glass` played from her chest, 0.64 m off the pane, so it is now heard from the glass (new: an `sfx`
  event's `mark: "glass"`).
- `occlude: 'sealed'` (kill, growl and sequence sounds) asks the occluder about sealed glass only: walls and props on
  the line change nothing. For world sounds and footsteps a wall still wins. A low barrier no longer hides a sealed pane
  behind it.
- The engine tapped intercoms after occlusion, so a muffled sound was relayed muffled in level. `relayGain` now carries
  the unmuffled level, for glass and walls too: R08's medical bay world sounds and footsteps come through its intercom
  at full level, even where the direct sound is muffled.
- Gore never reads `acoustic`: its clip plane comes from the kill's glass. `labBSealed.test.ts` pins that the sprays
  still clip at the pane.
- After the burst, `ventCoverRip` and both R04 duct sounds are muffled too (spec: sequence sounds). The last
  `ductScrape` plays after the intercom is off, so it is faint. Gains are untouched.
- Voices: `Level` marks the R03-R04 `visibleFrom` portal sealed from the partition's `params.acoustic`. A sealed portal
  counts in `VoicePath.closedDoors`.
- Tests: `src/ai/labBSealed.test.ts` (the real Lab B), and the sealed cases in `occlusion.test.ts`,
  `voicePath.test.ts`, `footsteps.test.ts`, `intercom.test.ts` and `glassAcoustic.test.ts`.
- The user approved the sound from the gallery (§7.5, 2026-11-27). `music.test.ts` "labB" loudness (`r16Build`) still
  fails, as recorded in section 4.

### Section 8 (2026-11-27)

- New ElevenLabs sounds (`scripts/gore-generate.ts`, ids as the sound names): `body_bench_hit`, `bench_sweep`,
  `knee_floor`, `cart_crash`, `voss_scuff` (three), and new takes of `palm_glass_hit` (three; the old ones are in git
  before this section). A manifest entry with `trim` has its opening silence cut, so each is heard as its event fires
  (all start within 5 ms). `bench_sweep` scrapes from the first frame; its loudest clatter is 0.5-1.0 s in, as the
  glass lands. `docs/audio-assets.md` states no file size limit: the new files are 12-35 KB.
- The run and glass sounds name the recording alone (no stand-in). Scuffs at 2.15 (right foot), 4.4 (left) and 5.55 s
  (right), gain 0.6. The cart crash moved to 6.2 s, where the tip lands (its start 5.5 + `s` 0.7: move it with them),
  heard from the cart (new: an `sfx` event's `prop`), gain 1.6. The `hit` stinger stays at 5.5. Gains are untuned:
  §9.2 listens to them.
- §8.3 needed no new takes: `voss_gasp`, `voss_grunt` and `voss_cough` are from §4.7. The VO tests pass and
  `vo-trace` shows no clip off its speaker's model.
- Still a stand-in, outside this section's list: `body_glass_hit` in `still` (her chest onto the pane) was never
  generated, so `glassThud` plays (`npm run gore:generate -- --id body_glass_hit`).
- Tests: `npcKills.test.ts` "Designed sounds and her voice", `labB.test.ts` "The cart goes over" (physics on and off),
  the `prop` cases in `killRun.test.ts`.
- §6 and §7 were being edited in the same checkout during this section (`kills.json`, `types/kills.ts`, `npcKills.ts`
  and `killRun.test.ts` or `npcKills.test.ts` may hold both): commit by hunk.

### Section 9 (2026-11-27)

- Four headless runs of a private build (`jump=drop`, squad close and far, physics on and off), timed by a temporary
  debug handle on `KillDirector.running` (not kept): every beat and line started at the same `clockT` in all four:
  panic 0 ("She's seizing" 0.15), glass 6.5 (scream 6.5), arch 10.1, Heins 11.75, burst 12.5, still 13.1, Okafor
  13.48, Giles 14.87, creature 14.9.
- "Far" changes nothing in the game: `squadCatchUpIn` puts both squadmates at the gallery door as the drop starts, so
  Okafor's question always comes about 5 s in. A late question (12 s) is covered by `quiet.test.ts` only.
- From the review (user): the drop could not start until `rounds_return` had played the PA call and Giles's radio line
  (about 8-10 s), because `rounds_done` was set after them; walking in sooner did nothing. `rounds_return` now sets
  `rounds_done`, the objective and `drop:approach` first, and the drop stops `rounds_return` (cutting those lines) if
  Jay walks in during them.
- From the review (user): after the lights come back, Heins walks to the glass (`heins_glass` in `R03.json`, 9.2, 21.2,
  off the middle so the open grate stays in view) before her turn to the vent and `drop_heins_04`. Nothing in git or the
  specs had a walk before; only the turn. `cp_drop` does not place her: she is back at `brief_heins` after a load.
- 9.3: 53 of 62 scenarios are tested as written. Partial: "Okafor waits for her plea" (her breathing),
  "Planted foot" and "Footsteps heard" (a test route, not her run), "Voss behind the sealed glass" and "Lab B through
  the intercom" (from the intercom: listening checks), and three older ones: "The medical bay window" (world sounds),
  "Getting up from the floor" (feet where she lay), "Next room, door open" (direction).
- 9.4: `npm test` 2540 of 2556; the 16 failures are the same on a clean export of 8de58f3: `mocapSources`,
  `castMotionCoverage` (2), `heldGrip`, `mocapPhysics`, `motionProfiles`, `dockGuardRoutine`, `music` (r16Build),
  `gather` (2), `credits`, `slice01Gallery`, `slice01ScriptedWalks`, `slice01Walks` (2), `wallClearance`.
  `npm run build` passes.
- The user approved the drop and accepted the 9.3 partial list (2026-11-27).
