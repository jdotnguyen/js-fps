# vo-audio-manifest Specification

## Purpose

Keeps the `audio` field of every dialogue line in `src/data/dialogue/*.json` trustworthy. Tools that sync the manifest (`scripts/vo-generate.ts`, `scripts/vo-reactions.ts`) and hand edits must never silently drop a wired recording.

## Requirements

### Requirement: Manifest sync never nulls a working recording
When `scripts/vo-generate.ts` syncs dialogue `audio` fields, it SHALL set a line to `assets/vo/<id>.mp3` only when that file exists, and SHALL set a line to `null` only when its current `audio` points at a file that no longer exists. A line already wired to a different file that exists (a credited recording from `LINE_POOLS` in `scripts/vo-reactions.ts`, such as `sec_priya_02` -> `assets/vo/react_priya_scream_slam.mp3`) SHALL be left unchanged. Variant arrays SHALL never be touched. The rule lives in `manifestAudio` (`scripts/lib/voManifest.ts`).

#### Scenario: Credited scream survives a sync
- **WHEN** the manifest sync runs and `sec_priya_02` has `audio` `assets/vo/react_priya_scream_slam.mp3`, which exists, but no `assets/vo/sec_priya_02.mp3`
- **THEN** the line keeps its `audio` value

#### Scenario: Genuinely missing file is nulled
- **WHEN** a line's `audio` points at a file that is not in `public/assets/vo/`
- **THEN** the sync sets it to `null` and reports it as updated

### Requirement: An unexpected null audio is flagged, not committed
A change that turns a non-null `audio` into `null` on any dialogue line SHALL be treated as suspect. Before committing a dialogue JSON diff, the author (human or agent) SHALL check `git diff -U0 -- src/data/dialogue` for `"audio": null` additions and either confirm the recording was deliberately removed (and note why in the commit) or restore the previous value. An agent that sees such a hunk in the working tree SHALL stop and ask the user instead of committing it.

#### Scenario: Reviewing a dialogue diff
- **WHEN** a diff of `src/data/dialogue/slice01.json` contains `-"audio": "assets/vo/....mp3"` and `+"audio": null` on the same line
- **THEN** the author restores the old value, or records in the commit message that the recording was removed on purpose
