import * as THREE from 'three';
import type { Interactions } from '../actors/interaction.ts';
import type { Navigator } from '../ai/nav.ts';
import type { EventBus, EventName } from '../core/events.ts';
import type { Input } from '../core/input.ts';
import type { DifficultyPreset, DifficultyTable } from '../data/types/difficulty.ts';
import type { ObjectiveDef, ObjectiveTable } from '../data/types/objectives.ts';
import { BarkSystem, type BarkLine } from '../dialogue/barks.ts';
import { HintDirector } from '../dialogue/hints.ts';
import { fixtureMaterial, type Materials } from '../render/materials.ts';
import type { Toasts } from '../ui/toast.ts';
import { ObjectiveHud } from '../ui/hud/objectiveHud.ts';
import { MAP_DECK_H, type MapModel, type MapState, type MapStation } from '../ui/mapModel.ts';
import { MapScreen } from '../ui/mapScreen.ts';
import { NavPulse } from '../ui/navPulse.ts';
import { ObjectiveTracker, type Flags, type LooseBus } from '../ui/objectives.ts';
import type { Level } from '../world/level.ts';
import { Supplies } from './supplies.ts';
import type { AmmoWeapon } from './pickups.ts';
import { isKeyPickup } from '../data/types/level.ts';

declare module '../core/events.ts' {
  interface EventMap {
    'objective:set': { id: string };
    'objective:done': { id: string };
    /** A map station filled in an area (ADR-0024). `rooms`: newly known room ids. */
    'map:revealed': { area: string; station: string; rooms: string[] };
    /** First time this session the player walks into an area that has an unused map station. */
    'map:areaEntered': { area: string };
    /** Barks (ADR-0010): low on ammo (loaded + reserve under one magazine). */
    'player:lowAmmo': { weapon: string; total: number };
    /** Barks: health under 30. */
    'player:lowHealth': { hp: number };
    /** A jump scare or explosion: Jay's "Ah!" (sequences fire it with `emit`). */
    'player:startled': Record<string, never>;
    'bark:idle': Record<string, never>;
  }
}

/** What the speech manager offers (dialogue/speech.ts); null before it exists. */
export interface GuidanceSpeech {
  speaking(): { priority: string } | null;
  say(id: string, opts?: { at?: () => { x: number; y: number; z: number } }): unknown;
}

export interface GuidanceDeps {
  events: EventBus;
  input: Input;
  ui: HTMLElement;
  scene: THREE.Scene;
  materials: Materials;
  interactions: Interactions;
  toasts: Toasts;
  level: Level | null;
  model: MapModel | null;
  mapState: MapState | null;
  objectives: ObjectiveTable;
  barkLines: readonly BarkLine[];
  speech: GuidanceSpeech | null;
  /** Head position of a speaker for positional voices (squadmates), or null. */
  speakerAt?: (speaker: string) => { x: number; y: number; z: number } | null;
  nav: () => Navigator | null;
  difficulties: DifficultyTable;
  preset: () => DifficultyPreset;
  flags: () => Flags;
  mode: () => string;
  /** On rails, cutscene, or a tutorial pop-up open: no map, hints or barks. */
  busy: () => boolean;
  openMap: () => void;
  resume: () => void;
  player: {
    feet(): { x: number; y: number; z: number };
    yaw(): number;
    hp(): number;
    alive(): boolean;
    heal(n: number): boolean;
  };
  ammo: () => Partial<Record<AmmoWeapon, { loaded: number; reserve: number; mag: number }>>;
  addAmmo: (w: AmmoWeapon, n: number) => void;
  /** Weapon pickups (ADR-0005 shotgun): false if already carried. */
  giveWeapon?: (w: AmmoWeapon) => boolean;
  itemName: (id: string) => string;
  holds: (id: string) => boolean;
  /** KeyboardEvent codes bound to an action. */
  keys: (action: 'map') => readonly string[];
}

/**
 * Wires the ADR-0024 map and objectives and the ADR-0010 barks and hints into the running
 * game, plus supply pickups (ADR-0005/0008): one object so `main.ts` only creates it,
 * steps it and renders it.
 */
export class Guidance {
  readonly tracker: ObjectiveTracker;
  readonly hud: ObjectiveHud;
  readonly map: MapScreen | null;
  readonly pulse: NavPulse;
  readonly hints: HintDirector;
  readonly barks: BarkSystem;
  readonly supplies: Supplies;
  private readonly d: GuidanceDeps;
  private readonly areasEntered = new Set<string>();
  private lowAmmoSaid = false;
  private lowHealthSaid = false;
  private lastMode = 'title';

