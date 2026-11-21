import * as THREE from 'three';
import { h } from '../dom.ts';
import type { WorldMarkerResult } from '../wayfinding.ts';

const tmp = new THREE.Vector3();

/**
 * Screen-projected in-world objective markers (hud-wayfinding spec): renders only the
 * adjacency-approved targets (same room -> target, adjacent room -> connecting door) when
 * in front of the player's camera.
 */
export class WorldMarkerHud {
  readonly el: HTMLElement;
  private readonly pool: Array<{ el: HTMLElement; glyph: HTMLElement; dist: HTMLElement }> = [];

  constructor(parent: HTMLElement) {
    this.el = h('div', { class: 'world-markers', 'aria-hidden': 'true', hidden: true });
    parent.append(this.el);
  }

  update(visible: boolean, camera: THREE.Camera | null, markers: readonly WorldMarkerResult[]): void {
    const show = visible && camera !== null && markers.length > 0;
    this.el.hidden = !show;
    if (!show || !camera) return;

    while (this.pool.length < markers.length) {
      const glyph = h('span', { class: 'world-marker-glyph' });
      const dist = h('span', { class: 'world-marker-dist' });
      const el = h('div', { class: 'world-marker' }, glyph, dist);
      this.el.append(el);
      this.pool.push({ el, glyph, dist });
    }

    for (let i = 0; i < this.pool.length; i++) {
      const slot = this.pool[i]!;
      const m = markers[i];
      if (!m) {
        slot.el.hidden = true;
        continue;
      }
      tmp.set(m.pos.x, m.pos.y, m.pos.z).project(camera);
      // Hide when behind the camera or off-screen (the top compass shows off-screen direction).
      if (tmp.z < -1 || tmp.z > 1 || Math.abs(tmp.x) > 0.96 || Math.abs(tmp.y) > 0.92) {
        slot.el.hidden = true;
        continue;
      }
      slot.el.hidden = false;
      slot.el.className = `world-marker ${m.kind}${m.required ? '' : ' optional'}`;
      slot.el.style.left = `${((tmp.x * 0.5 + 0.5) * 100).toFixed(2)}%`;
      slot.el.style.top = `${((-tmp.y * 0.5 + 0.5) * 100).toFixed(2)}%`;
      slot.glyph.textContent = m.kind === 'door' ? '◇' : '◆';
      slot.dist.textContent = `${m.distance}m`;
    }
  }
}
