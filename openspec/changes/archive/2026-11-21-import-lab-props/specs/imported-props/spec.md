# Spec Delta

## Purpose

Defines how third-party 3D models become kit props: one import command that turns raw downloads into game-ready models, a stand-in that gives every imported prop its size and collision, and the texture, budget and licence rules that keep imported props consistent with the procedural kit.

## ADDED Requirements

### Requirement: One import command
The project SHALL provide one command that converts every configured raw source (glTF, GLB or FBX, kept outside the repository) into a game-ready model file per prop id. The command SHALL accept prop ids to import only those. A source that fails SHALL be reported with its id and the failing step, and the other sources SHALL still be imported.

#### Scenario: Import everything
- **WHEN** the developer runs the import command with the raw sources in place
- **THEN** each configured prop id has a model file under `public/assets/models/props/` and a cost record

#### Scenario: One broken source
- **WHEN** one FBX source cannot be read
- **THEN** the command names that prop id and the step that failed, imports every other source, and exits with a failure code

#### Scenario: Raw files stay out
- **WHEN** an import finishes
- **THEN** no raw source file (FBX, source PNG, source glTF) has been copied into the repository

### Requirement: Kit conventions on import
An imported model SHALL come out in metres at its configured real height, with its pivot at the centre of its base and its front facing -Z. It SHALL contain no cameras, lights, skins or animation clips, and SHALL stay within its configured triangle budget.

#### Scenario: Centimetre FBX
- **WHEN** a source FBX is authored in centimetres and configured as 1.2 m tall
- **THEN** the imported model is 1.2 m tall (±1 cm) and stands on y = 0

#### Scenario: Demo scene source
- **WHEN** the source is a demo scene with a camera, a light and a backdrop wall that the configuration drops
- **THEN** the imported model holds only the configured meshes

#### Scenario: Over budget
- **WHEN** a source has 21,000 triangles and a budget of 4,000
- **THEN** the imported model has at most 4,000 triangles

### Requirement: Imported textures
An imported prop's textures SHALL be a colour map, a packed AO/roughness/metalness map and an OpenGL-convention normal map. Each texture's size SHALL follow from the prop's largest dimension at the configured pixels per metre (default 1024), rounded up to a power of two between 256 and 2048. DirectX normal maps SHALL be converted to OpenGL.

#### Scenario: Small prop
- **WHEN** a 0.5 m prop is imported at the default density
- **THEN** its textures are 512 px

#### Scenario: DirectX normal source
- **WHEN** a source normal map is marked as DirectX
- **THEN** the imported normal map's green channel is inverted, and the prop's bumps read as raised under light, not sunken

### Requirement: Hinged parts stay separate
A source part that the configuration names as hinged (a cabinet door, a panel lid) SHALL stay a separate, named part with its pivot on the hinge, so a scripted sequence can open it. Every other part SHALL be fixed in place.

#### Scenario: Cabinet doors
- **WHEN** the lab cabinet is imported with its two doors named as hinged parts
- **THEN** the model holds two door parts that rotate about their hinge edges, and the body is one fixed part

### Requirement: Stand-in for every imported prop
Every imported prop id SHALL also exist as a procedural kit piece of the prop's real size. That piece SHALL define the prop's colliders, footstep surfaces, climbable top, seats and wall keep-outs. When the model is loaded, it SHALL replace only the stand-in's visible geometry. When the model is not loaded, or fails to load, the stand-in SHALL be shown.

#### Scenario: Headless level build
- **WHEN** a level that places an imported prop is built without loading any models (as the level tests do)
- **THEN** the build succeeds, and the prop's colliders and climbable top are the stand-in's

#### Scenario: Collision matches in the browser
- **WHEN** the same level is built in the browser with the model loaded
- **THEN** the prop's colliders are identical to the headless build's

#### Scenario: Missing model file
- **WHEN** a manifest entry points to a model file that fails to load
- **THEN** the level still loads, the stand-in is shown in its place, and one warning names the prop id

### Requirement: Imported props keep their own UVs
Rooms SHALL draw an imported prop with the UVs it was authored with. The world-space texture tiling applied to kit surfaces SHALL NOT be applied to imported props.

#### Scenario: Cabinet in a room
- **WHEN** a room places the lab cabinet and is built in the browser
- **THEN** the cabinet's labels and panel details sit where they are in the source model, and do not tile or shift with the cabinet's position

### Requirement: Imported props count against room budgets
Each imported prop SHALL have a recorded cost: triangles, materials, transparent materials and texture pixels. The per-room draw-call and triangle budgets SHALL include the recorded cost of every imported prop a room places, whether or not models are loaded. Each prop type SHALL add its material count to a room once, and its triangles once per placed copy.

#### Scenario: Headless budget check
- **WHEN** a room places three copies of a prop recorded at 2 materials and 1,500 triangles, and the level tests build it without models
- **THEN** that room's counted draw calls rise by 2 and its counted triangles by 4,500

#### Scenario: Stale record
- **WHEN** a prop's model file has been re-imported but its cost record was not updated
- **THEN** the tests fail and name the prop id

### Requirement: Licence record for every imported prop
Every imported prop SHALL record its source, author and licence. Every prop under a licence that requires attribution SHALL appear in `CREDITS.md` and in the game's credits screen.

#### Scenario: CC BY model
- **WHEN** the lab cabinet (CC BY 4.0) is imported
- **THEN** `CREDITS.md` and the in-game credits name Naked Singularity Studio, the model and its licence

#### Scenario: Missing credit
- **WHEN** an imported prop id has no `CREDITS.md` entry
- **THEN** the tests fail and name the prop id

### Requirement: Imported prop preview
The project SHALL provide a preview page, separate from any level, that shows each imported prop. Each prop SHALL appear beside its stand-in on a 1 m grid, with its -Z facing, colliders and climbable-top height marked.

#### Scenario: Checking a new import
- **WHEN** the developer opens the preview page after an import
- **THEN** every prop in the manifest is listed, and each model visibly matches its stand-in in size and facing
