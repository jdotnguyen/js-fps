import type { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

/** URL flags (ADR-0001): ?debug, ?seq=<id>, ?cp=<id>. */
export interface DebugFlags {
  enabled: boolean;
  seq: string | null;
  cp: string | null;
}

export function readDebugFlags(search: string): DebugFlags {
  const q = new URLSearchParams(search);
  return { enabled: q.has('debug'), seq: q.get('seq'), cp: q.get('cp') };
}

export interface DebugTools {
  gui: GUI;
  beginFrame(): void;
  endFrame(): void;
  dispose(): void;
}

/** Stats + lil-gui, both shipped inside three/examples, loaded only with ?debug. */
export async function createDebugTools(): Promise<DebugTools> {
  const [{ default: Stats }, { GUI }] = await Promise.all([
    import('three/examples/jsm/libs/stats.module.js'),
    import('three/examples/jsm/libs/lil-gui.module.min.js'),
  ]);
  const stats = new Stats();
  stats.dom.style.cssText = 'position:fixed;left:0;top:0;z-index:20;';
  document.body.appendChild(stats.dom);
  const gui = new GUI({ title: 'Debug' });
  return {
    gui,
    beginFrame: () => stats.begin(),
    endFrame: () => {
      stats.end();
    },
    dispose: () => {
      gui.destroy();
      stats.dom.remove();
    },
  };
}
