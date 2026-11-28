# Proposal

## Why

Health, stamina and ammo are still the placeholder readouts: two flat slanted bars bottom-left and a number bottom-right. They tell the player the numbers but nothing about the moment: a hit, a heal, a reload or a dry trigger all look the same. Thalassa already promises a security visor (the boot splash draws its brackets and telemetry), so these readouts should become light projected on Jay's visor glass that reacts to what happens to him, without leaving the first-person view or breaking the dark.

## What Changes

- **Visor projection look:** the vitals and weapon readouts become two panels tilted in perspective as if projected onto curved glass near the cheeks, drawn additively with a soft glow, faint scanlines and a slight colour fringe. Faint corner brackets and a thin arc at the screen edges mark the visor rim; nothing else frames the view.
- **Visor inertia:** the panels lag a few pixels behind camera turns and head bob and spring back. Off with Reduced motion.
- **Biomonitor panel (bottom-left):** health in four 25-point segments, a chip trail that lingers where health was and drains after a hit, a fill-up with a rising `+N` on a heal, an ECG trace with a BPM figure that quickens as health falls, a stamina bar that shows only while stamina is not full and turns amber while exhausted, and the downed bleed-out countdown and revives left inside the panel, replacing today's separate red status box.
- **Weapon panel (bottom-right):** weapon name and line-art silhouette, one pip per loaded round (12 for the pistol, 6 shell icons for the shotgun), loaded and reserve counts, a pip that blinks out per shot, pips that clear and refill over a reload (shell by shell for the shotgun), `EMPTY · [R]` on a dry fire, a glitch over to the other weapon on a swap, and a rising `+N` when ammo is picked up.
- **Visor reactions:** the panels boot up line by line when the HUD first appears in a session; a hit jolts the panel on the struck side and tears its signal briefly (no flicker with Reduced flashing); with nothing happening at full health the panels dim to a whisper and return on a hit, a shot, a reload, sprinting or a weapon change.
- **Settings:** HUD opacity and HUD scale, and a calm-mode switch (on by default).
- Numbers stay on screen in every state, so colour and motion are never the only cue.
- **Out of scope:** anything drawn in the 3D scene or the final grade (gun-mounted counters, a wrist display, visor cracks or condensation). Screen-space hit flash, scratch marks and hit sounds stay with `player-hit-feedback`.

## Capabilities

### New Capabilities
- `visor-hud`: the player's health, stamina and ammo readouts as a projection on Jay's visor: what each panel shows, how it reacts to damage, healing, firing, reloading, pickups, being downed and idling, the visor rim, motion and accessibility settings, and when the panels are hidden.

### Modified Capabilities
- None. `hud-wayfinding` keeps its requirement that the objective list stays clear of the bottom-right ammo; the weapon panel keeps that corner.

## Impact

- Code: `src/ui/hud/playerHud.ts` (vitals and ammo move out into new visor modules under `src/ui/hud/`), `src/ui/styles/hud.css` (or a new `visor.css`), `src/core/settings.ts` and the settings menu in `src/ui/menus/` (opacity, scale, calm mode), `src/app/session.ts` (wiring the bus and the camera into the HUD), `src/game/game.ts` (passing play time and frame time to the HUD). The HUD only listens to existing events (`player:*`, `weapon:*`, `pickup:taken`); the player, viewmodel and post-processing code do not change.
- Rendering: DOM, CSS 3D transforms and small inline SVG only. No texture units, no WebGL passes, no change to `post.ts`.
- Coordination: `player-hit-feedback` adds attack kind and side to `HitInfo`; the hit jolt uses the side when present and falls back to a centred jolt until then. `session.ts` and `viewmodel.ts` currently carry other agents' uncommitted edits, so the wiring hunk in `session.ts` is committed on its own.
