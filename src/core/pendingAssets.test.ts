import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetsSettled, trackAsset } from './pendingAssets.ts';

// session-loading "Late-appearing models load with the session" (openspec stop-midgame-shader-stalls D4).

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

test('the wait resolves once every load has finished, whether it succeeded or failed', async () => {
  const ok = deferred();
  const bad = deferred();
  trackAsset(ok.promise);
  trackAsset(bad.promise);
  let settled = false;
  const wait = assetsSettled().then(() => (settled = true));
  await tick();
  assert.equal(settled, false);
  ok.resolve();
  await tick();
  assert.equal(settled, false, 'one is still loading');
  bad.reject(new Error('404'));
  await wait;
  assert.equal(settled, true);
});

test('a load reported while waiting is waited for too, and nothing pending resolves at once', async () => {
  await assetsSettled();
  const first = deferred();
  const second = deferred();
  trackAsset(first.promise.then(() => trackAsset(second.promise)));
  let settled = false;
  const wait = assetsSettled().then(() => (settled = true));
  first.resolve();
  await tick();
  assert.equal(settled, false);
  second.resolve();
  await wait;
});
