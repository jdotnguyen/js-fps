/**
 * How a voice reaches the player through the station (voice-playback: Voices carry through the station).
 *
 * Sound goes room to room through portals: doorways (open or closed) and glass partitions (sealed or not). The search finds the
 * loudest route from the speaker's room to the listener's room within `MAX_VOICE_BOUNDARIES - 1` portals and reports
 * what it crossed; `voiceAudibility` (occlusion.ts) turns that into gain and tone. Pure, so it is Node-testable.
 */

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** What a portal lets through right now. `'sealed'` is sealed observation glass: it costs what a closed door costs. */
export type PortalState = 'open' | 'closed' | 'glass' | 'sealed';

export interface VoicePortal {
  /** The two room ids it joins. */
  rooms: readonly [string, string];
  /** Where sound passes through it (the doorway's centre). */
  at: P3;
  /** Read at query time, so a door opening mid-line clears the voice during the line. */
  state(): PortalState;
}

export interface VoicePath {
  /** Room boundaries crossed (0 = same room). */
  boundaries: number;
  /** Closed doors and sealed panes among them. */
  closedDoors: number;
  /** Glass partitions among them. */
  glass: number;
  /** Metres along the route: speaker, each portal, listener. */
  pathLength: number;
  /** Straight-line metres from speaker to listener. */
  straight: number;
}

/** A voice this many room boundaries away is silent (voice-playback). */
export const MAX_VOICE_BOUNDARIES = 3;
/** Extra route "metres" a closed door costs when choosing between routes, so an open way round is preferred. */
const CLOSED_DOOR_COST = 15;
/** Extra route "metres" a glass partition costs when choosing between routes. */
const GLASS_COST = 3;

const dist = (a: P3, b: P3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export class VoiceGraph {
  private readonly byRoom = new Map<string, VoicePortal[]>();

  constructor(portals: readonly VoicePortal[]) {
    for (const p of portals) {
      for (const r of p.rooms) {
        const list = this.byRoom.get(r) ?? [];
        list.push(p);
        this.byRoom.set(r, list);
      }
    }
  }

  /**
   * The route a voice takes from `from` (in room `fromRoom`) to `to` (in `toRoom`), or null when no route crosses
   * fewer than `MAX_VOICE_BOUNDARIES` boundaries. A point outside every room counts as the other point's room.
   */
  path(from: P3, fromRoom: string | null, to: P3, toRoom: string | null): VoicePath | null {
    const straight = dist(from, to);
    if (fromRoom === null || toRoom === null || fromRoom === toRoom) {
      return { boundaries: 0, closedDoors: 0, glass: 0, pathLength: straight, straight };
    }
    let best: { cost: number; path: VoicePath } | null = null;
    const walk = (room: string, pos: P3, length: number, cost: number, used: VoicePortal[], closed: number, glass: number): void => {
      if (used.length >= MAX_VOICE_BOUNDARIES - 1) return;
      for (const portal of this.byRoom.get(room) ?? []) {
        if (used.includes(portal)) continue;
        const next = portal.rooms[0] === room ? portal.rooms[1] : portal.rooms[0];
        const s = portal.state();
        const shut = s === 'closed' || s === 'sealed';
        const leg = length + dist(pos, portal.at);
        const legCost = cost + dist(pos, portal.at) + (shut ? CLOSED_DOOR_COST : s === 'glass' ? GLASS_COST : 0);
        const c = closed + (shut ? 1 : 0);
        const g = glass + (s === 'glass' ? 1 : 0);
        const chain = [...used, portal];
        if (next === toRoom) {
          const total = leg + dist(portal.at, to);
          const totalCost = legCost + dist(portal.at, to);
          if (!best || totalCost < best.cost) {
            best = { cost: totalCost, path: { boundaries: chain.length, closedDoors: c, glass: g, pathLength: total, straight } };
          }
          continue;
        }
        walk(next, portal.at, leg, legCost, chain, c, g);
      }
    };
    walk(fromRoom, from, 0, 0, [], 0, 0);
    return (best as { cost: number; path: VoicePath } | null)?.path ?? null;
  }
}
