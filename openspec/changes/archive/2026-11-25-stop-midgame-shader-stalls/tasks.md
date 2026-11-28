# Tasks

## 1. Compile for the render target play uses (design D1)

- [x] 1.1 Add a render module that compiles objects with a target bound and restores the previous one, and verify with a stub-renderer test that the target is bound during the call and restored when it resolves or throws
- [x] 1.2 Use it for the loading-screen warm-up and the `render:warm` handler in `src/app/session.ts`, and verify that `npm run typecheck` passes and that a cold-cache load of `?level=slice01&debug&slot=scratch&jump=r05` logs a `shaders+warm` stage well below the 23.5 s in `proposal.md` (record it in `design.md`)

## 2. Keep the light count constant (design D2)

- [x] 2.1 Hang each squad weapon light and its target from `squad.group`, place them in world space, give a hidden mate's light intensity 0, and update the cases in `src/ai/squad.test.ts` so they verify the light sits at the muzzle, points along the aim and is dark while the mate is hidden
- [x] 2.2 Sync the weapon lights after every step that moves a mate (ride, squad step, catch-up, NPC director) and after a load or restart, and verify with a test that a teleported mate's light is at the new muzzle in the same step
- [x] 2.3 Add a test that counts visible lights by kind, shadow and pattern with the squad near, both far, split and with weapon lights on, and verify the counts are identical and that the test fails against the old parenting
- [x] 2.4 In the browser, verify the weapon lights during a scripted use and on the train ride show no visible lag or misplacement

## 3. Report compiles during play (design D6)

- [x] 3.1 Add a pure program-watch function that takes the baseline and the current program list and returns each new program once, and verify it with tests for a new program, a repeat and a reset baseline
- [x] 3.2 Wire it into developer sessions in `src/app/session.ts` with the baseline taken after the warm-up and reset on a graphics quality change and the debug fly camera, and verify in the browser that a quality change logs no warning and a temporarily skipped warm-up logs warnings
- [x] 3.3 Document the warning and what to do about it in `docs/PLAYTEST.md`, and verify the described URL produces the described output

## 4. Prepare what appears late (design D3, D4, D5)

- [x] 4.1 Move the finale creature into a preload-and-dispose module that loads with the cast assets and is added hidden before the texture upload, and verify with tests that the reveal only shows and places it, a failed load warns and the session continues, and dispose releases its geometry and textures
- [x] 4.2 Make the transit kit's fallen bodies and blood textures report pending loads and have the loading screen wait for them, including for a world built at the title, and verify with a test that the wait resolves after both successful and failed loads
- [x] 4.3 Build the session-long warm set for every body model and the procedural body (dry, wet, surface and severed forms), keeping materials and releasing geometry, shadow-caster and contact registrations, and verify with a test that every loaded model is covered, no registration remains, and session dispose disposes the materials
- [x] 4.4 Add the gore, casing and splash materials that have no mesh at load, and verify with a first fight in the browser (every body model, wading, severed limbs, deaths) that the program watch logs nothing
- [x] 4.5 Run one room capture, a cross-fade and a shadow pass over the warm set during the warm frames, and verify that visiting every room logs nothing from the program watch
- [x] 4.6 Verify that removing every enemy and corpse, restarting from a checkpoint and replaying the fight logs nothing from the program watch

## 5. Integration check (design D7)

- [x] 5.1 Run the cold-cache procedure in design D7 across every room, a fight in water and the finale, verify no program is compiled during play, and record load time, warm-stage time and worst frame in `design.md`
- [x] 5.2 Re-measure heap, GPU texture memory and quit-to-title release with `?slot=scratch&memprobe`, record the figures in `design.md`, and explain any rise above 15%
- [x] 5.3 Run `npm run typecheck` and `npm test` and verify both pass (accepted 2026-11-25 on "no new failures": typecheck passes; 1945 of 1964 tests pass and the same 19 fail on a clean export of `a97d09c`)
