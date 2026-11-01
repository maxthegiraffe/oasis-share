// Gigi's live mouth for the /ai/setup guide (Max, 2026-10-30: "her lips arent synced with the content"). The guide's
// voice is an ElevenLabs agent streamed to the page, so there is no per-line plan from talk_agent.py as on /withgigi.
// Instead her mouth follows the sounds she is heard making: each audio chunk comes with its characters' timings
// (onAudioAlignment), and the page works out when that chunk is heard (AISetup.jsx); each letter's viseme picks one of its Popcorn mouths
// (guideVisemes.js), crossfaded from the last one, and her own mouth shows again between phrases. The drawing is
// talk.js's: the same mouth library (grateful.gg/media/gigi-live), each cell's patch plus the idle base's chin cover,
// warped by the head track onto the base frame on screen, over her cut-out idle video.
import { mul, apply, displayMap, patchMatrix } from './popmouth.js';
import { VISEME_CELLS, charViseme } from './guideVisemes.js';
// grateful.gg/gigi copy (2026-11-01): drawn at the phone's own sharpness (up to 3x, was 2x) with high-quality scaling (was
// low). Her face fills a phone screen here, not a corner as on /ai/setup, and the low-res, low-quality mouth looked soft
// against her face (Max: "her lips on mobile look worse").

const ASSETS = 'https://grateful.gg/media/gigi-live/';   // as talk.js
const FPS = 30;
const XFADE_MS = 70;     // a new sound's mouth fades in over this long
const GAP_MS = 160;      // a pause in her voice shorter than this keeps the last mouth (word gaps); longer, it fades out
const FADE_MS = 120;     // her own mouth comes back over this long
const KEEP_MS = 4000;    // sounds kept after they are heard
const STONE_FROM = 0.5, STONE_TO = 0.58;   // of a cell's height: below her chin, above the top stone (grateful.gg/gigi)

const st = { M: null, loading: null, sounds: [], el: null, gen: 0, dirty: null };
if (typeof window !== 'undefined') window.gigiGuideMouth = st;   // (for a look in the console: .sounds, .drawn)

// talk.js loadMouth: cover0.webp (the chin cover per base frame) and rgb<j>.webp + a<j>.webp (256 cells a sheet)
async function loadMouth() {
  const M = await (await fetch(ASSETS + 'mouth2.json')).json();
  const [cw, ch] = M.cell, per = cw * ch * 4, G = M.pack.g, S = G * G, J = M.pack.sheets;
  const files = ['cover0.webp'];
  for (let j = 0; j < J; j++) files.push(`rgb${j}.webp`, `a${j}.webp`);
  const blobs = files.map((f) => fetch(ASSETS + f).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.blob(); }));
  blobs.forEach((p) => p.catch(() => {}));
  const sw = G * cw, sh = G * ch, row = sw * 4;
  const cv = document.createElement('canvas');
  cv.width = sw; cv.height = sh;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const pixels = async (p) => {
    const bm = await createImageBitmap(await p, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    cx.clearRect(0, 0, sw, sh);
    cx.drawImage(bm, 0, 0);
    bm.close?.();
    return cx.getImageData(0, 0, sw, sh).data;
  };
  const cover = new Uint8Array(M.frames * cw * ch), cells = new Uint8Array(M.n * per);
  const d = await pixels(blobs[0]);
  for (let f = 0; f < M.frames; f++) {
    const r0 = Math.floor(f / G) * ch, c0 = (f % G) * cw;
    for (let y = 0; y < ch; y++) {
      let q = (r0 + y) * row + c0 * 4, o = (f * ch + y) * cw;
      for (let x = 0; x < cw; x++, q += 4) cover[o + x] = d[q];
    }
  }
  for (let j = 0; j < J; j++) {
    const rgb = await pixels(blobs[1 + 2 * j]), al = await pixels(blobs[2 + 2 * j]);
    for (let i = 0, m = Math.min(S, M.n - j * S); i < m; i++) {
      const r0 = Math.floor(i / G) * ch, c0 = (i % G) * cw, at = (j * S + i) * per;
      for (let y = 0; y < ch; y++) {
        let q = (r0 + y) * row + c0 * 4, o = at + y * cw * 4;
        for (let x = 0; x < cw; x++, q += 4, o += 4) {
          cells[o] = rgb[q]; cells[o + 1] = rgb[q + 1]; cells[o + 2] = rgb[q + 2]; cells[o + 3] = al[q];
        }
      }
    }
  }
  cv.width = cv.height = 0;
  const pc = document.createElement('canvas');
  pc.width = cw; pc.height = ch;
  Object.assign(st, { M, cells, cover, cw, ch, per, acc: new Float32Array(per), img: new ImageData(cw, ch), pc, pctx: pc.getContext('2d') });
}

