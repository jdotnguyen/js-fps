# Proposal

## Why

Dr. Voss's death in the Lab B drop is the slice's first horror beat, and it does not sell. Her whole kill is pairs of held poses swapped on a timer, with captured motion, foot planting and footsteps switched off:

- While she scratches, two poses swap every 0.2 s, and her head, trunk and legs shimmy along with her hands.
- Her run to the glass swaps two flailing poses every 0.34 s. She never braces on anything or loses her footing.
- Her scream holds her jaw wide open for the whole line and ignores the recording.
- She falls by blending to a lying pose in 0.55 s.
- From the gallery, Lab B sounds as if Jay were standing in it: the glass barely muffles it, and the intercom's radio copy is buried under the direct sound.

## What Changes

- **Holding it together.** From the end of the rounds, while her breathing already comes through the intercom, she stops typing and shows it: hunched, holding her arm. While she waits for Okafor's question, which takes longer or shorter depending on how Jay's squad arrives, her hands scratch fast but the rest of her moves slowly: laboured breathing, weight shifts, glances at the people behind the glass. The shimmy goes. Her first line stays as recorded.
- **A fixed-length death.** From the end of Okafor's question, the rest of her kill runs on a fixed clock of about 13 s, the same on every run, so every movement, prop, sound and line lands on its frame. The beats keep their names and order, and the drop's lines, lights and alarm keep waiting on them.
- **A staged run through the lab.** A jolt from inside throws her forward into the bench beside her. She sweeps it clear, doubles over, pushes off, stumbles and nearly goes down, recovers, grabs the prep cart, drags it over and reaches the glass. She follows an authored route with her feet planted and her footsteps heard. Captured stumble, hurt-walk and scared takes from free sources carry her travel; hand-authored poses carry the contacts.
- **Clips that travel.** A kill beat can move its victim along an authored route while it plays a clip, instead of holding her in place.
- **At the glass.** Palms and face to the pane, then the existing scream, with her jaw following the recording's loudness, straining and trembling instead of held open.
- **A real collapse.** After the burst her knees give, she slides down the pane and crumples. She ends where the creature still has room to stand where rig-necromorph placed it.
- **Props that react on cue.** The glassware on the bench beside her becomes loose. The cart's fall is scripted, so it goes over on the same frame every run, even with physical interaction off. The smaller objects fall by physics, and lie at authored resting spots when physics is off or after a restore.
- **Designed sound.** New ElevenLabs recordings: the bench sweep, the cart going over, her body hitting the bench, her knee hitting the floor, her palms on the glass, her scuffs, and her gasps and grunts in her existing voice. Each crash is one designed sound at its scripted time, over quieter physics impacts.
- **Lab B heard through the intercom.** Lab B's observation glass muffles hard, so from the gallery the room comes mainly through the intercom's radio. Hits on the pane itself stay direct. R08's window is unchanged.
- **The drop's timing.** The beat deadlines in `drop.json` move to the fixed clock.

Not in this change: the blade creature (rig-necromorph), new dialogue lines, ragdolls (`add-physics-ragdolls`), and recorded performance capture.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `infection-kills`: a beat can run a fixed length instead of following its audio, so Lab B's scream no longer starts the arch. A clip can carry the victim along a route instead of holding her in place. Voss's scream is seen as well as heard: her jaw follows the recording. New requirements cover her staged run, her planted feet and footsteps, and her collapse.
- `gallery-drop`: "Voss is already distressed as the drop starts" gains her slow waiting motion, and her staged run replaces her run to the glass.
- `physical-interaction`: "Lab B is furnished with loose lab objects" gains loose glassware on the bench by Voss. "Scripted kills knock loose objects over" becomes a sweep and a cart fall at authored moments, with the cart falling even when physics is off.
- `in-world-audio`: "Glass muffles lightly" gains an exception for sealed observation glass, which Lab B's pane becomes. "World sound occlusion" no longer lets a kill's sounds through sealed glass unmuffled.
- `voice-playback`: "Voices carry through the station" muffles a voice hard through sealed glass, so Voss's voice reaches the gallery mainly through the intercom.

## Impact

- **Code:** `src/ai/npcKills.ts` and `src/ai/killRun.ts` (route and fixed timing); `src/actors/humanoid.ts` and `src/actors/animator.ts` (a clip that travels, foot planting and footsteps during a human kill, the jaw following a scream's loudness); `src/actors/speechActing.ts`; `src/physics/interaction.ts` (the scripted cart); `src/audio/occlusion.ts`, `src/audio/voicePath.ts`, the voice graph in `src/world/level.ts` and the kill sound hook in `src/app/session.ts` (per-pane sealed glass).
- **Data:**
  - `src/data/kills.json` (`grownInside`).
  - `src/data/poses.json`: Voss's `kill_*` poses. The names `kill_glass_0` and `kill_glass_1` stay, because the blade creature's pose map borrows them.
  - Voss's clip pack, `src/data/mocap/voss.json`, through `scripts/mocap.sources.json`.
  - `src/data/levels/slice01/rooms/R04.json` (Lab B: route marks, loose bench items, the scripted cart) and
    `rooms/R03.json` (the gallery: the sealed pane).
  - `src/data/sequences/drop.json`, and `quiet_restore.json` for the aftermath.
- **Audio and credits:** new files under `public/assets/audio/` and entries in the area files under `src/audio/sounds/`, following `docs/audio-assets.md`. Her gasps and grunts follow `docs/voice-casting-standard.md`. New sounds and capture takes are credited in `CREDITS.md`, and the takes in `docs/mocap-sources.md`.
- **Order with other work:**
  - rig-necromorph is committed and archived, so its blade creature is the one Voss's burst hands over to. Its pose map borrows Voss's `kill_glass_0` and `kill_glass_1`, its unfold is cued from her burst, and her final resting place must leave its stand point clear.
  - `split-level-data` phase 1a (4409f6b, 2026-11-26) replaced `slice01.json` with one file per room under
    `src/data/levels/slice01/rooms/`. Lab B is `rooms/R04.json`: its route marks, the loose bench glassware and the cart go
    there. The observation glass is the south wall of the gallery, so the sealed pane is marked in `rooms/R03.json`'s
    `layout` (a `wallParams` entry on the three `wall_glass_partition` sides). Doors stay in `doors.json`. Edit the room
    files by hand: `scripts/gen-slice01.mjs` is frozen (phase 1a) and phase 1b deletes it; don't edit or run it.
  - Phase 1b (room shells built from `layout`) changes every room file and must be committed before this change edits
    `R03.json` or `R04.json`.
  - Phases 2 and 4 of `split-level-data` move files this change edits (`poses.json` and `src/data/mocap/` in phase 2,
    `src/world/level.ts` and `drop.json` in phase 4), so they must not run at the same time as this change: this change
    runs entirely before phase 2 starts, or entirely after phase 4 is committed.
  - Phase 3 (sound area files) ran during this change, an exception the user approved on 2026-11-27, before section 8
    added any sound. New sounds go in `src/audio/sounds/<area>.ts`.
  - Code work waits until `keep-crossed-arms` is committed. It was committed as a209f41 and archived on 2026-11-26, so
    this gate is already met. `src/ai/npcKills.ts` has no uncommitted edits now.
  - The drop now starts as Jay walks into the gallery, after her breathing has played over the intercom since the end of the rounds (`gallery-drop`). The fixed clock starts at the end of Okafor's question, which this does not move.
