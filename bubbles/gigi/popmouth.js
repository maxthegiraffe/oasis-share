// Popcorn Gigi's live mouth (the lab, ?lab=1; LAB-LIVE-GIGI-SPEC.md). Her live lines (reflections voiced by ElevenLabs)
// have no Popcorn render, and a video's mouth is baked in. So the page keeps Popcorn's own pixels and makes only the
// mouth live: a library of mouth patches harvested from Popcorn's talking frames (gigi/mouth/), chosen frame by frame
// for the line's lips timeline and drawn over a Popcorn base loop (idle, or with ?base=talk the talk loop), each patch
// registered to the head pose of the base frame on screen. Classic "Video Rewrite" unit selection.
//
// No imports and no DOM at module level: the pure parts (decode, calib, targets, Viterbi, the draw matrices) run in
// node (web/test_popmouth.mjs).
//
// gigi/mouth/mouth.json (v1), with atlas.webp next to it (cells with alpha, every patch already warped into REFERENCE
// coordinates: the 720x720 frame space of idle.mp4 frame 0):
//   { v: 1, ref: {clip, frame, size}, region: [x, y, w, h] (ref px), cell: [w, h] (atlas px), scale (atlas px per ref
//     px), cols, patches: [{i, col, row, src, jaw, round, env, gain: [r, g, b]}], feats: {dims, weights},
//     join: {k, desc: base64 float16 little-endian, k per patch, patch-major}, seqs: [[i0, i1, ...]],
//     calib: {lag_ms, jaw: [[vis byte, jaw], ...], round: [[vis byte, round], ...]}, rest,
//     bases: {idle: {video, frames, track: [[a, b, tx, ty] per frame]}, 'talk-loop': {...}} }
//   Optional, read if present: calib.env (an env-byte table for the 'env' dim), bases[x].fps, atlas (its file name),
//   atlas_v (the atlas's cache key; publish.py stamps it) and select: overrides for SELECT below, in ITS key names, for
//   tuning without code. A select block is taken only when it says "page": 1 (then a key that isn't SELECT's, or isn't
//   a number, is skipped with a warning) or when every key is SELECT's with a number; anything else is another
//   planner's settings and is ignored whole, with a warning (the page then plans with SELECT as it stands).
//
// THIS IS THE ONE SPEC. production/popmouth_plan.py is its numpy twin, which mouthlib.py / mouthswap.py are to plan and
// composite through (plan_line, pick_offline, cell_matrix, composite); web/test_popmouth.mjs checks that the two give
// identical paths, alphas, costs, offline picks and patch matrices. All arithmetic is float64, sums run over the dims
// in order.
//
// SELECTION:
//  1. The line's frames: one per base-video frame, frame k at take time k / fps (0 = the first sample of the padded
//     take, as for env and vis), n = max(1, ceil(dur * fps - 1e-6)), dur = the packet's dur (else env bytes * 20 ms).
//  2. Sample at s = k / fps + calib.lag_ms / 1000 + lead_s (summed in that order), linearly between 20 ms frames
//     (frame i at i * 20 ms, 0 outside the timeline): vis jaw byte vj, vis round byte vr, env byte e. No vis (or not
//     2 bytes per env byte): vj = 255 * clamp01((e - 85) / 110), vr = 0. lead_s is the recorded clips' own offset
//     (avatar.js LIP_S = -0.08: a clip's video time = the take time heard - 0.08 s, which keeps about half of
//     Popcorn's natural lead), so a live line's mouth sits on her voice exactly as a clip's does. It is applied here
//     only, never again at draw time.
//  3. Target, per dim: jaw = calib.jaw(vj), round = calib.round(vr), env = calib.env ? calib.env(e) : e / 255; any
//     other dim 0. A table is piecewise linear in its input, held flat past its ends; no table: x / 255.
//  4. Silent frame: vj < silent_jaw and e < silent_env. A run of silent frames that touches the line's first or last
//     frame, or is at least ceil(rest_s * fps - 1e-6) frames long, is FORCED: the rest patch only.
//  5. Target cost of patch p: sqrt(sum_d w_d (F[p][d] - T[d])^2).
//  6. Candidates per frame: the k patches of lowest target cost (ties: lower index), then the rest patch, then the
//     seqs successors of the frame before's k candidates of lowest accumulated cost (ties: the earlier candidate),
//     in that order (the successors by ascending accumulated cost), without repeats. Forced: [rest].
//  7. Transition i -> j: i == j: stay. j == next(i) (the next patch of i's seqs run; a patch in several runs keeps
//     its first): w_join * J(i, j) - seq_bonus. Otherwise: w_join * J(i, j) + jump. J = the L2 distance of the two
//     join descriptors / norm; norm = the median (sorted[len >> 1]) of that distance over the pairs
//     (p, (p * 7919 + 13) % n) for p < min(n, 4096), q != p; no descriptors: the same, over the target dims (unweighted).
//  8. The path minimises transition(rest -> path[0]) + sum of target costs + the transitions + transition(path[n-1]
//     -> rest): Viterbi, keeping on ties the earlier candidate (so the earlier patch in step 6's order).
//  9. Display weight per frame (alpha): 1; on the idle base (not 'hold'), the frames of a silent run that touches
//     the first or last frame or is at least ceil(fade_s * fps - 1e-6) frames long get 1 - smoothstep(d / ease_s),
//     d = (frames to the nearest frame outside such runs) / fps. Her own mouth shows in long pauses, eased.
//
// COMPOSITING: base frame f = round(mediaTime * base fps), clamped to the track; tt = the take time heard when that
// frame shows (no lead here: step 2 has it; before her voice is heard, the avatar's clock held a frame short of her
// first sound, as given).
//  - A draw for a new base-video frame (requestVideoFrameCallback; offline, every output frame) shows ONE patch, as
//    Popcorn shows one mouth per frame: i = floor(tt * fps + 0.5); i < 0: nothing; past the line (i >= n) its last
//    frame is held (i = n - 1). A = path[i] at weight alpha[i]. Never a blend of two mouths.
//  - Only a draw from requestAnimationFrame (the base paused or stalled > 70 ms, or no rVFC: ~60 Hz on one base
//    frame) cross-fades: i = floor(tt * fps), fr = tt * fps - i; A = path[i], B = path[i + 1] (clamped to the line),
//    B over A at w = smoothstep((fr - 0.5 + h) / 2h), h = min(0.5, xfade_s * fps / 2); weight alpha linear between
//    frames i and i + 1 (0 before frame 0, held past the last).
//  - E = that weight x smoothstep(time since the first draw, or since the base was last cut back to, / ease_s) x after
//    a stop smoothstep(1 - time since the stop / ease_s). The avatar stops a line end_s after its end (tt > dur +
//    end_s) or when another layer takes the square. Offline (mouthswap.py): output frame j shows tt = j / fps (video
//    time = take time; the first draw at j = 0, the stop at the first j with tt > dur + end_s).
//  Patch p is drawn through Display . (ref px -> video px) . Track[f] . Cell, where Cell maps atlas cell px to ref px
//  (u / scale + region x, v / scale + region y) and Track [a, b, tx, ty] is REF -> that frame: x' = a x - b y + tx,
//  y' = b x + a y + ty. A at opacity E, then B over it at opacity E * w. A patch's gain multiplies its atlas RGB (baked
//  into the atlas once at load; a library that bakes it itself writes [1, 1, 1]). Any error while drawing turns the
//  live mouth off for the session (the canvas cleared: plain Popcorn Gigi, never a frozen patch).

