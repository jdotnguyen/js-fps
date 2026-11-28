# Proposal

## Why

The Docking Ring (R01) is where the game opens, and Jay's guard post is a single waist-high counter that nobody has to pass. It does not read as security. During the walk to the Commons, the intro also turns the view to whoever speaks. That jars because Jay is walking one way while the camera looks another. This change makes the dock a real checkpoint and gives the walk a camera that faces where the rails go.

The project is moving to spec-driven work. The intro is only recorded in ADR-0017, which the code has partly outgrown. This change records the intro as a spec and retires that ADR.

## What Changes

- **Corner counter.** The front counter stays. A second run starts at its west end and goes to the south wall (the wall opposite the dock door), so the booth is closed on the arrivals side and open on the station side.
- **Security desk and CCTV wall.** A desk inside the booth, with a 2 x 3 bank of camera feeds on the south wall behind it, replaces the current monitor console.
- **Metal detector line.** A walk-through arch at the counter's east end, then rail, a fixed staff gate and more rail to the dock window. Together with the counter it splits R01 into an unchecked dock side and a station side. A tray table stands on the dock side of the arch.
- **Dock guard.** A new NPC posted past the arch who scans arrivals with a hand wand. He has a few voiced lines, uses the `guard1` body, and stays on his post (he is not ambient-eligible).
- **Intro checkpoint flow (BREAKING for the intro's beat order and anchors).** Each arrival badges in with Jay at the counter, then goes through the arch. Ruiz gets the full scan, Sung a quick pass. Okafor and Giles now come through one at a time. Giles sets the arch off with his multitool, as he does every morning. The guard sighs, Okafor gets a dry line, and the tone is warm. The squad banter moves to the station side.
- **Walk camera.** Once Jay leaves the booth, the speaker shot ends. A heading shot keeps the view facing along the rails, with about ±35° of mouse leeway that holds briefly and then settles back. The mouse give elsewhere stays 6°.
- **Kitchen camera.** Jay faces along the rails until he walks into the Commons. The view then turns to whoever speaks first and follows the conversation, Priya included. Bram's greeting starts as Jay walks in. Priya holding out the mug stays a framed shot.
- **Free play.** After the intro, walking back through the arch sets it off and the guard reacts.
- **Docs.** The intro is recorded as the `intro-sequence` spec. ADR-0017 is deleted. The dock and intro parts of ADR-0014, 0023, 0026, 0028 and 0029 are removed, and their references are repointed to the specs.
- Out of scope: an opening staff gate (it would need doors off the 4 m grid), and any scanning beyond the intro arrivals and Jay.

## Capabilities

### New Capabilities
- `dock-checkpoint`: the Docking Ring security checkpoint, meaning the booth, desk and CCTV wall, the detector line, the guard, how a scan plays out (pass or alarm), and how the arch behaves in free play.
- `intro-sequence`: the new-game intro as it plays, covering its structure, cast and beats, the checkpoint arrivals, the camera on rails (speaker shots, heading shot, give), the letterbox bars, the hold-to-skip control and its end state, and the flags and checkpoint it leaves behind.

### Modified Capabilities
- None. `openspec/specs/` is empty.

## Impact

- **Level data:** R01 in `src/data/levels/slice01.json` and `scripts/gen-slice01.mjs` get new props, the guard NPC, moved and added anchors, and new authored walks. One Commons NPC (`wall_1`) loses the `guard1` body.
- **Props:** `src/world/kit/slice.ts` gets the corner counter (an L-shaped `half_wall` or two runs), `security_desk`, `cctv_wall`, `metal_detector`, `rail` and `staff_gate`.
- **Script:** `src/data/sequences/intro_shift_change.json`, plus new dialogue lines in `src/data/dialogue/slice01.json` and a guard speaker in `speakers.json`.
- **Runtime:** `src/actors/player.ts` gets the heading target and a hold-before-return give. `src/script/actions.ts` and the host get `playerFrame target:"heading"`. The held-props code gains a wand. New poses are added to `poses.json`, the arch reacts to `detector:scan` events, and `STORY_NPCS` gains the guard.
- **Audio:** new sound ids `archPass`, `archAlarm` and `wandBeep` need recorded files. These follow the in-flight `establish-audio-spec` change (`in-world-audio`).
- **Tests:** `intro.test.ts`, `slice01.test.ts` (anchor list), `player.frame.test.ts`, and the two walk suites (`slice01Walks`, `slice01ScriptedWalks`).
- **Docs:** ADR-0017 is deleted, ADRs 0014, 0023, 0026, 0028 and 0029 are trimmed, `docs/adr/README.md` is updated, and about 28 source comments citing ADR-0017 are repointed. This waits until `establish-audio-spec` is archived, because that change also edits ADR-0017.
- **Assets the user must supply:** the three detector and wand sounds, and optionally a recorded wand-scan clip (otherwise the scan uses hand-keyed poses).
