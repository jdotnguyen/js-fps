import * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import type { SpotKind } from '../data/types/level.ts';

/**
 * ADR-0029 phase 2 — Ambient Director:
 * Drives background crew that are ambient and not held by a sequence. Each stays at an activity
 * spot for 30–90 s, then picks a free spot in the same room (weighted toward tables/bars with
 * company or counters/machines), books it, walks there on the navmesh, and settles in with a
 * smooth sit/lean transition. At most 1 in 5 ambient NPCs in a room moves at once, and moves
 * prefer starting outside Jay's close direct gaze.
 *
 * Pure logic over small spot/agent interfaces so node unit tests run headless without bodies.
 */

export const AMBIENT_TUNING = {
  /** Initial staggered dwell (s) so a room shows natural movement shortly after entry. */
  initialDwell: [10, 55] as const,
  /** Subsequent dwell time (s) at each spot. */
  dwell: [30, 90] as const,
  /** Initial staggered dwell (s) for active work-spot crew (hydroponics botanists). */
  workInitialDwell: [4, 16] as const,
  /** Subsequent dwell time (s) at each work spot so crew stay visibly active during a visit. */
  workDwell: [12, 35] as const,
  /** Preference multiplier for an agent's home room when roaming across multiple rooms (~75% / ~25%). */
  homeRoomWeight: 3.0,
  /** Retry delay (s) when no spot was free or a walk was aborted. */
  retryDwell: [10, 22] as const,
  /** At most this fraction of a room's ambient crew walks at once (min 1 for rooms with >= 2). */
  maxMovingRatio: 0.2,
  /** Casual stroll speed (m/s). */
  walkSpeed: 1.05,
  /** Minimum XZ travel distance (m) so someone doesn't shuffle to the adjacent chair. */
  minMoveDist: 1.2,
  /** Rooms further than this (m) from the camera only advance timers and don't start walks. */
  activeRange: 26,
  /** Prefer not to stand up right in front of Jay when he is looking straight at you. */
  viewDeferDist: 5.0,
  viewDeferCos: 0.65,
  deferTime: [3, 6] as const,
  maxDefers: 2,
  /** Arrival tolerance (m) to accept settling onto the booked spot. */
  arriveTol: 1.1,
} as const;

/** Named story cast and scripted crew who stay under sequence/authored control (ADR-0029). */
export const STORY_NPCS: ReadonlySet<string> = new Set([
  'giles',
  'okafor',
  'priya',
  'heins',
  'hale',
  'ruiz',
  'sung',
  'cook',
  'researcher_b',
  'assistant',
  'dock_guard', // dock-checkpoint: holds his post at the arch
]);

/** Poses of someone actively working at a terminal/station: don't wander away from the desk. */
const DESK_WORK_POSES: ReadonlySet<string> = new Set(['sit_typing', 'typing', 'crouchWork', 'kneel_revive']);

/** True when a level NPC is eligible for ambient wandering. */
export function isAmbientEligible(id: string, initialPose?: string, roam?: readonly string[]): boolean {
  if (STORY_NPCS.has(id)) return false;
  if (roam && roam.length > 0) return true;
  if (initialPose && DESK_WORK_POSES.has(initialPose)) return false;
  return true;
}

export interface AmbientSpot {
  readonly id: string;
  readonly room: string;
  readonly group: string;
  readonly kind: SpotKind;
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  readonly yaw: number;
  /** NPC id currently holding or walking to this spot, or null. */
  taken: string | null;
}

export interface AmbientAgent {
  readonly id: string;
  readonly room: string;
  /** Optional explicit room ids this agent may roam between (work-spot crew). */
  readonly roam?: readonly string[] | undefined;
  /** Initial spot id claimed at level build (restored on reset). */
  readonly initialSpot: string | null;
  /** True when the NPC is alive, human, ambient, not busy with a sequence or offering. */
  available(): boolean;
  /** Current XZ feet position. */
  feet(): { x: number; y: number; z: number };
  /** Walk on the navmesh to `pos` facing `yaw`, calling `onDone` when the walk finishes or cancels. */
  walkTo(pos: { x: number; y: number; z: number }, yaw: number, speed: number, onDone: () => void): void;
  /** Smoothly settle into the spot's pose at `(pos, yaw)`. */
  settle(pos: { x: number; y: number; z: number }, yaw: number, pose: string): void;
}

