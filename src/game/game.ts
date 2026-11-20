import * as THREE from 'three';
import { applyBusVolumes } from '../audio/volume.ts';
import type { Interactions } from '../actors/interaction.ts';
import type { Player } from '../actors/player.ts';
import type { AudioEngine } from '../audio/engine.ts';
import type { EventBus } from '../core/events.ts';
import type { FreeCamera } from '../core/freeCamera.ts';
import type { Input } from '../core/input.ts';
import type { SettingsStore } from '../core/settings.ts';
import type { DifficultyId, DifficultyTable } from '../data/types/difficulty.ts';
import type { Flashlight } from '../render/flashlight.ts';
import type { Toasts } from '../ui/toast.ts';
import type { CutsceneController } from './cutscene.ts';
import type { PlayerHud } from '../ui/hud/playerHud.ts';
import type { World } from '../world/world.ts';
import type { Inventory } from './inventory.ts';
import { SAVE_VERSION, type SaveData, type SaveKind, type SaveStore } from './save.ts';

/** Map knowledge the save carries (ADR-0024, `ui/mapModel.ts` MapState). */
export interface MapPersistence {
  save(): { seen: string[]; revealed: string[] };
  restore(s: { seen: string[]; revealed: string[] } | null): void;
  clear(): void;
}

export type GameMode = 'title' | 'playing' | 'paused';

declare module '../core/events.ts' {
  interface EventMap {
    'game:mode': { mode: GameMode };
    'game:saveStation': Record<string, never>;
    'game:restarted': { checkpoint: string | null };
    /** The map overlay opened (ADR-0024): the game is paused, the pause menu stays hidden. */
    'game:map': Record<string, never>;
  }
}

export interface GameDeps {
  events: EventBus;
  settings: SettingsStore;
  saves: SaveStore;
  difficulties: DifficultyTable;
  input: Input;
  camera: THREE.PerspectiveCamera;
  player: Player;
  interactions: Interactions;
  /** Debug fly camera (F1 with ?debug). */
  freeCam: FreeCamera;
  flashlight: Flashlight;
  world: World;
  audio: AudioEngine;
  toasts: Toasts;
  hud: PlayerHud;
  /** Sequencer, cutscene bars and the skip prompt (intro-sequence spec). */
  cutscene: CutsceneController;
  /** Key items held (ADR-0024), saved in `items`. */
  inventory: Inventory;
  /** Map state of the current level (ADR-0024), saved in `map` under the level id. */
  map?: MapPersistence | null | undefined;
}

