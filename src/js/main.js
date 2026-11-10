// UI + game loop. Wires the pure engine to the DOM.
import { generateSequence, scoreSession, recommendLevel, LETTERS } from './engine.js';
import { speakLetter, cancelSpeech, unlockAudio, preloadAudio } from './audio.js';
import { loadState, saveState, DEFAULT_SETTINGS } from './storage.js';

const STIMULUS_MS = 600; // how long a square stays lit
const FEEDBACK_MS = 350;
const MAX_HISTORY = 20;

const $ = (id) => document.getElementById(id);
const screens = {
  menu: $('screen-menu'),
  settings: $('screen-settings'),
  game: $('screen-game'),
  results: $('screen-results'),
};
const cells = Array.from(document.querySelectorAll('#grid .cell'));

const state = loadState();
let session = null;

/* ---------- screens & settings ---------- */

function show(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
}

function readSettings() {
  const clamp = (v, lo, hi, d) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  return {
    n: clamp($('set-n').value, 1, 9, DEFAULT_SETTINGS.n),
    trials: clamp($('set-trials').value, 10, 60, DEFAULT_SETTINGS.trials),
    interval: clamp($('set-interval').value, 1500, 6000, DEFAULT_SETTINGS.interval),
    speak: $('set-speak').checked,
    showLetter: $('set-show').checked,
    auto: $('set-auto').checked,
    voice: $('set-voice').value === 'recorded' ? 'recorded' : 'auto',
  };
}

function writeSettings() {
  const s = state.settings;
  $('set-n').value = s.n;
  $('set-trials').value = s.trials;
  $('set-interval').value = String(s.interval);
  $('set-speak').checked = s.speak;
  $('set-show').checked = s.showLetter;
  $('set-auto').checked = s.auto;
  $('set-voice').value = s.voice === 'recorded' ? 'recorded' : 'auto';
}

function persist() {
  state.history = state.history.slice(-MAX_HISTORY);
  saveState(state);
}

function renderHistory() {
  const body = document.querySelector('#history tbody');
  body.textContent = '';
  const rows = state.history.slice().reverse().slice(0, 10);
  for (const h of rows) {
    const tr = document.createElement('tr');
    const d = new Date(h.date);
    const cols = [
      d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      h.n + '-back',
      pct(h.pos),
      pct(h.audio),
    ];
    for (const text of cols) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  $('history').hidden = rows.length === 0;
  $('history-empty').hidden = rows.length > 0;
  $('btn-clear').hidden = rows.length === 0;
}

const pct = (x) => Math.round(x * 100) + '%';

/* ---------- game loop ---------- */

function startSession() {
  unlockAudio(); // must run synchronously inside the tap (iOS autoplay rules)
  state.settings = readSettings();
  persist();
  const s = state.settings;

  session = {
    n: s.n,
    interval: s.interval,
    speak: s.speak,
    voice: s.voice,
    showLetter: s.showLetter,
    seq: generateSequence({ n: s.n, trials: s.trials }),
    i: -1,
    responses: [],
    cur: { pos: false, audio: false },
    timers: [],
    accepting: false,
  };

  $('g-level').textContent = s.n + '-back';
  $('letter').textContent = '';
  $('g-bar').style.width = '0%';
  setStatus('Get ready…', false);
  updateProgress();
  clearAnswerStyles();
  setAnswerEnabled(false);
  show('game');
  later(() => nextTrial(), 1200);
}

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  session.timers.push(id);
  return id;
}

function clearTimers() {
  if (!session) return;
  session.timers.forEach(clearTimeout);
  session.timers = [];
}

function nextTrial() {
  session.i++;
  if (session.i >= session.seq.length) return finishSession();

  const i = session.i;
  const t = session.seq[i];
  const scored = i >= session.n;
  session.cur = { pos: false, audio: false };
  session.accepting = scored;

  clearAnswerStyles();
  setAnswerEnabled(scored);
  setStatus(scored ? 'Go!' : `Warm-up ${i + 1} of ${session.n}`, !scored);
  updateProgress();

  cells[t.pos].classList.add('lit');
  later(() => cells[t.pos].classList.remove('lit'), STIMULUS_MS);

  // If speech is refused or fails, fall back to showing the letter so the
  // session is still playable.
  const showLetter = () => {
    $('letter').textContent = t.letter;
    later(() => { $('letter').textContent = ''; }, STIMULUS_MS + 200);
  };
  if (session.speak) speakLetter(t.letter, () => { if (session && !session.showLetter) showLetter(); }, session.voice);
  if (session.showLetter) showLetter();

  later(endTrial, session.interval);
}

