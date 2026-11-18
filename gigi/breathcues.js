// Copy of the oasis repo's src/lib/gigiLive/breathCues.js. Gigi's four breathing tracks (breath/<id>.mp3) as a pacer can follow them (2026-11-18). Copied to
// oasis-share gigi/breathcues.js for grateful.gg/gigi: keep the two the same.
//
// When each phase starts, in seconds into the track, measured from the track's own speech onsets (ffmpeg
// silencedetect): the letter timings in breath/<id>.json drift in places, so the pacer reads these instead. A phase
// runs until the next one starts. 'in' fills the lungs to 1 unless a third value says how far (the sigh's first
// breath), 'out' empties them, 'hold' and 'rest' keep them as they are. 'rest' shows no word.
// Tests: node --test src/lib/gigiLive/breathCues.test.mjs

export const BREATHS = [
  { id: 'box', label: 'Box breathing', hint: '4 in, 4 hold, 4 out, 4 hold', length: '1:54' },
  { id: 'coherent', label: 'Slow and even', hint: '5 in, 5 out', length: '1:37' },
  { id: '478', label: '4-7-8', hint: 'To settle, and to sleep', length: '1:39' },
  { id: 'sigh', label: 'The sigh', hint: 'Two breaths in, one long out. A fast reset.', length: '1:05' },
];

export const CUES = {
  box: { rounds: 4, end: 109.2, phases: [[13.24, 'in'], [19.14, 'hold'], [25.04, 'out'], [30.94, 'hold'], [36.84, 'in'], [42.74, 'hold'], [48.64, 'out'], [54.54, 'hold'], [60.44, 'in'], [66.34, 'hold'], [72.24, 'out'], [78.14, 'hold'], [85.57, 'in'], [91.47, 'hold'], [97.37, 'out'], [103.27, 'hold']] },
  coherent: { rounds: 6, end: 91.4, phases: [[11.79, 'in'], [18.35, 'out'], [24.89, 'in'], [31.45, 'out'], [37.99, 'in'], [44.55, 'out'], [51.09, 'in'], [57.65, 'out'], [64.19, 'in'], [70.75, 'out'], [77.0, 'rest'], [78.81, 'in'], [85.37, 'out']] },
  478: { rounds: 4, end: 91.1, phases: [[7.85, 'out'], [12.3, 'rest'], [15.0, 'in'], [19.04, 'hold'], [26.04, 'out'], [34.0, 'in'], [38.04, 'hold'], [45.04, 'out'], [53.03, 'in'], [57.04, 'hold'], [64.04, 'out'], [72.03, 'in'], [76.04, 'hold'], [83.04, 'out']] },
  sigh: { rounds: 4, end: 59.5, phases: [[11.5, 'in', 0.72], [13.72, 'in'], [15.34, 'out'], [23.51, 'in', 0.72], [25.72, 'in'], [27.34, 'out'], [35.51, 'in', 0.72], [37.72, 'in'], [39.34, 'out'], [47.51, 'in', 0.72], [49.72, 'in'], [51.34, 'out']] },
};

const WORDS = { in: 'Breathe in', out: 'Breathe out', hold: 'Hold', rest: '' };
export const START_WORD = 'Settle in';
export const END_WORD = 'Well done';
const START_FULL = 0.3;
const ease = (k) => 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, k))) / 2;

// Where the breath is at second t of track `id`: full (0 empty lungs .. 1 full), p (how far through this phase, 0..1),
// word (what the pacer shows), round (1-based; 0 before the first in-breath) and rounds.
export function breathAt(id, t) {
  const c = CUES[id];
  if (!c) return { full: START_FULL, p: 0, word: '', round: 0, rounds: 0 };
  let full = START_FULL;
  let round = 0;
  let word = START_WORD;
  let p = 0;
  const ph = c.phases;
  for (let i = 0; i < ph.length; i += 1) {
    const [start, kind, to] = ph[i];
    if (t < start) break;
    const end = i + 1 < ph.length ? ph[i + 1][0] : c.end;
    const from = full;
    const target = kind === 'in' ? (to ?? 1) : kind === 'out' ? 0 : from;
    const topUp = kind === 'in' && i > 0 && ph[i - 1][1] === 'in';
    if (kind === 'in' && !topUp) round += 1;
    p = Math.min(1, (t - start) / Math.max(0.1, end - start));
    full = t >= end ? target : from + (target - from) * ease(p);
    word = topUp ? 'A little more' : WORDS[kind] ?? '';
  }
  if (t >= c.end) { word = END_WORD; p = 1; }
  return { full, p, word, round, rounds: c.rounds };
}

// Her seven stones, root to crown (telepathy.js ESSENCES): the light climbs them as the lungs fill.
export const LADDER = ['ground', 'spark', 'power', 'heart', 'truth', 'insight', 'wonder'];
export const rungOf = (full) => LADDER[Math.round(Math.min(1, Math.max(0, full)) * (LADDER.length - 1))];
