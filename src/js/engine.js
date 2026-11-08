// Pure game logic: sequence generation and scoring. No DOM access.

export const LETTERS = ['C', 'H', 'K', 'L', 'Q', 'R', 'S', 'T'];
export const CELLS = 9;

/** Small seedable PRNG so sequences can be reproduced in tests. */
export function mulberry32(seed) {
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

// Random integer in [0, size) that is guaranteed to differ from `avoid`.
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
export function generateSequence({ n, trials = 20, matchRate = 0.3, rng = Math.random } = {}) {
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
export function scoreSession(seq, n, responses) {
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
export function recommendLevel(score, n) {
  const worst = Math.min(score.pos.accuracy, score.audio.accuracy);
  if (worst >= 0.8) return Math.min(9, n + 1);
  if (worst < 0.5) return Math.max(1, n - 1);
  return n;
}
