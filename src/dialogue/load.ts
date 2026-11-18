/** Browser loader: every data/dialogue/*.json chapter plus speakers.json, validated at boot. */
import { DialogueLibrary } from './library.ts';

const files = import.meta.glob<unknown>('../data/dialogue/*.json', { eager: true, import: 'default' });

export function loadDialogueLibrary(): DialogueLibrary {
  const chapters: Record<string, unknown> = {};
  let speakers: unknown;
  for (const [path, data] of Object.entries(files)) {
    const name = path.replace('../', '');
    if (name.endsWith('/speakers.json')) speakers = data;
    // ui.json holds HUD string templates (ADR-0024), not dialogue lines.
    else if (!name.endsWith('/ui.json')) chapters[name] = data;
  }
  return new DialogueLibrary(speakers, chapters);
}
