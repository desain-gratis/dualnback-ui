// Audio helpers: spoken letters via the Web Speech API, plus tiny feedback beeps.

let ctx = null;

export function speechAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function speakLetter(letter) {
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

export function cancelSpeech() {
  if (speechAvailable()) window.speechSynthesis.cancel();
}

// Short tone; used for start/finish cues. Must be called after a user gesture.
export function beep(freq = 660, ms = 120) {
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
