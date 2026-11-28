# Design

## Context

See [proposal.md](proposal.md) for motivation and scope.

Thalassa (`slice01.json`) has 35 rooms spanning 7 zones (Dock/Hub, Commons, Lab/Breach, Security/Med, Utilities, Hydroponics, Dive Bay, Admin Wing, Transit Wing) and moves through three station states: `morning` (pre-drop, main power), `lockdown` (`drop_started`, main power, red emergency tint), and `blackout` (`power === 'backup'`). Today:

- `AmbienceDirector` (`src/audio/ambience.ts`) crossfades room presets on `room:entered` using only `r.atmosphere.ambience` with no awareness of station phase. Only `R02` Commons and `R12a`–`R12e` Hydroponics have bespoke per-room beds/foley; 12 rooms fall back to `hull_hum`, all 5 Admin rooms share one sparse `office_hvac`, and 3 Dive Bay rooms share `dive_drip` (which fires `distantMoan` even during morning rounds).
- `OverheardDirector` (`src/ai/overheard.ts`) and `data/overheard.json` are hardcoded to a single room (`R02`) and two Commons pairs, even though `slice01.json` already places living NPCs and chat groups in Admin (`admin_hall`, `admin_boardroom`, `assistant`/`admin_visitor`, `exec_2`/`exec_4`), Hydroponics (`botanist_1`/`2`/`3`), Dive Bay (`diver_1`/`maint_1`/`diver_2`), and Docking Ring (`dock_guard`).
- `slice01.json` already places 17 wall-mounted `pa_speaker` grilles across `R01`–`R16a`, and `voicePlayer` + `level.paSpeakerAt()` already spatialize PA lines through them, but only ~6 scripted story PA announcements exist.
- `BarkSystem` (`src/dialogue/barks.ts`) has only 4 cheerful `bark_idle_01..04` lines with no phase or room filtering, so cheerful morning jokes can fire post-blackout.

All new ambience/SFX must be recorded ElevenLabs assets (`scripts/ambience-generate.ts`, no new procedural synths per `audio-assets` spec). All new VO must use Gemini TTS with one pinned voice and model per speaker (`scripts/lib/voCast.ts`, `docs/voice-casting-standard.md`) and pass local Whisper word checks (`scripts/vo-check.ts`).

## Goals / Non-Goals

**Goals:**
- Pure-fidelity bespoke room ambience preset for every distinct room/zone across all 35 rooms of `slice01`.
- Station-phase reactive ambience (`morning` -> `lockdown` -> `blackout`) with clean checkpoint restore.
- Data-driven room-life foley system supporting Admin, Security, Dock, Breach, and Transit alongside existing `CommonsSounds`.
- Multi-room `OverheardDirector` supporting both conversation groups (2–4 NPCs) and solo ambient work snippets across all populated quiet-half wings.
- Periodic `AmbientPaDirector` driving routine morning TAG notices and sparse degraded post-drop warnings at `background` priority with proximity subtitles.
- Phase- and room-aware idle/contextual commentary in `BarkSystem` + `barks01.json`.
- Zero regressions to existing scripted story sequences, blackout radio chatter, Priya's medbay arc, combat/hint barks, or audio audit tests.

**Non-Goals:**
- Rewriting or re-recording any existing dialogue lines or scripted sequences.
- Adding new post-drop distress radio conversations (restrained dread: post-drop adds only sparse automated PA and hushed squad/Jay idle + side-room commentary).
- Procedural audio synthesis for any new room bed or foley effect.
- Capping bespoke stereo bed count for RAM savings (pure acoustic fidelity is prioritized; memory delta is measured and recorded per `runtime-memory`).

## Decisions

### 1. Station-Phase Reactive Ambience (`AmbienceDirector`)

**Decision:** Add a `StationPhase = 'morning' | 'lockdown' | 'blackout'` input to `AmbienceDirector` (`setPhase(phase, fadeSeconds)`), driven from `session.ts` by `drop_started` and station power state (`backup` vs `main`), plus `power_restored` for `R11 Power Bay`. Each preset in `AMBIENCE_PRESETS` may declare optional phase overrides (`blackout?: AmbiencePresetId | Partial<AmbiencePreset>`, `lockdown?: ...`, `restored?: ...`) or per-oneshot `phases?: readonly StationPhase[]` filters.

