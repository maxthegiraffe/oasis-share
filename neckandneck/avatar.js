// Gigi on screen, as real rendered video. Three kinds of layers, all pinned to the same portrait so
// they crossfade cleanly:
//   idle  - a listening loop (breathing, blinks, ears), shown whenever she's quiet
//   talk  - a talking loop, shown while she speaks a live line (names, reflections)
//   clips - lip-synced renders of her fixed lines; the agent announces one, and it starts the
//           moment her voice begins (each clip opens with `lead` seconds of silence)
// Solo (1-on-1) adds the walk-up and the breath run (breath-in, breath-<pattern> cycles, breath-out), all
// in the same square, and never shows the talk loop: every video starts and ends on idle frame 0.

const VOICE_ON = 0.012;      // rms above this counts as Gigi speaking
const TALK_AFTER_MS = 80;    // sustained voice before switching to the talking loop
const IDLE_AFTER_MS = 380;   // sustained quiet before going back to idle
const ARM_TIMEOUT_MS = 1500; // start an announced clip anyway if we never catch her voice starting
const HEAD_START_S = 0.02;   // solo: an announced clip starts at once from (nearly) its first frame. Every clip
                            // opens with a short morph out of idle frame 0 (production/heads.py) and her voice
                            // reaches the page ~0.2 s after the announcement, so this lands on her first word;
                            // the lip lock then holds the video on the words
const LIP_S = -0.08;         // video time = the moment of the take being heard + this. Popcorn's mouths open
                            // ~0.17 s before their sound (video_review.py); about half of that lead is natural
const ENV_HOP_S = 0.02;      // the clip envelopes in the manifest (production/envelopes.py): one byte per 20 ms,
const ENV_VOICE = 85;        // 0 = -60 dB, 255 = 0 dB; 85 = -40 dB counts as voice
const PARK_AFTER_MS = 220;   // once a clip has faded in, park the hidden idle loop on its first frame: every
                            // clip ends with a short morph into exactly that frame, so idle resumes seamlessly
const ONSET_FROM = 13;       // solo: the agent drops each WAV's first 0.25 s, so the first sound heard is the take's
                            // first voice from envelope index 13 (0.26 s) on, not a breath or click before it
const WALKUP_WAIT_MS = 4000; // solo: a walk-up that isn't playing by then is skipped (straight to idle, and ready)
const RESYNC_S = 0.08;       // solo breath: at a cycle boundary, seek only if the video drifted more than this
const SETTLE_MS = 220;       // solo: once a layer has faded in, the ones under it go off and pause

// Solo breath runs, on the page's own clock. `b` is the agent's one publish per run:
// {run, pattern, rounds, cycle_s, phases: [[kind, s], ...], lead_s, tail_s}
function shape(b) {
  const ph = (Array.isArray(b.phases) && b.phases.length ? b.phases : [['in', 5.5], ['out', 5.5]]).map(([k, d]) => [k, Number(d) || 0]);
  const C = Number(b.cycle_s) || ph.reduce((a, p) => a + p[1], 0) || 11;
  return { ph, C, n: Math.max(1, Number(b.rounds) || 1), lead: Number(b.lead_s ?? 0.8), tail: Number(b.tail_s ?? 0.8) };
}

// where a run is `ms` after it arrived: breath-in, a cycle (round, phase, time into each), breath-out, or done
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

// the start of every phase of every round, in seconds from the run's arrival (the page's bells)
export function breathMarks(b) {
  const { ph, C, n, lead } = shape(b), out = [];
  for (let c = 0; c < n; c++) { let t = lead + c * C; for (const [, d] of ph) { out.push(t); t += d; } }
  return out;
}

// Gigi's voice, measured every 20 ms off the audio track itself (an AudioWorklet: no gaps, exact times).
const WORKLET = `class NnEnv extends AudioWorkletProcessor {
  constructor() { super(); this.hop = Math.round(sampleRate / 50); this.acc = 0; this.n = 0; this.t0 = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      if (this.n === 0) this.t0 = currentTime + i / sampleRate;
      this.acc += ch[i] * ch[i];
      if (++this.n >= this.hop) { this.port.postMessage([this.t0, Math.sqrt(this.acc / this.n)]); this.acc = 0; this.n = 0; }
    }
    return true;
  }
}
registerProcessor('nn-env', NnEnv);`;

