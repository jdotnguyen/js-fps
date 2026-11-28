# Design

## Context

See proposal.md - Why. Current state that shapes the approach:

- Background conversations (`src/ai/chatter.ts`) are silent: a seeded turn-taker drives mouths, gestures and gaze with filler text. Groups come from `chat` ids in level data, plus ad hoc groups formed by crew settled at the same prop group.
- Ambient crew change seats every 30-90 s, and a member more than 3 m from the group's centre drops out.
- `SpeechManager` already gives per-conversation channels, voice propagation through rooms and doors, and subtitles by distance. Priorities are `idle < combat < hint < story`.
- Every `speech:started`, whatever its priority, currently drives the listen-look in `session.ts`: bystanders within 4.5 m turn to the speaker.
- All dialogue clips are decoded in the background at session start. A line whose clip is not ready plays a synthesized emote instead.
- `ambient` is already the speech channel that barks and hints share.

## Goals / Non-Goals

**Goals:**

- Reuse the speech manager for exchanges, so voices, doors, subtitles and acting work as they do elsewhere.
- Keep the new decision logic pure and Node-testable, like `ChatGroup`.
- Leave data shapes that later changes (more rooms, more phases) can extend by adding entries.

**Non-Goals:**

- A general system for escalation phases. The two phases are flag checks.
- Lip sync for murmuring groups.
- Releasing voice buffers during a session.
- Anything in proposal.md's out-of-scope list.

## Decisions

### D1. Lines are dialogue data; exchanges are their own file

Lines go in `src/data/dialogue/commons_overheard.json` (`channel: local`, `priority: background`). Exchange definitions (id, chat group, phase, ordered line ids) go in `src/data/overheard.json`, outside `dialogue/` because every file there except `ui.json` loads as a chapter. A test checks that each exchange names existing lines, a real chat group and only that group's members.

*Alternative:* a sequence per exchange. Rejected: sequences are trigger-driven scenes with room-presence and skip rules that none of this needs.

### D2. Speakers follow the `crew_<npcId>` rule

Speakers are `crew_crew_2`, `crew_bar_1`, `crew_wall_1` and `crew_chat_5`, which already resolve to those bodies and show "Crew" in subtitles. Each needs a `voCast.ts` entry on `gemini-3.8-flash-tts`. Record one speaker per request: on 2026-11-25 that model rejected a two-speaker request (HTTP 400, "Multi-speaker generation requests must specify speech_metadata.speaker for each text part"), which the shared request code does not send. Voices, none used by another speaker, approved by the user from auditions:

| Speaker | Body | Pair | Voice |
| --- | --- | --- | --- |
| `crew_crew_2` | man | bar | Umbriel |
| `crew_bar_1` | woman | bar | Autonoe |
| `crew_wall_1` | woman | wall | Vindemiatrix |
| `crew_chat_5` | man | wall | Schedar |

### D3. A `background` priority in the speech manager

Add it first in `PRIORITIES` and to the droppable set. The speech manager owns the yielding rules: it holds a background line behind any audible higher line, cuts all background lines when a higher line starts in earshot, leaves them out of `speaking()`, and uses a 6 m subtitle range for them. Barks and hints read `speaking()`, so they need no change. Ducking already reacts only to `story`.

*Alternative:* reuse `idle`. Rejected: idle barks would queue against crew talk, reset their own quiet timer, and show subtitles at 20 m.

### D4. Background lines skip the listen-look

The session's `speech:started` / `speech:ended` handlers that call the NPC director's listen-look ignore background lines, as does the conversation camera in `src/script/actions.ts`. `wireSpeechActing` is unchanged, so the speaker's mouth and gestures still act the line. The pair's own gaze comes from their chat group, including the existing glance at Jay inside 1.8 m.

### D5. An overheard director beside the chat groups

A pure module in `src/ai/` picks and runs exchanges. Each frame it gets the player's room and position, the flags, whether the player has free control, whether a running sequence names the Commons (`room`), whether a higher-priority line is audible, and whether each clip is decoded. It says one line at a time on the channel `overheard:<exchange id>` and advances on `speech:ended`; any reason but `finished` ends the exchange.

