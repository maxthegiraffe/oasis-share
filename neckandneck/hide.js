// The giraffe-print hide behind each tile: the Giraffe Pulse "Herd" motif (the Oasis's
// src/components/motif/GiraffeHide.jsx), ported without React. Each person keeps their own pattern
// (seeded from their identity). Spots breathe with the room's breath, and a ripple of light runs
// through them when someone sends a giraffe or starts sharing.

const SKIN = { st: [[251, 146, 60], [244, 114, 182], [167, 139, 250]], bg: '#150d22' };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;

export function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedOf(str) {
  let h = 2166136261;
  for (const ch of String(str || '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 100000;
}

function gradAt(t) {
  const S = SKIN.st, P = [[0, S[0]], [0.5, S[1]], [1, S[2]]];
  t = clamp(t, 0, 1);
  for (let i = 1; i < P.length; i++) {
    if (t <= P[i][0]) { const a = P[i - 1], b = P[i], k = (t - a[0]) / (b[0] - a[0]); return [0, 1, 2].map((j) => Math.round(lerp(a[1][j], b[1][j], k))); }
  }
  return S[2].slice();
}

// Giraffe spots: a jittered hex grid of seeds, each clipped to its Voronoi cell and inset by `gap`.
export function voronoi(W, H, sp, seed, gap, pad) {
  const R = rng(seed), pts = [], rowH = sp * 0.866, x0 = -pad, y0 = -pad, x1 = W + pad, y1 = H + pad;
  for (let y = y0, r = 0; y <= y1; y += rowH, r++) for (let x = x0 + (r % 2 ? sp / 2 : 0); x <= x1; x += sp) pts.push([x + (R() - 0.5) * sp * 0.6, y + (R() - 0.5) * sp * 0.6]);
  const cells = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], S = sp * 1.7;
    let poly = [[p[0] - S, p[1] - S], [p[0] + S, p[1] - S], [p[0] + S, p[1] + S], [p[0] - S, p[1] + S]];
    for (let c = 0; c < pts.length && poly.length > 2; c++) {
      if (c === i) continue;
      const Q = pts[c];
      let ux = Q[0] - p[0], uy = Q[1] - p[1];
      const L = Math.hypot(ux, uy);
      if (L > sp * 2.5 || L < 1e-6) continue;
      ux /= L; uy /= L;
      const mx = (p[0] + Q[0]) / 2, my = (p[1] + Q[1]) / 2, out = [];
      for (let k = 0; k < poly.length; k++) {
        const cur = poly[k], prev = poly[(k + poly.length - 1) % poly.length];
        const fc = (cur[0] - mx) * ux + (cur[1] - my) * uy + gap / 2, fp = (prev[0] - mx) * ux + (prev[1] - my) * uy + gap / 2;
        if (fc <= 0) { if (fp > 0) { const t = fp / (fp - fc); out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]); } out.push(cur); }
        else if (fp <= 0) { const t = fp / (fp - fc); out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]); }
      }
      poly = out;
    }
    if (poly.length < 3) continue;
    let cx = 0, cy = 0, area = 0;
    for (let v = 0; v < poly.length; v++) { const A = poly[v], B = poly[(v + 1) % poly.length], cr = A[0] * B[1] - B[0] * A[1]; area += cr; cx += (A[0] + B[0]) * cr; cy += (A[1] + B[1]) * cr; }
    area /= 2;
    if (Math.abs(area) < sp * sp * 0.04) continue;
    cells.push({ x: cx / (6 * area), y: cy / (6 * area), poly, r: Math.sqrt(Math.abs(area) / Math.PI) });
  }
  return cells;
}

function roundPath(poly, r) {
  const n = poly.length, path = new Path2D();
  for (let i = 0; i < n; i++) {
    const v = poly[i], p = poly[(i + n - 1) % n], q = poly[(i + 1) % n];
    const lp = Math.hypot(p[0] - v[0], p[1] - v[1]) || 1, lq = Math.hypot(q[0] - v[0], q[1] - v[1]) || 1;
    const kp = Math.min(0.48, r / lp), kq = Math.min(0.48, r / lq);
    const a = [v[0] + (p[0] - v[0]) * kp, v[1] + (p[1] - v[1]) * kp], b = [v[0] + (q[0] - v[0]) * kq, v[1] + (q[1] - v[1]) * kq];
    if (i === 0) path.moveTo(a[0], a[1]); else path.lineTo(a[0], a[1]);
    path.quadraticCurveTo(v[0], v[1], b[0], b[1]);
  }
  path.closePath();
  return path;
}

// One hide per tile. `breath()` returns 0..1 (0 = empty, 1 = full lungs) or null for an idle drift.
export class Hide {
  constructor(host, seed, breath) {
    this.host = host;
    this.seed = seed;
    this.breath = breath || (() => null);
    this.rip = [];
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hide';
    host.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.layout();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(host);
  }

  layout() {
    const W = this.host.clientWidth, H = this.host.clientHeight;
    if (W < 10 || H < 10) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    Object.assign(this, { W, H, dpr });
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    const sp = clamp(W / 4.2, 18, 46);
    this.cells = voronoi(W, H, sp, this.seed, Math.max(2.5, sp * 0.13), sp).map((c) => {
      const [r, g, b] = gradAt((c.x / W) * 0.6 + (c.y / H) * 0.4);
      return { ...c, path: roundPath(c.poly, sp * 0.22), rgb: `${r},${g},${b}`, ph: (c.x * 0.013 + c.y * 0.017) % (Math.PI * 2) };
    });
  }

  ripple(amp = 1) {
    if (this.rip.length > 6) this.rip.shift();
    this.rip.push({ t0: performance.now() / 1000, amp });
  }

  draw(now) {
    if (!this.cells) return;
    const { ctx, W, H, dpr } = this, t = now / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SKIN.bg;
    ctx.fillRect(0, 0, W, H);
    const b = this.breath();
    const cx = W / 2, cy = H / 2, maxD = Math.hypot(cx, cy);
    this.rip = this.rip.filter((r) => t - r.t0 < 2.4);
    for (const c of this.cells) {
      const swell = b == null ? 0.94 + 0.04 * Math.sin(t * 0.9 + c.ph) : 0.86 + 0.16 * b;
      let lit = 0;
      const d = Math.hypot(c.x - cx, c.y - cy) / maxD;
      for (const r of this.rip) {
        const front = (t - r.t0) / 1.6;
        lit += r.amp * Math.max(0, 1 - Math.abs(d - front) / 0.18) * Math.max(0, 1 - (t - r.t0) / 2.4);
      }
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(swell, swell);
      ctx.translate(-c.x, -c.y);
      ctx.fillStyle = `rgba(${c.rgb},${clamp(0.55 + 0.45 * lit + (b ?? 0.3) * 0.25, 0, 1)})`;
      if (lit > 0.05) { ctx.shadowColor = `rgba(${c.rgb},0.9)`; ctx.shadowBlur = 14 * lit; }
      ctx.fill(c.path);
      ctx.restore();
    }
  }

  destroy() {
    this.ro.disconnect();
    this.canvas.remove();
  }
}