export interface AmbientView {
  /** Camera/eye position (null = no view culling or gaze deferral). */
  eye: { x: number; y: number; z: number } | null;
  /** Unit XZ camera forward direction, optional. */
  forward?: { x: number; z: number } | null;
}

interface AgentState {
  readonly agent: AmbientAgent;
  readonly workMode: boolean;
  readonly allowedRooms: readonly string[];
  rng: Rng;
  spot: AmbientSpot | null;
  lastGroup: string | null;
  movingTo: AmbientSpot | null;
  /** Monotonic trip id so stale walk callbacks after interrupt/reset are ignored. */
  trip: number;
  dwell: number;
  defers: number;
}

/** Told when an agent gets up from a spot to walk elsewhere, and when it settles on one. */
export type SpotMoveListener = (event: 'leave' | 'settle', spot: Readonly<AmbientSpot>) => void;

export function poseForSpotKind(kind: SpotKind): string {
  if (kind === 'work_crouch') return 'crouchWork';
  if (kind === 'work_clipboard') return 'clipboard';
  if (kind === 'work_bench') return 'typing';
  return kind;
}

export class AmbientDirector {
  private readonly spots: AmbientSpot[];
  private readonly spotById = new Map<string, AmbientSpot>();
  private readonly initialTaken = new Map<string, string | null>();
  private readonly states = new Map<string, AgentState>();
  private readonly byRoom = new Map<string, AgentState[]>();
  private listener: SpotMoveListener | null = null;

  constructor(spots: readonly AmbientSpot[], agents: readonly AmbientAgent[]) {
    // Work on our own mutable records synced with the initial `taken` state.
    this.spots = spots.map((s) => ({ ...s }));
    for (const s of this.spots) {
      this.spotById.set(s.id, s);
      this.initialTaken.set(s.id, s.taken);
    }
    for (const agent of agents) {
      const rng = new Rng(`ambient:${agent.id}`);
      const spot = agent.initialSpot ? (this.spotById.get(agent.initialSpot) ?? null) : null;
      if (spot) spot.taken = agent.id;
      const workMode = (agent.roam?.length ?? 0) > 0;
      const allowedRooms = workMode ? agent.roam! : [agent.room];
      const initRange = workMode ? AMBIENT_TUNING.workInitialDwell : AMBIENT_TUNING.initialDwell;
      const st: AgentState = {
        agent,
        workMode,
        allowedRooms,
        rng,
        spot,
        lastGroup: spot?.group ?? null,
        movingTo: null,
        trip: 0,
        dwell: rng.range(initRange[0], initRange[1]),
        defers: 0,
      };
      this.states.set(agent.id, st);
      this.byRoom.set(agent.room, [...(this.byRoom.get(agent.room) ?? []), st]);
    }
  }

  /** Report real moves between spots (`reset` and `interrupt` report nothing, so loads and scripts are silent). */
  watch(listener: SpotMoveListener | null): void {
    this.listener = listener;
  }

  /** The spots of `kind` in `room` that an agent is settled on now, free of any script. */
  seated(room: string, kind: SpotKind): Array<Readonly<AmbientSpot>> {
    const out: AmbientSpot[] = [];
    for (const st of this.states.values()) {
      if (st.movingTo || st.spot?.room !== room || st.spot.kind !== kind || !st.agent.available()) continue;
      out.push(st.spot);
    }
    return out;
  }

  /** Current spot held or targeted by an NPC (for tests, debug, dynamic chatter). */
  spotOf(id: string): Readonly<AmbientSpot> | null {
    const st = this.states.get(id);
    return st ? (st.movingTo ?? st.spot) : null;
  }

