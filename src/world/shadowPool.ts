import * as THREE from 'three';
import type { LightSlotKind } from './kit/types.ts';
import type { PooledSlot } from './lightPool.ts';
import { pauseShadow } from '../render/shadowMapKeep.ts';
import type { ShadowCaster } from '../render/shadowCasters.ts';
import { cookieTexture } from '../render/cookies.ts';

/**
 * Downward cone per fixture kind: half-angle (degrees), penumbra, shadow biases and the soft-PCF
 * filter radius in shadow-map texels (`PCFShadowMap` since r183; render-lighting: soft edges).
 */
export const SHADOW_CONES: Record<LightSlotKind, { angle: number; penumbra: number; bias: number; normalBias: number; radius: number }> = {
  ceiling: { angle: 75, penumbra: 0.55, bias: -0.0005, normalBias: 0.03, radius: 2 },
  pendant: { angle: 60, penumbra: 0.6, bias: -0.0003, normalBias: 0.02, radius: 2 },
  wall: { angle: 70, penumbra: 0.6, bias: -0.0004, normalBias: 0.025, radius: 2 },
  emergency: { angle: 70, penumbra: 0.5, bias: -0.0004, normalBias: 0.025, radius: 2 },
};

/** A bound light keeps its shadow until a better candidate has outranked it this long (s; render-lighting "held steadily"). */
export const SHADOW_HOLD = 0.5;
/** Each half of a hand-over: the old shadow fades out over this long, then the new one fades in (s). */
export const SHADOW_FADE = 0.2;
/** A fan pattern's turn rate (rad/s). */
export const FAN_SPIN = 2.4;
/** How far below the fixture a shadow spot aims (m). */
const AIM_DROP = 4;

/** Options for one frame's `assign`. */
export interface ShadowAssignOptions {
  /** Frame time (s); holds and fades advance by it. 0 (the default) freezes them. */
  dt?: number;
  /** The player camera's frustum; omitted, every light counts as in view. */
  frustum?: THREE.Frustum | null;
  /** Moving shadow casters (shadow-rich-rooms D4); omitted, no caster forces a redraw. */
  casters?: Iterable<ShadowCaster>;
}

/** A pool spot's state, read by the lighting overlay and tests. */
export interface ShadowSpotState {
  readonly light: THREE.SpotLight;
  /** The slot it lights, or null while free. */
  readonly slot: PooledSlot | null;
  /** 'in' fading in, 'on' fully shadowed, 'out' fading out before it moves to another light. */
  readonly phase: 'in' | 'on' | 'out';
  /** Shadow strength 0..1. */
  readonly fade: number;
  /** True when the spot's shadow map was redrawn this frame. */
  readonly redrawn: boolean;
  /** True for the tier's patterned spots, which always carry a map (white when the light has no pattern). */
  readonly patterned: boolean;
}

interface Spot extends ShadowSpotState {
  slot: PooledSlot | null;
  patterned: boolean;
  /** A fan pattern's current turn (rad). */
  spin: number;
  phase: 'in' | 'on' | 'out';
  fade: number;
  redrawn: boolean;
  /** Seconds its slot has been outside the frame's best N. */
  outFor: number;
  /** Must redraw on the next check (new binding, map size change). */
  dirty: boolean;
  /** Where the light and its aim were at the last redraw. */
  readonly drawnPos: THREE.Vector3;
  readonly drawnAim: THREE.Vector3;
  readonly drawnUp: THREE.Vector3;
  /** Casters inside its reach at the last redraw, with the version each had then. */
  readonly casters: Map<ShadowCaster, number>;
}

const sphere = new THREE.Sphere();
const reach = new THREE.Sphere();
const tmpCenter = new THREE.Vector3();

/**
 * Bounding sphere of the region a spot cone lights: apex at the fixture, `range` long, `angleDeg`
 * half-angle, pointing along `aim` (or straight down when omitted). Used to ask whether the light's
 * pool of light is in view, not just its fixture.
 */