const toByte = (rms) => Math.max(0, Math.min(255, Math.round((20 * Math.log10(rms + 1e-6) + 60) / 60 * 255)));

// The lip lock: while a clip plays, find which moment of its take is being heard (the live voice
// envelope matched against the take's own envelope) and keep the video on that moment. A late video
// start, a slow phone or a network stall in her audio can't drift the lips away from her words.
class LipLock {
  constructor(ctx) {
    this.ctx = ctx;
    this.live = [];          // [context time, envelope byte], the last few seconds
    this.clip = null;
    this.log = [];           // recent fits, for debugging from the console: gigi.lip.log
  }

  async listen(src) {
    const ctx = this.ctx;
    if (!ctx.audioWorklet) return;
    if (!ctx.nnEnvReady) ctx.nnEnvReady = ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
    await ctx.nnEnvReady;
    const node = new AudioWorkletNode(ctx, 'nn-env');
    const sink = ctx.createGain();
    sink.gain.value = 0;                       // pulled by the graph, never heard
    src.connect(node); node.connect(sink); sink.connect(ctx.destination);
    node.port.onmessage = (e) => this.push(e.data[0], toByte(e.data[1]));
    this.node = node; this.sink = sink;
  }

  stop() {
    try { this.node && this.node.disconnect(); this.sink && this.sink.disconnect(); } catch { /* gone */ }
    this.node = this.sink = null;
  }

  heard() { return this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0.02); }

  push(t, q) {
    this.live.push([t, q]);
    if (this.live.length > 300) this.live.splice(0, this.live.length - 300);
    const c = this.clip;
    if (!c || c.off !== null || t < c.from) return;
    if (q < ENV_VOICE - 25) c.quiet = true;                                       // the line before has ended
    else if (c.quiet && q >= ENV_VOICE) { c.off = t - c.onset; c.onsetAt = t; }   // her first sound = the take's
  }

  begin(id, envB64, from, skip = 0) {
    let env = null;
    try { env = Uint8Array.from(atob(envB64 || ''), (ch) => ch.charCodeAt(0)); } catch { env = null; }
    if (!env || !env.length) { this.clip = null; return; }
    let k = env.findIndex((q, i) => i >= skip && q >= ENV_VOICE);   // skip: the part of the take never played
    if (k < 0) k = 0;
    this.clip = { id, env, onset: k * ENV_HOP_S, end: env.length * ENV_HOP_S, from, quiet: false, off: null, onsetAt: 0, fitAt: 0, fits: 0 };
  }

  end() { this.clip = null; }

  // where in the take a stretch of her live voice sits: the best shift of the current estimate
  scan(win, reach) {
    const c = this.clip;
    const qs = win.map((w) => w[1]);
    const mean = qs.reduce((a, b) => a + b, 0) / qs.length;
    const sd = Math.sqrt(qs.reduce((a, b) => a + (b - mean) ** 2, 0) / qs.length);
    if (sd < 12) return { r: -1, d: 0 };       // too flat (a held vowel or silence) to tell where we are
    let best = { r: -1, d: 0 };
    for (let d = -reach; d <= reach + 1e-9; d += ENV_HOP_S) {
      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      for (const [t, q] of win) {
        const i = Math.round((t - c.off - d) / ENV_HOP_S);
        const e = i >= 0 && i < c.env.length ? c.env[i] : 0;
        sx += q; sy += e; sxx += q * q; syy += e * e; sxy += q * e;
      }
      const n = win.length, cov = sxy - sx * sy / n, vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
      const r = vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : -1;
      if (r > best.r) best = { r, d };
    }
    return best;
  }

  // match her live voice against the take: the last 0.8 s first (catches a stall fast), else the last 2 s
  fit() {
    const c = this.clip;
    if (!c || c.off === null) return;
    const now = this.heard();
    if (now - c.fitAt < 0.15) return;
    c.fitAt = now;
    const recent = this.live.filter(([t]) => t >= c.onsetAt - 0.1 && t <= now);
    const reach = c.fits ? 0.3 : 0.6;
    const short = recent.filter(([t]) => t >= now - 0.8), long = recent.filter(([t]) => t >= now - 2.0);
    let best = short.length >= 30 ? this.scan(short, reach) : { r: -1, d: 0 };
    if (best.r < 0.75) best = long.length >= 30 ? this.scan(long, reach) : { r: -1, d: 0 };
    if (best.r < 0.55) return;
    c.off += Math.abs(best.d) <= 0.04 ? best.d / 2 : best.d;   // nudge small errors, jump to real stalls
    c.fits++;
    this.log.push({ id: c.id, at: +now.toFixed(2), d: +best.d.toFixed(2), r: +best.r.toFixed(2), off: +c.off.toFixed(3) });
    if (this.log.length > 200) this.log.shift();
  }

  // the video time that matches what she's saying right now, or null when we don't know yet
  target() {
    const c = this.clip;
    if (!c || c.off === null) return null;
    const take = this.heard() - c.off;
    return take <= c.end + 0.1 ? take + LIP_S : null;
  }
}

