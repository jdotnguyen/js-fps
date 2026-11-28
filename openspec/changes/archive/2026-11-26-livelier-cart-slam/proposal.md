# Proposal

## Why

The three head slams on the R08 instrument cart look and sound static. The cart and everything on it are a single
fixed mesh, the hits land on an even beat, and each one plays the same two downloaded clips: a door slam and a
glass break. Nothing on the cart visibly breaks, so the glass break sounds pasted on. Now that the physics engine is
in (`adopt-physics-engine`), the cart's load can fly, land and be heard where it lands. Players on default settings
should see it, so the change depends on that change turning physical interaction on by default.

## What Changes

- **Loose instruments on the cart.** The dish, tools, wrapped pack and shelf items become loose physics props, plus a
  few vials and a steel bowl. They are placed flush on a tray surface that matches what is drawn.
- **Each slam throws them.** A new kill event, `burst`, throws the loose props near the impact upward and outward
  once. The hits escalate: on the first the small things hop, on the second most of the top is swept off, and on the
  third the shelf load tips out. Most of the throw goes sideways, with a little toward the glass.
- **The cart reacts.** It dips, rocks and rolls a few centimetres on each hit, and ends up skewed. The motion is
  scripted, not simulated, so the slam target stays where her head lands.
- **Uneven rhythm.** The three hits are retimed, with a longer wind-up before the last.
- **New impact sounds, without the glass break.** `cart_glass_break` is removed from the slam and from the game,
  along with its `CREDITS.md` row. Each hit layers the existing head crunch, one of three heavy steel tray impacts
  and an instrument rattle. Every loose instrument plays its own clink when it lands on the floor, the glass or the
  cart, louder the faster it lands, using the loose-prop impact sounds `adopt-physics-engine` is adding (its design
  D16, `src/audio/impacts.ts`). When the steel dish lands hard, it spins down to rest. The intercom carries all of
  it, like the scene's other sounds.
- **A small jolt for the player.** Each hit gives a light view shake in the security office.
- **Her landing clears a space.** When she is thrown to the foot of the pane, instruments there are knocked aside so
  they do not show through her body.
- **Skip and restore show the aftermath.** A skipped or restored scene leaves the instruments on the floor in a fixed
  scattered layout, and the cart skewed, with or without physics.
- **Not in this change:** light flicker on the hits, and real physics for Priya's or the creature's body (ragdolls are
  parked in `add-physics-ragdolls`).

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `medbay-attack`: the slams scatter the cart's load and shake the view, each hit sounds different and plays no glass
  break, the loose instruments are exempt from the stage-clear rule, and skip or restore leaves them scattered.
- `physical-interaction` (added by `adopt-physics-engine`, not yet archived): a scripted impact can throw loose props,
  and a skipped or restored kill can lay loose props out at authored poses.

## Impact

- **Code:** `src/ai/npcKills.ts` and `src/data/types/kills.ts` (the `burst` event, the cart jolt, the scattered layout
  on skip); `src/physics/interaction.ts` (burst impulse, placing a body on skip, a kinematic prop);
  `src/audio/impacts.ts` (a voicing for small steel instruments, if `metal` does not suit); `src/world/kit/slice.ts` (`instrument_cart` split into the cart and
  separate loose items, tray collision); `src/world/level.ts` if a prop needs a scattered pose;
  `src/app/session.ts` (wiring, the view shake on `kill:impact`).
- **Data:** `src/data/kills.json` (`mauled` slam and throw beats), `src/data/levels/slice01.json` (R08 props).
- **Audio:** new files in `public/assets/audio/gore/` for the tray impacts, the rattle, the clinks and the dish
  spin-down; `src/audio/sounds.ts`; `CREDITS.md`; `public/assets/audio/gore/cart-glass-break.mp3` deleted.
- **Tests:** `src/world/slice01.test.ts` (stage and lane rules skip loose props), `src/ai/npcKills.test.ts`,
  `src/script/action.test.ts`, new physics tests in Node.
- **Depends on:** `adopt-physics-engine`: its loose-prop impact sounds (design D16, in progress), and turning the
  `interact` switch on by default (its task 6.7) in a way that also reaches players whose saved settings already
  store `interact: false` (see design). Archive this change
  after that one, since its `physical-interaction` delta adds to a capability that change creates.
- **Budget:** about 10 loose props in R08, each about two draw calls plus a shadow.