/** Start loading her mouth library (about 10 MB, once). Safe to call again. */
export function preloadMouth() {
  if (!st.loading) st.loading = loadMouth().catch((e) => { console.warn('guide mouth: library failed, her own mouth shows:', e); st.loading = null; });
  return st.loading;
}

/** A chunk of her voice, heard from `at` (performance.now() time): its characters' timings (ElevenLabs alignment). */
export function hear(alignment, at = performance.now()) {
  const chars = alignment?.chars || [], t0s = alignment?.char_start_times_ms || [], durs = alignment?.char_durations_ms || [];
  const now = at;
  st.sounds = st.sounds.filter((s) => s.to > performance.now() - KEEP_MS);
  for (let i = 0; i < chars.length; i++) {
    const vis = charViseme(chars, i);
    if (!vis || !VISEME_CELLS[vis]) continue;
    const from = now + (+t0s[i] || 0), to = from + Math.max(40, +durs[i] || 0);
    const pool = VISEME_CELLS[vis];
    st.sounds.push({ vis, cell: pool[(st.sounds.length + i) % pool.length], from, to });
  }
}

/** She stopped (finished, or was interrupted): sounds not yet heard are dropped. */
export function quiet() {
  const now = performance.now();
  st.sounds = st.sounds.filter((s) => s.from <= now).map((s) => ({ ...s, to: Math.min(s.to, now) }));
}

// The mouth at time t: [[cell, weight], ...] and the opacity E over her own mouth, or null.
function mouthAt(t) {
  const S = st.sounds;
  let k = -1;
  for (let i = S.length - 1; i >= 0; i--) if (S[i].from <= t) { k = i; break; }
  if (k < 0) return null;
  const cur = S[k];
  const gap = t - cur.to;
  // a short gap (between words) holds the mouth; a longer one lets her own mouth come back
  const E = gap <= GAP_MS ? 1 : Math.max(0, 1 - (gap - GAP_MS) / FADE_MS);
  if (E <= 0) return null;
  const prev = k > 0 && cur.from - S[k - 1].to < GAP_MS ? S[k - 1] : null;
  const w = prev && prev.cell !== cur.cell ? Math.min(1, (t - cur.from) / XFADE_MS) : 1;
  const parts = w < 1 ? [[prev.cell, 1 - w], [cur.cell, w]] : [[cur.cell, 1]];
  // her mouth opens into the first sound of a phrase rather than snapping to it
  const onset = prev ? 1 : Math.min(1, (t - cur.from) / XFADE_MS + 0.3);
  return { parts, E: E * onset };
}