export class GigiAvatar {
  constructor(root, dir = 'gigi/') {
    this.root = root;
    this.dir = dir;
    this.manifest = null;
    this.clips = {};
    this.analyser = null;
    this.voiceSince = 0;
    this.quietSince = 0;
    this.armed = null;
    this.playing = null;
    this.lip = null;
    this.solo = false;
    this.current = null;     // solo: the layer on top
    this.z = 0;
    this.walk = null;        // solo: the walk-up in progress
    this.run = null;         // solo: the breath run in progress
  }

  // one fetch, shared: solo starts it on the start page so the room can open on the oasis at once
  fetchManifest() {
    if (this.manifest) return Promise.resolve(this.manifest);
    if (!this.manifestP) {
      this.manifestP = fetch(this.dir + 'clips/manifest.json', { cache: 'no-cache' })
        .then((res) => (res.ok ? res.json() : null)).catch(() => null)
        .then((m) => { this.manifest = m; if (!m) this.manifestP = null; return m; });   // a failed fetch is retried next time
    }
    return this.manifestP;
  }

  // a manifest image path (relative to gigi/, like every `video`), retried under gigi/clips/ if it isn't there
  setImg(img, path, v) {
    const q = v ? `?v=${v}` : '';
    img.onerror = () => { img.onerror = null; if (!path.startsWith('clips/')) img.src = `${this.dir}clips/${path}${q}`; };
    img.src = this.dir + path + q;
  }

  async load(opts = {}) {
    const r = this.root;
    this.solo = !!opts.solo;
    r.classList.add('gigi');
    r.innerHTML = '';
    const still = new Image();
    this.still = still;
    if (!this.solo || !this.soloStill()) still.src = this.dir + 'base.webp';
    still.alt = 'Gigi the giraffe';
    still.className = 'gigi-still';
    r.appendChild(still);
    // clips made before load (solo has the manifest from the start page, so an early attribute can preload one)
    // go back in the square: a cached video left detached would play where nobody can see it
    for (const v of Object.values(this.clips)) r.appendChild(v);
    await this.fetchManifest();
    if (!this.manifest) return;   // no renders yet: the still portrait stands in
    if (this.solo) {
      // the walk-up first (it's what they see first), idle parked on frame 0 for it to hand over to, no talk loop
      this.soloStill();
      this.video('walkup');
      this.idle = this.video('idle', true, false);
      this.preload(opts.preload);
    } else {
      this.idle = this.video('idle', true);
      this.talk = this.video('talk-loop', true);
      this.show(this.idle);
      this.preload(['greet', 'welcome-gratitude', 'howto-gratitude', 'welcome-breath', 'arrive-breath', 'nudge', 'lead-first', 'lead-next', 'lead-last']);
    }
    // a timer, not requestAnimationFrame: browsers slow rAF for covered or background windows, and
    // catching the instant her voice starts is what keeps the lip-sync tight
    if (!this.timer) this.timer = setInterval(() => this.frame(performance.now()), 30);
  }

