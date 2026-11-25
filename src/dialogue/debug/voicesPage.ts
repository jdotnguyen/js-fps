/**
 * Debug page: audition every recorded VO clip grouped by character (dialogue lines, reaction
 * variant takes, SFX vocals, unreferenced files in public/assets/vo/, and infected vocals),
 * plus procedural emote fallback synth and SpeechManager scenario tests.
 * Dev only: open /voices.html while `npm run dev` is running.
 */
import { voFiles, zombieFiles } from 'virtual:vo-files';
import { AudioEngine } from '../../audio/engine.ts';
import { EventBus } from '../../core/events.ts';
import { EMOTES, type Channel, type DialogueLine, type Emote } from '../../data/types/dialogue.ts';
import { DialogueLibrary } from '../library.ts';
import { SpeechManager, type VoicePlayback } from '../speech.ts';
import { renderUtterance } from '../vocalSynth.ts';
import { WebAudioVoicePlayer } from '../voicePlayer.ts';
import { buildVoCatalog, filterCatalog, type CharacterGroup, type VoEntry, type VoFilter } from './voCatalog.ts';

type ChannelMode = 'default' | 'dry' | Channel;

const css = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0a0e11; color: #cfd8dc; font: 13px/1.45 ui-monospace, Menlo, Consolas, monospace; }
  #app { max-width: 1240px; margin: 0 auto; padding: 18px 20px 48px; }
  header.top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 12px; }
  h1 { font-size: 16px; letter-spacing: .09em; text-transform: uppercase; color: #8fd0e0; margin: 0; }
  h2 { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: #6d8a96; margin: 0; }
  .stats { color: #7c96a1; font-size: 12px; }
  .panel { background: #0f161b; border: 1px solid #1e2d35; border-radius: 4px; padding: 12px 14px; margin-bottom: 14px; }
  .sticky-player { position: sticky; top: 0; z-index: 20; background: rgba(11, 17, 21, 0.96); backdrop-filter: blur(6px); border-color: #29414d; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45); }
  .row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  .row + .row { margin-top: 8px; }
  label { display: inline-flex; gap: 6px; align-items: center; color: #9eb3bc; }
  input[type=text], input[type=search], select {
    background: #121c22; color: #dce6ea; border: 1px solid #263942; border-radius: 3px;
    padding: 5px 8px; font: inherit;
  }
  input[type=search] { min-width: 240px; flex: 1 1 240px; }
  input:focus, select:focus { outline: none; border-color: #6aa6b8; }
  button {
    background: #14222a; color: #cfd8dc; border: 1px solid #283d47; border-radius: 3px;
    padding: 4px 9px; cursor: pointer; font: inherit; transition: border-color .12s, background .12s;
  }
  button:hover { border-color: #5d8da0; background: #1a2d37; }
  button.active, button.on { background: #1d434f; border-color: #6ad4a4; color: #e9fff5; }
  button.danger { border-color: #6b3438; color: #e6a8ad; }
  button.danger:hover { border-color: #b5545c; background: #2c171a; }
  button.small { padding: 2px 7px; font-size: 11px; }

  #now-playing { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 8px; }
  #now-meta { color: #8fb3c0; font-size: 12px; }
  #now-meta strong { color: #d9edf4; }
  #now-meta .clip-file { color: #6ad4a4; margin-left: 6px; }
  #subtitle {
    min-height: 40px; padding: 8px 12px; background: rgba(0, 0, 0, .5);
    border-left: 3px solid #6aa6b8; font: 15px/1.35 system-ui, -apple-system, sans-serif; color: #eef5f7;
    margin-bottom: 8px;
  }
  #subtitle.empty { color: #566a73; font-style: italic; font-size: 13px; }
  #subtitle .name { color: #8fd0e0; margin-right: 8px; font-weight: 600; }
  #subtitle.radio .name::after { content: ' [radio]'; color: #7da5b3; font-weight: normal; font-size: 12px; }
  #subtitle.pa .name::after { content: ' [PA]'; color: #d8b56c; font-weight: normal; font-size: 12px; }
  #subtitle.dry .name::after { content: ' [dry]'; color: #6ad4a4; font-weight: normal; font-size: 12px; }
  canvas#wave { display: block; background: #080e11; border: 1px solid #1b282f; width: 100%; height: 64px; border-radius: 2px; }

  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .chip {
    background: #111b21; border: 1px solid #22343d; color: #a7bdc6; padding: 3px 8px;
    border-radius: 12px; font-size: 12px; display: inline-flex; gap: 5px; align-items: center;
  }
  .chip .cnt { color: #67828d; font-size: 11px; }
  .chip.active { background: #1c3b47; border-color: #6aa6b8; color: #eaf6fa; }
  .chip.active .cnt { color: #9fd5e5; }

  details.char-group {
    background: #0d1418; border: 1px solid #1d2c34; border-radius: 4px; margin-bottom: 10px; overflow: hidden;
  }
  details.char-group > summary {
    list-style: none; cursor: pointer; padding: 9px 12px; background: #121c22;
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;
    user-select: none;
  }
  details.char-group > summary::-webkit-details-marker { display: none; }
  details.char-group[open] > summary { border-bottom: 1px solid #1d2c34; }
  .char-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
  .char-caret { color: #6aa6b8; display: inline-block; width: 12px; transition: transform .12s; }
  details.char-group[open] .char-caret { transform: rotate(90deg); }
  .char-name { font-size: 14px; font-weight: 700; color: #e2f1f6; }
  .char-id { color: #6d8a96; font-size: 12px; }
  .char-role { color: #8da4ae; font-size: 12px; }
  .char-cast { color: #6ad4a4; font-size: 11px; background: #10261f; border: 1px solid #235743; padding: 1px 6px; border-radius: 3px; }
  .char-actions { display: flex; align-items: center; gap: 8px; }
  .char-counts { color: #7c96a1; font-size: 12px; }

  .entry-list { display: flex; flex-direction: column; }
  .entry {
    display: grid; grid-template-columns: 34px minmax(175px, 240px) 1fr auto; gap: 10px;
    align-items: start; padding: 7px 12px; border-bottom: 1px solid #141f25;
  }
  .entry:last-child { border-bottom: none; }
  .entry:hover { background: #111b21; }
  .entry.playing { background: #132a27; }
  .entry-play { width: 30px; height: 26px; padding: 0; display: grid; place-items: center; }
  .entry-id-col { min-width: 0; }
  .entry-id { color: #cfe2e9; font-weight: 600; word-break: break-word; }
  .badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
  .badge {
    font-size: 10px; padding: 1px 5px; border-radius: 2px; border: 1px solid #253841; color: #89a5b0; background: #10191f;
  }
  .badge.ch-radio { border-color: #365e73; color: #8fd0e0; background: #10232d; }
  .badge.ch-pa { border-color: #6b582c; color: #e2c070; background: #221d10; }
  .badge.src-sfx { border-color: #4f4678; color: #bfb4f0; background: #1b172c; }
  .badge.src-unreferenced { border-color: #6e452b; color: #e2a57a; background: #261910; }
  .badge.prio-story { color: #9fc7d6; }
  .badge.prio-combat { color: #d89b79; }
  .badge.emote { color: #7fa39c; }

  .entry-text { font: 13px/1.4 system-ui, -apple-system, sans-serif; color: #d9e3e8; min-width: 0; }
  .entry-dir { font: italic 11.5px/1.35 system-ui, -apple-system, sans-serif; color: #748b95; margin-top: 2px; }
  .entry-clips { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; align-items: center; }
  .clip-name { color: #5f7883; font-size: 11px; }

  details.tool-section { background: #0d1418; border: 1px solid #1d2c34; border-radius: 4px; margin-top: 16px; }
  details.tool-section > summary {
    cursor: pointer; padding: 10px 14px; background: #111b20; color: #8fb3c0;
    font-size: 12px; letter-spacing: .09em; text-transform: uppercase; user-select: none;
  }
  details.tool-section[open] > summary { border-bottom: 1px solid #1d2c34; }
  .tool-body { padding: 12px 14px; overflow-x: auto; }
  table.emote-grid { border-collapse: collapse; }
  table.emote-grid th { text-align: left; font-weight: normal; color: #7c96a1; padding: 3px 8px 3px 0; white-space: nowrap; font-size: 11px; }
  table.emote-grid td { padding: 2px; text-align: center; }
  #log { height: 150px; overflow: auto; background: #080e11; border: 1px solid #1b282f; padding: 6px 8px; white-space: pre; color: #9fb0b6; margin-top: 8px; }
  .empty-state { padding: 24px; text-align: center; color: #7c96a1; background: #0d1418; border: 1px solid #1d2c34; border-radius: 4px; }

  @media (max-width: 780px) {
    .entry { grid-template-columns: 32px 1fr; }
    .entry-text, .entry-clips { grid-column: 2; justify-content: flex-start; }
  }
`;

// ------------------------------------------------------------------ data boot

const dialogueModules = import.meta.glob<unknown>('../../data/dialogue/*.json', { eager: true, import: 'default' });
const rawChapters: Record<string, unknown> = {};
let rawSpeakers: unknown;
for (const [path, data] of Object.entries(dialogueModules)) {
  const name = path.replace('../../', '');
  if (name.endsWith('/speakers.json')) rawSpeakers = data;
  else if (!name.endsWith('/ui.json')) rawChapters[name] = data;
}
const library = new DialogueLibrary(rawSpeakers, rawChapters);
const catalog = buildVoCatalog(rawChapters, library, voFiles, zombieFiles);

const engine = new AudioEngine();
const player = new WebAudioVoicePlayer({ ctx: engine.ctx, master: engine.buses.voice, reverbIn: engine.voiceReverbIn });
const bus = new EventBus();
const speech = new SpeechManager(bus, library, player);

// ------------------------------------------------------------------ shell DOM

const app = document.getElementById('app')!;
document.head.append(Object.assign(document.createElement('style'), { textContent: css }));
app.innerHTML = `
  <header class="top">
    <h1>Thalassa — Voice &amp; VO Audition</h1>
    <div class="stats" id="catalog-stats"></div>
  </header>

  <section class="panel sticky-player">
    <div id="now-playing">
      <div id="now-meta">Click any line or clip to audition. Audio unlocks automatically on first click.</div>
      <div class="row">
        <button id="btn-stop" class="danger">■ Stop</button>
      </div>
    </div>
    <div id="subtitle" class="empty">Nothing playing</div>
    <canvas id="wave" width="1200" height="64"></canvas>
    <div class="row" style="margin-top: 8px;">
      <label>Channel
        <select id="channel">
          <option value="default">line default (authored)</option>
          <option value="dry">dry (raw MP3)</option>
          <option value="local">force local (positional)</option>
          <option value="radio">force radio</option>
          <option value="pa">force wall speaker (PA)</option>
        </select>
      </label>
      <label>Position <input id="pos" type="range" min="-4" max="4" step="0.5" value="0" /> <span id="posv">centre</span></label>
      <label>Giles rasp <input id="rasp" type="range" min="0" max="1" step="0.05" value="0" /> <span id="raspv">0.00</span></label>
    </div>
  </section>

  <section class="panel">
    <div class="row">
      <input id="search" type="search" placeholder="Search line ID, transcript, character, filename, cast voice…" />
      <label>Source
        <select id="filter-chapter">
          <option value="all">All sources</option>
        </select>
      </label>
      <label>Channel
        <select id="filter-channel">
          <option value="all">All channels</option>
          <option value="local">local</option>
          <option value="radio">radio</option>
          <option value="pa">pa</option>
        </select>
      </label>
      <button id="btn-expand-all" class="small">Expand all</button>
      <button id="btn-collapse-all" class="small">Collapse all</button>
    </div>
    <div class="chips" id="char-chips"></div>
  </section>

  <div id="groups"></div>

  <details class="tool-section" id="sec-emotes">
    <summary>Procedural Emote Synth (fallback voices — all ${library.speakerIds().length} authored profiles)</summary>
    <div class="tool-body">
      <div class="row" style="margin-bottom: 10px;">
        <label><input id="vary" type="checkbox" /> new seed each click</label>
        <label><input id="babble" type="checkbox" /> babble</label>
        <input id="btext" type="text" value="Cover me, I'll get this open! Ready?" style="width: 300px;" />
      </div>
      <table class="emote-grid" id="grid"></table>
    </div>
  </details>

  <details class="tool-section" id="sec-speech">
    <summary>Speech Manager Scenarios &amp; Event Log</summary>
    <div class="tool-body">
      <div class="row">
        <button id="sc-interrupt">Story interrupts combat</button>
        <button id="sc-drop">Stale bark is dropped</button>
        <button id="sc-queue">Equal priority queues</button>
        <button id="sc-stop">Stop all</button>
      </div>
      <div id="log"></div>
    </div>
  </details>
`;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// Populate chapter filter dropdown.
const chapterSelect = $<HTMLSelectElement>('filter-chapter');
for (const ch of catalog.chapters) {
  const opt = document.createElement('option');
  opt.value = ch;
  opt.textContent = ch;
  chapterSelect.append(opt);
}

// ------------------------------------------------------------------ state & helpers

const filter: { query: string; chapter: string; channel: string; speaker: string } = {
  query: '',
  chapter: 'all',
  channel: 'all',
  speaker: 'all',
};

const openGroups = new Set<string>(catalog.groups.map((g) => g.speaker));
const channelMode = (): ChannelMode => $<HTMLSelectElement>('channel').value as ChannelMode;
const pos = (): number => Number($<HTMLInputElement>('pos').value);
const rasp = (): number => Number($<HTMLInputElement>('rasp').value);
const at = (): { x: number; y: number; z: number } => ({ x: pos(), y: 0, z: -2 });

$('pos').addEventListener('input', () => {
  $('posv').textContent = pos() === 0 ? 'centre' : `${pos() < 0 ? 'left' : 'right'} ${Math.abs(pos())} m`;
});
$('rasp').addEventListener('input', () => {
  $('raspv').textContent = rasp().toFixed(2);
  speech.setRasp('engineer', rasp() > 0 ? rasp() : null);
});
$<HTMLInputElement>('babble').addEventListener('change', (e) => {
  speech.babble = (e.target as HTMLInputElement).checked;
});

// Active audition handle.
interface ActiveAudition {
  key: string;
  stop: () => void;
}
let activeAudition: ActiveAudition | null = null;
let sequenceToken = 0;
let activeSequenceSpeaker: string | null = null;
const entryElements = new Map<string, HTMLElement>();
const playAllButtons = new Map<string, HTMLButtonElement>();

function setSubtitle(name: string, text: string, cssClass: string): void {
  const sub = $('subtitle');
  sub.className = cssClass;
  sub.innerHTML = '';
  sub.append(Object.assign(document.createElement('span'), { className: 'name', textContent: name }), document.createTextNode(text));
}

function clearSubtitle(): void {
  const sub = $('subtitle');
  sub.className = 'empty';
  sub.textContent = 'Nothing playing';
}

function drawWave(data: Float32Array, label: string, durationS: number): void {
  const c = $<HTMLCanvasElement>('wave');
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  g.strokeStyle = '#6aa6b8';
  g.beginPath();
  const mid = c.height / 2;
  const per = Math.max(1, data.length / c.width);
  for (let x = 0; x < c.width; x++) {
    let lo = 0;
    let hi = 0;
    const start = Math.floor(x * per);
    const end = Math.min(data.length, Math.floor((x + 1) * per));
    for (let i = start; i < end; i++) {
      const v = data[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    g.moveTo(x + 0.5, mid - hi * (mid - 4));
    g.lineTo(x + 0.5, mid - lo * (mid - 4) + 1);
  }
  g.stroke();
  g.fillStyle = '#89a5b0';
  g.font = '11px ui-monospace, Menlo, monospace';
  g.fillText(`${label}  (${durationS.toFixed(2)} s)`, 8, 13);
}

function updateHighlight(playingKey: string | null): void {
  for (const [k, el] of entryElements) {
    const isPlaying = k === playingKey;
    el.classList.toggle('playing', isPlaying);
    const btn = el.querySelector<HTMLButtonElement>('.entry-play');
    if (btn) {
      btn.textContent = isPlaying ? '■' : '▶';
      btn.classList.toggle('active', isPlaying);
    }
  }
  for (const [sp, btn] of playAllButtons) {
    const active = sp === activeSequenceSpeaker;
    btn.textContent = active ? '■ Stop group' : '▶ Play all';
    btn.classList.toggle('active', active);
  }
}

function stopAudition(cancelSequence = true): void {
  if (cancelSequence) {
    sequenceToken++;
    activeSequenceSpeaker = null;
  }
  if (activeAudition) {
    const cur = activeAudition;
    activeAudition = null;
    cur.stop();
  }
  speech.stopAll();
  updateHighlight(null);
  clearSubtitle();
  $('now-meta').textContent = 'Stopped.';
}

$('btn-stop').addEventListener('click', () => stopAudition(true));

async function playVoEntry(entry: VoEntry, clipUrl: string, fromSequence = false): Promise<void> {
  const key = `${entry.speaker}:${entry.id}`;
  if (!fromSequence && activeAudition?.key === key && activeSequenceSpeaker === null) {
    stopAudition(true);
    return;
  }
  stopAudition(!fromSequence);
  const mySeq = sequenceToken;

  await engine.resume();
  const mode = channelMode();
  const effectiveChannel: Channel = mode === 'default' || mode === 'dry' ? entry.channel : mode;
  const playLine: DialogueLine = {
    id: entry.id,
    speaker: entry.speaker,
    text: entry.text,
    emote: entry.emote,
    channel: effectiveChannel,
    priority: entry.priority,
    audio: clipUrl,
    minDuration: entry.line?.minDuration ?? 0,
    ...(entry.line?.paChime !== undefined ? { paChime: entry.line.paChime } : {}),
    ...(entry.line?.gain !== undefined ? { gain: entry.line.gain } : {}),
    choices: [],
  };

  $('now-meta').innerHTML = `Loading <strong>${escapeHtml(entry.id)}</strong>…`;
  await player.loadLines([playLine], { concurrency: 1, idle: false });
  if (mySeq !== sequenceToken) return;

  const buf = player.recordedBuffer(clipUrl);
  const fileName = clipUrl.split('/').pop() ?? clipUrl;
  const group = catalog.groups.find((g) => g.speaker === entry.speaker);
  const speakerLabel = group ? group.displayName : entry.speaker;

  setSubtitle(speakerLabel, entry.text, mode === 'dry' ? 'dry' : effectiveChannel);

  if (buf) {
    drawWave(buf.getChannelData(0), `${speakerLabel} / ${entry.id} — ${fileName}`, buf.duration);
    $('now-meta').innerHTML = `Playing <strong>${escapeHtml(speakerLabel)}</strong> · ${escapeHtml(entry.id)} <span class="clip-file">${escapeHtml(fileName)}</span> · ${buf.duration.toFixed(2)} s · ${mode === 'dry' ? 'dry' : effectiveChannel}`;
  } else {
    $('now-meta').innerHTML = `Playing (fallback synth — clip failed to load) <strong>${escapeHtml(entry.id)}</strong>`;
  }

  return new Promise<void>((resolve) => {
    let finished = false;
    const done = (): void => {
      if (finished) return;
      finished = true;
      if (activeAudition?.key === key) {
        activeAudition = null;
        updateHighlight(null);
      }
      resolve();
    };

    if (mode === 'dry' && buf) {
      const src = new AudioBufferSourceNode(engine.ctx, { buffer: buf });
      src.connect(engine.buses.voice);
      src.onended = () => {
        src.disconnect();
        done();
      };
      src.start();
      activeAudition = {
        key,
        stop: () => {
          src.onended = null;
          try {
            src.stop();
          } catch {
            /* already ended */
          }
          src.disconnect();
          done();
        },
      };
      updateHighlight(key);
      return;
    }

    const profile = library.hasSpeaker(entry.speaker) ? library.speaker(entry.speaker) : library.speaker('crew');
    const r = entry.speaker === 'engineer' && rasp() > 0 ? rasp() : null;
    const needsPos = effectiveChannel === 'pa' || (effectiveChannel === 'local' && pos() !== 0);
    const pb: VoicePlayback = player.play({
      line: playLine,
      profile,
      at: needsPos ? at : undefined,
      rasp: r,
      babble: false,
    });
    const durMs = ((pb.duration ?? buf?.duration ?? 1.5) + 0.12) * 1000;
    const timer = window.setTimeout(() => {
      pb.stop(false);
      done();
    }, durMs);
    activeAudition = {
      key,
      stop: () => {
        window.clearTimeout(timer);
        pb.stop(true);
        done();
      },
    };
    updateHighlight(key);
  });
}

async function playGroupSequence(group: CharacterGroup): Promise<void> {
  if (activeSequenceSpeaker === group.speaker) {
    stopAudition(true);
    return;
  }
  stopAudition(true);
  const mySeq = ++sequenceToken;
  activeSequenceSpeaker = group.speaker;
  updateHighlight(null);

  for (const entry of group.entries) {
    if (mySeq !== sequenceToken) break;
    const clip = entry.clips[0];
    if (!clip) continue;
    await playVoEntry(entry, clip, true);
    if (mySeq !== sequenceToken) break;
    await new Promise<void>((r) => window.setTimeout(r, 320));
  }
  if (mySeq === sequenceToken) {
    activeSequenceSpeaker = null;
    updateHighlight(null);
    $('now-meta').textContent = `Finished playing ${group.displayName} (${group.entries.length} entries).`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ------------------------------------------------------------------ render catalog

function renderChips(): void {
  const wrap = $('char-chips');
  wrap.innerHTML = '';

  const allChip = document.createElement('button');
  allChip.className = `chip${filter.speaker === 'all' ? ' active' : ''}`;
  allChip.innerHTML = `All characters <span class="cnt">${catalog.groups.length}</span>`;
  allChip.addEventListener('click', () => {
    filter.speaker = 'all';
    render();
  });
  wrap.append(allChip);

  for (const g of catalog.groups) {
    const btn = document.createElement('button');
    btn.className = `chip${filter.speaker === g.speaker ? ' active' : ''}`;
    btn.title = `${g.displayName} (${g.speaker}) — ${g.entries.length} entries, ${g.totalUniqueClips} unique clips`;
    btn.innerHTML = `${escapeHtml(g.displayName)} <span class="cnt">${g.entries.length}</span>`;
    btn.addEventListener('click', () => {
      filter.speaker = filter.speaker === g.speaker ? 'all' : g.speaker;
      openGroups.add(g.speaker);
      render();
    });
    wrap.append(btn);
  }
}

function render(): void {
  renderChips();
  const visible = filterCatalog(catalog.groups, filter as VoFilter);
  const visibleEntries = visible.reduce((n, g) => n + g.entries.length, 0);
  const visibleClips = new Set(visible.flatMap((g) => g.entries.flatMap((e) => e.clips))).size;

  const isFiltered = filter.query !== '' || filter.chapter !== 'all' || filter.channel !== 'all' || filter.speaker !== 'all';
  $('catalog-stats').textContent = isFiltered
    ? `Showing ${visibleEntries} / ${catalog.totalEntries} entries (${visibleClips} / ${catalog.totalUniqueClips} clips) across ${visible.length} characters`
    : `${catalog.totalDialogueLines} dialogue lines + ${catalog.totalExtraClips} extra/SFX clips · ${catalog.totalUniqueClips} unique MP3 files · ${catalog.groups.length} characters`;

  const container = $('groups');
  container.innerHTML = '';
  entryElements.clear();
  playAllButtons.clear();

  if (visible.length === 0) {
    container.innerHTML = '<div class="empty-state">No VO entries match the current filter.</div>';
    return;
  }

  for (const g of visible) {
    const details = document.createElement('details');
    details.className = 'char-group';
    details.open = openGroups.has(g.speaker) || isFiltered;
    details.addEventListener('toggle', () => {
      if (details.open) openGroups.add(g.speaker);
      else openGroups.delete(g.speaker);
    });

    const summary = document.createElement('summary');
    const title = document.createElement('div');
    title.className = 'char-title';
    const subNote = g.subtitleName !== g.displayName ? ` · sub: ${g.subtitleName}` : '';
    title.innerHTML = `
      <span class="char-caret">▸</span>
      <span class="char-name">${escapeHtml(g.displayName)}</span>
      <span class="char-id">${escapeHtml(g.speaker)}${escapeHtml(subNote)}</span>
      <span class="char-role">— ${escapeHtml(g.role)}</span>
      ${g.castNote ? `<span class="char-cast">${escapeHtml(g.castNote)}</span>` : ''}
    `;

    const actions = document.createElement('div');
    actions.className = 'char-actions';
    const counts = document.createElement('span');
    counts.className = 'char-counts';
    counts.textContent = `${g.entries.length} ${g.entries.length === 1 ? 'entry' : 'entries'} · ${g.totalUniqueClips} ${g.totalUniqueClips === 1 ? 'clip' : 'clips'}`;

    const playAll = document.createElement('button');
    playAll.className = 'small';
    playAll.textContent = activeSequenceSpeaker === g.speaker ? '■ Stop group' : '▶ Play all';
    if (activeSequenceSpeaker === g.speaker) playAll.classList.add('active');
    playAll.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void playGroupSequence(g);
    });
    playAllButtons.set(g.speaker, playAll);

    actions.append(counts, playAll);
    summary.append(title, actions);
    details.append(summary);

    const list = document.createElement('div');
    list.className = 'entry-list';

    for (const e of g.entries) {
      const row = document.createElement('div');
      row.className = 'entry';
      const key = `${e.speaker}:${e.id}`;
      entryElements.set(key, row);

      const playBtn = document.createElement('button');
      playBtn.className = 'entry-play';
      playBtn.textContent = '▶';
      playBtn.title = e.clips.length > 0 ? `Play ${e.clips[0]}` : `Play ${e.id}`;
      playBtn.addEventListener('click', () => {
        const clip = e.clips[0];
        if (clip) void playVoEntry(e, clip);
      });

      const idCol = document.createElement('div');
      idCol.className = 'entry-id-col';
      const badges: string[] = [];
      badges.push(`<span class="badge ch-${e.channel}">${e.channel}</span>`);
      const srcClass = e.sourceKind === 'sfx' ? ' src-sfx' : e.sourceKind === 'unreferenced' ? ' src-unreferenced' : '';
      badges.push(`<span class="badge${srcClass}">${escapeHtml(e.chapter)}</span>`);
      if (e.sourceKind === 'dialogue') {
        badges.push(`<span class="badge prio-${e.priority}">${e.priority}</span>`);
      }
      if (e.emote) badges.push(`<span class="badge emote">${e.emote}</span>`);
      idCol.innerHTML = `<div class="entry-id">${escapeHtml(e.id)}</div><div class="badges">${badges.join('')}</div>`;

      const textCol = document.createElement('div');
      textCol.className = 'entry-text';
      textCol.innerHTML = `${escapeHtml(e.text)}${e.direction ? `<div class="entry-dir">${escapeHtml(e.direction)}</div>` : ''}`;

      const clipsCol = document.createElement('div');
      clipsCol.className = 'entry-clips';
      if (e.clips.length > 1) {
        e.clips.forEach((clipUrl, idx) => {
          const fname = clipUrl.split('/').pop() ?? clipUrl;
          const vBtn = document.createElement('button');
          vBtn.className = 'small';
          vBtn.textContent = `#${idx + 1}`;
          vBtn.title = fname;
          vBtn.addEventListener('click', () => void playVoEntry(e, clipUrl));
          clipsCol.append(vBtn);
        });
      } else if (e.clips.length === 1) {
        const fname = e.clips[0]!.split('/').pop() ?? e.clips[0]!;
        if (fname !== `${e.id}.mp3`) {
          const span = document.createElement('span');
          span.className = 'clip-name';
          span.textContent = fname;
          clipsCol.append(span);
        }
      }

      row.append(playBtn, idCol, textCol, clipsCol);
      list.append(row);
    }

    details.append(list);
    container.append(details);
  }
  updateHighlight(activeAudition?.key ?? null);
}

// Filter listeners.
$<HTMLInputElement>('search').addEventListener('input', (ev) => {
  filter.query = (ev.target as HTMLInputElement).value;
  render();
});
chapterSelect.addEventListener('change', (ev) => {
  filter.chapter = (ev.target as HTMLSelectElement).value;
  render();
});
$<HTMLSelectElement>('filter-channel').addEventListener('change', (ev) => {
  filter.channel = (ev.target as HTMLSelectElement).value;
  render();
});
$('btn-expand-all').addEventListener('click', () => {
  for (const g of catalog.groups) openGroups.add(g.speaker);
  render();
});
$('btn-collapse-all').addEventListener('click', () => {
  openGroups.clear();
  render();
});

render();

// ------------------------------------------------------------------ procedural emote fallback grid

let clicks = 0;
const synthSpeakers = library.speakerIds().filter((id) => id !== 'pa');
const grid = $<HTMLTableElement>('grid');
grid.innerHTML = `<tr><th></th>${synthSpeakers.map((id) => `<th title="${escapeHtml(id)}">${escapeHtml(library.speaker(id).name)}</th>`).join('')}</tr>`;
for (const emote of EMOTES) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<th>${emote}</th>`;
  for (const speaker of synthSpeakers) {
    const td = document.createElement('td');
    const b = document.createElement('button');
    b.className = 'small';
    b.textContent = '▶';
    b.title = `${speaker} ${emote}`;
    b.addEventListener('click', () => void auditionSynth(speaker, emote));
    td.append(b);
    tr.append(td);
  }
  grid.append(tr);
}
const paRow = document.createElement('tr');
paRow.innerHTML = '<th>PA chime</th>';
const paTd = document.createElement('td');
const paBtn = Object.assign(document.createElement('button'), { className: 'small', textContent: '▶' });
paBtn.addEventListener('click', () => void auditionSynth('pa', 'neutral'));
paTd.append(paBtn);
paRow.append(paTd);
grid.append(paRow);

async function auditionSynth(speaker: string, emote: Emote): Promise<void> {
  stopAudition(true);
  await engine.resume();
  const vary = $<HTMLInputElement>('vary').checked;
  const id = `audition_${speaker}_${emote}${vary ? `_${clicks++}` : ''}`;
  const babble = $<HTMLInputElement>('babble').checked;
  const text = $<HTMLInputElement>('btext').value;
  const mode = channelMode();
  const synthChannel: Channel = mode === 'default' || mode === 'dry' ? (speaker === 'pa' ? 'pa' : 'local') : mode;
  const line: DialogueLine = { id, speaker, text, emote, channel: synthChannel, priority: 'story', audio: null, minDuration: 0, choices: [] };
  const profile = library.speaker(speaker);
  const r = speaker === 'engineer' && rasp() > 0 ? rasp() : null;
  const pb = player.play({ line, profile, at: synthChannel === 'pa' || pos() !== 0 ? at : undefined, rasp: r, babble });
  const data = renderUtterance(engine.ctx.sampleRate, profile, emote, id, { ...(r === null ? {} : { rasp: r }), ...(babble ? { babbleText: text } : {}) });
  const durS = data.length / engine.ctx.sampleRate;
  window.setTimeout(() => pb.stop(false), durMsFromSeconds(durS));
  drawWave(data, `synth: ${speaker} / ${babble ? 'babble' : emote}`, durS);
  setSubtitle(profile.name, babble ? text : `[synth emote: ${emote}]`, synthChannel);
  $('now-meta').innerHTML = `Synth fallback: <strong>${escapeHtml(profile.name)}</strong> · ${escapeHtml(emote)} · ${durS.toFixed(2)} s`;
}

function durMsFromSeconds(s: number): number {
  return s * 1000 + 150;
}

// ------------------------------------------------------------------ speech manager scenarios & log

const SCENARIO_IDS = [
  'okafor_spotted_01',
  'giles_cover_01',
  'pa_quarantine_01',
  'okafor_legs_01',
  'giles_panel_01',
  'okafor_quiet_01',
] as const;

let scenariosPreloaded = false;
async function ensureScenarioAudio(): Promise<void> {
  await engine.resume();
  if (scenariosPreloaded) return;
  scenariosPreloaded = true;
  const lines = SCENARIO_IDS.filter((id) => library.hasLine(id)).map((id) => library.line(id));
  const n = await player.loadLines(lines, { concurrency: 6, idle: false });
  if (n > 0) write(`loaded  ${n} scenario VO clip${n === 1 ? '' : 's'}`);
}

function say(id: string): void {
  const l = library.line(id);
  speech.say(id, l.channel === 'pa' || (l.channel === 'local' && pos() !== 0) ? { at } : {});
}

$('sc-interrupt').addEventListener('click', () => {
  void ensureScenarioAudio().then(() => {
    say('okafor_spotted_01');
    window.setTimeout(() => say('giles_cover_01'), 500);
  });
});
$('sc-drop').addEventListener('click', () => {
  void ensureScenarioAudio().then(() => {
    say('pa_quarantine_01');
    window.setTimeout(() => say('okafor_legs_01'), 300);
  });
});
$('sc-queue').addEventListener('click', () => {
  void ensureScenarioAudio().then(() => {
    say('giles_panel_01');
    say('okafor_quiet_01');
  });
});
$('sc-stop').addEventListener('click', () => stopAudition(true));

const log = $('log');
const t0 = performance.now();
const write = (s: string): void => {
  log.textContent += `${((performance.now() - t0) / 1000).toFixed(2).padStart(7)}  ${s}\n`;
  log.scrollTop = log.scrollHeight;
};
bus.on('speech:started', (e) => write(`start   ${e.id} (${e.priority}, ${e.duration.toFixed(2)} s)`));
bus.on('speech:ended', (e) => write(`end     ${e.id} ${e.reason}`));
bus.on('speech:dropped', (e) => write(`DROPPED ${e.id} after ${e.waited.toFixed(2)} s`));
bus.on('subtitle:show', (e) => setSubtitle(e.name, e.text, e.channel));
bus.on('subtitle:hide', () => {
  if (!activeAudition) clearSubtitle();
});

let last = performance.now();
const frame = (now: number): void => {
  speech.update(Math.min(0.1, (now - last) / 1000));
  last = now;
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
