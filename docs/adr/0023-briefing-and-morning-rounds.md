# ADR-0023: The quiet half: commons, briefing and morning rounds

Status: Accepted (structure from the Nov 16 grilling) / Proposed (rooms, lines, numbers)

## Context
ADR-0014 had the drop (the researcher transforming behind the Lab B glass) at 2:30, straight
after the intro. Justin wants the horror **much later**: first the player should see the
station is alive and feel real [Decided]. The slice no longer has a hard 15-minute target; that
was a guideline [Decided].

The quiet half runs: intro (ADR-0017) -> free time in the commons -> **briefing** in the
observation gallery -> **morning rounds** through three areas -> PA calls the team back to
the gallery -> the drop.

## Decision
- **Order: briefing, then rounds** [Decided]. Nothing goes wrong at the briefing.
- **Rounds are a small hub** [Decided]: the commons is the centre; three required stops in
  **any order**, each itself a hub of 4-5 rooms [Decided], plus optional rooms.
- **Tension stays subtle** [Decided]: announcements, and a glimpse of something wrong on a
  security camera that plants a room the player will return to when worse things happen
  there. No enemies, no jump scares before the drop.
- **Meet more of the crew** [Decided]: scientists, maintenance, executives.
- **Varied looks** [Decided]: not metal corridors throughout; more plants.
- **Locked doors are promises** [Decided]: most locked doors and vents in the quiet half stay
  locked in the slice and only show what they need (ADR-0024). The one exception is the
  **Level 2 Card**, picked up on the rounds and used once to backtrack [Decided].

## 1. Free time in the commons (after the intro)
- Bars fade, `cp_intro`, the blocking tutorial pop-ups for Move, Look and Interact fire
  (ADR-0025) [Decided].
- About 45 s to wander R02: the quarantine notice on the board, a TAG poster, the coffee
  machine, Priya's empty chair, the radio [Decided].
- The squad lingers, then Giles calls "Jay, come on" and they head for the gallery. The badge
  door to R03 is the first real interact [Decided].
- **Dawdle catch** [Decided]: if Jay isn't in the right place when it's time to go, the bars
  come in, Giles calls "Hey!", the camera turns to him and Jay walks over on rails
  (`sequence: commons_dawdle`, ~45 s timer [Assumed]). The squad never leaves without Jay.

## 2. The briefing (R03 observation gallery)
A separate on-rails, skippable sequence, `briefing_gallery` [Decided]. The player walks into
the gallery freely; when Jay reaches his spot, the bars come in and the camera is directed.