const CHAPTER = 'slice01';
/** Game over: fade to black, hold, then restart from the last checkpoint (ADR-0004). */
const DEATH_FADE = 1.4;
const DEATH_HOLD = 1.0;

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
  /** Map state of every level visited this playthrough, by level id (ADR-0024). */
  private mapSaves: Record<string, { seen: string[]; revealed: string[] }> = {};
  /** Debug fly camera instead of the player. */
  flying = false;
  private readonly d: GameDeps;
  private titleTime = 0;
  private readonly feet = new THREE.Vector3();
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly eye = new THREE.Vector3();

  constructor(deps: GameDeps) {
    this.d = deps;
    deps.events.on('input:pointerLock', ({ locked }) => {
      // Esc or alt-tab while playing releases the mouse: that is "pause".
      if (!locked && this.mode === 'playing') this.pause();
    });
    deps.events.on('player:died', () => this.gameOver());
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
    this.d.inventory.clear();
    this.mapSaves = {};
    this.d.map?.clear();
    this.d.world.resetToData?.();
    this.spawnAtStart();
    this.enterPlaying();
    // The opening plays on rails and may be skipped; with none registered, play starts at once.
    this.d.cutscene.playIntro();
  }

  load(save: SaveData, quiet = false): void {
    this.slot = save.slot;
    this.difficulty = save.difficulty;
    this.playTime = save.playTime;
    this.checkpoint = save.checkpoint;
    this.location = save.location;
    this.flags = { ...save.flags };
    this.d.inventory.restore(save.items);
    this.mapSaves = { ...save.map };
    this.d.map?.restore(save.map[this.d.world.id] ?? null);
    const { player } = this.d;
    player.reset(save.player.health);
    player.placeAtEye(new THREE.Vector3().fromArray(save.player.position), save.player.yaw, save.player.pitch);
    this.d.flashlight.on = save.player.flashlightOn;
    this.cancelRestart();
    this.d.cutscene.cancel();
    this.enterPlaying();
    if (!quiet) this.d.toasts.show(save.kind === 'auto' ? 'Autosave loaded' : 'Save loaded', save.location);
  }

  snapshot(kind: SaveKind): SaveData {
    const { player } = this.d;
    return {
      version: SAVE_VERSION,
      kind,
      slot: this.slot,
      savedAt: new Date().toISOString(),
      playTime: this.playTime,
      difficulty: this.difficulty,
      chapter: CHAPTER,
      level: this.d.world.id,
      checkpoint: this.checkpoint,
      location: this.location || 'Section 07',
      player: {
        position: player.eyePosition(this.eye).toArray(),
        yaw: player.yaw,
        pitch: player.pitch,
        health: Math.max(1, Math.round(player.vitals.hp)),
        flashlightOn: this.d.flashlight.on,
      },
      flags: { ...this.flags },
      items: this.d.inventory.list(),
      map: this.d.map ? { ...this.mapSaves, [this.d.world.id]: this.d.map.save() } : { ...this.mapSaves },
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
    this.d.cutscene.paused();
  }

  resume(): void {
    if (this.mode !== 'paused') return;
    this.setMode('playing');
    this.d.input.requestLock();
  }

  quitToTitle(): void {
    this.cancelRestart();
    this.d.cutscene.cancel();
    this.d.hud.setFade(0, 0);
    this.setMode('title');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Map overlay (ADR-0024): pause and free the mouse; the map screen listens for `game:map`. */
  openMap(): void {
    if (this.mode !== 'playing') return;
    this.setMode('paused');
    if (document.pointerLockElement) document.exitPointerLock();
    this.d.events.emit('game:map', {});
  }

  openSaveStation(): void {
    this.setMode('paused');
    if (document.pointerLockElement) document.exitPointerLock();
    this.d.events.emit('game:saveStation', {});
  }

  /** ?debug F1: swap between the player and the fly camera. */
  toggleFly(): void {
    const { player, freeCam, camera } = this.d;
    this.flying = !this.flying;
    if (this.flying) {
      freeCam.yaw = player.yaw;
      freeCam.pitch = player.pitch;
    } else {
      player.placeAtEye(camera.position, freeCam.yaw, freeCam.pitch);
    }
    this.d.toasts.show('Debug', this.flying ? 'Free-fly camera (F1 to return)' : 'Player camera');
  }

  /** Fixed-step simulation. */
  update(dt: number): void {
    if (this.mode !== 'playing') return;
    this.playTime += dt;
    if (this.flying) {
      this.d.freeCam.update(dt);
      return;
    }
    const { player, world } = this.d;
    this.d.cutscene.update(dt);
    player.update(dt);
    this.feet.set(player.body.x, player.body.y, player.body.z);
    for (const cp of world.checkpoints) {
      if (!this.flags[`cp:${cp.id}`] && player.alive && cp.reached(this.feet)) this.reachCheckpoint(cp.id, cp.label);
    }
  }

  /** Per rendered frame. */
  render(frameDt: number): void {
    const { player, hud, interactions } = this.d;
    this.d.cutscene.render();
    if (this.mode === 'title') {
      // Attract camera: a slow drift down the corridor behind the title menu.
      this.titleTime += frameDt;
      // Debug: `window.__view = { at: [x, y, z], look: [x, y, z] }` pins the title camera for screenshots.
      const view = (globalThis as { __view?: { at: [number, number, number]; look: [number, number, number] } }).__view;
      if (view) {
        this.d.camera.position.set(...view.at);
        this.d.camera.lookAt(...view.look);
      } else this.d.world.attract(this.titleTime, this.d.camera);
      this.d.input.consumeLook();
      hud.hide();
      return;
    }
    if (this.mode === 'playing') {
      if (this.flying) {
        this.d.freeCam.look();
        hud.hide();
        return;
      }
      player.look(frameDt);
      player.applyCamera(frameDt);
      hud.update(player, interactions);
    } else {
      this.d.input.consumeLook();
      hud.hide();
    }
  }

  /** Re-apply master volume with pause ducking, and the music / SFX / voice bus volumes. */
  applyVolume(): void {
    const settings = this.d.settings.get();
    this.d.audio.setMasterVolume(settings.masterVolume * (this.mode === 'paused' ? 0.45 : 1));
    applyBusVolumes(this.d.audio, settings);
  }

  private spawnAtStart(): void {
    const { player, world } = this.d;
    this.d.cutscene.cancel();
    player.reset();
    player.placeAtEye(world.spawn.position, world.spawn.yaw);
    this.d.flashlight.on = false;
  }

  private gameOver(): void {
    this.cancelRestart();
    this.d.hud.setFade(1, DEATH_FADE);
    this.restartTimer = setTimeout(() => this.restartFromCheckpoint(), (DEATH_FADE + DEATH_HOLD) * 1000);
  }

  /** Back to the slot's last autosave, healed to at least the difficulty's checkpoint heal. */
  private restartFromCheckpoint(): void {
    this.restartTimer = null;
    const auto = this.d.saves.read(this.slot, 'auto').data;
    if (auto) {
      const hp = Math.max(auto.player.health, this.preset.checkpointHeal);
      this.load({ ...auto, player: { ...auto.player, health: hp } }, true);
    } else {
      this.spawnAtStart();
    }
    this.d.toasts.show('Restarted', this.location || 'Section 07');
    this.d.hud.setFade(0, 0.9);
    this.d.events.emit('game:restarted', { checkpoint: this.checkpoint });
  }

  private cancelRestart(): void {
    if (this.restartTimer !== null) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  /** Take a checkpoint: flag it, heal, autosave. Also called by sequences (ADR-0009). */
  reachCheckpoint(id: string, label: string): void {
    this.flags[`cp:${id}`] = true;
    this.checkpoint = id;
    this.location = label;
    this.d.player.vitals.checkpoint();
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
}