// talk.js compose: the parts summed in float32, then the base frame's chin cover raises the alpha
function compose(parts, f) {
  const { cells, cover, per, cw, ch, acc, img } = st, out = img.data;
  if (parts.length === 1) {
    const o = parts[0][0] * per;
    out.set(cells.subarray(o, o + per));
  } else {
    acc.fill(0);
    for (const [c, w] of parts) {
      const wf = Math.fround(w), o = c * per;
      for (let k = 0; k < per; k++) acc[k] += Math.fround(wf * cells[o + k]);
    }
    for (let k = 0; k < per; k++) {
      const v = Math.floor(Math.fround(acc[k] + 0.5));
      out[k] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  const co = f * cw * ch;
  for (let k = 0, a = 3; k < cw * ch; k++, a += 4) if (cover[co + k] > out[a]) out[a] = cover[co + k];
  // grateful.gg/gigi: each cell ends just below her chin, over the top stone on her neck. The stone glows and pulses in
  // the video but is frozen and dim in the cells, so on a phone it blinked out with every word (Max, 11-01: "her lips on
  // mobile look worse"). The patch fades out between the chin and the stone, so her own stone always shows.
  const y0 = Math.round(ch * STONE_FROM), y1 = Math.round(ch * STONE_TO);
  for (let y = y0; y < ch; y++) {
    const keep = y >= y1 ? 0 : 1 - (y - y0) / (y1 - y0);
    for (let x = 0, a = y * cw * 4 + 3; x < cw; x++, a += 4) out[a] = Math.round(out[a] * keep);
  }
  return img;
}

function bbox(m, W, H) {
  const { cw, ch } = st;
  const pts = [apply(m, 0, 0), apply(m, cw, 0), apply(m, 0, ch), apply(m, cw, ch)];
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0]))) - 2), y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1]))) - 2);
  const x1 = Math.min(W, Math.ceil(Math.max(...pts.map((p) => p[0]))) + 2), y1 = Math.min(H, Math.ceil(Math.max(...pts.map((p) => p[1]))) + 2);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}

function draw(video, canvas, meta) {
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(3, (canvas.ownerDocument.defaultView || window).devicePixelRatio || 1);
  const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; st.dirty = null; }
  if (st.dirty) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(...st.dirty); st.dirty = null; }
  if (!st.M || !video.videoWidth) return;
  const m0 = mouthAt(performance.now());
  st.drawn = m0 ? m0.parts.map((p) => p[0]) : null;
  if (!m0) return;
  const mt = meta && Number.isFinite(meta.mediaTime) ? meta.mediaTime : video.currentTime;
  const f = Math.max(0, Math.min(st.M.frames - 1, Math.round(mt * FPS) % st.M.frames));
  const cs = (video.ownerDocument.defaultView || window).getComputedStyle(video);
  const D = mul([W / w, 0, 0, H / h, 0, 0], displayMap(w, h, video.videoWidth, video.videoHeight, cs.objectFit || 'fill', cs.objectPosition));
  const m = patchMatrix(st.M, st.M.track, f, D, video.videoWidth / st.M.size, video.videoHeight / st.M.size);
  st.pctx.putImageData(compose(m0.parts, f), 0, 0);
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalAlpha = m0.E;
  ctx.drawImage(st.pc, 0, 0);
  ctx.globalAlpha = 1;
  st.dirty = bbox(m, W, H);
}

/** Draw her mouth over this video on this canvas (same box) until the returned function is called. One at a time. */
export function attachMouth(video, canvas) {
  preloadMouth();
  const gen = ++st.gen;
  const win = video.ownerDocument.defaultView || window;   // the floating window has its own frame clock
  const safe = (meta) => {
    if (gen !== st.gen) return;
    try { draw(video, canvas, meta); } catch (e) { console.warn('guide mouth: drawing failed:', e); st.gen++; }
  };
  let vfcAt = 0;
  if (typeof video.requestVideoFrameCallback === 'function') {
    const cb = (now, meta) => { if (gen !== st.gen) return; vfcAt = performance.now(); safe(meta); video.requestVideoFrameCallback(cb); };
    video.requestVideoFrameCallback(cb);
  }
  const tick = () => {
    if (gen !== st.gen) return;
    if (performance.now() - vfcAt > 70) safe(null);   // a paused or stalled video still gets her mouth
    win.requestAnimationFrame(tick);
  };
  win.requestAnimationFrame(tick);
  return () => { if (gen === st.gen) st.gen++; };
}
