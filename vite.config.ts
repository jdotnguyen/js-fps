import { gzipSync } from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';

/** Chunk-size limits, minified kB (startup-bundle spec; trim-startup-bundle D6). This plugin is the one place they live. */
const CHUNK_LIMITS = {
  /** The entry chunk fails the build above this: the title screen loads only the shell (session-loading spec). */
  entry: 250,
  /** Any other chunk warns above this; the lazy chunks load behind the loading screen. */
  chunk: 1500,
  /** The physics engine embeds its WebAssembly as text until Rapier ships a Node-loadable package (design D3). */
  named: { physics: 4500 } as Readonly<Record<string, number>>,
};

/** Report the entry chunk's size, fail the build when it is over budget, and warn about oversized chunks. */
function chunkBudgets(limits: typeof CHUNK_LIMITS): Plugin {
  return {
    name: 'thalassa-chunk-budgets',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        const kb = Buffer.byteLength(chunk.code) / 1000;
        if (chunk.isEntry) {
          const gzipKb = gzipSync(chunk.code).byteLength / 1000;
          this.info(`entry chunk ${chunk.fileName}: ${kb.toFixed(1)} kB (gzip ${gzipKb.toFixed(1)} kB), budget ${limits.entry} kB`);
          if (kb > limits.entry) this.error(`entry chunk ${chunk.fileName} is ${kb.toFixed(1)} kB, over its ${limits.entry} kB budget (startup-bundle spec)`);
          continue;
        }
        const limit = limits.named[chunk.name] ?? limits.chunk;
        if (kb > limit) this.warn(`chunk ${chunk.fileName} is ${kb.toFixed(1)} kB, over its ${limit} kB limit (startup-bundle spec)`);
      }
    },
  };
}

export default defineConfig({
  plugins: [chunkBudgets(CHUNK_LIMITS)],
  optimizeDeps: {
    // Recast's `./wasm` build finds its `.wasm` with `new URL(..., import.meta.url)`; pre-bundling would move the script
    // away from the file (Vite docs: optimizeDeps.exclude), so the dev server serves it from the package as is.
    exclude: ['@recast-navigation/wasm'],
  },
  worker: {
    format: 'es',
  },
  build: {
    // The chunk-budgets plugin owns size warnings; Vite's own stays above its largest limit so it never repeats one.
    chunkSizeWarningLimit: Math.max(CHUNK_LIMITS.chunk, ...Object.values(CHUNK_LIMITS.named)) + 1,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/build/')) {
            return 'three';
          }
          // The physics engine (adopt-physics-engine D10): its own chunk, fetched only when a physics feature is on.
          if (id.includes('node_modules/@dimforge/')) {
            return 'physics';
          }
        },
      },
    },
  },
});
