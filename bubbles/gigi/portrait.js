// Gigi as a live 2D portrait (the lab; Max, 2026-10-18: "we need a 2d render ... she's breathing and you can see that
// with her chakras ... a gigi that just looks directly at the camera like a human"). Popcorn's own pixels are the
// master: idle.mp4 frame 0 (MASTER SPACE, 720 x 720), never a flat still. Every frame:
//   1. the face, in master space (an offscreen 720 x 720 target): master.webp, the mouth patch(es) from the Popcorn
//      mouth library (gigi/mouth/: chosen by unit selection, popmouth.js, cross-blended by sub-frame time) and the
//      eye patch for this moment of a blink (exactly one level a frame, drawn timing: blinkSheet). A mouth patch that reaches past
//      her rest silhouette (a dropped jaw) adds to her matte wherever it differs from the background under it;
// 2. the screen: the oasis (framing.stage, laid out exactly as the page's square, or the plate), held still (a fixed
//      camera: the scene never swims when she turns), then Gigi as a dense mesh textured with that face and cut by her matte (gigi.webp), deformed
//      per vertex: breath (a scale about the chest and a lift of her neck and head), the head turned in 3D about its
//      pivot with the depth map as its volume (2.5D parallax: her muzzle moves more than her ears), the neck following
//      and swaying from its base, the ears flicking about their own pivots;
//   3. her chakras: additive glow (a hot core, a wide halo, a soft bloom) at the deformed orb centres. Only light is
//      added: an orb at rest is the painted orb.
// A controller keeps her alive between and under the lines (all on critically damped springs, seedable noise): her
// own breath (4.5-6 s), head micro-motion that is never still, slow nods and tilts, ear flicks, blinks with in-betweens;
// the page's breath runs (breathRun: the lungs follow the pattern exactly, the chakras climb root to crown on the
// inhale, hold lit, fall crown to root on the exhale; breathPhase: a group room's phases, one at a time, the same way); her lines (speak: the mouth path planned once, drawn at the take
// time being heard, nods on stressed syllables, the throat orb with her voice, her head 3-4x as lively as at rest, as
// Popcorn's talk-loop moves); and listening (a tiny lean, a slower breath, slow nods).
//
// Failure is never an empty frame: load() resolves false (the page keeps the video Gigi) on no WebGL2, a shader or
// asset failure, a context lost while loading, or LOAD_TIMEOUT_MS without the core assets; after load, a lost context or
// a failed draw hides the canvas and calls opts.onfail(reason) (opts.onrestore() if the context comes back and she is
// drawn again).
//
// PORTRAIT CONTRACT: <base>/ (default gigi/portrait/)
//   master.webp (RGB 720), gigi.webp (RGBA, her matte), plate.webp (the clean background), depth.webp (grey, 0 far ..
//   255 near), eyes.webp (eye patches with alpha, at openness levels), rig.json:
//   { v: 1, size: 720, mesh: {verts: [[x, y]...], tris: [[i, j, k]...]},
//     weights: {head, neck, body, ear_left, ear_right, breath} (per vertex, 0..1),
//     pivots: {head, neck_base, chest, ear_left, ear_right} ([x, y] master px),
//     orbs: [{name, center: [x, y], r, color: '#rrggbb', host}], eyes: {region, cell, cols, levels: [{openness, col, row}]},
//     mouth: '../mouth/mouth.json', limits: {yaw_deg, pitch_deg, roll_deg, breath_scale, ear_deg, ear_down_deg},
//     framing: {square: [x, y, w, h], stage: {image, w, h, sq: [x0, y0, size]}} }
//   framing.square: Neck and Neck's square, ossicones to the crystal pendant (every chakra in view).
//   Optional, read if present: cache (a key appended as ?v= to every asset URL; portrait.py hashes the images and the
//   stage image into it), mesh.depth8 / mesh.matte (the depth and matte at each vertex: tools and tests), depth.px_per_level (master px of volume per
//   depth level; or depth_px / limits.depth_px: px over the full 0..255 range; default size / 4), pivots_depth.head (or
//   head_depth; 0..255: the depth her head turns about, e.g. her neck's axis; default her head's mean depth: see
//   setDepth), limits.breath_lift_px (the head's rise on a full breath, default size * 0.006).
//
// No DOM and no WebGL at module level: the pure parts (springs, noise, breath, blinks, ears, gestures, accents, the rig,
// the deformation, the layout) and the Controller run in node (web/test_portrait.mjs).

export const PORTRAIT_V = 1;
const TAU = Math.PI * 2, D2R = Math.PI / 180;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const clamp01 = (x) => clamp(x, 0, 1);
export const smooth = (x) => { const k = clamp01(x); return k * k * (3 - 2 * k); };
const lerp = (a, b, t) => a + (b - a) * t;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const pt = (p, d) => (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [p[0], p[1]] : d);

// (ear_deg: how far a flick lifts an ear; ear_down_deg: how far one ever drops, the flick's overshoot and her ear's noise:
// -3.3 at most over 30 min of the controller)
export const LIMITS = Object.freeze({ yaw_deg: 4, pitch_deg: 3, roll_deg: 3, breath_scale: 0.012, ear_deg: 12, ear_down_deg: 5 });
export const HOP_S = 0.02;      // the env / vis grid (production/envelopes.py)
export const ENV_VOICE = 85;    // env byte of -40 dB: voice
const EASE_S = 0.12;            // the mouth eases in from / out to her own (the master's) mouth
const GAP_MS = 250;             // a take time missing for less than this runs on from the last one known
export const AHEAD_S = 1 / 60 + 0.008;   // the take time heard when this frame shows (one frame and the compositor)
const ORB_SPRITE = 4.2;         // an orb's sprite half-size, in orb radii (core, halo and bloom)
const NECK_FOLLOW = 0.45;       // how much of the head's turn the upper neck carries
const BG = [15 / 255, 18 / 255, 56 / 255];   // the page's #0f1238, behind everything
export const LOAD_TIMEOUT_MS = 6000;   // load() gives up (false: the page keeps the video Gigi) past this

