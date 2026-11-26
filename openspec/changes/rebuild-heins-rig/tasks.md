# Tasks

## 1. Sources and baseline

- [x] 1.1 Read `keep-crossed-arms` (proposal, design and tasks, under `openspec/changes/` or its `archive/`). Verify all
      its tasks are ticked and `git status` shows none of its files modified; otherwise stop and tell the user. Heins is
      one of the bodies its tests in `armPoses.test.ts` run on, so this change starts from that work.
- [x] 1.2 Copy `bs-v1_cyborg.glb` and the OBJ extracted from `BS-V1 Cyber female Character .zip` (both under
      `C:\Users\justi\Downloads`) into `previews/hein_src/`. Verify the sizes match (about 339 MB and 11 MB) and
      `git status` shows neither.
- [x] 1.3 Run the unchanged `scripts/fix-heins-glb.mjs` on that GLB to a scratch output (design D3). Verify and record
      how it compares with the committed asset: bone names, joint positions, triangles per material and weights.
- [x] 1.4 Add `heins` to `NECK_BODIES` and `SCAN_BODIES` in `src/actors/bodyModel.test.ts`. Verify both tests fail on
      the current asset for the reasons in the design's table, including the arm test's 202 torso vertices, 4.15x
      stretch and 159 open edges.
- [x] 1.5 Change the arm-separation test's hole check to count only edges that are open when the arms rise but closed at
      rest (D10). Verify Ruiz still passes, and Heins still fails on mixed weights and stretch but no longer on edges
      that were open at rest.

## 2. Bone labels and joints

- [ ] 2.1 Add an OBJ label reader in `scripts/lib/` and carry labels onto the GLB vertices by position (D1, D4). Verify
      with a unit test on a small synthetic mesh, and on the real files that every GLB vertex finds a match and the
      labelled share per material matches the design.
- [ ] 2.2 Print each joint's label-boundary position beside today's, and move joints per D8. Verify the table is
      recorded in the design with the reason for each move, and the `heins model` rig test passes.

## 3. Skin weights

- [ ] 3.1 Gate the capsule scores and smoothing by label (D4). Verify no vertex above the collar carries chest or spine
      weight.
- [ ] 3.2 Apply `scan-body.mjs`'s exported `applyNeckRule` with the collar override (D5). Verify the neck and
      lower-face test passes for Heins, under the look-at turn her nose and mouth trail a rigid head by under 2 mm, and
      no edge round the collar stretches more than 2.5 times.
- [ ] 3.3 Split and cap the jacket sleeves from the torso below the armpit, using `splitArms` per material mesh (D2,
      D4). Verify the arm-separation test
      passes for Heins and `ruiz.glb` rebuilds unchanged if its shared code moved.
- [ ] 3.4 Weight the jaw from the mouth opening (D6). Verify with a new test that at a 15° jaw opening the upper lip
      moves under 1 mm, the lower lip and chin follow the jaw, and no mouth-interior edge stretches more than 2.5 times.
- [ ] 3.5 Weight the cyber arm and hand as rigid parts (D7). Verify with a new test for "Rigid mechanical parts keep
      their shape" at a 90° elbow and a closed grip.
- [ ] 3.6 Fit the finger and twist bones to both hands. Verify `bodyModel.test.ts` (fist and mirrored-hand checks),
      `handPhysics.test.ts` and `restingHands.test.ts` pass for Heins.

## 4. Detail and textures

- [ ] 4.1 Keep every part at full source detail: no decimation, 32-bit indices where a mesh needs them, and every kept
      texture at its source resolution (D9). Verify the triangle count per material matches the source, the eyeballs
      are two whole shells, the mouth and eye rims are open, and record the mesh, texture and file sizes in the design.
- [ ] 4.2 Measure GPU texture memory with the memory probe in a scratch session (`?slot=scratch&memprobe`, spec
      `runtime-memory`), before and after this change. Verify the figures and, if the rise is over 15%, the reason
      (full fidelity, D9) are recorded in the design.

## 5. Build and review

- [ ] 5.1 Rebuild `public/assets/models/squad/heins.glb`, and update the script header and Heins's row in `CREDITS.md`
      (which drops its "~24k triangles" and "1.8 MB" figures).
      Verify a second run produces the same file.
- [ ] 5.2 Run `npm test -- src/actors/bodyModel.test.ts src/actors/armPoses.test.ts src/actors/handPhysics.test.ts
      src/actors/handStyles.test.ts src/actors/restingHands.test.ts src/actors/mocapPhysics.test.ts
      src/actors/motionProfiles.test.ts src/actors/castMotionCoverage.test.ts src/actors/crewBodies.test.ts
      src/actors/limbContact.test.ts` and verify they pass. Report any failure that was already there.
- [ ] 5.3 Run your own dev server with `npx vite --port 5200` (the `playtest:serve` build leaves out sandbox pages;
      never ports 5173 or 4300, which are the player's). Open `/sandbox/cast-motion.html` at the URL it prints, in your
      own headless browser, with an init script that stubs `WebSocket` connections whose protocol includes `vite` so the
      page doesn't reload. Review her in every activity; her face from the front and side while turning and talking; her
      neck and collar from behind; and both arms raised and crossed, including each `idle_crossed_*` head gesture. Verify
      there is no shear, hole, slit or bent metal, and her hands stay on her arms through each gesture. Afterwards
      close the browser and stop the server.
- [ ] 5.4 Run `npm run playtest:serve` in the background and open the URL it prints, with `?slot=scratch`, in your own
      headless browser. Watch the R03 briefing, where her arms must stay crossed as she
      glances and speaks, and the Lab B drop, then get the user's sign-off on how she looks. Record
      anything they want changed. The served build is frozen, so serve it again after any fix. Afterwards close the
      browser and run `npm run playtest:serve -- stop <port>`.
- [ ] 5.5 Run `npm run typecheck` and `npm test`, and verify both pass or list the failures that predate this change.
