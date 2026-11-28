# Tasks

## 1. Recordings

- [x] 1.1 Before adding any audio, measure the baseline per the `runtime-memory` spec (`?slot=scratch&memprobe`, New Game, voice clips loaded, intro skipped, standing in the Commons, heap read after a forced collection) and record JS heap, GPU textures and decoded audio in design.md "Memory"
- [x] 1.2 Source or generate the recordings in design D6 into `public/assets/audio/ambience/`, with a `CREDITS.md` line for each downloaded one and any ElevenLabs prompts in `scripts/ambience-generate.ts`; verify `ffprobe` shows every file mono, `coffeeBrew` is about 8 s, each licence is confirmed on the clip's own page, and levels are matched to the sounds already in the room
- [x] 1.3 Register `chairScrape`, `tableClink`, `kitchenClatter` and `coffeeBrew` in `SAMPLE_URLS`; verify `npm run typecheck`

## 2. Chairs, tables and kitchen

- [x] 2.1 Add the move listener and the seated query to `AmbientDirector` (D2); verify `npm test -- src/ai/ambientLife.test.ts` covers leaving and sitting, and silence on `reset` and `interrupt`
- [x] 2.2 Add `src/audio/commonsSounds.ts` (D1, D3, D4); verify `src/audio/commonsSounds.test.ts` covers chair kinds, random intervals, no seats, the kitchen conditions, half level during talk, the 24 m cut-off, title and the drop
- [x] 2.3 Wire it in `src/app/session.ts` and `src/ai/npcs.ts`, including reset on restart and level reset; verify `npm run typecheck`, the touched tests, and in the browser that sounds come from the chairs, tables and counter
- [x] 2.4 Add the chair, table and kitchen checks to `docs/PLAYTEST.md`, covering a closed door and a checkpoint after the drop; verify each line matches a scenario in the spec delta

## 3. Bram's brew

- [x] 3.1 Add `src/ai/cookBrew.ts` (D5); verify `src/ai/cookBrew.test.ts` covers the first and later waits, each start condition, the full cycle, leaving mid-brew, the blocked walk, a scripted command, the drop and a reset
- [x] 3.2 Wire it in the session and have `NpcDirector.command` interrupt it before applying a command to `cook`; verify an NPC-level test (`src/ai/npcsBrew.test.ts`) shows the rounds' move to `cook_stand` mid-brew leaving Bram there, idle, with the sound stopped
- [x] 3.3 Add the brew checks to `docs/PLAYTEST.md` (watching a full brew, talk delaying it, standing in the way, loading mid-brew), and verify `npm run audio:audit` passes

## 4. Intro

- [x] 4.1 Once `shorten-intro` is committed, add the `sfx` steps at both coffee beats (D7); verify `npm test -- src/script/intro.test.ts` asserts a brew sound beside each, and that a full intro plays it while a skipped intro does not

## 5. Verification

- [x] 5.1 In the browser (scratch slot), play from New Game to the drop: Bram's walk and hands-busy pose look right from the room and from beside the machine, standing in his path ends cleanly, a load mid-brew leaves him placed correctly, and nothing is heard after the drop; verify no console errors
- [x] 5.2 The user listens on headphones through the intro, the Commons before and after the briefing, and from a neighbouring room, and accepts levels and frequency; verify any spec number changed by tuning is updated in the delta
- [x] 5.3 Repeat the memory measurement from 1.1 and record it in design.md; verify any figure up by more than 15% is stated with its reason
- [x] 5.4 Run `npm run typecheck` and `npm test`; verify both pass, reporting any failure that comes from other uncommitted work

## 6. After the first listen

- [x] 6.1 Raise the chair, table and kitchen sounds (clips matched on loudness, higher gains); verify with in-game levels recorded in design.md and `npm test -- src/audio/commonsSounds.test.ts src/audio/audit.test.ts`
- [x] 6.2 Raise the conversation murmur; verify with in-game levels recorded in design.md and `npm test -- src/audio/murmur.test.ts`
- [x] 6.3 Play the pre-briefing exchanges after loading the save made as the intro ends; verify `npm test -- src/ai/overheard.test.ts` covers that save, and add the check to `docs/PLAYTEST.md`

## Workflow follow-up

- Commit only this change's hunks: the shared checkout holds other agents' uncommitted work.
- Archive the change, syncing the `in-world-audio` delta, once the user accepts it by ear.
