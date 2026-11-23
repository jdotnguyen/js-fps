/**
 * Pure VO catalog builder for /voices.html: groups every dialogue line, reaction variant pool,
 * standalone SFX vocal clip, unreferenced file in public/assets/vo/, and infected vocal clip
 * by character. Node-testable with zero DOM/Web Audio imports.
 */
import { validate } from '../../core/validate.ts';
import {
  audioUrls,
  validateChapter,
  type Channel,
  type DialogueLine,
  type Emote,
  type Priority,
} from '../../data/types/dialogue.ts';
import type { DialogueLibrary } from '../library.ts';

export type VoSourceKind = 'dialogue' | 'sfx' | 'unreferenced';

export interface CharacterMeta {
  /** Human-readable character name shown in group headers. */
  readonly displayName: string;
  /** Role or brief context. */
  readonly role: string;
  /** Cast metadata from docs/voice-casting-standard.md (informational). */
  readonly castNote?: string;
}

/** Display metadata & canonical sort order for known cast members. */
export const CHARACTER_META: Readonly<Record<string, CharacterMeta>> = {
  engineer: { displayName: 'August Giles', role: 'Systems Engineer', castNote: 'Algenib · 2.5-flash' },
  medic: { displayName: 'Dr. Tomas Okafor', role: 'Trauma Surgeon', castNote: 'Charon · 2.5-flash' },
  player: { displayName: 'Jay', role: 'Security Officer (Player)', castNote: 'Orus · 3.1-flash' },
  nurse: { displayName: 'Priya Anand', role: 'Medical Nurse', castNote: 'Sulafat · 3.1-flash' },
  chief: { displayName: 'Katie Heins', role: 'Security Chief', castNote: 'Kore · 3.1-flash' },
  director: { displayName: 'Director Hale', role: 'Station Administrator', castNote: 'Rasalgethi · 3.1-flash' },
  pa: { displayName: 'Station PA', role: 'TAG Automated Announcements', castNote: 'Gacrux · 3.1-flash' },
  crew_cook: { displayName: 'Bram', role: 'Station Cook', castNote: 'Enceladus · 3.1-flash' },
  crew_dock_guard: { displayName: 'Dock Guard', role: 'Dock Checkpoint Security', castNote: 'Alnilam · 3.1-flash' },
  crew_lab: { displayName: 'Dr. Lena Voss', role: 'Microbiologist', castNote: 'Leda · 3.8-flash' },
  crew_sung: { displayName: 'Sung', role: 'Station Diver', castNote: 'Achird · 3.1-flash' },
  crew_botanist: { displayName: 'Wen (Botanist)', role: 'Hydroponics', castNote: 'Puck · 3.1-flash' },
  crew_ruiz: { displayName: 'Ines Ruiz', role: 'Comms Technician', castNote: 'Aoede · 3.1-flash' },
  crew_assistant: { displayName: "Hale's Assistant", role: 'Administration', castNote: 'Despina · 3.8-flash' },
  crew_mess: { displayName: 'Mess Crew', role: 'Off-Shift Crew', castNote: 'Fenrir · 3.8-flash' },
  crew_maint: { displayName: 'Maintenance Tech', role: 'Dive Bay Maintenance', castNote: 'Iapetus · 3.8-flash' },
  radio_ops: { displayName: 'Station Ops', role: 'Blackout Radio', castNote: 'Zephyr · 3.8-flash' },
  radio_dock: { displayName: 'Docking Ring', role: 'Blackout Radio', castNote: 'Algieba · 3.8-flash' },
  radio_hydro: { displayName: 'Hydroponics', role: 'Blackout Radio', castNote: 'Erinome · 3.8-flash' },
  radio_launch: { displayName: 'Launch Hall', role: 'Blackout Radio', castNote: 'Sadaltager · 3.8-flash' },
  infected: { displayName: 'Infected', role: 'Creature Vocalisations', castNote: 'Recorded SFX' },
};

const CHARACTER_ORDER: readonly string[] = Object.keys(CHARACTER_META);