export function litSphere(position: THREE.Vector3, range: number, angleDeg: number, out: THREE.Sphere, aim?: THREE.Vector3): THREE.Sphere {
  const theta = THREE.MathUtils.degToRad(Math.min(89, Math.max(1, angleDeg)));
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // Centre on the axis k·range along the cone from the apex: at the rim plane for wide cones, halfway for narrow ones.
  const k = theta >= Math.PI / 4 ? cos : 0.5;
  const apex = k;
  const tip = 1 - k;
  const rim = Math.hypot(cos - k, sin);
  out.center.copy(position);
  if (aim) out.center.addScaledVector(aim, k * range);
  else out.center.y -= k * range;
  out.radius = range * Math.max(apex, tip, rim);
  return out;
}

/**
 * Fixed pool of shadow-casting room spot lights (render-lighting spec). Each frame, after culling, the visible
 * slots that opt in with `shadow: true` are ranked: lit area in view first, then the current room, then nearest.
 * A bound slot keeps its spot until it has been outside the best N for SHADOW_HOLD, then its shadow fades out and
 * the spot fades in on the best unbound slot. Spots always keep `castShadow` (toggling it recompiles every
 * material); maps are cached and redrawn only when the light moves, is newly bound, or a moving caster in its
 * reach changes (shadow-rich-rooms D4). An unbound spot sits at intensity 0 with its shadow pass skipped.
 */
export class ShadowPool {
  readonly lights: THREE.SpotLight[] = [];
  private readonly spots: Spot[] = [];
  private readonly parent: THREE.Object3D;
  private mapSize: number;
  private cookieSpots = 0;
  private readonly boundSlots = new Set<PooledSlot>();
  private readonly candidates: PooledSlot[] = [];
  private readonly ranked = new Set<PooledSlot>();
  private readonly best = new Set<PooledSlot>();
  private readonly inside = new Map<ShadowCaster, number>();
  /** Bind without fading on the next assign (first frame, tier switch). */
  private instant = true;
  private suspended = false;
  private lastRedraws = 0;

  constructor(parent: THREE.Object3D, size = 0, mapSize = 1024, cookieSpots = 0) {
    this.parent = parent;
    this.mapSize = mapSize;
    this.resize(size, mapSize, cookieSpots);
  }

  get size(): number {
    return this.lights.length;
  }

  /** Shadow maps redrawn by the last `assign`. */
  get redraws(): number {
    return this.lastRedraws;
  }

  /** Every spot's current state (lighting overlay, tests). */
  states(): readonly ShadowSpotState[] {
    return this.spots;
  }

