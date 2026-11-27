/**
 * The visor HUD (visor-hud spec): the biomonitor, the weapon panel and the rim, and what moves them as a whole, the
 * boot-up, the lag and jolts, calm mode and the settings. Values are read off the player and the weapon each frame;
 * events only start an animation on top. What mirrors the game counts play time (`tick`), the rest frame time.
 */
import * as THREE from 'three';
import type { HitInfo } from '../../../actors/hit.ts';
import { PLAYER_TUNING, type Player } from '../../../actors/player.ts';
import { MAX_HP } from '../../../actors/vitals.ts';
import type { EventBus } from '../../../core/events.ts';
import type { Settings } from '../../../core/settings.ts';
import type { AmmoPoll } from './ammoModel.ts';
import { Biomonitor, type BioPoll } from './biomonitor.ts';
import { CalmModel } from './calmModel.ts';
import { buildVisor, changeWriter, restart, type VisorView } from './markup.ts';
import { joltShare, VisorSpring, type PanelId } from './visorSpring.ts';
import { WeaponPanel } from './weaponPanel.ts';

export type VisorSettings = Pick<Settings, 'reducedMotion' | 'reducedFlashing' | 'hudOpacity' | 'hudScale' | 'calmHud'>;

export interface VisorWiring {
  events: EventBus;
  /** The view the panels lag behind. */
  camera: Pick<THREE.Camera, 'position' | 'rotation'>;
  settings: { get(): Readonly<VisorSettings> };
  /** The bound reload key as the player reads it. */
  reloadKey: string;
}

/**
 * How long the boot-up class stays on, in frame time. The CSS sequence runs 1.15 s from the moment the visor is on
 * screen, which after a load is some frames later, when the loading screen has faded.
 */
export const BOOT_SECONDS = 2;
/** A panel taking at least this share of a hit tears. */
const TEAR_SHARE = 0.5;
/** How far the torn rows slide, in px at HUD scale 1: the lightest hit and a full one. */
const TEAR_MIN = 3;
const TEAR_MAX = 9;

const UNSET: VisorSettings = { reducedMotion: false, reducedFlashing: false, hudOpacity: 0.85, hudScale: 1, calmHud: true };

export class VisorHud {
  private readonly view: VisorView;
  /** The settings' custom properties go on both layers: `#ui`, and the visor beside it. */
  private readonly ui: HTMLElement;
  private readonly bio: Biomonitor;
  private readonly weapon: WeaponPanel;
  private readonly calm = new CalmModel();
  private readonly spring = new VisorSpring();
  private readonly eye = new THREE.Vector3();
  private readonly write = changeWriter();
  private ammoSource: (() => AmmoPoll | null) | null = null;
  private wiring: VisorWiring | null = null;
  private offs: Array<() => void> = [];
  private reloadKey = 'R';
  /** Play time since the last frame. */
  private played = 0;
  /** The next frame shows the values as they are, with nothing animating. */
  private fresh = true;
  private booted = false;
  private bootLeft = 0;

  constructor(ui: HTMLElement) {
    this.ui = ui;
    this.view = buildVisor();
    this.view.root.hidden = true;
    // Before #ui, so prompts, menus and the fade stay on top.
    ui.before(this.view.root);
    this.bio = new Biomonitor(this.view.bio);
    this.weapon = new WeaponPanel(this.view.weapon, this.view.weaponShade, () => this.reloadKey);
  }

  /** Where the weapon panel reads the held weapon from; null while no weapon is held. */
  setAmmoSource(source: () => AmmoPoll | null): void {
    this.ammoSource = source;
  }

  connect(wiring: VisorWiring): void {
    this.disconnect();
    this.wiring = wiring;
    this.reloadKey = wiring.reloadKey;
    const ev = wiring.events;
    const wake = (): void => this.calm.wake();
    const stir =
      <T>(react: (payload: T) => void) =>
      (payload: T): void => {
        wake();
        react(payload);
      };
    this.offs = [
      ev.on('player:damaged', stir((hit) => this.struck(hit))),
      ev.on('player:downed', wake),
      ev.on('player:revived', wake),
      ev.on('player:died', wake),
      ev.on('pickup:taken', wake),
      ev.on('weapon:fired', stir(() => this.weapon.fired())),
      ev.on('weapon:dryFire', stir(() => this.weapon.dryFire())),
      ev.on('weapon:reloadStart', stir(({ duration }) => this.weapon.reloadStart(duration))),
      ev.on('weapon:shellInsert', () => this.weapon.shellInsert()),
      ev.on('weapon:reloaded', ({ loaded }) => this.weapon.reloaded(loaded)),
      ev.on('weapon:equipped', stir(() => this.weapon.equipped())),
    ];
  }

  /** A step of play: `dt` seconds the next frame's models advance by. */
  tick(dt: number): void {
    this.played += dt;
  }

