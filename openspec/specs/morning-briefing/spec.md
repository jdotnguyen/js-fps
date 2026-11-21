# morning-briefing Specification

## Purpose

Defines the Observation Gallery morning briefing experience (`briefing_gallery`) and the Commons-to-briefing transition: reliable entry triggering, free-roam staging, talk-while-walking squad catch-up, diegetic door locking, live objective hand-out, and skip parity.

## Requirements

### Requirement: Briefing triggers reliably a few steps into the gallery
Entering the Observation Gallery (R03) after the intro has been seen SHALL start `briefing_gallery` once Jay walks a few steps past `D_R02_R03` across the full width of the room, regardless of whether he hugs the north walkway, the center, or the glass side. Standing in or peeking through the doorway SHALL NOT start it.

#### Scenario: Walking in along the north walkway
- **GIVEN** `introSeen` is set and `briefingSeen` is not set
- **WHEN** Jay walks ~2.5 m into R03 along the back-wall walkway
- **THEN** `briefing_gallery` starts immediately

#### Scenario: Walking in along the glass side
- **GIVEN** `introSeen` is set and `briefingSeen` is not set
- **WHEN** Jay enters R03 and angles south toward the Lab B glass
- **THEN** `briefing_gallery` starts once he is a few steps inside R03

#### Scenario: Peeking at the doorway
- **GIVEN** `introSeen` is set and `briefingSeen` is not set
- **WHEN** Jay opens `D_R02_R03` and stands on the threshold without walking into R03
- **THEN** `briefing_gallery` does not start

### Requirement: Free-roam briefing with no dead wait
`briefing_gallery` SHALL play in free-roam inside R03 without locking Jay's movement, showing letterbox bars, or pausing dialogue for blocking camera pans. Heins SHALL begin speaking her opening line immediately when the briefing starts.

#### Scenario: Entering the gallery starts dialogue immediately
- **WHEN** `briefing_gallery` triggers
- **THEN** Jay retains free movement and free mouse look, no letterbox bars appear, and Heins begins `brief_heins_01` without waiting for Giles or Okafor to reach their marks

#### Scenario: Dialogue flows without blocking camera pauses
- **WHEN** the briefing progresses through Heins, Giles, and Director Hale's screen broadcast
- **THEN** lines follow naturally without multi-second silent camera-framing stalls

### Requirement: Squad walks in while Heins talks with out-of-view catch-up
When `briefing_gallery` starts, Giles and Okafor SHALL walk briskly to their briefing marks in R03 while Heins is speaking. After Heins's opening line, any squadmate still outside R03 SHALL be brought inside out of Jay's sight where possible and continue walking briskly to their mark, without popping in front of Jay if he is looking back into the Commons.

#### Scenario: Squad trails behind in the Commons while Jay faces Heins
- **GIVEN** Jay sprinted ahead into R03 and faces Heins while Giles and Okafor are still in R02
- **WHEN** Heins finishes `brief_heins_01`
- **THEN** Giles and Okafor are brought inside R03 behind Jay's view and walk straight to their marks while the conversation continues

#### Scenario: Jay enters facing back toward the Commons
- **GIVEN** Jay walks into R03 facing back through the open doorway toward Giles and Okafor
- **WHEN** `briefing_gallery` starts
- **THEN** neither squadmate pops visibly in front of Jay; they walk briskly toward R03 and only catch up once out of Jay's view or behind the closing door

### Requirement: Sung is present in the gallery for her briefing line
Sung SHALL be present in R03 for the morning briefing so her spoken line (`brief_sung_01`) originates from her visible body in the room rather than from the Commons.

#### Scenario: Heins clears the divers' sample run
- **WHEN** Heins says `brief_heins_02` and Sung replies with `brief_sung_01`
- **THEN** Sung is visibly standing in R03 and her voice plays from her position in the room

### Requirement: Gallery door locks during the briefing with a spoken cue
Once Jay, Giles, and Okafor are inside R03 after Heins's opening beat, Heins SHALL speak a voiced line instructing them to lock the door behind them (`brief_heins_door`, recorded on her pinned voice and model), and `D_R02_R03` SHALL close and lock for the remainder of the briefing. If Jay stepped back out into the Commons before the door locks, `D_R02_R03` SHALL NOT lock him outside. When the briefing ends or is skipped, `D_R02_R03` SHALL return to unlocked (`closed`).

#### Scenario: Normal briefing inside R03
- **WHEN** Jay remains in R03 as Giles and Okafor enter
- **THEN** Heins tells them to lock the door, `D_R02_R03` closes and locks, and `D_R02_R03` unlocks when the briefing finishes

#### Scenario: Jay steps back out before the lock cue
- **WHEN** Jay backs out into R02 before the lock step runs
- **THEN** `D_R02_R03` does not lock Jay outside R03

### Requirement: Objectives update live during the briefing
The briefing objective (`obj_briefing`) SHALL start as soon as the intro ends and complete when `briefing_gallery` starts. The three morning round objectives (`round_hydro`, `round_dive`, `round_admin`) SHALL activate as Heins assigns them on `brief_heins_05`, rather than waiting until after her dismissal line.

#### Scenario: Heins assigns Jay's morning rounds
- **WHEN** `briefing_gallery` reaches `brief_heins_05`
- **THEN** `round_hydro`, `round_dive`, and `round_admin` become active immediately

### Requirement: Briefing remains skippable with identical end state
`briefing_gallery` SHALL remain skippable via the hold-to-skip control. Skipping at any point SHALL leave the same end state as watching to completion: `briefingSeen` set, `obj_briefing` done, all three round objectives active, `D_R02_R03` unlocked (`closed`), Giles and Okafor at their briefing marks inside R03, remaining lines marked played, and `cp_briefing` saved.

#### Scenario: Skipping mid-briefing while the door is locked
- **WHEN** the player skips `briefing_gallery` after `D_R02_R03` has locked
- **THEN** `D_R02_R03` unlocks, `briefingSeen` is true, all three round objectives are active, and `cp_briefing` is saved

### Requirement: Commons dawdle reminder does not force player onto rails
If Jay lingers in the Commons before entering R03, Giles MAY call out a verbal reminder and walk toward the gallery door, but the game SHALL NOT lock Jay's movement or walk him to the door on rails.

#### Scenario: Lingering in the Commons for over 90 seconds
- **WHEN** Jay stays in R02 for 90 seconds after the intro without entering R03
- **THEN** Giles calls out a reminder, and Jay retains full movement and look control with no letterbox bars