export const HOP_S = 0.02;   // the env / vis grid
export const SELECT = Object.freeze({
  fps: 30,          // the path's grid: one patch per base-video frame
  k: 12,            // candidates per frame by target cost (plus the rest patch and the run successors)
  w_join: 0.45,     // join cost: the descriptor distance, normalised so a typical pair of patches is 1
  seq_bonus: 0.15,  // continuing a seqs run (the next frame of the same Popcorn take: natural motion)
  jump: 0.2,        // any other change of patch (with w_join: ~0.03 A-B-A flickers/s on the 44 clips' lips)
  stay: 0.02,       // holding one patch (a frozen mouth reads dead on a held vowel)
  silent_jaw: 8,    // a frame is silent below both: vis jaw byte,
  silent_env: 60,   // and env byte (-46 dB)
  rest_s: 0.15,     // a silent stretch this long is the rest patch
  fade_s: 0.4,      // an inner silent stretch this long fades back to the base's own mouth (idle base only)
  ease_s: 0.12,     // ease in from / out to the base mouth
  xfade_s: 0.016,   // rAF draws only (a stalled base): cross-fade between successive patches, around each boundary
  lead_s: -0.08,    // step 2's offset = avatar.js LIP_S (the avatar passes its own; display latency is measured per frame)
  end_s: 0.15,      // the avatar lets a line go this long after its end, then the mouth eases out
});
// a mouth.json select block in the page's own key names: {page: 1, ...} or only SELECT's keys (see the header)
export function pageSelect(sel, warn = []) {
  if (sel === undefined || sel === null) return null;
  if (!isObj(sel)) { warn.push('mouth.json select is not an object: ignored'); return null; }
  if ('page' in sel && sel.page !== 1) { warn.push(`mouth.json select is page format ${sel.page}, not 1: ignored, SELECT runs`); return null; }
  const valid = ([key, v]) => key in SELECT && Number.isFinite(v) && (key !== 'k' || (Number.isInteger(v) && v >= 1)) && (key !== 'fps' || v > 0);
  const all = Object.entries(sel).filter(([key]) => key !== 'page'), good = all.filter(valid), bad = all.filter((e) => !valid(e)).map(([key]) => key);
  if (sel.page !== 1 && bad.length) {
    warn.push(`mouth.json select is not the page's (${bad.join(', ')}): ignored whole, SELECT runs (give it "page": 1 and SELECT's key names)`);
    return null;
  }
  if (bad.length) warn.push(`mouth.json select: skipped ${bad.join(', ')} (not SELECT's, or not a valid number)`);
  return good.length ? Object.fromEntries(good) : null;
}
const STALL_MS = 70;   // no new base-video frame for this long (paused, stalled, no rVFC): draw from rAF
const GAP_MS = 250;    // a take time missing for less than this runs on from the last one
const LOG_N = 600;
const KEEP = 8;        // plans kept (the line playing and a few before it)

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const int = (x, d) => (Number.isInteger(x) ? x : d);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const smooth = (x) => { const k = clamp01(x); return k * k * (3 - 2 * k); };

export function bytes(b64) {
  if (typeof b64 !== 'string' || !b64) return null;
  try {
    const s = atob(b64), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out.length ? out : null;
  } catch { return null; }
}

export function halfToFloat(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

// n float16s, little-endian (numpy's float16 tobytes()), or null when there aren't that many
export function f16(b64, n) {
  const b = bytes(b64);
  if (!b || n <= 0 || b.length < 2 * n) return null;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = halfToFloat(b[2 * i] | (b[2 * i + 1] << 8));
  return out;
}

// [[in, out], ...] sorted by in, or null (then x / 255)
export function calibTable(pts) {
  if (!Array.isArray(pts)) return null;
  const p = pts.filter((q) => Array.isArray(q) && q.length >= 2 && Number.isFinite(q[0]) && Number.isFinite(q[1]))
    .map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0]);
  return p.length ? p : null;
}