function endTrial() {
  const i = session.i;
  const t = session.seq[i];
  session.responses[i] = { ...session.cur };
  session.accepting = false;

  // Highlight any match the player missed.
  if (i >= session.n) {
    if (t.posMatch && !session.cur.pos) flash($('btn-pos'), 'miss');
    if (t.audioMatch && !session.cur.audio) flash($('btn-audio'), 'miss');
  }
  later(nextTrial, i >= session.n ? FEEDBACK_MS : 0);
}

function respond(kind) {
  if (!session || !session.accepting || session.cur[kind]) return;
  session.cur[kind] = true;
  const t = session.seq[session.i];
  const correct = kind === 'pos' ? t.posMatch : t.audioMatch;
  flash(kind === 'pos' ? $('btn-pos') : $('btn-audio'), correct ? 'ok' : 'no');
}

function finishSession() {
  const { n, seq, responses } = session;
  const score = scoreSession(seq, n, responses);
  const next = recommendLevel(score, n);
  clearTimers();
  cancelSpeech();

  state.history.push({
    date: Date.now(),
    n,
    pos: score.pos.accuracy,
    audio: score.audio.accuracy,
  });

  let note;
  if (next > n) note = `Great work! ${next}-back is next.`;
  else if (next < n) note = `Let's ease off to ${next}-back for a bit.`;
  else note = `Stay at ${n}-back. Aim for 80%+ on both to level up.`;
  if (!state.settings.auto && next !== n) note += ' (Auto-adjust is off.)';
  if (state.settings.auto) state.settings.n = next;
  persist();

  $('r-summary').textContent = `${n}-back, ${seq.length - n} scored trials.`;
  fillResult('pos', score.pos);
  fillResult('audio', score.audio);
  $('r-next').textContent = note;
  session = null;
  show('results');
}

function fillResult(key, s) {
  $(`r-${key}-acc`).textContent = pct(s.accuracy);
  $(`r-${key}-hit`).textContent = s.hits;
  $(`r-${key}-miss`).textContent = s.misses;
  $(`r-${key}-fa`).textContent = s.falseAlarms;
}

function quitSession() {
  clearTimers();
  cancelSpeech();
  session = null;
  cells.forEach((c) => c.classList.remove('lit'));
  goMenu();
}

function goMenu() {
  writeSettings();
  renderHistory();
  show('menu');
}

/* ---------- small UI helpers ---------- */

function setStatus(text, warm) {
  const el = $('g-status');
  el.textContent = text;
  el.classList.toggle('warm', !!warm);
}

function updateProgress() {
  const scoredDone = Math.max(0, session.i - session.n + 1);
  const total = session.seq.length - session.n;
  $('g-progress').textContent = `${Math.min(scoredDone, total)} / ${total}`;
  $('g-bar').style.width = ((Math.max(0, session.i + 1) / session.seq.length) * 100) + '%';
}

function flash(btn, cls) {
  btn.classList.add(cls);
}

function clearAnswerStyles() {
  for (const b of [$('btn-pos'), $('btn-audio')]) b.classList.remove('ok', 'no', 'miss');
}

function setAnswerEnabled(on) {
  for (const b of [$('btn-pos'), $('btn-audio')]) b.disabled = !on;
}

/* ---------- events ---------- */

$('btn-start').addEventListener('click', startSession);
$('btn-again').addEventListener('click', startSession);
$('btn-menu').addEventListener('click', goMenu);
$('btn-quit').addEventListener('click', quitSession);
$('btn-settings').addEventListener('click', () => {
  $('test-note').textContent = '';
  show('settings');
});
$('btn-back').addEventListener('click', () => {
  state.settings = readSettings();
  persist();
  goMenu();
});
$('btn-test').addEventListener('click', () => {
  unlockAudio(); // runs inside the tap, like Start
  const letter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
  const note = $('test-note');
  note.textContent = `Playing "${letter}"…`;
  speakLetter(
    letter,
    () => { note.textContent = 'No sound could be played. Check your media volume and silent mode.'; },
    $('set-voice').value
  );
  setTimeout(() => { if (note.textContent.startsWith('Playing')) note.textContent = `Played "${letter}". Nothing heard? Choose Recorded clips.`; }, 1500);
});
$('btn-clear').addEventListener('click', () => {
  state.history = [];
  persist();
  renderHistory();
});

// pointerdown feels snappier than click on touch screens.
$('btn-pos').addEventListener('pointerdown', (e) => { e.preventDefault(); respond('pos'); });
$('btn-audio').addEventListener('pointerdown', (e) => { e.preventDefault(); respond('audio'); });

document.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const inGame = !screens.game.hidden;
  const key = e.key.toLowerCase();
  if (inGame) {
    if (key === 'a') respond('pos');
    else if (key === 'l') respond('audio');
    else if (key === 'escape') quitSession();
  } else if (!screens.results.hidden && key === 'enter') {
    startSession();
  }
});

preloadAudio(LETTERS);
goMenu();
