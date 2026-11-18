# Design Brief: Deep-Sea Horror FPS (working title TBD)

> Detailed, executable decisions live in [docs/adr/](docs/adr/README.md). This file is the summary.

Status: decided via design Q&A. The current INKSHOT wave-shooter is a throwaway prototype; reuse only the Three.js/Vite scaffolding, input and audio plumbing.

## Pitch
A Dead Space-style survival-horror FPS. You are a security officer on a deep-sea base overrun by an infection. You are the best fighter on the team, but two specialist squadmates unlock doors and systems you can't, and feed you spoken hints. Tech demo: a 10-15 minute vertical slice, built so later chapters are just new data. Long-term: a multi-chapter game of a few hours, built as a hobby over time.

## Scope of this slice
- Quiet opening in real-time first person (Half-Life style): the base feels eerily normal, then "the drop" when the first infected appears.
- Scripted set pieces: people transforming, people dragged away and killed behind glass.
- Tutorialised team loop: "Cover me, I'll get this open", you hold a corridor while a specialist works.
- Cliffhanger ending (Option A): after the last fight the engineer, who has been helping the whole time, reveals he is infected and begins to change. Cut to black. Needs earlier foreshadowing (hidden wound, off-screen moment).
- Future chapters go back in time to explain the infection.

## Player
- Security officer, silent in this slice. Dialogue-choice system is planned later; keep the data format ready (empty `choices` field), do not build the UI now.
- Start weapon: security pistol. Shotgun appears partway through.

## Team
- Two AI squadmates, armed and effective, but clearly weaker than the player.
- They act on their own, no commands.
- Specialists: they unlock doors/systems, and speak hints if the player is stuck.
- Cannot die in this slice (they get up after being downed).
- The medic is the only one who can revive the player. If the player goes down while the medic is down, it is game over.

## Enemies
- Slow shambling infected humanoids, built from separate body parts.
- Strategic dismemberment is the core combat mechanic (limbs matter more than headshots).
- Play-dead variant.
- Stretch goal: lunging variant, paired with a dodge mechanic.

## Resources and difficulty
- Ammo/health scarcity depends on a user-chosen difficulty setting.
- Implement as one config table of presets (ammo drops, health drops, enemy damage, enemy toughness).

## Visual direction
- Drop cel-shading. Dark, gritty, realistic-leaning look.
- No real-time ray tracing. Use lighting tricks: few shadow-casting lights (flashlight, flickering emergency lights), baked lighting/AO per room, SSAO/GTAO, bloom, film grain, vignette, volumetric-style fog and light shafts, light flicker as gameplay.
- Target hardware: MacBook Air M2.

## Geometry and assets
- Hybrid. Modular kit (corridors, rooms, pipes, panels, grates, props) behind a "load this piece" interface.
- Procedural pieces first (author has no 3D/texture experience). Swap in GLB files per piece later.
- Enemies and teammates: procedural humanoids with real, separable limbs at first.

## Audio and dialogue
- Every line lives in a data file: id, speaker, text, optional audio path, empty `choices`.
- Voices: subtitles plus non-verbal emote sounds (Zelda-style gasps, grunts, "hey!") from a procedural vocal synth. Recorded files can replace lines later.

## HUD
- Hybrid. Diegetic ammo readout on the gun; minimal DOM overlays (styled as a worn security visor) for health, subtitles, prompts.

## Architecture requirements (so chapters are just data)
- Data-driven levels (module placement, lights, triggers), dialogue, objectives and difficulty.
- Sequence system for scripted moments: timed events, NPC paths, voice lines, camera/look nudges and locks.
- Level built from modular kit pieces; interior corridor collision and door/interact system.
- Enemy body-part damage and dismemberment system.
- Squad AI: follow, shoot, do specialist actions, hint on stuck timer.

## Suggested build order
1. Scaffolding: new project structure, kit-piece loader, dark lighting and post-processing, one corridor.
2. Player movement and pistol in corridors; interact/door system.
3. Shambler with separable limbs and dismemberment; difficulty config.
4. Sequence system and the quiet opening.
5. Squadmates: follow, shoot, specialist-unlock actions, hint system, dialogue/subtitle pipeline.
6. Set pieces (transformation, glass kill), shotgun, play-dead variant.
7. Climax and cliffhanger with the engineer reveal.
8. Polish: audio, atmosphere, HUD, tuning. Stretch: lunger and dodge.

## Open questions
- Overall story ending (deliberately left open).
- Whether squadmates can ever die in later chapters, and whether player failure can hurt them.
- Gamepad support, save system.
- Working title and the infection's origin.