export function calibrate(tab, x) {
  if (!tab) return clamp01(x / 255);
  const L = tab.length;
  if (x <= tab[0][0]) return tab[0][1];
  if (x >= tab[L - 1][0]) return tab[L - 1][1];
  let i = 1;
  while (tab[i][0] < x) i++;
  const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
  return x1 > x0 ? y0 + (y1 - y0) * (x - x0) / (x1 - x0) : y1;
}

// mouth.json -> the library as typed arrays. Throws on anything it can't use.
export function decodeMouth(j) {
  if (!isObj(j) || j.v !== 1) throw new Error('mouth.json: not v1');
  const P = Array.isArray(j.patches) ? j.patches : [], n = P.length;
  if (!n) throw new Error('mouth.json: no patches');
  const region = Array.isArray(j.region) && j.region.length === 4 && j.region.every(Number.isFinite) ? j.region.slice() : null;
  if (!region || region[2] <= 0 || region[3] <= 0) throw new Error('mouth.json: bad region');
  const scale = num(j.scale, 0) > 0 ? j.scale : 1;
  const cell = Array.isArray(j.cell) && j.cell.length === 2 && j.cell.every((x) => Number.isFinite(x) && x > 0)
    ? j.cell.slice() : [Math.round(region[2] * scale), Math.round(region[3] * scale)];
  const cols = int(j.cols, 0) > 0 ? j.cols : 1;
  const fe = isObj(j.feats) ? j.feats : {};
  const dims = Array.isArray(fe.dims) && fe.dims.length ? fe.dims.map(String) : ['jaw', 'round', 'env'];
  const D = dims.length, W = Float64Array.from(dims, (_, d) => Math.max(0, num(Array.isArray(fe.weights) ? fe.weights[d] : undefined, 1)));
  const F = new Float64Array(n * D), col = new Int32Array(n), row = new Int32Array(n), gain = new Float32Array(n * 3).fill(1);
  const src = new Array(n).fill(''), seen = new Uint8Array(n);
  P.forEach((p, k) => {
    const q = isObj(p) ? p : {}, i = Number.isInteger(q.i) && q.i >= 0 && q.i < n ? q.i : k;
    if (seen[i]) throw new Error(`mouth.json: patch ${i} twice`);
    seen[i] = 1;
    for (let d = 0; d < D; d++) F[i * D + d] = num(q[dims[d]], 0);
    col[i] = int(q.col, i % cols);
    row[i] = int(q.row, Math.floor(i / cols));
    if (Array.isArray(q.gain) && q.gain.length === 3) for (let c = 0; c < 3; c++) gain[i * 3 + c] = num(q.gain[c], 0) > 0 ? q.gain[c] : 1;
    src[i] = typeof q.src === 'string' ? q.src : '';
  });
  const J = isObj(j.join) ? j.join : {};
  let k = int(J.k, 0) > 0 ? J.k : 0;
  const desc = k ? f16(J.desc, n * k) : null;
  if (!desc) k = 0;
  else for (let x = 0; x < desc.length; x++) if (!Number.isFinite(desc[x])) desc[x] = 0;
  const ok = (x) => Number.isInteger(x) && x >= 0 && x < n;
  const next = new Int32Array(n).fill(-1);
  for (const s of Array.isArray(j.seqs) ? j.seqs : []) {
    if (!Array.isArray(s)) continue;
    for (let a = 0; a + 1 < s.length; a++) if (ok(s[a]) && ok(s[a + 1]) && s[a] !== s[a + 1] && next[s[a]] < 0) next[s[a]] = s[a + 1];
  }
  let rest = ok(j.rest) ? j.rest : -1;
  if (rest < 0) {   // no rest given: the most closed mouth
    const dj = dims.indexOf('jaw');
    rest = 0;
    if (dj >= 0) for (let i = 1; i < n; i++) if (F[i * D + dj] < F[rest * D + dj]) rest = i;
  }
  const C = isObj(j.calib) ? j.calib : {};
  const calib = { lag: num(C.lag_ms, 0) / 1000, jaw: calibTable(C.jaw), round: calibTable(C.round), env: calibTable(C.env) };
  const bases = {};
  for (const [id, b] of Object.entries(isObj(j.bases) ? j.bases : {})) {
    if (!isObj(b) || !Array.isArray(b.track) || !b.track.length) continue;
    const frames = Math.min(b.track.length, int(b.frames, b.track.length) > 0 ? int(b.frames, b.track.length) : b.track.length);
    const track = new Float32Array(frames * 4);
    for (let f = 0; f < frames; f++) {
      const m = b.track[f], good = Array.isArray(m) && m.length >= 4 && m.slice(0, 4).every(Number.isFinite);
      track.set(good ? m.slice(0, 4) : [1, 0, 0, 0], f * 4);
    }
    bases[id] = { id, video: typeof b.video === 'string' ? b.video : '', frames, fps: num(b.fps, 0) > 0 ? b.fps : 0, track };
  }
  const ref = isObj(j.ref) ? j.ref : {};
  const warn = [], select = pageSelect(j.select, warn);   // (PopMouth.load prints the warnings)
  const M = { n, D, dims, W, F, col, row, gain, src, k, desc, next, rest, calib, region, cell, scale, cols, bases,
    size: num(ref.size, 720) > 0 ? num(ref.size, 720) : 720, select, warn, norm: 1 };
  M.norm = joinNorm(M);
  return M;
}