// ---------------------------------------------------------------- seedable randomness
export function rng(seed) {   // mulberry32: [0, 1)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash1(seed, i) {   // lattice value in [-1, 1]
  let h = (Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul((seed | 0) + 0x9e3779b9, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 2147483647.5 - 1;
}

// smooth 1D value noise (quintic: continuous to the second derivative), in [-1, 1]
export function noise1(seed, t) {
  const i = Math.floor(t), f = t - i, u = f * f * f * (f * (f * 6 - 15) + 10);
  return lerp(hash1(seed, i), hash1(seed, i + 1), u);
}

// octaves [[Hz, amplitude], ...] summed and normalised: [-1, 1], never still for long
export const OCTAVES = Object.freeze([[0.09, 0.55], [0.23, 0.3], [0.57, 0.15]]);
export function layered(seed, t, oct = OCTAVES) {
  let s = 0, w = 0;
  for (let k = 0; k < oct.length; k++) { s += oct[k][1] * noise1(seed * 31 + k * 7 + 1, t * oct[k][0] + k * 17.31); w += oct[k][1]; }
  return w > 0 ? s / w : 0;
}

// ---------------------------------------------------------------- critically damped spring (exact, any dt)
export class Spring {
  constructor(x = 0, omega = 8) { this.x = x; this.v = 0; this.omega = omega; }
  step(target, dt, omega = this.omega) {
    if (!(dt > 0)) return this.x;
    const w = omega, c1 = this.x - target, c2 = this.v + w * c1, e = Math.exp(-w * dt);
    this.x = target + (c1 + c2 * dt) * e;
    this.v = (c2 - w * (c1 + c2 * dt)) * e;
    return this.x;
  }
  set(x) { this.x = x; this.v = 0; return x; }
}

// ---------------------------------------------------------------- breath
// The daily practice's patterns (agent/practice.py PATTERNS) and the agent's one publish per solo run (breath_run)
export const PATTERNS = Object.freeze({
  coherence: [['in', 5.5], ['out', 5.5]],
  box: [['in', 4], ['hold', 4], ['out', 4], ['hold', 4]],
  478: [['in', 4], ['hold', 7], ['out', 8]],
});
export function breathPlan(pattern = 'coherence', rounds = 1, run = 1) {
  const ph = PATTERNS[pattern] || PATTERNS.coherence;
  return { run, pattern: PATTERNS[pattern] ? pattern : 'coherence', rounds: Math.max(1, rounds | 0), cycle_s: ph.reduce((a, p) => a + p[1], 0),
    phases: ph.map(([k, d]) => [k, d]), lead_s: 0.8, tail_s: 0.8 };
}

// avatar.js's breathAt, exactly (the page's bells and the text pacer run on it): where a run is `ms` after it arrived
function shape(b) {
  const ph = (Array.isArray(b.phases) && b.phases.length ? b.phases : [['in', 5.5], ['out', 5.5]]).map(([k, d]) => [k, Number(d) || 0]);
  const C = Number(b.cycle_s) || ph.reduce((a, p) => a + p[1], 0) || 11;
  return { ph, C, n: Math.max(1, Number(b.rounds) || 1), lead: Number(b.lead_s ?? 0.8), tail: Number(b.tail_s ?? 0.8) };
}
export function breathAt(b, ms) {
  const { ph, C, n, lead, tail } = shape(b), t = ms / 1000, end = lead + n * C + tail;
  if (t < lead) return { part: 'in', t, end };
  const tc = t - lead;
  if (tc >= n * C) return tc < n * C + tail ? { part: 'out', t: tc - n * C, end } : { part: 'done', end };
  const cycle = Math.floor(tc / C), at = tc - cycle * C;
  let i = 0, into = at;
  while (i < ph.length - 1 && into >= ph[i][1]) { into -= ph[i][1]; i++; }
  return { part: 'cycle', cycle, round: cycle + 1, rounds: n, at, C, i, kind: ph[i][0], dur: ph[i][1], into, end };
}

// A run `ms` after it arrived, for her body and her chakras: lungs (0 empty .. 1 full, eased in and out of every
// phase), the run's weight over her own breath (up across the lead-in, down across the tail) and each rung's light
// (root first; n rungs) from `base` to `peak`. The ladder is lit by ~87% of the inhale (so the crown holds a beat at the
// top), a hold keeps what the phase before left, the exhale takes it down from the crown. (gigi3d.js breathLight's ladder.)
export function breathState(b, ms, n, base = 0.12, peak = 1) {
  const s = breathAt(b, ms);
  if (s.part === 'done') return { done: true, s, full: 0, mix: 0, lv: new Array(n).fill(0) };
  const { ph, lead, tail } = shape(b);
  const ladder = (fill) => Array.from({ length: n }, (_, i) => base + (peak - base) * smooth(fill - i));
  if (s.part === 'in') { const k = lead > 0 ? smooth(s.t / lead) : 1; return { done: false, s, full: 0, mix: k, lv: new Array(n).fill(base * k) }; }
  if (s.part === 'out') { const k = tail > 0 ? 1 - smooth(s.t / tail) : 0; return { done: false, s, full: 0, mix: k, lv: new Array(n).fill(base * k) }; }
  const p = s.dur > 0 ? clamp01(s.into / s.dur) : 1, k = 0.5 - 0.5 * Math.cos(Math.PI * p), K = 1.15;
  if (s.kind === 'in') return { done: false, s, full: k, mix: 1, lv: ladder(p * n * K) };
  if (s.kind === 'out') return { done: false, s, full: 1 - k, mix: 1, lv: ladder(n - p * n * K) };
  const up = (ph[(s.i - 1 + ph.length) % ph.length] || [])[0] === 'in';   // a hold after the inhale is full and lit
  return { done: false, s, full: up ? 1 : 0, mix: 1, lv: ladder(up ? n : 0) };
}

// A group room's breath, one phase at a time (the agent's breath attribute, as app.js hands it to the pacer: {kind,
// dur, into, seq, ...}): F = {kind, dur, prev (the kind before it, or null), from (the lungs as it arrived)}, el s into
// it. Lungs and ladder as breathState's: the inhale fills and climbs root to crown, the exhale empties and falls crown
// to root, a hold keeps what came before it (after an inhale: full and lit; after an exhale: empty; unknown: the lungs
// as the hold arrived).
export const PHASE_GRACE_S = 1.5;   // a phase not followed by the next this long after its end: the run is over
export function phaseState(F, el, n, base = 0.12, peak = 1) {
  const ladder = (fill) => Array.from({ length: n }, (_, i) => base + (peak - base) * smooth(fill - i));
  const p = F.dur > 0 ? clamp01(el / F.dur) : 1, k = 0.5 - 0.5 * Math.cos(Math.PI * p), K = 1.15;
  if (F.kind === 'in') return { kind: 'in', full: k, lv: ladder(p * n * K) };
  if (F.kind === 'out') return { kind: 'out', full: 1 - k, lv: ladder(n - p * n * K) };
  const up = F.prev ? F.prev === 'in' : num(F.from, 0) >= 0.5;
  return { kind: 'hold', full: up ? 1 : 0, lv: ladder(up ? n : 0) };
}

// her own breath between runs: lungs over one breath (u in cycles): inhale 40%, exhale 60%, soft at both ends
export function breathWave(u) {
  const f = u - Math.floor(u);
  return f < 0.4 ? smooth(f / 0.4) : 1 - smooth((f - 0.4) / 0.6);
}

// ---------------------------------------------------------------- blinks
export const BLINK = Object.freeze({ close: 0.12, hold: 0.03, open: 0.16, min: 2.5, max: 6, double: 0.18, first: [0.8, 2.5] });

// eye openness t s after a blink starts: 1 open .. 0 closed
export function blinkCurve(t, B = BLINK) {
  if (!(t > 0)) return 1;
  if (t < B.close) return 1 - smooth(t / B.close);
  t -= B.close;
  if (t < B.hold) return 0;
  t -= B.hold;
  return t < B.open ? smooth(t / B.open) : 1;
}

// A blink as it is drawn (classic hand-drawn timing, ~30 drawings a second, BLINK_FPS): every frame shows exactly ONE
// eye level, never two cross-faded (a cross-fade reads as a ghost lid over the open eye, doubled lashes). The drawings
// for the rig's levels (openness values; the master's open eye is 1): on the close, each in-between once, open to
// closed, one drawing each, then closed through the hold; on the open, the closed lid eases back up (blinkCurve's open,
// sampled once per drawing, each snapped to its nearest level). [openness per drawing]; the eye is open after the last.
// E.g. levels .75 .5 .25 0: .75 .5 .25 0 0 | 0 .25 .5 .75 1 (333 ms). No levels: [] (she can't blink).
export const BLINK_FPS = 30;
export function blinkSheet(levels, B = BLINK, fps = BLINK_FPS) {
  const lv = [...new Set((Array.isArray(levels) ? levels : []).filter((o) => Number.isFinite(o) && o < 0.98).map((o) => clamp01(o)))].sort((a, b) => b - a);
  if (!lv.length) return [];
  const shut = lv[lv.length - 1], ins = lv.slice(0, -1), all = [1, ...lv];
  const snap = (o) => all.reduce((b, x) => (Math.abs(x - o) < Math.abs(b - o) - 1e-9 ? x : b), all[0]);
  const sheet = [...ins, shut];
  const closed = Math.max(sheet.length + (B.hold > 0 ? 1 : 0), Math.round((B.close + B.hold) * fps));
  while (sheet.length < closed) sheet.push(shut);
  const n = Math.max(ins.length + 1, Math.round(B.open * fps));
  for (let j = 0; j < n; j++) sheet.push(Math.max(shut, snap(smooth((j + 0.5) / n))));
  return sheet;
}

// Blinks every min..max s (x rate), sometimes double (the second starts as the lids are half up again), on an absolute
// clock: the same seed gives the same blinks at any frame rate. With levels (the rig's eye levels): each blink is
// blinkSheet's drawings, each held 1 / BLINK_FPS s from the blink's start, so at(t) is always one of the levels (or 1);
// without, the smooth blinkCurve
export class Blinker {
  constructor(seed = 1, B = {}, levels = null) {
    this.B = { ...BLINK, ...B }; this.r = rng(seed); this.next = null; this.act = []; this.rate = 1; this.starts = [];
    this.sheet = levels ? blinkSheet(levels, this.B) : null;
    if (this.sheet && !this.sheet.length) this.sheet = null;
  }
  at(t) {
    const B = this.B, r = this.r, sh = this.sheet, life = sh ? sh.length / BLINK_FPS : B.close + B.hold + B.open;
    if (this.next === null || t - this.next > 30) this.next = t + B.first[0] + (B.first[1] - B.first[0]) * r();
    while (t >= this.next) {
      const s = this.next;
      this.act.push(s);
      this.starts.push(s);
      if (this.starts.length > 64) this.starts.shift();
      if (r() < B.double) this.act.push(s + B.close + B.hold + 0.55 * B.open);
      this.next = s + (B.min + (B.max - B.min) * r()) * this.rate;
    }
    let o = 1;
    this.act = this.act.filter((s) => t - s < life);
    for (const s of this.act) {
      if (!sh) { o = Math.min(o, blinkCurve(t - s, B)); continue; }
      const k = Math.floor((t - s) * BLINK_FPS + 1e-9);
      if (k >= 0 && k < sh.length) o = Math.min(o, sh[k]);
    }
    return o;
  }
}

// ---------------------------------------------------------------- ear flicks
// one flick, t s after it starts: up to 1 in 90 ms (a snap), back past rest a little, settled by ~0.9 s
export function flickCurve(t) {
  if (!(t > 0)) return 0;
  const R = 0.09;
  if (t < R) return Math.sin(0.5 * Math.PI * t / R);
  const d = t - R;
  return d > 0.9 ? 0 : Math.exp(-d / 0.14) * Math.cos(TAU * d / 0.5);
}

// every 6-15 s one ear (or both), sometimes twice; [left, right] in flick units (the controller scales by ear_deg)
export class EarFlicks {
  constructor(seed = 2, o = {}) { this.o = { min: 6, max: 15, first: [2, 7], ...o }; this.r = rng(seed); this.next = null; this.act = []; this.starts = []; }
  at(t) {
    const o = this.o, r = this.r;
    if (this.next === null || t - this.next > 60) this.next = t + o.first[0] + (o.first[1] - o.first[0]) * r();
    while (t >= this.next) {
      const s = this.next, q = r(), ear = q < 0.4 ? 0 : q < 0.8 ? 1 : 2, amp = 0.65 + 0.35 * r();
      this.act.push([s, ear, amp]);
      this.starts.push(s);
      if (this.starts.length > 64) this.starts.shift();
      if (r() < 0.22) this.act.push([s + 0.28, ear, amp * 0.7]);
      this.next = s + o.min + (o.max - o.min) * r();
    }
    this.act = this.act.filter((a) => t - a[0] < 1.1);
    let L = 0, R = 0;
    for (const [s, ear, amp] of this.act) {
      const v = amp * flickCurve(t - s);
      if (ear !== 1) L += v;
      if (ear !== 0) R += v;
    }
    return [clamp(L, -0.5, 1.2), clamp(R, -0.5, 1.2)];
  }
}

// ---------------------------------------------------------------- slow gestures: nods, tilts, glances
const bump = (t, d) => (t > 0 && t < d ? Math.sin(Math.PI * t / d) ** 2 : 0);
const plateau = (t, d, e) => (t > 0 && t < d ? smooth(t / e) * smooth((d - t) / e) : 0);

// Idle: every 7-14 s a slow nod, a tilt or a glance. Listening: a slow nod every 4-8 s (sometimes two). Degrees.
export class Gestures {
  constructor(seed = 3) { this.r = rng(seed); this.next = null; this.act = []; }
  at(t, listening = 0, calm = 0) {
    const r = this.r;
    if (this.next === null || t - this.next > 60) this.next = t + 3 + 4 * r();
    while (t >= this.next) {
      const s = this.next, L = listening > 0.5, q = r();
      if (L) {
        this.act.push(['nod', s, 1.3, 1.1 + 0.4 * r()]);
        if (r() < 0.3) this.act.push(['nod', s + 1.25, 0.9, 1.0]);
        this.next = s + 4 + 4 * r();
      } else {
        const sgn = r() < 0.5 ? -1 : 1;
        if (q < 0.4) this.act.push(['nod', s, 1.1 + 0.5 * r(), 1.6 + 0.6 * r()]);
        else if (q < 0.75) this.act.push(['tilt', s, sgn * (1.2 + 0.8 * r()), 2.6 + 1.6 * r()]);
        else this.act.push(['glance', s, sgn * (1.0 + 0.8 * r()), 2.2 + 1.2 * r()]);
        this.next = s + 7 + 7 * r();
      }
    }
    let yaw = 0, pitch = 0, roll = 0;
    this.act = this.act.filter((a) => t - a[1] < a[3]);
    for (const [k, s, A, d] of this.act) {
      const u = t - s;
      if (k === 'nod') pitch += A * bump(u, d);
      else if (k === 'tilt') roll += A * plateau(u, d, 0.8);
      else { yaw += A * plateau(u, d, 0.7); roll += 0.25 * A * plateau(u, d, 0.7); }
    }
    const g = 1 - 0.7 * clamp01(calm);
    return { yaw: yaw * g, pitch: pitch * g, roll: roll * g };
  }
}

// ---------------------------------------------------------------- her voice: level and stressed syllables
export function b64bytes(s) {
  if (s instanceof Uint8Array) return s.length ? s : null;
  if (Array.isArray(s)) return s.length ? Uint8Array.from(s) : null;
  if (typeof s !== 'string' || !s) return null;
  try {
    const t = atob(s), out = new Uint8Array(t.length);
    for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i);
    return out.length ? out : null;
  } catch { return null; }
}
export function toB64(u8) {
  if (typeof u8 === 'string') return u8;
  if (!u8 || !u8.length) return '';
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(u8.subarray ? u8.subarray(i, i + 0x8000) : u8.slice(i, i + 0x8000)));
  return btoa(s);
}

// a line's content (FNV-1a over its env and vis bytes, and its duration): ids are not unique over time (the lab agent
// restarts live ids at live-0 every session), so a cached plan is reused only for the same id AND the same content
export function lineSig(env, vis, dur) {
  const fnv = (u8) => {
    if (!u8 || !u8.length) return '-';
    let h = 0x811c9dc5;
    for (let i = 0; i < u8.length; i++) h = Math.imul(h ^ u8[i], 0x01000193);
    return `${u8.length}:${(h >>> 0).toString(16)}`;
  };
  return `${fnv(env)}|${fnv(vis)}|${num(dur, 0).toFixed(3)}`;
}

// a 20 ms timeline at t s: linear between frames (frame i at i * 20 ms), 0 outside
export function sampleAt(arr, t, stride = 1, o = 0) {
  if (!arr) return 0;
  const f = t / HOP_S, i = Math.floor(f), a = f - i, m = Math.floor(arr.length / stride);
  const g = (q) => (q >= 0 && q < m ? arr[q * stride + o] : 0);
  return (1 - a) * g(i) + a * g(i + 1);
}
export const voiceOf = (envByte) => clamp01((envByte - ENV_VOICE) / 110);

// stressed syllables: the peaks of her smoothed loudness that rise well above the dip before them, >= 0.26 s apart
// (the stronger kept). [[t s, strength 0..1], ...]
export function accentsOf(env) {
  const e = b64bytes(env);
  if (!e) return [];
  const n = e.length, s = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) { const v = voiceOf(e[i]); y += (v - y) * (v > y ? 0.55 : 0.18); s[i] = y; }
  const out = [], back = Math.round(0.3 / HOP_S), gap = 0.26;
  for (let i = 1; i + 1 < n; i++) {
    if (!(s[i] >= s[i - 1] && s[i] > s[i + 1])) continue;
    let lo = s[i];
    for (let j = Math.max(0, i - back); j < i; j++) lo = Math.min(lo, s[j]);
    const prom = s[i] - lo;
    if (prom < 0.16 || s[i] < 0.25) continue;
    const a = [i * HOP_S, clamp01(prom * 1.6)], last = out[out.length - 1];
    if (last && a[0] - last[0] < gap) { if (a[1] > last[1]) out[out.length - 1] = a; }
    else out.push(a);
  }
  return out;
}

// the nod those accents drive at t s: each a quick rise (60 ms either side of its peak) and a slower settle
const accentShape = (d) => (d < 0.06 ? smooth((d + 0.08) / 0.14) : Math.exp(-(d - 0.06) / 0.22));
export function accentAt(acc, t) {
  let v = 0;
  for (let k = 0; k < acc.length; k++) {
    const d = t - acc[k][0];
    if (d < -0.08) break;
    if (d > 1.2) continue;
    v += acc[k][1] * accentShape(d);
  }
  return Math.min(1.3, v);
}
// the same beats as side-to-side moves: each accent a turn or tilt one way or the other (seeded per accent, so a line
// beats the same way every time it is spoken), in [-1.3, 1.3]
export function accentSide(acc, t, seed) {
  let v = 0;
  for (let k = 0; k < acc.length; k++) {
    const d = t - acc[k][0];
    if (d < -0.08) break;
    if (d > 1.2) continue;
    v += (hash1(seed, k) < 0 ? -1 : 1) * acc[k][1] * accentShape(d);
  }
  return clamp(v, -1.3, 1.3);
}

// her head while she talks (degrees; Popcorn's talk-loop moves her head 3-4x as much as she moves at rest): a nod on
// each stressed syllable, the beats as small turns and tilts, and a livelier phrase-level drift, all with her voice
// (calibrated on the shipped rig: head-region motion per 0.5 s while talking / at rest = 3.2-3.5, as talk-loop.mp4's 1.57
// over idle.mp4's 0.45; peaks stay inside rig.limits with the head raised `lift` degrees so the nods swing about level)
export const TALK = Object.freeze({ nod: 2.4, lift: 0.9, beat_yaw: 2.4, beat_roll: 1.6, drift_yaw: 2.4, drift_pitch: 0.8, drift_roll: 1.4, drift_hz: 3.4, omega: 8 });

