import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:net';
import { test } from 'node:test';
import { claimSlot, DEFAULT_PLAYTEST_MINUTES, MAX_PLAYTEST_MINUTES, playtestMinutes } from './playtest-serve.ts';

// Ports of the test's own, so running it never touches a real playtest slot.
const PORTS = [45180, 45181];

const close = (server: Server): Promise<unknown> => new Promise((done) => server.close(done));

test('playtest slots: each claim takes the next free one, none when all are held, and a released one comes back', async () => {
  const first = await claimSlot(PORTS);
  const second = await claimSlot(PORTS);
  try {
    assert.equal(first?.port, 45180);
    assert.equal(second?.port, 45181);
    assert.equal(await claimSlot(PORTS), null);
    await close(first.lock);
    const again = await claimSlot(PORTS);
    assert.equal(again?.port, 45180);
    await close(again.lock);
  } finally {
    if (first?.lock.listening) await close(first.lock);
    if (second) await close(second.lock);
  }
});

for (const host of ['127.0.0.1', '::1']) {
  test(`playtest slots: a serving port something else uses on ${host} is skipped`, async () => {
    const other = createServer();
    await new Promise<void>((done) => other.listen(45180, host, done));
    try {
      const slot = await claimSlot(PORTS);
      assert.equal(slot?.port, 45181);
      await close(slot.lock);
    } finally {
      await close(other);
    }
  });
}

test('playtest lifetime: PLAYTEST_MINUTES when it is a positive integer, capped, otherwise the default', () => {
  assert.equal(playtestMinutes({}), DEFAULT_PLAYTEST_MINUTES);
  assert.equal(playtestMinutes({ PLAYTEST_MINUTES: '60' }), 60);
  assert.equal(playtestMinutes({ PLAYTEST_MINUTES: '0' }), DEFAULT_PLAYTEST_MINUTES);
  assert.equal(playtestMinutes({ PLAYTEST_MINUTES: 'soon' }), DEFAULT_PLAYTEST_MINUTES);
  assert.equal(playtestMinutes({ PLAYTEST_MINUTES: '100000' }), MAX_PLAYTEST_MINUTES);
});
