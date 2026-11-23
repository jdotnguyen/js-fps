/** One finished loading stage: how long it ran and whether it took anything from the title preparation. */
export interface StageRecord {
  readonly name: string;
  readonly ms: number;
  readonly prepared: boolean;
}

/**
 * Times the named stages of a session load (title-preload spec: per-stage timings). Starting a stage ends the
 * previous one, so the stages tile the load with no gaps. `markPrepared` flags the running stage as having used
 * prepared results.
 */
export class StageTimer {
  private readonly records: StageRecord[] = [];
  private current: { name: string; start: number; prepared: boolean } | null = null;
  private readonly t0: number;
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
    this.t0 = now();
  }

  begin(name: string): void {
    this.end();
    this.current = { name, start: this.now(), prepared: false };
  }

  markPrepared(): void {
    if (this.current) this.current.prepared = true;
  }

  end(): void {
    if (!this.current) return;
    this.records.push({ name: this.current.name, ms: this.now() - this.current.start, prepared: this.current.prepared });
    this.current = null;
  }

  get stages(): readonly StageRecord[] {
    return this.records;
  }

  /** Ends the running stage and returns one summary line, e.g. `total 5210 ms | renderer 120 | textures+audio 900 (prepared)`. */
  summary(): string {
    this.end();
    const total = this.now() - this.t0;
    const parts = this.records.map((r) => `${r.name} ${r.ms.toFixed(0)}${r.prepared ? ' (prepared)' : ''}`);
    return `total ${total.toFixed(0)} ms | ${parts.join(' | ')}`;
  }
}
