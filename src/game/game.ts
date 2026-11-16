import * as THREE from 'three';
import type { AudioEngine } from '../audio/engine.ts';
import type { EventBus } from '../core/events.ts';
import type { FreeCamera } from '../core/freeCamera.ts';
import type { Input } from '../core/input.ts';
import type { SettingsStore } from '../core/settings.ts';
import type { DifficultyId, DifficultyTable } from '../data/types/difficulty.ts';
import type { Flashlight } from '../render/flashlight.ts';
import type { Toasts } from '../ui/toast.ts';
import type { DemoRoom } from '../world/demoRoom.ts';
import { SAVE_VERSION, type SaveData, type SaveKind, type SaveStore } from './save.ts';

export type GameMode = 'title' | 'playing' | 'paused';

declare module '../core/events.ts' {
  interface EventMap {
    'game:mode': { mode: GameMode };
    'game:saveStation': Record<string, never>;
  }
}

export interface GameDeps {
  events: EventBus;
  settings: SettingsStore;
  saves: SaveStore;
  difficulties: DifficultyTable;
  input: Input;
  camera: THREE.PerspectiveCamera;
  freeCam: FreeCamera;
  flashlight: Flashlight;
  room: DemoRoom;
  audio: AudioEngine;
  toasts: Toasts;
  /** HUD element for "[E] Use save station". */
  interactPrompt: HTMLElement;
}

const CHAPTER = 'slice01';
const LEVEL = 'demo-room';
const STATION_RANGE = 1.9;

/**
 * Session state and mode machine (ADR-0016): title -> playing <-> paused. Owns the
 * current playthrough (slot, difficulty, play time, checkpoint, flags) and saving.
 */
export class Game {
  mode: GameMode = 'title';
  slot = 0;
  difficulty: DifficultyId = 'standard';
  playTime = 0;
  checkpoint: string | null = null;
  location = '';
  flags: Record<string, string | number | boolean> = {};
  private readonly d: GameDeps;
  private titleTime = 0;
  private readonly forward = new THREE.Vector3();
  private readonly toStation = new THREE.Vector3();

  constructor(deps: GameDeps) {
    this.d = deps;
    deps.events.on('input:pointerLock', ({ locked }) => {
      // Esc or alt-tab while playing releases the mouse: that is "pause".
      if (!locked && this.mode === 'playing') this.pause();
    });
  }

  get preset() {
    return this.d.difficulties[this.difficulty];
  }

  showTitle(): void {
    this.setMode('title');
  }

  newGame(slot: number, difficulty: DifficultyId): void {
    this.d.saves.clearSlot(slot);
    this.slot = slot;
    this.difficulty = difficulty;
    this.playTime = 0;
    this.checkpoint = null;
    this.location = '';
    this.flags = {};
    const { position, yaw } = this.d.room.spawn;
    this.d.camera.position.copy(position);
    this.d.freeCam.yaw = yaw;
    this.d.freeCam.pitch = 0;
    this.d.flashlight.on = true;
    this.enterPlaying();
  }

  load(save: SaveData): void {
    this.slot = save.slot;
    this.difficulty = save.difficulty;
    this.playTime = save.playTime;
    this.checkpoint = save.checkpoint;
    this.location = save.location;
    this.flags = { ...save.flags };
    this.d.camera.position.fromArray(save.player.position);
    this.d.freeCam.yaw = save.player.yaw;
    this.d.freeCam.pitch = save.player.pitch;
    this.d.flashlight.on = save.player.flashlightOn;
    this.enterPlaying();
    this.d.toasts.show(save.kind === 'auto' ? 'Autosave loaded' : 'Save loaded', save.location);
  }

  snapshot(kind: SaveKind): SaveData {
    return {
      version: SAVE_VERSION,
      kind,
      slot: this.slot,
      savedAt: new Date().toISOString(),
      playTime: this.playTime,
      difficulty: this.difficulty,
      chapter: CHAPTER,
      level: LEVEL,
      checkpoint: this.checkpoint,
      location: this.location || 'Section 07',
      player: {
        position: this.d.camera.position.toArray(),
        yaw: this.d.freeCam.yaw,
        pitch: this.d.freeCam.pitch,
        health: 100,
        flashlightOn: this.d.flashlight.on,
      },
      flags: { ...this.flags },
    };
  }

