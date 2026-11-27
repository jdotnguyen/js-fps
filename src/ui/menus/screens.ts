import type { EventBus } from '../../core/events.ts';
import { SETTING_RANGES, TUTORIAL_MODES, type Settings, type SettingsStore } from '../../core/settings.ts';
import { DIFFICULTY_IDS, type DifficultyId, type DifficultyTable } from '../../data/types/difficulty.ts';
import { formatPlayTime, type SaveData, type SaveEntry, type SaveStore, type SlotSummary } from '../../game/save.ts';
import { button, h } from '../dom.ts';
import { Menu, type Screen } from './menu.ts';
import { createTitleWordmark } from './titleWordmark.ts';

/** Narrow game surface the menus need (satisfied by `Game` and by `AppShell`'s lazy proxy). */
export interface MenuGameAdapter {
  readonly slot: number;
  readonly difficulty: DifficultyId;
  readonly playTime: number;
  readonly location: string;
  newGame(slot: number, difficulty: DifficultyId): void;
  load(save: SaveData): void;
  resume(): void;
  setDifficulty(id: DifficultyId): void;
  manualSave(): void;
  quitToTitle(): void;
}

export interface MenuDeps {
  game: MenuGameAdapter;
  saves: SaveStore;
  settings: SettingsStore;
  difficulties: DifficultyTable;
  events: EventBus;
  /** Settings > Accessibility "Reset tutorials" (ADR-0025). */
  resetTutorials?: () => void;
  /** Opens the end-credits overlay from the title menu. */
  showCredits?: () => void;
}

type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

