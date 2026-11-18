import type { EventBus } from '../core/events.ts';
import { h } from './dom.ts';
import { gateLabel, MAP_DECK_H, type MapDoor, type MapModel, type MapState, type MapVent, type P2 } from './mapModel.ts';
import type { ObjectiveTracker } from './objectives.ts';

/**
 * Map overlay (ADR-0024 step 4): opened with the `map` action (default M). The game pauses
 * (`game.openMap`, mode "paused" with the pause menu hidden) and the mouse is free. Drawn on
 * a canvas in the visor style: walked rooms filled, revealed-but-unvisited rooms dimmer and
 * dashed, doors as gaps in the walls, locked doors and vents as icons with text labels, the
 * player as an arrow with his facing. The side panel holds the objective list (required and
 * optional apart), the gates as a focusable list (focus one to centre and highlight it), a
 * legend and the controls. Sizes come from the root font size, so it reads at 200 % UI scale.
 *
 * Keys: arrows / WASD pan, + / - zoom, C centre on Jay, H high contrast, M or Esc close.
 * Mouse: drag to pan, wheel to zoom.
 */

export interface MapScreenDeps {
  parent: HTMLElement;
  events: EventBus;
  model: MapModel;
  state: MapState;
  objectives: ObjectiveTracker;
  /** Player feet position and yaw (radians, 0 faces -Z). */
  player: () => { x: number; y: number; z: number; yaw: number };
  currentRoom: () => string | null;
  itemName: (id: string) => string;
  holds: (id: string) => boolean;
  /** Key codes of the `map` action (KeyboardEvent.code), to close and for the hint. */
  mapKeys: () => readonly string[];
  /** Close: resume play (re-locks the mouse). */
  close: () => void;
  title: string;
}

interface Palette {
  bg: string;
  grid: string;
  seenFill: string;
  seenEdge: string;
  revealFill: string;
  revealEdge: string;
  current: string;
  text: string;
  dim: string;
  player: string;
  item: string;
  unlocked: string;
  sealed: string;
  locked: string;
}

const NORMAL: Palette = {
  bg: '#05090c',
  grid: 'rgba(207,232,240,0.05)',
  seenFill: 'rgba(110,190,210,0.26)',
  seenEdge: '#cfe8f0',
  revealFill: 'rgba(110,190,210,0.09)',
  revealEdge: 'rgba(207,232,240,0.5)',
  current: 'rgba(140,230,255,0.42)',
  text: '#cfe8f0',
  dim: 'rgba(207,232,240,0.6)',
  player: '#39ff9e',
  item: '#ffc95c',
  unlocked: '#39ff9e',
  sealed: '#ff6a5c',
  locked: '#b8c4c8',
};
const HIGH_CONTRAST: Palette = {
  bg: '#000000',
  grid: 'rgba(255,255,255,0.08)',
  seenFill: 'rgba(255,255,255,0.32)',
  seenEdge: '#ffffff',
  revealFill: 'rgba(255,255,255,0.12)',
  revealEdge: '#ffffff',
  current: 'rgba(255,240,0,0.5)',
  text: '#ffffff',
  dim: '#ffffff',
  player: '#ffee00',
  item: '#ffee00',
  unlocked: '#00ff66',
  sealed: '#ff4040',
  locked: '#ffffff',
};

const CONTRAST_KEY = 'js-fps:map:highContrast';
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 5;

type Gate = { kind: 'door'; door: MapDoor } | { kind: 'vent'; vent: MapVent };

/** Pure view maths: world <-> screen for a centre, base scale and zoom (tested). */
export class MapView {
  cx = 0;
  cz = 0;
  zoom = 1;
  /** Pixels per metre at zoom 1. */
  base = 10;
  width = 800;
  height = 600;

  get scale(): number {
    return this.base * this.zoom;
  }

