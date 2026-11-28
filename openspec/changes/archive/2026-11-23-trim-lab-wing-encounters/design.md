# Design

## Context

See proposal.md for why. What shapes the approach:

- **Lab B can only be seen from the gallery.** R04's `visibleFrom` is `["R03"]` and `D_R04_R05` is a solid bulkhead, so nothing in Lab B can be seen from R05. A "lights come back and it's gone" reveal has to play while the player is still in the gallery, at the end of `drop`.
- The creature is a `shambler` (45 HP) with the `lab_creature` cast look (the Necromorph Slasher body). `hero` (180 HP, 2.15 m) is the R11 boss and the flood elite. Spawn points can set `variant` and `look`, but not health.
- An `emerge` start places the enemy face down at the floor below the point and plays `getUp` (`enemy.ts`). Nothing falls, and `r06_duct` sits under a plain `ceiling` piece.
- Steps that already exist and are reused: `lightState` (per room `dying` / `off` / `flicker` / `steady`), `sfx` at an anchor (one-shot, positional, with `gain`), `hush` (silence everything but named speakers), `score` cues and stingers, `spawnGroup` / `waitGroup` / `despawn`, `cameraShake`.
- The coolant line already runs from Lab B's service wall along R05's ceiling to Giles's panel in R06 (lab-wing spec). The creature's route follows it, so what you hear matches what you can see.

## Goals / Non-Goals

**Goals:**
- One creature, followed by ear from the gallery to R06, with one fight at the end.
- A drop-in that is seen and heard: a grate that breaks, a body that falls, a landing.
- Reuse existing steps for the timing, so most of the beat is data in the sequences.

