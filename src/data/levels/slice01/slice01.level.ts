/** slice01 for the browser: its part files bundled into one lazy chunk and put together (split-level-data D2). */
import { assembleLevel, levelPartsFromFiles } from '../assembleLevel.ts';

// Eager, so this module carries every file: a lazy glob would fetch one chunk per room.
export default assembleLevel(levelPartsFromFiles(import.meta.glob<unknown>('./**/*.json', { eager: true, import: 'default' })));