// ---------------------------------------------------------------- the eye levels
// openness o -> what to draw over the master's open eyes: patch a at weight wa, then b over it at weight wb (levels
// sorted open to closed; a level at >= 0.98 is the master itself and never drawn)
export function eyeLevels(levels) {
  return (Array.isArray(levels) ? levels : [])
    .filter((l) => isObj(l) && Number.isFinite(l.openness) && Number.isInteger(l.col) && Number.isInteger(l.row) && l.openness < 0.98)
    .map((l) => ({ o: clamp01(l.openness), col: l.col, row: l.row })).sort((a, b) => b.o - a.o);
}
// openness o -> the ONE level to draw over the master's open eyes (the nearest; the master itself, a: -1, when that is
// nearest): what the renderer shows, so a frame never mixes two levels (blinks arrive as levels already, blinkSheet;
// a slow lid between levels holds the nearest)
export function eyeSnap(lv, o) {
  if (!lv.length || !(o < 1)) return { a: -1, wa: 0, b: -1, wb: 0 };
  let best = -1, bd = 1 - o;
  for (let i = 0; i < lv.length; i++) { const d = Math.abs(lv[i].o - o); if (d < bd - 1e-9) { bd = d; best = i; } }
  return best < 0 ? { a: -1, wa: 0, b: -1, wb: 0 } : { a: best, wa: 1, b: -1, wb: 0 };
}
// (the continuous two-level mix, kept for tools: the renderer draws eyeSnap)
export function eyeBlend(lv, o) {
  if (!lv.length || o >= 0.98) return { a: -1, wa: 0, b: -1, wb: 0 };
  if (o >= lv[0].o) { const t = (o - lv[0].o) / Math.max(1e-6, 0.98 - lv[0].o); return { a: 0, wa: clamp01(1 - t), b: -1, wb: 0 }; }
  for (let i = 0; i + 1 < lv.length; i++) {
    if (o >= lv[i + 1].o) {
      const t = (o - lv[i + 1].o) / Math.max(1e-6, lv[i].o - lv[i + 1].o);
      return { a: i, wa: 1, b: i + 1, wb: clamp01(1 - t) };
    }
  }
  return { a: lv.length - 1, wa: 1, b: -1, wb: 0 };
}

// ---------------------------------------------------------------- the rig
const hex = (c) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || ''));
  const v = m ? parseInt(m[1], 16) : 0xffffff;
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
};

// her chakras, root to the top (by height: the lowest first), the pendant crystal apart
export function orbLadder(orbs) {
  const idx = orbs.map((o, i) => i).filter((i) => orbs[i].name !== 'crystal');
  idx.sort((a, b) => orbs[b].center[1] - orbs[a].center[1] || a - b);
  const throat = orbs.findIndex((o) => o.name === 'throat');
  return { ladder: idx, throat: throat >= 0 ? throat : idx.length >= 5 ? idx[4] : -1,
    crystal: orbs.findIndex((o) => o.name === 'crystal'), third: orbs.findIndex((o) => o.name === 'third-eye') };
}

// the triangle under (x, y) and its barycentric weights (rest positions); outside every triangle: the nearest vertex
export function locate(rest, tris, x, y) {
  let best = -1, bd = Infinity;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const ax = rest[2 * a], ay = rest[2 * a + 1], bx = rest[2 * b], by = rest[2 * b + 1], cx = rest[2 * c], cy = rest[2 * c + 1];
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-12) continue;
    const l0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, l1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, l2 = 1 - l0 - l1;
    if (l0 >= -1e-9 && l1 >= -1e-9 && l2 >= -1e-9) return { i: [a, b, c], l: [l0, l1, l2] };
  }
  for (let i = 0; i < rest.length / 2; i++) { const d = (rest[2 * i] - x) ** 2 + (rest[2 * i + 1] - y) ** 2; if (d < bd) { bd = d; best = i; } }
  return { i: [best, best, best], l: [1, 0, 0], off: [x - rest[2 * best], y - rest[2 * best + 1]] };
}
export function pointAt(pos, loc) {
  const [a, b, c] = loc.i, [l0, l1, l2] = loc.l, o = loc.off || [0, 0];
  return [l0 * pos[2 * a] + l1 * pos[2 * b] + l2 * pos[2 * c] + o[0], l0 * pos[2 * a + 1] + l1 * pos[2 * b + 1] + l2 * pos[2 * c + 1] + o[1]];
}

// rig.json -> typed arrays the deformation reads. Throws on anything it can't use. depth(x, y) -> 0..1 (or null: flat);
// on(x, y) -> 0..1, her matte (or null: the depth map is taken as it is everywhere)
export function prepareRig(rig, depth = null, on = null) {
  if (!isObj(rig)) throw new Error('rig.json: not an object');
  const size = num(rig.size, 720) > 0 ? rig.size : 720;
  const M = isObj(rig.mesh) ? rig.mesh : {}, V = Array.isArray(M.verts) ? M.verts : [], T = Array.isArray(M.tris) ? M.tris : [];
  const n = V.length;
  if (n < 3 || !T.length) throw new Error('rig.json: no mesh');
  const rest = new Float32Array(2 * n), uv = new Float32Array(2 * n);
  V.forEach((v, i) => {
    const p = pt(v, null);
    if (!p) throw new Error(`rig.json: vertex ${i}`);
    rest[2 * i] = p[0]; rest[2 * i + 1] = p[1]; uv[2 * i] = p[0] / size; uv[2 * i + 1] = p[1] / size;
  });
  const tris = new Uint32Array(3 * T.length);
  T.forEach((t, k) => {
    if (!Array.isArray(t) || t.length < 3 || !t.slice(0, 3).every((i) => Number.isInteger(i) && i >= 0 && i < n)) throw new Error(`rig.json: triangle ${k}`);
    tris[3 * k] = t[0]; tris[3 * k + 1] = t[1]; tris[3 * k + 2] = t[2];
  });
  const W = isObj(rig.weights) ? rig.weights : {};
  const wt = (name) => {
    const a = new Float32Array(n), s = W[name];
    if (Array.isArray(s)) for (let i = 0; i < n && i < s.length; i++) a[i] = clamp01(num(s[i], 0));
    return a;
  };
  const P = isObj(rig.pivots) ? rig.pivots : {}, c = size / 2;
  const pivots = { head: pt(P.head, [c, size * 0.32]), neck_base: pt(P.neck_base, [c, size * 0.72]), chest: pt(P.chest, [c, size * 0.85]),
    ear_left: pt(P.ear_left, [size * 0.33, size * 0.2]), ear_right: pt(P.ear_right, [size * 0.55, size * 0.2]) };
  const Lr = isObj(rig.limits) ? rig.limits : {}, limits = {};
  for (const k of Object.keys(LIMITS)) limits[k] = Math.max(0, num(Lr[k], LIMITS[k]));
  limits.breath_lift_px = Math.max(0, num(Lr.breath_lift_px, size * 0.006));
  const R = { v: num(rig.v, 1), size, n, rest, uv, tris, pivots, limits,
    wh: wt('head'), wn: wt('neck'), wb: wt('body'), wel: wt('ear_left'), wer: wt('ear_right'), wbr: wt('breath'),
    hn: new Float32Array(n), z: new Float32Array(n), follow: NECK_FOLLOW, depthPx: depthPxOf(rig, size), headDepth: headDepthOf(rig),
    earSign: [1, -1], orbs: [], ladder: [], throat: -1, crystal: -1, third: -1, eyes: null, framing: null, mouth: null, hasDepth: false };
  // how far up the neck each vertex is: 0 at its base, 1 at the head pivot's height
  const [, ny] = pivots.neck_base, [, hy] = pivots.head, span = Math.max(1, ny - hy);
  for (let i = 0; i < n; i++) R.hn[i] = smooth((ny - rest[2 * i + 1]) / span);
  // each ear lifts (its tip goes up) for a positive flick, whichever side it is on
  const side = (w, p) => {
    let sx = 0, sw = 0;
    for (let i = 0; i < n; i++) if (w[i] > 0) { sx += w[i] * rest[2 * i]; sw += w[i]; }
    return sw > 0 && sx / sw > p[0] ? -1 : 1;
  };
  R.earSign = [side(R.wel, pivots.ear_left), side(R.wer, pivots.ear_right)];
  const a = matteAt(R, on);
  if (a) fitMargin(R, a);
  setDepth(R, depth, R.headDepth, a);
  // orbs
  R.orbs = (Array.isArray(rig.orbs) ? rig.orbs : []).filter((o) => isObj(o) && pt(o.center, null) && num(o.r, 0) > 0).map((o) => ({
    name: String(o.name || ''), center: pt(o.center), r: o.r, color: String(o.color || '#ffffff'), rgb: hex(o.color),
    host: ['head', 'neck', 'body'].includes(o.host) ? o.host : 'neck', loc: null }));
  for (const o of R.orbs) o.loc = locate(rest, tris, o.center[0], o.center[1]);
  Object.assign(R, orbLadder(R.orbs));
  // eyes
  const E = isObj(rig.eyes) ? rig.eyes : null;
  if (E && Array.isArray(E.region) && E.region.length === 4 && E.region.every(Number.isFinite) && E.region[2] > 0 && E.region[3] > 0) {
    const cell = Array.isArray(E.cell) && E.cell.length === 2 && E.cell.every((x) => Number.isFinite(x) && x > 0) ? E.cell.slice() : [E.region[2], E.region[3]];
    const levels = eyeLevels(E.levels);
    if (levels.length) R.eyes = { region: E.region.slice(), cell, levels };
  }
  const F = isObj(rig.framing) ? rig.framing : {};
  const sq = Array.isArray(F.square) && F.square.length === 4 && F.square.every(Number.isFinite) && F.square[2] > 0 && F.square[3] > 0 ? F.square.slice() : [0, 0, size, size];
  const sg = isObj(F.stage) && Array.isArray(F.stage.sq) && F.stage.sq.length === 3 && F.stage.sq[2] > 0 && F.stage.w > 0 && F.stage.h > 0 ? { ...F.stage, sq: F.stage.sq.slice() } : null;
  R.framing = { square: sq, stage: sg };
  R.mouth = typeof rig.mouth === 'string' && rig.mouth ? rig.mouth : '../mouth/mouth.json';
  return R;
}

// master px of volume over the depth map's full range (0..255): depth.px_per_level x 255 (portrait.py), else depth_px /
// limits.depth_px, else size / 4
export function depthPxOf(rig, size = 720) {
  const D = isObj(rig) && isObj(rig.depth) ? rig.depth : {}, L = isObj(rig) && isObj(rig.limits) ? rig.limits : {};
  const ppl = num(D.px_per_level, NaN);
  return Math.max(0, Number.isFinite(ppl) && ppl > 0 ? ppl * 255 : num(rig && rig.depth_px, num(L.depth_px, size / 4)));
}
// the depth level (0..255) her head turns about: pivots_depth.head (portrait.py: her neck's axis, inside her), else
// head_depth, else NaN (setDepth takes her head's mean)
export function headDepthOf(rig) {
  const pd = isObj(rig) && isObj(rig.pivots_depth) ? num(rig.pivots_depth.head, NaN) : NaN;
  return Number.isFinite(pd) ? pd : num(rig && rig.head_depth, NaN);
}

// every vertex's neighbours over the triangles (CSR: R.nbs[R.nb0[i] .. R.nb0[i + 1]]), built once
export function neighbours(R) {
  if (R.nb0) return R;
  const n = R.n, T = R.tris, sets = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) { const a = T[t + e], b = T[t + (e + 1) % 3]; if (a !== b) { sets[a].add(b); sets[b].add(a); } }
  const nb0 = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) nb0[i + 1] = nb0[i] + sets[i].size;
  const nbs = new Uint32Array(nb0[n]);
  for (let i = 0; i < n; i++) { let k = nb0[i]; for (const j of sets[i]) nbs[k++] = j; }
  R.nb0 = nb0; R.nbs = nbs;
  return R;
}

// A per-vertex field off her, carried from her edge: a harmonic extension over the mesh of its values on her (on >= 0.5),
// seeded breadth first (each new vertex the mean of its seen neighbours), then relaxed (Gauss-Seidel). f is changed in
// place; vertices with no path to her keep their values. Her margin is invisible (her matte is 0 there) and is only
// there so her outline moves cleanly: it must move with the edge next to it, never pinch it.
export function extendOff(R, f, on, iters = 240) {
  neighbours(R);
  const n = R.n, { nb0, nbs } = R, fixed = new Uint8Array(n), seen = new Uint8Array(n), queue = new Uint32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) if (on[i] >= 0.5) { fixed[i] = 1; seen[i] = 1; queue[tail++] = i; }
  if (!tail || tail === n) return f;
  while (head < tail) {
    const i = queue[head++];
    for (let k = nb0[i]; k < nb0[i + 1]; k++) {
      const j = nbs[k];
      if (seen[j]) continue;
      let s = 0, c = 0;
      for (let q = nb0[j]; q < nb0[j + 1]; q++) if (seen[nbs[q]]) { s += f[nbs[q]]; c++; }
      f[j] = c ? s / c : f[i];
      seen[j] = 1;
      queue[tail++] = j;
    }
  }
  for (let it = 0; it < iters; it++) {
    let delta = 0;
    for (let i = 0; i < n; i++) {
      if (fixed[i] || !seen[i]) continue;
      const a = nb0[i], b = nb0[i + 1];
      if (b === a) continue;
      let s = 0;
      for (let k = a; k < b; k++) s += f[nbs[k]];
      const v = s / (b - a);
      delta = Math.max(delta, Math.abs(v - f[i]));
      f[i] = v;
    }
    if (delta < 1e-5) break;
  }
  return f;
}