  /**
   * Grow or shrink to `n` spots, the first `cookieSpots` of them patterned, and set their shadow-map size (a quality-tier
   * switch, which recompiles materials once). Bindings start over without fades.
   */
  resize(n: number, mapSize = this.mapSize, cookieSpots = this.cookieSpots): void {
    const size = Math.max(0, Math.floor(n));
    for (const s of this.spots) this.release(s);
    while (this.lights.length > size) {
      const l = this.lights.pop()!;
      this.spots.pop();
      this.parent.remove(l, l.target);
      l.shadow.map?.dispose();
      l.shadow.map = null;
      l.dispose();
    }
    while (this.lights.length < size) {
      const l = new THREE.SpotLight(0xffffff, 0, 10, THREE.MathUtils.degToRad(70), 0.5, 2);
      l.name = `shadow-light-${this.lights.length}`;
      l.castShadow = true;
      l.shadow.camera.near = 0.1;
      l.shadow.autoUpdate = false;
      l.target.name = `${l.name}:target`;
      this.parent.add(l, l.target);
      this.lights.push(l);
      this.spots.push({
        light: l,
        slot: null,
        phase: 'on',
        fade: 0,
        redrawn: false,
        patterned: false,
        spin: 0,
        outFor: 0,
        dirty: true,
        drawnPos: new THREE.Vector3(Infinity, 0, 0),
        drawnAim: new THREE.Vector3(),
        drawnUp: new THREE.Vector3(),
        casters: new Map(),
      });
    }
    if (mapSize !== this.mapSize) {
      this.mapSize = mapSize;
      for (const l of this.lights) {
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
    }
    for (const l of this.lights) l.shadow.mapSize.set(this.mapSize, this.mapSize);
    // The number of spot maps is part of every lit material's program, so it only changes here, never in play.
    this.cookieSpots = Math.max(0, Math.min(Math.floor(cookieSpots), size));
    this.spots.forEach((s, i) => {
      s.patterned = i < this.cookieSpots;
      s.light.map = s.patterned ? cookieTexture('white') : null;
    });
    this.instant = true;
  }

  /** Patterned spots in the pool. */
  get patternedSpots(): number {
    return this.cookieSpots;
  }

  /**
   * Bind the best opted-in slots to the spots (see the class comment). Opted-in slots that hold no spot lose any
   * light; the caller offers them to the fill pool. Call before LightController.update.
   */
  assign(slots: readonly PooledSlot[], camera: THREE.Vector3, opts: ShadowAssignOptions = {}): void {
    const dt = opts.dt ?? 0;
    const frustum = opts.frustum ?? null;
    this.suspended = false;

    // Rank: lit area in view, then the current room (priority 1), then nearest.
    const c = this.candidates;
    c.length = 0;
    for (const s of slots) {
      if (s.shadow !== true || s.pooled === false) continue;
      const angle = SHADOW_CONES[s.kind ?? 'ceiling'].angle;
      const inView = frustum ? frustum.intersectsSphere(litSphere(s.position, s.range, angle, sphere, s.aim)) : true;
      s.score = (inView ? 0 : 2e8) + (s.priority >= 1 ? 0 : 1e8) + Math.min(s.position.distanceToSquared(camera), 9e7);
      s.item.light = null;
      c.push(s);
    }
    c.sort((a, b) => a.score - b.score);
    this.ranked.clear();
    for (const s of c) this.ranked.add(s);
    this.best.clear();
    for (let i = 0; i < Math.min(c.length, this.spots.length); i++) this.best.add(c[i]!);

    // Held slots: release at once when gone (culled, out), start fading after the hold.
    for (const s of this.spots) {
      if (!s.slot) continue;
      if (!this.ranked.has(s.slot)) {
        this.release(s);
        continue;
      }
      if (this.best.has(s.slot)) {
        s.outFor = 0;
        if (s.phase === 'out') s.phase = 'in';
      } else if (s.phase !== 'out') {
        s.outFor += dt;
        if (s.outFor >= SHADOW_HOLD || this.instant) s.phase = 'out';
      }
      if (this.instant) {
        if (s.phase === 'out') this.release(s);
        else {
          s.phase = 'on';
          s.fade = 1;
        }
        continue;
      }
      if (s.phase === 'in') {
        s.fade = Math.min(1, s.fade + dt / SHADOW_FADE);
        if (s.fade >= 1) s.phase = 'on';
      } else if (s.phase === 'out') {
        s.fade = Math.max(0, s.fade - dt / SHADOW_FADE);
        if (s.fade <= 0) this.release(s);
      }
    }

    // Free spots take the best slots that hold none, in rank order.
    this.boundSlots.clear();
    for (const s of this.spots) if (s.slot) this.boundSlots.add(s.slot);
    // Patterned spots go first, to the best patterned light; then every free spot takes the best light left.
    const pick = (wantCookie: boolean): PooledSlot | undefined => {
      for (const slot of c) if (this.best.has(slot) && !this.boundSlots.has(slot) && (!wantCookie || slot.cookie)) return slot;
      return undefined;
    };
    for (const pass of [true, false]) {
      for (const s of this.spots) {
        if (s.slot || (pass && !s.patterned)) continue;
        const slot = (pass ? pick(true) : undefined) ?? pick(false);
        if (!slot) continue;
        this.bind(s, slot);
        this.boundSlots.add(slot);
      }
    }
    if (this.cookieSpots > 0) {
      this.matchPatterns();
      this.boundSlots.clear();
      for (const s of this.spots) if (s.slot) this.boundSlots.add(s.slot);
    }

    // Place bound spots, then decide which maps to redraw.
    let redraws = 0;
    for (const s of this.spots) {
      s.redrawn = false;
      if (!s.slot) {
        pauseShadow(s.light.shadow);
        continue;
      }
      this.place(s, dt);
      s.slot.item.light = s.light;
      if (this.needsRedraw(s, opts.casters)) {
        s.light.shadow.needsUpdate = true;
        s.redrawn = true;
        redraws++;
      }
    }
    this.lastRedraws = redraws;
    this.instant = false;
  }

  /**
   * An unshadowed side view (a camera feed, a room capture) is about to draw: darken every spot for that draw and
   * give no slot a spot, without touching bindings, holds, fades or cached maps (shadow-rich-rooms D2a).
   * The next `assign` resumes the player's view where it left off.
   */
  suspend(): void {
    this.suspended = true;
    for (const s of this.spots) {
      if (s.slot && s.slot.item.light === s.light) s.slot.item.light = null;
      s.light.intensity = 0;
      s.light.shadow.needsUpdate = false;
    }
  }

  /** True while `slot` holds a shadow spot for the coming draw. */
  holds(slot: PooledSlot): boolean {
    return !this.suspended && this.boundSlots.has(slot);
  }

  /** Darken free spots and apply each bound spot's fade. Call after LightController.update. */
  finish(): void {
    for (const s of this.spots) {
      if (this.suspended || !s.slot) {
        s.light.intensity = 0;
        continue;
      }
      const f = s.fade;
      s.light.shadow.intensity = f * f * (3 - 2 * f);
    }
  }

  /** True when a bound, mostly faded-in shadow spot's cone covers `p` (contact shadows weaken there; D8). */
  covers(p: THREE.Vector3): boolean {
    if (this.suspended) return false;
    for (const s of this.spots) {
      if (!s.slot || s.fade < 0.5) continue;
      const l = s.light;
      const dx = p.x - l.position.x;
      const dy = p.y - l.position.y;
      const dz = p.z - l.position.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > l.distance || d === 0) continue;
      const aim = s.slot.aim;
      const dot = aim ? (dx * aim.x + dy * aim.y + dz * aim.z) / d : -dy / d;
      if (dot >= Math.cos(l.angle)) return true;
    }
    return false;
  }

