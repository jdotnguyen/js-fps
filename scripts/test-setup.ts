/**
 * Preload for every `npm test` file (`--import`, see run-tests.ts). It does what a session does before any body is
 * built, the Node way (trim-startup-bundle):
 * - Recast's separate-`.wasm` build gets its bytes from disk (D2), so tests run the browser's engine build.
 * - The shared clip library is loaded; in the game it is its own bundle chunk (D1). Tests that check the unloaded
 *   state clear it first (src/actors/mocap.test.ts).
 */
import '../src/ai/navmeshNode.ts';
import { loadSharedMocapLibrary } from '../src/actors/mocap.ts';

await loadSharedMocapLibrary();
