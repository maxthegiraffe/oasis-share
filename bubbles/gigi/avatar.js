// Gigi's mouth on the call: the lip lock and the portrait wrapper from Neck and Neck's avatar.js (PortraitAvatar and
// what it needs, copied as it runs there today; the video Gigi and the solo breath parts are left out).
// Bubbles only adds a way to start a line without the agent's "clip" announcement (see src/lib/gigi-face.ts).
const VOICE_ON = 0.012;      // rms above this counts as Gigi speaking
const TALK_AFTER_MS = 80;    // sustained voice before switching to the talking loop
const IDLE_AFTER_MS = 380;   // sustained quiet before going back to idle
const ARM_TIMEOUT_MS = 1500; // start an announced clip anyway if we never catch her voice starting
const HEAD_START_S = 0.02;   // solo: an announced clip starts at once from (nearly) its first frame. Every clip
                            // opens with a short morph out of idle frame 0 (production/heads.py) and her voice
                            // reaches the page ~0.2 s after the announcement, so this lands on her first word;
                            // the lip lock then holds the video on the words
export const LIP_S = -0.08;  // video time = the moment of the take being heard + this. Popcorn's mouths open
                            // ~0.17 s before their sound (video_review.py); about half of that lead is natural.
                            // The lab's live mouth (popmouth.js lead_s) is given the same offset
export const ENV_HOP_S = 0.02;   // the clip envelopes in the manifest (production/envelopes.py): one byte per 20 ms,
export const ENV_VOICE = 85;     // 0 = -60 dB, 255 = 0 dB; 85 = -40 dB counts as voice
const PARK_AFTER_MS = 220;   // once a clip has faded in, park the hidden idle loop on its first frame: every
                            // clip ends with a short morph into exactly that frame, so idle resumes seamlessly
export const ONSET_FROM = 13;   // solo: the agent drops each WAV's first 0.25 s, so the first sound heard is the take's
                            // first voice from envelope index 13 (0.26 s) on, not a breath or click before it
const WALKUP_WAIT_MS = 4000; // solo: a walk-up that isn't playing by then is skipped (straight to idle, and ready)
const RESYNC_S = 0.08;       // solo breath: at a cycle boundary, seek only if the video drifted more than this
const SETTLE_MS = 220;       // solo: once a layer has faded in, the ones under it go off and pause
// lab (?lab=video, popmouth.js): her live lines, on Popcorn's own pixels with a live mouth
const LIVE_PENDING_MS = 4000;   // a live line announced before its lips packet waits this long for it (as gigi3d.js)
const LIVE_KEEP = 8;            // live lines' packets kept (the one playing and a few before it)
const LIVE_TAKE_AT_ARM = 0.05;  // the take time heard as a live line is announced (the agent announces 0.2 s before
                                // the take, which plays from 0.25 s): the mouth's clock until her voice is heard
const LIVE_END_S = 0.15;        // a live line is let go this long after its take ends (popmouth.js SELECT.end_s)
// lab (?lab=1, PortraitAvatar): every line's take time, recorded or live. The agent announces each solo line
// SOLO_ANNOUNCE_S = 0.2 s before its take plays, from 0.25 s (it drops 0.25 s of the 0.35 s lead), so the take time
// heard at the announcement is LIVE_TAKE_AT_ARM (+ a bias learned from her voice: the network's share)
const ARM_CLOCK_MS = 150;       // a line the lip lock hasn't timed this long after its announcement runs on that clock
const ARM_BIAS = [-0.15, 0.35]; // the learned bias's range (s)
const HANDOVER_S = 0.25;        // a change of clock (the announcement's -> the lip lock's) is eased out over this, or
                                // 2x the step if that's longer (her mouth slows or hurries a little, never jumps back)