  constructor(d: GuidanceDeps) {
    this.d = d;
    const bus = loose(d.events);
    this.tracker = new ObjectiveTracker(d.objectives, d.flags, bus);
    this.hud = new ObjectiveHud(d.ui, this.tracker);
    this.pulse = new NavPulse(d.nav);
    d.scene.add(this.pulse.group);

    const speech = d.speech;
    const speaking = (): { priority: string } | null => speech?.speaking() ?? null;
    const say = (id: string, speaker?: string): void => {
      if (!speech) return;
      const at = speaker && d.speakerAt ? (): { x: number; y: number; z: number } => d.speakerAt!(speaker) ?? d.player.feet() : undefined;
      speech.say(id, at ? { at } : {});
    };
    this.barks = new BarkSystem({
      lines: d.barkLines,
      bus,
      speech: { speaking, say: (id, sp) => say(id, sp) },
      blocked: () => d.mode() !== 'playing' || d.busy(),
      idleAfter: 75,
    });
    const lineSpeaker = new Map(d.barkLines.map((l) => [l.id, l.speaker]));
    this.hints = new HintDirector({
      active: () => this.tracker.active(),
      delays: () => d.preset().hintDelay,
      speech: { speaking, say: (id) => say(id, lineSpeaker.get(id)) },
      blocked: () => d.mode() !== 'playing' || d.busy() || this.barks.inCombat || !d.player.alive(),
      distance: (o) => this.distanceTo(o),
      onPulse: (o) => this.firePulse(o),
    });
    this.supplies = new Supplies({
      scene: d.scene,
      materials: d.materials,
      events: d.events,
      placed: (d.level?.source.pickups ?? []).filter((p) => !isKeyPickup(p)),
      difficulties: d.difficulties,
      preset: d.preset,
      flags: d.flags,
      feet: d.player.feet,
      hp: d.player.hp,
      heal: d.player.heal,
      ammo: d.ammo,
      addAmmo: d.addAmmo,
      ...(d.giveWeapon ? { giveWeapon: d.giveWeapon } : {}),
    });
    d.events.on('pickup:taken', (p) => {
      const what = p.kind === 'weapon_shotgun' ? 'Breacher shotgun · press 2' : p.kind === 'medkit' ? `Medkit · +${p.amount} health` : `+${p.amount} ${p.kind === 'ammo_pistol' ? 'pistol rounds' : 'shells'}`;
      d.toasts.show('Picked up', what);
    });

    this.map =
      d.model && d.mapState
        ? new MapScreen({
            parent: d.ui,
            events: d.events,
            model: d.model,
            state: d.mapState,
            objectives: this.tracker,
            player: () => ({ ...d.player.feet(), yaw: d.player.yaw() }),
            currentRoom: () => d.level?.currentRoomId() ?? null,
            itemName: d.itemName,
            holds: d.holds,
            mapKeys: () => d.keys('map'),
            close: d.resume,
            title: `Station map · ${d.level?.name ?? ''}`,
          })
        : null;
    if (d.model && d.mapState) this.buildStations(d.model, d.mapState);

    d.events.on('room:entered', ({ id }) => this.onRoom(id));
    d.events.on('objective:set', () => this.hints.progress());
    d.events.on('objective:done', () => this.hints.progress());
    d.events.on('game:restarted', () => this.fresh(true));
    d.events.on('game:mode', ({ mode }) => {
      if (mode === 'playing' && this.lastMode === 'title') this.fresh(true);
      else if (mode === 'playing') this.supplies.reset();
      this.lastMode = mode;
    });
    d.events.on('player:damaged', ({ hp }) => {
      if (hp < 30 && hp > 0 && !this.lowHealthSaid) {
        this.lowHealthSaid = true;
        d.events.emit('player:lowHealth', { hp });
      } else if (hp >= 45) this.lowHealthSaid = false;
    });
    d.events.on('weapon:fired', ({ weapon }) => {
      const a = d.ammo()[weapon as AmmoWeapon];
      if (!a) return;
      const total = a.loaded + a.reserve;
      if (total <= a.mag && !this.lowAmmoSaid) {
        this.lowAmmoSaid = true;
        d.events.emit('player:lowAmmo', { weapon, total });
      } else if (total > a.mag * 2) this.lowAmmoSaid = false;
    });
    d.events.on('pickup:taken', () => {
      this.lowAmmoSaid = false;
    });
  }

  /** The map screen is up. */
  get mapOpen(): boolean {
    return this.map?.isOpen ?? false;
  }

  /** Fixed step while playing (and no tutorial pop-up is blocking). */
  update(dt: number): void {
    const { input } = this.d;
    if (this.d.mode() !== 'playing') return;
    const free = !this.d.busy();
    if (free && this.map && input.wasPressed('map')) {
      this.d.openMap();
      return;
    }
    if (input.wasPressed('objective')) this.hud.recall();
    if (free && input.wasPressed('navPulse')) {
      const focus = this.hints.focus() ?? this.tracker.active()[0] ?? null;
      if (focus) this.firePulse(focus);
    }
    this.hints.update(dt);
    this.barks.update(dt);
    this.supplies.update(dt);
    this.pulse.update(dt);
  }

  /** Per rendered frame (real time). */
  render(frameDt: number): void {
    this.hud.update(frameDt, this.d.mode() === 'playing' && !this.mapOpen);
  }

