## Context

`action_security.json` runs the aftermath after the `kill` parallel: `npcMoveTo` door, `okafor_hand_glass`, wait 1.2, `npcMoveTo` console (blocking), `intercom off`, `score end`, `okafor_notebook`, wait 4, say `sec_okafor_20`, wait 3.2, say `sec_okafor_21`. The glass-to-console walk is ~8.8 m.

## Decisions

- **Speak on the walk.** Start the walk to the console with `wait: false`, wait ~1.5 s, then say `sec_okafor_20` (blocking), then await arrival. Line 20 starts about 1.5 s into the walk; the delay is a single tunable constant. Chosen over trimming only, which leaves the walk silent.
- **Hold shrinks, notebook wait goes.** The 1.2 s glass hold becomes ~0.3 s. After arriving: intercom off, `score end`, notebook pose, then the existing 3.2 s pause before `sec_okafor_21`.
- **Motif.** Cue `aftermath` at `kill:still` (under line 22) and a new `aftermath_out` cue (1 s fade of `hold`, drone kept) as the walk starts, so the motif is gone before line 20. This replaces shortening the render, since the layer loops on a fixed clock.
- **Walk speed 2.2** (was 1.0, the same pace Okafor uses to reach the door earlier in the scene): the glass-to-console walk drops from ~9 s to ~4 s. Line 20 still starts 1.5 s in.

## Risks

- Intercom is now switched off after the line instead of before it; the medbay score must still have no layer playing at that moment (existing scenario).
- A skip/restore must reach the same end state: flags, door open, checkpoint unchanged.
