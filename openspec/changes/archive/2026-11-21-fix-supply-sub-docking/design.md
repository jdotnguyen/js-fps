# Design

## Context

See `proposal.md` for motivation. Three constraints from the current codebase shape this design:

- `src/render/fx/subModel.ts` scales `kilo_submarine.glb` by `SUB_SCALE = 10` (`SUB_LENGTH = 145 m`, `SUB_RADIUS = 9.77 m`), and `scripts/gen-slice01.mjs` places `supply_sub` at `berthBow = [5, 0.4, -9]` with `alignBow: true`. Because `slice.ts` scales lamp offsets (`lampX = L/2 - 1.9 * K`) and cradle geometry by `K = SUB_SCALE`, the headlamps sit at world `(-14, -1.6, -11.9 / -22.9)` behind `R01a` (Dock Airlock, `X = -2..2, Z = -6..-2`), and `LAMP_TILT = 0.5` sends their beams into the `-4.5 m` seabed at `X = -8.7` before reaching the dock window (`X = 2..14`).
- `src/render/fx/exteriorLight.ts` cuts room/hemisphere lighting on exterior meshes to `EXTERIOR_AMBIENT = 0.08`, applies Gaussian water fog (`WATER_DENSITY = 0.07` toward `#02070a`), and evaluates up to `MAX_EXTERIOR_LAMPS = 8` spot lamps (`extLamps`) as diffuse-only (`diffuseColor.rgb * extLamps(...)`). `slice01` currently uses 5 hull floodlights plus 2 sub headlamps (7 total).
- `src/audio/sounds.ts` still defines `subPass` and `subClamp` only in `SOUND_SPECS` (procedural Web Audio synths), while `hullGroan`, `metalKnock`, and `pressurePing` already use ElevenLabs recordings generated via `scripts/ambience-generate.ts`. `src/audio/doorAudio.ts` also lists `subClamp` as the `bulkhead` fallback.

## Goals / Non-Goals

**Goals:**
- Restore the supply submarine to dock-fit scale (`SUB_SCALE = 1`, `14.5 m`) and frame the hull, docking clamps, sail running lights, and bow spotlights inside the `R01` dock window during both approach and docked states.
- Give the submarine subtle readability in the dark ocean (wet sheen / silhouette hint + running lights) without brightening the ocean water, fog, or unlit seabed.
- Restore two clearly visible bow spotlight cones (upgraded to the exterior volumetric beam shader with marine snow and water fog) and matching `exterior-lamp` seabed pools.
- Remove the local procedural `subPass` and `subClamp` synths and replace them with ElevenLabs muffled underwater recordings that pass `npm run audio:audit`.

**Non-Goals:**
- Upscaling, repainting, or replacing `kilo_submarine.glb` or adding a tiled detail shader (dialing back to `SUB_SCALE = 1` restores ~10× texel density, and the sub is intentionally only subtly lit).
- Changing the `exterior-ocean` dark water colour (`0x02070a`), water fog density (`0.07`), or floodlight behaviour at `R01w` / `R12b`.
- Re-generating `hullGroan`, `metalKnock`, or `pressurePing`, which are already ElevenLabs recordings.

## Decisions

### 1. Dock-fit proportions (`SUB_SCALE = 1`) and centered berth
- **Decision:** Set `SUB_SCALE = 1` (`SUB_LENGTH = 14.5 m`, `SUB_RADIUS ≈ 0.98 m`, `SUB_SAIL_TOP ≈ 2.75 m`) in `src/render/fx/subModel.ts`, and update `supply_sub` placement in `scripts/gen-slice01.mjs` to centre the docked boat around `X ≈ 5.5` (removing `alignBow: true`, or shifting the berth anchor so the hull spans roughly `X = -1.75..12.75`, centre near `X = 5.5`, `Y = 0.4`, `Z ≈ -8.6`).
- **Rationale:** Jay's intro camera at `post_front` (`[6.95, 1.7, 4.3]`) aimed at `dock_window` (`[5.8, 1.5, -2.2]`) intersects `Z = -8.6` at `X ≈ 4.7`. Centering the 14.5 m boat around `X ≈ 5.5` puts the sail, running lights, and docking clamps right in the middle of the shot, puts both bow headlamps around `X ≈ 10.8` inside the `X = 2..14` window, clears the `-4.5 m` seabed by ~4 m, and avoids needing any texture sharpening.
- **Alternative considered:** 1:1 real Kilo length (`71.2 m`, `SUB_SCALE ≈ 4.9`). Rejected because it still pushes clamps/running lights out of view, nearly scrapes the `-4.5 m` seabed, and keeps the texture 5× blurrier.