- Run by Jay's security chief, **Katie Heins** (short purple hair) [Decided], in person.
- Partway through, the big screen cuts in: **Director Hale**, the station administrator, with
  a smooth "routine quarantine" message about Lab B [Decided: the station's own administrator].
  Heins didn't know and is visibly annoyed; Okafor's eyebrows go up.
- **The Lab B blinds are down** behind them [Assumed, from Q14]. The player stands exactly where
  the drop will happen and sees nothing. When they come back for the drop, the blinds are up.
- Heins hands out the day: Jay's three rounds become the objective list (ADR-0024).
- Ends with `cp_briefing` [Decided]. Skippable on its own, same 3 s hold.

## 3. The morning rounds (three hubs, any order)
Each stop is about 1-2 minutes of required content inside a 4-5 room hub, with one crew
introduction and one small task, plus optional rooms for lore and crew moments.

| Hub | Look and feel | Crew | Required task [Assumed] | Notes |
|---|---|---|---|---|
| **Hydroponics** (R12) | Humid green light, plant racks, misters, condensation; the plant-heavy area [Decided] | Botanists | Sign the irrigation log; check a tripped humidity alarm | Holds a **Level 2** storeroom door (the backtrack) and a sealed vent (hint only) |
| **Dive bay** (R13) | Wet, industrial, moon pool, dive suits on racks, dripping | Maintenance and divers | Escort a diver's sample case to the airlock locker | Dim maintenance corridor: first dark space, the Flashlight pop-up (ADR-0025) [Assumed] |
| **TAG admin office** (R14) | Carpet, warm wood, glass walls, plants in pots, executives | Execs, an assistant | Collect the **Level 2 Card** from Hale's office | Hale in person, nervous off camera, snapping at his assistant; the **security-camera glimpse** |

- **Backtrack** [Decided]: the Level 2 Card from the admin office opens the Level 2 door in
  hydroponics. If hydroponics was done first, the player has already seen the hint ("You'll
  need a **Level 2 Card** to open this door.") and the map icon. Behind it: a crew moment or
  lore, not just supplies [Assumed].
- **The commons changes between stops** [Assumed]: Bram steps out, a TV now shows Hale's
  announcement, a seat fills or empties. The station moves on while Jay works.
- **The security-camera glimpse** [Decided: a camera foreshadow]: on a monitor in the admin
  office (or a security booth on the way), a feed of a room the player will later return to.
  Something small and wrong, e.g. a figure standing very still facing a wall, then the feed
  drops to static [Proposed]. This is also the visual language of Priya's stinger.
- **Uneasy touches during the rounds** stay subtle: the quarantine PA repeats once, a door
  towards Lab B is sealed, a researcher walks past and doesn't say hello [Assumed].
- **TAG FM** plays quietly in two or three rooms [Decided].
- **Jay's lines on the rounds**: full lines in the on-rails scenes; during free-roam crew moments [Open].
  Elsewhere in the slice he only makes reaction sounds ("Ah!") at explosions and jump scares
  [Decided].

## 4. Back to the gallery: the drop
- When all three required stops are done, the PA calls the team back to the gallery [Assumed].
- Blinds are up. ADR-0014 beat 2 plays from here (transformation, lights die, lockdown).
- After the drop the player can pass a ruined room where **TAG FM is still playing** [Decided].

## Rooms and data
- New room IDs R12-R14 (hubs) with sub-rooms `R12a`-`R12e` etc.; R01-R11 keep their IDs.
- New sequences: `commons_dawdle`, `briefing_gallery`, `rounds_return` (PA call), per-hub crew
  moments. Checkpoints: `cp_intro`, `cp_briefing`, one per completed stop (`cp_round_hydro`,
  `cp_round_dive`, `cp_round_admin`) [Assumed].
- New NPCs: Katie Heins, Director Hale, 2-3 botanists, 2-3 maintenance/divers, 2 execs, an
  assistant. All `buildHumanoid` seeds with new outfits (`security_chief`, `exec`, `botanist`,
  `diver`).

## Consequences
- The quiet half is roughly 10-12 minutes; the slice lands around 25-30 minutes [Assumed].
- Three new area looks need new kit pieces (plant racks, moon pool, carpet/wood office).
- Map, objectives and access are their own systems (ADR-0024).

## Execution steps
1. Block out R12-R14 hubs (4-5 rooms each) with structural kit; walk the loop for pacing.
2. Commons wander and `commons_dawdle`.
3. Katie Heins and Director Hale looks; `briefing_gallery` sequence with the screen cut-in and blinds.
4. Rounds tasks as objectives (ADR-0024); Level 2 Card pickup and the hydroponics backtrack.
5. Security-camera glimpse (render-to-texture feed + static).
6. Crew moments and lines; commons state changes between stops.
7. `rounds_return` hands off to ADR-0014 beat 2.

## Open questions
- Whether Jay speaks in free-roam crew moments.
- The exact thing on the security feed, and which room it plants.
- Required task per hub (the table's tasks are placeholders).

## Progress (2026-11-17): hubs blocked out
R12a-e hydroponics (racks under magenta/white grow lights, misters, hanging and potted plants,
greenhouse walls, Level 2 storeroom `hydro_store` with a desk-and-radio crew nook, sealed
`hydro_vent`), R13a-e dive bay (moon pool tile with water, suit racks, lockers, dark
maintenance corridor R13d emitting `area:dark`), R14a-e TAG admin office (carpet, wood
panelling, glass partitions, Hale's office with `P_card_l2`, security booth monitor `admin_cam`
whose screen mesh is `feed:admin_cam` for a later render-to-texture feed; `camera:feed`
{ id, state: live|figure|static } switches the placeholder). Round tasks are use triggers
`round:hydro_log`, `round:hydro_alarm`, `round:dive_case`. Briefing: `wall_screen` listens to
`briefing:screen`; blinds listen to `blinds:set` { id: "labb", state: "up" }. Map areas use
`hydroponics`, `dive_bay`, `admin`, one wall map each. See ADR-0014's progress note for names.
Not yet seen in a browser.

## Progress (Part A built): the quiet half

Built: `briefing_gallery` (now `src/data/sequences/`, starts on `trigger:gallery_brief_spot`, needs
`introSeen`); `commons.json` (`commons_free`, `commons_dawdle`, radio); `rounds.json` (the three
rounds in any order, crew moments, Level 2 Card from Hale, hydro storeroom backtrack, dive case as a
real `sample_case` pickup, `cp_round_*` checkpoints, commons changes, PA call, `rounds_return`);
`drop.json` (R03/R04: Voss transforms behind glass via `transform`, red `alarm` tint, klaxon, glass
`cracked`, lockdown, `drop:done`, `cp_drop`). `area:dark` in R13d; radio follows Jay between rooms.
Admin glimpse uses `cameraFeed` (`src/render/cameraFeed.ts`, `cameraFeedGl.ts`) with a spawned
`medbay_figure` at `anchor:cam04_figure`; Part B can reuse the same feed on any `feed:<id>` mesh.
Tests: `src/script/quiet.test.ts` (every chain, all six round orders, skip behaviour),
`src/render/cameraFeed.test.ts`, extended `slice01.test.ts`.

[Assumed] Timings (45 s free time, 45 s dawdle window, 7 s transformation, drop beats); the Level 2
Card, `sample_case`, `round_return` and `obj_survive_lab` wording and placement; CCTV look and the
throttle rate; the glass crack art (three procedural layers); `medbay_figure` as a `lab` body.
Since built: `quiet_restore` (`quiet_restore.json`, `game:mode playing`: radio in the room named by `radio_place`, commons TV/cook/seat, blinds, Voss transformed, drop lights, cracked glass; the host keeps the same track at the same spot playing so pause/resume does not restart it); `researcher_walkby` in `rounds.json` (a `lab` crew member crosses the commons after the first round, Jay's two unanswered lines `walkby_jay_01/02`); TAG FM in the ruined junction (R05 radio and anchor `r05_radio`: starts at the end of `contact`, before `cp_contact_clear`, stops on `trigger:r06_enter`). Tests in `quiet.test.ts` and `action.test.ts`. Not seen in a browser.
Nothing here has been seen in a browser.