  /** Number of agents currently walking in a room (tests, debug). */
  movingCount(room: string): number {
    return (this.byRoom.get(room) ?? []).filter((s) => s.movingTo !== null).length;
  }

  /** A sequence took over `id`: release any booked/held spot and drop its active trip. */
  interrupt(id: string): void {
    const st = this.states.get(id);
    if (!st) return;
    st.trip++;
    if (st.movingTo && st.movingTo.taken === id) st.movingTo.taken = null;
    if (st.spot && st.spot.taken === id) st.spot.taken = null;
    st.movingTo = null;
    st.spot = null;
    st.defers = 0;
    const dwellRange = st.workMode ? AMBIENT_TUNING.workDwell : AMBIENT_TUNING.dwell;
    st.dwell = st.rng.range(dwellRange[0], dwellRange[1]);
  }

  /** Restore initial spot ownership and deterministic seeded timers (new game / reset). */
  reset(): void {
    for (const s of this.spots) s.taken = this.initialTaken.get(s.id) ?? null;
    for (const st of this.states.values()) {
      st.trip++;
      st.rng = new Rng(`ambient:${st.agent.id}`);
      st.spot = st.agent.initialSpot ? (this.spotById.get(st.agent.initialSpot) ?? null) : null;
      if (st.spot) st.spot.taken = st.agent.id;
      st.lastGroup = st.spot?.group ?? null;
      st.movingTo = null;
      st.defers = 0;
      const initRange = st.workMode ? AMBIENT_TUNING.workInitialDwell : AMBIENT_TUNING.initialDwell;
      st.dwell = st.rng.range(initRange[0], initRange[1]);
    }
  }

  update(dt: number, view: AmbientView = { eye: null }): void {
    for (const [, list] of this.byRoom) {
      const hasWorkRoam = list.some((s) => s.workMode);
      if (list.length < 2 && !hasWorkRoam) continue;
      const cap = Math.max(1, Math.floor(list.length * AMBIENT_TUNING.maxMovingRatio));
      let moving = 0;
      for (const st of list) {
        if (st.movingTo) moving++;
      }
      for (const st of list) {
        if (st.movingTo) continue;
        if (!st.agent.available()) continue;
        st.dwell -= dt;
        if (st.dwell > 0) continue;
        if (moving >= cap) {
          st.dwell = st.rng.range(4, 10);
          continue;
        }
        const feet = st.agent.feet();
        // Faraway rooms only advance timers (ADR-0029).
        if (view.eye && Math.hypot(feet.x - view.eye.x, feet.z - view.eye.z) > AMBIENT_TUNING.activeRange) {
          st.dwell = st.rng.range(6, 14);
          continue;
        }
        // Prefer starting moves out of Jay's close direct gaze.
        if (view.eye && view.forward && st.defers < AMBIENT_TUNING.maxDefers && this.inCloseView(feet, view.eye, view.forward)) {
          st.defers++;
          st.dwell = st.rng.range(...AMBIENT_TUNING.deferTime);
          continue;
        }
        const next = this.pickSpot(st, feet);
        if (!next) {
          st.dwell = st.rng.range(...AMBIENT_TUNING.retryDwell);
          continue;
        }
        this.startMove(st, next);
        moving++;
      }
    }
  }

