# Tasks

Each numbered group is one isolated block (design D1): one commit or PR, its switch off by default, and it ends with a gate. Do not start a group until the previous group's gate is checked.

## 1. Block 0: Engine trial (sandbox only)

- [x] 1.1 Install `@dimforge/rapier3d-compat`, and check that it initialises in the browser and under `node --experimental-strip-types` with a one-line init script (2026-11-21: rapier 0.21.0 inits in about 32 ms under Node, and in the browser via the sandbox panel)
- [x] 1.2 Define the engine interface in `src/physics/engine.ts` (bodies, colliders, joints, motor targets, step, transforms, contact events, raycast, destroy) and verify it type-checks with `npm run typecheck`
- [x] 1.3 Write `src/physics/rapierAdapter.ts` against it, and verify it passes an adapter test (a dropped box lands on a fixed box, a destroyed world reports zero live objects)
- [x] 1.4 Add a physics trial panel to `actorsSandbox` with three cases (limb thrown at a wall, death ragdoll on stairs, pose-driven ragdoll taking a shoulder hit), and verify all three run in the browser
- [x] 1.5 Measure step time (6 ragdolls + 24 debris) on the target desktop PC and the gzipped chunk size, and record them in design.md "Measurements" (B0) (B0 row recorded; pane was hidden, re-measure visibly at the B1 gate)
- [x] 1.6 Check Rapier against the D2 pass bars and write "Block 0 result" in design.md
- [ ] 1.7 Only if Rapier fails the motor pose-matching bar: install `jolt-physics`, write `src/physics/joltAdapter.ts` passing the same adapter test, build the pose-driven case in it, compare, then keep one engine and delete the other's adapter and dependency; verify `npm run build` and the adapter test pass. Otherwise mark this task skipped in the Block 0 result
- [ ] 1.8 Gate: review the Block 0 result with the author and get sign-off on the engine choice before group 2

## 2. Block 1: Physics world (no visible change)

- [ ] 2.1 Add `physics` switches to `core/settings.ts` and the `?physics=` URL override (design D9), and verify with settings unit tests (defaults off, URL parsing, persistence)
- [ ] 2.2 Add `src/physics/load.ts`, which lazy-imports the engine when a level loads and any switch is on, plus `available()`; give the engine its own chunk in `vite.config.ts`. Verify with a build check that the title-screen chunks contain no engine code, and that all switches off never fetches it (`physics-world`: Physics loads on demand)
- [ ] 2.3 Add `src/physics/world.ts` (`PhysicsWorld`), stepped inside the fixed-step loop and skipped while paused; verify with a Node test that pausing freezes bodies and 30/60 fps runs give the same fall time (`physics-world`: Fixed simulation step)
- [ ] 2.4 Mirror `CollisionWorld` colliders as fixed cuboids and hook door toggles from `level.ts`; verify with `src/physics/mirror.test.ts` on a small test room (counts and bounds match, a body is blocked by a closed door and passes an open one, a body in a closing door is pushed out)
- [ ] 2.5 Destroy and rebuild `PhysicsWorld` on level and checkpoint loads; verify with a test that five restarts leave zero leaked bodies, colliders or joints
- [ ] 2.6 Add the `?debug` physics collider view with active/asleep/frozen colouring, and verify it visually in the browser on `slice01`
- [ ] 2.7 Document the physics module, switches and debug view in `docs/physics.md`, and link it from AGENTS.md and README.md "Debug flags"
- [ ] 2.8 Gate: `npm test` passes with physics off; the slice plays unchanged with every switch on; B1 measurements recorded in design.md

## 3. Block 2: Severed debris