  /** Boot the visor up line by line, showing everything as it is now. */
  boot(): void {
    this.fresh = true;
    this.booted = true;
    this.bootLeft = BOOT_SECONDS;
    restart(this.view.root, 'booting');
  }

  /** One rendered frame with the HUD on screen. */
  update(player: Player, frameDt: number): void {
    if (!this.booted) this.boot();
    this.view.root.hidden = false;
    const settings = this.wiring?.settings.get() ?? UNSET;
    this.apply(settings);

    const { vitals } = player;
    const bio: BioPoll = {
      hp: vitals.hp,
      state: vitals.state,
      bleed: vitals.bleed,
      revivesLeft: vitals.revivesLeft,
      stamina: player.stamina / PLAYER_TUNING.sprintMax,
      exhausted: player.isExhausted,
    };
    const ammo = this.ammoSource?.() ?? null;
    const dt = this.played;
    this.played = 0;
    if (this.fresh) {
      this.fresh = false;
      this.bio.snap(bio);
      this.weapon.snap(ammo);
      this.calm.wake();
      this.spring.reset();
    } else {
      this.bio.update(bio, dt);
      this.weapon.update(ammo, dt);
    }

    const busy = bio.hp < MAX_HP || bio.stamina < 1 || player.sprinting || (ammo !== null && ammo.loaded < ammo.mag);
    this.calm.step(busy, dt);
    this.write('calm', settings.calmHud && this.calm.dim, (on) => this.view.root.classList.toggle('calm', on));
    this.move(player, settings, frameDt);

    if (this.bootLeft > 0) {
      this.bootLeft -= frameDt;
      if (this.bootLeft <= 0) this.view.root.classList.remove('booting');
    }
  }

  /** Off the screen: title, pause, map or the fly camera. */
  hide(): void {
    if (this.view.root.hidden) return;
    this.view.root.hidden = true;
    this.bio.clear();
    this.weapon.clear();
    // The camera may be somewhere else by the time the panels return.
    this.spring.reset();
    // A boot-up cut short plays again from the start when the panels return.
    if (this.bootLeft > 0) this.bootLeft = BOOT_SECONDS;
  }

  dispose(): void {
    this.disconnect();
    this.view.root.remove();
  }

  private disconnect(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.wiring = null;
  }

  /** The panel nearer the blow jolts and tears; a blow with no side takes both a little. */
  private struck(hit: Partial<Pick<HitInfo, 'side' | 'dir' | 'severity'>> & { amount?: number }): void {
    // Read with care: a hit may come without a side or a direction.
    const severity = hit.severity ?? Math.min(1, (hit.amount ?? 0) / 25);
    const strike = { side: hit.side ?? null, severity, ...(hit.dir ? { dir: hit.dir } : {}) };
    this.spring.hit(strike);
    const panels: Array<[PanelId, HTMLElement]> = [
      ['bio', this.view.bio.root],
      ['ammo', this.view.weapon.root],
    ];
    for (const [id, panel] of panels) {
      const share = joltShare(strike.side, id);
      if (share < TEAR_SHARE) continue;
      panel.style.setProperty('--tear', `${((TEAR_MIN + (TEAR_MAX - TEAR_MIN) * severity) * share).toFixed(1)}px`);
      restart(panel, 'tear');
    }
  }

  private apply(s: Readonly<VisorSettings>): void {
    for (const [name, value] of [
      ['--hud-opacity', String(s.hudOpacity)],
      ['--hud-scale', String(s.hudScale)],
    ] as const) {
      this.write(name, value, (v) => {
        this.view.root.style.setProperty(name, v);
        this.ui.style.setProperty(name, v);
      });
    }
    this.write('reducedFlashing', s.reducedFlashing, (on) => this.view.root.classList.toggle('reduced-flashing', on));
    this.write('reducedMotion', s.reducedMotion, (on) => this.view.root.classList.toggle('reduced-motion', on));
  }

  private move(player: Player, settings: Readonly<VisorSettings>, frameDt: number): void {
    const camera = this.wiring?.camera;
    if (!camera) return;
    this.spring.step(
      {
        yaw: camera.rotation.y,
        pitch: camera.rotation.x,
        bob: camera.position.y - player.eyePosition(this.eye).y,
        scale: settings.hudScale,
        reduced: settings.reducedMotion,
      },
      frameDt,
    );
    for (const [id, panel] of [
      ['bio', this.view.bio.root],
      ['ammo', this.view.weapon.root],
    ] as const) {
      const at = this.spring[id];
      // `translate` applies before the panel's tilt, so the offset is in screen pixels.
      this.write(`move-${id}`, `${at.x.toFixed(1)}px ${at.y.toFixed(1)}px`, (v) => (panel.style.translate = v));
    }
  }
}
