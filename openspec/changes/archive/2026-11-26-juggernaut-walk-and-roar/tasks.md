# Tasks

## 1. Footfalls (D8)

- [x] 1.1 Add `juggernaut-step-1..4` and `juggernaut-knuckle-1..3` to `scripts/footsteps-generate.ts` and generate them with `npm run footsteps:generate -- --id <id>`. Register `juggernautStep` and `juggernautKnuckle` in `src/audio/sounds.ts`. Verify each file exists, is under 1.5 s and is peak-matched (the script's own report), and that the sound tests pass.

## 2. Gait (D1-D4)

- [x] 2.1 Add `src/actors/creature/gait.ts`: path walking, the diagonal-sequence phases, plants and swings, bob and roll on the root, start, settle and touchdown callbacks. Verify with `gait.test.ts` on the Juggernaut:
  - a 3.4 m straight walk ends within 5 cm, facing along the path within 5°;
  - planted limbs move less than 2 cm;
  - the landing order is left leg, right hand, right leg, left hand;
  - mid-swing clearance is at least 10 cm and landings are within 2 cm of the ground;
  - one touchdown is reported per landing;
  - it settles with every limb within 15 cm of its standing place, then stays still;
  - the bob is 3-15 cm while walking and under 5 mm standing.

## 3. Sequences (D5)

- [x] 3.1 Add `sequences` to the creature pose types and validator, rejecting an unknown pose by sequence and pose name. Add `src/actors/creature/sequences.ts` (the player with face ramps and a seeded tremble). Verify by test the timing scenario (2.0 s within one frame) and the unknown-pose error.
- [x] 3.2 Author `roar_windup`, `roar`, `roar_settle` and the walking roar's pose, and the sequences `roar_walk` and `roar_full`, in `juggernaut.poses.json`. Verify by test:
  - at the long roar's hold the jaw is at its open limit;
  - the head is at least 15° higher than at the start;
  - every joint stays inside its limits throughout;
  - during a walk, `roar_walk` opens the jaw and lifts the head while the planted limbs stay within 2 cm.

## 4. Finale (D6, D7)

- [x] 4.1 Give `src/render/fx/juggernaut.ts` the gait and the sequence player: `reveal` walks from the hide anchor to the peek anchor in about 5.2 s, looking at the squad, `act(sequence)` plays a sequence, and touchdowns call back. Update its test: the walk ends within 5 cm of the reveal anchor, touchdowns fire, the reveal still creates no object, material or geometry, and the aim point follows the head.
- [x] 4.2 Wire `transit:juggernaut_act` and the touchdown footfalls in `src/app/session.ts`, and make `squad:scripted_fire` with `bursts: 0` stop a volley. Verify by test in `src/ai/squad.test.ts` that a stop ends the volley.
- [x] 4.3 Rework the CAM 10 beats in `src/data/sequences/action_climax.json` (D7) and update `src/script/action.test.ts`. Verify:
  - the creature shows, walks, roars twice on camera and hides at the cut;
  - no creature sound plays after the cut;
  - `story:cliffhanger` follows about 1 s after the cut.
- [x] 4.4 In the browser, with `?level=slice01&debug&slot=scratch&jump=r16_finale`, capture CAM 10 frames of the walk and the long roar. Verify:
  - the hands and feet stay planted;
  - the creature clears the pillar;
  - both roars line up with the jaw;
  - the cut lands on the roar's last beat;
  - the program watch logs nothing.
  
  Close the tab.

## 5. Sandbox and docs

- [x] 5.1 Add walk (a path toward a handle, at a set speed) and sequence playback to `/sandbox/creature-rig.html`. Verify in the browser that both work over each other, then close the tab.
- [x] 5.2 Update `docs/creature-rig.md` (the gait, sequences, footfalls) and the R16 finale line in `docs/PLAYTEST.md`, and verify the described URLs work as written.

## 6b. Screams and quieter fire (after review)

- [x] 6b.1 Add `r16_giles_05` and `r16_okafor_04` ("What the hell is that?!", emote `scream`, radio, line gain 0.8) to `src/data/dialogue/slice01_action.json`. Record them with `scripts/vo-generate.ts --ids` on each speaker's pinned model. Verify the word check passes both and `scripts/vo-takes.json` records them.
- [x] 6b.2 Add an optional `gain` to `squad:scripted_fire`, carried on `squad:fired` and multiplied into the squad gunshot. Verify with tests in `src/ai/squad.test.ts` and `src/app/squadShots.test.ts`.
- [x] 6b.3 Keep the squad firing through the long roar at gain 0.6, with Giles screaming as it rears and Okafor over the roar. Verify in `src/script/action.test.ts`.

- [x] 6b.4 Second review. Retake both lines as yelled "What the fuck is that?!" (`urgent`, gain 1.3), both before the long roar, and check them against the squad's other shouts by pitch and brightness. Fire every finale volley 0.65 s apart at 0.6 (0.4 under the roar). Verify in `src/script/action.test.ts`.
- [x] 6b.5 Back the squad away as it walks out, facing it (`npcMoveTo` `face`, `Humanoid.steer` `face`, `Animator.reverse`, no heading snap on a moving mate). Verify with `src/ai/backingAway.test.ts`: it faces the point within 10°, walks backward and arrives; without `face` it turns round.
- [x] 6b.6 (Marked complete by the user, who is checking it in the browser.) In the browser, watch and listen to CAM 10: the retreat, the yells and the fire level. Three runs were cut short by dev-server reloads from another agent's edits; this check is left to the user.

## 6. Integration

- [x] 6.1 (Marked complete by the user. typecheck and the touched test files pass; the full `npm test` and `npm run build` were not run.) Run `npm run typecheck` and the touched test files, then `npm test` and `npm run build` if the machine has the memory. Report any run that was not possible.
- [x] 6.2 Run `openspec validate juggernaut-walk-and-roar --strict` and verify it passes.