- [ ] 3.1 Move today's debris code unchanged behind a debris backend interface in `GoreSystem` (`floorDebris`), and verify that existing gore tests and a sandbox sever look identical
- [ ] 3.2 Add `physicsDebris`: capsule from the probes and radius, CCD, mass from length, 6 s static cutoff (design D5); verify with Node tests in a test room (shotgun-speed limb stays on the room's side of the wall, a leg dropped on a bench rests on top, a leg on a ramp slides down, every piece asleep within 6 s)
- [ ] 3.3 Send first-contact point and normal to pools and splats with `GoreClip` checks; verify with a test that a head hitting a wall makes a wall splat, and in the browser on the Lab B glass
- [ ] 3.4 Keep the 24-piece cap and oldest-fades behaviour, and keep reduced mode creating no bodies; verify with unit tests for both (`severed-debris`: Debris budget, Reduced gore)
- [ ] 3.5 Tune density and friction per collider surface in the sandbox, and record the values in `docs/physics.md`
- [ ] 3.6 Gate: playtest a shotgun fight in `slice01` with debris on (`docs/PLAYTEST.md`); run the `runtime-memory` enemy-churn probe; record B2 measurements; switch the debris default on

## 4. Block 3: Death ragdolls (start after `per-character-motion` is archived, design D1)

- [ ] 4.1 Build `src/physics/ragdoll.ts`: about 11 bodies from `skeleton.ts` joints with anatomical limits, skipping severed subtrees; verify with a Node test that a legless body's ragdoll has no leg bodies and no joint goes past its limit after a 2 m drop
- [ ] 4.2 Hand off in `Humanoid.die` when `available()` and the budget allow, carrying velocity and the hit impulse; keep authored corpse poses otherwise; verify in the sandbox (chest shot on stairs, kill beside a bench) and with a fallback test that switch off still picks an authored pose
- [ ] 4.3 Sever during a ragdoll: remove the joint and pass the part to `addDebris`; verify with a test that shooting a corpse's arm makes one debris piece and the ragdoll loses one body
- [ ] 4.4 Freeze at rest within 8 s into a static animator pose, cap active ragdolls at 6 (oldest freezes early), rebuild on touch; verify with a test that killing 8 within 1 s never has more than 6 active and all end frozen, and that a resting body moves under 1 mm/s
- [ ] 4.5 Keep authored kills and sequence corpse poses unragdolled unless their data opts in; verify with `script` tests that the Voss kill and `corpse`-role bodies never create ragdoll bodies
- [ ] 4.6 Check every kill in `data/kills.json` against the `infection-kills` spec and the `ragdoll` spec's "Authored kills stay authored" (design D12); verify with the 4.5 tests covering each kill style
- [ ] 4.7 Gate: playtest a wave fight with ragdolls on; checkpoint-restart leak test and enemy-churn probe pass; record B3 measurements; switch the ragdoll default on

## 5. Block 4: Powered ragdolls and play-dead blending (after `per-character-motion`; builds on hand physics, design D13)

- [ ] 5.1 Add per-body `physicsWeight` and joint motors tracking animator local rotations (design D7); verify in the sandbox that weight 0 matches pure animation within 1 cm per bone
- [ ] 5.2 Add hit reactions: per-region weight spike, physical push, return to pose within 0.6 s; verify with a test that a shoulder hit displaces the upper body and every bone is back within 2 cm of the animated pose by 0.6 s
- [ ] 5.3 Add a death fade (motor strength down over 0.3 to 0.8 s) before full ragdoll; verify with a test of the strength curve and in the sandbox
- [ ] 5.4 Make play-dead a frozen ragdoll, and blend `getUp` from the frozen pose; verify with a test that no bone moves more than 5 cm between frames during the blend
- [ ] 5.5 Document weights, motor tuning and blending in `docs/physics.md`
- [ ] 5.6 Gate: playtest play-dead ambushes and hit reactions; record B4 measurements (step-time budget still met with 6 powered bodies); switch the powered default on

## 6. Block 5: Physical interaction

- [ ] 6.1 Add a kinematic player capsule that pushes dynamic bodies with no feedback into the motor; verify with a test that walking over a severed arm moves the arm and leaves player speed and height unchanged
- [ ] 6.2 Add the player stomp action (input binding, view and leg animation, `damage.ts` stomp damage, sever threshold, sound through the `audio-assets` pipeline with a `CREDITS.md` row if needed); verify with a test that enough stomps sever a corpse arm, and in the browser
- [ ] 6.3 Add opt-in `dynamic: { mass }` prop data; make the stand-in box the dynamic collider and remove its static mirror; verify with a test that an unmarked cabinet never moves
- [ ] 6.4 Opt in the placed trolley and gas cylinder (imported props), and verify the walk tests pass with each pushed into its worst doorway
- [ ] 6.5 Opt in the Lab B bench props (`lab_bench` and what sits on it) and have Voss knock them over as she staggers to the glass in the `panic` beat of the `grownInside` kill (a `kill` beat event that applies an impulse to dynamic props within reach); verify with a test that a played kill moves the bench props and a restored (`instant`) kill does not, and by screenshot from the gallery
- [ ] 6.6 Document interaction, stomp and dynamic props in `docs/physics.md` and the README input table
- [ ] 6.7 Gate: full slice playthrough with every switch on; record B5 measurements; switch the interact default on

## 7. Integration check

- [ ] 7.1 Run `npm test`, `npm run build` and a full `docs/PLAYTEST.md` pass with all physics switches on, then again with `?physics=off`, and verify both runs play the slice to the end with no errors
- [ ] 7.2 Run the `runtime-memory` procedure on the heaviest scene and confirm heap and GPU figures are within 15% of the pre-change baseline, or record the reason in design.md

## Workflow follow-up

- Archive the change after every block's gate is signed off.
- Verify the archived specs (`physics-world`, `severed-debris`, `ragdoll`, `physical-interaction`) appear under `openspec/specs/`.