  // solo: under the videos sits the walk-up's first frame (Gigi out in the water), never base.webp, which was
  // rendered on another plate and doesn't belong on this oasis
  soloStill() {
    const m = this.manifest, w = m && m.walkup;
    if (w && w.poster) { this.still.hidden = false; this.setImg(this.still, w.poster, w.v); return true; }
    if (m && m.stage) { this.still.hidden = true; return true; }
    return false;
  }

  video(id, loop = false, play = loop) {
    const m = this.manifest && this.manifest[id];
    if (!m || !m.video) return null;   // not a clip (e.g. `stage`) or not rendered
    if (this.clips[id]) return this.clips[id];
    const v = document.createElement('video');
    const blob = this.blobs && this.blobs[id];
    Object.assign(v, { src: blob || this.url(id), muted: true, playsInline: true, preload: 'auto', loop });
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.className = 'gigi-video';
    this.root.appendChild(v);
    if (play) v.play().catch(() => {});
    else v.load();
    this.clips[id] = v;
    return v;
  }

  // a line's clips: `<id>`, or its parts `<id>.1`, `<id>.2`... when it was cut as separate sentences
  parts(id) {
    if (!this.manifest) return [];
    if (this.manifest[id]) return [id];
    const out = [];
    for (let n = 1; this.manifest[`${id}.${n}`]; n++) out.push(`${id}.${n}`);
    return out;
  }

  url(id) { const m = this.manifest[id]; return this.dir + m.video + (m.v ? `?v=${m.v}` : ''); }