// her matte at every vertex (on(x, y) -> 0..1), or null
export function matteAt(R, on) {
  if (typeof on !== 'function') return null;
  const a = new Float32Array(R.n);
  for (let i = 0; i < R.n; i++) a[i] = clamp01(on(R.rest[2 * i], R.rest[2 * i + 1]));
  return a;
}

// every vertex's distance (master px, along the mesh) to the nearest vertex on her (on >= 0.5): Dijkstra from all of
// them at once; Infinity where no path reaches her
export function marginDist(R, on) {
  neighbours(R);
  const n = R.n, { nb0, nbs } = R, rest = R.rest, dist = new Float64Array(n).fill(Infinity), heap = [];
  const push = (d, i) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; }
    }
    return top;
  };
  for (let i = 0; i < n; i++) if (on[i] >= 0.5) { dist[i] = 0; push(0, i); }
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    for (let k = nb0[i]; k < nb0[i + 1]; k++) {
      const j = nbs[k], e = d + Math.hypot(rest[2 * j] - rest[2 * i], rest[2 * j + 1] - rest[2 * i + 1]);
      if (e < dist[j]) { dist[j] = e; push(e, j); }
    }
  }
  return dist;
}

// The margin moves with her edge: the head and ear weights off her are carried from her edge (extendOff) across a band
// (MARGIN_PX[0] px past her outline), then ease back to the rig's own over the next MARGIN_PX[1] px, so a turn, a roll or
// an ear flick never pinches her outline against a margin that eases out sooner, and the far margin (invisible) doesn't
// swing wide with an ear. On her the weights are kept exactly; neck, body and breath stay as given (the frame bottom
// stays pinned). Once per rig.
export const MARGIN_PX = Object.freeze([32, 48]);
export function fitMargin(R, on) {
  const a = on instanceof Float32Array ? on : matteAt(R, on);
  if (!a || R.marginFit) return R;
  const dist = marginDist(R, a), [band, ease] = MARGIN_PX;
  for (const w of [R.wh, R.wel, R.wer]) {
    const orig = Float32Array.from(w);
    extendOff(R, w, a);
    for (let i = 0; i < R.n; i++) {
      const k = Number.isFinite(dist[i]) ? smooth((dist[i] - band) / ease) : 1;
      w[i] = clamp01(lerp(w[i], orig[i], k));
    }
  }
  R.marginFit = true;
  return R;
}

// per-vertex depth (master px of volume) from the depth map, sampled once, relative to the depth her head turns about:
// headDepth (0..255; rig.pivots_depth.head: portrait.py puts it on her neck's axis, inside her, so a turn swings her
// muzzle most, her eyes less, her ears least, the way a head turns on its neck) if given, else the mean depth of her
// head (its vertices on her, weighted by head weight squared: her muzzle swings one way, her ears the other). (Never the
// depth of the head pivot's own pixel: a pivot drawn on her face sits on the muzzle's surface, and a turn about it would
// leave the muzzle still and swing the ears.) on: her matte (on(x, y) -> 0..1, or matteAt's array): off her the depth
// is carried from her edge (extendOff), never the background's far 0.
export function setDepth(R, depth, headDepth = NaN, on = null) {
  R.hasDepth = typeof depth === 'function';
  if (!R.hasDepth) { R.z.fill(0); R.zHead = 0; return R; }
  const d = new Float32Array(R.n), a = on instanceof Float32Array ? on : matteAt(R, on), hasOn = !!a;
  for (let i = 0; i < R.n; i++) d[i] = clamp01(depth(R.rest[2 * i], R.rest[2 * i + 1]));
  if (hasOn) extendOff(R, d, a);
  let sw = 0, sz = 0;
  for (let i = 0; i < R.n; i++) {
    const w = (hasOn ? a[i] >= 0.5 : d[i] > 0.04) ? R.wh[i] * R.wh[i] : 0;   // her head, not the margin around it
    sw += w; sz += w * d[i];
  }
  const [hx, hy] = R.pivots.head;
  const zh = Number.isFinite(headDepth) ? clamp01(headDepth / 255) : sw > 0 ? sz / sw : clamp01(depth(hx, hy));
  R.zHead = zh;
  R.onMatte = hasOn ? a : null;
  for (let i = 0; i < R.n; i++) R.z[i] = (d[i] - zh) * R.depthPx;
  return R;
}

// an image (RGBA bytes, w x h, any size) as f(x, y) in master px -> 0..1, bilinear on one channel (0: red, the depth
// map's grey; 3: alpha, her matte)
export function depthSampler(data, w, h, size, ch = 0) {
  const sx = w / size, sy = h / size;
  const g = (x, y) => data[4 * (clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) + ch];
  return (x, y) => {
    const u = x * sx - 0.5, v = y * sy - 0.5, i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j;
    return ((1 - a) * (1 - b) * g(i, j) + a * (1 - b) * g(i + 1, j) + (1 - a) * b * g(i, j + 1) + a * b * g(i + 1, j + 1)) / 255;
  };
}

// The pose (radians; px): {yaw, pitch, roll, sway, earL, earR, scale, lift, lean}. Every vertex, in order:
//   ears: a rotation about each ear's pivot by earL / earR x its ear weight (a positive flick lifts the tip);
//   head: a rigid 3D turn about the head pivot (at the depth setDepth chose), depth as volume (x' = X cos yaw + Z sin yaw, then y' = Y cos pitch +
//         Z' sin pitch, then roll in the picture plane, and lean: a tiny scale toward the camera), x head weight; the
//         upper neck carries NECK_FOLLOW of the yaw and pitch (never the roll), more the higher it is;
//   sway: the head and neck lean from the neck's base (a pendulum, the higher the more), and lift with the breath;
//   breath: a scale about the chest (wider than taller) x breath weight.
export function deform(R, P, out = new Float32Array(R.n * 2)) {
  const { n, rest, z, wh, wn, wel, wer, wbr, hn, pivots: pv, follow } = R;
  const [hx, hy] = pv.head, [nx, ny] = pv.neck_base, [cx, cy] = pv.chest, [lx, ly] = pv.ear_left, [rx, ry] = pv.ear_right;
  const yaw = P.yaw || 0, pitch = P.pitch || 0, roll = P.roll || 0, sway = P.sway || 0;
  const cY = Math.cos(yaw), sY = Math.sin(yaw), cP = Math.cos(pitch), sP = Math.sin(pitch), cR = Math.cos(roll), sR = Math.sin(roll);
  const cS = Math.cos(sway), sS = Math.sin(sway);
  const aL = (P.earL || 0) * R.earSign[0], aR = (P.earR || 0) * R.earSign[1];
  const sc = P.scale || 0, lift = P.lift || 0, lean = P.lean || 0;
  for (let i = 0; i < n; i++) {
    let x = rest[2 * i], y = rest[2 * i + 1];
    let w = wel[i];
    if (w > 0 && aL) { const a = aL * w, c = Math.cos(a), s = Math.sin(a), dx = x - lx, dy = y - ly; x = lx + dx * c - dy * s; y = ly + dx * s + dy * c; }
    w = wer[i];
    if (w > 0 && aR) { const a = aR * w, c = Math.cos(a), s = Math.sin(a), dx = x - rx, dy = y - ry; x = rx + dx * c - dy * s; y = ry + dx * s + dy * c; }
    const h = wh[i], up = wn[i] * hn[i], f = follow * up * (1 - h);
    if (h > 0 || f > 0) {
      const X = x - hx, Y = y - hy, Z = z[i];
      const X1 = X * cY + Z * sY, Z1 = Z * cY - X * sY, Y1 = Y * cP + Z1 * sP;
      const k = 1 + lean;
      const X2 = (X1 * cR - Y1 * sR) * k, Y2 = (X1 * sR + Y1 * cR) * k;
      x += h * (X2 - X) + f * (X1 - X);
      y += h * (Y2 - Y) + f * (Y1 - Y);
    }
    const s3 = Math.max(h, up);
    if (s3 > 0) {
      if (sway) { const X = x - nx, Y = y - ny; x += s3 * (nx + X * cS - Y * sS - x); y += s3 * (ny + X * sS + Y * cS - y); }
      y -= lift * s3;
    }
    const b = wbr[i];
    if (b > 0 && sc) { x = cx + (x - cx) * (1 + sc * b); y = cy + (y - cy) * (1 + 0.6 * sc * b); }
    out[2 * i] = x;
    out[2 * i + 1] = y;
  }
  return out;
}

// ---------------------------------------------------------------- framing (the page's layoutStage, exactly)
// Gigi's square is bottom-anchored and as big as the screen allows while at least 0.66 of it shows; the oasis is drawn at
// the same scale with its square on hers (app.js layoutStage). null without a usable stage.
export function layoutStage(vw, vh, sg) {
  if (!(vw > 0) || !(vh > 0) || !sg || !Array.isArray(sg.sq) || !(sg.sq[2] > 0) || !(sg.w > 0) || !(sg.h > 0)) return null;
  const [x0, y0, s] = sg.sq, fit = Math.min(vh / s, vw / (0.66 * s));
  const cover = Math.max(vw / (2 * x0 + s), vw / (2 * (sg.w - x0) - s), vh / (y0 + s));
  const k = Math.max(fit, Math.min(cover, vh / (0.96 * s))), Q = s * k, L = (vw - Q) / 2, T = vh - Q;
  return { k, Q, L, T, img: [L - x0 * k, T - y0 * k, sg.w * k, sg.h * k] };
}

// master px -> box px (c = m * k + [ox, oy]) for a framing in a vw x vh box, and where the stage image lands:
//   'square': framing.square covers the box (Neck and Neck's square);
//   'wide' / 'full': the page's stage layout (a 16:9 Zoom frame, a phone, a desktop); no stage: the master covers the
//   box at 50% 32% (the page's .nostage)
export function viewFor(framing, vw, vh, size, fr = {}) {
  const sg = fr && fr.stage, f = sg ? size / sg.sq[2] : 1;
  let v = null;
  if (framing !== 'square') { const L = layoutStage(vw, vh, sg); if (L) v = { k: L.Q / size, ox: L.L, oy: L.T }; }
  if (!v) {
    const sq = fr && Array.isArray(fr.square) ? fr.square : [0, 0, size, size];
    const k = Math.max(vw / sq[2], vh / sq[3]);
    v = { k, ox: (vw - sq[2] * k) / 2 - sq[0] * k, oy: (vh - sq[3] * k) * (framing === 'square' ? 0.5 : 0.32) - sq[1] * k };
  }
  v.stage = sg ? [v.ox - sg.sq[0] * f * v.k, v.oy - sg.sq[1] * f * v.k, sg.w * f * v.k, sg.h * f * v.k] : null;
  v.plate = [v.ox, v.oy, size * v.k, size * v.k];
  return v;
}

// the canvas box in its container: the whole of it, or the largest 16:9 inside it for 'wide'
export function boxFor(framing, cw, ch) {
  if (framing !== 'wide' || !(cw > 0) || !(ch > 0)) return [0, 0, cw, ch];
  const w = cw / ch > 16 / 9 ? ch * 16 / 9 : cw, h = w * 9 / 16;
  return [(cw - w) / 2, (ch - h) / 2, w, h];
}

// ---------------------------------------------------------------- the controller: her life, her breath, her lines
// Everything she does, frame by frame, on an absolute clock (ms) with exact springs: deterministic for a seed, the same
// at any frame rate. update(now) -> {pose, eye, mouth: {a, b, w, E}, orbs, breath, ...}. No GL: node tests drive it.
export class Controller {
  constructor(R, o = {}) {
    const seed = (o.seed ?? 20261018) >>> 0;
    this.R = R;
    this.seed = seed;
    this.L = R.limits;
    this.n = R.orbs.length;
    this.blinker = new Blinker(seed + 11, {}, R.eyes ? R.eyes.levels.map((l) => l.o) : null);   // drawn blinks: one level a frame
    this.ears = new EarFlicks(seed + 23);
    this.gest = new Gestures(seed + 37);
    const sp = (w) => new Spring(0, w);
    this.s = { yaw: sp(6), pitch: sp(6), roll: sp(5), sway: sp(3), lean: sp(3), earL: sp(8), earR: sp(8),
      listen: sp(3.2), speak: sp(5), amp: new Spring(0.6, 2), period: new Spring(5.2, 1.5), voice: sp(24), accent: sp(16), phase: sp(4),
      sideY: sp(16), sideR: sp(16), lively: sp(2.5) };
    this.T = { ...TALK, ...(isObj(o.talk) ? o.talk : {}) };
    this.orbS = Array.from({ length: this.n }, () => new Spring(0.08, 15));
    this.listening = false;
    this.run = null;
    this.phase = null;
    this.phLast = null;
    this.line = null;
    this.bPhase = 0.25;
    this.lastT = null;
    this.out = { pose: { yaw: 0, pitch: 0, roll: 0, sway: 0, earL: 0, earR: 0, scale: 0, lift: 0, lean: 0 }, eye: 1,
      mouth: { a: -1, b: -1, w: 0, E: 0 }, orbs: new Float32Array(this.n), breath: 0, runPart: null, take: null, voice: 0, mode: 'idle' };
  }

