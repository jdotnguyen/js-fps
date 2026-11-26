# Tasks

Parked until `adopt-physics-engine` is archived. Do not start a group until the previous group's gate is checked.

## 1. Death ragdolls

- [ ] 1.1 Build `src/physics/ragdoll.ts`: 14 bodies from `skeleton.ts` joints with anatomical limits, skipping severed subtrees; verify with a Node test that a legless body's ragdoll has no leg bodies and no joint goes past its limit after a 2 m drop
- [ ] 1.2 Take joint frames from the rest pose of imported bodies; verify one imported body dies cleanly in the sandbox before going further
- [ ] 1.3 Hand off in `Humanoid.die` when `available()` allows, carrying velocity and the hit impulse; keep authored corpse poses otherwise; verify in the sandbox (chest shot on stairs, kill beside a bench) and with a fallback test that switch off still picks an authored pose
- [ ] 1.4 Sever during a ragdoll: remove the joint and pass the part to `addDebris`; verify with a test that shooting a corpse's arm makes one debris piece and the ragdoll loses one body
- [ ] 1.5 Freeze at rest within 8 s into a static animator pose, cap active ragdolls at 6 (oldest freezes early), rebuild on touch; verify with a test that killing 8 within 1 s never has more than 6 active and all end frozen, and that a resting body moves under 1 mm/s
- [ ] 1.6 Keep authored kills and sequence corpse poses unragdolled unless their data opts in; verify with `script` tests that no kill style in `data/kills.json` and no `corpse`-role body creates ragdoll bodies
- [ ] 1.7 Let the player's pusher and the stomp move corpses; verify with tests
- [ ] 1.8 Settle the oldest ragdoll, then the oldest debris, when the step runs over budget; verify with a test
- [ ] 1.9 Gate: playtest a wave fight with ragdolls on; checkpoint-restart leak test and enemy-churn probe pass; record step time and heap in design.md; switch the ragdoll default on

## 2. Powered ragdolls and play-dead blending

- [ ] 2.1 Add per-body `physicsWeight` scaling a world-space pose drive toward the animator's pose (design D7; start from `TrialRagdoll.driveToBonesWorld`); verify in the sandbox that weight 0 matches pure animation within 1 cm per bone
- [ ] 2.2 Add hit reactions: per-region weight spike, physical push, return to pose within 0.6 s; verify with a test that a shoulder hit displaces the upper body and every bone is back within 2 cm of the animated pose by 0.6 s
- [ ] 2.3 Add a death fade (drive strength down over 0.3 to 0.8 s, then free the pelvis) before full ragdoll; verify with a test of the strength curve and in the sandbox
- [ ] 2.4 Make play-dead a frozen ragdoll, and blend `getUp` from the frozen pose; verify with a test that no bone moves more than 5 cm between frames during the blend
- [ ] 2.5 Document weights, drive tuning and blending in `docs/physics.md`
- [ ] 2.6 Gate: playtest play-dead ambushes and hit reactions; record step time and heap (budget still met with 6 powered bodies); switch the powered default on
