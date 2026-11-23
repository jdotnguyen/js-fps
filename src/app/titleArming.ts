import { gpuKey, type GpuProbeLimits } from '../render/gpuProbe.ts';
import type { Settings } from '../core/settings.ts';
import { armLevel, armQuality, armShared, releaseUnadopted, type SharedLoaders } from './titlePrepare.ts';
import { TitlePreload } from './titlePreload.ts';

export interface TitleArmingDeps {
  defaultLevel: string;
  quality: () => Settings['quality'];
  /** The GPU limits (cached after the first probe), or null when they cannot be read: then no world is prepared. */
  probe: () => GpuProbeLimits | null;
  /** The loaders for one holder. Real ones in the shell, fakes in tests. */
  loaders: (preload: TitlePreload, limits: GpuProbeLimits | null) => SharedLoaders;
  /** The holder the coordinator currently has, so a quality change never touches one a session took. */
  current: () => TitlePreload | null;
  /** False for loads whose world would differ from a prepared one (the UV checker debug material). */
  worldAllowed: boolean;
}

/**
 * Starts and re-starts what the title prepares (openspec `preload-during-title`): a holder per title with the shared,
 * quality and (when the GPU limits are known) level items, and a rebuild of the quality-dependent ones when the
 * graphics quality changes on the title.
 */
export class TitleArming {
  private readonly deps: TitleArmingDeps;
  private limits: GpuProbeLimits | null = null;

  constructor(deps: TitleArmingDeps) {
    this.deps = deps;
  }

  /** A fresh holder for the title being entered, with everything armed. */
  create(): TitlePreload {
    this.limits = this.deps.probe();
    const preload = new TitlePreload({ levelId: this.deps.defaultLevel, quality: this.deps.quality(), gpu: this.limits ? gpuKey(this.limits) : '' });
    const loaders = this.deps.loaders(preload, this.limits);
    armShared(preload, loaders, releaseUnadopted);
    armQuality(preload, loaders, releaseUnadopted);
    if (this.limits && this.deps.worldAllowed) armLevel(preload, loaders, releaseUnadopted);
    return preload;
  }

  /** The player changed the graphics quality on the title: release what was made for the old one and make it again. */
  qualityChanged(): void {
    const preload = this.deps.current();
    if (!preload) return;
    const quality = this.deps.quality();
    if (quality === preload.current.quality) return;
    preload.setQuality(quality);
    const loaders = this.deps.loaders(preload, this.limits);
    armQuality(preload, loaders, releaseUnadopted);
    if (this.limits && this.deps.worldAllowed) armLevel(preload, loaders, releaseUnadopted);
  }
}
