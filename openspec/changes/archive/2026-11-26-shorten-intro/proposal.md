# Proposal

## Why

The intro cutscene drags: about 3.5 minutes on rails (an estimate from voice lengths and walk distance), most of it spoken lines. An earlier pacing change already removed the dead air, so getting shorter now means cutting weaker exchanges, while keeping the character moments and the view of the station that already work.

## What Changes

- Cut the booth banter after the greetings: "Morning, Giles. You look well rested." through "Oh good, there's two of you now." (`intro_jay_04`, `intro_giles_02`, `intro_okafor_02`, `intro_giles_03`).
- Cut Bram's kettle exchange: "Morning, Bram. Kettle still holding up?" through "Don't encourage him." (`intro_jay_06`, `intro_cook_02`, `intro_giles_16`, `intro_cook_04`, `intro_okafor_11`).
- Cut the Mara exchange (`intro_jay_07`, `intro_giles_12`, `intro_giles_13`) and the `mara_mentioned` flag, which nothing reads.
- Delete the twelve cut lines and their recordings.
- Expected saving: about 25 s (estimate), from about 3.5 to a little over 3 minutes.

Out of scope:

- Ruiz's and Sung's exchanges, the sub docking shot, the walk to the kitchen and Priya's scene all stay.
- The arrival PA: it still finishes before the airlock opens, since the sub needs that time to dock.
- Giving the player control earlier (a free-roam walk or kitchen).
- The briefing and the rounds.
- The wrong audio in `intro_jay_05`, which `fix-misaligned-voice-clips` handles. It does not change the intro's length, because the walk sets how long that beat lasts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `intro-sequence`: the station-side banter, the kettle talk and the Mara exchange go, `mara_mentioned` is no longer set, and the pacing requirement no longer promises to keep every voiced line. The same flag list also drops `giles_forearm_seen`, which the intro has not set since the forearm tell was removed.

## Impact

- Data: `src/data/sequences/intro_shift_change.json`, `src/data/dialogue/slice01.json`.
- Assets: twelve files removed from `public/assets/vo/`.
- Code and tests: `src/script/intro.test.ts`; the `audition_giles_okafor` list in `scripts/vo-generate.ts`, which names two of the cut lines.
- Docs: `docs/scripts/intro_shift_change.md`.
- Saves: older saves keep a `mara_mentioned` flag that nothing reads. No save format change.
- Story: this removes the only mention of Giles's daughter that a player currently hears. `docs/characters.md` still describes her, for the new cliffhanger if it needs her.
