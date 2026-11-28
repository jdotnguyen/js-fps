# Design

## Context

See `proposal.md` for why. The requirements are in `specs/medbay-attack` and `specs/physical-interaction`.

Current state of the R08 slam:

- **Kill data.** The `mauled` kill's `slam` beat (`src/data/kills.json`) runs until three impacts, from three `slam`
  events at 0.5, 1.6 and 2.6 s. Each one winds the creature up for `MAUL.windup` (0.32 s), strikes for 0.1 s, and then
  `KillDirector.impact()` (`src/ai/npcKills.ts`) lands it. A landing kicks her head, adds a spurt and a pool on the cart
  top, plays a rotating head crunch, `cart_impact` (a downloaded door slam) and `cart_glass_break`, and emits
  `kill:impact`. The medbay score ducks on that event. Her lines come from the beat's `lines`, one per impact.
- **The cart.** The `instrument_cart` kit (`src/world/kit/slice.ts`) builds the cart and its instruments as one static
  piece with one solid collision box, 0.925 m tall. The drawn tray surface is at 0.9 m, so anything resting on that
  box floats 25 mm above it, and the shelf items sit inside it.
- **Physics.** `PhysicsProps` (`src/physics/interaction.ts`) turns props marked `"dynamic"` into rigid bodies. A
  `"loose"` prop has no `CollisionWorld` boxes, so it never blocks a walk. A kill's `knock` event sweeps loose props
  aside from a moving victim. The `adopt-physics-engine` work in progress (design D16, uncommitted) adds
  `src/audio/impacts.ts`: each loose prop names a `sound` material (`cart`, `glass`, `metal`, `thud`), and
  `PhysicsProps` reports impacts that `ImpactAudio` voices, with a speed floor, louder hits for faster landings, a
  six-voice cap and a per-object rest.
- **Physics defaults.** Every switch is off by default (`PHYSICS_OFF` in `src/core/settings.ts`). `mergeSettings`
  starts the physics switches from `PHYSICS_OFF`, not from `DEFAULT_SETTINGS`, and `SettingsStore.set` saves the
  whole settings object. So anyone who has changed any setting has `interact: false` stored.
- **View jolt.** The sequences' `cameraShake` step only shudders water (`camera:shake` reaches `WaterDisturbances`,
  nothing else). The only view jolt on the player is `Player.addKick`, a damped spring used by weapon fire and damage,
  which reduced motion already scales down.
- **Sound routing.** A positional one-shot that starts in R08 is carried by the live medbay intercom (`AudioEngine`),
  so new sounds played at the cart or where things land reach the security office without extra wiring.

## Goals / Non-Goals

**Goals:**
- The slam reads as one violent physical event: things leave the cart, hit the floor and the glass, and are heard.
- Data-driven like the rest of the kill: strengths, reach and timing live in `kills.json` and the level file.
- The same end state whether the scene played live, was skipped, or was restored, with physics on or off.

**Non-Goals:**
- Simulating the cart. Its motion is scripted (D3).
- Physics for Priya's or the creature's body, or the creature's arm. The instruments do not collide with either.
- A camera shake system. This change uses the existing kick spring.
- Light flicker on the hits.
- Turning physics on by default. That is `adopt-physics-engine` task 6.7 (D10).

## Decisions

### D1. The instruments become separate loose props

The `instrument_cart` kit keeps the frame, tray, lips, shelf, casters and handle, and drops its instruments. Each
instrument becomes its own prop in `slice01.json`, marked `"dynamic": { "mass": ..., "loose": true, "sound": ... }`,
built by a new `cart_item` kit next to `lab_item` (`src/world/kit/labWing.ts`), with one merged part per material
(`addMerged`).

| Item | Where | Mass (kg) | Sound |
| --- | --- | --- | --- |
| Kidney dish | top | 0.25 | `dish` (D7) |
| Two steel tools (forceps, scissors) | top | 0.06 each | `metal` |
| Wrapped instrument pack | top | 0.3 | `thud` |
| Two glass vials | top | 0.04 each | `glass` |
| Small steel bowl | top | 0.2 | `metal` |
| Box | shelf | 0.4 | `thud` |
| Basin | shelf | 0.6 | `metal` |

That is nine bodies, inside the guide of about ten loose props per room (`docs/physics.md`). The four thin tools the
kit draws now become two: four 6 g bodies cost draw calls and a shadow each for detail nobody sees from the glass.

*Alternative:* keep the kit and give it child bodies. Rejected: `PhysicsProps` works per level prop, and level props
already handle placement, restarts and saves.

### D2. The cart's collision matches what is drawn

The cart's single solid box is replaced by boxes for the tray (top face at exactly 0.9 m), its four lips, the shelf
(top face at 0.29 m) and the four posts. The space between the shelf and the tray stays open at the sides, so the
third hit can throw the shelf items out between the posts. Items are placed flush on these faces. A Node test loads
R08 with physics and checks that nothing moves on its own, like `src/physics/labB.test.ts` does for Lab B.

