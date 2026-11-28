# Tasks

## 1. Lines and VO

- [x] 1.1 Add `cover_priya_run_02` and rewrite `sec_okafor_10`, `sec_okafor_17` and `sec_priya_18` in `src/data/dialogue/slice01_action.json` (design D4); verify the dialogue validates (`npm test -- src/data/dialogue`)
- [x] 1.2 Record the four lines with `scripts/vo-generate.ts --ids ... --apply`, one request per model; verify the word check passes or the held clip has been listened to, and `scripts/vo-takes.json` records them
  - Recorded 2026-11-26 (one request per model). Priya's two lines and "It's me." are recuts in `scripts/vo-recuts.json`: the batch split gave her breath to the shout, and the fresh "It's me." lost its first word, so it is cut from the original "It's me. Come to the door." take. Okafor's raw batch was overwritten by another agent's `retake_medic_01` 34 s later, so his talk-down line is the clip as split (pauses 1.0 s, at the cap `vo-tighten` uses for a line with a written beat). All four pass the word check.

## 2. Staging

- [x] 2.1 Add the anchor `priya_door_in` to `scripts/gen-slice01.mjs` and `src/data/levels/slice01.json` (design D1); verify in `src/world/slice01.test.ts` that it is within 1.5 m of `D_R07_R08`, inside R08, and reaches `priya_sit` on the navmesh
- [x] 2.2 Retime the run in `sec_glass` (design D2): her shout, the stumble, Okafor's shout as she reaches the door, the run to `priya_door_in`, no crouch; verify with `src/script/action.test.ts` that her line starts first and his follows it
- [x] 2.3 Send Okafor to `r07_medbay_door` and remove her walk to `priya_window` (design D3); verify with `src/script/action.test.ts` that no step moves her to `priya_window` and the rescue lines keep their order

## 3. Check

- [x] 3.1 Play the run and the rescue in the browser (`jump=r07`, `?slot=scratch`): she shouts as she runs, he calls as she reaches the door, she turns to face it, and the talk-down plays and sends her to the beds; listen to the four new clips
  - Accepted by the author on 2026-11-26 after playing it.
