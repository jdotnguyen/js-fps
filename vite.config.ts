import { defineConfig } from 'vite';

export default defineConfig({
  build: {
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
