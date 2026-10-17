// Gigi on screen, as real rendered video. Three kinds of layers, all pinned to the same portrait so
// they crossfade cleanly:
//   idle  - a listening loop (breathing, blinks, ears), shown whenever she's quiet
//   talk  - a talking loop, shown while she speaks a live line (names, reflections)
//   clips - lip-synced renders of her fixed lines; the agent announces one, and it starts the
//           moment her voice begins (each clip opens with `lead` seconds of silence)

const VOICE_ON = 0.012;      // rms above this counts as Gigi speaking
const TALK_AFTER_MS = 80;    // sustained voice before switching to the talking loop
const IDLE_AFTER_MS = 380;   // sustained quiet before going back to idle
const ARM_TIMEOUT_MS = 1500; // start an announced clip anyway if we never catch her voice starting
const LIP_S = -0.08;         // video time = the moment of the take being heard + this. Popcorn's mouths open
                            // ~0.17 s before their sound (video_review.py); about half of that lead is natural
const ENV_HOP_S = 0.02;      // the clip envelopes in the manifest (production/envelopes.py): one byte per 20 ms,
const ENV_VOICE = 85;        // 0 = -60 dB, 255 = 0 dB; 85 = -40 dB counts as voice
const PARK_AFTER_MS = 220;   // once a clip has faded in, park the hidden idle loop on its first frame: every
                            // clip ends with a short morph into exactly that frame, so idle resumes seamlessly

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

  begin(id, envB64, from) {
    let env = null;
    try { env = Uint8Array.from(atob(envB64 || ''), (ch) => ch.charCodeAt(0)); } catch { env = null; }
    if (!env || !env.length) { this.clip = null; return; }
    let k = env.findIndex((q) => q >= ENV_VOICE);
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
  }

  async load() {
    const r = this.root;
    r.classList.add('gigi');
    r.innerHTML = '';
    const still = new Image();
    still.src = this.dir + 'base.webp';
    still.alt = 'Gigi the giraffe';
    still.className = 'gigi-still';
    r.appendChild(still);
    try {
      const res = await fetch(this.dir + 'clips/manifest.json', { cache: 'no-cache' });
      this.manifest = res.ok ? await res.json() : null;
    } catch { this.manifest = null; }
    if (!this.manifest) return;   // no renders yet: the still portrait stands in
    this.idle = this.video('idle', true);
    this.talk = this.video('talk-loop', true);
    this.show(this.idle);
    this.preload(['greet', 'welcome-gratitude', 'howto-gratitude', 'welcome-breath', 'arrive-breath', 'nudge', 'lead-first', 'lead-next', 'lead-last']);
    // a timer, not requestAnimationFrame: browsers slow rAF for covered or background windows, and
    // catching the instant her voice starts is what keeps the lip-sync tight
    if (!this.timer) this.timer = setInterval(() => this.frame(performance.now()), 30);
  }

  video(id, loop = false) {
    const m = this.manifest && this.manifest[id];
    if (!m) return null;
    if (this.clips[id]) return this.clips[id];
    const v = document.createElement('video');
    Object.assign(v, { src: this.dir + m.video + (m.v ? `?v=${m.v}` : ''), muted: true, playsInline: true, preload: 'auto', loop });
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.className = 'gigi-video';
    this.root.appendChild(v);
    if (loop) v.play().catch(() => {});
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

  preload(ids) { for (const id of ids || []) for (const p of this.parts(id)) this.video(p); }

  show(v) {
    if (!v) return;
    for (const el of this.root.querySelectorAll('.gigi-video')) el.classList.toggle('on', el === v);
    if (v.loop && v.paused) v.play().catch(() => {});
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
    this.video(id);
    this.armed = { id, at: performance.now(), quietSeen: false };
    if (this.lip) this.lip.begin(id, this.manifest[id].env, this.lip.heard() - 0.05);
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
    const lead = this.manifest[id].lead || 0;
    try { v.currentTime = Math.max(0, lead + offset); } catch { /* not seekable yet; starts at 0 */ }
    v.onended = () => { if (this.playing === v) { this.playing = null; v.playbackRate = 1; if (this.lip && this.lip.clip && this.lip.clip.id === id) this.lip.end(); this.show(this.idle); } };
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

    if (this.armed) {
      const a = this.armed;
      if (!voiced) a.quietSeen = true;                       // her previous line's tail has ended
      if (a.quietSeen && voiced) { this.armed = null; this.startClip(a.id, LIP_S); }
      else if (t - a.at > ARM_TIMEOUT_MS) { this.armed = null; this.startClip(a.id, (t - a.at) / 1000 - 0.3); }
      return;
    }
    if (this.playing) { this.follow(this.playing); return; }  // a clip owns the screen until it ends
    if (this.voiceSince && t - this.voiceSince > TALK_AFTER_MS) this.show(this.talk);
    else if (this.quietSince && t - this.quietSince > IDLE_AFTER_MS) this.show(this.idle);
  }

  // keep the playing clip on the moment of the take she's saying: small drifts by speed, big ones by a seek
  follow(v) {
    const lip = this.lip;
    if (!lip || !lip.clip || lip.clip.id !== this.playingId) return;
    lip.fit();
    const target = lip.target();
    if (target === null) { if (v.playbackRate !== 1) v.playbackRate = 1; return; }
    const drift = v.currentTime - target;
    if (Math.abs(drift) > 0.25) { try { v.currentTime = Math.max(0, target + 0.04); } catch { /* not seekable */ } v.playbackRate = 1; }
    else if (Math.abs(drift) > 0.04) v.playbackRate = Math.max(0.75, Math.min(1.3, 1 - drift * 2.5));
    else if (v.playbackRate !== 1) v.playbackRate = 1;
    lip.drift = drift;
  }
}
