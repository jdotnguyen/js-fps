/**
 * The visor's DOM and inline SVG (visor-hud design D1, D7). Builders only: they make the nodes and hand back the ones
 * that change. Styles are in `ui/styles/visor.css`.
 */
import type { WeaponId } from '../../../render/viewmodel/rig.ts';
import { CARTRIDGE, HEART, SHELL } from './glyphs.ts';
import { HEALTH_SEGMENTS } from './healthModel.ts';
import { ECG_SAMPLES } from './heartModel.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The ECG trace's samples sit `ECG_STEP` apart in an `ECG_WIDTH` x `ECG_HEIGHT` box. */
const ECG_STEP = 2;
export const ECG_WIDTH = (ECG_SAMPLES - 1) * ECG_STEP;
export const ECG_HEIGHT = 40;
const ECG_BASELINE = 28;
const ECG_PEAK = 24;

export interface SegmentView {
  chip: HTMLElement;
  fill: HTMLElement;
}

export interface BiomonitorView {
  root: HTMLElement;
  bpm: HTMLElement;
  trace: SVGElement;
  health: HTMLElement;
  segments: SegmentView[];
  hp: HTMLElement;
  delta: HTMLElement;
  downed: HTMLElement;
  bleed: HTMLElement;
  revives: HTMLElement;
  stamina: HTMLElement;
  staminaFill: HTMLElement;
}

export interface WeaponPanelView {
  root: HTMLElement;
  name: HTMLElement;
  /** The picture and the path in it: a weapon swap sets the box and the outline together. */
  picture: SVGElement;
  silhouette: SVGElement;
  pips: HTMLElement;
  alert: HTMLElement;
  delta: HTMLElement;
  loaded: HTMLElement;
  reserve: HTMLElement;
}

export interface VisorView {
  /** Holds both layers; it positions nothing, so the layers still blend with the scene behind it. */
  root: HTMLElement;
  /** Soft dark underlays, drawn normally beneath the light so the readouts hold up over bright fog. */
  bioShade: HTMLElement;
  weaponShade: HTMLElement;
  bio: BiomonitorView;
  weapon: WeaponPanelView;
}

export function buildVisor(): VisorView {
  const root = el('div', 'visor-root');
  const bioShade = el('div', 'visor-shade bio');
  const weaponShade = el('div', 'visor-shade ammo');
  const light = el('div', 'visor');
  const bio = buildBiomonitor();
  const weapon = buildWeaponPanel();
  light.append(buildRim(), bio.root, weapon.root);
  root.append(bioShade, weaponShade, light);
  return { root, bioShade, weaponShade, bio, weapon };
}

/** Corner brackets and the two thin arcs down the sides of the glass. */
export function buildRim(): HTMLElement {
  const rim = el('div', 'visor-rim');
  rim.setAttribute('aria-hidden', 'true');
  for (const corner of ['tl', 'tr', 'bl', 'br']) rim.append(el('div', `visor-bracket ${corner}`));
  const arcs = { left: 'M38 0C12 150 2 220 2 300S12 450 38 600', right: 'M2 0C28 150 38 220 38 300S28 450 2 600' };
  for (const [side, d] of Object.entries(arcs)) {
    const arc = svg('svg', { class: `visor-arc ${side}`, viewBox: '0 0 40 600', preserveAspectRatio: 'none' });
    arc.append(svg('path', { d, 'vector-effect': 'non-scaling-stroke' }));
    rim.append(arc);
  }
  return rim;
}

