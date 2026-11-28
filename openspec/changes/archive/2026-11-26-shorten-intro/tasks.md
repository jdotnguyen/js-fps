# Tasks

## 1. Baseline

- [x] 1.1 Time the current intro in the browser from New Game (`?slot=scratch`) to control returning, with nothing skipped; verify the figure is written into design.md

## 2. Cut the exchanges

- [x] 2.1 Remove the four booth banter lines from `intro_shift_change.json`; verify `npm test -- src/script/intro.test.ts` passes
- [x] 2.2 Remove the five kettle exchange lines, keeping both mug hand-offs, both `drink` animations and Bram's walk back (design D1); verify the Bram serve and skip-parity tests pass
- [x] 2.3 Remove the three Mara lines and the `mara_mentioned` step, and update the flag and addressee assertions in `intro.test.ts`, asserting the flag stays unset; verify `npm test -- src/script/intro.test.ts` passes
- [x] 2.4 Delete the twelve dialogue entries and clips and update the `audition_giles_okafor` list (design D3); verify a search finds the ids only in `scripts/vo-takes.json` and openspec files, `npm test -- src/script/intro.test.ts src/dialogue/library.test.ts src/dialogue/debug/voCatalog.test.ts` passes, and `node --experimental-strip-types scripts/vo-generate.ts --dry-run` lists its batches without error

## 3. Documentation

- [x] 3.1 Bring `docs/scripts/intro_shift_change.md` in line with the new sequence, including the forearm beat it still lists; verify every line in it matches the sequence in order

## 4. Integration

- [x] 4.1 Run `npm run typecheck` and `npm test`; verify type checking passes and the only test failures are ones that also happen without this change (accepted by the user 2026-11-26; see design.md)
- [x] 4.2 Play the intro watched and skipped, listen for gaps and orphaned replies, and time the watched run; verify the new time and the saving are written into design.md and the user accepts the pacing
