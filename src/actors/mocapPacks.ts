import { MOCAP_PACKS } from '../data/mocap/packs.ts';
import type { MocapLibrary, RawMocapFile } from './mocap.ts';

/**
 * Load the clip packs of the given characters (profile ids) into the library before their bodies are built. Packs are their own
 * bundle chunks, so a level only downloads the characters it has. Characters without a pack use the core library.
 */
export async function loadMocapPacks(lib: MocapLibrary, names: Iterable<string>): Promise<void> {
  await Promise.all(
    [...new Set(names)].map(async (name) => {
      const load = MOCAP_PACKS[name];
      if (!load || lib.hasPack(name)) return;
      const mod = await load();
      lib.addPack(name, mod.default as RawMocapFile);
    }),
  );
}

/** Whether a character has its own clip pack. */
export function hasMocapPack(name: string): boolean {
  return name in MOCAP_PACKS;
}