export function buildBiomonitor(): BiomonitorView {
  const root = el('div', 'visor-panel visor-bio');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Vitals');

  const head = el('div', 'visor-head');
  const rate = el('span', 'visor-rate');
  const heart = svg('svg', { class: 'visor-heart', viewBox: '0 0 16 14', 'aria-hidden': 'true' });
  heart.append(svg('path', { d: HEART }));
  const bpm = el('span', 'visor-bpm');
  rate.append(heart, bpm, el('span', 'visor-unit', 'BPM'));
  head.append(el('span', 'visor-title', 'BIOMONITOR'), rate);

  const ecg = svg('svg', { class: 'visor-ecg', viewBox: `0 0 ${ECG_WIDTH} ${ECG_HEIGHT}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  // The older end of the trace fades out. The stops follow the panel's colour, so a warning recolours it.
  const defs = svg('defs', {});
  const fade = svg('linearGradient', { id: 'visor-ecg-fade', gradientUnits: 'userSpaceOnUse', x1: '0', y1: '0', x2: String(ECG_WIDTH), y2: '0' });
  fade.append(svg('stop', { offset: '0', 'stop-opacity': '0' }), svg('stop', { offset: '0.45', 'stop-opacity': '0.75' }), svg('stop', { offset: '1', 'stop-opacity': '1' }));
  defs.append(fade);
  const trace = svg('polyline', { class: 'visor-ecg-line', stroke: 'url(#visor-ecg-fade)', 'vector-effect': 'non-scaling-stroke' });
  ecg.append(defs, trace);

  const health = el('div', 'visor-health');
  const bar = el('div', 'visor-segs');
  const segments: SegmentView[] = [];
  for (let i = 0; i < HEALTH_SEGMENTS; i++) {
    const seg = el('div', 'visor-seg');
    const chip = el('div', 'visor-chip');
    const fill = el('div', 'visor-fill');
    seg.append(chip, fill);
    bar.append(seg);
    segments.push({ chip, fill });
  }
  const hp = el('span', 'visor-hp');
  const delta = el('span', 'visor-delta');
  delta.hidden = true;
  health.append(bar, hp, delta);

  const downed = el('div', 'visor-downed');
  downed.setAttribute('role', 'status');
  downed.hidden = true;
  const countdown = el('div', 'visor-bleed');
  const bleed = el('span', 'visor-bleed-num');
  countdown.append(el('span', 'visor-bleed-label', 'BLEEDING OUT'), bleed);
  const revives = el('div', 'visor-revives');
  downed.append(countdown, el('div', 'visor-downed-note', 'WAIT FOR THE MEDIC'), revives);

  const stamina = el('div', 'visor-stamina');
  const track = el('div', 'visor-stamina-track');
  const staminaFill = el('div', 'visor-stamina-fill');
  track.append(staminaFill);
  stamina.append(el('span', 'visor-stamina-label', 'STA'), track);

  root.append(head, ecg, health, downed, stamina);
  return { root, bpm, trace, health, segments, hp, delta, downed, bleed, revives, stamina, staminaFill };
}

export function buildWeaponPanel(): WeaponPanelView {
  const root = el('div', 'visor-panel visor-ammo');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Weapon');

  const head = el('div', 'visor-head');
  const picture = svg('svg', { class: 'visor-silhouette', 'aria-hidden': 'true' });
  const silhouette = svg('path', { 'vector-effect': 'non-scaling-stroke' });
  picture.append(silhouette);
  const name = el('span', 'visor-title');
  head.append(picture, name);

  const pips = el('div', 'visor-pips');
  pips.setAttribute('aria-hidden', 'true');

  const counts = el('div', 'visor-counts');
  const alert = el('span', 'visor-alert');
  alert.hidden = true;
  const loaded = el('span', 'visor-loaded');
  const spare = el('span', 'visor-spare');
  const delta = el('span', 'visor-delta');
  delta.hidden = true;
  const reserve = el('span', 'visor-reserve');
  spare.append(delta, reserve);
  counts.append(alert, loaded, spare);

  root.append(head, pips, counts);
  return { root, name, picture, silhouette, pips, alert, delta, loaded, reserve };
}

/** One pip per magazine slot, left to right. A filled one carries the `full` class. */
export function buildPips(weapon: WeaponId, mag: number): SVGElement[] {
  const glyph = weapon === 'shotgun' ? SHELL : CARTRIDGE;
  return Array.from({ length: mag }, () => {
    const pip = svg('svg', { class: 'visor-pip', viewBox: glyph.viewBox });
    // The flash lies over the round and shows only while it blinks out or seats.
    pip.append(svg('path', { d: glyph.body, class: 'body' }), svg('path', { d: glyph.base, class: 'base' }), svg('path', { d: glyph.body, class: 'flash' }));
    return pip;
  });
}

/** `points` for the ECG polyline: samples oldest first, 0 on the baseline and 1 at the top of an R spike. */
export function ecgPoints(samples: ArrayLike<number>): string {
  let points = '';
  for (let i = 0; i < samples.length; i++) points += `${i * ECG_STEP},${(ECG_BASELINE - (samples[i] ?? 0) * ECG_PEAK).toFixed(1)} `;
  return points;
}

/** Start the CSS animation that `cls` carries from the beginning, even if it is on already. */
export function restart(node: Element, cls: string): void {
  node.classList.remove(cls);
  // Reading a box makes the page take the removal before the class returns.
  node.getBoundingClientRect?.();
  node.classList.add(cls);
}

/** Writes to the page only when the value under `key` differs from the last one written. */
export function changeWriter(): <T>(key: string, value: T, write: (value: T) => void) => void {
  const last = new Map<string, unknown>();
  return (key, value, write) => {
    if (last.has(key) && last.get(key) === value) return;
    last.set(key, value);
    write(value);
  };
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}
