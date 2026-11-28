# Tasks

## 1. Remove Giles Infection Arc & Foreshadowing

- [x] 1.1 Remove the `rub_forearm` animation, `giles_forearm_seen` flag, and `intro_okafor_04`/`intro_giles_07`/`intro_okafor_05`/`intro_giles_08` exchange from `src/data/sequences/intro_shift_change.json`, and update `src/script/intro.test.ts` to assert no forearm tell plays (`npm test -- src/script/intro.test.ts`).
- [x] 1.2 Remove `giles.infectionStage` escalation and scripted `cough` anims from `src/data/sequences/action_tunnel.json`, and remove `'giles.infectionStage'` and `'giles.bandaged'` from the `r09` and `r11` debug jump presets in `src/app/session.ts` (`npm run typecheck`).

## 2. Author R11 Dialogue, Generate VO & Phased Generator SFX

- [x] 2.1 Add the 10 approved `R11` Power Bay dialogue lines (`r11_okafor_01`, `r11_jay_01`, `r11_giles_01`–`07`, `r11_okafor_02`) to `src/data/dialogue/slice01_action.json` and update `obj_power` / add `obj_transit_board` in `src/data/objectives.json`.
- [x] 2.2 Generate the 10 `R11` VO clips (`public/assets/vo/r11_*.mp3`) using each speaker's pinned Gemini TTS model via `node --experimental-strip-types scripts/vo-generate.ts --ids ... --apply`, verify zero off-model clips with `node --experimental-strip-types scripts/vo-trace.ts`, and update `scripts/vo-takes.json`.
- [x] 2.3 Generate the three phased low-rumbling generator startup SFX (`public/assets/audio/ambience/oneshot-generator-phase-1.mp3`, `2.mp3`, `3.mp3`) via ElevenLabs SFX and register `generatorPhase1`, `generatorPhase2`, and `generatorPhase3` in `src/audio/sounds.ts` (`npm run typecheck`).

## 3. Implement R11 Power Bay Sequence & Cascade

- [x] 3.1 Replace the legacy `climax`, `reveal_restore`, `climax_hero`, and `cliffhanger` sequences in `src/data/sequences/action_climax.json` with the new `r11_power_bay` sequence (cautious whispered entry -> Giles walking past casually -> terminal diagnosis & a-ha! beat -> phased generator startup & cascading lights -> `D_R13d_R11` open, checkpoint `cp_r11_powered`, objective `obj_transit_board`), leaving `title_card` and `stinger_priya` intact for the upcoming R16 finale.
- [x] 3.2 Update `r11_power_cascade` in `src/data/sequences/action_climax.json` to play `generatorPhase1`, `generatorPhase2`, and `generatorPhase3` synchronized with the three west-to-east light bank stages, turbine spin-up, and subtle camera shake impulses.
- [x] 3.3 Update `src/script/action.test.ts` to cover the new `r11_power_bay` flow, phased power cascade, `r11_powered` state, open `D_R13d_R11`, and absence of Giles infection/transformation (`npm test -- src/script/action.test.ts`).

## 4. Verification

- [x] 4.1 Run `npm run typecheck` and `npm test -- src/script/intro.test.ts src/script/action.test.ts`, and playtest `?debug&jump=r11` in the browser to verify the whispered entry, Giles's terminal beat, 3-phase generator rumble + light cascade, and open route through `R13d` into `R15a`.