function rawJoin(M, i, j) {
  const m = M.k || M.D, X = M.k ? M.desc : M.F;
  let s = 0;
  for (let d = 0; d < m; d++) { const x = X[i * m + d] - X[j * m + d]; s += x * x; }
  return Math.sqrt(s);
}

export function joinNorm(M) {
  const n = M.n, ds = [];
  for (let p = 0; p < Math.min(n, 4096); p++) { const q = (p * 7919 + 13) % n; if (q !== p) ds.push(rawJoin(M, p, q)); }
  ds.sort((a, b) => a - b);
  const med = ds.length ? ds[ds.length >> 1] : 1;
  return med > 1e-9 ? med : 1;
}

export const joinCost = (M, i, j) => rawJoin(M, i, j) / M.norm;

export function transition(M, i, j, S = SELECT) {
  if (i === j) return S.stay;
  const c = S.w_join * joinCost(M, i, j);
  return M.next[i] === j ? c - S.seq_bonus : c + S.jump;
}

// a timeline value at s seconds: linear between its 20 ms frames (frame i at i * 20 ms), 0 outside
function sample(arr, s, stride, o) {
  const f = s / HOP_S, i = Math.floor(f), a = f - i, m = Math.floor(arr.length / stride);
  const g = (q) => (q >= 0 && q < m ? arr[q * stride + o] : 0);
  return (1 - a) * g(i) + a * g(i + 1);
}

// The line's targets per path frame (steps 1-4), its silent / forced / faded frames and where her speech is.
export function lineTargets(M, pk, S = SELECT) {
  const env = bytes(pk && pk.env);
  if (!env) return null;
  let vis = bytes(pk.vis);
  if (vis && vis.length !== 2 * env.length) vis = null;   // another take's lips: run on loudness
  const dur = num(pk.dur, 0) > 0 ? pk.dur : env.length * HOP_S;
  const fps = S.fps, n = Math.max(1, Math.ceil(dur * fps - 1e-6)), D = M.D, T = new Float64Array(n * D);
  const silent = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const s = k / fps + M.calib.lag + S.lead_s, e = sample(env, s, 1, 0);
    const vj = vis ? sample(vis, s, 2, 0) : 255 * clamp01((e - 85) / 110), vr = vis ? sample(vis, s, 2, 1) : 0;
    for (let d = 0; d < D; d++) {
      const nm = M.dims[d];
      T[k * D + d] = nm === 'jaw' ? calibrate(M.calib.jaw, vj) : nm === 'round' ? calibrate(M.calib.round, vr)
        : nm === 'env' ? (M.calib.env ? calibrate(M.calib.env, e) : e / 255) : 0;
    }
    silent[k] = vj < S.silent_jaw && e < S.silent_env ? 1 : 0;
  }
  const forced = new Uint8Array(n), hidden = new Uint8Array(n);
  const restN = Math.max(1, Math.ceil(S.rest_s * fps - 1e-6)), fadeN = Math.max(1, Math.ceil(S.fade_s * fps - 1e-6));
  for (let a = 0; a < n;) {
    if (!silent[a]) { a++; continue; }
    let b = a;
    while (b < n && silent[b]) b++;
    const edge = a === 0 || b === n;
    if (edge || b - a >= restN) forced.fill(1, a, b);
    if (edge || b - a >= fadeN) hidden.fill(1, a, b);
    a = b;
  }
  let from = -1, to = -1;
  for (let k = 0; k < n; k++) if (!silent[k]) { if (from < 0) from = k; to = k; }
  return { n, fps, dur, T, silent, forced, hidden, vis: !!vis,
    speechFrom: from < 0 ? dur : from / fps, speechTo: to < 0 ? 0 : to / fps };
}

// step 9
export function alphaOf(L, S = SELECT, hold = false) {
  const n = L.n, a = new Float64Array(n).fill(1);
  if (hold) return a;
  const dl = new Float64Array(n);
  let last = -1e9;
  for (let k = 0; k < n; k++) { if (!L.hidden[k]) last = k; dl[k] = k - last; }
  last = 1e9;
  for (let k = n - 1; k >= 0; k--) {
    if (!L.hidden[k]) last = k;
    if (L.hidden[k]) a[k] = 1 - smooth(Math.min(dl[k], last - k) / L.fps / S.ease_s);
  }
  return a;
}

// the k lowest of tc (ties: lower index), ascending
function topK(tc, K) {
  const out = [];
  for (let i = 0; i < tc.length; i++) {
    const v = tc[i];
    if (out.length === K && v >= tc[out[K - 1]]) continue;
    let p = out.length < K ? out.length : K - 1;
    if (out.length < K) out.push(i); else out[p] = i;
    while (p > 0 && tc[out[p - 1]] > v) { out[p] = out[p - 1]; out[p - 1] = i; p--; }
  }
  return out;
}