### D3. The cart is a kinematic body with a scripted jolt

The cart's motion is authored, not simulated: her head must land on its top on every hit, and a simulated cart
could be pushed out from under her. The cart becomes a new kind of physics prop, `"dynamic": { "kinematic": true }`.
`PhysicsProps` builds it as a kinematic body. The kill moves it, and both the level (`Level.setPropPose`: meshes and
`CollisionWorld` boxes) and the body follow. A kinematic body pushes the loose items properly and carries what rests
on it.

Each impact starts a short authored jolt in `kills.json`: a rock about the far casters (a few degrees, back within
about 0.3 s), plus a lasting slide away from the creature and a small yaw. The lasting parts add up to the final
skewed pose: about 8 cm and 5 degrees in total, well inside the spec's 0.25 m. The slam target (`r08_cart_top`) moves
with the cart, so her head follows the top. With physics off, the same jolt moves the meshes and collision through
`Level.setPropPose` alone.

*Alternative:* move only the cart's meshes. Rejected: its collision would stay behind, so items would float or sink
by the slide distance.

### D4. `burst`: an impact throws the loose props near it

Each `slam` event gains an optional `burst`: `{ "reach": 0.5, "strength": 0.6, "up": 0.8 }`. When that slam lands,
`PhysicsProps.burst(at, reach, strength, up, toward)` gives every loose prop whose centre is within `reach` (in 3D) of
the impact one impulse:

- outward from the impact, flattened, then weighted along the cart's long axis, so most of the load goes sideways;
- with a share toward `toward` (the centre pane), so some reach the glass (`BURST.toward` 0.8: at 0.35 nothing came
  within 0.87 m of the pane in the headless run);
- with `up` as the vertical share;
- applied above the prop's centre, with a small spin from an RNG seeded by the prop's id, so things tumble.

The speed is the prop's mass times `BURST.speed` times `strength` (about 2.5 m/s at strength 1; tuned in the
browser). The escalation lives in the data:

| Hit | reach | strength | Intent |
| --- | --- | --- | --- |
| 1 | 0.35 | 0.5, mostly up | small items jump, some land back |
| 2 | 0.6 | 1.3 | most of the top is swept off |
| 3 | 0.9 (reaches the shelf) | 1.8 | the rest, and the shelf load |

A skipped or restored kill bursts nothing. *Alternative:* reuse `knock`. Rejected: `knock` sweeps sideways off a
walker's path, while a slam throws from one point, upward.

### D5. Uneven rhythm, with a longer wind-up before the last hit

The slam events move to about 0.5, 1.35 and 2.85 s, and each `slam` event may set its own `windup` (the third gets
about 0.7 s, against the 0.32 s default). Impact times then land at about 0.92, 1.77 and 3.65 s: gaps of 0.85 s and
1.88 s. The lines stay one per impact. Her scream on the first impact (`sec_priya_02`, 1.72 s) runs past the second
impact, which is the intent. The browser check confirms her line timing and the lines' cut-offs.

### D6. Impact sounds: three steel impacts and a rattle, no glass

`impact()` stops playing `cart_glass_break` and `cart_impact`. Each hit now layers:

1. the existing head crunch rotation (unchanged);
2. `cartSlam`, three variants, played as variant `(n - 1) % 3`, so no two in a row match;
3. `cartRattle`, three variants: instruments jumping on the tray.

`KillWorld.sfx` gains an optional variant argument for this. The new files come through `docs/audio-assets.md`: CC0
or CC BY recordings first (a heavy steel tray or trolley hit, an instrument rattle), ElevenLabs through
`gore-generate.ts` if none fits. Each is loudness-matched to the crunches and checked through the intercom. The
existing `cart_impact` door slam may become one of the three `cartSlam` variants if it fits by ear. If not, it is
deleted with its `CREDITS.md` row.

*As built:* both banks are CC0 mixes built by `npm run impacts:generate` (`layers` in its manifest): each slam is a
Kenney heavy plate hit, a heavy metal hit and a soft or punch thump, with a ringing tail cut from the Freesound
metal crash (the third has its full crash); each rattle is four or five Kenney light metal, tin and glass taps 40-300
ms apart. The door slam was not kept: it read as a door, not steel, so `cart_impact` was deleted with its row. `cart-glass-break.mp3`, its `SAMPLE_URLS` entry, its `CREDITS.md` row and the
comment in `gore-generate.ts` are removed. `npm run audio:audit` must pass.

### D7. Landing sounds reuse `ImpactAudio`; the dish gets its own material

