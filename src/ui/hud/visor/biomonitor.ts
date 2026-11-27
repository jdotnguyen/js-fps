/**
 * The biomonitor panel (visor-hud spec): health in four segments with its chip trail and fill-up, the heartbeat trace,
 * stamina, and the downed countdown in the bar's place. Numbers and layout follow the values it is given each frame.
 */
import type { VitalState } from '../../../actors/vitals.ts';
import { healthLow, HealthModel, segmentFill } from './healthModel.ts';
import { HeartModel } from './heartModel.ts';
import { changeWriter, ecgPoints, restart, type BiomonitorView } from './markup.ts';

export interface BioPoll {
  hp: number;
  state: VitalState;
  /** Seconds of bleed-out left while downed. */
  bleed: number;
  /** null = unlimited. */
  revivesLeft: number | null;
  /** 0..1. */
  stamina: number;
  /** Stamina ran out and sprinting is not allowed again yet. */
  exhausted: boolean;
}

export class Biomonitor {
  private readonly view: BiomonitorView;
  private readonly health = new HealthModel();
  private readonly heart: HeartModel;
  private write = changeWriter();

  constructor(view: BiomonitorView, random?: () => number) {
    this.view = view;
    this.heart = new HeartModel(random);
  }

  /** Show the values as they are, with nothing animating: the first frame, a load, a restore. */
  snap(poll: BioPoll): void {
    this.health.snap(poll.hp);
    this.heart.snap(poll.hp, poll.state);
    this.write = changeWriter();
    this.clear();
    this.drawTrace();
    this.draw(poll);
  }

  /** One frame: `dt` is the play time since the last one, 0 while the scene is frozen. */
  update(poll: BioPoll, dt: number): void {
    const gained = this.health.step(poll.hp, dt);
    if (this.heart.step(poll.hp, poll.state, dt)) this.drawTrace();
    if (gained > 0) {
      this.view.delta.textContent = `+${gained}`;
      this.view.delta.hidden = false;
      restart(this.view.delta, 'rise');
    }
    this.draw(poll);
  }

  /** Drop the one-off effects, so they do not replay when the panel shows again. */
  clear(): void {
    this.view.delta.hidden = true;
    this.view.delta.classList.remove('rise');
    this.view.root.classList.remove('tear');
  }

  private drawTrace(): void {
    this.view.trace.setAttribute('points', ecgPoints(this.heart.trace()));
  }

  private draw(poll: BioPoll): void {
    const v = this.view;
    const downed = poll.state === 'downed';
    this.write('low', healthLow(poll.hp), (on) => v.root.classList.toggle('low', on));
    this.write('downed', downed, (on) => {
      v.root.classList.toggle('downed', on);
      v.downed.hidden = !on;
    });
    this.write('hp', Math.ceil(poll.hp), (n) => (v.hp.textContent = String(n)));
    this.write('bpm', Math.round(this.heart.bpm), (n) => (v.bpm.textContent = String(n)));
    v.segments.forEach((seg, i) => {
      this.write(`fill${i}`, `scaleX(${segmentFill(this.health.fill, i).toFixed(3)})`, (t) => (seg.fill.style.transform = t));
      this.write(`chip${i}`, `scaleX(${segmentFill(this.health.chip, i).toFixed(3)})`, (t) => (seg.chip.style.transform = t));
    });
    if (downed) {
      this.write('bleed', Math.max(0, Math.ceil(poll.bleed)), (n) => (v.bleed.textContent = `${n} s`));
      this.write('revives', poll.revivesLeft, (n) => {
        v.revives.hidden = n === null;
        v.revives.textContent = n === null ? '' : `REVIVES LEFT ${n}`;
      });
    }
    const stamina = Math.min(1, Math.max(0, poll.stamina));
    this.write('full', stamina >= 0.995, (on) => v.stamina.classList.toggle('full', on));
    this.write('spent', poll.exhausted, (on) => v.stamina.classList.toggle('spent', on));
    this.write('stamina', `scaleX(${stamina.toFixed(3)})`, (t) => (v.staminaFill.style.transform = t));
  }
}
