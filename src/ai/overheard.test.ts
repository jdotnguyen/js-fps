import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../core/validate.ts';
import { validateOverheard } from '../data/types/overheard.ts';
import { heardFlag, OverheardDirector, overheardChannel, type OverheardHost } from './overheard.ts';

const data = validate(validateOverheard, JSON.parse(readFileSync(new URL('../data/overheard.json', import.meta.url), 'utf8')), 'overheard.json');
const linesOf = (id: string): string[] => data.exchanges.find((x) => x.id === id)!.lines;

/** Each line lasts this long in the fake speech. */
const LINE_S = 2;

function setup(init: { flags?: string[]; bar?: number; wall?: number } = {}) {
  const flags = new Set(init.flags ?? ['introSeen']);
  const state = {
    room: 'R02' as string | null,
    free: true,
    scene: false,
    higher: false,
    dropOnSay: false,
    unready: new Set<string>(),
    pairs: { commons_bar: { distance: init.bar ?? 3, free: true }, commons_wall: { distance: init.wall ?? 20, free: true } } as Record<string, { distance: number; free: boolean }>,
  };
  const said: string[] = [];
  const stopped: string[] = [];
  const channels: string[] = [];
  const suspended = new Set<string>();
  let playing: { id: string; left: number } | null = null;
  const host: OverheardHost = {
    say: (id, channel) => {
      said.push(id);
      channels.push(channel);
      if (state.dropOnSay) director.lineOver(id, 'dropped');
      else playing = { id, left: LINE_S };
    },
    stop: (id) => {
      stopped.push(id);
      playing = null;
    },
    ready: (id) => !state.unready.has(id),
    flag: (n) => flags.has(n),
    setFlag: (n) => void flags.add(n),
    playerRoom: () => state.room,
    freeControl: () => state.free,
    sceneRunning: () => state.scene,
    higherSpeech: () => state.higher,
    pair: (chat) => state.pairs[chat] ?? null,
    suspend: (chat, on) => void (on ? suspended.add(chat) : suspended.delete(chat)),
  };
  const director = new OverheardDirector(data, host);
  const run = (seconds: number, step = 0.05): void => {
    for (let t = 0; t < seconds - 1e-9; t += step) {
      director.update(step);
      if (playing) {
        playing.left -= step;
        if (playing.left <= 0) {
          const { id } = playing;
          playing = null;
          director.lineOver(id, 'finished');
        }
      }
    }
  };
  return { director, run, state, flags, said, stopped, channels, suspended };
}

test('lingering at the bar after the intro, the pair says its exchange in order on its own channel, then falls quiet', () => {
  const g = setup();
  g.run(0.05);
  assert.deepEqual(g.said, [linesOf('overheard_bar_before')[0]]);
  assert.ok(g.suspended.has('commons_bar'), 'filler turns are held');
  g.run(15);
  assert.deepEqual(g.said, linesOf('overheard_bar_before'));
  assert.ok(g.channels.every((c) => c === overheardChannel('overheard_bar_before')));
  assert.equal(g.director.current, null);
  assert.equal(g.suspended.size, 0, 'released');
  assert.ok(g.flags.has(heardFlag('overheard_bar_before')));
});

test('lines are separated by a short pause', () => {
  const g = setup();
  g.run(LINE_S + 0.3);
  assert.equal(g.said.length, 1);
  g.run(0.6);
  assert.equal(g.said.length, 2);
});

test('nothing starts during the intro, and after the briefing only the after-briefing exchanges play', () => {
  const intro = setup({ flags: [] });
  intro.run(10);
  assert.deepEqual(intro.said, []);

  const after = setup({ flags: ['introSeen', 'briefingSeen'] });
  after.run(0.1);
  assert.equal(after.director.current, 'overheard_bar_after_1', 'the unheard pre-briefing exchange is skipped');
});

test('a game loaded from the save made as the intro ends still has its pre-briefing exchanges', () => {
  const intro = JSON.parse(readFileSync(new URL('../data/sequences/intro_shift_change.json', import.meta.url), 'utf8')) as { steps: Array<Record<string, unknown>> };
  // The flags such a save holds: those the intro sets before its autosave (`commons_free` is set only afterwards).
  const upToSave = intro.steps.slice(0, intro.steps.findIndex((s) => s['do'] === 'checkpoint' && s['id'] === 'cp_intro'));
  const saved = upToSave.filter((s) => s['do'] === 'setFlag' && s['value'] === true).map((s) => String(s['flag']));
  const g = setup({ flags: saved });
  g.run(0.1);
  assert.equal(g.director.current, 'overheard_bar_before');
});