  /** Dynamic prop-group occupancy: returns map of prop group -> list of settled agent ids currently at it. */
  settledGroups(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const st of this.states.values()) {
      if (st.movingTo || !st.spot || !st.agent.available()) continue;
      out.set(st.spot.group, [...(out.get(st.spot.group) ?? []), st.agent.id]);
    }
    return out;
  }

  private inCloseView(feet: { x: number; z: number }, eye: { x: number; z: number }, forward: { x: number; z: number }): boolean {
    const dx = feet.x - eye.x;
    const dz = feet.z - eye.z;
    const d = Math.hypot(dx, dz);
    if (d > AMBIENT_TUNING.viewDeferDist || d < 1e-4) return false;
    return (dx * forward.x + dz * forward.z) / d > AMBIENT_TUNING.viewDeferCos;
  }

  private pickSpot(st: AgentState, feet: { x: number; z: number }): AmbientSpot | null {
    const candidates: Array<{ spot: AmbientSpot; weight: number }> = [];
    const allowed = st.allowedRooms;
    const multiRoom = allowed.length > 1;
    // Count current occupancy per prop group to encourage natural small table groups.
    const occ = new Map<string, number>();
    for (const s of this.spots) {
      if (allowed.includes(s.room) && s.taken) occ.set(s.group, (occ.get(s.group) ?? 0) + 1);
    }
    let total = 0;
    for (const s of this.spots) {
      if (!allowed.includes(s.room) || s.taken !== null) continue;
      if (st.workMode) {
        if (!s.kind.startsWith('work_') && s.kind !== 'lean_counter') continue;
      } else if (s.kind.startsWith('work_')) {
        continue;
      }
      if (Math.hypot(s.pos.x - feet.x, s.pos.z - feet.z) < AMBIENT_TUNING.minMoveDist) continue;
      let w = s.kind === 'lean_counter' || s.kind === 'lean_wall' ? 1.4 : 1.0;
      if (st.workMode && multiRoom) {
        w *= s.room === st.agent.room ? AMBIENT_TUNING.homeRoomWeight : 1.0;
      }
      if (s.kind.startsWith('sit_')) {
        const n = occ.get(s.group) ?? 0;
        if (n >= 1 && n <= 2) w *= 1.8;
        else if (n >= 3) w *= 0.6;
      }
      if (st.lastGroup && s.group === st.lastGroup) w *= 0.35;
      candidates.push({ spot: s, weight: w });
      total += w;
    }
    if (!candidates.length || total <= 0) return null;
    let roll = st.rng.next() * total;
    for (const c of candidates) {
      roll -= c.weight;
      if (roll <= 0) return c.spot;
    }
    return candidates[candidates.length - 1]!.spot;
  }

  private startMove(st: AgentState, dest: AmbientSpot): void {
    const id = st.agent.id;
    const from = st.spot;
    if (st.spot && st.spot.taken === id) st.spot.taken = null;
    st.lastGroup = st.spot?.group ?? st.lastGroup;
    st.spot = null;
    dest.taken = id;
    st.movingTo = dest;
    st.defers = 0;
    const trip = ++st.trip;
    if (from) this.listener?.('leave', from);
    st.agent.walkTo(dest.pos, dest.yaw, AMBIENT_TUNING.walkSpeed, () => {
      if (st.trip !== trip || st.movingTo !== dest) return;
      st.movingTo = null;
      const now = st.agent.feet();
      const close = Math.hypot(now.x - dest.pos.x, now.z - dest.pos.z) <= AMBIENT_TUNING.arriveTol;
      if (st.agent.available() && close) {
        st.spot = dest;
        st.agent.settle(dest.pos, dest.yaw, poseForSpotKind(dest.kind));
        this.listener?.('settle', dest);
        const dwellRange = st.workMode ? AMBIENT_TUNING.workDwell : AMBIENT_TUNING.dwell;
        st.dwell = st.rng.range(dwellRange[0], dwellRange[1]);
      } else {
        if (dest.taken === id) dest.taken = null;
        st.dwell = st.rng.range(...AMBIENT_TUNING.retryDwell);
      }
    });
  }
}

/** Scratch helper to extract unit XZ camera forward vector from a Three.js camera. */
const _fwd = new THREE.Vector3();
export function cameraForwardXZ(camera: THREE.Camera | null, out: { x: number; z: number }): { x: number; z: number } | null {
  if (!camera) return null;
  camera.getWorldDirection(_fwd);
  const len = Math.hypot(_fwd.x, _fwd.z);
  if (len < 1e-4) return null;
  out.x = _fwd.x / len;
  out.z = _fwd.z / len;
  return out;
}