- When `phase === 'blackout'`, inhabited crew/office presets (`commons_murmur`, `admin_reception`, `admin_open_office`, `directors_office`, `admin_boardroom`, `security_booth`, `dock_ring`) crossfade to `dead_station` (or power-reduced beds with HVAC/work layers muted) and suppress morning work one-shots.
- Horror cues (`distantMoan`, heavy electrical shorts) are tagged with `phases: ['lockdown', 'blackout']` so they never fire during `morning`.
- On checkpoint load / `level:reset`, `setPhase()` is applied *before* `enterRoom()` with `fadeSeconds = 0` so post-blackout saves open straight in the blackout soundscape.

**Alternative considered:** Authoring separate `ambienceBlackout` strings on every room in `slice01.json`. Rejected because phase behavior is a property of the room *preset type* (every Admin room loses HVAC in blackout); preset-level phase mapping keeps `slice01.json` clean and guarantees consistency.

### 2. Full-Station Per-Room Ambience Map (All 35 Rooms)

Every room in `slice01.json` maps to an intentional preset:

| Wing | Room(s) | Preset | New Bed File (`public/assets/audio/ambience/`) | Signature One-Shots / Emitters |
| --- | --- | --- | --- | --- |
| Dock / Hub | `R01` | `dock_ring` | `bed-dock-ring.mp3` | Sub hull settling, gantry creaks, soft metal-detector hum |
| Dock / Hub | `R01w` | `dock_walk` | `bed-dock-walk.mp3` | Pressurized steel walk, distant sub-bay bleed |
| Dock / Hub | `R01a` | `dock_airlock` | `bed-dock-airlock.mp3` | Tight steel chamber, airlock seal hiss |
| Commons | `R02` | `commons_murmur` -> `dead_station` | *(existing)* + `bed-dead-station.mp3` | Existing `CommonsSounds` + radio (morning only) |
| Hub | `R03` | `obs_gallery` | `bed-obs-gallery.mp3` | Soft gallery console/screen hum, faint muffled Lab B bleed |
| Lab / Breach | `R04` | `lab_hum` | *(existing)* | Add positional `freezerHum` & `cultureBubble` emitters |
| Lab / Breach | `R05`, `R06` | `hull_groan` | *(existing)* | `R06`: positional ruptured-duct hiss (`ductHiss`) & manifold pressure ticks |
| Sec / Med | `R07` | `security_office` | `bed-security-office.mp3` | CRT bank hum, wall-clock tick, muted scanner/relay chirps |
| Sec / Med | `R07a` | `armory` | `bed-armory.mp3` | Dry dead steel vault hush, faint locker dehumidifier |
| Sec / Med | `R08` | `med_beeps` | *(existing)* | Existing `medBeep` + clock/cleanroom presence |
| Sec / Med | `R08b` | `surgery` | `bed-surgery.mp3` | Sterile surgical hush, soft ventilator/monitor pulse |
| Utilities | `R09`, `R10` | `water_drip`, `pipes_knock` | *(existing)* | Existing `pipePour`, `pumpRoom` |
| Utilities | `R11` | `power_bay` | `bed-power-bay.mp3` | Heavy 60 Hz switchgear/turbine resonance; boosts when `power_restored` |
| Hydroponics | `R12a`–`R12e` | `hydro_*` (5 existing) | *(existing)* | Existing 5 bespoke beds + prop loops + misters |
| Dive Bay | `R13a` | `wet_vestibule` | `bed-wet-vestibule.mp3` | Damp drain drips, boot-wash hum, NO `distantMoan` in morning |
| Dive Bay | `R13b` | `launch_bay` | *(existing)* | Existing hydraulic/trunk bed + winch clunks |
| Dive Bay | `R13c` | `rov_workshop` | `bed-rov-workshop.mp3` | Battery charger hum, compressed-air hiss, workshop tool ping |
| Dive Bay | `R13d` | `hull_groan` | *(existing)* | Dark maintenance corridor creaks & cable hum |
| Dive Bay | `R13e` | `sample_store` | `bed-sample-store.mp3` | Cold-storage freezer & core-fridge compressor hum |
| Admin Wing | `R14a` | `admin_reception` | `bed-admin-reception.mp3` | Polite lobby HVAC, soft desk phone chime |
| Admin Wing | `R14b` | `admin_open_office` | `bed-admin-open-office.mp3` | Carpeted office bed + desk typing, phones, printer, chair creaks |
| Admin Wing | `R14c` | `directors_office` | `bed-directors-office.mp3` | Executive acoustic dampening, quiet vent/clock solitude |
| Admin Wing | `R14d` | `admin_boardroom` | `bed-admin-boardroom.mp3` | Conference room hush + paper rustles, chair creaks during meeting |
| Admin Wing | `R14e` | `security_booth` | `bed-security-booth.mp3` | Cramped booth + CRT flyback/fan whine & switcher relay clicks |
| Transit Wing | `R15a` | `transit_boarding` | `bed-transit-boarding.mp3` | Vaulted rail platform, tunnel draft, departure board relay clicks |
| Transit Wing | `R15b` | `transit_tunnel` | `bed-transit-tunnel.mp3` | Crushing abyssal ocean pressure & deep water currents |
| Transit Wing | `R16a` | `transit_dock` | `bed-transit-dock.mp3` | Auxiliary-power rail dock, cooling brake ticks, hollow bore echo |
| Transit Wing | `R16b` | `transit_concourse` | `bed-transit-concourse.mp3` | Vast abandoned terminal hall, truss drafts, sparse distant groans |
| Transit Wing | `R16c` | `transit_dispatch` | `bed-transit-dispatch.mp3` | Cramped glass dispatch booth, dead radio static & console fan hum |

