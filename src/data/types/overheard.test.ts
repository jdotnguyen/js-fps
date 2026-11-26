import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { npcIdForSpeaker } from '../../ai/speakerBodies.ts';
import { validate } from '../../core/validate.ts';
import { validateChapter } from './dialogue.ts';
import { validateOverheard } from './overheard.ts';
import { readLevel } from '../levels/readLevel.ts';

const json = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const data = validate(validateOverheard, json('../overheard.json'), 'data/overheard.json');
const commonsChapter = validate(validateChapter, json('../dialogue/commons_overheard.json'), 'commons_overheard');
const stationChapter = validate(validateChapter, json('../dialogue/station_overheard.json'), 'station_overheard');
const allLines = [...commonsChapter.lines, ...stationChapter.lines];
const lines = new Map(allLines.map((l) => [l.id, l]));
const level = readLevel('slice01') as { rooms: Array<{ id: string; npcs?: Array<{ id: string; chat?: string }> }> };
const roomNpcs = (roomId: string) => level.rooms.find((r) => r.id === roomId)?.npcs ?? [];

test('every exchange names real lines, a real chat group or solo speaker in its room, and valid speakers', () => {
  for (const x of data.exchanges) {
    const room = x.room ?? data.room;
    const crew = roomNpcs(room);
    if (x.chat) {
      const members = crew.filter((n) => n.chat === x.chat).map((n) => n.id);
      assert.ok(members.length >= 2, `${x.id}: "${x.chat}" has at least 2 members in ${room}`);
      const speakers = new Set<string>();
      for (const id of x.lines) {
        const line = lines.get(id);
        assert.ok(line, `${x.id}: unknown line ${id}`);
        const npc = npcIdForSpeaker(line.speaker);
        assert.ok(npc && members.includes(npc), `${id}: ${line.speaker} (${npc}) is not in ${x.chat}`);
        speakers.add(npc);
      }
      assert.ok(speakers.size >= 2, `${x.id}: at least two members speak`);
    } else {
      assert.ok(x.speaker, `${x.id}: solo snippet names a speaker`);
      assert.ok(crew.some((n) => n.id === x.speaker), `${x.id}: solo speaker "${x.speaker}" is in ${room}`);
      for (const id of x.lines) {
        const line = lines.get(id);
        assert.ok(line, `${x.id}: unknown line ${id}`);
        assert.equal(npcIdForSpeaker(line.speaker), x.speaker, `${id}: ${line.speaker} maps to ${x.speaker}`);
      }
    }
  }
});

test('each Commons pair keeps its 1-before/2-after cadence, and no overheard line is spare or reused', () => {
  const count = (chat: string, phase: string): number => data.exchanges.filter((x) => x.chat === chat && x.phase === phase).length;
  for (const chat of ['commons_bar', 'commons_wall']) {
    assert.equal(count(chat, 'before'), 1, chat);
    assert.equal(count(chat, 'after'), 2, chat);
  }
  const used = data.exchanges.flatMap((x) => x.lines);
  assert.deepEqual([...used].sort(), [...lines.keys()].sort());
});

test('overheard lines are local background lines with their own recording path, and Jay says none', () => {
  assert.equal(commonsChapter.lines.length, 24);
  assert.ok(stationChapter.lines.length >= 40);
  for (const l of commonsChapter.lines) assert.equal(l.audio, `assets/vo/${l.id}.mp3`, l.id);
  for (const l of allLines) {
    assert.equal(l.channel, 'local', l.id);
    assert.equal(l.priority, 'background', l.id);
    if (l.audio !== null) assert.equal(l.audio, `assets/vo/${l.id}.mp3`, l.id);
    assert.notEqual(l.speaker, 'player', l.id);
  }
});

test('the validator rejects duplicate ids, empty exchanges, and missing or ambiguous chat/speaker', () => {
  const x = { id: 'a', chat: 'c', phase: 'before', lines: ['l'] };
  assert.throws(() => validate(validateOverheard, { room: 'R02', exchanges: [x, x] }, 't'), /duplicate exchange id/);
  assert.throws(() => validate(validateOverheard, { room: 'R02', exchanges: [{ ...x, lines: [] }] }, 't'), /at least one line/);
  assert.throws(() => validate(validateOverheard, { room: 'R02', exchanges: [{ id: 'b', lines: ['l'] }] }, 't'), /exactly one of "chat" or "speaker"/);
  assert.throws(() => validate(validateOverheard, { room: 'R02', exchanges: [{ id: 'c', chat: 'g', speaker: 's', lines: ['l'] }] }, 't'), /exactly one of "chat" or "speaker"/);
});
