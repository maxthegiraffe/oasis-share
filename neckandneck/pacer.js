// The breath pacer in the center square: the Oasis breath journey (a palindrome clip from the daily
// practice's breath sleeves: the first half is the inhale, the second half the exhale), driven by the
// breath phases Gigi publishes, so every screen breathes on her clock. Same mapping as PracticeCard.jsx.

// Gigi's own breath (her chakras light on the inhale, dim on the exhale) when it's rendered; the Oasis journey until then.
export const OASIS_JOURNEY = 'https://cdn.jsdelivr.net/gh/maxthegiraffe/oasis-share@main/breath/journey-oasis.mp4';

export class Pacer {
  constructor(host, src = OASIS_JOURNEY) {
    this.host = host;
    this.v = document.createElement('video');
    Object.assign(this.v, { src, muted: true, playsInline: true, preload: 'auto', loop: false });
    this.v.setAttribute('playsinline', '');
    this.v.className = 'pacer-video';
    host.prepend(this.v);
    this.phase = null;
    this.prev = null;
    this.timer = setInterval(() => this.tick(), 100);
  }

  // Gigi's breath attribute: {kind, dur, into, seq, label, i, cycle, cycles}
  set(b) {
    if (!b || (this.phase && this.phase.seq === b.seq)) return;
    if (this.phase) this.prev = this.phase;
    this.phase = { ...b, at: performance.now() - (b.into || 0) * 1000 };
  }

  clear() { this.phase = null; this.prev = null; }

  // 0 = empty lungs, 1 = full: what the giraffe-print spots breathe with
  fullness() {
    const p = this.phase;
    if (!p) return null;
    const k = Math.min(1, (performance.now() - p.at) / (p.dur * 1000));
    if (p.kind === 'in') return k;
    if (p.kind === 'out') return 1 - k;
    return this.prev && this.prev.kind === 'in' ? 1 : 0;
  }

  remaining() {
    const p = this.phase;
    return p ? Math.max(1, Math.ceil(p.dur - (performance.now() - p.at) / 1000 - 0.3)) : 0;
  }

  tick() {
    const v = this.v, p = this.phase;
    if (!p || !v.duration) { if (p && v.paused) v.play().catch(() => {}); return; }
    const peak = v.duration / 2, total = v.duration;
    const k = Math.min(1, (performance.now() - p.at) / (p.dur * 1000));
    if (p.kind === 'hold') {
      const target = this.prev && this.prev.kind === 'in' ? peak : total - 0.05;
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - target) > 0.15) v.currentTime = target;
      return;
    }
    const target = p.kind === 'in' ? k * peak : peak + k * (total - peak);
    v.playbackRate = Math.max(0.07, Math.min(8, (p.kind === 'in' ? peak : total - peak) / p.dur));
    if (Math.abs(v.currentTime - target) > 0.35) v.currentTime = target;
    if (v.paused) v.play().catch(() => {});
  }

  destroy() { clearInterval(this.timer); this.v.remove(); }
}
