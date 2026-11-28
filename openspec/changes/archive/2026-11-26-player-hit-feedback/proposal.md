# Proposal

## Why

When a creature hits the player, the health bar drops and little else registers. The camera kick is about 0.5 degrees, the yaw nudge moves the aim and never springs back, the red flash is the same tint as low health, no impact sound plays, the weapon does not react, and Jay stays silent although his pain grunts are already recorded. Hits should land in the body, the eyes and the ears at once, like Doom 3's fading claw marks, so the player feels where and how hard they were struck.

## What Changes

- Hits carry what struck the player: the attack kind (swipe, bite, slam, grab) and, for a swipe, which arm. Today only the amount and a position reach the player.
- **Flinch by attack:** each kind gets its own camera motion (a swipe jolts away from the arm, a bite pitches forward and down, a slam dips and shakes, a grab tick trembles), scaled by damage and reduced by Reduced motion.
- **Aim punch:** a hit throws the aim off by a small amount that springs back. It replaces today's permanent yaw nudge.
- **Weapon knock:** the held weapon is knocked aside and settles back.
- **Screen scratches:** a claw mark texture atlas (built by a script, with CC0 blood detail), drawn in the final grade, puts claw streaks on the struck side for a swipe, a smear for a bite and an edge crush for a slam. Each mark draws on along the strike, holds briefly and fades over about 1.2 s. Marks stay clear of the crosshair, and only a few show at once.
- **A hit flash apart from low health:** a short directional flash for each hit. The steady low-health desaturation and red edge stay as their own state.
- **Jay's voice:** each hit plays a pain reaction from Jay, picked by hit size (sharp breath, grunt, heavy cry), with a short cooldown so a flurry does not become constant grunting. No subtitles. New takes in those tiers are generated on Jay's pinned voice and model.
- **Impact and low-health sound:** claw, bite and slam impact sounds on the player, a low-health heartbeat (ElevenLabs), and heavier breathing from Jay at low health (his pinned voice).

## Capabilities

### New Capabilities
- `damage-feedback`: how the player perceives being hit, through camera, aim, weapon, screen marks, voice and impact sound, and how that feedback follows the attack's kind, side and size.

### Modified Capabilities
- `post-processing`: "The final grade" requirement splits the damage tint into a short hit flash and the steady low-health state, and adds the scratch marks to the grade.
- `audio-mix`: "Damage muffle" leaves speech unfiltered, so a hit no longer dulls Jay's reaction or a line being spoken.

## Impact

- Code: `src/ai/enemy.ts`, `src/ai/enemyTargets.ts` (pass attack kind and side), `src/actors/player.ts` (flinch, aim punch, hit state), `src/render/post.ts` and `src/app/session.ts` (grade uniforms and the scratch texture), `src/render/viewmodel/viewmodel.ts` (weapon knock), `src/dialogue/barks.ts` and `src/data/dialogue/barks01.json` (pain reactions), `src/audio/sounds.ts` (impacts, heartbeat, breathing).
- Assets: one mark atlas in `public/assets/textures/fx/` built by `scripts/hit-marks-build.ts` (its CC0 sources credited in `CREDITS.md`), ElevenLabs impact and heartbeat sounds (`docs/audio-assets.md`), new Jay reaction takes through `scripts/vo-reactions.ts` (`docs/voice-casting-standard.md`).
- Rendering: one more sampler in the grade pass only. The lit materials' 16-unit budget is unaffected because the grade pass is a separate shader program.
- Existing behaviour kept: the damage muffle's strength and timing, hit slow, the grab view turn and its grab bark.
