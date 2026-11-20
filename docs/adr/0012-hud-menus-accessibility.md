# ADR-0012: HUD, menus, settings and accessibility

Status: Accepted (hybrid HUD) / Proposed (layout, settings list)

## Context
The HUD is hybrid: diegetic ammo on the gun, minimal DOM overlays for health, subtitles
and prompts, styled like a worn security visor [Decided]. The game is flicker-heavy horror,
so accessibility settings matter for comfort and photosensitivity.

## Decision
A small DOM UI layer (plain JS modules + CSS, no framework) for HUD and menus, plus a
diegetic "nav pulse" for objectives.

## Details

### HUD elements
| Element | Where | Behaviour |
|---|---|---|
| Health | Bottom-left, segmented visor bar | Hides after 4 s at full health; pulses red < 30 |
| Squad status | Beside health | Two small icons; the medic icon flashes red while he is down (no safety net) |
| Downed | Full screen | Bleed-out ring, "Okafor is coming" / "Okafor is down" state, revives left |
| Reserve ammo | Small, beside the gun screen area | Only on reload or pickup (mag count is on the gun) |
| Crosshair | Centre | Small dot; hidden while aiming (laser instead) |
| Interact prompt | Below centre | "[E] Swipe badge", hold progress ring |
| Subtitles | Bottom centre | Speaker name in their colour, 2 lines max, background box |
| Objective | Top-left | Shown 5 s on change; Tab shows it again |
| Damage/struggle | Full screen | Edge tint (render uniform), "Mash E" prompt |
- Visor styling: thin monospace type, subtle scanlines, slight chromatic offset, cyan-white
  on dark, red for danger. Respect reduced motion (no jitter).

### Nav pulse (diegetic objective locator) [Assumed]
- Press Q: a glowing line projects along the navgraph path from the player to the current
  objective target for 3 s, fading with distance. Cooldown 2 s. Tier-2 hints trigger it
  automatically.

### Menus
See ADR-0016 for the save-related screens (Continue, New Game slots, Load Game, save terminal).
- Title: Start, Difficulty (Story / Standard / Survival), Settings, Credits.
- Pause (Esc): Resume, Settings, Difficulty, Restart from checkpoint, Quit to title.
- End of slice: cut to black, title card, "Thanks for playing" with time and difficulty.

### Settings (localStorage)
- Controls: mouse sensitivity, invert Y, FOV (70-95).
- Graphics: quality tier (Low/Medium/High), film grain on/off.
- Audio: master, music, SFX, voice; vocal emotes on/off; babble on/off (ADR-0010).
- Gameplay: difficulty, gore (Full/Reduced).
- Accessibility: subtitles on/off (default on; turning them off warns that teammates speak only in non-verbal sounds), subtitle size (S/M/L), subtitle
  background opacity, **reduced flashing** (clamps flicker/strobe), reduced
  camera shake and head bob, hold-to-mash alternative for grab struggles, high-contrast
  HUD.
- An epilepsy/photosensitivity notice on first launch pointing to reduced flashing.

### Keyboard navigation
- All menus are fully keyboard-navigable with visible focus; buttons are real `<button>`s.

## Consequences
- The HUD stays thin; more of it can move into the world later.

## Alternatives rejected
- Fully diegetic HUD (suit spine meter): higher cost; possible later.
- React for UI: unnecessary weight for a handful of overlays. [Assumed]

## Execution steps
1. HUD layer and styles; health, prompt, subtitles, objective.
2. Nav pulse.
3. Title, pause, end screens.
4. Settings store and screens; wire accessibility flags to systems.

## Definition of done
- Every setting persists across reloads and visibly takes effect.
- Reduced flashing measurably limits light changes to <= 3 per second.

## Open questions
- Gamepad navigation (follows gamepad support decision).
