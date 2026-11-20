import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ChatGroup, CHAT_TUNING, type ChatMember } from './chatter.ts';

/** ADR-0029 conversations: turn-taking, listeners look at the speaker, members drop out. */

interface Fake extends ChatMember {
  pos: { x: number; z: number };
  free: boolean;
  talking: number;
  lines: number;
  look: (() => THREE.Vector3 | null) | null;
}

function member(id: string, x: number, z: number): Fake {
  const m: Fake = {
    id,
    pos: { x, z },
    free: true,
    talking: 0,
    lines: 0,
    look: null,
    feet: () => m.pos,
    head: (out) => out.set(m.pos.x, 1.2, m.pos.z),
    available: () => m.free,
    speak: (_t, _e, seconds) => {
      m.talking = seconds;
      m.lines++;
    },
    stopSpeaking: () => {
      m.talking = 0;
    },
    lookAt: (fn) => {
      m.look = fn;
    },
  };
  return m;
}

function run(g: ChatGroup, ms: Fake[], seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds; t += 0.05) {
    for (const m of ms) m.talking = Math.max(0, m.talking - 0.05);
    g.update(0.05);
    each?.();
  }
}

test('everyone gets a turn and only one main speaker talks at a time', () => {
  const ms = [member('a', 0, 0), member('b', 1, 0), member('c', 0.5, 1)];
  const g = new ChatGroup('t', ms);
  let overlap = 0;
  run(g, ms, 120, () => {
    // A reaction can land just as a line ends; two full lines never overlap.
    if (ms.filter((m) => m.talking > 1.2).length > 1) overlap++;
  });
  for (const m of ms) assert.ok(m.lines >= 4, `${m.id} spoke ${m.lines} times`);
  assert.equal(overlap, 0);
});

test('listeners look at the speaker', () => {
  const ms = [member('a', 0, 0), member('b', 1, 0)];
  const g = new ChatGroup('look', ms);
  run(g, ms, 3);
  let checked = 0;
  run(g, ms, 20, () => {
    const s = ms.find((m) => m.id === g.speaking);
    if (!s) return;
    const other = ms.find((m) => m !== s)!;
    const at = other.look?.();
    assert.ok(at && Math.abs(at.x - s.pos.x) < 1e-6 && Math.abs(at.z - s.pos.z) < 1e-6, `${other.id} looks at ${s.id}`);
    checked++;
  });
  assert.ok(checked > 20);
});

test('a member who walks off or is taken by a sequence drops out; alone, the group falls silent', () => {
  const ms = [member('a', 0, 0), member('b', 1, 0), member('c', 0.5, 1)];
  const g = new ChatGroup('drop', ms);
  run(g, ms, 5);
  ms[2]!.free = false; // held by a sequence
  run(g, ms, 0.1);
  assert.deepEqual([...g.engaged].sort(), ['a', 'b']);
  assert.equal(ms[2]!.look, null);
  const before = ms[2]!.lines;
  run(g, ms, 30);
  assert.equal(ms[2]!.lines, before, 'c never speaks while held');
  ms[1]!.pos = { x: 10, z: 0 }; // walked away
  run(g, ms, 0.1);
  assert.ok(g.engaged.length < 2 || !g.engaged.includes('b') || !g.engaged.includes('a'));
  run(g, ms, 0.1);
  assert.equal(g.speaking, null, 'nobody to talk to');
  const lines = ms[0]!.lines + ms[1]!.lines;
  run(g, ms, 20);
  assert.equal(ms[0]!.lines + ms[1]!.lines, lines);
  assert.ok(CHAT_TUNING.reach < 10);
});

test('the same seed plays the same conversation after a reset', () => {
  const ms = [member('a', 0, 0), member('b', 1, 0)];
  const g = new ChatGroup('seed', ms);
  const order = (): string[] => {
    const seen: string[] = [];
    run(g, ms, 40, () => {
      if (g.speaking && seen[seen.length - 1] !== g.speaking) seen.push(g.speaking);
    });
    return seen;
  };
  const first = order();
  g.reset();
  for (const m of ms) m.talking = 0;
  assert.deepEqual(order(), first);
});