/** Known non-dialogue VO files wired into src/audio/sounds.ts (so we can label where they are used). */
const SFX_VO_NOTES: Readonly<Record<string, { speaker: string; label: string; text: string }>> = {
  'assets/vo/react_voss_panic_01.mp3': {
    speaker: 'crew_lab',
    label: 'sfx: voss_panic_breath #1',
    text: '[fast shallow terrified panting — Lab B scratch beat]',
  },
  'assets/vo/react_voss_panic_02.mp3': {
    speaker: 'crew_lab',
    label: 'sfx: voss_panic_breath #2',
    text: '[choked whimpering sobs of fear — Lab B scratch beat]',
  },
  'assets/vo/react_voss_panic_03.mp3': {
    speaker: 'crew_lab',
    label: 'sfx: voss_panic_breath #3',
    text: '[ragged hyperventilating gasps — Lab B scratch beat]',
  },
};

export interface VoEntry {
  /** Dialogue line ID, or clip basename (without .mp3) for standalone files. */
  readonly id: string;
  readonly speaker: string;
  readonly sourceKind: VoSourceKind;
  /** Chapter name (e.g. 'slice01', 'slice01_action', 'slice01_barks', 'slice01_rounds') or 'sfx' / 'unreferenced'. */
  readonly chapter: string;
  readonly text: string;
  readonly direction: string | undefined;
  readonly channel: Channel;
  readonly priority: Priority;
  readonly emote: Emote | null;
  /** One or more relative URLs under public/ (e.g. 'assets/vo/giles_cover_01.mp3'). */
  readonly clips: readonly string[];
  /** Original DialogueLine when sourced from a dialogue chapter. */
  readonly line: DialogueLine | null;
}

export interface CharacterGroup {
  readonly speaker: string;
  readonly displayName: string;
  readonly subtitleName: string;
  readonly role: string;
  readonly castNote: string | undefined;
  readonly entries: readonly VoEntry[];
  readonly totalUniqueClips: number;
}

export interface VoCatalog {
  readonly groups: readonly CharacterGroup[];
  readonly chapters: readonly string[];
  readonly totalEntries: number;
  readonly totalDialogueLines: number;
  readonly totalExtraClips: number;
  readonly totalUniqueClips: number;
}

export interface VoFilter {
  readonly query: string;
  readonly chapter: string;
  readonly channel: string;
  readonly speaker: string;
}

/** Infer a speaker ID from an unreferenced VO filename under public/assets/vo/. */
export function inferSpeakerForVoFile(url: string): string {
  const base = url.split('/').pop()?.replace(/\.mp3$/i, '').toLowerCase() ?? '';
  const rules: ReadonlyArray<readonly [RegExp, string]> = [
    [/(^|_)giles(_|$)/, 'engineer'],
    [/(^|_)okafor(_|$)/, 'medic'],
    [/(^|_)jay(_|$)/, 'player'],
    [/(^|_)priya(_|$)/, 'nurse'],
    [/(^|_)heins(_|$)/, 'chief'],
    [/(^|_)hale(_|$)/, 'director'],
    [/(^|_)pa(_|$)/, 'pa'],
    [/(^|_)voss(_|$)/, 'crew_lab'],
    [/(^|_)(bram|cook)(_|$)/, 'crew_cook'],
    [/(^|_)(dock_guard|guard)(_|$)/, 'crew_dock_guard'],
    [/(^|_)sung(_|$)/, 'crew_sung'],
    [/(^|_)(botanist|wen)(_|$)/, 'crew_botanist'],
    [/(^|_)ruiz(_|$)/, 'crew_ruiz'],
    [/(^|_)assistant(_|$)/, 'crew_assistant'],
    [/(^|_)mess(_|$)/, 'crew_mess'],
    [/(^|_)maint(_|$)/, 'crew_maint'],
    [/(^|_)radio_ops(_|$)/, 'radio_ops'],
    [/(^|_)radio_dock(_|$)/, 'radio_dock'],
    [/(^|_)radio_hydro(_|$)/, 'radio_hydro'],
    [/(^|_)radio_launch(_|$)/, 'radio_launch'],
    [/(^|_)zombie/, 'infected'],
  ];
  for (const [re, speaker] of rules) {
    if (re.test(base)) return speaker;
  }
  return 'unassigned';
}

