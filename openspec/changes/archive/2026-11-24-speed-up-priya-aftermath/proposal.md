# Proposal

## Why

After Priya dies in R08, Okafor says "I'm here. ...I'm here." at the glass and then there is about 14 s before his next line: a 1.2 s hold, a ~9 s walk to the console in silence, and a 4 s notebook wait. The 4 s rule in `medbay-attack` is met only because he is moving, so the scene still goes slack at its emotional peak. Justin wants no gap in the flow: Okafor should start "I told her she was fine." while he walks, before he reaches the terminal.

## What Changes

- "I'm here. ...I'm here." is replaced by an audible exhale and sniffle (a male TTS reaction, played loud) and a new line, "Gotta keep moving.", as he sets off. He walks to the console at 2.2 m/s instead of 1.0.
- Okafor leaves the glass soon after the surgery door closes (the 1.2 s hold becomes a short beat) and says "I told her she was fine." about 1.5 s into the walk to the console.
- At the console he switches the intercom off and writes in his notebook straight after the line; the 4 s silent notebook wait is removed. The 3 s+ pause before "Med lab's through there." stays.
- The aftermath score motif is shortened and cued earlier so it has ended before "I told her she was fine." starts.

## Capabilities

### New Capabilities

### Modified Capabilities
- `medbay-attack`: the aftermath order changes (line 20 spoken on the walk, then intercom off and notebook).
- `adaptive-music`: the aftermath motif must end before the earlier first aftermath line.

## Impact

- `src/data/sequences/action_security.json` (aftermath steps after the `kill` parallel), `src/audio/scores/medbay.ts` (`hold` layer length), `src/script/action.test.ts` (aftermath order assertion), medbay score tests, `docs/PLAYTEST.md` if it describes the aftermath timing.