All new positional one-shots and emitters in `scripts/ambience-generate.ts` set `mono: true` (for clean HRTF spatialization and half decoded RAM); room beds remain stereo loops (`16–20 s`).

### 3. Data-Driven Room-Life Foley (`RoomFoleyDirector`)

**Decision:** Keep `CommonsSounds` intact for `R02` (chair scrapes bound to NPC seat transitions, Bram's `CookBrew`), and add a lightweight, pure-logic `RoomFoleyDirector` (`src/audio/roomFoley.ts`) driven by a declarative room-foley config (or `src/data/roomFoley.json`):

- Each cue entry declares `{ room, sound, positions (prop anchors or room zones), every: [min, max], gain, reverb, rateRange, phases: ['morning'] | ['lockdown', 'blackout'] | all, talkShare: 0.5 }`.
- Plays on the `sfx` bus so existing wall/door/glass occlusion and `24 m` distance culling work automatically.
- Follows game mode (`title`/`paused` stops/silences cleanly) and `level:reset`.

**Alternative considered:** Putting all room foley inside `AmbienceDirector` random one-shots. Rejected because `AmbienceDirector` places one-shots in abstract rings around the listener (`near`/`perimeter`/`far`), whereas office keyboards, desk phones, CRT monitors, ruptured ducts, and boardroom chairs should come from the actual desks, booths, and pipes in world space and be occluded by walls/doors when the player stands outside the room.

### 4. Multi-Room Overheard Exchanges & Solo Work Snippets (`OverheardDirector`)

**Decision:** Extend `src/data/types/overheard.ts` and `src/ai/overheard.ts` from a single top-level `room` to per-exchange scoping:

```ts
// data/overheard.json (extended schema)
{
  "exchanges": [
    {
      "id": "overheard_bar_before",
      "room": "R02",
      "chat": "commons_bar",          // 2+ NPC chat group
      "requires": ["introSeen"],      // replaces hardcoded phase logic
      "unless": ["briefingSeen", "drop_started"],
      "lines": ["..."]
    },
    {
      "id": "overheard_exec2_call_1",
      "room": "R14b",
      "speaker": "exec_2",            // solo NPC body (mutually exclusive with `chat`)
      "requires": ["briefingSeen"],
      "unless": ["drop_started"],
      "lines": ["..."]
    }
  ]
}
```

- **Group exchanges (`chat`)** keep existing behavior: `keepInPlace()` holds group members until `drop_started`, `suspend(chat, true)` pauses silent filler turns while keeping mutual gaze, and `ConversationMurmur` mutes that group's murmur while ducking nearby groups.
- **Solo snippets (`speaker`)** check that single NPC's position (within 5 m start / 8 m leave) and `available()` state, and play `background` lines directly from that NPC's body with mouth/gesture acting via `wireSpeechActing` (no bystander gaze turn, per `dialogue-channels`).
- **New `chat` links in `slice01.json`:** Add `chat: "admin_reception"` (`assistant`, `admin_visitor`), `chat: "hydro_grow"` (`botanist_1`, `botanist_2`), and `chat: "dive_launch"` (`diver_1`, `maint_1`). `admin_hall` (`exec_1`, `exec_3`) and `admin_boardroom` (`board_1`–`board_4`) already exist in `slice01.json`!
- **Sequence gating:** Hydroponics (`R12b`) and Dive Bay (`R13b`) overheard items require `hydro_moment` / `dive_moment` completion flags (or `sceneRunning(room)` + flag gate) so they never race the opening room scenes.
- **Voice casting (`scripts/lib/voCast.ts` & `src/ai/speakerBodies.ts`):**
  - Reuse existing pinned speakers where the NPC already has a voice: `crew_assistant` (`Despina`, 3.8), `crew_botanist` (`Puck`, 3.1 — mapped cleanly for `botanist_1`), `crew_sung` (`Achird`, 3.1), `crew_maint` (`Iapetus`, 3.8), `crew_dock_guard` (`Alnilam`, 3.1).
  - Cast new background crew speakers on `gemini-3.8-flash-tts` using unused Gemini prebuilt voices (and distinct profiles/acting notes where needed), with explicit `crew_<npcId>` IDs so `npcIdForSpeaker()` maps automatically to every NPC body (preserving `voice-playback: Every local speaker has a body`):
    - `crew_exec_1`, `crew_exec_3` (`admin_hall`), `crew_exec_2`, `crew_exec_4` (solo desk calls)
    - `crew_board_1`, `crew_board_2`, `crew_board_3`, `crew_board_4` (`admin_boardroom`)
    - `crew_admin_visitor` (`admin_reception`)
    - `crew_botanist_2` (`hydro_grow`), `crew_botanist_3` (`R12c` solo)
    - `crew_diver_2` (`R13e` solo)
  - Note: Gemini TTS offers 30 prebuilt voices and 24 are currently used (`voCast.ts`). For minor single-scene background crew beyond the 6 remaining unused voices, check Gemini's current prebuilt voice list first; if more speakers than distinct voices are needed, reuse voices only across **non-interacting wings** (e.g., never two speakers in the same room/exchange sharing a voice) with distinct acting profiles and document the assignment in `docs/voice-casting-standard.md`.

### 5. Ambient Station PA Director (`AmbientPaDirector`) & Proximity Subtitles

**Decision:** Create a pure-logic `AmbientPaDirector` (`src/ai/ambientPa.ts`) backed by `src/data/dialogue/ambient_pa.json`:

- **Line format:** Standard dialogue lines with `speaker: "pa"`, `channel: "pa"`, `priority: "background"`.
- **Pacing:** Uses a seeded `Rng` timer:
  - `morning` pool (~8–10 lines): fires every `75–150 s` of free control after `introSeen` and before `drop_started`. Shuffled without repeats until pool exhausts (or once per playthrough per line via flags/deck).
  - `lockdown` / `blackout` pool (~6–8 lines): fires every `120–210 s` after `drop_started`, outside combat (`!barks.inCombat`).
- **Preconditions:** Player has `freeControl()`, no higher-priority speech audible, no scripted scene running in the player's room, `!inCombat`, recording decoded (`voicePlayer.hasRecorded(line)`), and a `pa_speaker` grille exists within 12 m of the player (so an announcement never fires invisibly in a grille-less tunnel like `R09`).
- **Proximity subtitles (`src/dialogue/speech.ts` & `src/app/session.ts`):**
  - Update earshot/subtitle evaluation for `channel === 'pa'`:
    - `priority !== 'background'` (`story` PA): always in earshot, subtitle always shown (unchanged).
    - `priority === 'background'` (ambient PA): in earshot and subtitle shown only while `distance(player, activePaGrille) <= 12` and `voiceAudibility(level.voicePath(activePaGrille, player)).audible`, re-checked every frame during playback just like local lines.

### 6. Phase- and Room-Aware Squad & Jay Commentary (`BarkSystem`)

**Decision:** Extend `BarkRule` / `BarkLine` metadata (optional `phase?: 'morning' | 'post_drop'`, `room?: string | readonly string[]`, `once?: boolean`) in `src/dialogue/barks.ts` and `src/data/dialogue/barks01.json`:

- **Idle barks (`bark:idle`):**
  - Existing `bark_idle_01..04` remain untouched in ID and audio, tagged/filtered to `phase: 'morning'`.
  - Add ~6 hushed post-drop idle lines (`bark_idle_dark_01..06` for `engineer` and `medic`) tagged `phase: 'post_drop'`.
- **Room-entry / linger commentary (`room:entered` + dwell delay of ~2.5–4 s):**
  - One-time contextual remarks persisted via `heard_<lineId>` game flags (surviving checkpoints):
    - **Morning rounds wings:** `R01` Docking Ring (revisit), `R12b`/`R12c` Hydroponics, `R13b`/`R13e` Dive Bay, `R14b`/`R14d` Admin Wing (Giles on the carpet/executives, Okafor dry observations, Jay solo remarks).
    - **Quiet post-drop side rooms:** `R06` Pressure Door Hall, `R07a` Armory, `R08b` Surgery, `R16c` Arrival Dispatch (hushed, restrained dread — never duplicating rooms that already have scripted entry dialogue).
  - Uses `idle` priority so any scripted scene, story line, or combat bark suppresses or cuts it off cleanly.

### 7. Voice Generation & Verification Plan

- Batch all new Gemini TTS lines strictly by speaker's pinned model (`docs/voice-casting-standard.md`):
  - `gemini-3.8-flash-tts`: single-speaker batches (`--no-pair`) for all new Admin, Hydroponics, Dive Bay ambient crew.
  - `gemini-3.1-flash-tts-preview`: `pa` (1–2 batches for ~14–18 ambient PA lines), `player` (1 batch), `crew_botanist` / `crew_sung` / `crew_dock_guard` (1 batch each).
  - `gemini-2.5-flash-preview-tts`: `engineer` (1 batch, `--batch-size 4` for slow post-drop lines), `medic` (1 batch, `--batch-size 4`).
- Run `scripts/vo-check.ts` and `scripts/vo-trace.ts` after generation; update `docs/voice-casting-standard.md` cast table.
- Run `npm run ambience:generate -- --all` for new ElevenLabs beds, emitters, and one-shots; register in `src/audio/sounds.ts`; verify with `npm run audio:audit`.

## Risks / Trade-offs

- **Decoded audio RAM increase (`runtime-memory` spec):** Adding 22 new stereo room beds (~16–20 s each at 48 kHz) plus mono emitters/one-shots and new VO clips increases decoded audio memory by design for pure acoustic fidelity.
  - **Measured in scratch session (`?slot=scratch&memprobe&nosplash&level=slice01`, 2026-11-26, Chromium headless):**
    - Title baseline: JS heap `17 MB`, GL textures `0` (`0 MB`), decoded audio `4 MB`.
    - Active play (settled after GC): JS heap `360 MB`, GL textures `620` (`1,504 MB`), GL buffers `9,324` (`141 MB`), `three`: `1,884` geometries / `616` textures, decoded audio `475 MB` (zero runtime exceptions).
    - After Quit to title (after GC): JS heap `138 MB`, GL textures `0` (`0 MB`), GL buffers `0` (`0 MB`), `three`: `0` geometries / `0` textures, decoded audio `42 MB` (session VO & level GPU resources released cleanly).
  - → Mitigation: All new positional one-shots and emitters are downmixed to `mono: true`, and session disposal releases all decoded VO buffers cleanly on quit-to-title.
- **Gemini TTS daily free-tier quota (10 requests/day on `2.5-flash` and `3.1-flash`):** Generating all new `pa`, `player`, `engineer`, `medic`, `crew_botanist`, `crew_sung`, and `crew_dock_guard` batches in one day could approach the 10-request limit on `3.1-flash`. → Mitigation: Group lines cleanly into ~10–13-line batches per speaker (total ~5–6 requests on `3.1-flash` and ~3–4 on `2.5-flash`), dry-run first with `--dry-run`, and re-cut from saved raw WAVs (`--resplit`) rather than re-calling the API.
- **Voice cast overlap beyond 30 Gemini prebuilt voices:** 24 of 30 Gemini prebuilt voices are already assigned, and this change adds ~10–12 background NPCs. → Mitigation: Use all remaining unused prebuilt voices first; where reuse is unavoidable across distant wings (e.g., an Admin board member and a Dive Bay sample-store diver who never appear in the same wing), document the separation explicitly in `voCast.ts` and `docs/voice-casting-standard.md` and never reuse a voice within the same wing or from a main cast member.
- **Audio clutter / overlapping chatter in busy rooms:** Adding room foley, murmur, overheard exchanges, ambient PA, and room barks in the same space could muddy intelligibility. → Mitigation: Enforce strict priority hierarchy (`story` > `hint` > `combat` > `idle` > `background`), share `talking` attenuation (`talkShare: 0.5`) across room foley, mute speaking group's murmur and duck neighboring murmurs (`makeWay: 0.45`), and block ambient PA whenever any higher line or overheard exchange is running.
- **Audio audit failures (`npm run audio:audit`):** Unused samples or unregistered files fail tests. → Mitigation: Register every generated file in `SAMPLE_URLS` and wire it into `AMBIENCE_PRESETS`, `roomFoley.json`, or level kit `soundLoop` declarations in the same task slice, verifying with `npm run audio:audit` and `npm test`.

## Migration Plan

- All changes are backward-compatible with existing save files: new overheard exchanges and room remarks default to unheard (`heard_<id>` unset), `AmbienceDirector` defaults unknown presets to `hull_hum`, and `setPhase()` derives the initial phase directly from existing checkpoint flags (`drop_started`, `power`, `power_restored`).
- Rollback is a standard git revert of the change branch; no external database or save-schema migration is required.