### 2. Subtle hull visibility without lifting the ocean
- **Decision:** Keep `WATER_COLOR`, `WATER_DENSITY`, and `EXTERIOR_AMBIENT` untouched. Add a modest Blinn-Phong specular term to `extLamps()` (or inside `patchExteriorShader` using material roughness/metalness or a subtle grazing factor) so wet painted steel catches a soft highlight from exterior lamps, and ensure the `R01` dock floodlight setup grazes the hull lightly (either via a slightly wider/shallower vertical reach on the R01 berth or a dedicated subtle berth light within `MAX_EXTERIOR_LAMPS = 8`). Keep the red/green sail running lights emissive through `exteriorize()` so they read cleanly in the dark.
- **Rationale:** Matches the player goal ("just a hint of it") while preserving every `exterior-ocean` guarantee (near-black water and near-black seabed outside lamp pools). Adding specular to `extLamps` also makes wet hull steel and rocks respond more naturally without adding draw calls.
- **Alternative considered:** Raising `EXTERIOR_AMBIENT` or lowering `WATER_DENSITY`. Rejected because it lifts the whole seabed and fights `exterior-ocean`.

### 3. Restored bow spotlights with shared volumetric beam shader
- **Decision:** Keep the two headlamp spheres and two `exterior-lamp` markers on the bow flanks of `supply_sub` (at `SUB_SCALE = 1`, roughly `lampX = L/2 - 1.9`, `lampY = -0.2`, `lampZ = ±0.55`, putting them at world `X ≈ 10.8, Y ≈ 0.2, Z ≈ -8.1 / -9.2` when docked). Export/reuse the soft-edged volumetric beam shader (`BEAM_VERT`/`BEAM_FRAG` with `aAlong`, marine snow, and `waterFog`) from `src/render/fx/exterior.ts` for the sub's headlamp cones instead of the flat `MeshBasicMaterial`, and tune `LAMP_TILT` (~`0.32–0.42 rad`), cone length/radius (~`9–11 m`, matching the lamp's `outer` angle), and `exterior-lamp` range/intensity (`range ≈ 18–22 m`, `outer ≈ 0.30–0.36 rad`) so both beams are clearly visible cutting through the dark water and cast two moving pools onto the `-4.5 m` seabed across the `R01` window during the 10 s docking slide.
- **Rationale:** At `Y = 0.2` and `LAMP_TILT ≈ 0.38 rad` (~22°), the beam centreline hits the `-4.5 m` seabed at `ΔX ≈ 11.7 m` ahead of the bow — sweeping directly across the `R01` seabed from left to right as the sub slides in from `X_centre ≈ -23` to `+5.5`, while staying clearly above the floor as visible volumetric shafts outside the glass.
- **Alternative considered:** Keeping `MeshBasicMaterial` with higher opacity. Rejected because flat additive cones show hard silhouette edges and ignore `waterFog`, clashing with the new `exterior-ocean` floodlight beams right next to them.

### 4. ElevenLabs underwater-muffled `subPass` and `subClamp`, retiring local synths
- **Decision:** Add `subPass` (`oneshot-sub-pass.mp3`, ~10–11 s) and `subClamp` (`oneshot-sub-clamp.mp3`, ~6–7 s) entries to `scripts/ambience-generate.ts` with explicit underwater-through-thick-steel-hull muffling prompts (low-passed sub-bass propulsion swell/cavitation for `subPass`; muffled submerged hydraulic servo groan + heavy dull metal clamp lock thuds for `subClamp`). Generate both clips with `npm run ambience:generate`, register them in `SAMPLE_URLS` (`src/audio/sounds.ts`), remove the procedural `subPass`/`subClamp` generator functions and `SOUND_SPECS` entries, and update `doorAudio.ts`'s `bulkhead` fallback from `'subClamp'` to `'metalKnock'` so bulkhead doors keep a procedural fallback.
- **Rationale:** Follows the repo's ElevenLabs SFX pipeline (`docs/audio-assets.md`), satisfies the user's request to remove the locally generated docking sounds, and keeps `npm run audio:audit` green.
- **Alternative considered:** Keeping procedural `subPass`/`subClamp` as fallbacks in `SOUND_SPECS`. Rejected because the user explicitly asked to remove the locally generated docking sounds.

## Risks / Trade-offs

- **Docking slide start offset (`place(k)`)** -> At `SUB_SCALE = 1`, `L = 14.5`, so `-(26 + (L - 9)/2) = -28.75 m` slides the sub from `X_centre ≈ -23.25` (bow at `-16`, completely hidden behind `R01a`/fog) into `X_centre ≈ 5.5`. The headlamp beams will sweep into the `R01` window early in the 10 s approach and settle right as the clamps close; verify exact timing in-browser against `intro_shift_change.json` (`subPass` at `0 s`, `subClamp` at `8 s`).
- **ElevenLabs clip duration/timing alignment** -> `intro_shift_change.json` triggers `subClamp` at `t = 8 s` (the 2 s clamp-close window before `metalKnock` at `9 s`). Craft the `subClamp` prompt so the hydraulic servo run-up leads cleanly into the heavy clamp lock around 1.5–2 s, and audition the generated MP3s before finalizing.
- **No procedural fallback if `oneshot-sub-pass.mp3` / `oneshot-sub-clamp.mp3` fail to load** -> Matches existing sample-only sounds (`winchClunk`, `archPass`, etc.); `AudioEngine` logs one warning and continues cleanly per `audio-assets` spec.
- **Shader hook test coverage** -> Any edit to `patchExteriorShader` in `src/render/fx/exteriorLight.ts` must keep `EXTERIOR_HOOKS` and `exteriorLight.test.ts` passing across Three.js r170 standard/physical shaders.
