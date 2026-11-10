// Letter audio, with three layers so a session never goes silent:
//   1. Pre-recorded clips (audio/<letter>.mp3) played through <audio> elements.
//      Reliable on iOS, where the Web Speech API is not.
//   2. Browser speech synthesis (spelled-out letter names).
//   3. The caller shows the letter on screen (onFail callback).

const FILE_DIR = 'audio/';

let clips = null; // { C: HTMLAudioElement, ... }
let voice = null;

export function audioAvailable() {
  return typeof Audio !== 'undefined';
}

export function speechAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

/* ---------- layer 1: recorded clips ---------- */

function buildClips(letters) {
  clips = {};
  for (const letter of letters) {
    const el = new Audio();
    el.preload = 'auto';
    el.setAttribute('playsinline', '');
    el.src = `${FILE_DIR}${letter.toLowerCase()}.mp3`;
    clips[letter] = el;
  }
}

/** Create the clips early so they start downloading before the first tap. */
export function preloadAudio(letters) {
  if (!audioAvailable() || clips) return;
  try {
    buildClips(letters);
    Object.values(clips).forEach((el) => el.load());
  } catch (e) {
    clips = null;
  }
}

function playClip(letter) {
  const el = clips && clips[letter];
  if (!el) return Promise.reject(new Error('no clip'));
  // A muted unlock play() may still be in flight (e.g. right after a tap).
  // Starting now would interrupt it, so wait for it to settle first.
  return (el.unlocking || Promise.resolve()).then(() => {
    try {
      el.pause();
      el.currentTime = 0;
    } catch (e) {
      /* element may not be ready yet */
    }
    const p = el.play();
    return p && p.then ? p : undefined;
  });
}

/* ---------- layer 2: device speech synthesis ---------- */

// Lowercase single letters are read by their name ("k" -> "kay") without the
// "capital" prefix that macOS adds to uppercase ones. To force other wording
// for a letter, add it here, e.g. { R: 'are' }.
const SPOKEN = {};

// How long to wait for the voice to actually start before using a recorded clip.
const START_TIMEOUT_MS = 900;

let speechWorks = false; // a device utterance has started at least once
let speechFailures = 0;  // consecutive utterances that never started
let keep = null;         // keep a reference: iOS may garbage-collect utterances mid-speech

function pickVoice() {
  try {
    const voices = window.speechSynthesis.getVoices() || [];
    const en = voices.filter((v) => /^en[-_]/i.test(v.lang));
    voice = en.find((v) => /^en[-_]US$/i.test(v.lang) && v.localService) || en[0] || null;
  } catch (e) {
    voice = null;
  }
}

if (speechAvailable()) {
  pickVoice();
  try {
    window.speechSynthesis.addEventListener('voiceschanged', pickVoice);
  } catch (e) {
    /* older browsers */
  }
}

// Speak with the device voice; `fallback` runs if it errors or never starts.
function speakWithSynth(letter, fallback) {
  if (!speechAvailable()) return fallback();
  try {
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) synth.cancel();
    if (synth.paused) synth.resume();

    const u = new SpeechSynthesisUtterance(SPOKEN[letter] || letter.toLowerCase());
    u.lang = 'en-US';
    if (voice) u.voice = voice;
    u.rate = 0.9;
    u.pitch = 1;
    u.volume = 1;

    let started = false;
    let fell = false;
    const fall = () => {
      if (fell) return;
      fell = true;
      fallback();
    };
    u.onstart = () => {
      started = true;
      speechWorks = true;
      speechFailures = 0;
    };
    u.onerror = (e) => {
      if (e && (e.error === 'interrupted' || e.error === 'canceled')) return;
      fall();
    };
    keep = u;
    synth.speak(u);

    // Some browsers (notably iOS) accept the call and then stay silent.
    if (!speechWorks) {
      setTimeout(() => {
        if (started || fell) return;
        speechFailures++;
        try { synth.cancel(); } catch (e) { /* ignore */ }
        fall();
      }, START_TIMEOUT_MS);
    }
  } catch (e) {
    fallback();
  }
}

/* ---------- public API ---------- */

/**
 * Call synchronously inside a tap/click handler. iOS only lets speech and
 * <audio> start later (from a timer) once they were used inside a gesture.
 */
export function unlockAudio() {
  speechFailures = 0;
  if (speechAvailable()) {
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch (e) {
      /* ignore */
    }
  }
  if (clips) {
    for (const el of Object.values(clips)) {
      try {
        el.muted = true;
        const p = el.play();
        const done = () => {
          el.pause();
          el.currentTime = 0;
          el.muted = false;
        };
        if (p && p.then) {
          el.unlocking = p.then(done, () => { el.muted = false; });
        } else {
          done();
        }
      } catch (e) {
        el.muted = false;
      }
    }
  }
}

/**
 * Play a letter. mode 'auto' uses the device voice and drops to the recorded
 * clips if it stays silent; 'recorded' always uses the clips. `onFail` runs
 * only if every audio option failed (the caller then shows the letter).
 */
export function speakLetter(letter, onFail, mode = 'auto') {
  const recorded = () => playClip(letter).catch(() => { if (onFail) onFail(); });
  if (mode === 'recorded' || !speechAvailable() || (!speechWorks && speechFailures >= 2)) {
    recorded();
  } else {
    speakWithSynth(letter, recorded);
  }
}

export function cancelSpeech() {
  if (clips) {
    for (const el of Object.values(clips)) {
      try { el.pause(); } catch (e) { /* ignore */ }
    }
  }
  if (speechAvailable()) window.speechSynthesis.cancel();
}