  // the page's solo run (t0: when it arrived, ms on this clock). True: she breathes it (the page needs no pacer)
  breathRun(b, t0) { if (!isObj(b)) return false; this.run = { b, t0: Number.isFinite(t0) ? t0 : null }; return true; }
  stopBreath() { this.run = null; this.phase = null; }

  // a group room's breath phase (the agent's breath attribute, {kind, dur, into, seq}; the same seq again is ignored).
  // now: when it arrived (ms on this clock). True: she breathes it
  breathPhase(b, now) {
    if (!isObj(b) || !['in', 'hold', 'out'].includes(b.kind)) return false;
    const F = this.phase;
    if (F && b.seq !== undefined && b.seq !== null && F.seq === b.seq) return true;
    const t = Number.isFinite(now) ? now : (this.nowMs ?? 0);
    this.phase = { kind: b.kind, dur: Math.max(0.1, num(b.dur, 4)), at: t - 1000 * Math.max(0, num(b.into, 0)), seq: b.seq ?? null,
      prev: F ? F.kind : null, from: this.out.breath };
    return true;
  }
  listen(on = true) { this.listening = !!on; }

  // line: {plan (or null: no mouth library), pick(plan, tt) -> {a, b, w, alpha}, env (bytes), dur, takeTime, accents}
  speak(line) { this.line = { ...line, firstAt: 0, stopAt: 0, lastT: 0, lastP: 0, startAt: null }; return true; }
  stopSpeaking(fade = true) {
    const L = this.line;
    if (!L) return;
    if (!fade) this.line = null; else if (!L.stopAt) L.stopAt = Math.max(1e-6, this.nowMs ?? 0);   // (never 0: 0 means not stopped)
  }
  get speaking() { return !!this.line && !this.line.stopAt; }

  // the take time heard (s) or null, and the mouth's weight, for this frame
  lineStep(now) {
    const L = this.line, o = this.out;
    o.mouth.a = o.mouth.b = -1; o.mouth.w = 0; o.mouth.E = 0; o.take = null;
    if (!L) return null;
    if (L.startAt === null) L.startAt = now;
    let E = 1;
    if (L.stopAt) {
      const k = 1 - (now - L.stopAt) / (EASE_S * 1000);
      if (k <= 0) { this.line = null; return null; }
      E = smooth(k);
    }
    let t = null;
    try { t = typeof L.takeTime === 'function' ? L.takeTime() : null; } catch { t = null; }
    if (t === null || t === undefined || !Number.isFinite(t)) {
      if (L.lastP && (L.stopAt || now - L.lastP < GAP_MS)) t = L.lastT + (now - L.lastP) / 1000;
      else t = null;
    } else { L.lastT = t; L.lastP = now; }
    const dur = num(L.dur, 0);
    if (t === null) {
      if (now - L.startAt > (dur + 8) * 1000) this.stopSpeaking(true);   // never heard: let it go
      return null;
    }
    if (!L.stopAt && t > dur + num(L.endS, 0.15)) this.stopSpeaking(true);
    if (!L.firstAt) L.firstAt = now;
    o.take = t;
    if (L.plan && typeof L.pick === 'function') {
      const s = L.pick(L.plan, t + AHEAD_S);
      const w = E * s.alpha * smooth((now - L.firstAt) / (EASE_S * 1000));
      if (s.a >= 0 && w > 0.003) { o.mouth.a = s.a; o.mouth.b = s.b; o.mouth.w = s.b !== s.a ? s.w : 0; o.mouth.E = w; }
    }
    return { t, E };
  }

  update(now) {
    const t = now / 1000, dt = this.lastT === null ? 1 / 60 : clamp(t - this.lastT, 0, 0.1);
    this.lastT = t;
    this.nowMs = now;
    const L = this.L, s = this.s, o = this.out, seed = this.seed;
    // her line
    const ls = this.lineStep(now), line = this.line;
    const env = line && line.env, vt = ls ? ls.t + AHEAD_S : null;
    const voice = s.voice.step(vt !== null && env ? voiceOf(sampleAt(env, vt)) * ls.E : 0, dt);
    const acc = vt !== null && line.accents ? line.accents : null;
    const accent = s.accent.step(acc ? accentAt(acc, vt) * ls.E : 0, dt);
    const sideY = s.sideY.step(acc ? accentSide(acc, vt, seed + 701) * ls.E : 0, dt);
    const sideR = s.sideR.step(acc ? accentSide(acc, vt, seed + 709) * ls.E : 0, dt);
    const speak = s.speak.step(line && !line.stopAt ? 1 : 0, dt);
    const lively = s.lively.step(line && !line.stopAt ? voice : 0, dt);   // her loudness over the phrase
    const listen = s.listen.step(this.listening && !(line && !line.stopAt) ? 1 : 0, dt);
    // the breath run, on the run's clock
    let run = null;
    if (this.run) {
      if (this.run.t0 === null) this.run.t0 = now;
      run = breathState(this.run.b, now - this.run.t0, this.R.ladder.length);
      if (run.done) { this.run = null; run = null; this.bPhase = 0; }   // her own breath picks up from empty lungs
      else if (run.s.part === 'out') this.bPhase = 0;
    }
    // a group room's phases (a run, when there is one, wins)
    let ph = null;
    if (this.phase) {
      const F = this.phase, el = (now - F.at) / 1000;
      if (run || el > F.dur + PHASE_GRACE_S) {   // over: her own breath picks up where the lungs were (empty, or at the top)
        this.phase = null;
        this.bPhase = phaseState(F, el, 1).full >= 0.5 ? 0.4 : 0;
      }
      else { ph = phaseState(F, el, this.R.ladder.length); this.phLast = ph; if (F.kind === 'out') this.bPhase = 0; }
    }
    const pm = s.phase.step(ph ? 1 : 0, dt);
    if (!ph && pm < 0.002) this.phLast = null;
    const via = run || (pm > 0 ? ph || this.phLast : null);   // whose lungs and ladder she follows
    const mix = run ? run.mix : via ? pm : 0;
    // her own breath: 4.5-6 s, slower when she listens, shallow while she talks
    const T = s.period.step((4.5 + 1.5 * (0.5 + 0.5 * noise1(seed + 7, t * 0.05))) * (1 + 0.18 * listen) * (1 - 0.08 * speak), dt);
    this.bPhase += dt / Math.max(1, T);
    const amp = s.amp.step(0.62 + 0.1 * listen - 0.27 * speak, dt);
    const own = amp * breathWave(this.bPhase);
    const breath = lerp(own, via ? via.full : 0, mix);
    o.breath = breath;
    o.runPart = run ? (run.s.part === 'cycle' ? run.s.kind : run.s.part) : ph ? ph.kind : null;
    // the head: never still (layered noise), slow gestures, listening's lean; talking (TALK): a nod on each stressed
    // syllable, the beats as turns and tilts, a livelier drift with her voice, on quicker springs
    const calm = mix * 0.8;
    const g = this.gest.at(t, listen, calm);
    const still = 1 - 0.45 * calm;
    const K = this.T, sp = speak * still, loud = 0.55 + 0.45 * lively, ft = t * K.drift_hz;
    const yawT = still * 1.3 * layered(seed + 101, t) + sp * (K.drift_yaw * loud * layered(seed + 131, ft) + K.beat_yaw * sideY) + g.yaw;
    const pitchT = still * 0.9 * layered(seed + 211, t) + sp * K.drift_pitch * loud * layered(seed + 151, ft) + K.nod * still * accent
      + g.pitch + 0.6 * listen - K.lift * speak - 0.25 * breath;
    const rollT = still * 0.8 * layered(seed + 307, t) + sp * (K.drift_roll * loud * layered(seed + 141, ft) + K.beat_roll * sideR) + g.roll + 0.8 * listen;
    const P = o.pose, wq = K.omega * speak;
    P.yaw = D2R * clamp(s.yaw.step(yawT, dt, 6 + wq), -L.yaw_deg, L.yaw_deg);
    P.pitch = D2R * clamp(s.pitch.step(pitchT, dt, 6 + wq), -L.pitch_deg, L.pitch_deg);
    P.roll = D2R * clamp(s.roll.step(rollT, dt, 5 + wq), -L.roll_deg, L.roll_deg);
    P.sway = D2R * s.sway.step(0.4 * layered(seed + 401, t * 0.8) * (1 - 0.5 * calm), dt);
    P.lean = s.lean.step(0.006 * listen, dt);
    P.scale = L.breath_scale * breath;
    P.lift = L.breath_lift_px * breath;
    // ears: flicks (their own smooth curve on the absolute clock: unsprung, so a 90 ms snap is the same at any frame
    // rate), over a little sprung life, perked when she listens
    const [fl, fr] = this.ears.at(t);
    P.earL = D2R * clamp(L.ear_deg * fl + s.earL.step(1.2 * noise1(seed + 501, t * 0.3) + 2 * listen, dt), -L.ear_down_deg, L.ear_deg);
    P.earR = D2R * clamp(L.ear_deg * fr + s.earR.step(1.2 * noise1(seed + 503, t * 0.3) + 2 * listen, dt), -L.ear_down_deg, L.ear_deg);
    // blinks: a little rarer as she listens, a little more often as she talks
    this.blinker.rate = 1 + 0.15 * listen - 0.12 * speak;
    o.eye = this.blinker.at(t);
    // her chakras: a soft shimmer, the run's ladder, her throat with her voice
    const { ladder, throat, crystal, third } = this.R;
    const lv = via ? via.lv : null;
    for (let i = 0; i < this.n; i++) {
      const shimmer = 0.05 + 0.07 * (0.5 + 0.5 * noise1(seed + 601 + i * 13, t * 0.35)) + 0.06 * own;
      let target = shimmer;
      const r = ladder.indexOf(i);
      if (lv && r >= 0) target = lerp(shimmer, lv[r], mix);
      if (i === crystal) target = shimmer + 0.08 + 0.3 * breath * mix;
      if (i === throat) target += 0.55 * voice;
      if (i === third) target += 0.12 * voice;
      o.orbs[i] = clamp01(this.orbS[i].step(target, dt));
    }
    o.voice = voice;
    o.mode = line && !line.stopAt ? 'speak' : this.listening ? 'listen' : 'idle';
    return o;
  }
}

// ---------------------------------------------------------------- the pixel-ratio governor
// Steps the canvas's pixel ratio down only on real jank and back up once she runs smoothly again. Every `window` frame
// intervals: the cadence is the fast quarter of them (16.7 ms at 60 Hz, 33.3 ms on iOS Low Power Mode or a throttled
// iframe, 8.3 ms at 120 Hz); a frame is late when it took over max(1.5 x the cadence, the cadence + 10 ms). Jank = more
// than `late` of the frames late (dropped frames, a GPU that can't keep up: 16.7 / 33.3 alternating), or a median
// interval over `slow_ms` (a steady crawl). A steady 30 fps is never jank. Up: after `up_s` of smooth windows; a step up
// that janks again within `retry_s` doubles that wait (no see-saw). Gaps over 250 ms (a hidden tab) are not frames.
export const QUALITY = Object.freeze({ window: 90, late: 0.12, slow_ms: 40, up_s: 8, retry_s: 12, max_wait_s: 120, warm_ms: 4000, min: 1, step: 0.5 });
export class Quality {
  constructor(cap = 2, o = {}) {
    this.o = { ...QUALITY, ...o };
    this.max = Math.max(this.o.min, cap);
    this.cap = this.max;
    this.wait = this.o.up_s;
    this.iv = [];
    this.t0 = null; this.lastT = null; this.smooth = 0; this.lastUp = -Infinity; this.last = null; this.fps = 0;
  }
  // start a fresh window (after a resize or a pause: those frames say nothing about the device)
  reset() { this.iv.length = 0; this.lastT = null; }
  setMax(cap) { this.max = Math.max(this.o.min, cap); if (this.cap > this.max) this.cap = this.max; }
  // a frame shown at `now` (ms): the new cap when it changes, else null
  sample(now) {
    const o = this.o;
    if (this.t0 === null) this.t0 = now;
    if (this.lastT !== null) {
      const d = now - this.lastT;
      if (d > 0 && d < 250) this.iv.push(d);
      else if (d >= 250) this.iv.length = 0;
    }
    this.lastT = now;
    if (this.iv.length < o.window) return null;
    const s = Float64Array.from(this.iv).sort(), n = s.length;
    this.iv.length = 0;
    const base = s[Math.floor(n / 4)], med = s[n >> 1], thr = Math.max(1.5 * base, base + 10);
    let late = 0, sum = 0;
    for (let i = 0; i < n; i++) { if (s[i] > thr) late++; sum += s[i]; }
    this.fps = Math.round(1000 * n / sum);
    const jank = med > o.slow_ms || late / n > o.late;
    this.last = { base: +base.toFixed(2), med: +med.toFixed(2), late: +(late / n).toFixed(3), jank };
    if (now - this.t0 < o.warm_ms) return null;   // shaders compiling, textures uploading
    if (jank) {
      this.smooth = 0;
      if (this.cap <= o.min) return null;
      if (now - this.lastUp < o.retry_s * 1000) this.wait = Math.min(o.max_wait_s, this.wait * 2);   // the step up didn't hold
      this.cap = Math.max(o.min, this.cap - o.step);
      return this.cap;
    }
    this.smooth += sum;
    if (this.cap < this.max && this.smooth >= this.wait * 1000) {
      this.smooth = 0;
      this.lastUp = now;
      this.cap = Math.min(this.max, this.cap + o.step);
      return this.cap;
    }
    return null;
  }
}