  manualSave(): void {
    this.d.saves.write(this.snapshot('manual'));
    this.d.toasts.show('Game saved', `Slot ${this.slot + 1} · ${this.location || 'Section 07'}`);
  }

  setDifficulty(id: DifficultyId): void {
    if (id === this.difficulty) return;
    this.difficulty = id;
    this.d.toasts.show('Difficulty changed', `${this.preset.label} · applies from now on`);
  }

  pause(): void {
    if (this.mode !== 'playing') return;
    this.setMode('paused');
  }

  resume(): void {
    if (this.mode !== 'paused') return;
    this.setMode('playing');
    this.d.input.requestLock();
  }

  quitToTitle(): void {
    this.setMode('title');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  openSaveStation(): void {
    this.setMode('paused');
    if (document.pointerLockElement) document.exitPointerLock();
    this.d.events.emit('game:saveStation', {});
  }

  /** Fixed-step simulation. */
  update(dt: number): void {
    if (this.mode !== 'playing') {
      this.setInteractPrompt(null);
      return;
    }
    this.playTime += dt;
    const { input, freeCam, flashlight, camera, room } = this.d;
    if (input.wasPressed('flashlight')) {
      flashlight.toggle();
      this.d.events.emit('game:flashlight', { on: flashlight.on });
    }
    freeCam.update(dt);

    for (const cp of room.anchors.checkpoints) {
      if (!this.flags[`cp:${cp.id}`] && camera.position.z < cp.zBelow) this.reachCheckpoint(cp.id, cp.label);
    }

    // Save terminal: in range and roughly facing it.
    camera.getWorldDirection(this.forward);
    this.toStation.subVectors(room.anchors.saveStation, camera.position);
    const dist = Math.hypot(this.toStation.x, this.toStation.z);
    const facing = this.forward.dot(this.toStation.normalize());
    if (dist < STATION_RANGE && facing > 0.72) {
      this.setInteractPrompt('[E] Use save station');
      if (input.wasPressed('interact')) this.openSaveStation();
    } else {
      this.setInteractPrompt(null);
    }
  }

  /** Per rendered frame. */
  render(frameDt: number): void {
    if (this.mode === 'title') {
      // Attract camera: a slow drift down the corridor behind the title menu.
      this.titleTime += frameDt;
      const t = this.titleTime;
      const cam = this.d.camera;
      cam.position.set(Math.sin(t * 0.11) * 0.9, 1.7 + Math.sin(t * 0.07) * 0.08, 7.5 - 3 * (1 - Math.cos(t * 0.05)));
      cam.lookAt(Math.sin(t * 0.13) * 1.2, 1.3, -10);
      this.d.input.consumeLook();
      return;
    }
    if (this.mode === 'playing') this.d.freeCam.look();
    else this.d.input.consumeLook();
  }

  /** Re-apply master volume with pause ducking. */
  applyVolume(): void {
    const v = this.d.settings.get().masterVolume * (this.mode === 'paused' ? 0.45 : 1);
    this.d.audio.setMasterVolume(v);
  }

  private reachCheckpoint(id: string, label: string): void {
    this.flags[`cp:${id}`] = true;
    this.checkpoint = id;
    this.location = label;
    this.d.saves.write(this.snapshot('auto'));
    this.d.toasts.show('Checkpoint', label);
  }

  private enterPlaying(): void {
    this.setMode('playing');
    this.d.input.requestLock();
  }

  private setMode(mode: GameMode): void {
    this.mode = mode;
    this.applyVolume();
    this.d.events.emit('game:mode', { mode });
  }

  private promptText: string | null = null;
  private setInteractPrompt(text: string | null): void {
    if (text === this.promptText) return;
    this.promptText = text;
    this.d.interactPrompt.textContent = text ?? '';
    this.d.interactPrompt.hidden = text === null;
  }
}

declare module '../core/events.ts' {
  interface EventMap {
    'game:flashlight': { on: boolean };
  }
}
