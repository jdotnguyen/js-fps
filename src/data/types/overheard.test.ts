import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { npcIdForSpeaker } from '../../ai/speakerBodies.ts';
import { validate } from '../../core/validate.ts';
import { validateChapter } from './dialogue.ts';
import { validateOverheard } from './overheard.ts';

const json = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const data = validate(validateOverheard, json('../overheard.json'), 'data/overheard.json');
const chapter = validate(validateChapter, json('../dialogue/commons_overheard.json'), 'commons_overheard');
const lines = new Map(chapter.lines.map((l) => [l.id, l]));
const level = json('../levels/slice01.json') as { rooms: Array<{ id: string; npcs?: Array<{ id: string; chat?: string }> }> };
const crew = level.rooms.find((r) => r.id === data.room)?.npcs ?? [];

test('every exchange names real lines, a real chat group of its room, and speakers who are in that group', () => {
  for (const x of data.exchanges) {
    const members = crew.filter((n) => n.chat === x.chat).map((n) => n.id);
    assert.equal(members.length, 2, `${x.id}: "${x.chat}" is a pair in ${data.room}`);
    const speakers = new Set<string>();
    for (const id of x.lines) {
      const line = lines.get(id);
      assert.ok(line, `${x.id}: unknown line ${id}`);
      const npc = npcIdForSpeaker(line.speaker);
      assert.ok(npc && members.includes(npc), `${id}: ${line.speaker} is not in ${x.chat}`);
      speakers.add(npc);
    }
    assert.equal(speakers.size, 2, `${x.id}: both of them speak`);
  }
});

test('each pair has one exchange before the briefing and two after it, and no line is spare or reused', () => {
  const count = (chat: string, phase: string): number => data.exchanges.filter((x) => x.chat === chat && x.phase === phase).length;
  for (const chat of ['commons_bar', 'commons_wall']) {
    assert.equal(count(chat, 'before'), 1, chat);
    assert.equal(count(chat, 'after'), 2, chat);
  }
  const used = data.exchanges.flatMap((x) => x.lines);
  assert.deepEqual([...used].sort(), [...lines.keys()].sort());
});

test('overheard lines are local background lines with their own recording path, and Jay says none', () => {
  assert.equal(chapter.lines.length, 24);
  for (const l of chapter.lines) {
    assert.equal(l.channel, 'local', l.id);
    assert.equal(l.priority, 'background', l.id);
    assert.equal(l.audio, `assets/vo/${l.id}.mp3`, l.id);
    assert.notEqual(l.speaker, 'player', l.id);
  }
});

test('the validator rejects a duplicate id and an empty exchange', () => {
  const x = { id: 'a', chat: 'c', phase: 'before', lines: ['l'] };
  assert.throws(() => validate(validateOverheard, { room: 'R02', exchanges: [x, x] }, 't'), /duplicate exchange id/);
  assert.throws(() => validate(validateOverheard, { room: 'R02', exchanges: [{ ...x, lines: [] }] }, 't'), /at least one line/);
});
