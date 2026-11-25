# Design

## Context

See `proposal.md` for motivation. `r15a_train_ride` (`src/data/sequences/action_climax.json`) currently drives the 3-stage abyssal ride and hands off via `transit:arrived_r16` with Train Car B parked at `R16a` (`[88, -0.6, 35]`, west boarding door facing `-X` across the platform toward `R16b`'s central aisle at `z = 36`), boarding door closed, and `r16a_north` sealed. `R16a` and `R16b` already have all blood decals, 18 fallen crew corpses (including `r16_pillar_body` at `[73.6, 0, 33.4]` beside the NE pillar `[73.5, 0, 31.2]`), named overhead lights, blackout hooks (`tintRoomLights`), and fullscreen `cameraFeed` support (`src/render/cameraFeed.ts`). Existing `title_card` -> `stinger_priya` -> `endSlice` sequences already listen for `story:cliffhanger`.

## Goals / Non-Goals

**Goals:**
- Deliver the complete R15b power-loss -> R16a pitch-black arrival -> R16b surveillance finale -> `story:cliffhanger` sequence with zero shader recompiles (strict fixed light budget) and tight audio/visual timing.
- Generate all new VO lines on each speaker's pinned Gemini TTS model (`docs/voice-casting-standard.md`), plus ElevenLabs SFX. Cut the scene audio on the final blackout.
- Provide `?debug&jump=r16_finale` for fast browser iteration.

**Non-Goals:**
- Playable free-roam combat in `R16a`/`R16b` (the arrival is a pure cutscene transitioning into fullscreen surveillance).
- Adding new rooms or modifying `R16c`.

## Beat-by-Beat Timeline (Dialogue, Audio, Lights & Cameras)

### Part A — Tunnel Power Loss (Extension of `r15a_train_ride`, Stage 2 -> Stage 3)

| Offset | Beat | Dialogue (ID / Speaker / Emote / Channel) | SFX | Lights, Cameras & Actions |
| --- | --- | --- | --- | --- |
| Right after `r15a_heins_04` static | **1. Traction power drops** | — | **`trainPowerDown`** (heavy rail-bus contactor trip + electric whine dying out) | `transit:tunnel_power { mode: 'emergency' }`: `R15b` hallway ribs/guides and `R16a` north shroud shift to dim emergency red. Train cabin lights stay steady warm tungsten (no flicker). |
| `+1.2 s` | **2. Reserve coasting PA** | `r16_pa_01` — **Station PA** (`neutral`, **`pa`**): *"Attention. Primary rail traction power has been lost. Engaging reserve battery drive. Proceeding to nearest station for mandatory safety shutdown."* | `paChime` before line; `trainTunnelCruise` drops lower/quieter | `tunnelSeconds` extended (~`54 s`) so PA finishes cleanly before Stage 3 deceleration. |
| Stage 2 decel -> Stage 3 | **3. Pitch-black R16a glide-in** | `r15a_giles_04` / `r15a_okafor_03` *(existing)* | `trainBrakeStop`, `blastGateOpen` (`r16a_north`) | Before Stage 3 enters `R16a`, black out `R16a` and `R16b` (`tintRoomLights` `'black'` + overhead lights `off`). Lock Jay into cutscene (`playerControl` locked, `weapons: false`, `flashlight: false`) and `playerFrame` Jay looking out the right-side (west) windows down at the dark `R16a` platform floor (`anchor:r16_floor_blood_look`). |

### Part B — Pitch-Black Arrival & Massacre Reveal (`r16_arrival_finale`, triggered on `transit:arrived_r16`)

| Rough Time | Beat | Dialogue (ID / Speaker / Emote / Channel) | SFX | Lights, Cameras & Actions |
| --- | --- | --- | --- | --- |
| `0:00` | **4. Docked in darkness** | — | `blastGateClose` (`r16a_north` seals); eerie dead silence | Train Car B stopped. Cabin lights steady. `R16a`/`R16b` pitch black. Camera holds on dark platform floor outside the window. |
| `0:01.4` | **5. Auxiliary lights PA** | `r16_pa_02` — **Station PA** (`neutral`, **`pa`**): *"Arrival Terminal reached. Safety shutdown complete. Engaging auxiliary exterior lighting."* | `paChime` + heavy relay clunk (`breakerClunk`) | `transit:train_aux_lights { on: true }`: two pre-allocated downward exterior spotlights on Train Car B click on, casting crisp pools onto the platform floor right outside the boarding gap—revealing dark glossy blood pools. |
| `0:06.2` | **6. Blood hint & pan up** | `r16_jay_01` — **Jay** (`dread`, `local`): *"Wait... is that blood?!"* | — | `playerFrame` smoothly pans Jay's view up (`duration: 2.0 s`) from the platform floor to eye level looking west across the stairs into `R16b` (`anchor:r16_concourse_look`). |
| `0:08.5` | **7. Bass hit + 3x bright flicker reveal** | — | **`r16HorrorHit`** (smooth 80 ms curved onset low-end horror bass impact) + `fluorescentBuzz` | `R16a` and `R16b` flash bright **3 times** (`reducedFlashing` safe) while Jay slowly backs up to `r16_train_back`. No body drag (`r16_pillar_body` stays stationary). |
| `0:10.5` | **8. Tense cabin banter** | `r16_giles_01` (`~0.35 s` trimmed pause), `r16_okafor_01`, `r16_jay_02`, `r16_giles_02` | — | Speaker-tracked cabin framing (`playerFrame` `target: "speaker"`). Cut to black with `r16Cut` as Giles finishes `r16_giles_02` so weapon-draw transitions stay hidden. |

### Part C — Fullscreen Surveillance Finale & Slow Juggernaut Face Reveal (`CAM 09` -> `CAM 10` -> Blackout)

| Rough Time | Beat | Dialogue (ID / Speaker / Emote / Channel) | SFX | Lights, Cameras & Actions |
| --- | --- | --- | --- | --- |
| `0:22.0` | **9. Door opens -> Cut to CAM 09** | — | `intercomClick` | Jay's flashlight forced `off` and viewmodel hidden. Fullscreen **`cameraFeed`** `id: "r16_cam"` (`label: "CAM 09  ARRIVAL DOCK"`, `fps: 24`, `size: { w: 960, h: 540 }`, `look: "fullscreen"`). Score stays off for surveillance feeds. |
| `0:23.5` | **10. "Flashlights on."** | `r16_okafor_02` — **Okafor** (`urgent`, **`radio`**): *"Flashlights on. Check your corners."* | `consoleBeep` | `squad:flashlight { ids: 'giles,okafor', on: true }`: pre-allocated weapon-mounted spotlights (no volumetric rear cone) illuminate west into `R16b`. |
| `0:25.5` | **11. Advancing into R16b** | `r16_giles_03` — **Giles** (`dread`, **`radio`**): *"Easy, easy... up the stairs. Something's breathing in here."* | — | Giles & Okafor walk up the stairs at `1.15 m/s` holding `aim_pistol` (upper-body aim + pistol grip preserved during locomotion; `updateScriptedAim` never zeroes walk velocity). |
| `0:31.0` | **12. Contact & gunfire -> Cut to CAM 10** | `r16_okafor_03` — **Okafor** (`alarmed`, **`radio`**): *"Wait — to the right! Behind the pillar! Movement!"*<br>`r16_giles_04` — **Giles** (`urgent`, **`radio`**): *"Light it up! Fall back, fall back!"* | `ductScrape` + boosted pistol bursts (`squad:scripted_fire`) | Squad stays aimed down the concourse until `0.25 s` into `r16_okafor_03`, then snaps right to aim and fire at the northwest-most pillar (`[63.5, 1.8, 31.2]`). Hard cut to **`CAM 10  CONCOURSE`** (`[71.2, 2.0, 28.8]` -> `[70.0, 1.5, 38.6]`): squad immediately aims high (`r16_monster_face_aim` at `Y = 5.4`, then live `juggernautHead + 0.8 m` even during bursts) so only the creature's face is lit. |
| `0:34.2` | **13. Slow 5.2 s Juggernaut Face Reveal** | — | **`r16MonsterRoar`** (`4.0 s` deep-sea creature roar) | Preloaded `5.1 m` skinned `public/assets/models/infected/monster_juggernaut.glb` (`details` mesh hidden) glides slowly over `5.2 s` from `[64.8, 0, 34.6]` to `[68.2, 0, 34.6]` (`yaw: 95`, clear of the foreground right pillar) across the `4.65 s` `CAM 10` reveal window. |
| `0:38.9` | **14. Hard Blackout & Dead Silence -> THALASSA** | — | Stop all SFX and speech -> **absolute dead silence** | Instant `fade` `to: 1, s: 0`, `cameraFeed` `state: "off"`, `squad:flashlight { on: false }`, `transit:train_aux_lights { on: false }`, `setFlag r16_finale_done = true`, emit **`story:cliffhanger`** -> `title_card` (`THALASSA`) -> `stinger_priya` (`CAM 04 MEDBAY`) -> `endSlice`. |

## Decisions

1. **Zero shader recompiles (Fixed Light Budget)**:
   - Three.js recompiles shaders whenever scene light count changes (`transit-wing` spec: *Light count stays fixed*).
   - **Train Car B downward auxiliary lights**: Add two pre-allocated `SpotLight`s (default `intensity = 0`) mounted under Train Car B's west exterior eave in `src/world/kit/transit.ts`, aimed down at the `R16a` platform floor beside the boarding gap (`x ≈ 84.5..85.5, y = -0.6, z ≈ 33.8 & 36.2`). Toggling `transit:train_aux_lights` only changes `intensity` and emissive lens glow.
   - **Squad weapon-mounted flashlights**: Add one pre-allocated `SpotLight` (default `intensity = 0`) per squadmate (`giles`, `okafor`) in `src/ai/squad.ts` (or `Humanoid` / sidearm rig), aimed along the weapon's forward bore/aim vector whenever `flashlightOn` is true, plus a subtle additive volumetric beam cone mesh so the beam reads clearly on dark CCTV feeds.
   - **CCTV-readable muzzle flash**: Reuse/boost the existing squad muzzle-flash light/mesh during `squad:scripted_fire` so gunfire bursts visibly strobe the left side of `CAM 10`.

2. **Tunnel Emergency Red Mode (`transit:tunnel_power`)**:
   - In `src/world/kit/transit.ts`, both the Stage 2 scrolling hallway (`R15b`) and the `R16a` north shroud use known emissive strip materials. Listening for `transit:tunnel_power { mode: 'normal' | 'emergency' }` tints those strip materials to deep emergency red (`0xb81818` at lower emissive intensity) and resets them to cool white on `level:reset`.

3. **Finale Audio**
   - Preload the `labB` score at docking. Start `r16Build` 1.2 seconds after the blood discovery's bass hit so it rises under Jay's reaction and the camera pan. Continue with `r16Stalk` during the cabin conversation, then apply `r16Cut` as the view fades out before CAM 09.
   - Generate 3 bespoke ElevenLabs SFX (`scripts/ambience-generate.ts`):
     - `trainPowerDown` (`oneshot-train-power-down.mp3`): heavy traction power breaker drop + electric motor spool-down (~2.8 s).
     - `r16HorrorHit` (`oneshot-r16-horror-hit.mp3`): massive cinematic low-end horror bass impact + dark metallic resonance (~3.2 s).
     - `r16MonsterRoar` (`oneshot-r16-monster-roar.mp3`): terrifying close-range deep-sea abyssal creature roar/screech (~1.6 s, cut hard at 0.5 s on blackout).

4. **Pinned Gemini TTS VO Batching (11 lines, 2 API requests)**:
   - Batch 1 (`gemini-2.5-flash-preview-tts`): Giles (`r16_giles_01`–`04`) + Okafor (`r16_okafor_01`–`03`) = 7 lines.
   - Batch 2 (`gemini-3.1-flash-tts-preview`): Station PA (`r16_pa_01`–`02`, voice `Gacrux`) + Jay (`r16_jay_01`–`02`, voice `Orus`) = 4 lines.
   - Zero speaker recasting, zero off-model drift.

5. **Scripted Body Drag & Scripted Squad Firing**:
   - `r16_pillar_body` is already a dead `Humanoid` NPC in `R16b`. We can smoothly translate it behind the NE pillar (`anchor:r16_pillar_body_dragged`) using a short `npcMoveTo` (or dedicated corpse-drag step / `npcDrag` with dead pose preserved so it never stands up or walks).
   - For the surveillance gunfire beat, expose a small sequence event/step (`squad:scripted_fire` with `{ ids, target, bursts, interval }`) so Giles and Okafor aim at `anchor:r16_fire_target` and fire timed pistol bursts with full muzzle flash + gunshot SFX even before the `hero` creature steps out from behind the pillar.

6. **Remote CCTV Visibility & Async Corpse Spawn**:
   - Moving the climax from `R11` (~35.6 m from `priya_rest`) to `R16a` (~87.7 m from `priya_rest`) pushes Priya past `NPC_TUNING.hideDistance` (45 m) in `src/ai/npcActor.ts`, hiding her during `stinger_priya`'s `CAM 04 MEDBAY` feed even though `body.killing` already exempts her from `sleepDistance` (28 m).
   - Pass active live `cameraFeeds` camera positions into `npcs.update` (`NpcEnv`) and compute `camD` as the minimum distance to the player camera and any live feed camera, while also keeping `body.killing` visible (`camD < NPC_TUNING.hideDistance || this.body.killing`).
   - Fix `NpcDirector.spawnFromLevelAsync()` in `src/ai/npcs.ts` to forward `s.dead === true, s.blood === true` to `create()` (matching sync `spawnFromLevel()`), so `R16a`/`R16b` corpses spawn as frozen, bloodied corpses on initial load rather than living NPCs.

## Risks / Trade-offs

- **[Risk] `CAM 09` or `CAM 10` could be too dark in `R16b` to read Giles/Okafor or the 0.5 s monster reveal** -> Tune weapon-flashlight spotlight intensity/distance, add a subtle volumetric cone on their weapon flashlights, boost muzzle-flash intensity during `squad:scripted_fire`, and verify both feeds live in the browser (`?debug&jump=r16_finale`).
- **[Risk] `r16_pillar_body` could snap into a walk animation if moved with standard `npcMoveTo`** -> Ensure the drag keeps `corpseProne` frozen (`dead: true` bodies translate smoothly without gait/pose override, verified in unit test and browser).
- **[Risk] `R15b` tunnel power-loss announcement could collide with Stage 3 arrival timing** -> Measure actual generated `r16_pa_01` MP3 duration and set `r15a_train_ride`'s `tunnelSeconds` accordingly so the PA finishes before `r16a_north` lifts.
