(function () {
'use strict';
/* engine.js */
const LETTERS = ['C', 'H', 'K', 'L', 'Q', 'R', 'S', 'T'];
const CELLS = 9;
/** Small seedable PRNG so sequences can be reproduced in tests. */
function mulberry32(seed) {
let a = seed >>> 0;
return function () {
a = (a + 0x6d2b79f5) >>> 0;
let t = a;
t = Math.imul(t ^ (t >>> 15), t | 1);
t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
}
function shuffle(arr, rng) {
for (let i = arr.length - 1; i > 0; i--) {
const j = Math.floor(rng() * (i + 1));
[arr[i], arr[j]] = [arr[j], arr[i]];
}
return arr;
}
function otherThan(size, avoid, rng) {
const v = Math.floor(rng() * (size - 1));
return v >= avoid ? v + 1 : v;
}
/**
* Build a dual n-back sequence.
* Length is n + trials: the first n stimuli are warm-up (never matches),
* the remaining `trials` are scored. Exactly round(trials * matchRate)
* scored trials are position matches and the same count are audio matches
* (chosen independently, so some trials can match on both).
*/
function generateSequence({ n, trials = 20, matchRate = 0.3, rng = Math.random } = {}) {
if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be a positive integer');
if (!Number.isInteger(trials) || trials < 1) throw new RangeError('trials must be a positive integer');
const total = n + trials;
const k = Math.min(trials, Math.max(1, Math.round(trials * matchRate)));
const chooseMatches = () => {
const idx = [];
for (let i = n; i < total; i++) idx.push(i);
return new Set(shuffle(idx, rng).slice(0, k));
};
const posMatches = chooseMatches();
const audioMatches = chooseMatches();
const seq = [];
for (let i = 0; i < total; i++) {
const posMatch = posMatches.has(i);
const audioMatch = audioMatches.has(i);
const back = i >= n ? seq[i - n] : null;
const pos = posMatch
? back.pos
: back
? otherThan(CELLS, back.pos, rng)
: Math.floor(rng() * CELLS);
const letterIdx = audioMatch
? LETTERS.indexOf(back.letter)
: back
? otherThan(LETTERS.length, LETTERS.indexOf(back.letter), rng)
: Math.floor(rng() * LETTERS.length);
seq.push({ pos, letter: LETTERS[letterIdx], posMatch, audioMatch });
}
return seq;
}
function accuracy(hits, misses, falseAlarms) {
const denom = hits + misses + falseAlarms;
return denom === 0 ? 1 : hits / denom;
}
/**
* Score a finished session. `responses[i]` is { pos: boolean, audio: boolean }
* for trial i (missing entries count as "no press"). Warm-up trials are ignored.
*/
function scoreSession(seq, n, responses) {
const blank = () => ({ hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0, accuracy: 1 });
const out = { pos: blank(), audio: blank() };
for (let i = n; i < seq.length; i++) {
const r = responses[i] || {};
const checks = [
['pos', seq[i].posMatch, !!r.pos],
['audio', seq[i].audioMatch, !!r.audio],
];
for (const [key, expected, given] of checks) {
const s = out[key];
if (expected && given) s.hits++;
else if (expected && !given) s.misses++;
else if (!expected && given) s.falseAlarms++;
else s.correctRejections++;
}
}
for (const key of ['pos', 'audio']) {
const s = out[key];
s.accuracy = accuracy(s.hits, s.misses, s.falseAlarms);
}
return out;
}
/** Suggest the next N: >=80% on both modalities goes up, <50% on either goes down. */
function recommendLevel(score, n) {
const worst = Math.min(score.pos.accuracy, score.audio.accuracy);
if (worst >= 0.8) return Math.min(9, n + 1);
if (worst < 0.5) return Math.max(1, n - 1);
return n;
}
/* audio.js */
let ctx = null;
function speechAvailable() {
return typeof window !== 'undefined' && 'speechSynthesis' in window;
}
function speakLetter(letter) {
if (!speechAvailable()) return false;
try {
window.speechSynthesis.cancel();
const u = new SpeechSynthesisUtterance(letter);
u.rate = 1.1;
u.pitch = 1;
u.volume = 1;
window.speechSynthesis.speak(u);
return true;
} catch (e) {
return false;
}
}
function cancelSpeech() {
if (speechAvailable()) window.speechSynthesis.cancel();
}
function beep(freq = 660, ms = 120) {
try {
const AC = window.AudioContext || window.webkitAudioContext;
if (!AC) return;
ctx = ctx || new AC();
const osc = ctx.createOscillator();
const gain = ctx.createGain();
osc.frequency.value = freq;
gain.gain.value = 0.05;
osc.connect(gain).connect(ctx.destination);
osc.start();
osc.stop(ctx.currentTime + ms / 1000);
} catch (e) {
/* audio is optional */
}
}
/* storage.js */
const KEY = 'dualnback:v1';
const DEFAULT_SETTINGS = {
n: 2,
trials: 20,
interval: 3000,
showLetter: false,
speak: true,
auto: true,
};
function loadState() {
try {
const raw = localStorage.getItem(KEY);
if (raw) {
const parsed = JSON.parse(raw);
return {
settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
history: Array.isArray(parsed.history) ? parsed.history : [],
};
}
} catch (e) {
/* fall through to defaults */
}
return { settings: { ...DEFAULT_SETTINGS }, history: [] };
}
function saveState(state) {
try {
localStorage.setItem(KEY, JSON.stringify(state));
} catch (e) {
/* ignore quota / privacy-mode errors */
}
}
/* main.js */
const STIMULUS_MS = 600; // how long a square stays lit
const FEEDBACK_MS = 350;
const MAX_HISTORY = 20;
const $ = (id) => document.getElementById(id);
const screens = { menu: $('screen-menu'), game: $('screen-game'), results: $('screen-results') };
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
showLetter: $('set-show').checked || !speechAvailable(),
auto: $('set-auto').checked,
};
}
function writeSettings() {
const s = state.settings;
$('set-n').value = s.n;
$('set-trials').value = s.trials;
$('set-interval').value = String(s.interval);
$('set-speak').checked = s.speak && speechAvailable();
$('set-speak').disabled = !speechAvailable();
$('set-show').checked = s.showLetter || !speechAvailable();
$('set-auto').checked = s.auto;
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
state.settings = readSettings();
persist();
const s = state.settings;
session = {
n: s.n,
interval: s.interval,
speak: s.speak && speechAvailable(),
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
beep(520, 100);
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
if (session.speak) speakLetter(t.letter);
if (session.showLetter) {
$('letter').textContent = t.letter;
later(() => { $('letter').textContent = ''; }, STIMULUS_MS + 200);
}
later(endTrial, session.interval);
}
function endTrial() {
const i = session.i;
const t = session.seq[i];
session.responses[i] = { ...session.cur };
session.accepting = false;
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
beep(784, 160);
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
$('btn-clear').addEventListener('click', () => {
state.history = [];
persist();
renderHistory();
});
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
goMenu();
})();