  /** Fit a world rect into the viewport with a margin. */
  fit(r: { x0: number; z0: number; x1: number; z1: number }, margin = 0.1): void {
    const w = Math.max(8, r.x1 - r.x0);
    const d = Math.max(8, r.z1 - r.z0);
    this.base = Math.min(this.width / w, this.height / d) * (1 - margin * 2);
    this.cx = (r.x0 + r.x1) / 2;
    this.cz = (r.z0 + r.z1) / 2;
    this.zoom = 1;
  }

  toScreen(x: number, z: number): P2 {
    return [(x - this.cx) * this.scale + this.width / 2, (z - this.cz) * this.scale + this.height / 2];
  }

  toWorld(sx: number, sy: number): P2 {
    return [(sx - this.width / 2) / this.scale + this.cx, (sy - this.height / 2) / this.scale + this.cz];
  }

  /** Zoom by a factor keeping the world point under (sx, sy) fixed. */
  zoomAt(factor: number, sx = this.width / 2, sy = this.height / 2): void {
    const [wx, wz] = this.toWorld(sx, sy);
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.zoom * factor));
    const [nx, nz] = this.toWorld(sx, sy);
    this.cx += wx - nx;
    this.cz += wz - nz;
  }

  /** Pan by screen pixels. */
  pan(dx: number, dy: number): void {
    this.cx -= dx / this.scale;
    this.cz -= dy / this.scale;
  }
}

export class MapScreen {
  readonly view = new MapView();
  private readonly d: MapScreenDeps;
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly required: HTMLElement;
  private readonly optional: HTMLElement;
  private readonly gates: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly contrastBtn: HTMLButtonElement;
  private readonly live: HTMLElement;
  private highContrast = false;
  private focusGate: string | null = null;
  private drag: { x: number; y: number } | null = null;
  private raf = 0;
  private restoreFocus: Element | null = null;