  /** Where an objective points: its explicit target, else the nearest room of its area. */
  targetOf(o: ObjectiveDef): { x: number; y: number; z: number } | null {
    const level = this.d.level;
    if (o.target && level) {
      const [kind, id] = o.target.split(':') as [string, string];
      const p = kind === 'anchor' ? level.anchor(id)?.pos : level.anchorPosition(kind as 'door' | 'room', id);
      if (p) return { x: p.x, y: kind === 'anchor' ? p.y : Math.floor(p.y / MAP_DECK_H) * MAP_DECK_H, z: p.z };
    }
    const model = this.d.model;
    if (!o.area || !model) return null;
    const me = this.d.player.feet();
    let best: { x: number; y: number; z: number } | null = null;
    let bestD = Infinity;
    for (const r of model.rooms) {
      if (r.area !== o.area || r.hidden) continue;
      const dd = Math.hypot(r.center[0] - me.x, r.center[1] - me.z);
      if (dd < bestD) {
        bestD = dd;
        best = { x: r.center[0], y: r.deck * MAP_DECK_H, z: r.center[1] };
      }
    }
    return best;
  }

  private distanceTo(o: ObjectiveDef): number | null {
    const t = this.targetOf(o);
    if (!t) return null;
    const me = this.d.player.feet();
    return Math.hypot(t.x - me.x, t.z - me.z) + Math.abs(t.y - me.y);
  }

  private firePulse(o: ObjectiveDef): void {
    const t = this.targetOf(o);
    if (t) this.pulse.fire(this.d.player.feet(), t);
  }

  private fresh(dropsToo: boolean): void {
    this.hints.reset();
    this.barks.reset();
    this.areasEntered.clear();
    this.lowAmmoSaid = this.lowHealthSaid = false;
    if (dropsToo) this.supplies.reset();
    // Rooms walked are drawn even if the save came from before map tracking.
    const cur = this.d.level?.currentRoomId();
    if (cur) this.d.mapState?.enter(cur);
  }

  private onRoom(id: string): void {
    const state = this.d.mapState;
    const model = this.d.model;
    if (!state || !model) return;
    if (state.enter(id)) this.hints.progress();
    const room = model.rooms.find((r) => r.id === id);
    if (!room || this.areasEntered.has(room.area)) return;
    this.areasEntered.add(room.area);
    if (model.stations.some((s) => s.reveals === room.area) && !state.isRevealed(room.area)) this.d.events.emit('map:areaEntered', { area: room.area });
  }

  /** Wall map panels: a dark frame with a glowing screen; "Download map" fills in the area. */
  private buildStations(model: MapModel, state: MapState): void {
    const screen = fixtureMaterial('#5fd6ff', 1.6);
    const done = fixtureMaterial('#39ff9e', 1.4);
    const frameGeo = new THREE.BoxGeometry(0.9, 0.7, 0.06);
    const screenGeo = new THREE.PlaneGeometry(0.78, 0.56);
    const source = this.d.level?.source.mapStations ?? [];
    for (const st of model.stations) {
      const data = source.find((s) => s.id === st.id);
      const yaw = ((data?.rot ?? 0) * Math.PI) / 180;
      const y = data?.pos[1] ?? 1.2;
      const g = new THREE.Group();
      g.name = `mapStation:${st.id}`;
      const frame = new THREE.Mesh(frameGeo, this.d.materials.paintDark);
      const face = new THREE.Mesh(screenGeo, screen);
      face.position.z = 0.031;
      g.add(frame, face);
      g.position.set(st.pos[0], y + 1.35, st.pos[1]);
      g.rotation.y = yaw;
      this.d.scene.add(g);
      const r = 0.55;
      const station: MapStation = st;
      this.d.interactions.add({
        id: `mapStation:${st.id}`,
        get prompt() {
          return state.isRevealed(station.reveals) ? 'Map downloaded' : 'Download map';
        },
        box: { min: [st.pos[0] - r, y + 0.9, st.pos[1] - r], max: [st.pos[0] + r, y + 1.8, st.pos[1] + r] },
        enabled: () => !state.isRevealed(station.reveals),
        use: () => {
          const rooms = state.reveal(station.reveals);
          face.material = done;
          const label = station.reveals.replace(/_/g, ' ');
          this.d.toasts.show('Map downloaded', `${label.charAt(0).toUpperCase()}${label.slice(1)} · ${rooms.length} new ${rooms.length === 1 ? 'room' : 'rooms'}`);
          this.d.events.emit('map:revealed', { area: station.reveals, station: station.id, rooms });
          this.hints.progress();
        },
      });
      // A loaded save may already hold the area.
      this.d.events.on('game:mode', () => {
        face.material = state.isRevealed(station.reveals) ? done : screen;
      });
    }
  }
}

function loose(bus: EventBus): LooseBus {
  return {
    on: (name, fn) => bus.on(name as EventName, fn as never),
    emit: (name, payload) => bus.emit(name as EventName, (payload ?? {}) as never),
  };
}
