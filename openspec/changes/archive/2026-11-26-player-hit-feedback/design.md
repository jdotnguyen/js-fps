# Design

## Context

See proposal.md for why. What exists today:

- `Enemy` calls `EnemyTarget.hurt(amount, from, kind)` with `kind` in `swipe | bite | grab | slam`, and knows the striking arm (`strikeSide`, set before `body.strike`). `enemyTargets.ts` drops `kind` and calls `player.damage(amount, from)`.
- `Player.damage` sets `hitPulse = 1`, `hitSlow`, adds 2.2 to `kickVel`, and adds `±0.015` rad straight to `yaw` (a permanent aim change). The kick spring (`-60x - 9v`) is shared with weapon recoil via `addKick`, and `applyCamera` applies it as `kick * 0.06` rad of pitch, so the hit kick peaks at about 0.5 degrees.
- `damageFx` combines the hit pulse, the low-health pulse and the downed/dead darkening into one value, `uDamage`, in the grade (`src/render/post.ts`). The grade runs on every tier (Low drops only bloom).
- Jay has three pain takes (`react_jay_pain_01-03`, Orus on `gemini-3.1-flash-tts-preview`) used only by the grab bark. `barks.ts` already has `reaction: true` rules for Jay that skip the global cooldown and play over story lines.
- `player:damaged` already drives the mix muffle (`audio-mix`), the low-health hint and the combat events.
- Texture units: the 16 per-program limit (ANGLE/D3D11 on the desktop GPU) is full in the heaviest lit materials on High. The grade pass is its own program and binds only the input buffer and the eye-adaptation state.

## Goals / Non-Goals

**Goals:**
- One hit event that every feedback channel reads, so camera, weapon, marks, flash, voice and sound stay in step.
- Hit feedback that is driven by tuning data, testable without a browser (pure functions for the flinch, mark picker and reaction picker).

**Non-Goals:**
- Squadmate hit feedback, enemy-side hit reactions, damage numbers or a separate direction indicator around the crosshair.
- Changing damage amounts, difficulty scaling, the muffle's strength or timing, hit slow, or the grab view turn.
- Lifting the 16-unit limit for lit materials (texture arrays or atlases are a separate project).

## Decisions

