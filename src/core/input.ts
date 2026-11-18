import type { Action, Keymap } from '../data/types/keymap.ts';
import type { EventBus } from './events.ts';

/**
 * Keyboard + mouse input with pointer lock. Edge states (pressed/released) are
 * per simulation step: call `endStep()` after each fixed update so a press is
 * seen exactly once. Mouse look deltas are per rendered frame: `consumeLook()`.
 */
export class Input {
  locked = false;
  private readonly target: HTMLElement;
  private readonly keymap: Keymap;
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly released = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private wheelDelta = 0;
  private readonly cleanup: Array<() => void> = [];

  constructor(target: HTMLElement, keymap: Keymap, events: EventBus) {
    this.target = target;
    this.keymap = keymap;

    const listen = <K extends keyof WindowEventMap>(
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ): void => {
      window.addEventListener(type, fn, opts);
      this.cleanup.push(() => window.removeEventListener(type, fn, opts));
    };

    listen('keydown', (e) => {
      // Tab is the objective key in-game, but must keep moving focus in menus.
      if (e.code === 'Tab' && this.locked) e.preventDefault();
      if (!e.repeat) this.press(e.code);
    });
    listen('keyup', (e) => this.release(e.code));
    listen('mousedown', (e) => this.press(`Mouse${e.button}`));
    listen('mouseup', (e) => this.release(`Mouse${e.button}`));
    listen('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    listen('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    listen('wheel', (e) => {
      this.wheelDelta += Math.sign(e.deltaY);
    }, { passive: true });
    listen('blur', () => this.reset());
    // pointerlockchange fires on document (DocumentEventMap), not window.
    const onLockChange = (): void => {
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) this.reset();
      events.emit('input:pointerLock', { locked: this.locked });
    };
    document.addEventListener('pointerlockchange', onLockChange);
    this.cleanup.push(() => document.removeEventListener('pointerlockchange', onLockChange));
  }

  requestLock(): void {
    if (this.locked) return;
    // Chrome returns a promise that rejects if re-locking too soon after Esc; that's fine,
    // the "click to continue" prompt covers it.
    try {
      Promise.resolve(this.target.requestPointerLock()).catch(() => undefined);
    } catch {
      /* older browsers throw synchronously; ignore */
    }
  }

  isDown(action: Action): boolean {
    return this.keymap[action].some((c) => this.down.has(c));
  }

  wasPressed(action: Action): boolean {
    return this.keymap[action].some((c) => this.pressed.has(c));
  }

  wasReleased(action: Action): boolean {
    return this.keymap[action].some((c) => this.released.has(c));
  }

  /** -1 / 0 / 1 from two opposing actions. */
  axis(negative: Action, positive: Action): number {
    return (this.isDown(positive) ? 1 : 0) - (this.isDown(negative) ? 1 : 0);
  }

  /** Mouse movement since the last call, in pixels. */
  consumeLook(): { x: number; y: number } {
    const out = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  /** Wheel notches since the last call (+ = down). */
  consumeWheel(): number {
    const w = this.wheelDelta;
    this.wheelDelta = 0;
    return w;
  }

  endStep(): void {
    this.pressed.clear();
    this.released.clear();
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
    this.cleanup.length = 0;
  }

  private press(code: string): void {
    if (!this.down.has(code)) this.pressed.add(code);
    this.down.add(code);
  }

  private release(code: string): void {
    if (this.down.delete(code)) this.released.add(code);
  }

  private reset(): void {
    for (const c of this.down) this.released.add(c);
    this.down.clear();
    this.lookX = 0;
    this.lookY = 0;
  }
}
