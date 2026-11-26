# Physics

Rigid-body physics for severed limbs and pushable things. The plan is the
`adopt-physics-engine` OpenSpec change (specs [`physics-world`](../openspec/specs/physics-world/spec.md), [`severed-debris`](../openspec/specs/severed-debris/spec.md) and [`physical-interaction`](../openspec/specs/physical-interaction/spec.md)), delivered in blocks that each
ship behind their own switch. The behaviour is specified in its `physics-world`, `severed-debris` and
`physical-interaction` specs. Ragdolls are planned separately and parked, in
[`add-physics-ragdolls`](../openspec/changes/add-physics-ragdolls/).

## Engine

[Rapier](https://rapier.rs) (`@dimforge/rapier3d-compat`), chosen in Block 0. See "Block 0 result" in the change's
`design.md` for the trial, its scores, and why powered ragdolls use world-space pose driving rather than joint
motors.

The `-compat` package embeds Rapier's WebAssembly as base64 text, which makes the lazy `physics` chunk about 4.3 MB.
Rapier's bundler package (`@dimforge/rapier3d`) would ship a real `.wasm` file, but Node cannot load it (it lacks
`"type": "module"` and uses extensionless imports), and the tests must run the build the game ships. So the game
stays on `-compat`, and the build allows the `physics` chunk up to 4,500 kB instead of the general 1,500 kB
(`vite.config.ts`, `trim-startup-bundle` design D3). Switch when Rapier publishes a package that both Node and Vite
can load as is.

Gameplay code never imports Rapier. It talks to `src/physics/engine.ts`, a small engine-agnostic interface;
`src/physics/rapierAdapter.ts` is its only implementation and the only file that imports the engine. A few Rapier
details the adapter handles:

- Ball-joint angle limits and all joint motors go through Rapier's raw joint set: its typed wrapper only limits
  single-axis joints.
- Releasing a motor needs a zero force cap; zero stiffness and damping alone still drag the joint.
- Queries (raycasts, overlaps) see colliders as of the last step. Create or move colliders, then step, then query.

## Switches

Each feature has its own switch, stored in the settings: `debris`, `ragdoll`, `powered`, `interact`. `debris` and
`interact` are on by default (`PHYSICS_DEFAULT`); `ragdoll` and `powered` are off and do nothing until ragdolls are
built. They were switched on by the author without the planned playtest, step-time and memory measurements, so measure
before relying on the budgets below. A settings save records `PHYSICS_REVISION`; switches saved without it (while
everything defaulted off) are ignored. A URL flag overrides the switches for one session:

| URL | Effect |
| --- | --- |
| `?physics=off` | Every feature off. The engine is never downloaded. |
| `?physics` | Every feature on. |
| `?physics=debris,interact` | Exactly those features on. Unknown names log one warning. |

With every switch off the game behaves exactly as before. With a feature on, its fallback still applies until
the engine has loaded, and for good if the engine fails to load (one `[physics]` warning).

## How it runs

- **Loading.** `src/physics/load.ts` imports the engine when a level loads and any switch is on. It is its own
  bundle chunk (`physics`, about 1.66 MB gzipped), never part of the title screen. Nothing waits for it.
- **World.** `src/physics/world.ts` (`PhysicsWorld`) mirrors the level's player collision (`CollisionWorld`) as
  fixed boxes, so bodies hit exactly what the player hits. Every step it follows each box's `enabled` flag, so
  doors open and close for physics too. A door that closes on a body first moves the body out sideways.
- **Stepping.** One step per fixed simulation step, at the start of the in-play update, so a pause freezes physics
  and frame rate does not change how things fall.
- **Restarts.** New game, loads and death restarts rebuild the world empty, so nothing survives from the last
  attempt and nothing leaks.

## Severed debris (`debris`)

`GoreSystem` owns severed pieces, the 24-piece cap and the fade-out. How a live piece moves is up to a **debris
backend** (`src/actors/debrisBackend.ts`):

- `floorDebris` is the original ballistic model: gravity, spin, a bounce off the floor height, no walls. It runs
  with the switch off, before the engine has loaded, and in reduced gore.
- `physicsDebris` (`src/physics/debris.ts`) makes each piece a rigid body. Once the physics world exists, `main.ts`
  hands it to the gore system with `setDebrisBackend`. Pieces already in the air keep the model they started with.

A physics piece is a capsule from its first probe to its last, using the piece's radius (a ball for one probe, such
as a head). CCD is on, so a shotgun-speed limb can't pass through a wall. Its first contact with anything other
than another piece leaves a mark where it actually struck, placed by a raycast along its path:

- a pool on a floor or prop top;
- a splat on a wall. Splats have their own 12-mark ring, separate from the glass marks, so a fight never erases
  the blood from a scripted kill.

Marks respect the gore clip planes. Pieces sleep when the engine says they're at rest, and at 6 s they're made
static whatever their state: they cost nothing after that, and new pieces still land on them. A restart drops
the bodies and leaves the pieces lying where they were.

| Value | Setting | Where |
| --- | --- | --- |
| Mass | 7 kg per metre of length, at least 1 kg | `LINEAR_DENSITY` |
| Debris friction / restitution | 0.7 / 0.15 | `DEBRIS_FRICTION`, `DEBRIS_RESTITUTION` |
| Damping (linear / angular) | 0.05 / 0.6 | `debris.ts` |
| Level friction | concrete 0.8, metal 0.45, grate 0.95, rubber 1, water 0.2, glass 0.25 | `SURFACE_FRICTION` in `world.ts` |
| Smallest impact that leaves a mark | 1.5 m/s | `IMPACT_MARK_SPEED` in `gore.ts` |

