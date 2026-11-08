import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSequence,
  scoreSession,
  recommendLevel,
  mulberry32,
  LETTERS,
  CELLS,
} from '../src/js/engine.js';

for (const n of [1, 2, 3, 5]) {
  test(`sequence is well formed for n=${n}`, () => {
    for (let seed = 1; seed <= 50; seed++) {
      const trials = 20;
      const seq = generateSequence({ n, trials, rng: mulberry32(seed) });
      assert.equal(seq.length, n + trials);

      let posCount = 0;
      let audioCount = 0;
      seq.forEach((t, i) => {
        assert.ok(t.pos >= 0 && t.pos < CELLS);
        assert.ok(LETTERS.includes(t.letter));
        if (i < n) {
          assert.equal(t.posMatch, false, 'no matches during warm-up');
          assert.equal(t.audioMatch, false, 'no matches during warm-up');
          return;
        }
        // Flags must agree with the actual n-back comparison, both ways.
        assert.equal(t.pos === seq[i - n].pos, t.posMatch, `pos flag at ${i}`);
        assert.equal(t.letter === seq[i - n].letter, t.audioMatch, `letter flag at ${i}`);
        if (t.posMatch) posCount++;
        if (t.audioMatch) audioCount++;
      });
      assert.equal(posCount, 6);
      assert.equal(audioCount, 6);
    }
  });
}

test('same seed gives same sequence', () => {
  const a = generateSequence({ n: 2, rng: mulberry32(42) });
  const b = generateSequence({ n: 2, rng: mulberry32(42) });
  assert.deepEqual(a, b);
});

test('rejects invalid input', () => {
  assert.throws(() => generateSequence({ n: 0 }), RangeError);
  assert.throws(() => generateSequence({ n: 2, trials: 0 }), RangeError);
});

test('perfect play scores 100%', () => {
  const n = 2;
  const seq = generateSequence({ n, trials: 20, rng: mulberry32(7) });
  const responses = seq.map((t) => ({ pos: t.posMatch, audio: t.audioMatch }));
  const s = scoreSession(seq, n, responses);
  assert.equal(s.pos.accuracy, 1);
  assert.equal(s.audio.accuracy, 1);
  assert.equal(s.pos.hits, 6);
  assert.equal(s.pos.correctRejections, 14);
  assert.equal(recommendLevel(s, n), 3);
});

test('never pressing misses every match', () => {
  const n = 2;
  const seq = generateSequence({ n, trials: 20, rng: mulberry32(7) });
  const s = scoreSession(seq, n, []);
  assert.equal(s.pos.misses, 6);
  assert.equal(s.pos.hits, 0);
  assert.equal(s.pos.accuracy, 0);
  assert.equal(recommendLevel(s, n), 1);
  assert.equal(recommendLevel(s, 4), 3);
});

test('always pressing produces false alarms', () => {
  const n = 2;
  const seq = generateSequence({ n, trials: 20, rng: mulberry32(9) });
  const responses = seq.map(() => ({ pos: true, audio: true }));
  const s = scoreSession(seq, n, responses);
  assert.equal(s.pos.hits, 6);
  assert.equal(s.pos.falseAlarms, 14);
  assert.equal(s.pos.accuracy, 6 / 20);
});

test('presses during warm-up are ignored', () => {
  const n = 3;
  const seq = generateSequence({ n, trials: 10, rng: mulberry32(3) });
  const responses = [];
  for (let i = 0; i < n; i++) responses[i] = { pos: true, audio: true };
  for (let i = n; i < seq.length; i++) responses[i] = { pos: seq[i].posMatch, audio: seq[i].audioMatch };
  const s = scoreSession(seq, n, responses);
  assert.equal(s.pos.falseAlarms, 0);
  assert.equal(s.audio.falseAlarms, 0);
});

test('level stays put between 50% and 80%, and is clamped', () => {
  const mid = { pos: { accuracy: 0.7 }, audio: { accuracy: 0.9 } };
  assert.equal(recommendLevel(mid, 4), 4);
  const top = { pos: { accuracy: 1 }, audio: { accuracy: 1 } };
  assert.equal(recommendLevel(top, 9), 9);
});
