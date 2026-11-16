# ADR-0002: Rendering, lighting and post-processing

Status: Accepted (direction) / Proposed (numbers)

## Context
The look must be dark, gritty and realistic-leaning like Dead Space; cel-shading is
dropped [Decided]. No real-time ray tracing; use lighting tricks [Decided]. Target machine
is a MacBook Air M2 [Decided]. Geometry starts procedural, so lighting does most of the
work of making it look good.

## Decision
- WebGL2 `WebGLRenderer` (not WebGPU) for maturity of post-processing passes in r170. [Assumed]
- Physically based materials (`MeshStandardMaterial`, `MeshPhysicalMaterial` only for glass).
- A strict dynamic light budget plus faked atmosphere (fog, shafts, particulates).
- One post-processing chain with three quality tiers.

## Details

### Renderer settings
- `outputColorSpace = SRGBColorSpace`, `toneMapping = AgXToneMapping` (fallback ACES),
  `toneMappingExposure` ~0.85, tuned per room via sequences.
- `shadowMap.type = PCFSoftShadowMap`.
- Pixel ratio cap by tier: Low 1.0, Medium 1.25, High min(devicePixelRatio, 1.5).
- Default tier on M2: Medium.

### Light budget (per frame, hard limits)
| Light type | Max active | Shadows | Notes |
|---|---|---|---|
| Player flashlight (SpotLight) | 1 | yes, 1024 map | Always on by default, F toggles |
| "Hero" scripted light | 1 | yes, 512-1024 | Swinging lamp, set-piece light |
| Point/spot fill lights | 8 | no | Only lights in current + adjacent rooms are enabled |
| Hemisphere ambient | 1 | no | Colour swapped per room (normal, emergency, flooded) |
- Disabled lights are removed via `visible=false` and a stable light count is kept to avoid
  shader recompiles: allocate the 8 fill lights once as a pool and move/recolour them.
  (Changing the number of lights in a scene forces Three.js to recompile materials.)

### Light behaviour controller
`render/lights.js` drives pooled lights from data with patterns:
`steady`, `flicker` (noise-based), `strobe` (period), `dying` (decaying with spikes),
`alarm` (rotating red beacon via spot rotation), `off`. Pattern intensity respects the
"reduced flashing" accessibility setting (ADR-0012): strobe and flicker clamp to <=3
changes per second and lower contrast.

### Baked-looking light without a baker
- Kit pieces bake **vertex-colour ambient occlusion** at generation time (darken
  vertices near inside corners and under fixtures by a simple distance test). [Assumed]
- Per-room hemisphere tint and fog colour provide the colour of the space.
- Emissive light fixture meshes + bloom sell the light sources.
- Real lightmaps arrive later with GLB pieces from Blender (ADR-0003 swap-in path).

### Environment and reflections
- One PMREM environment map generated from a procedural dark scene (dim panels) so metal
  has believable reflections. Intensity low (`envMapIntensity` 0.2-0.4).

### Materials library (`render/materials.js`)
Shared, cached instances; procedural `CanvasTexture`s generated once at load:
`painted_metal` (panel lines, edge wear, grime), `bare_steel`, `rubber_floor`,
`grating` (alphaTest), `glass` (Physical, transparent, low opacity, env reflections, no
transmission for cost), `emissive_panel`, `screen` (canvas UI, used by consoles and gun
ammo display), `flesh_infected`, `suit_fabric`, `blood_decal`.
Texture sizes: 512 px, repeat-wrapped, mipmapped, anisotropy 4.

### Post-processing chain (three/examples `EffectComposer`)
1. `RenderPass` world scene.
2. `RenderPass` viewmodel scene with `clear=false`, depth cleared (gun never clips walls).
3. `GTAOPass` (High: full, Medium: half resolution, Low: off).
4. `UnrealBloomPass` half resolution, threshold high so only emissives bloom
   (Low: quarter resolution).
5. Custom final `ShaderPass`: film grain, vignette, subtle chromatic aberration at screen
   edges, lift/gamma/gain colour grade, damage tint and "low health" desaturation uniforms.
6. `OutputPass` (tone mapping + colour space).

### Atmosphere
- `FogExp2` with per-room colour/density (default 0x05090c, 0.06).
- Light shafts: additive cone meshes with a soft-edge fragment shader, scrolling noise and
  depth fade; attached to flashlight (subtle) and big fixtures.
- Particulates: one `Points` cloud (~1500 points) that follows the camera, drifting dust /
  "marine snow", lit by fake flashlight falloff in the shader.
- Exterior windows: dark water shader with caustic noise, faint distant silhouettes.
- Interior water (flooded section): planar surface with normal-map noise, fog-under-water.
- Decals: `DecalGeometry` for blood and scorch marks, max 64, oldest recycled.

### Viewmodel
- Separate scene + camera (FOV 55 fixed), lit by a copy of the flashlight and a dim fill
  so the gun matches the world mood.

## Consequences
- Fixed light pool means level data refers to "light slots", not unlimited lights.
- GTAO and bloom are the most expensive passes; they are the first to drop on Low.

## Alternatives rejected
- Path tracing (three-gpu-pathtracer): not real time for gameplay.
- WebGPU renderer: promising, but risk on Safari and fewer stable post passes today.
- Deferred/clustered lighting: complex; the pool approach is enough for corridors.

## Execution steps
1. Renderer + quality tiers + composer chain on the ADR-0001 test room.
2. Material library and procedural textures.
3. Light pool + pattern controller, flashlight with soft spring lag.
4. Fog, particulates, light shafts.
5. lil-gui panel for exposure, fog, bloom, grade to tune by eye.

## Definition of done
- Test corridor is lit only by flashlight + 2 flickering fills and looks moody, not black.
- Switching tiers live works with no shader-recompile stutter after the first switch.
- M2 Medium tier: >=60 fps in the test room at 1440x900.

## Open questions
- None blocking.

## Progress log
- 2026-11-15: Implemented early, as a "demo room" requested by Justin, together with a preview
  of ADR-0003 kit detail (`world/demoRoom.ts`, `world/kit/geom.ts`).
  Built: procedural PBR textures (`render/tex/`), material library, light pattern controller
  with reduced-flashing mode, spring-lagged flashlight, post chain (GTAO, bloom, grade with
  grain/vignette/aberration/damage tint, OutputPass), light shafts, camera-following dust,
  abyss window shader, canvas screens, stencil and blood decals, debug GUI for all of it.
  **Deviation:** textures are generated as raw pixels into `DataTexture`s instead of
  `CanvasTexture`s. Pure math means they run in Node (unit tests + `npm run textures:preview`
  PNG contact sheets) and can move to a worker later. Generation takes ~1.7 s at boot for
  eight 512 px sets; a worker or caching is a follow-up if it bothers.
  **Deviation:** the light pool is not yet generic; the demo room creates a fixed set of 7
  lights (hemisphere, 3 fixtures, console spot, alarm spot, flashlight). Pooling arrives with
  ADR-0003 rooms.
  Verified in sandbox: 31 unit tests (texture maps valid/deterministic/tileable, pattern
  ranges, reduced flashing <= 3 changes/s), all files parse, textures inspected visually.
  **Not yet verified:** typecheck, in-browser look, 60 fps on the M2.