The instruments use the impact voicings D16 is adding: `metal`, `glass` and `thud`. One new material, `dish`, is
added to `PROP_SOUNDS` and `VOICINGS`. Its soft hit is the `metal` clink, and its hard hit (from about 1.5 m/s) is a
spin-down recording (`propDishSpin`, 2.6 s, a steel dish wobbling to rest; ElevenLabs, with a Kenney clang mixed in front
so the landing is heard), with a rest of about 3 s so its bounces do
not cut it off. The spin-down then comes from the dish's own landing, so it is heard wherever and whenever the dish
actually lands. Six voices is enough for nine items, because `ImpactAudio` keeps the hard hits. If testing shows
clinks dropping out during the second hit, the cap is raised for this room only.

### D8. View jolt through `Player.addKick`

Session code listens to `kill:impact`. When the player is in R07, it calls `player.addKick(-(0.5 + 0.25 * n))`, a dip
of the view, scaled down by reduced motion like any kick. It never moves the player or takes control. The kill
emits the impact either way, so this stays out of `KillDirector`.

*Alternative:* make `camera:shake` move the view. Rejected for this change: every existing `cameraShake` step in the
sequences would start moving the view too, which needs its own review.

### D9. Her landing clears space

The `throw` beat gains `{ "t": 0, "do": "knock", "reach": 0.55, "strength": 1 }`. The existing sweep knocks aside
the loose items she comes near as she flies to the pane and slides down. The `still` beat's corpse pose spreads her
from a root 0.6 m off the glass, so the browser check confirms no item shows through her. If one does, a second
`knock` with a larger reach goes at the start of `still`.

### D10. Physics on by default is a prerequisite, with saved settings fixed

This change needs `interact` on for players on default settings, which `adopt-physics-engine` task 6.7 does. That
task must also:

- start the physics switches from the default, not from `PHYSICS_OFF`, in `mergeSettings`;
- stop a saved `false` from overriding the new default when the player never chose it: store only the switches that
  differ from the defaults, and ignore the physics switches in settings saved before the change (a settings version
  field).

Task 1.1 here checks both before the scene work counts as done. If 6.7 is still open, the settings part may be done
in this change and recorded there.

### D11. Skip and restore lay the props out

A new kill event, `layout`, applies only when the kill is instant (skipped or restored): `{ "t": 0, "do": "layout",
"prop": "r08_cart" }` in the slam beat (`prop` names the group). Each prop in that group carries an `"after": { "pos": [...], "rot": [...] }`
pose in `slice01.json`. The event puts each prop at its `after` pose through `Level.setPropPose`, and with physics on
also through `PhysicsProps.place` (set the transform, zero its velocities, put it to sleep). Placing reports no
impact, so a restored kill stays silent, as `adopt-physics-engine`'s impact-sound requirement asks. The cart's `after` pose is
the end of its authored jolt. Restarting from a checkpoint before the attack puts props back where they were placed,
as now.

The `after` poses are recorded from a headless run of the three bursts (a script or a test helper that prints the
rest poses), then checked by hand. None may lie under Priya's resting spot (`priya_rest`) or past the pane.

### D12. Stage rules exempt loose props

`src/world/slice01.test.ts` already skips the `instrument_cart` kit for the "only the cart near the pane" and "clear
lane" checks. Those checks now skip every loose prop instead, since loose props have no `CollisionWorld` boxes and
never block a walk.

## Risks / Trade-offs

- [Pools on the cart top stay behind when the cart slides.] The blood pools from the first two hits are world-space
  decals. → Keep the total slide small (D3). If the offset shows, attach cart-top pools to the cart's own group,
  moving relative to that group (the level attaches dynamic parts with their world transform kept).
- [Items clip through Priya or the creature, which have no physics bodies.] → Bursts point away from the creature
  (D4), D9 clears her landing spot, and the browser check covers the slam from the viewing strip.
- [A thin tool or vial tunnels through the tray, or jitters at rest.] → Loose props already have CCD. Tools get
  collision boxes at least 1 cm thick, and the at-rest test (D2) catches jitter.
- [Physics results differ between runs, so a fixed test layout is brittle.] → Tests assert outcomes (counts on the
  floor, none past the pane, at least one at the glass), not positions. The skip layout is authored, not simulated.
- [Physics off: a live run leaves the instruments on the cart, but a later restore shows them scattered.] → Accepted:
  physics is on by default (D10), and the restored layout is the story's end state.
- [Shared files.] `npcKills.ts`, `interaction.ts`, `kills.json`, `sounds.ts`, `level.ts` and `impacts.ts` carry
  uncommitted `adopt-physics-engine` work. → Start implementation once that work is committed, and build on it rather
  than around it.
- [Memory.] The R08 physics test loads a level (400 MB-1.1 GB). → Run it alone while iterating, per `AGENTS.md`.

## Migration Plan

Nothing to migrate besides the settings fix in D10. Rollback is reverting the change. The `cart_impact` and
`cart_glass_break` files are deleted only once their replacements are in, so the scene never plays without impact
sounds.

## Open Questions

- Whether the two vials survive the budget, or the steel bowl replaces them. This is decided by eye in the browser
  and changes only data.
- The exact burst strengths, jolt sizes and slam times. Tuned in the browser within the shapes above.