- Phases: *before* is `commons_free && !briefingSeen`; *after* is `briefingSeen`. Both require `!drop_started`.
- Played state is a game flag `heard_<exchange id>`, set when the exchange starts, so checkpoints should carry it with no save-format change.
- While an exchange runs, its chat group's filler turn-taking is suspended so it cannot move or close the speakers' mouths.
- The voiced pairs report themselves unavailable to the ambient-life director until the drop.
- Numbers (5 m start, 8 m leave, 2 s quiet, 20 s between a pair's exchanges, 0.35-0.8 s between lines) are starting values. If tuning by ear changes one that a spec states, update the delta in this change.

*Alternative for played state:* counting it only when the exchange finishes. Rejected: a half-heard exchange restarting from the top sounds worse than losing its tail.

### D6. Murmur is a recorded loop per talking group

A controller in `src/audio/` keeps one positional loop per Commons chat group with two or more members engaged, at the centre of their heads, on the `ambience` bus. Its gain is base level x the voice propagation gain for that point x game mode x the make-way factor. Loops cannot change filter while playing, so they use one fixed low-pass and walls act on level only. Three recordings, assigned per group with a seeded rate and start offset, are generated or sourced as `docs/audio-assets.md` describes, with no procedural fallback. They are ElevenLabs generations (`murmurA`-`murmurC` in `scripts/ambience-generate.ts`), downmixed to mono: one web search on 2026-11-25 found no recording confirmed as CC0. Prompts asking for quiet talk came back near silent with a steady tone near 800 Hz under them, so the prompts ask for the speech and the game sets the level.

*Alternatives:* a single room walla (not tied to where people are, and plays when nobody is talking); short per-speaker babble clips in step with the mouths (many more clips and much more tuning for something heard at a distance).

### D7. Script

Jay never speaks in these. Nothing explains the bloom, nothing hints that Giles is infected (dropped on 2026-11-22), and no line depends on a scene the player may have missed.

**Bar, before the briefing** (`overheard_bar_before`)

| Speaker | Line |
| --- | --- |
| crew_2 | Lab B's lot didn't come in to eat yesterday. |
| bar_1 | So? Maybe they packed their own. |
| crew_2 | Bram kept their plates warm till ten. |
| bar_1 | Don't get him started. He'll blame the pipes. |

**Wall, before the briefing** (`overheard_wall_before`)

| Speaker | Line |
| --- | --- |
| chat_5 | Hear the pipes last night? Knocking till four. |
| wall_1 | They always knock. |
| chat_5 | Not in threes, they don't. |
| wall_1 | Get some sleep. You're counting pipes now. |

**Bar, after 1** (`overheard_bar_after_1`)

| Speaker | Line |
| --- | --- |
| bar_1 | "Routine quarantine." You hear how he said that? |
| crew_2 | Same voice he used for the air scrubbers. |
| bar_1 | What happened with the scrubbers? |
| crew_2 | A week of headaches and a very nice memo. |

**Bar, after 2** (`overheard_bar_after_2`)

| Speaker | Line |
| --- | --- |
| crew_2 | Is your shower running warm? Mine won't go cold. |
| bar_1 | Enjoy it. Warm's a luxury down here. |
| crew_2 | It's the cold tap. |
| bar_1 | ...Put in a ticket, then. |

**Wall, after 1** (`overheard_wall_after_1`)

| Speaker | Line |
| --- | --- |
| wall_1 | My courier bag for Lab B came back. |
| chat_5 | Came back how? |
| wall_1 | Unopened. The slip says delivery was not completed. |
| chat_5 | Nobody's completing anything in there this week. |

**Wall, after 2** (`overheard_wall_after_2`)

| Speaker | Line |
| --- | --- |
| chat_5 | There's a pressure drop on the line past Lab B. |
| wall_1 | So log it. |
| chat_5 | I did. It came back marked resolved. |
| wall_1 | Resolved by who? |

## Memory

Measured 2026-11-25 with `window.__memprobe.sample()` at `/?level=slice01&slot=scratch&nosplash&memprobe` (dev server, headless Playwright browser at 1280x720, default settings): New Game, all 332 voice clips loaded, intro skipped, standing in the Commons, heap read after a forced garbage collection. Three samples agreed. The tree was `a97d09c` plus other agents' uncommitted work; Vite hot reload was blocked in the measuring tab.

| | Before | After | Difference |
| --- | --- | --- | --- |
| Decoded audio | 488 MB | 503 MB | +15 MB (+3%) |
| JS heap | 348 MB | 352 MB | +4 MB |
| GPU textures | 1696 MB | 1547 MB | -149 MB, not from this change |

The after figures are the same day's repeat of that run with the 24 real clips and the murmur loops (headless Chrome, tutorial prompts off, 355 voice clips: 332 plus these 24, less `end_jay_01`, which another change removed). Other agents' work landed between the two runs, so only decoded audio is close to this change alone: its 53 s of voice and 36 s of murmur come to about 17 MB at 48 kHz mono, and removing the unused `turbineSpinUp` one-shot gave a little back. This change adds no textures.

## Risks / Trade-offs

- [Standing beside a murmur-only table, wordless talk may sound like mush] -> Keep the level low and judge it on headphones; voicing more groups is a later change.
- [Murmur does not match the mouths] -> Acceptable at a distance; same mitigation.
- [The pre-briefing window is short, and Giles's "come on" can cut an exchange, which then counts as played] -> Accepted. These lines are optional colour and nothing later needs them.
- [The Commons already carries the radio, scripted scenes and hints] -> One exchange at a time, background yields to everything, and per-line `gain` is tuned by ear.
- [More decoded audio, estimated 20-25 MB] -> Measure with `?slot=scratch&memprobe` before and after and record it here, as `runtime-memory` requires.
- [A free-tier TTS quota could stall generation] -> The code is built and tested against a fake player; clips and murmur can land last.

## Open Questions

- None. The user approved the four voices in D2 on 2026-11-25 and the clips are recorded.