/** Wires the title, pause, save-station, load, new-game and settings screens (ADR-0016). */
export function createMenus(root: HTMLElement, deps: MenuDeps): Menu {
  const { game, saves, settings, difficulties, events } = deps;
  const menu = new Menu(root);

  const diffLabel = (id: DifficultyId): string => difficulties[id].label;
  const describe = (s: SaveData): string =>
    `${s.location} · ${diffLabel(s.difficulty)} · ${formatPlayTime(s.playTime)} · ${new Date(s.savedAt).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })}`;
  const slotLine = (s: SlotSummary): string => {
    if (s.latest) return describe(s.latest);
    if (!s.empty) return 'Damaged save';
    return 'Empty';
  };

  const confirmScreen = (title: string, message: string, confirmLabel: string, onConfirm: () => void): Screen => ({
    title,
    build: (m) => [
      h('p', { class: 'menu-text', text: message }),
      button(confirmLabel, onConfirm, { class: 'menu-btn danger' }),
      button('Cancel', () => m.back(), { autofocus: true }),
    ],
  });

  const difficultyScreen = (title: string, current: DifficultyId | null, onPick: (id: DifficultyId) => void): Screen => ({
    title,
    build: () =>
      DIFFICULTY_IDS.map((id) =>
        button(
          difficulties[id].label + (id === current ? '  (current)' : ''),
          () => onPick(id),
          { autofocus: id === (current ?? 'standard') },
          h('small', { text: difficulties[id].description }),
        ),
      ),
  });

  const newGameScreen = (): Screen => ({
    title: 'New game',
    subtitle: 'Choose a slot for this playthrough.',
    build: (m) =>
      saves.summaries().map((s) => {
        const pickDifficulty = (): void =>
          m.push(difficultyScreen('Difficulty', null, (id) => game.newGame(s.slot, id)));
        return button(
          `Slot ${s.slot + 1}`,
          () =>
            s.empty
              ? pickDifficulty()
              : m.push(
                  confirmScreen(
                    `Overwrite slot ${s.slot + 1}?`,
                    `This deletes the playthrough in slot ${s.slot + 1} (${slotLine(s)}).`,
                    'Overwrite',
                    pickDifficulty,
                  ),
                ),
          { autofocus: s.slot === (saves.firstEmptySlot() ?? 0) },
          h('small', { text: slotLine(s) }),
        );
      }),
  });

  const entryButton = (label: string, entry: SaveEntry): Node => {
    if (entry.data) {
      const data = entry.data;
      return button(label, () => game.load(data), {}, h('small', { text: describe(data) }));
    }
    if (entry.error) return h('p', { class: 'menu-damaged', text: `${label}: damaged save (${entry.error})` });
    return h('p', { class: 'menu-empty', text: `${label}: none` });
  };

  const loadScreen = (): Screen => ({
    title: 'Load game',
    build: (m) =>
      saves.summaries().map((s) =>
        h(
          'div',
          { class: 'menu-slot' },
          h('h2', { text: `Slot ${s.slot + 1}` }),
          s.empty
            ? h('p', { class: 'menu-empty', text: 'Empty' })
            : h(
                'div',
                {},
                entryButton('Station save', s.manual),
                entryButton('Autosave', s.auto),
                button(
                  'Delete slot',
                  () =>
                    m.push(
                      confirmScreen(`Delete slot ${s.slot + 1}?`, 'Both the autosave and the station save will be removed.', 'Delete', () => {
                        saves.clearSlot(s.slot);
                        m.back();
                      }),
                    ),
                  { class: 'menu-btn small danger' },
                ),
              ),
        ),
      ),
  });

  const range = (label: string, key: NumKey, min: number, max: number, step: number, fmt: (v: number) => string): Node => {
    const id = `set-${key}`;
    const out = h('output', { for: id, text: fmt(settings.get()[key]) });
    const input = h('input', { id, type: 'range', min, max, step, value: settings.get()[key] });
    input.addEventListener('input', () => {
      const v = Number(input.value);
      settings.set(key, v);
      out.textContent = fmt(v);
    });
    return h('div', { class: 'menu-field' }, h('label', { for: id, text: label }), input, out);
  };

  const toggle = (label: string, key: BoolKey, hint = ''): Node => {
    const id = `set-${key}`;
    const input = h('input', { id, type: 'checkbox', checked: settings.get()[key] });
    input.addEventListener('change', () => settings.set(key, input.checked));
    return h(
      'div',
      { class: 'menu-field toggle' },
      input,
      h('label', { for: id, text: label }),
      hint ? h('small', { text: hint }) : null,
    );
  };

  const quality = (): Node => {
    const id = 'set-quality';
    const select = h(
      'select',
      { id },
      ...(['low', 'medium', 'high'] as const).map((q) =>
        h('option', { value: q, text: q[0]!.toUpperCase() + q.slice(1), selected: settings.get().quality === q }),
      ),
    );
    select.addEventListener('change', () => settings.set('quality', select.value as Settings['quality']));
    return h('div', { class: 'menu-field' }, h('label', { for: id, text: 'Graphics quality' }), select);
  };

  // Tutorial pop-ups (ADR-0025): mode plus a reset of the profile's "seen" list.
  const tutorials = (): Node[] => {
    const id = 'set-tutorialPrompts';
    const labels: Record<Settings['tutorialPrompts'], string> = { first: 'First time only', always: 'Always', off: 'Off' };
    const select = h(
      'select',
      { id },
      ...TUTORIAL_MODES.map((m) => h('option', { value: m, text: labels[m], selected: settings.get().tutorialPrompts === m })),
    );
    select.addEventListener('change', () => settings.set('tutorialPrompts', select.value as Settings['tutorialPrompts']));
    const status = h('small', { role: 'status', 'aria-live': 'polite' });
    const reset = button(
      'Reset tutorials',
      () => {
        deps.resetTutorials?.();
        status.textContent = 'Tutorials will show again.';
      },
      { class: 'menu-btn small' },
    );
    return [h('div', { class: 'menu-field' }, h('label', { for: id, text: 'Tutorial pop-ups' }), select), h('div', { class: 'menu-field' }, reset, status)];
  };

  const settingsScreen = (): Screen => ({
    title: 'Settings',
    subtitle: 'Changes apply and save immediately.',
    build: () => [
      h('h2', { text: 'Controls' }),
      range('Mouse sensitivity', 'mouseSensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2)),
      toggle('Invert vertical look', 'invertY'),
      range('Field of view', 'fov', 70, 95, 1, (v) => `${v}°`),
      h('h2', { text: 'Graphics' }),
      quality(),
      toggle('Film grain', 'filmGrain'),
      toggle('Eye adaptation', 'eyeAdaptation', 'Exposure adjusts slowly when you move between dark and bright rooms.'),
      h('h2', { text: 'HUD' }),
      range('HUD opacity', 'hudOpacity', ...SETTING_RANGES.hudOpacity, 0.05, (v) => `${Math.round(v * 100)}%`),
      range('HUD scale', 'hudScale', ...SETTING_RANGES.hudScale, 0.05, (v) => `${Math.round(v * 100)}%`),
      toggle('Calm HUD', 'calmHud', 'The panels dim when nothing is happening.'),
      h('h2', { text: 'Audio' }),
      range('Master volume', 'masterVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`),
      range('Music volume', 'musicVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`),
      range('SFX volume', 'sfxVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`),
      range('Voice volume', 'voiceVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`),
      h('h2', { text: 'Accessibility' }),
      toggle('Subtitles', 'subtitles', 'Subtitles show what is being said.'),
      toggle('Reduced flashing', 'reducedFlashing', 'Limits flickering and strobing lights.'),
      toggle('Reduced motion', 'reducedMotion', 'Less camera bob and shake.'),
      range('Cutscene skip hold time', 'skipHoldSeconds', 1.5, 6, 0.5, (v) => `${v.toFixed(1)} s`),
      toggle('Skip assist', 'skipAssist', 'Press the skip key once to start the countdown, again to cancel, instead of holding it.'),
      ...tutorials(),
    ],
  });

  const titleScreen = (): Screen => {
    const latest = saves.latest();
    const any = saves.summaries().some((s) => !s.empty);
    return {
      title: 'THALASSA',
      variant: 'title-screen',
      titleArt: () =>
        createTitleWordmark({
          reducedFlashing: () => settings.get().reducedFlashing,
          reducedMotion: () => settings.get().reducedMotion,
        }),
      build: (m) => [
        latest ? button('Continue', () => game.load(latest), { autofocus: true }, h('small', { text: describe(latest) })) : null,
        button('New game', () => m.push(newGameScreen()), { autofocus: !latest }),
        button('Load game', () => m.push(loadScreen()), { disabled: !any }),
        button('Settings', () => m.push(settingsScreen())),
        button('Credits', () => deps.showCredits?.()),
        h('p', { class: 'menu-foot', text: 'Headphones recommended.' }),
      ],
    };
  };

  const pauseScreen = (): Screen => ({
    title: 'Paused',
    subtitle: `${game.location || 'Section 07'} · Slot ${game.slot + 1} · ${formatPlayTime(game.playTime)}`,
    onBack: () => game.resume(),
    build: (m) => [
      button('Resume', () => game.resume(), { autofocus: true }),
      button(
        'Difficulty',
        () =>
          m.push(
            difficultyScreen('Difficulty', game.difficulty, (id) => {
              game.setDifficulty(id);
              m.back();
            }),
          ),
        {},
        h('small', { text: diffLabel(game.difficulty) }),
      ),
      button('Settings', () => m.push(settingsScreen())),
      button('Load game', () => m.push(loadScreen())),
      button('Quit to title', () =>
        m.push(confirmScreen('Quit to title?', 'Progress since your last save or checkpoint will be lost.', 'Quit', () => game.quitToTitle())),
      ),
    ],
  });

  const saveStationScreen = (): Screen => {
    const existing = saves.read(game.slot, 'manual').data;
    return {
      title: 'Save station',
      subtitle: `Slot ${game.slot + 1} · ${diffLabel(game.difficulty)} · ${formatPlayTime(game.playTime)}`,
      onBack: () => game.resume(),
      build: () => [
        h('p', {
          class: 'menu-text',
          text: existing ? `Replaces your station save: ${describe(existing)}` : 'Records your progress. Autosaves at checkpoints are kept separately.',
        }),
        button(
          'Save',
          () => {
            game.manualSave();
            game.resume();
          },
          { autofocus: true },
        ),
        button('Back', () => game.resume()),
      ],
    };
  };

  events.on('game:mode', ({ mode }) => {
    if (mode === 'title') menu.show(titleScreen());
    else if (mode === 'paused') menu.show(pauseScreen());
    else menu.hide();
  });
  events.on('game:saveStation', () => menu.show(saveStationScreen()));
  // The map overlay pauses the game but draws its own screen (ADR-0024).
  events.on('game:map', () => menu.hide());
  return menu;
}
