# playtest-server Specification

## Purpose

Defines how the game is served for automated browser testing (`npm run playtest:serve`), so several agents on one machine can test at once without reloading each other's pages or exhausting memory.

## Requirements

### Requirement: Each server holds a frozen copy of the game
`npm run playtest:serve` SHALL build the current working tree into a temporary folder of its own, serve that build and print its URL. It SHALL NOT write to the project's `dist/`, and later file changes SHALL NOT alter or reload what it serves. The `?debug`, `?slot=scratch` and `?memprobe` flags SHALL work on the served game.

#### Scenario: Another agent saves a file during a test
- **WHEN** a source file changes while a browser has the served game open
- **THEN** the page does not reload and the served files stay as built

#### Scenario: Build fails
- **WHEN** the build of the working tree fails
- **THEN** the command exits with an error, serves nothing and frees its slot

### Requirement: Bounded server slots
At most 4 playtest servers SHALL run at once, each on its own port from 4180 to 4183. A port that another program is already serving SHALL be skipped. A slot SHALL become free when its server's process ends, however it ends, without any file to clean up by hand.

#### Scenario: Two agents start servers together
- **WHEN** two agents run the command at the same time
- **THEN** each gets a different port and its own copy of the game

#### Scenario: Every slot is busy
- **WHEN** the command runs while no slot is free
- **THEN** it says so and waits, starts when a slot frees, and gives up with an error once it has waited as long as a server's lifetime

### Requirement: Servers do not outlive their test
A server SHALL stop on request (`npm run playtest:serve -- stop <port>`) and SHALL stop by itself after 30 minutes. An environment variable SHALL change the lifetime for one run, up to 240 minutes. Stopping either way SHALL remove the server's temporary folder before its slot is free.

#### Scenario: Stopped by request
- **WHEN** the stop command names a running server's port
- **THEN** that server exits, its folder is removed and the port can be claimed again

#### Scenario: Forgotten server
- **WHEN** nobody stops a server
- **THEN** it exits when its lifetime ends
