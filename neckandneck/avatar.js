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
const LIP_OFFSET_S = -0.06;  // Popcorn's mouths open ~0.17 s before the sound (video_review.py); a little of
                            // that lead is natural, so start each clip 60 ms before her voice onset
const PARK_AFTER_MS = 220;   // once a clip has faded in, park the hidden idle loop on its first frame: every
                            // clip ends with a short morph into exactly that frame, so idle resumes seamlessly

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

  preload(ids) { for (const id of ids || []) this.video(id); }

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
  }

  detach() {
    try { this.src && this.src.disconnect(); } catch { /* already gone */ }
    this.src = this.analyser = null;
  }

  // The agent announced a clip ("<id>:<seq>"); play it when her voice starts.
  arm(value) {
    const id = String(value || '').split(':')[0];
    if (!this.manifest || !this.manifest[id]) return;
    this.video(id);
    this.armed = { id, at: performance.now(), quietSeen: false };
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
    v.onended = () => { if (this.playing === v) { this.playing = null; this.show(this.idle); } };
    v.play().catch(() => {});
    this.playing = v;
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
      if (a.quietSeen && voiced) { this.armed = null; this.startClip(a.id, LIP_OFFSET_S); }
      else if (t - a.at > ARM_TIMEOUT_MS) { this.armed = null; this.startClip(a.id, (t - a.at) / 1000 - 0.3); }
      return;
    }
    if (this.playing) return;                                // a clip owns the screen until it ends
    if (this.voiceSince && t - this.voiceSince > TALK_AFTER_MS) this.show(this.talk);
    else if (this.quietSince && t - this.quietSince > IDLE_AFTER_MS) this.show(this.idle);
  }
}
