/**
 * Debug page (ADR-0010 step 2-3): audition every emote for every voice, both channels,
 * babble and Giles's rasp, and exercise the speech manager with the slice's lines.
 * Dev only: open /voices.html while `npm run dev` is running.
 */
import { AudioEngine } from '../../audio/engine.ts';
import { EventBus } from '../../core/events.ts';
import { EMOTES, type Channel, type DialogueLine, type Emote } from '../../data/types/dialogue.ts';
import { loadDialogueLibrary } from '../load.ts';
import { SpeechManager } from '../speech.ts';
import { renderUtterance } from '../vocalSynth.ts';
import { WebAudioVoicePlayer } from '../voicePlayer.ts';

const css = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b0f12; color: #cfd8dc; font: 13px/1.4 ui-monospace, Menlo, monospace; }
  #app { max-width: 1100px; margin: 0 auto; padding: 20px; }
  h1 { font-size: 16px; letter-spacing: .08em; text-transform: uppercase; color: #8fb3c0; margin: 0 0 4px; }
  h2 { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: #6d8a96; margin: 22px 0 8px; }
  p.note { color: #7c8b91; margin: 0 0 14px; }
  .row { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin-bottom: 8px; }
  label { display: inline-flex; gap: 6px; align-items: center; }
  input[type=text] { width: 320px; background: #121a1f; color: inherit; border: 1px solid #26343b; padding: 4px 6px; }
  table { border-collapse: collapse; }
  th { text-align: left; font-weight: normal; color: #6d8a96; padding: 3px 10px 3px 0; }
  td { padding: 2px; }
  button { background: #142027; color: #cfd8dc; border: 1px solid #26343b; padding: 5px 9px; cursor: pointer; font: inherit; }
  button:hover { border-color: #4f7584; }
  button.on { background: #1f3a46; border-color: #6aa6b8; }
  #start { font-size: 15px; padding: 12px 20px; }
  canvas { display: block; background: #091013; border: 1px solid #1c272d; width: 100%; height: 90px; }
  #subtitle { min-height: 44px; margin-top: 8px; padding: 10px 14px; background: rgba(0,0,0,.55); border-left: 3px solid #6aa6b8; font: 16px/1.3 system-ui, sans-serif; }
  #subtitle .name { color: #8fd0e0; margin-right: 8px; font-weight: 600; }
  #subtitle.radio .name::after { content: ' [radio]'; color: #6d8a96; font-weight: normal; font-size: 12px; }
  #log { height: 160px; overflow: auto; background: #091013; border: 1px solid #1c272d; padding: 6px; white-space: pre; color: #9fb0b6; }
  .lines button { margin: 0 4px 4px 0; }
  .prio { color: #6d8a96; }
`;

const app = document.getElementById('app')!;
document.head.append(Object.assign(document.createElement('style'), { textContent: css }));
app.innerHTML = `
  <h1>Voice audition</h1>
  <p class="note">ADR-0010 emotes: non-verbal mood sounds + subtitles. Every emote should read by mood without the label.</p>
  <button id="start">Click to enable audio</button>
  <div id="main" hidden>
    <h2>Options</h2>
    <div class="row">
      <label>Channel <select id="channel"><option value="local">local (positional)</option><option value="radio">radio</option></select></label>
      <label>Position <input id="pos" type="range" min="-4" max="4" step="0.5" value="0" /> <span id="posv">centre</span></label>
      <label><input id="vary" type="checkbox" /> new seed each click</label>
    </div>
    <div class="row">
      <label><input id="babble" type="checkbox" /> babble</label>
      <input id="btext" type="text" value="Cover me, I'll get this open! Ready?" />
      <label>Giles rasp <input id="rasp" type="range" min="0" max="1" step="0.05" value="0" /> <span id="raspv">0.00</span></label>
    </div>
    <h2>Emotes</h2>
    <table id="grid"></table>
    <canvas id="wave" width="1060" height="90"></canvas>
    <h2>Speech manager</h2>
    <div class="row">
      <button id="sc-interrupt">Story interrupts combat</button>
      <button id="sc-drop">Stale bark is dropped</button>
      <button id="sc-queue">Equal priority queues</button>
      <button id="sc-stop">Stop all</button>
    </div>
    <div class="lines" id="lines"></div>
    <div id="subtitle"></div>
    <h2>Events</h2>
    <div id="log"></div>
  </div>
`;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const library = loadDialogueLibrary();
const engine = new AudioEngine();
const player = new WebAudioVoicePlayer(engine);
const bus = new EventBus();
const speech = new SpeechManager(bus, library, player);

const voices: Array<[string, string]> = [
  ['engineer', 'Giles'],
  ['medic', 'Okafor'],
  ['crew_mess', 'crew_mess'],
  ['crew_lab', 'crew_lab'],
  ['infected', 'infected'],
];

// ------------------------------------------------------------------ options

const channel = (): Channel => $<HTMLSelectElement>('channel').value as Channel;
const pos = (): number => Number($<HTMLInputElement>('pos').value);
const rasp = (): number => Number($<HTMLInputElement>('rasp').value);
$('pos').addEventListener('input', () => ($('posv').textContent = pos() === 0 ? 'centre' : `${pos() < 0 ? 'left' : 'right'} ${Math.abs(pos())} m`));
$('rasp').addEventListener('input', () => {
  $('raspv').textContent = rasp().toFixed(2);
  speech.setRasp('engineer', rasp() > 0 ? rasp() : null);
});
$<HTMLInputElement>('babble').addEventListener('change', (e) => (speech.babble = (e.target as HTMLInputElement).checked));
const at = (): { x: number; y: number; z: number } => ({ x: pos(), y: 0, z: -2 });

// ------------------------------------------------------------------ emote grid

let clicks = 0;
const grid = $<HTMLTableElement>('grid');
grid.innerHTML = `<tr><th></th>${voices.map(([, n]) => `<th>${n}</th>`).join('')}</tr>`;
for (const emote of EMOTES) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<th>${emote}</th>`;
  for (const [speaker] of voices) {
    const td = document.createElement('td');
    const b = document.createElement('button');
    b.textContent = '▶';
    b.title = `${speaker} ${emote}`;
    b.addEventListener('click', () => audition(speaker, emote));
    td.append(b);
    tr.append(td);
  }
  grid.append(tr);
}
const paRow = document.createElement('tr');
paRow.innerHTML = '<th>PA chime</th>';
const paTd = document.createElement('td');
const paBtn = Object.assign(document.createElement('button'), { textContent: '▶' });
paBtn.addEventListener('click', () => audition('pa', 'neutral'));
paTd.append(paBtn);
paRow.append(paTd);
grid.append(paRow);

function audition(speaker: string, emote: Emote): void {
  const vary = $<HTMLInputElement>('vary').checked;
  const id = `audition_${speaker}_${emote}${vary ? `_${clicks++}` : ''}`;
  const babble = $<HTMLInputElement>('babble').checked;
  const text = $<HTMLInputElement>('btext').value;
  const line: DialogueLine = { id, speaker, text, emote, channel: channel(), priority: 'story', audio: null, minDuration: 0, choices: [] };
  const profile = library.speaker(speaker);
  const r = speaker === 'engineer' && rasp() > 0 ? rasp() : null;
  const pb = player.play({ line, profile, at: pos() === 0 ? undefined : at, rasp: r, babble });
  const data = renderUtterance(engine.ctx.sampleRate, profile, emote, id, { ...(r === null ? {} : { rasp: r }), ...(babble ? { babbleText: text } : {}) });
  setTimeout(() => pb.stop(false), (data.length / engine.ctx.sampleRate) * 1000 + 150);
  drawWave(data, `${speaker} / ${babble ? 'babble' : emote}`);
}

function drawWave(data: Float32Array, label: string): void {
  const c = $<HTMLCanvasElement>('wave');
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  g.strokeStyle = '#6aa6b8';
  g.beginPath();
  const mid = c.height / 2;
  const secs = 2;
  const per = (engine.ctx.sampleRate * secs) / c.width;
  for (let x = 0; x < c.width; x++) {
    let lo = 0;
    let hi = 0;
    for (let i = Math.floor(x * per); i < Math.floor((x + 1) * per) && i < data.length; i++) {
      lo = Math.min(lo, data[i]!);
      hi = Math.max(hi, data[i]!);
    }
    g.moveTo(x + 0.5, mid - hi * mid);
    g.lineTo(x + 0.5, mid - lo * mid + 1);
  }
  g.stroke();
  g.fillStyle = '#7c8b91';
  g.fillText(`${label}  ${(data.length / engine.ctx.sampleRate).toFixed(2)} s  (2 s window)`, 8, 14);
}

// ------------------------------------------------------------------ speech manager

const lines = $('lines');
for (const l of library.allLines()) {
  const b = document.createElement('button');
  b.innerHTML = `${l.id} <span class="prio">${l.priority}</span>`;
  b.title = `${l.speaker} (${l.emote ?? 'audio'}, ${l.channel}): ${l.text}`;
  b.addEventListener('click', () => say(l.id));
  lines.append(b);
}

function say(id: string): void {
  const l = library.line(id);
  speech.say(id, l.channel === 'local' && pos() !== 0 ? { at } : {});
}

$('sc-interrupt').addEventListener('click', () => {
  say('okafor_spotted_01');
  setTimeout(() => say('giles_cover_01'), 500);
});
$('sc-drop').addEventListener('click', () => {
  say('pa_quarantine_01');
  setTimeout(() => say('okafor_legs_01'), 300);
});
$('sc-queue').addEventListener('click', () => {
  say('giles_panel_01');
  say('okafor_revive_rule_01');
});
$('sc-stop').addEventListener('click', () => speech.stopAll());

const log = $('log');
const t0 = performance.now();
const write = (s: string): void => {
  log.textContent += `${((performance.now() - t0) / 1000).toFixed(2).padStart(7)}  ${s}\n`;
  log.scrollTop = log.scrollHeight;
};
bus.on('speech:started', (e) => write(`start   ${e.id} (${e.priority}, ${e.duration.toFixed(2)} s)`));
bus.on('speech:ended', (e) => write(`end     ${e.id} ${e.reason}`));
bus.on('speech:dropped', (e) => write(`DROPPED ${e.id} after ${e.waited.toFixed(2)} s`));
const sub = $('subtitle');
bus.on('subtitle:show', (e) => {
  sub.className = e.channel;
  sub.innerHTML = '';
  sub.append(Object.assign(document.createElement('span'), { className: 'name', textContent: e.name }), document.createTextNode(e.text));
});
bus.on('subtitle:hide', () => (sub.innerHTML = ''));

let last = performance.now();
const frame = (now: number): void => {
  speech.update(Math.min(0.1, (now - last) / 1000));
  last = now;
  requestAnimationFrame(frame);
};

$('start').addEventListener('click', async () => {
  await engine.resume();
  $('start').hidden = true;
  $('main').hidden = false;
  requestAnimationFrame(frame);
});
