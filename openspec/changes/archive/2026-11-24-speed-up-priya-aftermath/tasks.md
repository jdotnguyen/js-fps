## 1. Sequence

- [x] 1.1 In `action_security.json`, shorten the glass hold, start the walk to `r07_console` non-blocking, wait ~1.5 s, say `sec_okafor_20`, then wait for arrival
- [x] 1.2 After arrival: intercom off, `score end`, notebook pose, 3.2 s pause, `sec_okafor_21`; remove the 4 s notebook wait
- [x] 1.3 Cue the `aftermath` score at `kill:still` so the motif runs under line 22

## 2. Score

- [x] 2.1 Fade the `hold` layer out with a new `aftermath_out` cue (scores.json) before line 20 instead of re-rendering a shorter motif; test added in `medbayScore.test.ts`

## 3. Tests and verification

- [x] 3.1 Update the aftermath order assertion in `src/script/action.test.ts` (line 20 before intercom off and notebook; line 20 within ~2.5 s of line 22 ending)
- [x] 3.2 Run `npm run typecheck` and `npm test -- src/script/action.test.ts src/audio/medbayScore.test.ts`
- [x] 3.3 Updated the aftermath description in `docs/PLAYTEST.md`; the in-browser playtest is left to Justin