  constructor(deps: MapScreenDeps) {
    this.d = deps;
    try {
      this.highContrast = localStorage.getItem(CONTRAST_KEY) === '1';
    } catch {
      /* storage blocked */
    }
    this.canvas = h('canvas', { class: 'map-canvas', role: 'img', 'aria-label': 'Station map' });
    this.ctx = this.canvas.getContext('2d');
    this.required = h('ul', { class: 'map-list' });
    this.optional = h('ul', { class: 'map-list' });
    this.gates = h('ul', { class: 'map-list map-gates' });
    this.legend = h('ul', { class: 'map-legend' });
    const btn = (label: string, fn: () => void, attrs: Record<string, string> = {}): HTMLButtonElement => {
      const b = h('button', { type: 'button', class: 'map-btn', ...attrs }, label);
      b.addEventListener('click', fn);
      return b;
    };
    this.contrastBtn = btn('High contrast: off', () => this.toggleContrast(), { 'aria-pressed': 'false' });
    this.live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    const panel = h(
      'aside',
      { class: 'map-panel' },
      h('h3', { class: 'map-h', text: 'Objectives' }),
      this.required,
      h('h3', { class: 'map-h', text: 'Optional' }),
      this.optional,
      h('h3', { class: 'map-h', text: 'Locked doors and vents' }),
      this.gates,
      h('h3', { class: 'map-h', text: 'Legend' }),
      this.legend,
      h(
        'div',
        { class: 'map-controls' },
        btn('Zoom in', () => this.zoom(1.25)),
        btn('Zoom out', () => this.zoom(0.8)),
        btn('Centre on me', () => this.centre()),
        this.contrastBtn,
        btn('Close map', () => this.close()),
      ),
      h('p', { class: 'map-help', text: 'Arrows or WASD pan · + / − zoom · C centre · H contrast · drag and wheel work too' }),
    );
    const header = h('header', { class: 'map-header' }, h('h2', { id: 'map-title', class: 'map-title', text: deps.title }), h('span', { class: 'map-close-hint' }));
    this.root = h(
      'div',
      { class: 'map-screen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'map-title', hidden: true, tabindex: -1 },
      header,
      h('div', { class: 'map-body' }, h('div', { class: 'map-stage' }, this.canvas), panel),
      this.live,
    );
    deps.parent.append(this.root);
    this.root.addEventListener('keydown', (e) => this.onKey(e));
    this.canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.view.pan(e.clientX - this.drag.x, e.clientY - this.drag.y);
      this.drag = { x: e.clientX, y: e.clientY };
      this.draw();
    });
    const endDrag = (): void => {
      this.drag = null;
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = this.canvas.getBoundingClientRect();
        this.view.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
        this.draw();
      },
      { passive: false },
    );
    addEventListener('resize', () => {
      if (this.isOpen) this.layout(false);
    });
    deps.events.on('game:map', () => this.open());
    deps.events.on('game:mode', ({ mode }) => {
      if (mode !== 'paused') this.hide();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    const keys = this.d.mapKeys().map((c) => c.replace(/^(Key|Digit)/, '')).join(' / ') || 'M';
    (this.root.querySelector('.map-close-hint') as HTMLElement).textContent = `${keys} or Esc to close`;
    this.restoreFocus = document.activeElement;
    this.root.hidden = false;
    this.root.classList.toggle('high-contrast', this.highContrast);
    this.layout(true);
    this.fillPanel();
    this.root.focus({ preventScroll: true });
    const known = this.d.model.rooms.filter((r) => this.d.state.knows(r.id)).length;
    this.live.textContent = `Map open. ${known} of ${this.d.model.rooms.length} rooms known.`;
  }

  /** Close and resume play. */
  close(): void {
    if (!this.isOpen) return;
    this.hide();
    this.d.close();
  }

  private hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    cancelAnimationFrame(this.raf);
    const back = this.restoreFocus;
    this.restoreFocus = null;
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
  }

  private onKey(e: KeyboardEvent): void {
    const step = 60;
    const k = e.code;
    if (k === 'Escape' || this.d.mapKeys().includes(k)) {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    // Let Tab, Enter and Space work on the panel's buttons as usual.
    if (e.target instanceof HTMLButtonElement && (k === 'Enter' || k === 'Space' || k === 'NumpadEnter')) return;
    const pans: Record<string, [number, number]> = { ArrowLeft: [step, 0], KeyA: [step, 0], ArrowRight: [-step, 0], KeyD: [-step, 0], ArrowUp: [0, step], KeyW: [0, step], ArrowDown: [0, -step], KeyS: [0, -step] };
    const pan = pans[k];
    if (pan) {
      e.preventDefault();
      this.view.pan(pan[0], pan[1]);
      this.draw();
    } else if (k === 'Equal' || k === 'NumpadAdd') {
      e.preventDefault();
      this.zoom(1.25);
    } else if (k === 'Minus' || k === 'NumpadSubtract') {
      e.preventDefault();
      this.zoom(0.8);
    } else if (k === 'KeyC' || k === 'Digit0') {
      e.preventDefault();
      this.centre();
    } else if (k === 'KeyH') {
      e.preventDefault();
      this.toggleContrast();
    }
  }

  private zoom(f: number): void {
    this.view.zoomAt(f);
    this.draw();
  }

  private centre(): void {
    const p = this.d.player();
    this.view.cx = p.x;
    this.view.cz = p.z;
    this.draw();
  }

  private toggleContrast(): void {
    this.highContrast = !this.highContrast;
    try {
      localStorage.setItem(CONTRAST_KEY, this.highContrast ? '1' : '0');
    } catch {
      /* ignore */
    }
    this.root.classList.toggle('high-contrast', this.highContrast);
    this.fillPanel();
    this.draw();
  }

  private remPx(): number {
    return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  }

  private layout(fit: boolean): void {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.view.width = Math.max(200, rect.width);
    this.view.height = Math.max(200, rect.height);
    this.canvas.width = Math.round(this.view.width * dpr);
    this.canvas.height = Math.round(this.view.height * dpr);
    this.canvas.style.width = `${this.view.width}px`;
    this.canvas.style.height = `${this.view.height}px`;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (fit) {
      // Fit what the player knows (or the whole level if nothing yet), centred on him.
      const known = this.d.model.rooms.filter((r) => this.d.state.knows(r.id));
      const rooms = known.length ? known : this.d.model.rooms;
      const b = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
      for (const r of rooms) {
        b.x0 = Math.min(b.x0, r.bounds.x0);
        b.z0 = Math.min(b.z0, r.bounds.z0);
        b.x1 = Math.max(b.x1, r.bounds.x1);
        b.z1 = Math.max(b.z1, r.bounds.z1);
      }
      if (Number.isFinite(b.x0)) this.view.fit(b);
      const p = this.d.player();
      this.view.cx = p.x;
      this.view.cz = p.z;
    }
    this.draw();
  }

  private gateList(): Gate[] {
    const s = this.d.state;
    const out: Gate[] = [];
    for (const door of this.d.model.doors) if (door.gate && s.doorKnown(door)) out.push({ kind: 'door', door });
    for (const vent of this.d.model.vents) if (s.knows(vent.room)) out.push({ kind: 'vent', vent });
    return out;
  }

  private gateText(g: Gate): string {
    if (g.kind === 'door') return gateLabel(g.door, this.d.itemName, this.d.holds);
    const v = g.vent;
    if (v.sealed) return 'Vent: won’t open';
    if (v.requires) return this.d.holds(v.requires) ? `Vent: ${this.d.itemName(v.requires)} held` : `Vent: needs ${this.d.itemName(v.requires)}`;
    return 'Vent';
  }

  private fillPanel(): void {
    const { required, optional } = this.d.objectives.list();
    const item = (text: string, done: boolean): HTMLElement => h('li', { class: done ? 'done' : '' }, h('span', { class: 'map-check', 'aria-hidden': 'true', text: done ? '✓' : '○' }), h('span', { text: done ? `${text} (done)` : text }));
    this.required.replaceChildren(...(required.length ? required.map((e) => item(e.def.title, e.state === 'done')) : [h('li', { class: 'empty', text: 'None yet' })]));
    this.optional.replaceChildren(...(optional.length ? optional.map((e) => item(e.def.title, e.state === 'done')) : [h('li', { class: 'empty', text: 'None found' })]));
    const gates = this.gateList();
    this.gates.replaceChildren(
      ...(gates.length
        ? gates.map((g) => {
            const id = g.kind === 'door' ? g.door.id : g.vent.id;
            const roomId = g.kind === 'door' ? g.door.rooms.find((r) => this.d.state.knows(r))! : g.vent.room;
            const roomName = this.d.model.rooms.find((r) => r.id === roomId)?.name ?? roomId;
            const b = h('button', { type: 'button', class: 'map-gate', 'data-gate': id }, h('span', { class: `map-icon ${this.iconClass(g)}`, 'aria-hidden': 'true' }), h('span', { text: `${this.gateText(g)} · ${roomName}` }));
            const focus = (): void => {
              this.focusGate = id;
              const at = g.kind === 'door' ? g.door.center : g.vent.center;
              this.view.cx = at[0];
              this.view.cz = at[1];
              this.draw();
            };
            b.addEventListener('focus', focus);
            b.addEventListener('mouseenter', focus);
            b.addEventListener('blur', () => {
              this.focusGate = null;
              this.draw();
            });
            return h('li', {}, b);
          })
        : [h('li', { class: 'empty', text: 'None seen yet' })]),
    );
    const p = this.palette();
    const sw = (cls: string, text: string, style = ''): HTMLElement => h('li', {}, h('span', { class: `map-swatch ${cls}`, style, 'aria-hidden': 'true' }), h('span', { text }));
    this.legend.replaceChildren(
      sw('', 'Walked', `background:${p.seenFill};border-color:${p.seenEdge}`),
      sw('dashed', 'From a wall map, not visited', `background:${p.revealFill};border-color:${p.revealEdge}`),
      sw('arrow', 'You (arrow shows facing)', `color:${p.player}`),
      sw('map-icon item', 'Needs a key item'),
      sw('map-icon unlocked', 'You hold what it needs'),
      sw('map-icon sealed', 'Won’t open'),
      sw('map-icon station', 'Wall map'),
    );
    this.contrastBtn.textContent = `High contrast: ${this.highContrast ? 'on' : 'off'}`;
    this.contrastBtn.setAttribute('aria-pressed', String(this.highContrast));
  }

  private iconClass(g: Gate): string {
    if (g.kind === 'vent') return g.vent.sealed ? 'sealed vent' : g.vent.requires && this.d.holds(g.vent.requires) ? 'unlocked vent' : 'item vent';
    const d = g.door;
    if (d.gate === 'sealed') return 'sealed';
    if (d.gate === 'item') return this.d.holds(d.requires!) ? 'unlocked' : 'item';
    return 'locked';
  }

  private palette(): Palette {
    return this.highContrast ? HIGH_CONTRAST : NORMAL;
  }

  private draw(): void {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.paint());
  }

  private paint(): void {
    const ctx = this.ctx;
    if (!ctx || !this.isOpen) return;
    const v = this.view;
    const p = this.palette();
    const rem = this.remPx();
    const s = this.d.state;
    const me = this.d.player();
    const deck = Math.round(me.y / MAP_DECK_H);
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, v.width, v.height);
    // 4 m grid.
    ctx.strokeStyle = p.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const [wx0, wz0] = v.toWorld(0, 0);
    const [wx1, wz1] = v.toWorld(v.width, v.height);
    for (let x = Math.floor(wx0 / 4) * 4; x <= wx1; x += 4) {
      const [sx] = v.toScreen(x, 0);
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, v.height);
    }
    for (let z = Math.floor(wz0 / 4) * 4; z <= wz1; z += 4) {
      const [, sy] = v.toScreen(0, z);
      ctx.moveTo(0, sy);
      ctx.lineTo(v.width, sy);
    }
    ctx.stroke();

    const cur = this.d.currentRoom();
    const scale = v.scale;
    for (const r of this.d.model.rooms) {
      if (r.deck !== deck) continue;
      const k = s.knowledge(r.id);
      if (!k) continue;
      ctx.fillStyle = r.id === cur ? p.current : k === 'seen' ? p.seenFill : p.revealFill;
      for (const f of r.fill) {
        const [x0, y0] = v.toScreen(f.x0, f.z0);
        ctx.fillRect(x0, y0, (f.x1 - f.x0) * scale + 0.5, (f.z1 - f.z0) * scale + 0.5);
      }
      ctx.strokeStyle = k === 'seen' ? p.seenEdge : p.revealEdge;
      ctx.lineWidth = k === 'seen' ? 2 : 1.5;
      ctx.setLineDash(k === 'seen' ? [] : [6, 4]);
      ctx.beginPath();
      for (const e of r.edges) {
        const [ax, ay] = v.toScreen(e.a[0], e.a[1]);
        const [bx, by] = v.toScreen(e.b[0], e.b[1]);
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Room names where they fit.
    ctx.font = `${Math.round(rem * 0.8)}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const r of this.d.model.rooms) {
      if (r.deck !== deck || !s.knows(r.id)) continue;
      const w = (r.bounds.x1 - r.bounds.x0) * scale;
      const label = r.name.toUpperCase();
      if (ctx.measureText(label).width > w - 6) continue;
      const [cx, cy] = v.toScreen(r.center[0], r.center[1]);
      ctx.fillStyle = s.knowledge(r.id) === 'seen' ? p.text : p.dim;
      ctx.fillText(label, cx, cy - rem * 0.9);
    }
    // Map stations in known rooms.
    for (const st of this.d.model.stations) {
      if (!st.room || !s.knows(st.room)) continue;
      const [x, y] = v.toScreen(st.pos[0], st.pos[1]);
      const sz = rem * 0.55;
      ctx.strokeStyle = p.text;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - sz, y - sz * 0.7, sz * 2, sz * 1.4);
      ctx.fillStyle = s.isRevealed(st.reveals) ? p.unlocked : p.text;
      ctx.font = `bold ${Math.round(rem * 0.65)}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillText('M', x, y + 1);
    }
    // Gates: icon plus a short label.
    for (const g of this.gateList()) {
      const at = g.kind === 'door' ? g.door.center : g.vent.center;
      if (g.kind === 'door' && g.door.deck !== deck) continue;
      const [x, y] = v.toScreen(at[0], at[1]);
      const cls = this.iconClass(g);
      const color = cls.startsWith('sealed') ? p.sealed : cls.startsWith('unlocked') ? p.unlocked : cls.startsWith('item') ? p.item : p.locked;
      const focused = this.focusGate === (g.kind === 'door' ? g.door.id : g.vent.id);
      this.icon(ctx, x, y, rem * (focused ? 0.75 : 0.55), color, cls, p.bg);
      const text = this.gateText(g);
      ctx.font = `${focused ? 'bold ' : ''}${Math.round(rem * (focused ? 0.85 : 0.72))}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textAlign = 'left';
      const tw = ctx.measureText(text).width;
      const tx = x + rem * 0.9;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(tx - 3, y - rem * 0.55, tw + 6, rem * 1.1);
      ctx.fillStyle = color;
      ctx.fillText(text, tx, y);
      ctx.textAlign = 'center';
    }
    // Jay: an arrow with his facing.
    const [px, py] = v.toScreen(me.x, me.z);
    const fx = -Math.sin(me.yaw);
    const fz = -Math.cos(me.yaw);
    const len = Math.max(rem * 0.9, 0.9 * scale);
    const wid = len * 0.55;
    ctx.fillStyle = p.player;
    ctx.strokeStyle = p.bg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + fx * len, py + fz * len);
    ctx.lineTo(px - fx * len * 0.5 + fz * wid, py - fz * len * 0.5 - fx * wid);
    ctx.lineTo(px - fx * len * 0.2, py - fz * len * 0.2);
    ctx.lineTo(px - fx * len * 0.5 - fz * wid, py - fz * len * 0.5 + fx * wid);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private icon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, cls: string, bg: string): void {
    ctx.fillStyle = bg;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (cls.includes('vent')) ctx.rect(x - r, y - r, r * 2, r * 2);
    else ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    if (cls.includes('vent')) {
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(x - r * 0.6, y + i * r * 0.45);
        ctx.lineTo(x + r * 0.6, y + i * r * 0.45);
      }
    } else if (cls.startsWith('sealed')) {
      ctx.moveTo(x - r * 0.5, y - r * 0.5);
      ctx.lineTo(x + r * 0.5, y + r * 0.5);
      ctx.moveTo(x + r * 0.5, y - r * 0.5);
      ctx.lineTo(x - r * 0.5, y + r * 0.5);
    } else {
      // Padlock: body and shackle (open when the item is held).
      ctx.rect(x - r * 0.45, y - r * 0.05, r * 0.9, r * 0.6);
      const open = cls.startsWith('unlocked') ? r * 0.35 : 0;
      ctx.moveTo(x - r * 0.28, y - r * 0.05);
      ctx.arc(x, y - r * 0.05 - open, r * 0.28, Math.PI, 0);
      if (!open) ctx.lineTo(x + r * 0.28, y - r * 0.05);
    }
    ctx.stroke();
  }
}