  // Groups: a video element per clip, loading. Solo: every clip the session can need is downloaded once,
  // one file at a time, in the order she'll say them, into memory (blob URLs). A line then has its first
  // frame the moment it's announced and seeks are instant, instead of a dozen videos fighting for the
  // connection and the decoder while her voice is already playing (that froze lines on frame 0 for seconds).
  preload(ids) {
    if (!this.solo) { for (const id of ids || []) for (const p of this.parts(id)) this.video(p); return; }
    this.blobs = this.blobs || {}; this.queue = this.queue || [];
    for (const id of ids || []) for (const p of this.parts(id)) {
      const m = this.manifest && this.manifest[p];
      if (m && m.video && !this.blobs[p] && !this.queue.includes(p)) this.queue.push(p);
    }
    this.pump();
  }

  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    while (this.queue.length) {
      const id = this.queue.shift();
      if (this.blobs[id]) continue;
      try {
        const r = await fetch(this.url(id));
        if (r.ok) this.blobs[id] = URL.createObjectURL(await r.blob());
      } catch { /* the network copy still works */ }
    }
    this.pumping = false;
  }

  // a line announced before its download: it goes first
  hurry(id) {
    if (!this.solo || !this.queue || (this.blobs && this.blobs[id])) return;
    this.queue = [id, ...this.queue.filter((x) => x !== id)];
    this.pump();
  }

  // solo: keep only the few clip elements in use (each holds a decoder; phones have few)
  release() {
    if (!this.solo) return;
    const keep = new Set([this.current, this.playing, this.idle, this.armed && this.clips[this.armed.id]]);
    const live = Object.entries(this.clips).filter(([, v]) => !keep.has(v) && v.paused && !v.loop);
    for (const [id, v] of live.slice(0, Math.max(0, live.length - 2))) {
      if (id === 'walkup' || (this.run && [this.run.cyc, this.run.bin, this.run.bout].includes(v))) continue;
      v.removeAttribute('src'); v.load(); v.remove(); delete this.clips[id];
    }
  }

  show(v) {
    if (!v) return;
    if (this.solo) return this.cut(v);
    for (const el of this.root.querySelectorAll('.gigi-video')) el.classList.toggle('on', el === v);
    if (v.loop && v.paused) v.play().catch(() => {});
  }

  // Solo: the new layer fades in on top while the old one stays opaque under it (both are on the same idle
  // frame), so the oasis never shows through her and there's never a second Gigi; then the rest settle.
  cut(v) {
    const was = this.current;
    this.current = v;
    if (v.loop && v.paused) v.play().catch(() => {});
    if (was === v) return;
    v.style.zIndex = String(++this.z);
    v.classList.add('on');
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.settle(), SETTLE_MS);
  }

  // every layer that isn't on screen goes off and pauses: idle parked on frame 0, an armed clip left at its start
  settle() {
    setTimeout(() => this.release(), 0);
    const top = this.current, armed = this.armed && this.clips[this.armed.id];
    if (top && top.readyState < 2) { this.settleTimer = setTimeout(() => this.settle(), 120); return; }   // no frame yet: keep what's under it
    for (const el of this.root.querySelectorAll('.gigi-video')) {
      if (el === top) continue;
      el.classList.remove('on');
      if (el === armed) continue;
      if (!el.paused) el.pause();
      if (el === this.idle && el.currentTime !== 0) { try { el.currentTime = 0; } catch { /* not ready */ } }
    }
  }

  // Gigi's audio track from LiveKit. The AudioContext must have been created on a user gesture.
  attach(mediaStreamTrack, audioCtx) {
    this.detach();
    const src = audioCtx.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
    const an = audioCtx.createAnalyser();
    an.fftSize = 512;
    an.smoothingTimeConstant = 0;
    src.connect(an);
    this.src = src;
    this.analyser = an;
    this.td = new Float32Array(an.fftSize);
    this.lip = new LipLock(audioCtx);
    this.lip.listen(src).catch(() => { this.lip = null; });   // no worklet: clips run on their start sync alone
  }

  detach() {
    try { this.src && this.src.disconnect(); } catch { /* already gone */ }
    if (this.lip) this.lip.stop();
    this.src = this.analyser = this.lip = null;
  }

  // The agent announced a clip ("<id>:<seq>"); play it when her voice starts.
  arm(value) {
    const id = String(value || '').split(':')[0];
    if (!this.manifest || !this.manifest[id]) return;
    this.hurry(id);
    this.video(id);
    this.armed = { id, at: performance.now(), quietSeen: false };
    if (this.lip) this.lip.begin(id, this.manifest[id].env, this.lip.heard() - 0.05, this.solo ? ONSET_FROM : 0);
  }

  setListening(level) {
    this.root.style.setProperty('--listen', Math.max(0, Math.min(1, level || 0)).toFixed(3));
  }

  rms() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.td);
    let s = 0;
    for (const v of this.td) s += v * v;
    return Math.sqrt(s / this.td.length);
  }

  startClip(id, offset) {
    const v = this.video(id);
    if (!v) return;
    if (this.solo) { this.endWalk(); this.run = null; }   // her voice wins: a line always gets the screen
    const lead = this.manifest[id].lead || 0;
    try { v.currentTime = Math.max(0, lead + offset); } catch { /* not seekable yet; starts at 0 */ }
    // back to idle at the end, unless a breath run has taken the square meanwhile (it shows breath-in next)
    v.onended = () => { if (this.playing === v) { this.playing = null; v.playbackRate = 1; if (this.lip && this.lip.clip && this.lip.clip.id === id) this.lip.end(); if (!this.run) this.show(this.idle); } };
    v.playbackRate = 1;
    v.play().catch(() => {});
    this.playing = v;
    this.playingId = id;
    this.show(v);
    clearTimeout(this.parkTimer);
    this.parkTimer = setTimeout(() => {
      const idle = this.idle;
      if (this.playing === v && idle && !idle.classList.contains('on')) { idle.pause(); try { idle.currentTime = 0; } catch { /* not ready */ } }
    }, PARK_AFTER_MS);
  }

  frame(t) {
    const voiced = this.rms() > VOICE_ON;
    if (voiced) { if (!this.voiceSince) this.voiceSince = t; this.quietSince = 0; }
    else { if (!this.quietSince) this.quietSince = t; this.voiceSince = 0; }
    this.root.style.setProperty('--speak', voiced ? '1' : '0');

    if (this.run) this.breathStep(t);                        // solo breath: the page's clock drives the square
    if (this.armed && this.solo) {
      // solo: start now, unless her previous line is still on its words (never cut a syllable off its lips);
      // once that line is in its morph back to idle, the new line's opening morph takes over
      const a = this.armed, p = this.playing, v = this.clips[a.id];
      if (v && v.readyState < 2) {                           // not decoded yet: stay on idle, never a frozen frame
        if (v.src.startsWith('http') && this.blobs && this.blobs[a.id]) { v.src = this.blobs[a.id]; v.load(); }
        if (p) this.follow(p);
        return;
      }
      if (!p || this.inTail(p)) {
        this.armed = null;
        const lead = this.manifest[a.id].lead || 0, target = this.lip && this.lip.clip && this.lip.clip.id === a.id ? this.lip.target() : null;
        // late (it had to load): start where her voice already is; otherwise from the opening morph
        const from = HEAD_START_S + (this.startBias || 0);
        this.startClip(a.id, target !== null && target > from ? target - lead : from - lead);
      } else this.follow(p);
      return;
    }
    if (this.armed) {
      const a = this.armed;
      if (!voiced) a.quietSeen = true;                       // her previous line's tail has ended
      if (a.quietSeen && voiced) { this.armed = null; this.startClip(a.id, LIP_S); }
      else if (t - a.at > ARM_TIMEOUT_MS) { this.armed = null; this.startClip(a.id, (t - a.at) / 1000 - 0.3); }
      return;
    }
    if (this.playing) { this.follow(this.playing); return; }  // a clip owns the screen until it ends
    if (this.solo) return;                                   // solo: idle between clips (a clip's end hands back), no talk loop
    if (this.voiceSince && t - this.voiceSince > TALK_AFTER_MS) this.show(this.talk);
    else if (this.quietSince && t - this.quietSince > IDLE_AFTER_MS) this.show(this.idle);
  }

  // a clip in its closing morph into idle frame 0 (her words are over)
  inTail(v) {
    const m = this.manifest && this.manifest[this.playingId];
    return !!v.duration && v.currentTime >= v.duration - ((m && m.tail) || 0.4) - 0.04;
  }

  // keep the playing clip on the moment of the take she's saying: small drifts by speed, big ones by a seek
  follow(v) {
    const lip = this.lip;
    if (!lip || !lip.clip || lip.clip.id !== this.playingId) return;
    lip.fit();
    const target = lip.target();
    if (target === null) { if (v.playbackRate !== 1) v.playbackRate = 1; return; }
    const drift = v.currentTime - target;
    if (this.solo && !lip.clip.firstDrift) {             // learn where clips land on her voice, start the next one there
      lip.clip.firstDrift = true;
      this.startBias = Math.max(0, Math.min(0.4, (this.startBias || 0) - 0.8 * drift));
    }
    if (Math.abs(drift) > 0.25) { try { v.currentTime = Math.max(0, target + 0.04); } catch { /* not seekable */ } v.playbackRate = 1; }
    else if (Math.abs(drift) > 0.025) v.playbackRate = Math.max(0.75, Math.min(1.3, 1 - drift * 2.5));
    else if (v.playbackRate !== 1) v.playbackRate = 1;
    lip.drift = drift;
  }

  // Solo: she walks up out of the water to her spot (silent, ~6 s) while the agent connects. Resolves once
  // she's handed over to idle frame 0, which is when the page tells the agent it's ready. No walk-up render,
  // or one that isn't playing within 4 s: straight to idle.
  walkup() {
    const m = this.manifest && this.manifest.walkup, v = this.solo ? this.video('walkup') : null;
    if (!v) { this.show(this.idle); return Promise.resolve(false); }
    this.endWalk();
    return new Promise((resolve) => {
      const w = this.walk = { v, resolve, timer: 0 };
      const cap = (ms) => { clearTimeout(w.timer); w.timer = setTimeout(() => this.endWalk(), ms); };
      if (m.poster) v.poster = this.still.src;   // the same first frame the still under it shows
      v.onplaying = () => cap(((v.duration || m.seconds || 6) - v.currentTime + 3) * 1000);   // let it finish; a stall gets 3 s
      v.onended = () => this.endWalk();
      cap(WALKUP_WAIT_MS);
      try { if (v.currentTime) v.currentTime = 0; } catch { /* not ready */ }
      v.playbackRate = 1;
      v.play().catch(() => {});   // muted + playsinline: allowed without a gesture
      this.show(v);
    });
  }

  endWalk() {
    const w = this.walk;
    if (!w) return;
    this.walk = null;
    clearTimeout(w.timer);
    w.v.onplaying = w.v.onended = null;
    if (!w.v.ended) w.v.pause();
    if (this.current === w.v && !this.playing && !this.run) this.show(this.idle);
    w.resolve(true);
  }

  // Solo breath, all in this square and on the page's clock (t0 = when the run arrived): breath-in (idle to the
  // exhaled pose), `rounds` x breath-<pattern> at rate 1, breath-out (back to idle frame 0), idle. False when
  // there's no breath-<pattern> render (the page falls back to the pacer).
  breathRun(b, t0 = performance.now()) {
    const cyc = this.solo && b ? this.video(`breath-${b.pattern}`) : null;
    if (!cyc) return false;
    this.endWalk();
    const bin = this.video('breath-in'), bout = this.video('breath-out');
    for (const v of [bin, cyc, bout]) if (v && v !== this.current) { v.pause(); try { if (v.currentTime) v.currentTime = 0; } catch { /* not ready */ } }
    cyc.loop = true;   // each cycle is exactly cycle_s: native looping is gapless, the boundary check corrects drift
    this.run = { b, t0, cyc, bin, bout, part: '', cycle: -1, lead: shape(b).lead };
    this.breathStep(performance.now());
    return true;
  }

  // the run was cut short (the phase moved on): back to idle
  stopBreath() {
    if (!this.run) return;
    this.run = null;
    if (!this.playing && !this.armed) this.show(this.idle);
  }

  breathStep(now) {
    const r = this.run, s = breathAt(r.b, now - r.t0);
    if (s.part === 'cycle') {
      if (r.part === 'cycle' && s.cycle === r.cycle) return;
      // a cycle boundary (or the first): on the clock at rate 1, seeking only for a real drift (wrapped, so a
      // loop that's a frame from wrapping counts as on time)
      const v = r.cyc, dur = v.duration || s.C, off = (((v.currentTime - s.at) % dur) + dur * 1.5) % dur - dur / 2;
      if (Math.abs(off) > RESYNC_S) { try { v.currentTime = s.at; } catch { /* not seekable yet */ } }
      v.playbackRate = 1;
      if (v.paused) v.play().catch(() => {});
      if (r.part !== 'cycle') { this.retire(); this.show(v); }   // the run owns the square: a line still running can't keep or retake it
      r.part = 'cycle';
      r.cycle = s.cycle;
      return;
    }
    if (s.part === r.part) return;
    if (s.part === 'done') {
      const o = r.bout;   // let breath-out land on idle frame 0 (a moment's grace past the clock)
      if (o && this.current === o && !o.ended && !o.paused && now - r.t0 < s.end * 1000 + 400) return;
      this.run = null;
      this.show(this.idle);
      return;
    }
    // her last line usually ends just after the run arrives: let its tail land on idle frame 0 (breath-in's first
    // frame) before breath-in shows, rather than cutting over the morph
    const p = this.playing;
    if (s.part === 'in' && p && !p.paused && !p.ended) return;
    if (s.part === 'out') r.cyc.pause();   // it has just wrapped to the exhaled pose (breath-out's first frame): hold it, never a fresh inhale
    const v = s.part === 'in' ? r.bin : r.bout;
    if (v) {
      if (s.part === 'in' && s.t > RESYNC_S) {   // late: from its start, a little quicker, still on the exhaled pose as the first cycle starts
        try { if (v.currentTime) v.currentTime = 0; } catch { /* not ready */ }
        v.playbackRate = Math.min(3, (v.duration || r.lead) / Math.max(0.2, r.lead - s.t));
      } else {
        if (Math.abs(v.currentTime - s.t) > RESYNC_S) { try { v.currentTime = s.t; } catch { /* not ready */ } }
        v.playbackRate = 1;
      }
      v.play().catch(() => {});
      this.show(v);
    }
    r.part = s.part;
  }

  // a line still running when the breath takes the square: no hand-back to idle when it ends, and no stale
  // `playing` to stop stopBreath/endWalk handing back later (settle pauses it once the cycle is up)
  retire() {
    const p = this.playing;
    if (!p) return;
    p.onended = null;
    p.playbackRate = 1;
    this.playing = null;
    if (this.lip && this.lip.clip && this.lip.clip.id === this.playingId) this.lip.end();
  }
}