// steps 5-8: the patch for every frame of the line
export function viterbi(M, L, S = SELECT) {
  const { n: N, D, F, W, next, rest } = M, n = L.n, K = Math.max(1, Math.min(int(S.k, 12), N));
  const tc = new Float64Array(N), cands = [], backs = [];
  let prevC = null, prevCost = null, maxC = 0;
  for (let f = 0; f < n; f++) {
    const o = f * D;
    for (let p = 0; p < N; p++) {
      let s = 0;
      for (let d = 0; d < D; d++) { const x = F[p * D + d] - L.T[o + d]; s += W[d] * x * x; }
      tc[p] = Math.sqrt(s);
    }
    let C;
    if (L.forced[f]) C = [rest];
    else {
      const seen = new Set(topK(tc, K));
      seen.add(rest);
      if (prevC) for (const b of topK(prevCost, K)) if (next[prevC[b]] >= 0) seen.add(next[prevC[b]]);   // runs can go on
      C = [...seen];
    }
    const cost = new Float64Array(C.length), back = new Int32Array(C.length);
    for (let a = 0; a < C.length; a++) {
      const j = C[a];
      if (!prevC) { cost[a] = transition(M, rest, j, S) + tc[j]; back[a] = -1; continue; }
      let best = Infinity, bi = 0;
      for (let b = 0; b < prevC.length; b++) { const v = prevCost[b] + transition(M, prevC[b], j, S); if (v < best) { best = v; bi = b; } }
      cost[a] = best + tc[j];
      back[a] = bi;
    }
    cands.push(C);
    backs.push(back);
    if (C.length > maxC) maxC = C.length;   // (bounded: k + 1 + k)
    prevC = C;
    prevCost = cost;
  }
  let best = Infinity, bi = 0;
  for (let a = 0; a < prevC.length; a++) { const v = prevCost[a] + transition(M, prevC[a], rest, S); if (v < best) { best = v; bi = a; } }
  const path = new Int32Array(n);
  for (let f = n - 1; f >= 0; f--) { path[f] = cands[f][bi]; bi = backs[f][bi]; }
  return { path, cost: best, maxC };
}

// how a path moves: changes that continue a seqs run, other jumps, A-B-A flickers (one frame of another mouth) and
// jitters (A-B-A with B a frame next to A in its take: 33 ms of the same motion, barely visible)
export function pathStats(M, path, fps = SELECT.fps) {
  let seq = 0, jumps = 0, flicker = 0, jitter = 0;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k];
    if (a === b) continue;
    if (M.next[a] === b) seq++; else jumps++;
    if (k + 1 < path.length && path[k + 1] === a) { if (M.next[a] === b || M.next[b] === a) jitter++; else flicker++; }
  }
  const s = Math.max(1e-9, path.length / fps);
  return { seq, jumps, flicker, jitter, jumpsPerS: jumps / s, changesPerS: (seq + jumps) / s };
}

// a whole line: targets, path and display weights. hold: the talk base (her own mouth never shows mid-line)
export function planLine(M, pk, S = SELECT, hold = false) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const L = lineTargets(M, pk, S);
  if (!L) return null;
  const { path, cost, maxC } = viterbi(M, L, S);
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return { id: String(pk.id || ''), n: L.n, fps: L.fps, dur: L.dur, path, alpha: alphaOf(L, S, hold), hold: !!hold,
    speechFrom: L.speechFrom, speechTo: L.speechTo, cost, ms, maxC, stats: pathStats(M, path, L.fps) };
}

// a plan's cache key: the packet's content (id, dur, and a hash of its timelines), not its id alone
function fnv(str, h = 0x811c9dc5) {
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
export function planKey(pk, hold = false) {
  const env = String(pk.env || ''), vis = String(pk.vis || '');
  return `${pk.id}|${hold ? 1 : 0}|${num(pk.dur, 0)}|${env.length}.${vis.length}|${fnv(vis, fnv(env)).toString(36)}`;
}

// what to draw at take time tt: patches A and B (B over A at weight w), and the line's display weight there.
// frame: a draw for a new base-video frame, which shows one patch (the nearest frame's: w = 0, b = a); otherwise (rAF,
// a stalled base) the short cross-fade. Past the line its last frame is held, until the avatar stops it
export function pickAt(plan, tt, S = SELECT, frame = false) {
  const n = plan.n, f = tt * plan.fps, none = { a: -1, b: -1, w: 0, alpha: 0 };
  if (!Number.isFinite(f)) return none;
  const last = (k) => Math.max(0, Math.min(n - 1, k));
  if (frame) {
    const i = Math.floor(f + 0.5);
    if (i < 0) return none;
    const k = last(i), a = plan.path[k];
    return { a, b: a, w: 0, alpha: plan.alpha[k] };
  }
  if (f < -1) return none;
  const i = Math.floor(f), fr = f - i, at = (k) => plan.path[last(k)];
  const al = (k) => (k < 0 ? 0 : plan.alpha[last(k)]);
  const h = Math.min(0.5, S.xfade_s * plan.fps / 2);
  const w = h > 0 ? smooth((fr - 0.5 + h) / (2 * h)) : fr >= 0.5 ? 1 : 0;
  return { a: at(i), b: at(i + 1), w, alpha: (1 - fr) * al(i) + fr * al(i + 1) };
}

// offline (mouthswap.py; popmouth_plan.py pick_offline): output frame j of a line drawn from j = 0 shows take time
// j / fps; what the page draws there, [patch, E] (patch -1: nothing)
export function offlinePick(plan, j, S = SELECT) {
  const tt = j / plan.fps, s = pickAt(plan, tt, S, true);
  if (s.a < 0) return [-1, 0];
  const stop = plan.dur + S.end_s;
  let E = s.alpha * smooth(tt / S.ease_s);
  if (tt > stop) {
    let j0 = j;   // the stop: the first output frame past dur + end_s
    while (j0 > 0 && (j0 - 1) / plan.fps > stop) j0--;
    E *= smooth(1 - (tt - j0 / plan.fps) / S.ease_s);
  }
  return [E > 0.003 ? s.a : -1, E > 0.003 ? E : 0];
}

// 2D affine matrices as canvas's setTransform(a, b, c, d, e, f): x' = a x + c y + e, y' = b x + d y + f
export const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3],
  A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// CSS object-position, computed ("50% 32%", "10px 0px"): the content's offset in its box
