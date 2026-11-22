/**
 * Node only (headless slice, tests): give Recast's separate-`.wasm` build its bytes from disk. The build is compiled for
 * the web and fetches its `.wasm` by URL, which Node's fetch cannot do for `file:` URLs. Emscripten's `wasmBinary` module
 * option hands it the same file instead, so Node runs the same engine build as the browser (trim-startup-bundle D2).
 * Never import this from browser code: it uses `node:fs`.
 */
import { readFile } from 'node:fs/promises';
import { setRecastLoader, type RecastFactory } from './navmeshBuild.ts';

/** The `.wasm` file next to the package's `./wasm` entry (`recast-navigation.wasm.js`). */
const WASM_URL = new URL('recast-navigation.wasm.wasm', import.meta.resolve('@recast-navigation/wasm/wasm'));

setRecastLoader(async () => {
  const [{ default: Recast }, bytes] = await Promise.all([import('@recast-navigation/wasm/wasm'), readFile(WASM_URL)]);
  // init() calls the factory with no arguments; this one passes the bytes through Emscripten's documented option.
  const withBytes = <T>(target?: T) => Recast({ ...target, wasmBinary: bytes } as T);
  return withBytes as unknown as RecastFactory;
});