const REFIT_S = 0.04;           // a lip-lock re-fit bigger than this (a stall) is eased out the same way



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
// (Exported, with the constants above, for the lab's 3D Gigi: gigi3d.js.)
export class LipLock {
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
    if (this.stopped) return;   // detached while the worklet loaded: no node left running for a lock nobody reads
    const node = new AudioWorkletNode(ctx, 'nn-env');
    const sink = ctx.createGain();
    sink.gain.value = 0;                       // pulled by the graph, never heard
    src.connect(node); node.connect(sink); sink.connect(ctx.destination);
    node.port.onmessage = (e) => this.push(e.data[0], toByte(e.data[1]));
    this.node = node; this.sink = sink;
  }

  stop() {
    this.stopped = true;
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

// lab: a line armed after her voice may have started (its lips packet came after its announcement) finds its onset
// in the voice already heard since the announcement, by the same rule LipLock.push uses as it goes (gigi3d.js's Lips;
// GigiAvatar's live mouth and PortraitAvatar use this one)
function catchUp(lip, from) {
  const c = lip.clip;
  for (const [t, q] of c ? lip.live : []) {
    if (c.off !== null) break;
    if (t < from) continue;
    if (q < ENV_VOICE - 25) c.quiet = true;
    else if (c.quiet && q >= ENV_VOICE) { c.off = t - c.onset; c.onsetAt = t; }
  }
}

// ---------------------------------------------------------------- lab: the live 2D portrait (?lab=1, portrait.js)
// The solo Gigi drawn live by portrait.js (GigiPortrait) instead of played as video. One canvas fills the stage with
// framing 'full': the oasis and her square land exactly where the page's layoutStage puts the stage image and the video
// square. The page drives this as it drives GigiAvatar in solo. Every line moves her mouth: a recorded line speaks its
// manifest env + vis, a live line its gigi.lips packet. Both are read at the take time being heard, which the lip lock
// finds as it does for the video path's clips. Her breath runs light her chakras (the pacer and breath videos stay
// off), and she listens while they share. Only app.js constructs this, and only on ?lab=1 pages.
export class PortraitAvatar {
  // root: the box the canvas fills (app.js: the solo stage, the same box as #room). opts: {Portrait: the GigiPortrait
  // class (app.js imports portrait.js, the import publish.py stamps), manifest: () => the page's manifest promise,
  // onfail(reason): after load she can't be drawn any more (the page brings the video Gigi back), portrait: extra
  // GigiPortrait options}
  constructor(root, dir = 'gigi/', opts = {}) {
    this.root = root;
    this.dir = dir;
    this.opts = opts || {};
    this.manifest = null;
    this.solo = true;
    this.livePortrait = true;
    this.idle = this.playing = null;   // no videos: nothing for the page to show, pause or wait for
    this.lip = null;
    this.analyser = null;
    this.portrait = null;      // the GigiPortrait (from the console: gigi.portrait.stats)
    this.up = false;           // loaded with a mouth library, and not failed since
    this.gone = false;         // disposed
    this.packets = new Map();  // live lines' gigi.lips packets, by id
    this.pending = null;       // a live line announced before its packet: {id, from, at}
    this.cur = null;           // the line on her lips (begin)
    this.armBias = 0;          // learned, added to LIVE_TAKE_AT_ARM (s): below 0 when her voice reaches the page later than that says
    this.takeSrc = '';         // the clock the last take time came from: 'lock', 'loud', 'arm' (QA: gigi.takeSrc)
  }

  // her mouth can follow a live line: the page reports lips only while this holds
  get liveMouth() { const G = this.portrait; return this.up && !this.gone && !!G && !!G.hasMouth && !G.failed; }

  fetchManifest() {
    if (this.manifest) return Promise.resolve(this.manifest);
    if (!this.manifestP) {
      const get = this.opts.manifest || (() => fetch(this.dir + 'clips/manifest.json', { cache: 'no-cache' })
        .then((res) => (res.ok ? res.json() : null)).catch(() => null));
      this.manifestP = Promise.resolve().then(get).then((m) => { this.manifest = m || null; if (!m) this.manifestP = null; return m; });
    }
    return this.manifestP;
  }

  setImg(img, path, v) {
    const q = v ? `?v=${v}` : '';
    img.onerror = () => { img.onerror = null; if (!path.startsWith('clips/')) img.src = `${this.dir}clips/${path}${q}`; };
    img.src = this.dir + path + q;
  }

  // her rig and images, the mouth library and the manifest, off screen: true when she can go on. Needs WebGL2 and a mouth
  // library: without one her lips would never move, so that counts as a failure too. Started on the start page; the
  // page gives up on her LAB_WAIT_MS after the room opens. timeout: portrait.js's own load limit (ms; default 6 s)
  prepare(timeout) {
    if (!this.prepP) {
      this.prepP = this.build(timeout).then(() => true)
        .catch((e) => { console.warn('portrait: the video Gigi runs instead:', (e && e.message) || e); this.dispose(); return false; });
    }
    return this.prepP;
  }

  async build(timeout) {
    const P = this.opts.Portrait;
    if (!P || typeof P.supported !== 'function' || !P.supported()) throw new Error('no WebGL2');
    // (select: popmouth's lead_s = the clips' LIP_S, as GigiAvatar gives its live mouth: lines sit on her voice as clips do)
    const G = this.portrait = new P({ ...(this.opts.portrait || {}), select: { lead_s: LIP_S }, onfail: (why) => this.fail(why) });
    const [ok] = await Promise.all([G.load(this.dir + 'portrait/', { timeout }), this.fetchManifest()]);
    if (this.gone) throw new Error('let go');
    if (!ok || G.failed) throw new Error(G.error || 'load failed');   // (failed: lost while the manifest came)
    if (!G.hasMouth) throw new Error('no mouth library (gigi/mouth/): her lips could not move');
    if (!this.manifest) throw new Error('no manifest: her recorded lines would have no lips');
    this.up = true;
  }

  // portrait.js's onfail, after load (a lost WebGL context, a failed draw): it has hidden her canvas already. The page
  // is told once
  fail(why) {
    if (!this.up) return;
    this.up = false;
    if (typeof this.opts.onfail === 'function') { try { this.opts.onfail(String(why || 'failed')); } catch (e) { console.warn('portrait: onfail', e); } }
  }

  // the room: her canvas over the stage image and under the words, drawing from now on
  async load() {
    await this.fetchManifest();
    const G = this.portrait;
    if (!G || this.gone) return;
    G.attach(this.root, { framing: 'full' });
    if (G.canvas && G.canvas.style) G.canvas.style.zIndex = '1';   // style.css .room.solo: the oasis is z 0, the words z 4
  }

  // no videos to walk up, download or hurry: she's there from the first frame and every line is ready
  walkup() { return Promise.resolve(false); }
  loaded() { return Promise.resolve(); }
  hurry() {}
  show() {}
  preload() {}

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
    const lip = this.lip = new LipLock(audioCtx);
    // no worklet (none in this browser, or it failed): no lock, and her loudness starts each line's clock
    const none = () => { if (this.lip === lip && !lip.node) this.lip = null; };
    lip.listen(src).then(none, none);
    if (this.cur) this.relock(this.cur);   // a line announced before her audio came (often the room's first)
  }

  detach() {
    try { this.src && this.src.disconnect(); } catch { /* already gone */ }
    if (this.lip) this.lip.stop();
    this.src = this.analyser = this.lip = null;
  }

  rms() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.td);
    let s = 0;
    for (const v of this.td) s += v * v;
    return Math.sqrt(s / this.td.length);
  }

  // The agent announced a line ("<id>:<seq>"). A recorded line speaks its manifest lips; a live line speaks its packet's.
  // A live line announced before its packet waits LIVE_PENDING_MS for it. Anything else is ignored, as the video Gigi does
  arm(value) {
    const id = String(value || '').split(':')[0];
    if (!id) return;
    const live = id.startsWith('live-'), from = this.lip ? this.lip.heard() - 0.05 : 0;
    const line = live ? this.packets.get(id) : this.recorded(id);
    if (!line) { if (live) this.pending = { id, from, at: performance.now() }; return; }
    this.pending = null;   // (a packet for a line still waiting now is stale)
    this.begin(line, from, performance.now());
  }

  // a recorded line's lips: the manifest's env (and vis, production/visemes.py); null without an env
  recorded(id) {
    const m = this.manifest && this.manifest[id];
    return m && typeof m.env === 'string' && m.env ? { id, env: m.env, vis: typeof m.vis === 'string' ? m.vis : undefined } : null;
  }

  // the page hands over a gigi.lips packet: {id: "live-<n>", env, vis, dur}
  liveLine(p) {
    if (!p || typeof p.id !== 'string' || !p.id.startsWith('live-') || typeof p.env !== 'string' || !p.env) return;
    const line = { id: p.id, env: p.env, vis: typeof p.vis === 'string' ? p.vis : undefined, dur: Number(p.dur) > 0 ? Number(p.dur) : undefined };
    this.packets.delete(p.id);
    this.packets.set(p.id, line);
    while (this.packets.size > LIVE_KEEP) this.packets.delete(this.packets.keys().next().value);
    const w = this.pending;
    if (w && w.id === p.id) {   // announced first: on her lips now, its onset searched from the announcement on
      this.pending = null;
      if (performance.now() - w.at <= LIVE_PENDING_MS) this.begin(line, w.from, w.at);
    }
  }

  // from: the heard time the line's onset is searched from; at: when it was announced (performance.now() ms)
  begin(line, from, at) {
    const G = this.portrait;
    if (!G || !this.up) return;
    let env = null;
    try { env = Uint8Array.from(atob(line.env), (ch) => ch.charCodeAt(0)); } catch { env = null; }
    let k = env ? env.findIndex((q, i) => i >= ONSET_FROM && q >= ENV_VOICE) : -1;
    if (k < 0) k = ONSET_FROM;
    // armTake: the take heard at the announcement (its clock's start). late: her audio came after it (see relock).
    // src / lastAt / lastShown / off: what takeTime showed last, and from which clock; c0 / cAt / cS: a step being eased
    const L = this.cur = { id: line.id, env: line.env, at, armTake: LIVE_TAKE_AT_ARM + this.armBias, onsetTake: k * ENV_HOP_S,
      onsetAt: 0, quiet: false, late: false, learned: false, src: '', lastAt: 0, lastShown: 0, off: null, c0: 0, cAt: 0, cS: HANDOVER_S };
    if (this.lip) { this.lip.begin(line.id, line.env, from, ONSET_FROM); catchUp(this.lip, from); }   // the agent drops each take's first 0.25 s
    G.speak({ id: line.id, env: line.env, vis: line.vis, dur: line.dur }, () => this.takeTime(L));
  }

  // The take time being heard (s), or null until it is known; portrait.js calls this every frame it draws the line. Three
  // clocks, best first:
  //   lock: the lip lock (her live voice matched against the line's env, as the video path holds its clips on their words)
  //   loud: no AudioWorklet: a clock from her first sound
  //   announcement: once ARM_CLOCK_MS has passed without either (her audio isn't hooked up yet: the first line of a room
  //     is often announced before her track arrives), LIVE_TAKE_AT_ARM + the learned bias at the announcement
  // A change of clock, or a lock re-fit across a stall, is eased out (HANDOVER_S): her mouth never jumps
  takeTime(L) {
    if (this.cur !== L) return null;
    const now = performance.now(), lip = this.lip, c = lip && lip.clip;
    let raw = null, src = '', off = null;
    if (c && c.id === L.id && c.off !== null) { lip.fit(); off = c.off; raw = lip.heard() - off; src = 'lock'; }
    else if (!lip && this.analyser && !L.late) {   // the worklet failed: her loudness starts the clock at her first sound
      if (!L.onsetAt) { if (this.rms() <= VOICE_ON) L.quiet = true; else if (L.quiet) L.onsetAt = now; }
      if (L.onsetAt) { raw = L.onsetTake + (now - L.onsetAt) / 1000; src = 'loud'; }
    }
    if (raw === null && now - L.at >= ARM_CLOCK_MS) { raw = this.armClock(L, now); src = 'arm'; }
    if (raw === null) return null;
    if (src !== 'arm' && !L.learned) {   // her voice timed this line: how far the announcement clock was off teaches the next
      L.learned = true;
      const err = raw - this.armClock(L, now);
      if (!L.late && Math.abs(err) <= 0.4) this.armBias = Math.max(ARM_BIAS[0], Math.min(ARM_BIAS[1], this.armBias + 0.7 * err));
    }
    if (L.lastAt && src !== L.src) this.step(L, now, L.lastShown + (now - L.lastAt) / 1000 - raw);   // from where she is
    else if (src === 'lock' && L.off !== null && Math.abs(off - L.off) > REFIT_S) this.step(L, now, this.corr(L, now) + off - L.off);
    const shown = raw + this.corr(L, now);
    Object.assign(L, { src, off, lastAt: now, lastShown: shown });
    this.takeSrc = src;
    return shown;
  }

  armClock(L, now) { return L.armTake + (now - L.at) / 1000; }

  // a step of c0 s between what she shows and the clock she now runs on, eased out from now
  step(L, now, c0) { Object.assign(L, { c0, cAt: now, cS: Math.max(HANDOVER_S, 2 * Math.abs(c0)) }); }

  corr(L, now) {
    if (!L.c0) return 0;
    const k = (now - L.cAt) / (1000 * L.cS);
    if (k >= 1) { L.c0 = 0; return 0; }
    const s = Math.max(0, k);
    return L.c0 * (1 - s * s * (3 - 2 * s));
  }

  // Her audio came while a line is on her lips (attach after its announcement). The new lock can't see that line's onset,
  // and an onset rule started mid-voice could latch at a pause. So it starts from the take she shows now (or the
  // announcement's clock), and its fit, matching her voice against the take, corrects that as her voice comes in
  relock(L) {
    const lip = this.lip, now = performance.now();
    L.late = true;   // (her loudness can't time this line now, and it teaches the announcement clock nothing)
    lip.begin(L.id, L.env, lip.heard() - 0.05, ONSET_FROM);
    const c = lip.clip;
    if (!c) return;
    c.off = lip.heard() - (L.lastAt ? L.lastShown + (now - L.lastAt) / 1000 : this.armClock(L, now));
    c.onsetAt = lip.heard();   // (the fit reads her voice from here on)
  }

  // Solo breath on the page's clock (t0 = when the run arrived): her lungs follow the run and her chakras climb root to
  // crown. True: the page needs no pacer and no breath videos
  breathRun(b, t0 = performance.now()) { return !!(this.portrait && b && this.portrait.breathRun(b, t0)); }
  stopBreath() { if (this.portrait) this.portrait.stopBreath(); }
  listen(on) { if (this.portrait) this.portrait.listen(!!on); }

  // the end screen covers the stage: she stops drawing and lets the GPU and her audio go
  end() { this.dispose(); }

  dispose() {
    this.gone = true;
    this.up = false;
    this.detach();
    this.pending = this.cur = null;
    this.packets.clear();
    if (this.portrait) { try { this.portrait.dispose(); } catch (e) { console.warn('portrait: dispose', e); } }
  }
}

