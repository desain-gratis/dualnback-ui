// Audio helpers: spoken letters via the Web Speech API, plus tiny feedback beeps.

let ctx = null;
let voice = null;

export function speechAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

// Spelled-out letter names. Speaking a bare capital ("X") makes macOS say
// "capital X", and a bare lowercase letter is read inconsistently between
// voices, so we speak the name of the letter as a word instead.
const SPOKEN = {
  C: 'see',
  H: 'aitch',
  K: 'kay',
  L: 'ell',
  Q: 'cue',
  R: 'are',
  S: 'ess',
  T: 'tee',
};

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
  // Voices load asynchronously in Chrome/Safari.
  try {
    window.speechSynthesis.addEventListener('voiceschanged', pickVoice);
  } catch (e) {
    /* older browsers */
  }
}

function makeUtterance(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US'; // otherwise the device language voice reads English letters wrongly
  if (voice) u.voice = voice;
  return u;
}

/**
 * iOS only allows speech that was started from a user gesture. Call this
 * synchronously inside a tap/click handler; later speak() calls from timers
 * are then allowed.
 */
export function unlockAudio() {
  if (speechAvailable()) {
    try {
      const u = makeUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch (e) {
      /* ignore */
    }
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      ctx = ctx || new AC();
      if (ctx.state === 'suspended') ctx.resume();
    }
  } catch (e) {
    /* audio is optional */
  }
}

/** Speak a letter. `onFail` is called if the browser refuses or errors. */
export function speakLetter(letter, onFail) {
  if (!speechAvailable()) {
    if (onFail) onFail();
    return false;
  }
  try {
    const synth = window.speechSynthesis;
    // Only cancel when something is actually queued: cancel() immediately
    // followed by speak() is silently dropped on iOS Safari.
    if (synth.speaking || synth.pending) synth.cancel();
    if (synth.paused) synth.resume();
    const u = makeUtterance(SPOKEN[letter] || letter.toLowerCase());
    u.rate = 0.95;
    u.pitch = 1;
    u.volume = 1;
    u.onerror = (e) => {
      // 'interrupted' / 'canceled' are expected when we cut speech off.
      if (e && (e.error === 'interrupted' || e.error === 'canceled')) return;
      if (onFail) onFail();
    };
    synth.speak(u);
    return true;
  } catch (e) {
    if (onFail) onFail();
    return false;
  }
}

export function cancelSpeech() {
  if (speechAvailable()) window.speechSynthesis.cancel();
}

// Short tone; used for start/finish cues.
export function beep(freq = 660, ms = 120) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = ctx || new AC();
    if (ctx.state === 'suspended') ctx.resume();
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
