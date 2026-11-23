/**
 * Spends at most `budgetMs` of work before handing the thread back. Long CPU jobs that must share the page with an
 * animation (the title's preparation behind the splash) call `tick()` between small units of work; it yields only when
 * the budget since the last yield is used up, so cheap units cost nothing.
 */
export class TimeSlicer {
  private readonly yieldTo: () => Promise<void>;
  private readonly budgetMs: number;
  private readonly now: () => number;
  private start: number;

  constructor(yieldTo: () => Promise<void>, budgetMs: number, now: () => number = () => performance.now()) {
    this.yieldTo = yieldTo;
    this.budgetMs = budgetMs;
    this.now = now;
    this.start = now();
  }

  /** Call between units of work. */
  async tick(): Promise<void> {
    if (this.now() - this.start < this.budgetMs) return;
    await this.yieldTo();
    this.start = this.now();
  }
}

/** Run a generator of small steps to the end without yielding, returning what it returns (the synchronous path). */
export function runSteps<T>(steps: Generator<void, T, void>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** Run a generator of small steps, letting `slicer` hand the thread back between them (the title's path). */
export async function runStepsSliced<T>(steps: Generator<void, T, void>, slicer: TimeSlicer): Promise<T> {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    await slicer.tick();
  }
}