// ---------------------------------------------------------------- WebGL2
const VS_FULL = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// the face in master space: row r of the target is master row r (top first, like every image uploaded unflipped).
// Colour and alpha from gigi.webp (on her it is the master exactly; at her edge its colours are un-mixed from the plate,
// so no plate halo travels with her as she moves); the eye and mouth patches over it; a mouth patch that reaches past her
// rest outline (a dropped jaw) adds matte wherever it differs from the master there (the plate it was cut against)
const FS_FACE = `#version 300 es
precision highp float;
uniform sampler2D uMaster;
uniform sampler2D uMatte;
uniform sampler2D uMouth;
uniform sampler2D uEyes;
uniform vec2 uSize;
uniform vec4 uMReg;
uniform vec2 uMSc;
uniform vec2 uMTex;
uniform vec4 uMA;
uniform vec4 uMB;
uniform vec3 uGA;
uniform vec3 uGB;
uniform vec2 uMW;
uniform vec4 uEReg;
uniform vec2 uESc;
uniform vec2 uETex;
uniform vec4 uEA;
uniform vec4 uEB;
uniform vec2 uEW;
uniform vec2 uKey;
out vec4 o;
vec4 cell(sampler2D t, vec2 m, vec4 reg, vec2 sc, vec2 tsz, vec4 c) {
  vec2 l = clamp((m - reg.xy) * sc, vec2(0.5), c.zw - vec2(0.5));
  return textureLod(t, (c.xy + l) / tsz, 0.0);
}
bool inside(vec2 m, vec4 r) { return m.x >= r.x && m.y >= r.y && m.x < r.x + r.z && m.y < r.y + r.w; }
void main() {
  vec2 m = gl_FragCoord.xy;
  vec2 uv = m / uSize;
  vec4 g = texture(uMatte, uv);
  vec3 c0 = texture(uMaster, uv).rgb;   // Popcorn's frame there (her over the plate): what a mouth patch is keyed against
  vec3 c = g.rgb;                       // her own colours: the master's pixels on her, un-mixed from the plate at her edge
  float a = g.a;
  if (inside(m, uEReg)) {
    if (uEW.x > 0.0) { vec4 p = cell(uEyes, m, uEReg, uESc, uETex, uEA); c = mix(c, p.rgb, uEW.x * p.a); }
    if (uEW.y > 0.0) { vec4 p = cell(uEyes, m, uEReg, uESc, uETex, uEB); c = mix(c, p.rgb, uEW.y * p.a); }
  }
  if (inside(m, uMReg)) {
    if (uMW.x > 0.0) {
      vec4 p = cell(uMouth, m, uMReg, uMSc, uMTex, uMA);
      float w = uMW.x * p.a;
      c = mix(c, min(p.rgb * uGA, vec3(1.0)), w);
      a = max(a, w * smoothstep(uKey.x, uKey.y, distance(p.rgb, c0)));
    }
    if (uMW.y > 0.0) {
      vec4 p = cell(uMouth, m, uMReg, uMSc, uMTex, uMB);
      float w = uMW.y * p.a;
      c = mix(c, min(p.rgb * uGB, vec3(1.0)), w);
      a = max(a, w * smoothstep(uKey.x, uKey.y, distance(p.rgb, c0)));
    }
  }
  o = vec4(c, a);
}`;

const VS_MESH = `#version 300 es
in vec2 aPos;
in vec2 aUv;
uniform vec3 uView;
uniform vec2 uCanvas;
out vec2 vUv;
void main() {
  vec2 c = aPos * uView.x + uView.yz;
  gl_Position = vec4(c.x / uCanvas.x * 2.0 - 1.0, 1.0 - c.y / uCanvas.y * 2.0, 0.0, 1.0);
  vUv = aUv;
}`;
const FS_MESH = `#version 300 es
precision highp float;
uniform sampler2D uFace;
in vec2 vUv;
out vec4 o;
void main() { o = texture(uFace, vUv); }`;

