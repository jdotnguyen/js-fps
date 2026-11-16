/**
 * What the interpreter needs from the game (ADR-0009). Everything beyond `events`,
 * `flags` and `resolve` is optional, so the interpreter runs headless in tests and
 * actions whose system does not exist yet (NPCs, glass, water: ADR-0006/0011) degrade to
 * a one-time warning instead of failing the sequence.
 */
import type { Scalar, Flags, TargetRef, Vec3Like } from './types.ts';

/** The event bus with string names: sequences use names that come from JSON. */
export interface LooseBus {
  on(name: string, fn: (payload: unknown) => void): () => void;
  emit(name: string, payload?: unknown): void;
}

export interface ControlOverride {
  move?: 'free' | 'slow' | 'locked';
  look?: 'free' | 'clamped' | 'locked';
  weapons?: boolean;
  flashlight?: boolean;
  interact?: boolean;
}

export interface SpeechLike {
  done: Promise<unknown>;
}

export interface SequenceHost {
  events: LooseBus;
  /** The playthrough's flags (ADR-0016 saves them). A getter: loading replaces the object. */
  flags: Flags;
  /** Replace the flags wholesale (checkpoint restore). */
  setFlags?(flags: Flags): void;
  /** Resolve a target to a world position, or null if it does not exist. */
  resolve(target: TargetRef): Vec3Like | null;
  warn(message: string): void;

  /** Push a control layer; returns its release function. */
  pushControl?(over: ControlOverride, owner: string): () => void;
  lookAt?(at: Vec3Like, duration: number, weight: number): void;
  clampLook?(at: Vec3Like | null, degrees: number): void;
  /** Resolves when the player arrives (or is released). */
  walkTo?(at: Vec3Like, speed: number | undefined): Promise<void>;
  fade?(level: number, seconds: number): void;
  cameraShake?(amount: number, seconds: number): void;
  setTimeScale?(scale: number): void;

  setDoor?(id: string, state: string): boolean;
  doorStates?(): Record<string, string>;
  setLight?(room: string, pattern: string): boolean;
  lightStates?(): Record<string, string>;
  glass?(id: string, state: string): void;
  water?(level: number, seconds: number): void;
  sfx?(id: string, at: Vec3Like | null): void;
  music?(id: string | null): void;
  ambience?(id: string): void;

  /** Speak a dialogue line (ADR-0010). */
  say?(line: string): SpeechLike | null;
  /** Record a checkpoint in the game (autosave, toast). */
  checkpoint?(id: string, label: string | undefined): void;
  endSlice?(): void;
  /** NPC and transform actions (ADR-0006/0011): resolves when the action is finished. */
  npc?(action: string, step: Readonly<Record<string, unknown>>): Promise<void> | void;
}

export type { Scalar };