**Non-Goals:**
- No climbing animation and no creature visible in the ducts. The blackout hides the exit.
- No physics bodies. The falling grate is a scripted fall, so this change doesn't depend on `adopt-physics-engine`.
- R09's spawn count. That is a task in `overhaul-flooded-tunnel`.
- R08 (Priya's kill). That change is paused, and this change touches only the `r07_playdead` steps in `sec_glass`.

## Decisions

### D1. The escape plays at the end of `drop`, in the gallery
It's inserted after `drop_okafor_03` and before `drop:done` / `playerControl reset`, while Jay is still at the gallery glass.

| t (s) | Step |
|---|---|
| 0 | The creature hammers in three flurries (the existing glass-hammer loop), with `contact_giles_01` "Is that one of the lab techs?" and `contact_okafor_01` "Not any more." |
| ~4 | `score labB cue escapeDark` (drone only). `lightState R04 dying`, then `off` 0.6 s later. `hush` (squad speakers allowed). |
| ~5 | `sfx ventCoverRip` at `anchor:labb_vent`. Despawn the creature. Show the R04 grate as open. |
| ~5.5–8 | `ductBang` / `ductScrape` at `duct_r04`, then `duct_r05_1`, with falling gain (moving away and up). |
| ~8.5 | `lightState R04 flicker`, then `alarm`. On the first lit frame: `sfx ambushSting` (the jump stinger, as built; swap after the by-ear check in task 3.3), `hush off`, `score labB cue hold`, `cameraShake` (small). The dark keeps `sfx` up with `hush keep: ["sfx"]` so the escape sounds carry. |
| ~10 | Return to `hold`. The rest of `drop` continues. |

Alternative considered: a separate trigger sequence when the player looks at the glass after `drop`. It was rejected because the player could already be walking away, and the reveal only works if they're looking.

No new flag. `drop_done` means the creature has escaped. On load with `drop_done`, the creature is not placed behind the glass and the R04 grate is open. `skip` applies that end state.

### D2. R05 hears the creature pass overhead
`contact` loses the knocks on `D_R04_R05`, the door opening, `spawnGroup r05_contact` / `r05_trickle`, both `waitGroup`s, `contact_okafor_03`, `contact_after_01`, `contact_okafor_02`, and the `door` / `end` cues. In their place, after the objective: a pass of 4–5 `ductBang` / `ductScrape` sounds at `duct_r05_1..3`, then `duct_r06_0` (by the `D_R05_R06` wall), each louder or nearer R06. Then `okafor_revive_rule_01` and the blackout beat as before. `D_R04_R05` stays `sealed`.

### D3. R06: the creature arrives during the bypass
In `cover_me`, after `giles_cover_01`, `cover_giles_01` (re-recorded) and the bypass start (still `wait: true`, 20 s), a parallel branch runs:

| t (s) | Step |
|---|---|
| 1–3 | Distant `ductBang` at `duct_r06_1` (behind Jay, over the corridor) |
| 3–6 | Heavier bangs at `duct_r06_2`, `duct_r06_3` over the room, plus a scrape, and `cameraShake 0.08`. (No dust: the game has no dust particle yet; adding one is follow-up work.) |
| 6–7.5 | Silence: the score drops to the drone (`score labB cue dropHush`) |
| 7.5 | `sfx ventCoverBurst`, R06 grate falls (D5), `spawnGroup r06_cover` (drop start, D4), `score labB cue door` (slam and fight layers) |
| on land | `say contact_okafor_03` ("Legs! Take its legs!") |

After `waitGroup r06_cover`: `score labB cue end`, then `say contact_after_01`, then the existing flex-hand / infection beat. The bypass and the fight run independently, as they do now.

The Lab B score now plays until `cover_me` ends. Resume entries: `drop_done && !contact_done` and `contact_done && !cover_done` both resume at `hold`. The score's audio is released when `cover_done` is set, not `contact_done`.

### D4. `hp` and `drop` on spawn points
- `hp?: number` on a spawn point. It replaces `tuning.baseHp` before the difficulty multiplier. `r06_duct` gets `hp: 90`, `look: "lab_creature"`, `kind: "ceiling"`, `start: "drop"`, `count: 1`.
- The `drop` start: the enemy spawns at the point's position (not snapped to the floor), falls under gravity in a tucked pose to `floorBelow` (the same probe `emerge` uses, so the enemy-encounters "not on a slab above" rule still holds), and on contact plays `creatureLand`, a `cameraShake` scaled by fall height, `corpseProne` and then the existing `getUp`. It's already hunting the player, like `emerge`.
- Alternative considered: a new `elite` variant in `enemies.json`. It was rejected because only health differs, and a variant would also change moves and attacks.

### D5. Ceiling vent grate piece
A new kit piece, `ceiling_vent`: a framed grate in a ceiling cell, with bloom dressing at R06. It has a state of `closed` / `open` (grate hanging from one hinge) / `fallen` (grate on the floor below), set by a new `ventState { id, state, instant? }` step (there is no generic prop-state step). Loads get it back the way doors do: `action_restore` re-applies it `instant` from `drop_done` and `cover_done`. `fallen` animates a 0.5 s scripted fall with one bounce and `grateClatter` on impact. The grate has no collider once it has fallen. It is placed per `docs/modular-grid-standard.md` at R04 (seen from the gallery, clear of the Voss sight line) and at R06 over `r06_duct`, within sight of the hold point.

### D6. Sounds
Generated per `docs/audio-assets.md` and credited in `CREDITS.md`:

| Name | Variants | Use |
|---|---|---|
| `ventCoverRip` | 1 | Lab B, in the dark |
| `ventCoverBurst` | 1 | R06, the grate kicked out |
| `ductBang` | 4+ | Heavy body weight in sheet-metal duct |
| `ductScrape` | 2+ | Claws or body dragging in the duct |
| `creatureLand` | 2 | Heavy landing on deck plate |
| `grateClatter` | 1 | The grate hitting the floor |
| `reveal` (stinger) | 1 | Only if `slam`, `stab` and the flood change's `ambushSting` all fail the reveal by ear |

Duct sounds play from anchors placed 0.3–0.5 m above the ceiling, so the ceiling sits between the sound and the player. If the positional mix doesn't make them sound muffled, add a low-pass to those sounds' entries.

### D7. VO
`cover_giles_01` is re-recorded as "Twenty seconds. Maybe thirty. Keep it off me!" on Giles's pinned voice, per `docs/voice-casting-standard.md`. `contact_okafor_02` is deleted from the dialogue data and `vo-takes.json`, and its mp3 is removed. Nothing else is recorded.

### D8. Removed spawns
`r05_door`, `r05_vent`, `r05_drain`, `r06_trench`, `r06_vent_e`, `r06_corridor` and `r07_playdead` are removed from the level. `sec_glass` loses its `waitGroup r07_playdead` (and its 20 s timeout) and `despawnGroup r07_playdead`. The kit pieces stay as dressing: the R05 drain grate, the R06 trench grate with its pushed-aside panel, and the wall vents.

## Risks / Trade-offs

- **[One 90 HP enemy might not fill a 20 s bypass]** → It arrives about 7.5 s in, so about 12 s of fighting is needed. If playtests show it dies too fast, shorten the bypass rather than adding enemies.
- **[The first fight of the game is now a 90 HP creature]** → The legs lesson plays on landing, and Okafor's revive rule plays just before in R05. Check the difficulty in the playtest.
- **[Duct sounds that don't seem to come from overhead]** → Anchors above the ceiling, plus an optional low-pass (D6). Checked by ear in the browser.
- **[`sec_glass` overlaps the paused `overhaul-priya-r08-death`]** → Only the two `r07_playdead` steps change. Note it in that change's tasks so it isn't lost on a merge.
- **[The `labB` score is also edited by `overhaul-flooded-tunnel` (flood cues)]** → This change adds new cues only (`escapeDark`, `dropHush`, `reveal` if needed) and doesn't touch theirs.
- **[Old saves inside the old R05 fight]** → A save at `cp_drop` still loads: `contact` runs its new steps. No save holds `r05_*` group state past `cp_contact_clear`.

## Migration Plan

Data and code ship together. To roll back, revert the change. Saves need no migration (D1, last risk).
