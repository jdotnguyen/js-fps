import { hashString, Rng } from '../core/rng.ts';
import { validate, ValidationError } from '../core/validate.ts';
import { CREW_PREFIX, validateChapter, validateSpeakers, type DialogueLine, type VoiceProfile } from '../data/types/dialogue.ts';

/** Subtitle time on screen (ADR-0010): max(minDuration, 0.35 s per word + 0.8 s). */
export function subtitleDuration(text: string, minDuration: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(minDuration, words * 0.35 + 0.8);
}

/**
 * All loaded dialogue: lines by id across chapters, and speaker voice profiles.
 * Built from raw JSON so it works with Vite's import.meta.glob and Node's readFileSync.
 */
export class DialogueLibrary {
  private readonly lines = new Map<string, DialogueLine>();
  private readonly speakers: Record<string, VoiceProfile>;
  private readonly generated = new Map<string, VoiceProfile>();

  constructor(rawSpeakers: unknown, rawChapters: Record<string, unknown>) {
    this.speakers = validate(validateSpeakers, rawSpeakers, 'data/dialogue/speakers.json');
    for (const [source, raw] of Object.entries(rawChapters)) {
      const chapter = validate(validateChapter, raw, source);
      chapter.lines.forEach((line, i) => {
        const at = `${source} > lines[${i}]`;
        const first = this.lines.get(line.id);
        if (first) throw new ValidationError(`${at} > id`, `duplicate line id "${line.id}"`);
        if (!this.hasSpeaker(line.speaker)) {
          throw new ValidationError(`${at} > speaker`, `unknown speaker "${line.speaker}" (known: ${Object.keys(this.speakers).join(', ')}, ${CREW_PREFIX}*)`);
        }
        this.lines.set(line.id, line);
      });
    }
  }

  hasSpeaker(id: string): boolean {
    return id in this.speakers || (id.startsWith(CREW_PREFIX) && id.length > CREW_PREFIX.length);
  }

  line(id: string): DialogueLine {
    const line = this.lines.get(id);
    if (!line) throw new Error(`Unknown dialogue line "${id}"`);
    return line;
  }

  hasLine(id: string): boolean {
    return this.lines.has(id);
  }

  allLines(): DialogueLine[] {
    return [...this.lines.values()];
  }

  speakerIds(): string[] {
    return Object.keys(this.speakers);
  }

  /** Voice profile; `crew_<x>` gets a stable seeded variation of the `crew` template. */
  speaker(id: string): VoiceProfile {
    const fixed = this.speakers[id];
    if (fixed) return fixed;
    if (!this.hasSpeaker(id)) throw new Error(`Unknown speaker "${id}"`);
    let profile = this.generated.get(id);
    if (!profile) {
      const base = this.speakers['crew']!;
      const spread = base.spread ?? 0.3;
      const rng = new Rng(hashString(id));
      profile = {
        ...base,
        f0: base.f0 * (1 + rng.range(-spread, spread)),
        formants: Math.min(1.5, Math.max(0.7, base.formants * (1 + rng.range(-spread, spread) * 0.5))),
        tempo: base.tempo * rng.range(0.9, 1.1),
        breath: Math.min(1, base.breath * rng.range(0.6, 1.6)),
      };
      this.generated.set(id, profile);
    }
    return profile;
  }
}