function posOf(str, freeW, freeH) {
  const t = String(str || '50% 50%').trim().split(/\s+/), one = (s, free) => {
    if (s === 'left' || s === 'top') return 0;
    if (s === 'right' || s === 'bottom') return free;
    if (s === 'center') return free / 2;
    const v = parseFloat(s);
    if (!Number.isFinite(v)) return free / 2;
    return /%$/.test(s) ? free * v / 100 : v;
  };
  return [one(t[0], freeW), one(t[1] === undefined ? t[0] : t[1], freeH)];
}

// video px -> box px, for the element's object-fit / object-position (box W x H css px, video vw x vh)
export function displayMap(W, H, vw, vh, fit = 'fill', pos = '50% 50%') {
  let sx = W / vw, sy = H / vh;
  if (fit === 'contain' || fit === 'cover' || fit === 'none' || fit === 'scale-down') {
    let s = fit === 'contain' ? Math.min(sx, sy) : fit === 'cover' ? Math.max(sx, sy) : 1;
    if (fit === 'scale-down') s = Math.min(1, Math.min(sx, sy));
    sx = sy = s;
  }
  const [ox, oy] = posOf(pos, W - vw * sx, H - vh * sy);
  return [sx, 0, 0, sy, ox, oy];
}

// atlas cell px -> canvas px for base frame f: Display . (ref -> video px) . Track[f] . Cell
export function patchMatrix(M, track, f, Dm, kx = 1, ky = kx) {
  const o = 4 * f, a = track[o], b = track[o + 1], T = [a, b, -b, a, track[o + 2], track[o + 3]];
  const P = [1 / M.scale, 0, 0, 1 / M.scale, M.region[0], M.region[1]];
  return mul(Dm, mul([kx, 0, 0, ky, 0, 0], mul(T, P)));
}

// the canvas px a cell covers under m (integer, padded), clipped to the canvas
function bbox(m, cw, ch, W, H) {
  const pts = [apply(m, 0, 0), apply(m, cw, 0), apply(m, 0, ch), apply(m, cw, ch)];
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0]))) - 2), y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1]))) - 2);
  const x1 = Math.min(W, Math.ceil(Math.max(...pts.map((p) => p[0]))) + 2), y1 = Math.min(H, Math.ceil(Math.max(...pts.map((p) => p[1]))) + 2);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}

// a gain other than 1 multiplies its cell's RGB, once (a copy of the atlas on a canvas)
function bakeGains(img, M) {
  let any = false;
  for (let x = 0; x < M.gain.length && !any; x++) any = Math.abs(M.gain[x] - 1) > 0.005;
  if (!any) return img;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const g = cv.getContext('2d', { willReadFrequently: true }), [cw, ch] = M.cell;
  g.drawImage(img, 0, 0);
  for (let i = 0; i < M.n; i++) {
    const r = M.gain[3 * i], gg = M.gain[3 * i + 1], bb = M.gain[3 * i + 2];
    if (Math.abs(r - 1) <= 0.005 && Math.abs(gg - 1) <= 0.005 && Math.abs(bb - 1) <= 0.005) continue;
    const x = Math.round(M.col[i] * cw), y = Math.round(M.row[i] * ch), im = g.getImageData(x, y, Math.round(cw), Math.round(ch)), d = im.data;
    for (let p = 0; p < d.length; p += 4) { d[p] *= r; d[p + 1] *= gg; d[p + 2] *= bb; }   // clamped by the array
    g.putImageData(im, x, y);
  }
  if (img.close) img.close();
  return cv;
}

export class PopMouth {
  constructor(opts = {}) {
    this.opts = opts = isObj(opts) ? opts : {};
    this.S = { ...SELECT, ...(isObj(opts.select) ? opts.select : {}) };
    this.M = null;
    this.atlas = null;
    this.plans = new Map();
    this.last = null;
    this.canvas = this.ctx = this.video = this.container = null;
    this.baseId = 'idle';
    this.cur = null;      // the line on screen: {plan, base, takeTime, firstAt, stopAt}
    this.D = null;        // video px -> canvas px
    this.dirty = null;    // the canvas px drawn last frame
    this.vfcAt = -1e9;    // when the base last gave a new frame (rAF draws once it hasn't for STALL_MS)
    this.vfc = 0; this.vfcV = null; this.raf = 0;
    this.broken = false;  // a draw failed: the live mouth is off for the session
    this.log = [];        // [page s, take s, patch, weight, base frame]: gigi.pop.log from the console
    this.stats = {};
  }

  // mouth.json and its atlas: true when the library is usable, false on any failure (the page then reports no lips)
  async load(url) {
    try {
      const abs = new URL(url, document.baseURI);
      const r = await fetch(abs, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`mouth.json ${r.status}`);
      const j = await r.json(), M = decodeMouth(j);
      const au = new URL(typeof j.atlas === 'string' && j.atlas ? j.atlas : 'atlas.webp', abs);
      if (j.atlas_v) au.searchParams.set('v', String(j.atlas_v));
      const ar = await fetch(au);
      if (!ar.ok) throw new Error(`atlas ${ar.status}`);
      let img = await createImageBitmap(await ar.blob());
      let rows = 0, cols = 0;
      for (let i = 0; i < M.n; i++) { rows = Math.max(rows, M.row[i] + 1); cols = Math.max(cols, M.col[i] + 1); }
      if (img.width + 0.5 < cols * M.cell[0] || img.height + 0.5 < rows * M.cell[1]) throw new Error(`atlas ${img.width}x${img.height} is smaller than its ${cols}x${rows} cells`);
      if (this.opts.gain !== false) img = bakeGains(img, M);
      for (const w of M.warn) console.warn('popmouth:', w);
      if (M.select) this.S = { ...this.S, ...M.select, ...(isObj(this.opts.select) ? this.opts.select : {}) };
      this.M = M;
      this.atlas = img;
      this.stats = { patches: M.n, bases: Object.keys(M.bases), desc: M.k, atlas: `${img.width}x${img.height}` };
      return true;
    } catch (e) {
      console.warn('popmouth: no live mouth:', e);
      return false;
    }
  }

