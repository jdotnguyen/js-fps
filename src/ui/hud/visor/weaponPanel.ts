/**
 * The weapon panel (visor-hud spec): the held weapon's name and silhouette, a pip per magazine slot, the counts, the
 * dry-fire alert and the ammo pickup figure. It hides while no weapon is held.
 */
import type { WeaponId } from '../../../render/viewmodel/rig.ts';
import { AmmoModel, isLow, type AmmoPoll } from './ammoModel.ts';
import { SILHOUETTES } from './glyphs.ts';
import { buildPips, changeWriter, restart, type WeaponPanelView } from './markup.ts';

export class WeaponPanel {
  private readonly view: WeaponPanelView;
  /** The panel's dark underlay, which comes and goes with it. */
  private readonly shade: HTMLElement;
  private readonly reloadKey: () => string;
  private readonly model = new AmmoModel();
  private pips: Element[] = [];
  private held = false;
  private write = changeWriter();

  constructor(view: WeaponPanelView, shade: HTMLElement, reloadKey: () => string) {
    this.view = view;
    this.shade = shade;
    this.reloadKey = reloadKey;
  }

  /** Show the weapon as it is, with nothing animating: the first frame, a load, a restore. */
  snap(poll: AmmoPoll | null): void {
    this.clear();
    this.held = false;
    this.update(poll, 0);
  }

  /** One frame: `dt` is the play time since the last one, 0 while the scene is frozen. */
  update(poll: AmmoPoll | null, dt: number): void {
    if (!poll) {
      this.held = false;
      this.view.root.hidden = this.shade.hidden = true;
      return;
    }
    if (!this.held) {
      this.held = true;
      this.view.root.hidden = this.shade.hidden = false;
      this.model.snap(poll);
    }
    const gained = this.model.step(poll, dt);
    if (gained > 0) {
      this.view.delta.textContent = `+${gained}`;
      this.view.delta.hidden = false;
      restart(this.view.delta, 'rise');
    }
    this.draw(poll);
  }

  fired(): void {
    const pip = this.pips[this.model.fired()];
    if (pip) restart(pip, 'blink');
  }

  dryFire(): void {
    this.model.dryFire();
    restart(this.view.pips, 'dry');
  }

  reloadStart(duration?: number): void {
    this.model.reloadStart(duration);
  }

  shellInsert(): void {
    const pip = this.pips[this.model.shellInsert()];
    if (pip) restart(pip, 'seat');
  }

  reloaded(loaded: number): void {
    this.model.reloaded(loaded);
  }

  equipped(): void {
    this.model.equipped();
    this.view.delta.hidden = true;
    restart(this.view.root, 'swap');
  }

  /** Drop the one-off effects, so they do not replay when the panel shows again. */
  clear(): void {
    this.view.delta.hidden = true;
    this.view.delta.classList.remove('rise');
    this.view.root.classList.remove('tear', 'swap');
    this.view.pips.classList.remove('dry');
    for (const pip of this.pips) pip.classList.remove('blink', 'seat');
  }

  private draw(poll: AmmoPoll): void {
    const v = this.view;
    this.write('weapon', `${poll.name}:${poll.mag}`, () => this.dress(poll.name, poll.mag));
    this.write('loaded', poll.loaded, (n) => (v.loaded.textContent = String(n)));
    this.write('reserve', poll.reserve, (n) => (v.reserve.textContent = `/ ${n}`));
    this.write('low', isLow(poll.loaded, poll.mag), (on) => v.root.classList.toggle('low', on));
    this.write('empty', poll.loaded === 0, (on) => v.root.classList.toggle('empty', on));
    // Rounds going back in look like rounds, whatever the count says until the reload ends.
    this.write('reloading', this.model.reload !== 'none', (on) => v.root.classList.toggle('reloading', on));
    this.write('alert', this.model.alert > 0 ? `EMPTY · [${this.reloadKey()}]` : '', (text) => {
      v.alert.textContent = text;
      v.alert.hidden = text === '';
    });
    this.write('shown', this.model.shown, (n) => this.pips.forEach((pip, i) => pip.classList.toggle('full', i < n)));
  }

  /** Put the panel into this weapon's shape: name, picture and one pip a slot. */
  private dress(name: string, mag: number): void {
    const v = this.view;
    const id = name as WeaponId;
    v.root.classList.toggle('shotgun', id === 'shotgun');
    v.name.textContent = name.toUpperCase();
    v.picture.setAttribute('viewBox', SILHOUETTES[id]?.viewBox ?? '0 0 1 1');
    v.silhouette.setAttribute('d', SILHOUETTES[id]?.d ?? '');
    const pips = buildPips(id, mag);
    this.pips = pips;
    v.pips.replaceChildren(...pips);
    // New pips take their fill on this same draw.
    this.write('shown', -1, () => {});
  }
}
