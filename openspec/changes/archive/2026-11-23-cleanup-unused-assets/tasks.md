# Tasks

## 1. Remove Unused Public Assets

- [x] 1.1 Delete `public/assets/models/squad/giles.glb` and verify `npm test -- src/actors/bodyModel.test.ts` passes
- [x] 1.2 Delete unused brand SVGs (`public/assets/brand/tag-wide.svg`, `tag-wide-transparent.svg`, `tag-mark-transparent.svg`, `j00k80-mark.svg`) and verify `npm run build` succeeds
- [x] 1.3 Delete the 8 unreferenced VO MP3s in `public/assets/vo/` (`react_giles_cry_01..03.mp3`, `react_priya_choke_03.mp3`, `stinger_priya_01/02/04/05.mp3`) and verify `npm run audio:audit` and `npm test -- src/dialogue/debug/voCatalog.test.ts` pass

## 2. Remove Dead Audio Registration and Source Code

- [x] 2.1 Remove `leakHiss` from `src/audio/sounds.ts` (and `public/assets/audio/ambience/oneshot-leak-hiss.mp3` if no longer referenced) and verify `npm run audio:audit` reports no unplayed samples
- [x] 2.2 Delete `src/world/testRoom.ts` and verify `npm run typecheck` and `npm test` pass
