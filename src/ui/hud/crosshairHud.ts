const SVG_NS = 'http://www.w3.org/2000/svg';

/** Minimum bracket radius in CSS pixels (snug around the center dot at full focus). */
export const CROSSHAIR_MIN_PX = 4.5;
/** Maximum bracket radius in CSS pixels so extreme bloom stays readable inside the viewport. */
export const CROSSHAIR_MAX_PX = 110;
/** Half-angle (degrees) of each curved side bracket arc. */
const BRACKET_HALF_DEG = 40;
/** ViewBox half-extent (matches 240x240 SVG centered on the viewport). */
const VIEWBOX_HALF = 120;

export interface CrosshairState {
  dt: number;
  spreadRad: number;
  /** Active camera vertical FOV in degrees. */
  fovDeg: number;
  /** Viewport height in CSS pixels. */
  viewportHeight: number;
  focused: boolean;
  armed: boolean;
  suppressed: boolean;
  reducedMotion: boolean;
}

/**
 * Project an angular spread half-angle (radians) onto screen pixels at the active vertical FOV.
 * Clamps between `minPx` (snug focus ring) and `maxPx` (readable cap).
 */
export function projectSpreadToPx(
  spreadRad: number,
  fovDeg: number,
  viewportHeight: number,
  minPx = CROSSHAIR_MIN_PX,
  maxPx = CROSSHAIR_MAX_PX,
): number {
  const halfFovRad = ((Math.max(10, fovDeg) * Math.PI) / 180) * 0.5;
  const denom = Math.tan(halfFovRad);
  if (denom <= 1e-6 || viewportHeight <= 0) return minPx;
  const raw = (Math.tan(Math.max(0, spreadRad)) / denom) * (viewportHeight * 0.5);
  return Math.min(maxPx, Math.max(minPx, raw));
}

/** Build an SVG arc path `M x1 y1 A r r 0 0 1 x2 y2` centered at (0, 0). */
export function bracketArcPath(radius: number, startDeg: number, endDeg: number): string {
  const r = Math.max(1, radius);
  const a0 = (startDeg * Math.PI) / 180;
  const a1 = (endDeg * Math.PI) / 180;
  const x0 = (Math.cos(a0) * r).toFixed(2);
  const y0 = (Math.sin(a0) * r).toFixed(2);
  const x1 = (Math.cos(a1) * r).toFixed(2);
  const y1 = (Math.sin(a1) * r).toFixed(2);
  const rr = r.toFixed(2);
  return `M ${x0} ${y0} A ${rr} ${rr} 0 0 1 ${x1} ${y1}`;
}

/**
 * Dynamic two-bracket SVG crosshair (weapon-accuracy spec): renders a center dot flanked by
 * two curved left/right side brackets whose radius tracks the live angular spread cone.
 */
export class CrosshairHud {
  private readonly root: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly leftArc: SVGPathElement;
  private readonly rightArc: SVGPathElement;
  private displayRadius = CROSSHAIR_MIN_PX;
  private initialized = false;
  private lastRendered = -1;

  constructor(root: HTMLElement) {
    this.root = root;
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'crosshair-svg');
    this.svg.setAttribute('viewBox', `${-VIEWBOX_HALF} ${-VIEWBOX_HALF} ${VIEWBOX_HALF * 2} ${VIEWBOX_HALF * 2}`);
    this.svg.setAttribute('width', String(VIEWBOX_HALF * 2));
    this.svg.setAttribute('height', String(VIEWBOX_HALF * 2));
    this.svg.setAttribute('aria-hidden', 'true');

    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('class', 'crosshair-dot');
    dot.setAttribute('cx', '0');
    dot.setAttribute('cy', '0');
    dot.setAttribute('r', '1.6');

    this.leftArc = document.createElementNS(SVG_NS, 'path');
    this.leftArc.setAttribute('class', 'crosshair-bracket left');
    this.rightArc = document.createElementNS(SVG_NS, 'path');
    this.rightArc.setAttribute('class', 'crosshair-bracket right');

    this.svg.append(dot, this.leftArc, this.rightArc);
    this.root.replaceChildren(this.svg);
    this.renderRadius(CROSSHAIR_MIN_PX);
  }

  /** Current rendered bracket radius in CSS pixels (exposed for tests and inspection). */
  get radiusPx(): number {
    return this.displayRadius;
  }

  update(state: CrosshairState): void {
    const target = projectSpreadToPx(state.spreadRad, state.fovDeg, state.viewportHeight);
    if (!this.initialized || state.reducedMotion || state.dt <= 0) {
      this.displayRadius = target;
      this.initialized = true;
    } else {
      const alpha = 1 - Math.exp(-Math.min(state.dt, 0.1) * 28);
      this.displayRadius += (target - this.displayRadius) * alpha;
    }

    this.root.classList.toggle('focused', state.focused);
    this.root.classList.toggle('unarmed', !state.armed);
    this.root.classList.toggle('suppressed', state.armed && state.suppressed);

    if (Math.abs(this.displayRadius - this.lastRendered) > 0.05) {
      this.renderRadius(this.displayRadius);
    }
  }

  private renderRadius(r: number): void {
    this.lastRendered = r;
    this.leftArc.setAttribute('d', bracketArcPath(r, 180 - BRACKET_HALF_DEG, 180 + BRACKET_HALF_DEG));
    this.rightArc.setAttribute('d', bracketArcPath(r, -BRACKET_HALF_DEG, BRACKET_HALF_DEG));
  }

  dispose(): void {
    this.root.classList.remove('focused', 'unarmed', 'suppressed');
    this.root.replaceChildren();
  }
}
