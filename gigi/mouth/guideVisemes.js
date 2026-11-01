// Gigi's mouths for each sound, for the /ai/setup guide (guideMouth.js). Picked once from the /withgigi corpus labels
// (neck-and-neck production/phonemouth.py load_corpus: cl_lab, opn, rnd for agent-lab/talkmodel/pool_global.npy, which
// is cells.bin's order): per viseme, the six live cells nearest that viseme's median opening and roundness.
// 'sil' has none: between phrases her own mouth shows.
export const VISEME_CELLS = {
  PP: [370, 2777, 2259, 2961, 369, 2778],
  FF: [2654, 2874, 2875, 3087, 763, 3088],
  TH: [298, 2212, 2068, 2966, 2965, 2967],
  DD: [1922, 2417, 2416, 207, 781, 2817],
  kk: [2968, 3051, 1886, 3052, 594, 2061],
  CH: [1855, 1856, 389, 390, 2487, 1120],
  SS: [1060, 507, 2993, 1061, 2895, 2256],
  nn: [556, 555, 2636, 728, 436, 961],
  RR: [1151, 1152, 95, 2754, 358, 2072],
  aa: [2000, 2681, 1269, 1771, 1454, 554],
  E: [1775, 1776, 2607, 2749, 2606, 523],
  ih: [694, 1023, 693, 2337, 1171, 1743],
  oh: [2644, 2645, 895, 1313, 494, 495],
  ou: [742, 1400, 743, 2240, 2174, 644],
};

const DIGRAPHS = { th: 'TH', ch: 'CH', sh: 'CH', ph: 'FF', ng: 'kk', wh: 'ou', ck: 'kk' };
const LETTERS = {
  p: 'PP', b: 'PP', m: 'PP', f: 'FF', v: 'FF', t: 'DD', d: 'DD', k: 'kk', g: 'kk', c: 'kk', q: 'kk', x: 'kk', j: 'CH',
  s: 'SS', z: 'SS', n: 'nn', l: 'nn', r: 'RR', a: 'aa', e: 'E', i: 'ih', y: 'ih', o: 'oh', u: 'ou', w: 'ou', h: 'ih',
};

/** The viseme for character i of a line (English spelling, close enough for a mouth): null for a space or a mark. */
export function charViseme(chars, i) {
  const c = String(chars[i] || '').toLowerCase();
  if (!LETTERS[c]) return null;
  const two = c + String(chars[i + 1] || '').toLowerCase(), back = String(chars[i - 1] || '').toLowerCase() + c;
  return DIGRAPHS[two] || (DIGRAPHS[back] ? DIGRAPHS[back] : LETTERS[c]);
}