  hasBase(id) { return !!(this.M && this.M.bases[id]); }

  // the line's path, computed once per packet (when it arrives, ahead of her voice); null without a library
  plan(pk, { hold = false } = {}) {
    if (!this.M || !pk || typeof pk.id !== 'string') return null;
    const key = planKey(pk, hold);   // by content: an agent re-dispatched into the room numbers its lines from live-1 again
    if (this.plans.has(key)) return (this.last = this.plans.get(key));
    let p = null;
    try { p = planLine(this.M, pk, this.S, hold); } catch (e) { console.warn('popmouth: plan', e); return null; }
    if (!p) return null;
    this.plans.set(key, p);
    while (this.plans.size > KEEP) this.plans.delete(this.plans.keys().next().value);
    this.stats.plan = { id: p.id, ms: +p.ms.toFixed(1), frames: p.n, ...p.stats };
    return (this.last = p);
  }

  // a canvas exactly over the base video (its box, transform and stacking; the square's feathering is its parent's
  // mask, so it applies to both). Again with another video switches the base.
  attach(video, container = video && video.parentElement, baseId = this.baseId) {
    if (!this.canvas) {
      const c = this.canvas = document.createElement('canvas');
      c.className = 'gigi-mouth';
      c.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;display:block';
      this.ctx = c.getContext('2d');
    }
    if (video !== this.video) { this.unvfc(); this.dirty = null; }
    this.video = video;
    this.container = container;
    this.baseId = baseId;
    if (container && this.canvas.parentElement !== container && !(video && video.parentElement === container)) container.appendChild(this.canvas);
    this.raise();
    this.layout(true);
  }

  // right over the base video: after it in its parent, on its z-index (a layer cut over the base later is above both)
  raise() {
    const v = this.video, c = this.canvas;
    if (!v || !c) return;
    if (v.parentElement && (c.parentElement !== v.parentElement || c.previousElementSibling !== v)) v.after(c);
    if (c.style.zIndex !== v.style.zIndex) c.style.zIndex = v.style.zIndex;
  }

  // the line's weight eases in again from now (the base has just been cut to)
  easeIn() { if (this.cur) this.cur.firstAt = performance.now(); }

