import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TitlePreload, type PreloadKey } from './titlePreload.ts';

const KEY: PreloadKey = { levelId: 'slice01', quality: 'high', gpu: '16/1024/16' };
const quiet = { warn: () => undefined };

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('a finished item is handed over and the fallback never runs', async () => {
  const p = new TitlePreload(KEY, quiet);
  p.start('models', 'shared', async () => 'prepared');
  const got = await p.take('models', KEY, async () => 'fallback');
  assert.equal(got, 'prepared');
});

test('an item is never started twice', async () => {
  const p = new TitlePreload(KEY, quiet);
  let runs = 0;
  const run = async (): Promise<number> => ++runs;
  p.start('textures', 'quality', run);
  p.start('textures', 'quality', run);
  assert.equal(runs, 1);
  assert.equal(await p.take('textures', KEY, async () => -1), 1);
});

test('a session started mid-preparation awaits the work in flight', async () => {
  const p = new TitlePreload(KEY, quiet);
  const d = deferred<string>();
  let runs = 0;
  p.start('world', 'level', () => {
    runs++;
    return d.promise;
  });
  const taken = p.take('world', KEY, async () => 'fallback');
  d.resolve('built');
  assert.equal(await taken, 'built');
  assert.equal(runs, 1);
});

test('a taken item leaves the holder, so a second take builds its own', async () => {
  const p = new TitlePreload(KEY, quiet);
  p.start('a', 'shared', async () => 'one');
  assert.equal(await p.take('a', KEY, async () => 'fallback'), 'one');
  assert.equal(p.has('a'), false);
  assert.equal(await p.take('a', KEY, async () => 'fallback'), 'fallback');
});

test('shared items ignore the key; quality items need the same quality', async () => {
  const p = new TitlePreload(KEY, quiet);
  p.start('shared', 'shared', async () => 'S');
  p.start('tex', 'quality', async () => 'T');
  const other: PreloadKey = { levelId: 'lab', quality: 'low', gpu: 'x' };
  assert.equal(await p.take('shared', other, async () => 'fallback'), 'S');
  assert.equal(await p.take('tex', other, async () => 'fallback'), 'fallback');
  // The same quality on another level still takes it: textures do not depend on the level.
  assert.equal(await p.take('tex', { ...KEY, levelId: 'lab' }, async () => 'fallback'), 'T');
});

test('level items need the same level, quality and GPU limits', async () => {
  for (const other of [{ ...KEY, levelId: 'lab' }, { ...KEY, quality: 'low' }, { ...KEY, gpu: '8/512/8' }]) {
    const p = new TitlePreload(KEY, quiet);
    p.start('world', 'level', async () => 'built');
    assert.equal(await p.take('world', other, async () => 'fallback'), 'fallback');
  }
  const p = new TitlePreload(KEY, quiet);
  p.start('world', 'level', async () => 'built');
  assert.equal(await p.take('world', { ...KEY }, async () => 'fallback'), 'built');
});

test('a mismatched item stays in the holder for a later matching take', async () => {
  const p = new TitlePreload(KEY, quiet);
  p.start('world', 'level', async () => 'built');
  assert.equal(await p.take('world', { ...KEY, levelId: 'lab' }, async () => 'fallback'), 'fallback');
  assert.equal(p.has('world'), true);
});

test('a rejected item is dropped, reported, and the take runs the fallback', async () => {
  const warnings: string[] = [];
  const p = new TitlePreload(KEY, { warn: (m) => warnings.push(m) });
  p.start('models', 'shared', async () => {
    throw new Error('404');
  });
  const got = await p.take('models', KEY, async () => 'fallback');
  assert.equal(got, 'fallback');
  assert.equal(p.has('models'), false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /models failed/);
});

test('a loader that throws synchronously is treated as a failed item', async () => {
  const p = new TitlePreload(KEY, quiet);
  p.start('x', 'shared', () => {
    throw new Error('boom');
  });
  assert.equal(await p.take('x', KEY, async () => 'fallback'), 'fallback');
});

test('a failure nobody takes is reported but never unhandled', async () => {
  const p = new TitlePreload(KEY, quiet);
  p.start('x', 'shared', () => Promise.reject(new Error('nope')));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(p.has('x'), false);
});

test('a quality change releases a finished quality result and starts clean', async () => {
  const released: string[] = [];
  const p = new TitlePreload(KEY, quiet);
  p.start('tex', 'quality', async () => 'high-textures', (v) => released.push(v));
  p.start('world', 'level', async () => 'high-world', (v) => released.push(v));
  p.start('models', 'shared', async () => 'models', (v) => released.push(v));
  await new Promise((r) => setTimeout(r, 0));
  p.setQuality('low');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(released.sort(), ['high-textures', 'high-world']);
  assert.equal(p.has('tex'), false);
  assert.equal(p.has('models'), true);
  assert.equal(p.current.quality, 'low');
});

test('a quality change mid-generation releases the result when it lands and never hands it out', async () => {
  const released: string[] = [];
  const p = new TitlePreload(KEY, quiet);
  const d = deferred<string>();
  p.start('tex', 'quality', () => d.promise, (v) => released.push(v));
  p.setQuality('low');
  d.resolve('stale');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(released, ['stale']);
  // The next preparation for the new quality is a fresh start, not the stale promise.
  p.start('tex', 'quality', async () => 'fresh');
  assert.equal(await p.take('tex', { ...KEY, quality: 'low' }, async () => 'fallback'), 'fresh');
});

test('setting the same quality changes nothing', async () => {
  const p = new TitlePreload(KEY, quiet);
  p.start('tex', 'quality', async () => 'T');
  p.setQuality('high');
  assert.equal(await p.take('tex', KEY, async () => 'fallback'), 'T');
});

test('a taken item is not released by a later drop', async () => {
  const released: string[] = [];
  const p = new TitlePreload(KEY, quiet);
  p.start('world', 'level', async () => 'built', (v) => released.push(v));
  assert.equal(await p.take('world', KEY, async () => 'fallback'), 'built');
  p.dispose();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(released, []);
});

test('dispose releases everything held and refuses new work', async () => {
  const released: string[] = [];
  const p = new TitlePreload(KEY, quiet);
  p.start('a', 'shared', async () => 'A', (v) => released.push(v));
  p.start('b', 'level', async () => 'B', (v) => released.push(v));
  p.dispose();
  p.start('c', 'shared', async () => 'C', (v) => released.push(v));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(released.sort(), ['A', 'B']);
  assert.equal(p.has('c'), false);
  assert.equal(await p.take('a', KEY, async () => 'fallback'), 'fallback');
});

test('a release that throws is reported and never becomes an unhandled rejection', async () => {
  const warnings: string[] = [];
  const p = new TitlePreload(KEY, { warn: (m) => warnings.push(m) });
  p.start('a', 'shared', async () => 'A', () => {
    throw new Error('dispose blew up');
  });
  p.dispose();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /releasing a failed/);
});
