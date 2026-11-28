# Tasks

## 1. Hit data reaches the player

- [x] 1.1 Add the optional `side` to `EnemyTarget.hurt` and pass `strikeSide` from swipes and grab ticks in `src/ai/enemy.ts`; forward `kind` and `side` in `src/ai/enemyTargets.ts`. Verify with an `enemy.test.ts` case that a right-arm swipe reports `kind: 'swipe', side: 'R'` (via `enemyTestKit` hits).
- [x] 1.2 Extend `Player.damage(amount, from, hit?)` and the `player:damaged` payload with `kind`, `side`, `dir` and `severity` (D1); scripted and debug calls fall back to `generic`. Verify with a player test that a scripted hit emits `kind: 'generic'` and that severity is clamped 0..1, and that `npm run typecheck` passes.

## 2. Flinch and aim punch

- [x] 2.1 Add `src/actors/hitFlinch.ts` (per-kind impulse table, three springs, aim share, reduced-motion scale) with `hitFlinch.test.ts`. Verify the tests show: a left swipe rolls and turns right; a 25-point hit peaks higher than an 8-point hit; motion settles within 0.4 s; the lasting aim change is under 0.3 degrees; reduced motion gives at most a third.
- [x] 2.2 Wire `HitFlinch` into `Player.damage` and `applyCamera`, remove the direct `yaw += side * 0.015`, and leave the recoil `kick` spring unchanged. Verify with `npm test -- src/actors/control.test.ts` and the new tests, and in the browser that a swipe visibly jolts the view and the crosshair returns to the target.

## 3. Weapon knock

- [x] 3.1 Add `knock(dir, severity)` to the viewmodel springs and wire it to `player:damaged` in `session.ts` (D3). Verify with a viewmodel test that the rest pose is restored within 0.4 s and that firing during a knock still fires, and in the browser while aiming down sights.

## 4. Hit flash split from low health

- [x] 4.1 Split `damageFx` into a hit flash with a direction and the steady low-health state (D5); add `uHitFlash` and `uHitDir` to the grade in `src/render/post.ts` and set them in `session.ts`. Verify with `npm test -- src/render/post.test.ts` (uniforms present) and in the browser that a full-health hit flashes towards its side and leaves no desaturation, while low health still pulses.

## 5. Claw marks

- [x] 5.1 Draw the claw/scratch masks in the atlas build script in `scripts/` (no CC0 set or image quota; user's choice), using the CC0 blood decals for wet detail, write `public/assets/textures/fx/hit-marks.webp`, and credit the sources in `CREDITS.md`. Verify the script rebuilds the same atlas from its sources and the file loads in the game.
- [x] 5.2 Add the mark picker and timing in `src/render/hitMarks.ts` with `hitMarks.test.ts` (D4). Verify the tests show: right swipes land on the right third along the swing; bite and slam pick their own cells; the crosshair zone stays clear; at most three live, oldest replaced; no identical consecutive marks; timing ends by 1.5 s; reset clears all.
- [x] 5.3 Draw the marks in the grade (atlas sampler, three slots, warp, before vignette and grain) and drive them from `session.ts` on game time. Verify in the browser on High and Low: streaks draw on along the swing and fade, take exposure and grain in a dark room, hold while paused, and clear on restart. Check the atlas cost with `?slot=scratch&memprobe`.

## 6. Jay's pain reactions

- [x] 6.1 Add the `react_jay_hurt` batch (light, mid, heavy; 5 takes each) and the `react_jay_breath` batch to `scripts/lib/voReactionBatches.ts` on Jay's pinned voice, generate them per `docs/voice-casting-standard.md` (copy raw takes aside right after generating), and update the casting doc's reaction table. Verify `scripts/vo-takes.json` records the takes on Orus / 3.1 and listen to each tier against Jay's dialogue.
  Result (2026-11-26): takes recorded on Orus / 3.1. The user accepted the sound as "good enough".
- [x] 6.2 Add the `hurt_jay_light/mid/heavy` pools to `barks01.json` (no subtitle) and the severity picker with its 1 s gap and heavier-cuts-lighter rule in `barks.ts`; skip hurt reactions while grabbed (D6). Verify with `barks.test.ts` cases: four small hits in a second give one reaction; a big hit cuts a playing breath; no subtitle line; no hurt reaction during a grab.

## 7. Impact sounds and low-health bed

- [x] 7.1 Generate `hitClaw`, `hitBite`, `hitSlam` and the looping `lowHeartbeat` with ElevenLabs per `docs/audio-assets.md`, register them in `src/audio/sounds.ts`, and credit them as the doc requires. Verify `npm test -- src/audio/sounds.test.ts` passes.
- [x] 7.2 Play the impact for the hit's kind on `player:damaged` ahead of the voice reaction, and fade the heartbeat and Jay's breathing in and out with `vitals.low` and the downed state (D7). Verify with a test that the bed starts below the low-health line and stops above it or when downed, and in the browser that the impact is heard before the grunt and dialogue stays clear over the bed.
  Result (2026-11-26): `playerHurt.test.ts` passes. The user accepted the sound as "good enough".
- [x] 7.3 Route the `voice` bus round the damage muffle in `src/audio/engine.ts` (D8). Verify with an `engine.test.ts` case that only `voice` reaches the output without passing the filter, and that the reverb returns pass it.

## 8. Integration

- [x] 8.1 Add a hit-feedback line to `docs/PLAYTEST.md` (take swipes from each side, a bite and a slam at full and low health, with Reduced motion on and off) and run it on `npm run playtest:serve`. Verify every `damage-feedback` scenario by hand and attach a short clip to the PR.
  Result (2026-11-26): closed on the user's sign-off (screen effects "looked fine", then "good enough"); no scenario-by-scenario hand run was reported. No pull request, so no clip attached; one is at `previews/player-hit-feedback/hits.mp4`.
- [x] 8.2 Run `npm run typecheck` and `npm test`, and `openspec validate player-hit-feedback --strict`. Verify all pass.
  Result (2026-11-26): on an export of the committed tree, typecheck passes and `npm test` passes 2421 of 2438 (1 skipped). The 16 failures have the same names and messages on a clean export of 6168851. Strict validation passes.

## Workflow follow-up

- Archive the change after review, which syncs `damage-feedback` and the `post-processing` delta into `openspec/specs/`.