  layout(force = false) {
    const v = this.video, c = this.canvas;
    if (!v || !c) return;
    const w = v.offsetWidth, h = v.offsetHeight, dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const key = `${v.offsetLeft},${v.offsetTop},${w}x${h}@${dpr}|${v.videoWidth}x${v.videoHeight}`;
    this.lcount = (this.lcount || 0) + 1;
    if (!force && key === this.lkey && this.lcount < 30) return;   // the style is re-read every 30 draws anyway
    this.lkey = key;
    this.lcount = 0;
    const cs = getComputedStyle(v);
    Object.assign(c.style, { left: `${v.offsetLeft}px`, top: `${v.offsetTop}px`, width: `${w}px`, height: `${h}px`,
      transform: cs.transform && cs.transform !== 'none' ? cs.transform : '', transformOrigin: cs.transformOrigin || '' });
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; this.dirty = null; }   // a resize clears it
    this.D = w && h && v.videoWidth && v.videoHeight
      ? mul([W / w, 0, 0, H / h, 0, 0], displayMap(w, h, v.videoWidth, v.videoHeight, cs.objectFit || 'fill', cs.objectPosition))
      : null;
  }

  // draw the planned line on the base video, its take time read from takeTime() (the take time heard, s; null while
  // unknown), until stop(). opts.held(): true while that time is a guess held short of her voice (nothing heard yet):
  // then it is drawn as given, without the frame's display delay, so the mouth never reaches her first open frame early
  start(takeTime, opts = {}) {
    const plan = opts.plan || this.last, base = this.M && this.M.bases[opts.base || this.baseId];
    if (this.broken || !plan || !base || !this.video || !this.atlas || typeof takeTime !== 'function') return false;
    try {
      this.halt();
      this.cur = { plan, base, takeTime, held: typeof opts.held === 'function' ? opts.held : null, firstAt: 0, stopAt: 0, lastT: 0, lastP: 0, warned: false };
      this.raise();
      this.layout(true);
      this.loop();
      return true;
    } catch (e) { this.fail(e, 'starting a line'); return false; }   // (off for the session, as a draw that throws)
  }

  // ease out to the base mouth (fade) or go at once
  stop(fade = true) {
    if (!this.cur) return;
    if (!fade) this.halt();
    else if (!this.cur.stopAt) this.cur.stopAt = performance.now();
  }

  halt() {
    this.cur = null;
    this.unvfc();
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.clear();
  }

  dispose() {
    this.halt();
    if (this.canvas) this.canvas.remove();
    if (this.atlas && this.atlas.close) this.atlas.close();
    this.canvas = this.ctx = this.atlas = this.video = null;
    this.plans.clear();
  }

  // a draw that throws (or a start, or the avatar's live-line step: fail()) turns the live mouth off for the session:
  // the canvas cleared (plain Popcorn Gigi, never a frozen patch over a moving head), both draw chains stopped, start()
  // refused from then on
  safeDraw(now, meta) {
    if (this.broken) return;
    try { this.draw(now, meta); } catch (e) { this.fail(e); }
  }

  fail(e, what = 'drawing') {
    if (this.broken) return;
    this.broken = true;
    console.warn(`popmouth: ${what} failed, the live mouth is off:`, e);
    this.cur = null;
    try { this.unvfc(); } catch { this.vfcV = this.vfcTok = null; this.vfc = 0; }
    if (this.raf) { try { cancelAnimationFrame(this.raf); } catch { /* gone */ } this.raf = 0; }
    try {
      this.dirty = null;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    } catch { try { this.canvas.remove(); } catch { /* nothing left to show */ } }
  }

  unvfc() {
    if (this.vfcV && this.vfc && this.vfcV.cancelVideoFrameCallback) this.vfcV.cancelVideoFrameCallback(this.vfc);
    this.vfcV = this.vfcTok = null;
    this.vfc = 0;
  }

  // every base-video frame (requestVideoFrameCallback: the canvas changes with the frame it belongs to), and from rAF
  // whenever no frame has come for a while (a paused or stalled base, or no rVFC). One chain of each: a callback from
  // a chain that was stopped (its token replaced) does nothing and never asks again
  loop() {
    const v = this.video;
    if (v && typeof v.requestVideoFrameCallback === 'function' && this.vfcV !== v) {
      this.unvfc();
      const tok = {};
      const cb = (now, meta) => {
        if (this.vfcTok !== tok) return;
        this.vfcAt = now;
        if (this.cur) this.safeDraw(now, meta);
        if (this.vfcTok !== tok) return;   // the draw halted it
        if (this.cur) this.vfc = v.requestVideoFrameCallback(cb); else this.unvfc();
      };
      this.vfcV = v;
      this.vfcTok = tok;
      this.vfcAt = performance.now();   // a frame is due: rAF waits STALL_MS for it
      this.vfc = v.requestVideoFrameCallback(cb);
    }
    if (!this.raf) {
      const tick = (now) => {
        this.raf = 0;
        if (!this.cur) return;
        if (!this.vfcV || now - this.vfcAt > STALL_MS) this.safeDraw(now, null);   // every tick while the base gives no frames
        if (this.cur && !this.raf) this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }
  }

  clear() {
    const d = this.dirty, ctx = this.ctx;
    this.dirty = null;
    if (!d || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(d[0], d[1], d[2], d[3]);
  }

  cell(i) {
    const [cw, ch] = this.M.cell;
    this.ctx.drawImage(this.atlas, this.M.col[i] * cw, this.M.row[i] * ch, cw, ch, 0, 0, cw, ch);
  }

  trace(t, p, E, f) {
    this.log.push([+(performance.now() / 1000).toFixed(3), t === null || !Number.isFinite(t) ? null : +t.toFixed(3), p, +E.toFixed(2), f]);
    if (this.log.length > LOG_N + 200) this.log.splice(0, 200);
  }

  draw(now, meta) {
    const c = this.cur, v = this.video, ctx = this.ctx, S = this.S;
    if (!c || !v || !ctx || !this.atlas) return;
    const P = performance.now();
    this.raise();
    this.layout();
    this.clear();
    let E = 1;
    if (c.stopAt) {
      const k = 1 - (P - c.stopAt) / (S.ease_s * 1000);
      if (k <= 0) { this.halt(); return; }
      E = smooth(k);
    }
    if (!this.D) return;   // the base has no frame size yet
    const base = c.base, N = base.frames;
    const fps = base.fps || (v.duration > 0 ? N / v.duration : S.fps);
    if (!c.warned && v.duration > 0 && Math.abs(N / v.duration - 30) > 1 && !base.fps) {
      c.warned = true;
      console.warn(`popmouth: ${base.id} track has ${N} frames for ${v.duration.toFixed(2)} s (not 30 fps): a stale track?`);
    }
    const mt = meta && Number.isFinite(meta.mediaTime) ? meta.mediaTime : v.currentTime;
    const f = Math.max(0, Math.min(N - 1, Math.round(mt * fps)));
    // the take time heard when this frame shows: rVFC says when that is
    const ahead = meta && Number.isFinite(meta.expectedDisplayTime) ? Math.max(0, Math.min(0.1, (meta.expectedDisplayTime - P) / 1000)) : 1 / 60;
    let t = c.takeTime(), held = !!(c.held && c.held());
    if (t === null || !Number.isFinite(t)) {
      // the line let go of (stopping), or a moment's gap in the lip lock: the take runs on from the last time known
      if (c.lastP && (c.stopAt || P - c.lastP < GAP_MS)) { t = c.lastT + (P - c.lastP) / 1000; held = false; }
      else { this.trace(null, -1, 0, f); return; }
    } else { c.lastT = t; c.lastP = P; }
    if (!c.firstAt) c.firstAt = P;
    const s = pickAt(c.plan, held ? t : t + ahead, S, !!meta);   // (lead_s is in the plan's targets: step 2)
    E *= s.alpha * smooth((P - c.firstAt) / (S.ease_s * 1000));
    if (E <= 0.003 || s.a < 0) { this.trace(t, -1, 0, f); return; }
    const m = patchMatrix(this.M, base.track, f, this.D, v.videoWidth / this.M.size, v.videoHeight / this.M.size);
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = E;
    this.cell(s.a);
    if (s.b !== s.a && s.w > 0.003) { ctx.globalAlpha = E * s.w; this.cell(s.b); }
    ctx.globalAlpha = 1;
    this.dirty = bbox(m, this.M.cell[0], this.M.cell[1], this.canvas.width, this.canvas.height);
    this.trace(t, s.w >= 0.5 ? s.b : s.a, E, f);
  }
}