  /** Spots lighting a slot for the coming draw. */
  boundCount(): number {
    if (this.suspended) return 0;
    let n = 0;
    for (const s of this.spots) if (s.slot) n++;
    return n;
  }

  private bind(s: Spot, slot: PooledSlot): void {
    if (this.instant) this.adopt(s, slot, 'on', 1, 0);
    else this.adopt(s, slot, 'in', 0, 0);
  }

  /**
   * Patterned lights onto patterned spots (D7): a patterned light holding a plain spot moves to a free patterned spot,
   * or trades places with an unpatterned light holding one. Both keep their shadow, phase and fade; only the light
   * object that draws them changes (both maps redraw once).
   */
  private matchPatterns(): void {
    for (const a of this.spots) {
      if (a.patterned || !a.slot?.cookie || a.phase === 'out') continue;
      const b = this.spots.find((s) => s.patterned && (!s.slot || (!s.slot.cookie && s.phase !== 'out')));
      if (!b) return;
      const [slotA, phaseA, fadeA, outA] = [a.slot, a.phase, a.fade, a.outFor];
      if (b.slot) this.adopt(a, b.slot, b.phase, b.fade, b.outFor);
      else this.release(a);
      this.adopt(b, slotA, phaseA, fadeA, outA);
    }
  }