### D1. One `PlayerHit` record, emitted once
`EnemyTarget.hurt` gains an optional `side: 'L' | 'R'` (the attacker's arm); `enemy.ts` passes `strikeSide` for swipes and grab ticks. `Player.damage(amount, from, hit?)` takes `{ kind, side }`, defaulting to a `generic` kind. `player:damaged` gains `kind`, `side` (the side of the view the arm comes from, or null), `dir` (screen-space direction from the view to `from`: left/right and above/below) and `severity` (`amount / 25`, clamped 0..1, after difficulty scaling).

The event's `side` is not the arm's name: a creature facing the player has its right arm on the left of the view. `Player` places the arm beside `from` (the attacker faces the player when it strikes) and takes the side of the view it falls on, so a blow from behind keeps the arm's own side. Every channel (flinch, flash, marks, weapon knock) reads this view side.
*Alternative:* a second `player:hit` event. Rejected: two events for one hit invite double handling; extending the payload is backward compatible for the current listeners.

### D2. A hit spring separate from recoil
A new `HitFlinch` module (`src/actors/hitFlinch.ts`) owns three damped springs, pitch, yaw and roll, each critically damped around 0.3 s. A per-kind table sets the impulse direction and size (swipe: roll and yaw away from `side`, small pitch; bite: pitch down plus a forward camera push; slam: pitch down, vertical dip and a 0.25 s noise shake; grab: low tremor; generic: a small pitch up). The size scales with `severity`.
- **View shake** is the camera offset only (`cam.rotation` and position in `applyCamera`).
- **Aim punch** is a share of the same impulse (about 35%) added to `yaw`/`pitch` and then removed again by its own spring, so the net lasting change is below 0.3 degrees. This replaces the direct `yaw += side * 0.015`.
- Reduced motion multiplies the impulse by 0.3.
- Weapon recoil keeps the existing `kick` spring untouched; a hit no longer feeds it.
- A grab tick is only a tremor, with no direction, so it does not punch the aim. Nor does any hit punch it while a scripted shot, a look assist or the grab owns the view.
*Alternative:* scale up the shared kick spring. Rejected: it is one axis, shared with recoil, and tuning one breaks the other.

### D3. Weapon knock through the viewmodel's existing springs
The viewmodel already has sway and recoil springs (`src/render/viewmodel/viewmodel.ts`). It gets a `knock(dir, severity)` that pushes its position and roll springs towards `dir.side`. Session wires `player:damaged` to it. No new animation clips, and the fire state machine is untouched, so firing during a knock still works.

### D4. Claw marks: one imported atlas, drawn in the grade
- **Texture:** one 2048x1024 RGBA atlas at `public/assets/textures/fx/hit-marks.webp` (lossless WebP, matching the other textures; loaded without mipmaps, linear colour, since it is a data mask): 4 swipe variants, 2 bite smears, 1 slam crush, 1 spare. Channels: R = mark mask (the cut), G = wet/blood amount, B = an offset height used to warp the frame under the mark, A = a draw-on ramp along the swing (0 at the start of the stroke, 1 at its end), so one uniform can "draw" a stroke on.
- **Source:** `scripts/hit-marks-build.ts` draws the cuts, bite punctures and slam fractures from a fixed seed and takes their wet detail from the CC0 Texture Ninja blood decals already in `public/assets/textures/blood/` (credited), so the atlas rebuilds byte for byte. No CC0 claw-streak set was found and the project's Gemini key has no image quota (2026-11-26); the user chose the script-drawn atlas over supplying a texture or enabling billing. Mark art stays inside the reach the picker assumes (`MARK_REACH`).
- **Shader:** the grade gets `uMarks` (the atlas) and a small uniform array of 3 slots, each `vec4 rect` (atlas cell), `vec4 place` (screen centre, scale, rotation), `vec2 state` (draw-on 0..1, opacity 0..1). For each live slot the fragment shader maps `uv` into the cell, reads the atlas, darkens and reddens the frame by R·G·opacity, and offsets the `inputBuffer` read by the B gradient for a slight warp. It runs before the vignette and grain, so marks take both.
- **Placement:** a pure picker (`src/render/hitMarks.ts`) chooses variant, centre, rotation and mirror from `kind`, `side` and `dir`. Swipes go on the struck third of the screen, rotated along the swing; bites low-centre-to-side; slams along the bottom. A circle of about 18% of screen height around the crosshair is kept clear. It never repeats the previous variant and placement, and replaces the oldest slot when all three are live.
- **Timing:** draw-on 0.08 s, hold 0.25 s, fade 1.0 s (eased), opacity `0.55 + 0.45 * severity`. Marks advance on game time, so pause holds them; `player.reset` clears them.
*Alternatives:* a CSS overlay (no frame interaction, ignores exposure); procedural shapes in the shader (no sampler, but much harder to make look like real cuts). The user first chose an imported texture, then the script-drawn atlas when none could be sourced.

### D5. Hit flash split from low health
`damageFx` becomes two values: `uHitFlash` (0..1, plus a `uHitDir` vec2 that weights the red edge towards the struck side, fades in about 0.35 s) and `uDamage` (the steady low-health, downed and dead state, as today without the hit pulse). The grade adds them. The low-health pulse and the downed/dead values are unchanged.

### D6. Pain reactions picked by severity
New reaction pools in `barks01.json`: `hurt_jay_light` (sharp breath, hiss), `hurt_jay_mid` (grunt), `hurt_jay_heavy` (cry; also for the hit that downs him). Each is a line with `subtitle: false` (a new optional line field). `barks.ts` picks one outside the rule table and says it 90 ms after the blow, so the impact is heard first, as an `overlap` line so it never waits behind story. A small picker chooses the tier from `severity` (below 0.3 light, below 0.7 mid, else heavy) and enforces a 1 s gap. A heavier tier may cut a lighter reaction still playing; the same tier waits for the gap. No take repeats twice in a row (already how bark pools pick). The grab keeps its own `grab_jay` rule; grab-tick damage does not also trigger a hurt reaction while grabbed.
Takes: 5 per tier, generated by a new `react_jay_hurt` batch in `scripts/lib/voReactionBatches.ts` on Jay's pinned Orus / 3.1 entry, following `docs/voice-casting-standard.md` (copy raw takes aside right after generation: `retake_<speaker>_01.wav` is shared). The existing three pain takes join the mid tier.

### D7. Impact sounds and the low-health bed
- ElevenLabs sound effects per `docs/audio-assets.md`, registered in `src/audio/sounds.ts`: `hitClaw` (4 variants), `hitBite` (3), `hitSlam` (3), and a looping `lowHeartbeat`. Impacts are played non-positional at the listener on `player:damaged`, with small rate and gain variation, before the voice reaction. A grab tick has no impact; a generic hit plays the slam's thud more quietly. The heartbeat's kept file is a 6 s loop made from one beat of the generated take, which beat unevenly.
- Low-health breathing comes from Jay's voice (`react_jay_breath` batch, Orus / 3.1, 2-3 loopable takes), not ElevenLabs, so it matches his dialogue.
- Heartbeat and breathing fade in when `vitals.low` turns true and out when it turns false or the player is downed (the downed state has its own sound). Their gain sits under dialogue, so speech stays clear.

### D8. Speech goes round the damage muffle
In `AudioEngine` the muffle filter moves ahead of `master`: the `sfx`, `ui`, `music` and `ambience` buses and the reverb returns feed it, and the `voice` bus feeds `master` directly. Heard in play, Jay sounded muffled and quiet: the muffle starts with the blow, his reaction starts 90 ms later and mostly ends inside it, and each new hit restarts it, costing a take up to 11 dB. The user chose clear speech for every speaker (2026-11-26). The impact's tail is still dulled.
*Alternatives:* only Jay's lines go round it (needs a second voice route for one speaker); a milder muffle for everything (weakens the stunned feel and still dulls him).

## Risks / Trade-offs

- [Aim punch frustrates in tight fights] → the punch is a share of the flinch with its own tuning value, and lasting drift is capped at 0.3 degrees; tune by playtest before shipping.
- [Marks hide a creature at the edge during a fight] → three slots maximum, clear crosshair zone, 1.3 s total life, opacity tied to severity.
- [Grunt fatigue in long fights] → 1 s gap, 5 takes per tier, no repeats in a row.
- [A third sampler in the grade program on some GPU] → the grade uses 2 today; 3 is far below any WebGL2 limit (minimum 16).
- [Atlas memory] → one 2048x1024 RGBA texture without mipmaps is 8 MB of GPU memory; check with `?slot=scratch&memprobe` (spec `runtime-memory`).
- [Gemini quota stops the VO batch partway] → per the casting standard the run reports missing batches; the light and heavy tiers can ship with fewer takes and be filled later.
- [Pause or scene cuts leave stale marks] → marks run on game time and clear on reset, restore and title (spec scenario).

## Migration Plan

No save data changes. Each part can ship alone behind its own wiring in `session.ts`; rollback is removing the listener. The `player:damaged` payload only gains fields, so current listeners keep working.
