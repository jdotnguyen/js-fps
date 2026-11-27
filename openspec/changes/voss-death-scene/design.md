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
| panic | 4.6 s | 0.0 jolt from inside; 0.4 hip hits the bench; 0.55 sweep; 0.9-1.5 doubled over; 1.5 push off; 1.6-2.4 stumble; 2.4 knee down; 2.8 recover; 3.3 grab the cart; 3.6 cart goes over; 4.0-4.6 to the glass |
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