  /** Point spot `s` at `slot` with the given hand-over state: cone, biases, pattern, and a redraw. */
  private adopt(s: Spot, slot: PooledSlot, phase: Spot['phase'], fade: number, outFor: number): void {
    if (s.slot && s.slot !== slot && s.slot.item.light === s.light) s.slot.item.light = null;
    s.slot = slot;
    s.phase = phase;
    s.fade = fade;
    s.outFor = outFor;
    s.dirty = true;
    s.casters.clear();
    const cone = SHADOW_CONES[slot.kind ?? 'ceiling'];
    const l = s.light;
    l.angle = THREE.MathUtils.degToRad(cone.angle);
    l.penumbra = cone.penumbra;
    l.shadow.bias = cone.bias;
    l.shadow.normalBias = cone.normalBias;
    l.shadow.radius = cone.radius;
    if (s.patterned) l.map = cookieTexture(slot.cookie ?? 'white');
    s.spin = 0;
    l.shadow.camera.up.set(0, 1, 0);
  }

  private release(s: Spot): void {
    if (s.slot && s.slot.item.light === s.light) s.slot.item.light = null;
    s.slot = null;
    s.phase = 'on';
    s.fade = 0;
    s.outFor = 0;
    s.dirty = true;
    s.casters.clear();
    s.light.shadow.intensity = 0;
  }

  /** Follow the slot (a swinging fixture moves it), its colour and reach, and turn a fan pattern. */
  private place(s: Spot, dt: number): void {
    const slot = s.slot!;
    const l = s.light;
    if (s.patterned && slot.cookie === 'fan') {
      // The pattern is projected through the shadow camera, so turning its up vector turns the blades (D7).
      s.spin = (s.spin + dt * FAN_SPIN) % (Math.PI * 2);
      l.shadow.camera.up.set(Math.cos(s.spin), 0, Math.sin(s.spin));
    }
    l.position.copy(slot.position);
    if (slot.aim) l.target.position.copy(slot.position).addScaledVector(slot.aim, AIM_DROP);
    else l.target.position.copy(slot.position).setY(slot.position.y - AIM_DROP);
    l.target.updateMatrixWorld();
    l.color.copy(slot.color);
    l.distance = slot.range;
    if (l.shadow.camera.far !== slot.range) {
      l.shadow.camera.far = slot.range;
      s.dirty = true;
    }
  }

  /** D4: newly bound, moved, or a moving caster in reach changed or left since the last redraw. */
  private needsRedraw(s: Spot, casters: Iterable<ShadowCaster> | undefined): boolean {
    const l = s.light;
    let redraw = s.dirty;
    if (!l.position.equals(s.drawnPos) || !l.target.position.equals(s.drawnAim) || !l.shadow.camera.up.equals(s.drawnUp)) redraw = true;
    const inside = this.inside;
    inside.clear();
    if (casters) {
      reach.center.copy(l.position);
      reach.radius = l.distance;
      for (const c of casters) {
        if (!c.bounds(sphere) || !sphere.intersectsSphere(reach)) continue;
        const v = c.version;
        inside.set(c, v);
        if (s.casters.get(c) !== v) redraw = true;
      }
    }
    if (!redraw) for (const c of s.casters.keys()) if (!inside.has(c)) redraw = true;
    if (!redraw) return false;
    s.dirty = false;
    s.drawnPos.copy(l.position);
    s.drawnAim.copy(l.target.position);
    s.drawnUp.copy(l.shadow.camera.up);
    s.casters.clear();
    for (const [c, v] of inside) s.casters.set(c, v);
    return true;
  }
}

/** Centre of a slot's lit area (lighting overlay). */
export function litCenter(slot: PooledSlot, out = tmpCenter): THREE.Vector3 {
  return out.copy(litSphere(slot.position, slot.range, SHADOW_CONES[slot.kind ?? 'ceiling'].angle, sphere, slot.aim).center);
}