test('each condition holds an exchange back: room, range, speakers, control, a Commons scene, a recording', () => {
  const cases: Array<[string, (g: ReturnType<typeof setup>) => void]> = [
    ['another room', (g) => (g.state.room = 'R03')],
    ['6 m away', (g) => (g.state.pairs['commons_bar']!.distance = 6)],
    ['a speaker busy', (g) => (g.state.pairs['commons_bar']!.free = false)],
    ['no free control', (g) => (g.state.free = false)],
    ['a Commons scene running', (g) => (g.state.scene = true)],
    ['one clip not ready', (g) => g.state.unready.add(linesOf('overheard_bar_before')[3]!)],
  ];
  for (const [name, block] of cases) {
    const g = setup();
    block(g);
    g.run(5);
    assert.deepEqual(g.said, [], name);
    assert.ok(!g.flags.has(heardFlag('overheard_bar_before')), `${name}: still unheard`);
  }
});

test('it waits for 2 s without a higher line in earshot', () => {
  const g = setup();
  g.state.higher = true;
  g.run(5);
  g.state.higher = false;
  g.run(1.9);
  assert.deepEqual(g.said, []);
  g.run(0.2);
  assert.equal(g.said.length, 1);
});

test('between the two pairs only the nearer one speaks', () => {
  const g = setup({ bar: 4, wall: 2 });
  g.run(0.1);
  assert.equal(g.director.current, 'overheard_wall_before');
  g.run(3);
  assert.ok(g.said.every((id) => id.startsWith('overheard_wall_')), 'one exchange at a time');
});

test('an exchange plays once, and the second after-briefing one waits 20 s', () => {
  const g = setup({ flags: ['introSeen', 'briefingSeen'] });
  g.run(0.05);
  while (g.director.current) g.run(0.05);
  g.run(19.8);
  assert.deepEqual(g.said, linesOf('overheard_bar_after_1'));
  g.run(0.4);
  assert.equal(g.director.current, 'overheard_bar_after_2');
  g.run(60);
  assert.deepEqual(g.said, [...linesOf('overheard_bar_after_1'), ...linesOf('overheard_bar_after_2')], 'then only murmur');
});

test('a heard flag keeps an exchange from playing again after a load', () => {
  const g = setup({ flags: ['introSeen', heardFlag('overheard_bar_before')] });
  g.director.reset();
  g.run(30);
  assert.deepEqual(g.said, []);
});

test('walking away: the line being said finishes and nothing after it plays, even on coming back', () => {
  for (const leave of [(g: ReturnType<typeof setup>) => (g.state.pairs['commons_bar']!.distance = 10), (g: ReturnType<typeof setup>) => (g.state.room = 'R03')]) {
    const g = setup();
    g.run(LINE_S + 1);
    assert.equal(g.said.length, 2);
    leave(g);
    g.run(0.1);
    assert.deepEqual(g.stopped, [], 'not cut off');
    g.state.pairs['commons_bar']!.distance = 3;
    g.state.room = 'R02';
    g.run(40);
    assert.equal(g.said.length, 2);
    assert.equal(g.director.current, null);
    assert.equal(g.suspended.size, 0);
  }
});

test('a higher line, a speaker becoming busy or the drop stops the exchange at once', () => {
  const cuts: Array<[string, (g: ReturnType<typeof setup>) => void]> = [
    ['higher line', (g) => (g.state.higher = true)],
    ['speaker busy', (g) => (g.state.pairs['commons_bar']!.free = false)],
    ['the drop', (g) => void g.flags.add('drop_started')],
  ];
  for (const [name, cut] of cuts) {
    const g = setup();
    g.run(0.5);
    cut(g);
    g.run(0.05);
    assert.deepEqual(g.stopped, [linesOf('overheard_bar_before')[0]], name);
    assert.equal(g.director.current, null, name);
    assert.equal(g.suspended.size, 0, name);
  }
});

test('a line the speech manager cuts off or drops ends the exchange without a restart', () => {
  const cut = setup();
  cut.run(0.5);
  cut.director.lineOver(cut.said[0]!, 'interrupted');
  cut.run(40);
  assert.equal(cut.said.length, 1);

  const drop = setup();
  drop.state.dropOnSay = true;
  drop.run(40);
  assert.equal(drop.said.length, 1);
  assert.equal(drop.suspended.size, 0);
});

test('nothing starts once the drop has begun', () => {
  const g = setup({ flags: ['introSeen', 'briefingSeen', 'drop_started'] });
  g.run(30);
  assert.deepEqual(g.said, []);
});
