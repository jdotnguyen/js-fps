# ADR-0008: Difficulty and resource economy

Status: Accepted (presets, names) / Proposed (exact numbers, tuned in playtest)

## Context
Ammo and health scarcity should depend on a difficulty setting the player chooses
[Decided]. Squadmates must help without overshadowing the player [Decided].

## Decision
Three presets in `data/difficulty.json`, all game tuning reads from the active preset,
plus a need-based drop system bounded by difficulty.

## Details

### Presets [Decided names; numbers tuned in playtest]
| Key | Story | Standard | Survival |
|---|---|---|---|
| `playerDamageTaken` | 0.5 | 1.0 | 1.4 |
| `enemyHp` | 0.75 | 1.0 | 1.25 |
| `enemyLurchInterval` (x) | 1.4 | 1.0 | 0.8 |
| `startReserve.pistol` | 48 | 36 | 24 |
| `startReserve.shells` (on pickup) | 12 | 8 | 4 |
| `dropChance.ammo` | 0.8 | 0.55 | 0.35 |
| `dropChance.health` | 0.25 | 0.15 | 0.08 |
| `medPack.heal` | 50 | 40 | 30 |
| `grabMashCount` | 4 | 6 | 9 |
| `squadDamage` (x player weapon) | 0.6 | 0.45 | 0.35 |
| `squadAccuracy` | 0.55 | 0.45 | 0.35 |
| `bleedOutTime` (s, while downed) | 30 | 20 | 12 |
| `reviveHp` | 60 | 40 | 25 |
| `revivesPerCheckpoint` | unlimited | 3 | 1 |
| `medicDownedTime` (s, he gets up alone) | 6 | 10 | 15 |
| `hintDelay` tier 1 / tier 2 (s) | 20 / 40 | 45 / 90 | 90 / 180 |
| `checkpointHeal` (refill to) | 100 | 70 | 50 |

### Need-based drops ("director-lite")
- When an enemy dies, roll a drop. Weight toward what the player lacks:
  if reserve < 1 magazine, ammo chance x1.5; if HP < 40, health chance x2.
  Never exceed 1.0; never drop ammo for a weapon not owned.
- Placed pickups in level JSON (lockers, desks) are fixed, so routes are learnable.

### Changing difficulty
- Chosen on the title screen; can be changed from the pause menu at any time. Changes apply
  immediately to future damage and drops.
- Persisted in `localStorage`.

## Consequences
- Every system takes numbers from `ctx.difficulty`; hard-coded tuning numbers are a bug.

## Alternatives rejected
- Fully dynamic adaptive difficulty: opaque to the player and hard to tune.

## Execution steps
1. Preset file + loader + `ctx.difficulty`.
2. Wire into player damage, enemy HP, drops, squad, hints.
3. Pickup system (shared with ADR-0005).
4. lil-gui live override in debug.

## Definition of done
- Switching preset in the pause menu changes damage taken and drop rates immediately.

## Open questions
- None blocking.

## Progress 2026-11-17: step 3 (pickups) and drops
- `game/pickups.ts`: placed amounts at Standard 12 rounds / 4 shells / medPackHeal; other
  presets scale ammo by their startReserve against Standard (Story 16/6, Survival 8/2) and
  medkits by medPackHeal. Enemy `enemy:died` rolls the need-based drop (health x2 under 40 HP,
  ammo x1.5 under one magazine, the emptier owned weapon, half a box rounded up). Medkits are
  left in place at full health. Difficulty changes apply to the next pickup.
- Hints read `hintDelay` live from the preset.