Rapier averages the two colliders' friction, so a limb grips concrete, skids on bare metal and slides on glass.

## Physical interaction (`interact`)

**Pushing.** `PlayerPusher` (`src/physics/interaction.ts`) is an invisible kinematic capsule that follows the
player's feet: 1.7 m tall, 0.12 m wider than the player's own collision. It shoves dynamic bodies aside, and
nothing comes back from it, so a limb underfoot never slows, blocks or lifts the player. Because it is wider than
the player's collision, it reaches a physics prop first, and the player pushes the prop rather than stopping at it.
Pieces locked in place after 6 s wake up for another 2 s when the player comes within about 1 m of them.

**Stomp (C).** The player lifts a boot and brings it down 0.55 m ahead (`src/actors/stomp.ts`). The view rises a
little, then dips with the boot. A stomp:

- hits the nearest head, arm or leg part on the floor within 0.45 m of where the boot lands;
- deals 9 damage. A corpse's part still loses HP and comes off as severed debris at zero
  (`BodyDamage.applyToCorpse`), so a shambler's arm, leg or head takes two stomps. A living body takes an
  ordinary hit;
- shoves loose bodies under the boot;
- plays an existing boot thud (`footConcrete`) and, on flesh, `kill_crunch`. No new audio asset, so no new
  `CREDITS.md` row.

Corpses themselves are not physics bodies until ragdolls are built, so a stomp doesn't move the corpse.
With the switch off, C does nothing.

**Physics props.** A level prop marked `"dynamic": { "mass": 40 }` becomes one rigid body built from its own
collision boxes (`PhysicsProps`). Unmarked props never move. The body's pose is written back every step through
`Level.setPropPose`, which moves the prop's meshes and its player-collision boxes together, so the player and
enemies collide with it where it is now. The static physics copy of those boxes is left out
(`PhysicsWorld.exclude`). A dynamic prop isn't merged into its room's mesh, so it costs its own draw calls; mark
only a few. Restarts put props back where the level placed them. With the switch off, a marked prop stays
static like any other.

**Loose props.** Small dressing is marked `"dynamic": { "mass": 0.4, "loose": true }`. Its boxes shape the rigid
body but never enter `CollisionWorld`, so the player, enemies and the navmesh pass it standing or fallen: a flask on
the floor never snags a scripted walk. It still lands on the level mirror and other bodies, and has CCD so a thrown
one can't pass through glass. With the switch off it just stands there. Because nothing stops a body walking through
it, place a loose prop beside a walk, not across it.

- Each loose prop costs about two draw calls plus its shadow, so keep a room to around ten. Build its mesh with one
  part per material (`addMerged` in `kit/labWing.ts`).
- Place it flush on its support. `src/physics/labB.test.ts` checks that nothing in Lab B moves on its own.
- Dressing that nothing can reach doesn't need a body: `lab_item` takes `"fixed": true` and merges into the room.

**Knocks.** A kill beat's `{ "t": 0, "do": "knock", "reach": 0.9, "strength": 1 }` event (`data/kills.json`) makes
the victim knock over loose props for the rest of that beat: each one that comes within `reach` m of them over the
floor is hit once, out to its side of their path and a little ahead and up, high enough to topple it
(`KNOCK` in `interaction.ts`; strength 1 is about 1.6 m/s). Skipped and restored kills knock nothing, and neither
does a session without the switch. A restart stands everything up again; so does loading a save made after the kill.

Lab B uses both: a loaded `prep_cart` stands beside Dr. Voss's walk to the glass, and she takes it over in the
`panic` beat. Its two benches carry fixed `lab_item` dressing (`lab_bench` with `"clutter": 0`).

**Impact sounds.** A dynamic prop with `"sound": "cart" | "glass" | "metal" | "thud"` is heard when it hits something;
without one it is silent. `PhysicsProps` reports any step in which such a prop's velocity changes by more than
`IMPACT_NOISE`, gravity apart, and `physicsDebris` reports each severed piece's first impact (a wet thud, with the
`debris` switch). `ImpactAudio` (`src/audio/impacts.ts`) turns a report into a sound: nothing below 0.5 m/s, louder
with speed, a separate recording for a cart crash (2.2 m/s and up) and a hard glass drop, a short rest per object, six
voices at most, silent past 16 m. Clips are built by `npm run impacts:generate` from the CC0 downloads in
`../audio-src/physics/`.

## Debug view

With `?debug`, the lil-gui panel has a **Physics** folder: tick **show colliders** to draw them over the scene.

| Colour | Meaning |
| --- | --- |
| Grey | Level collision (open doors are hidden) |
| Green | Active body |
| Blue | Body asleep |
| Amber | Frozen body (a settled corpse made static) |
| Violet | Kinematic body (follows animation) |

The folder also shows the engine version and the step time (average and peak over the last 2 s), to compare with
the budget of 1.5 ms average and 3 ms peak at High on the target desktop PC.

## Sandbox trial

`/sandbox/actors.html?physics` runs the Block 0 trial in the actors sandbox: **J** throws a severed limb at a wall,
**K** shoots a shambler on the stairs, **L** spawns a powered shambler (again to shove it), **B** runs the timing
bench (6 ragdolls and 24 limbs), **X** clears. It uses the procedural body only.

## Tests

`src/physics/*.test.ts` run Rapier headlessly in Node: the adapter, the trial ragdoll cases, switches, loading,
the collider mirror (walls, doors, a door closing on a body), the fixed step, and leak-free restarts.