const VS_QUAD = `#version 300 es
in vec2 aPos;
in vec2 aUv;
uniform vec2 uCanvas;
out vec2 vUv;
void main() {
  gl_Position = vec4(aPos.x / uCanvas.x * 2.0 - 1.0, 1.0 - aPos.y / uCanvas.y * 2.0, 0.0, 1.0);
  vUv = aUv;
}`;
const FS_QUAD = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 o;
void main() { o = vec4(texture(uTex, vUv).rgb, 1.0); }`;

const VS_ORB = `#version 300 es
in vec2 aPos;
in vec2 aLoc;
in vec4 aCol;
uniform vec2 uCanvas;
out vec2 vLoc;
out vec4 vCol;
void main() {
  gl_Position = vec4(aPos.x / uCanvas.x * 2.0 - 1.0, 1.0 - aPos.y / uCanvas.y * 2.0, 0.0, 1.0);
  vLoc = aLoc;
  vCol = aCol;
}`;
// in orb radii: a hot core, a halo of its colour, a wide soft bloom; faded out at the sprite's edge
const FS_ORB = `#version 300 es
precision highp float;
uniform float uSpan;
in vec2 vLoc;
in vec4 vCol;
out vec4 o;
void main() {
  float q = length(vLoc);
  float d = q * uSpan;
  float d2 = d * d;
  float core = exp(-d2 * 2.2);
  float halo = exp(-d2 * 0.45) * 0.42;
  float bloom = exp(-d * 0.8) * 0.11;
  vec3 col = vCol.rgb * (halo + bloom) + mix(vCol.rgb, vec3(1.0), 0.55) * core * 0.6;
  float edge = 1.0 - smoothstep(0.82, 1.0, q);
  o = vec4(col * vCol.a * edge, 0.0);
}`;

function compile(gl, vs, fs, attribs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(`shader: ${log}`); }
    return s;
  };
  const v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs), p = gl.createProgram();
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
  const u = {}, nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nu; i++) { const info = gl.getActiveUniform(p, i); if (info) u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

function texture(gl, img, { mip = false } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  if (img) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  if (mip && img) gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}

const dims = (img) => [img ? img.naturalWidth || img.videoWidth || img.width || 0 : 0, img ? img.naturalHeight || img.videoHeight || img.height || 0 : 0];
const devDpr = () => (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

// the browser's fetch / Image / canvas, unless the caller brings its own (node tests)
const DOM_IO = {
  async json(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  },
  image(url) {
    return new Promise((ok, no) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.decoding = 'async';
      im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => ok(im));
      im.onerror = () => no(new Error(`image ${url}`));
      im.src = url;
    });
  },
  pixels(img) {
    const [w, h] = dims(img), c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    return { data: g.getImageData(0, 0, w, h).data, w, h };
  },
  canvas() { return document.createElement('canvas'); },
};

export class GigiPortrait {
  // opts: {seed, background: 'stage' | 'plate' | 'none' (a transparent canvas over the page's own oasis), dpr (cap,
  //   default 2), size: [w, h] (a fixed backing size, e.g. [1280, 720] for a Zoom capture; the canvas box keeps its
  //   aspect, letterboxed in the container), popmouth (the module, else imported next to this one), select (popmouth
  //   SELECT overrides, e.g. {lead_s: LIP_S} as the avatar passes), timeout (ms, default LOAD_TIMEOUT_MS), onfail(reason)
  //   / onrestore() (after load: she can't be drawn / she is drawn again), io: {json, image, pixels, canvas}, now: () =>
  //   ms, raf / caf (the frame clock), canvas, preserve}
  constructor(opts = {}) {
    this.opts = opts;
    this.io = { ...DOM_IO, ...(isObj(opts.io) ? opts.io : {}) };
    this.now = typeof opts.now === 'function' ? opts.now : () => performance.now();
    this.raf = opts.raf || ((f) => requestAnimationFrame(f));
    this.caf = opts.caf || ((h) => cancelAnimationFrame(h));
    this.bg = ['stage', 'plate', 'none'].includes(opts.background) ? opts.background : 'stage';
    this.dprCap = clamp(num(opts.dpr, 2), 0.5, 3);
    this.qual = new Quality(Math.min(this.dprCap, devDpr()));
    this.loaded = false;
    this.failed = false;
    this.loadTok = 0;
    this.error = '';
    this.R = null; this.C = null; this.gl = null; this.canvas = null;
    this.mouth = null;       // {PM, M, S, img, f}
    this.imgs = null;
    this.container = null; this.framing = 'full'; this.crop = null; this.ro = null; this.roOn = null; this.handle = 0; this.running = false;
    this.lines = new Map();
    this.pos = null;
    this.faceKey = '';
    this.view = null;
    this._stats = { fps: 0, ms: 0, dpr: 0, patch: -1, patchB: -1, wB: 0, mouthE: 0, eye: 1, eyeA: -1, eyeB: -1, mode: 'idle', breath: 0,
      run: null, yaw: 0, pitch: 0, roll: 0, verts: 0, tris: 0, faces: 0, frames: 0, mouth: false, eyes: false, depth: false, error: '' };
  }

  static supported() {
    try {
      if (typeof document === 'undefined') return false;
      const c = document.createElement('canvas'), gl = c.getContext('webgl2');
      if (!gl) return false;
      const x = gl.getExtension('WEBGL_lose_context');
      if (x) x.loseContext();
      return true;
    } catch { return false; }
  }

  get stats() { return this._stats; }
  get hasMouth() { return !!this.mouth; }
  get hasEyes() { return !!(this.R && this.R.eyes && this.imgs && this.imgs.eyes); }

  // the portrait's assets (base: its directory, default gigi/portrait/ next to the page) and the mouth library. True
  // when she can be drawn (WebGL2, the rig and the core images); without a mouth library or eyes she still lives. False
  // (never a half-drawn Gigi) on any failure, a WebGL context lost meanwhile, or nothing ready within `timeout` ms
  // (opts.timeout, default LOAD_TIMEOUT_MS): a load that comes in after that is dropped
  async load(base = 'gigi/portrait/', { timeout } = {}) {
    const tok = ++this.loadTok, ms = Math.max(0, num(timeout, num(this.opts.timeout, LOAD_TIMEOUT_MS)));
    let timer = 0;
    const late = new Promise((ok) => { timer = setTimeout(() => ok('timeout'), ms); });
    try {
      if ((await Promise.race([this.loadAssets(base, tok), late])) === 'timeout') throw new Error(`timed out after ${ms} ms`);
      return true;
    } catch (e) {
      if (tok === this.loadTok) {
        this.loadTok++;   // whatever of this load is still in flight is dropped when it lands
        this.loaded = false;
        this.error = String((e && e.message) || e);
        this._stats.error = this.error;
        console.warn('portrait: unavailable:', this.error);
        this.freeGL();
      }
      return false;
    } finally { clearTimeout(timer); }
  }

  async loadAssets(base, tok) {
    const live = () => {   // after every wait: still the load the page is waiting for, on a live context
      if (tok !== this.loadTok) throw new Error('load superseded');
      if (this.lost || (this.gl && this.gl.isContextLost && this.gl.isContextLost())) throw new Error('WebGL context lost');
    };
    const root = typeof document !== 'undefined' && document.baseURI ? document.baseURI : (this.opts.baseURI || 'http://localhost/');
    const baseUrl = new URL(base, root);
    const rigUrl = new URL('rig.json', baseUrl);
    const rig = await this.io.json(rigUrl.href);
    live();
    if (!isObj(rig)) throw new Error('rig.json: not an object');
    if (rig.v !== undefined && rig.v !== PORTRAIT_V) throw new Error(`rig.json: v${rig.v}, this renderer reads v${PORTRAIT_V}`);
    const R = prepareRig(rig);
    // every asset rides on the rig's cache key (portrait.py: a hash of the images); rig.json itself is fetched uncached
    const v = rig.cache;
    const at = (name, rel = baseUrl) => { const u = new URL(name, rel); if (v) u.searchParams.set('v', String(v)); return u.href; };
    this.canvas = this.canvas || this.opts.canvas || this.io.canvas();
    this.lost = false;
    this.initGL();
    const opt = (p) => p.catch((e) => { console.warn('portrait:', e.message || e); return null; });
    const sg = R.framing.stage;
    const [master, matte, plate, depth, eyes, stage, mouth] = await Promise.all([
      this.io.image(at('master.webp')), this.io.image(at('gigi.webp')), opt(this.io.image(at('plate.webp'))),
      opt(this.io.image(at('depth.webp'))), R.eyes ? opt(this.io.image(at('eyes.webp'))) : null,
      sg && sg.image && this.bg === 'stage' ? opt(this.io.image(at(sg.image, rigUrl))) : null,
      opt(this.loadMouth(new URL(R.mouth, rigUrl), R.size)),
    ]);
    live();
    let on = null;
    try { const mp = this.io.pixels(matte); on = matteAt(R, depthSampler(mp.data, mp.w, mp.h, R.size, 3)); }
    catch (e) { console.warn('portrait: matte unreadable, the margin taken as it is:', e.message || e); }
    if (on) fitMargin(R, on);
    if (depth) {
      const px = this.io.pixels(depth);
      setDepth(R, depthSampler(px.data, px.w, px.h, R.size), R.headDepth, on);
    }
    this.R = R;
    this.imgs = { master, matte, plate, eyes, stage };
    this.mouth = mouth;
    this.C = new Controller(R, { seed: this.opts.seed });
    this.pos = new Float32Array(R.n * 2);
    this.upload();
    live();
    this.loaded = true;
    this.failed = false;
    if (this.canvas && this.canvas.style) this.canvas.style.visibility = '';
    Object.assign(this._stats, { verts: R.n, tris: R.tris.length / 3, mouth: !!mouth, eyes: this.hasEyes, depth: R.hasDepth,
      patches: mouth ? mouth.M.n : 0, error: '' });
    if (this.container) { this.resize(); this.start(); }
    return true;
  }

  // after load: she can't be drawn (a lost context, a failed draw). The canvas is hidden (never an empty or frozen
  // frame over the page) and the page told, once per failure
  fail(why) {
    this.stop();
    this.error = String(why);
    this._stats.error = this.error;
    if (this.canvas && this.canvas.style) this.canvas.style.visibility = 'hidden';
    if (this.failed) return;
    this.failed = true;
    console.warn('portrait:', this.error);
    if (typeof this.opts.onfail === 'function') { try { this.opts.onfail(this.error); } catch (e) { console.warn('portrait: onfail', e); } }
  }

  async loadMouth(url, size) {
    let PM = this.opts.popmouth;
    // (the literal specifier: production/publish.py stamps it with popmouth.js's hash, as it does app.js's, so a publish
    // can never pair a cached old popmouth.js with a new portrait.js)
    if (!PM) PM = await import('./popmouth.js');
    if (!PM || typeof PM.decodeMouth !== 'function' || typeof PM.planLine !== 'function' || typeof PM.pickAt !== 'function') throw new Error('popmouth.js: no decodeMouth / planLine / pickAt');
    const j = await this.io.json(url.href), M = PM.decodeMouth(j);
    const au = new URL(typeof j.atlas === 'string' && j.atlas ? j.atlas : 'atlas.webp', url);
    if (j.atlas_v) au.searchParams.set('v', String(j.atlas_v));
    const img = await this.io.image(au.href);
    let rows = 0, cols = 0;
    for (let i = 0; i < M.n; i++) { rows = Math.max(rows, M.row[i] + 1); cols = Math.max(cols, M.col[i] + 1); }
    const [w, h] = dims(img);
    if (w + 0.5 < cols * M.cell[0] || h + 0.5 < rows * M.cell[1]) throw new Error(`mouth atlas ${w}x${h} is smaller than its ${cols}x${rows} cells`);
    const gl = this.gl, max = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 4096;
    if (w > max || h > max) throw new Error(`mouth atlas ${w}x${h} is over this GPU's ${max}`);
    const S = { ...(PM.SELECT || {}), ...(M.select || {}), ...(isObj(this.opts.select) ? this.opts.select : {}) };
    // how much of each orb a patch's own chin covers (mouthlib.py patches[].occ): an open jaw hides the throat orb's glow,
    // as it does in Popcorn, instead of the glow shining through the chin
    const occ = {};
    j.patches.forEach((p, k) => {
      const i = Number.isInteger(p && p.i) ? p.i : k;
      for (const [nm, v] of Object.entries((p && p.occ) || {})) (occ[nm] ||= new Float32Array(M.n))[i] = Number(v) || 0;
    });
    return { PM, M, S, img, f: size / (M.size || size), w, h, occ };
  }

  // ---------------------------------------------------------------- GL
  initGL() {
    const c = this.canvas;
    const gl = this.opts.gl || c.getContext('webgl2', { alpha: this.bg === 'none', premultipliedAlpha: true, antialias: false, depth: false,
      stencil: false, preserveDrawingBuffer: !!this.opts.preserve, powerPreference: 'default' });
    if (!gl) throw new Error('no WebGL2');
    this.gl = gl;
    if (!this.lostFn && c.addEventListener) {
      // (while loading, load() sees this.lost and resolves false; once she is up, the page is told)
      this.lostFn = (e) => { if (e && e.preventDefault) e.preventDefault(); this.lost = true; this.stop(); if (this.loaded) this.fail('WebGL context lost'); };
      this.restoreFn = () => {
        if (!this.loaded) return;
        try {
          this.lost = false;
          this.initGL();
          this.upload();
          this.failed = false;
          this.error = this._stats.error = '';
          if (c.style) c.style.visibility = '';
          if (this.container) { this.resize(); this.start(); }
          if (typeof this.opts.onrestore === 'function') this.opts.onrestore();
        } catch (e) { this.fail(`WebGL restore failed: ${(e && e.message) || e}`); }
      };
      c.addEventListener('webglcontextlost', this.lostFn, false);
      c.addEventListener('webglcontextrestored', this.restoreFn, false);
    }
    this.P = {
      face: compile(gl, VS_FULL, FS_FACE, []),
      mesh: compile(gl, VS_MESH, FS_MESH, ['aPos', 'aUv']),
      quad: compile(gl, VS_QUAD, FS_QUAD, ['aPos', 'aUv']),
      orb: compile(gl, VS_ORB, FS_ORB, ['aPos', 'aLoc', 'aCol']),
    };
  }

  // textures, the face target and the buffers, from the loaded images and rig
  upload() {
    const gl = this.gl, R = this.R, I = this.imgs, T = {};
    T.master = texture(gl, I.master);
    T.matte = texture(gl, I.matte);
    T.plate = I.plate ? texture(gl, I.plate, { mip: true }) : null;
    T.stage = I.stage ? texture(gl, I.stage, { mip: true }) : null;
    T.eyes = texture(gl, I.eyes || null);
    T.mouth = texture(gl, this.mouth ? this.mouth.img : null);
    T.face = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, T.face);
    const levels = 1 + Math.floor(Math.log2(R.size));
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, R.size, R.size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, T.face, 0);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`face target incomplete (${st})`);
    this.T = T;
    // the mesh: rest positions (rewritten every frame), texture coordinates, triangles
    this.vaoFull = gl.createVertexArray();
    this.vaoMesh = gl.createVertexArray();
    gl.bindVertexArray(this.vaoMesh);
    this.bPos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bPos);
    gl.bufferData(gl.ARRAY_BUFFER, R.rest, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.bUv = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bUv);
    gl.bufferData(gl.ARRAY_BUFFER, R.uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    this.bIdx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bIdx);
    const big = R.n > 65535;
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? R.tris : Uint16Array.from(R.tris), gl.STATIC_DRAW);
    this.idxType = big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    gl.bindVertexArray(null);
    // the background quad and the orb sprites: rewritten per frame
    this.quadData = new Float32Array(24);
    this.vaoQuad = gl.createVertexArray();
    gl.bindVertexArray(this.vaoQuad);
    this.bQuad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bQuad);
    gl.bufferData(gl.ARRAY_BUFFER, this.quadData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
    this.orbData = new Float32Array(Math.max(1, R.orbs.length) * 6 * 8);
    this.vaoOrb = gl.createVertexArray();
    gl.bindVertexArray(this.vaoOrb);
    this.bOrb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bOrb);
    gl.bufferData(gl.ARRAY_BUFFER, this.orbData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);
    // samplers and the constant uniforms
    const F = this.P.face;
    gl.useProgram(F.p);
    gl.uniform1i(F.u.uMaster, 0); gl.uniform1i(F.u.uMatte, 1); gl.uniform1i(F.u.uMouth, 2); gl.uniform1i(F.u.uEyes, 3);
    gl.uniform2f(F.u.uSize, R.size, R.size);
    gl.uniform2f(F.u.uKey, 0.05, 0.13);
    const m = this.mouth;
    if (m) {
      const f = m.f, rg = m.M.region;
      gl.uniform4f(F.u.uMReg, rg[0] * f, rg[1] * f, rg[2] * f, rg[3] * f);
      gl.uniform2f(F.u.uMSc, m.M.scale / f, m.M.scale / f);
      gl.uniform2f(F.u.uMTex, m.w, m.h);
    } else gl.uniform4f(F.u.uMReg, -1, -1, 0, 0);
    const E = R.eyes;
    if (E && I.eyes) {
      const [w, h] = dims(I.eyes);
      gl.uniform4f(F.u.uEReg, E.region[0], E.region[1], E.region[2], E.region[3]);
      gl.uniform2f(F.u.uESc, E.cell[0] / E.region[2], E.cell[1] / E.region[3]);
      gl.uniform2f(F.u.uETex, w, h);
    } else gl.uniform4f(F.u.uEReg, -1, -1, 0, 0);
    gl.uniform2f(F.u.uMW, 0, 0);
    gl.uniform2f(F.u.uEW, 0, 0);
    // after the first full draw only the mouth and eye regions ever change: later face draws shade just their union
    const rs = [];
    if (m) { const f = m.f, rg = m.M.region; rs.push([rg[0] * f, rg[1] * f, rg[2] * f, rg[3] * f]); }
    if (E && I.eyes) rs.push(E.region);
    if (rs.length) {
      const x0 = clamp(Math.floor(Math.min(...rs.map((r) => r[0]))) - 2, 0, R.size), y0 = clamp(Math.floor(Math.min(...rs.map((r) => r[1]))) - 2, 0, R.size);
      const x1 = clamp(Math.ceil(Math.max(...rs.map((r) => r[0] + r[2]))) + 2, 0, R.size), y1 = clamp(Math.ceil(Math.max(...rs.map((r) => r[1] + r[3]))) + 2, 0, R.size);
      this.faceRect = x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
    } else this.faceRect = null;
    this.faceFull = true;
    gl.useProgram(this.P.mesh.p); gl.uniform1i(this.P.mesh.u.uFace, 0);
    gl.useProgram(this.P.quad.p); gl.uniform1i(this.P.quad.u.uTex, 0);
    gl.useProgram(this.P.orb.p); gl.uniform1f(this.P.orb.u.uSpan, ORB_SPRITE);
    gl.useProgram(null);
    this.faceKey = '';
  }

  freeGL() {
    const gl = this.gl;
    if (!gl) return;
    try {
      for (const t of Object.values(this.T || {})) if (t) gl.deleteTexture(t);
      for (const b of [this.bPos, this.bUv, this.bIdx, this.bQuad, this.bOrb]) if (b) gl.deleteBuffer(b);
      for (const v of [this.vaoFull, this.vaoMesh, this.vaoQuad, this.vaoOrb]) if (v) gl.deleteVertexArray(v);
      if (this.fbo) gl.deleteFramebuffer(this.fbo);
      for (const p of Object.values(this.P || {})) if (p) gl.deleteProgram(p.p);
    } catch { /* lost */ }
    this.T = this.P = null;
    this.fbo = this.bPos = this.bUv = this.bIdx = this.bQuad = this.bOrb = null;
    this.vaoFull = this.vaoMesh = this.vaoQuad = this.vaoOrb = null;
  }

  // ---------------------------------------------------------------- the page
  // framing: 'square' (rig.framing.square covers the box: Neck and Neck's tile), 'wide' (the largest 16:9 in the box, the
  // page's stage layout inside it: a Zoom frame), 'full' (the page's stage layout over the whole box: any aspect).
  // crop: [x, y, w, h] master px for 'square' instead of the rig's (e.g. [0, 0, 720, 720]: the whole master)
  attach(container, { framing, crop } = {}) {
    if (framing) this.framing = ['square', 'wide', 'full'].includes(framing) ? framing : 'full';
    if (crop !== undefined) this.crop = Array.isArray(crop) && crop.length === 4 && crop.every(Number.isFinite) && crop[2] > 0 && crop[3] > 0 ? crop.slice() : null;
    this.container = container;
    const c = this.canvas || (this.canvas = this.opts.canvas || this.io.canvas());
    c.className = 'gigi-portrait';
    if (c.style) c.style.cssText = `position:absolute;display:block;pointer-events:none;${this.failed ? 'visibility:hidden;' : ''}`;
    if (container && typeof getComputedStyle === 'function' && getComputedStyle(container).position === 'static') container.style.position = 'relative';
    if (container && c.parentElement !== container && container.appendChild) container.appendChild(c);
    if (this.ro && this.roOn !== container) { this.ro.disconnect(); this.ro = null; }
    if (!this.ro && typeof ResizeObserver !== 'undefined' && container) { this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(container); this.roOn = container; }
    this.resize();
    if (this.loaded) this.start();
  }

  setFraming(framing, crop) {
    this.framing = ['square', 'wide', 'full'].includes(framing) ? framing : 'full';
    if (crop !== undefined) this.crop = Array.isArray(crop) && crop.length === 4 && crop.every(Number.isFinite) && crop[2] > 0 && crop[3] > 0 ? crop.slice() : null;
    this.resize();
  }

  detach() {
    this.stop();
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    if (this.canvas && this.canvas.parentElement) this.canvas.parentElement.removeChild(this.canvas);
    this.container = null;
  }

  // the pixel-ratio cap (the governor works under it, from here)
  setQuality(dpr) { this.dprCap = clamp(num(dpr, 2), 0.5, 3); this.qual = new Quality(Math.min(this.dprCap, devDpr())); this.resize(); }

  resize() {
    const c = this.canvas, box = this.container;
    if (!c || !box) return;
    const cw = box.clientWidth || 0, ch = box.clientHeight || 0;
    let [l, t, w, h] = boxFor(this.framing, cw, ch);
    const S = this.opts.size, fixed = Array.isArray(S) && S.length >= 2 && S[0] > 0 && S[1] > 0 ? [Math.round(S[0]), Math.round(S[1])] : null;
    if (fixed && w > 0 && h > 0) {   // a fixed backing size: the box keeps its aspect (letterboxed), never a stretched picture
      const a = fixed[0] / fixed[1];
      if (w / h > a) { const nw = h * a; l += (w - nw) / 2; w = nw; } else { const nh = w / a; t += (h - nh) / 2; h = nh; }
    }
    if (c.style) Object.assign(c.style, { left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${h}px` });
    const dev = devDpr();
    this.qual.setMax(Math.min(dev, this.dprCap));
    const dpr = Math.min(dev, this.dprCap, this.qual.cap);
    const W = fixed ? fixed[0] : Math.max(1, Math.round(w * dpr)), H = fixed ? fixed[1] : Math.max(1, Math.round(h * dpr));
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    this.qual.reset();
    this.cssW = w; this.cssH = h;
    this._stats.dpr = w > 0 ? +(W / w).toFixed(2) : 0;
    const fr = this.R ? (this.crop ? { ...this.R.framing, square: this.crop } : this.R.framing) : null;
    this.view = this.R && w > 0 && h > 0 ? viewFor(this.framing, W, H, this.R.size, fr) : null;
  }

  start() {
    if (this.running || !this.loaded || this.lost || this.failed) return;
    this.qual.reset();
    this.running = true;
    const tick = () => { if (!this.running) return; this.handle = this.raf(tick); this.frame(this.now()); };
    this.handle = this.raf(tick);
  }

  stop() { this.running = false; if (this.handle) this.caf(this.handle); this.handle = 0; }
  pause() { this.stop(); }
  resume() { if (this.container) this.start(); }

  // ---------------------------------------------------------------- what she does
  breathRun(run, t0 = this.now()) { return !!this.C && this.C.breathRun(run, t0); }
  // a group room: each breath phase the agent publishes ({kind, dur, into, seq}, as app.js gives the pacer)
  breathPhase(b, at = this.now()) { return !!this.C && this.C.breathPhase(b, at); }
  stopBreath() { if (this.C) this.C.stopBreath(); }
  listen(on = true) { if (this.C) this.C.listen(on); }
  idle() { this.listen(false); }

  // line: {id, env, vis, dur} (base64 or bytes; the gigi.lips packet or a manifest clip), takeTime(): the take time heard
  // (s; null while unknown). The mouth path is planned now, cached by id AND content (lineSig: the lab restarts live ids
  // at live-0 every session, so a reused id with new words is planned afresh). True when her mouth will move with it
  speak(line, takeTime = line && line.takeTime) {
    if (!this.C || !line || typeof takeTime !== 'function') return false;
    const env = b64bytes(line.env);
    if (!env) return false;
    const vis = line.vis ? b64bytes(line.vis) : null;
    const id = String(line.id || `line-${this.lines.size}`), dur = num(line.dur, 0) > 0 ? line.dur : env.length * HOP_S;
    const sig = lineSig(env, vis, dur);
    let L = this.lines.get(id);
    if (L) this.lines.delete(id);   // (re-inserted below: the cache drops the least recently spoken)
    if (L && L.sig !== sig) L = null;
    if (L) this.lines.set(id, L);
    else {
      let plan = null;
      const m = this.mouth;
      if (m) {
        try { plan = m.PM.planLine(m.M, { id, env: toB64(env), vis: vis ? toB64(vis) : undefined, dur }, m.S, false); }
        catch (e) { console.warn('portrait: plan', e); plan = null; }
      }
      L = { id, sig, env, dur, plan, accents: accentsOf(env) };
      this.lines.set(id, L);
      while (this.lines.size > 8) this.lines.delete(this.lines.keys().next().value);
      if (plan) this._stats.plan = { id, ms: +num(plan.ms, 0).toFixed(1), frames: plan.n, ...(plan.stats || {}) };
    }
    const m = this.mouth;
    // (popmouth's lead_s is in the plan's targets, step 2: never again at draw time; pickAt's rAF mode cross-fades
    // successive patches around each 33 ms boundary by sub-frame time)
    this.C.speak({ ...L, takeTime, endS: m ? num(m.S.end_s, 0.15) : 0.15, pick: m ? (p, tt) => m.PM.pickAt(p, tt, m.S) : null });
    return !!L.plan;
  }

  stopSpeaking(fade = true) { if (this.C) this.C.stopSpeaking(fade); }

  // ---------------------------------------------------------------- one frame
  frame(now = this.now()) {
    if (!this.loaded || !this.gl || this.lost || this.failed) return;
    if (this.gl.isContextLost && this.gl.isContextLost()) { this.lost = true; this.fail('WebGL context lost'); return; }
    try {
      const t0 = this.now();
      const o = this.C.update(now);
      deform(this.R, o.pose, this.pos);
      if (this.view) this.render(o);
      this.track(o, now, this.now() - t0);
    } catch (e) { this.fail(`drawing failed: ${(e && e.message) || e}`); }
  }

  render(o) {
    const gl = this.gl, R = this.R, T = this.T, c = this.canvas, v = this.view;
    this.face(o);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, c.width, c.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    if (this.bg === 'none') gl.clearColor(0, 0, 0, 0); else gl.clearColor(BG[0], BG[1], BG[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // the oasis exactly where the page lays it, held still: a fixed camera's background doesn't move when she turns
    const bgTex = this.bg === 'stage' && T.stage ? T.stage : this.bg !== 'none' && T.plate ? T.plate : null;
    if (bgTex) {
      const r = bgTex === T.stage && v.stage ? v.stage : v.plate;
      const x0 = r[0], y0 = r[1], x1 = x0 + r[2], y1 = y0 + r[3];
      const q = this.quadData;
      q.set([x0, y0, 0, 0, x1, y0, 1, 0, x0, y1, 0, 1, x0, y1, 0, 1, x1, y0, 1, 0, x1, y1, 1, 1]);
      gl.useProgram(this.P.quad.p);
      gl.uniform2f(this.P.quad.u.uCanvas, c.width, c.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bgTex);
      gl.bindVertexArray(this.vaoQuad);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bQuad);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, q);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    // Gigi: the deformed mesh, textured with this frame's face, cut by her matte
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.P.mesh.p);
    gl.uniform3f(this.P.mesh.u.uView, v.k, v.ox, v.oy);
    gl.uniform2f(this.P.mesh.u.uCanvas, c.width, c.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, T.face);
    gl.bindVertexArray(this.vaoMesh);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bPos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pos);
    gl.drawElements(gl.TRIANGLES, R.tris.length, this.idxType, 0);
    // her chakras: light added at the deformed orb centres
    const n = R.orbs.length;
    if (n) {
      const d = this.orbData;
      let k = 0, live = 0;
      for (let i = 0; i < n; i++) {
        const orb = R.orbs[i], q = this.mouth && this.mouth.occ && this.mouth.occ[orb.name], mo = o.mouth;
        let lv = o.orbs[i];
        if (q && mo.a >= 0 && mo.E > 0) lv *= 1 - mo.E * ((1 - mo.w) * q[mo.a] + mo.w * q[mo.b >= 0 ? mo.b : mo.a]);
        if (lv < 0.004) continue;
        const [mx, my] = pointAt(this.pos, orb.loc), x = mx * v.k + v.ox, y = my * v.k + v.oy, hs = orb.r * ORB_SPRITE * v.k;
        const [rr, gg, bb] = orb.rgb;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]]) {
          d[k++] = x + sx * hs; d[k++] = y + sy * hs; d[k++] = sx; d[k++] = sy; d[k++] = rr; d[k++] = gg; d[k++] = bb; d[k++] = lv;
        }
        live++;
      }
      if (live) {
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
        gl.useProgram(this.P.orb.p);
        gl.uniform2f(this.P.orb.u.uCanvas, c.width, c.height);
        gl.bindVertexArray(this.vaoOrb);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bOrb);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, k);
        gl.drawArrays(gl.TRIANGLES, 0, live * 6);
      }
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  // the face target, redrawn only when the mouth or the eyes changed
  face(o) {
    const gl = this.gl, R = this.R, T = this.T, F = this.P.face, m = this.mouth, M = m && m.M, mo = o.mouth;
    const eb = R.eyes && this.imgs.eyes ? eyeSnap(R.eyes.levels, o.eye) : { a: -1, wa: 0, b: -1, wb: 0 };   // one level, never two
    const mA = M && mo.a >= 0 && mo.E > 0 ? mo.a : -1, mB = mA >= 0 && mo.b >= 0 && mo.w > 0.003 ? mo.b : -1;
    const key = `${mA},${mB},${Math.round(mo.E * 255)},${Math.round(mo.w * 255)}|${eb.a},${eb.b},${Math.round(eb.wa * 255)},${Math.round(eb.wb * 255)}`;
    this._stats.patch = mA; this._stats.patchB = mB; this._stats.wB = mB >= 0 ? +mo.w.toFixed(2) : 0; this._stats.mouthE = +mo.E.toFixed(2);
    this._stats.eye = +o.eye.toFixed(2); this._stats.eyeA = eb.a; this._stats.eyeB = eb.b;
    if (key === this.faceKey) return;
    this.faceKey = key;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, R.size, R.size);
    gl.disable(gl.BLEND);
    gl.useProgram(F.p);
    const cellOf = (col, row, cw, ch) => [col * cw, row * ch, cw, ch];
    if (mA >= 0) {
      const [cw, ch] = M.cell, a = cellOf(M.col[mA], M.row[mA], cw, ch), b = mB >= 0 ? cellOf(M.col[mB], M.row[mB], cw, ch) : a;
      gl.uniform4f(F.u.uMA, a[0], a[1], a[2], a[3]);
      gl.uniform4f(F.u.uMB, b[0], b[1], b[2], b[3]);
      gl.uniform3f(F.u.uGA, M.gain[3 * mA], M.gain[3 * mA + 1], M.gain[3 * mA + 2]);
      const gb = mB >= 0 ? mB : mA;
      gl.uniform3f(F.u.uGB, M.gain[3 * gb], M.gain[3 * gb + 1], M.gain[3 * gb + 2]);
      gl.uniform2f(F.u.uMW, mo.E, mB >= 0 ? mo.E * mo.w : 0);
    } else gl.uniform2f(F.u.uMW, 0, 0);
    if (eb.a >= 0) {
      const E = R.eyes, [cw, ch] = E.cell, la = E.levels[eb.a], lb = eb.b >= 0 ? E.levels[eb.b] : la;
      gl.uniform4f(F.u.uEA, la.col * cw, la.row * ch, cw, ch);
      gl.uniform4f(F.u.uEB, lb.col * cw, lb.row * ch, cw, ch);
      gl.uniform2f(F.u.uEW, eb.wa, eb.b >= 0 ? eb.wb : 0);
    } else gl.uniform2f(F.u.uEW, 0, 0);
    const units = [T.master, T.matte, T.mouth, T.eyes];
    units.forEach((t, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); });
    gl.bindVertexArray(this.vaoFull);
    // (the target's rows are master rows, so the scissor box is in master px as it stands)
    const part = !this.faceFull && this.faceRect;
    if (part) { gl.enable(gl.SCISSOR_TEST); gl.scissor(part[0], part[1], part[2], part[3]); }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (part) gl.disable(gl.SCISSOR_TEST);
    this.faceFull = false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, T.face);
    gl.generateMipmap(gl.TEXTURE_2D);
    this._stats.faces++;
  }

  // stats, and the pixel ratio stepped down on real jank / back up when smooth again (Quality; never for a fixed size)
  track(o, now, ms) {
    const s = this._stats, P = o.pose;
    s.frames++;
    s.ms = +ms.toFixed(2);
    s.mode = o.mode; s.breath = +o.breath.toFixed(3); s.run = o.runPart; s.take = o.take === null ? null : +o.take.toFixed(3);
    s.yaw = +(P.yaw / D2R).toFixed(2); s.pitch = +(P.pitch / D2R).toFixed(2); s.roll = +(P.roll / D2R).toFixed(2);
    const cap = this.qual.sample(now);
    s.fps = this.qual.fps;
    s.jank = this.qual.last;
    if (cap !== null && !this.opts.size) this.resize();
  }

  dispose() {
    this.loadTok++;   // a load still in flight is dropped
    this.detach();
    this.freeGL();
    if (this.canvas && this.lostFn && this.canvas.removeEventListener) {
      this.canvas.removeEventListener('webglcontextlost', this.lostFn);
      this.canvas.removeEventListener('webglcontextrestored', this.restoreFn);
    }
    const x = this.gl && this.gl.getExtension && this.gl.getExtension('WEBGL_lose_context');
    if (x && !this.opts.gl) x.loseContext();
    this.gl = null;
    this.loaded = false;
    this.lines.clear();
    this.imgs = null;
    this.mouth = null;
  }
}
