# Spec Delta

## Purpose

Defines what the game downloads before the title screen and when a play session starts loading, and how large engines and data are shipped, so that startup and session loading stay fast as content grows.

## ADDED Requirements

### Requirement: The entry chunk stays within its budget
The production build's entry JavaScript chunk SHALL be no larger than 250 kB minified. The build SHALL report the entry chunk's minified and gzip sizes, and SHALL fail when the entry chunk exceeds the budget.

#### Scenario: Within budget
- **WHEN** the production build runs
- **THEN** it reports the entry chunk's minified and gzip sizes
- **AND** the entry chunk is 250 kB minified or less

#### Scenario: Over budget
- **WHEN** a change makes the entry chunk larger than 250 kB minified
- **THEN** the build fails and names the entry chunk's size and the budget

### Requirement: Shared clip data is its own chunk
The shared motion-capture clip data SHALL be built as its own chunk, separate from the entry chunk and from the session code. It SHALL be fetched when a session starts loading, alongside the session code, and SHALL be ready before any character body is built.

#### Scenario: Build output
- **WHEN** the production build runs
- **THEN** the shared clip data is in a chunk of its own, and neither the entry chunk nor the session chunk contains it

#### Scenario: Session start
- **WHEN** a session loads
- **THEN** every character is built with its clips available, and none starts with a missing or default pose because its clip data was late

### Requirement: WebAssembly engines ship as WebAssembly files
A WebAssembly engine SHALL be loaded from a separate `.wasm` file that the browser compiles while it downloads, and Node SHALL run the same engine build as the browser. The navmesh meets this. The physics engine is exempt while no build of it loads in both Node and the browser without a custom resolver; it keeps its embedded module, stays lazy, and is held to its own size limit.

#### Scenario: Navmesh build output
- **WHEN** the production build runs
- **THEN** the navmesh engine appears as a `.wasm` file in the output

#### Scenario: Network during play
- **WHEN** a session loads
- **THEN** the navmesh's `.wasm` file is fetched, and no JavaScript chunk with the navmesh engine encoded as text is fetched

#### Scenario: Physics off
- **WHEN** a session loads with every physics feature switched off
- **THEN** the physics engine's chunk is never fetched

#### Scenario: Node tests
- **WHEN** a navmesh test runs in Node
- **THEN** it loads the same navmesh build as the browser, from its `.wasm` file

### Requirement: The build warns only about real outliers
A clean production build SHALL print no chunk-size warning and no dynamic-import warning. A chunk larger than 1,500 kB minified SHALL warn, except the physics engine's chunk, which SHALL warn above 4,500 kB.

#### Scenario: Clean build
- **WHEN** the production build runs on an unchanged checkout
- **THEN** it prints no chunk-size warning and no dynamic-import warning

#### Scenario: New oversized chunk
- **WHEN** a change produces a chunk other than the physics chunk that is larger than 1,500 kB minified
- **THEN** the build warns about that chunk

#### Scenario: Physics chunk grows
- **WHEN** the physics engine's chunk grows past 4,500 kB minified
- **THEN** the build warns about it