function titleCase(id: string): string {
  return id
    .replace(/^crew_/, '')
    .split('_')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

export function characterDisplayInfo(
  speaker: string,
  library: DialogueLibrary,
): { displayName: string; subtitleName: string; role: string; castNote: string | undefined } {
  const meta = CHARACTER_META[speaker];
  const subtitleName = library.hasSpeaker(speaker) ? library.speaker(speaker).name : speaker === 'unassigned' ? 'Unassigned' : titleCase(speaker);
  if (meta) {
    return { displayName: meta.displayName, subtitleName, role: meta.role, castNote: meta.castNote };
  }
  return {
    displayName: subtitleName !== 'Crew' ? subtitleName : titleCase(speaker),
    subtitleName,
    role: speaker.startsWith('crew_') ? 'Station Crew' : speaker === 'unassigned' ? 'Other Clips' : 'Speaker',
    castNote: undefined,
  };
}

function chapterSortOrder(ch: string): number {
  const order = ['slice01', 'slice01_action', 'slice01_rounds', 'slice01_barks', 'sfx', 'unreferenced'];
  const idx = order.indexOf(ch);
  return idx >= 0 ? idx : order.length;
}

/**
 * Build the full character-grouped VO catalog from raw dialogue chapters plus disk MP3 manifests.
 */
export function buildVoCatalog(
  rawChapters: Readonly<Record<string, unknown>>,
  library: DialogueLibrary,
  voFiles: readonly string[],
  zombieFiles: readonly string[] = [],
): VoCatalog {
  const entriesBySpeaker = new Map<string, VoEntry[]>();
  const referencedUrls = new Set<string>();
  const chapterSet = new Set<string>();

  const pushEntry = (entry: VoEntry): void => {
    const list = entriesBySpeaker.get(entry.speaker) ?? [];
    list.push(entry);
    entriesBySpeaker.set(entry.speaker, list);
    chapterSet.add(entry.chapter);
  };

  let totalDialogueLines = 0;

  // 1. All authored dialogue lines from data/dialogue/*.json (preserving chapter name & authored order).
  const sortedSources = Object.keys(rawChapters).sort();
  for (const source of sortedSources) {
    const chapter = validate(validateChapter, rawChapters[source], source);
    for (const line of chapter.lines) {
      totalDialogueLines++;
      const clips = audioUrls(line.audio);
      for (const u of clips) referencedUrls.add(u);
      pushEntry({
        id: line.id,
        speaker: line.speaker,
        sourceKind: 'dialogue',
        chapter: chapter.chapter,
        text: line.text,
        direction: line.direction,
        channel: line.channel,
        priority: line.priority,
        emote: line.emote,
        clips,
        line,
      });
    }
  }

  let totalExtraClips = 0;

  // 2. Any VO files in public/assets/vo/ not referenced by a dialogue line (SFX vocals or cut/extra takes).
  for (const url of [...voFiles].sort()) {
    if (referencedUrls.has(url)) continue;
    totalExtraClips++;
    const base = url.split('/').pop()?.replace(/\.mp3$/i, '') ?? url;
    const sfxNote = SFX_VO_NOTES[url];
    if (sfxNote) {
      pushEntry({
        id: base,
        speaker: sfxNote.speaker,
        sourceKind: 'sfx',
        chapter: 'sfx',
        text: sfxNote.text,
        direction: sfxNote.label,
        channel: 'local',
        priority: 'story',
        emote: null,
        clips: [url],
        line: null,
      });
    } else {
      const speaker = inferSpeakerForVoFile(url);
      pushEntry({
        id: base,
        speaker,
        sourceKind: 'unreferenced',
        chapter: 'unreferenced',
        text: `[unreferenced clip on disk: ${base}.mp3]`,
        direction: undefined,
        channel: 'local',
        priority: 'idle',
        emote: null,
        clips: [url],
        line: null,
      });
    }
  }

  // 3. Infected vocalisation clips (public/assets/audio/zombies/*.mp3).
  zombieFiles.forEach((url, index) => {
    totalExtraClips++;
    const base = url.split('/').pop()?.replace(/\.mp3$/i, '') ?? url;
    pushEntry({
      id: base,
      speaker: 'infected',
      sourceKind: 'sfx',
      chapter: 'sfx',
      text: `[infected vocalisation clip #${index + 1} — SAMPLE_URLS.zombieVoice]`,
      direction: 'sfx: zombieVoice',
      channel: 'local',
      priority: 'combat',
      emote: null,
      clips: [url],
      line: null,
    });
  });

  // Sort character groups in canonical order, then any unknown speakers alphabetically.
  const speakers = [...entriesBySpeaker.keys()].sort((a, b) => {
    const ia = CHARACTER_ORDER.indexOf(a);
    const ib = CHARACTER_ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    if (a === 'unassigned') return 1;
    if (b === 'unassigned') return -1;
    return a.localeCompare(b);
  });

  const allUniqueClips = new Set<string>();
  const groups: CharacterGroup[] = speakers.map((speaker) => {
    const entries = entriesBySpeaker.get(speaker)!;
    // Keep authored order within each chapter; order chapters story -> action -> rounds -> barks -> sfx -> unreferenced.
    entries.sort((a, b) => chapterSortOrder(a.chapter) - chapterSortOrder(b.chapter));
    const unique = new Set<string>();
    for (const e of entries) {
      for (const c of e.clips) {
        unique.add(c);
        allUniqueClips.add(c);
      }
    }
    const info = characterDisplayInfo(speaker, library);
    return {
      speaker,
      displayName: info.displayName,
      subtitleName: info.subtitleName,
      role: info.role,
      castNote: info.castNote,
      entries,
      totalUniqueClips: unique.size,
    };
  });

  const chapters = [...chapterSet].sort((a, b) => chapterSortOrder(a) - chapterSortOrder(b) || a.localeCompare(b));
  return {
    groups,
    chapters,
    totalEntries: totalDialogueLines + totalExtraClips,
    totalDialogueLines,
    totalExtraClips,
    totalUniqueClips: allUniqueClips.size,
  };
}

/** Filter character groups by search query, chapter, channel, and optional single speaker. */
export function filterCatalog(groups: readonly CharacterGroup[], filter: VoFilter): CharacterGroup[] {
  const q = filter.query.trim().toLowerCase();
  const out: CharacterGroup[] = [];
  for (const g of groups) {
    if (filter.speaker && filter.speaker !== 'all' && g.speaker !== filter.speaker) continue;
    const groupMatchesQuery =
      q !== '' &&
      (g.displayName.toLowerCase().includes(q) ||
        g.speaker.toLowerCase().includes(q) ||
        g.role.toLowerCase().includes(q) ||
        (g.castNote?.toLowerCase().includes(q) ?? false));
    const matched = g.entries.filter((e) => {
      if (filter.chapter && filter.chapter !== 'all' && e.chapter !== filter.chapter) return false;
      if (filter.channel && filter.channel !== 'all' && e.channel !== filter.channel) return false;
      if (q === '' || groupMatchesQuery) return true;
      return (
        e.id.toLowerCase().includes(q) ||
        e.text.toLowerCase().includes(q) ||
        (e.direction?.toLowerCase().includes(q) ?? false) ||
        e.chapter.toLowerCase().includes(q) ||
        (e.emote?.toLowerCase().includes(q) ?? false) ||
        e.clips.some((c) => c.toLowerCase().includes(q))
      );
    });
    if (matched.length === 0) continue;
    const unique = new Set<string>();
    for (const e of matched) for (const c of e.clips) unique.add(c);
    out.push({ ...g, entries: matched, totalUniqueClips: unique.size });
  }
  return out;
}
