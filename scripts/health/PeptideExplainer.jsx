// Copied from the oasis repo (src/components/health/PeptideExplainer.jsx, main on 2026-11-13) for grateful.gg/health.
// One change: PeptideExplainer takes children, shown under the name.
import React, { useEffect, useRef, useState } from 'react';

// One short animated explainer per peptide, in its card (Max, 2026-11-01, after the first try: "an animation that
// conveys the message in 10-15 seconds", "able to click through", and not losing your place when the pointer moves; no
// voice). Each is three steps, about four seconds each, looping while the card is in view: the drawing shows the step
// and its caption says it in a few words. The step dots jump to a step (and pause); the button pauses and plays. Under
// it, tabs for Benefits, Risks, Dose and frequency, Stacking, to read at your own pace. The same player shows how Mount
// Hydra makes its exosome product (four steps). Words: healthCopy `learn` (x_<peptide>_s1..s3, x_<peptide>_<tab>,
// exo_m_*), editable through Gigi. Educational: no dose numbers anywhere.

export const C = {
  ink: '#1D1A3A', membrane: '#2340FF', nucleus: '#1A30D9', organelle: '#6F84FF', fill: '#CFE0FF', spot: '#FFB0D9',
  cyto: '#FFCEC6', paper: '#FFDED8', sun: '#FF48B0', sunEdge: '#D42F8E', white: '#FFFFFF',
};
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const ease = (x) => { const u = clamp(x); return u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2; };
export const lerp = (a, b, u) => a + (b - a) * u;
const span = (t, s, e) => clamp((t - s) / Math.max(0.01, e - s));

// the kit's small parts, drawn the way the page's peptides are
export const Cell = ({ x, y, r = 12, o = 1 }) => (
  <g opacity={o} transform={`translate(${x} ${y})`}>
    <circle r={r} fill={C.membrane} />
    <circle r={r * 0.78} fill={C.cyto} />
    <circle r={r * 0.34} cx={r * 0.1} cy={-r * 0.1} fill={C.fill} stroke={C.membrane} strokeWidth="1" />
  </g>
);
const Chain = ({ pts, r = 4.5, hi = -1 }) => (
  <g>
    <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={C.sun} strokeOpacity=".32" strokeWidth={r * 3.4} strokeLinecap="round" strokeLinejoin="round" />
    {pts.slice(1).map(([x, y], i) => <line key={`l${i}`} x1={pts[i][0]} y1={pts[i][1]} x2={x} y2={y} stroke={C.membrane} strokeWidth="2.2" strokeLinecap="round" />)}
    {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={r} fill={i === hi ? C.sun : C.white} stroke={i === hi ? C.sunEdge : C.membrane} strokeWidth="1.8" />)}
  </g>
);
const wave = (x, y, n, gap = 8, amp = 3, phase = 0) => Array.from({ length: n }, (_, i) => [x + i * gap, y + Math.sin(i * 0.9 + phase) * amp]);
const Tag = ({ x, y, children }) => <text x={x} y={y} textAnchor="middle" fontSize="8.5" fontWeight="800" letterSpacing=".06em" fill={C.membrane} fontFamily="'DM Mono', ui-monospace, monospace">{String(children).toUpperCase()}</text>;
const Grow = ({ d, u, w = 2.4, color = C.membrane }) => (
  <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - clamp(u)} />
);

// The spotlight: what a step is about stays lit and the rest dims, easing over from the step before. `lit(s, u, n)` gives
// L(...parts), the light for parts lit in any of those steps.
const DIM = 0.36;
const lit = (s, u, n = 3) => (...parts) => {
  const prev = (s + n - 1) % n, k = ease(clamp(u * 2.2));
  return lerp(parts.includes(prev) ? 1 : DIM, parts.includes(s) ? 1 : DIM, k);
};
// a warm glow that glides to the step's subject, and a ring that pulses once when the step lands
export function Spot({ pts, s, u, t }) {
  const n = pts.length, k = ease(clamp(u * 2.2)), [px, py] = pts[(s + n - 1) % n], [qx, qy] = pts[s];
  const x = lerp(px, qx, k), y = lerp(py, qy, k), r = 34 + Math.sin(t * 2) * 2;
  return (
    <g>
      <circle cx={x} cy={y} r={r * 1.55} fill={C.sun} opacity=".09" />
      <circle cx={x} cy={y} r={r} fill={C.sun} opacity=".15" />
    </g>
  );
}
export function Burst({ pts, s, u }) {
  const p = clamp((u - 0.55) / 0.45);
  if (p <= 0 || p >= 1) return null;
  const [x, y] = pts[s];
  return <circle cx={x} cy={y} r={16 + p * 30} fill="none" stroke={C.sunEdge} strokeWidth={0.6 + 2.6 * (1 - p)} opacity={1 - p} />;
}

// BPC-157: it reaches a torn tendon, new vessels grow up into the gap, repair cells come in and the gap closes.
function Bpc({ t, a, b, L }) {
  const gap = lerp(52, 8, ease(b));
  const lx = 160 - gap / 2, rx = 160 + gap / 2;
  const cx = lerp(-36, 128, ease(a)), cy = lerp(28, 50, ease(a));
  return (
    <g>
      <g opacity={L(0, 2)}>
        {[78, 92, 106, 120].map((y) => (
          <g key={y}>
            <line x1="14" y1={y} x2={lx} y2={y} stroke={C.spot} strokeWidth="10" strokeLinecap="round" />
            <line x1={rx} y1={y} x2="306" y2={y} stroke={C.spot} strokeWidth="10" strokeLinecap="round" />
          </g>
        ))}
        <Tag x="60" y="152">tendon</Tag>
      </g>
      <g opacity={L(1, 2)}>
        <Grow d="M146 176 Q134 150 150 126" u={b * 1.5} />
        <Grow d="M174 176 Q188 152 170 122" u={b * 1.5 - 0.2} />
        <Grow d="M160 178 Q160 150 160 110" u={b * 1.5 - 0.4} color={C.nucleus} />
        {b > 0 && <Tag x="236" y="166">new vessels</Tag>}
      </g>
      {[[-26, 0], [28, 0.12], [-16, 0.28], [18, 0.4]].map(([dx, delay], i) => {
        const u = ease((b - 0.5 - delay * 0.5) / 0.3);
        return u > 0 ? <Cell key={i} x={lerp(160 + dx * 3.2, 160 + dx * 0.45, u)} y={[86, 112, 98, 104][i]} r={7.5} o={u} /> : null;
      })}
      <Chain pts={wave(cx, cy, 5, 8, 3, t * 4)} r={4} hi={2} />
    </g>
  );
}

// TB-500: it holds on to actin, then cells crawl into a wound and fill it.
function Tb({ t, a, b, L }) {
  const cx = lerp(110, 132, ease(a));
  const actin = Array.from({ length: 6 }, (_, i) => {
    const sx = 40 + i * 48, sy = 22 + (i % 2) * 14;
    const tx = cx + i * 8, ty = 54 + Math.sin(i * 0.9 + t * 3) * 3 + 9;
    const u = ease(a * 1.4 - i * 0.08);
    return [lerp(sx, tx, u), lerp(sy, ty, u)];
  });
  return (
    <g>
      <g opacity={L(1, 2)}>
      <rect x="10" y="96" width="104" height="70" rx="14" fill={C.cyto} stroke={C.spot} strokeWidth="2" />
      <rect x="206" y="96" width="104" height="70" rx="14" fill={C.cyto} stroke={C.spot} strokeWidth="2" />
      {[[34, 118], [70, 140], [42, 152], [88, 116], [232, 120], [270, 146], [288, 116], [240, 154]].map(([x, y], i) => <Cell key={i} x={x} y={y} r={8} />)}
      <Tag x="160" y="92">wound</Tag>
      </g>
      {[[136, 0], [160, 0.18], [184, 0.36]].map(([tx, delay], i) => {
        const u = ease((b - delay) / 0.5);
        if (u <= 0) return null;
        const x = lerp(104, tx, u), y = [122, 142, 128][i];
        return (
          <g key={i}>
            {u < 1 && <ellipse cx={x + 12} cy={y} rx={6 + Math.sin(t * 8) * 2} ry="5" fill={C.fill} opacity="0.8" />}
            <Cell x={x} y={y} r={10} />
          </g>
        );
      })}
      <Chain pts={wave(cx, 54, 7, 8, 3, t * 3)} r={3.8} />
      {actin.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.6" fill={C.sun} stroke={C.sunEdge} strokeWidth="1" />)}
      <g opacity={L(0)}><Tag x="230" y="34">actin</Tag></g>
    </g>
  );
}

// GLP-1: the pancreas releases insulin, the stomach slows, the brain feels full.
function Glp({ t, a, b, L }) {
  const stops = [[52, 70], [160, 66], [262, 60]];
  let x, y;
  if (b <= 0) { x = lerp(-30, stops[0][0], ease(a)); y = lerp(30, stops[0][1], ease(a)); }
  else if (b < 0.5) { const u = ease(b / 0.5); x = lerp(stops[0][0], stops[1][0], u); y = lerp(stops[0][1], stops[1][1], u); }
  else { const u = ease((b - 0.5) / 0.5); x = lerp(stops[1][0], stops[2][0], u); y = lerp(stops[1][1], stops[2][1], u); }
  const insulin = a > 0.6 || b > 0 ? Array.from({ length: 6 }, (_, i) => {
    const p = ((t * 0.6 + i / 6) % 1);
    return [40 + i * 6 + Math.sin(i) * 4, 108 - p * 46, 1 - p];
  }) : [];
  const churn = lerp(6, 1.4, ease(b * 2));
  const full = b > 0.5 ? ease((b - 0.5) / 0.3) : 0;
  return (
    <g>
      <g opacity={L(0)}>
      <path d="M22 118 Q34 96 62 104 Q88 110 90 122 Q88 136 62 132 Q40 130 22 128 Z" fill={C.cyto} stroke={C.membrane} strokeWidth="2" />
      {insulin.map(([ix, iy, o], i) => <circle key={i} cx={ix} cy={iy} r="2.8" fill={C.sun} stroke={C.sunEdge} strokeWidth="1" opacity={o} />)}
      <Tag x="56" y="152">pancreas</Tag>
      </g>
      <g opacity={L(1)}>
      <path d="M140 92 Q128 116 140 136 Q160 154 184 140 Q196 130 190 116 Q182 106 170 114 Q160 120 156 106 Q152 92 140 92 Z" fill={C.cyto} stroke={C.membrane} strokeWidth="2" />
      <path d={`M146 ${124} Q156 ${124 - churn} 166 124 Q176 ${124 + churn} 184 124`} fill="none" stroke={C.organelle} strokeWidth="2" strokeLinecap="round" transform={`translate(0 ${Math.sin(t * lerp(5, 1.2, ease(b * 2))) * 2})`} />
      <Tag x="164" y="166">stomach</Tag>
      </g>
      <g opacity={L(2)}>
      <ellipse cx="262" cy="116" rx="34" ry="26" fill={C.cyto} stroke={C.membrane} strokeWidth="2" />
      <path d="M262 92 Q256 116 262 140" fill="none" stroke={C.membrane} strokeWidth="1.6" />
      {full > 0 && <circle cx="262" cy="116" r={34 + 6 + Math.sin(t * 4) * 3} fill="none" stroke={C.sun} strokeWidth="3" opacity={full * 0.9} />}
      <Tag x="262" y="160">brain</Tag>
      </g>
      <Chain pts={wave(x - 24, y, 7, 7, 3.5, t * 4)} r={3.6} />
    </g>
  );
}

// NAD+: it shuttles electrons in a mitochondrion to make energy, then feeds the enzyme that repairs DNA.
function Nad({ t, a, b, L }) {
  const crista = (u) => [36 + u * 150, 92 + Math.sin(u * Math.PI * 4) * 16];
  const dots = a > 0 ? Array.from({ length: 5 }, (_, i) => {
    const u = (t * 0.18 + i / 5) % 1;
    return [...crista(u), u > 0.5];
  }) : [];
  const sparks = a > 0.4 ? Array.from({ length: 4 }, (_, i) => {
    const p = (t * 0.5 + i / 4) % 1;
    return [120 + i * 18, 70 - p * 40, 1 - p];
  }) : [];
  const brk = lerp(14, 0, ease(b));
  const helix = (side) => Array.from({ length: 22 }, (_, i) => {
    const y = 40 + i * 6;
    const off = Math.sin(i * 0.55 + side * Math.PI) * 18;
    const shift = y > 100 ? brk : 0;
    return [268 + off, y + shift];
  });
  const s1 = helix(0), s2 = helix(1);
  const ex = lerp(214, 252, ease(b)), ey = lerp(150, 106, ease(b));
  return (
    <g>
      <g opacity={L(0)}>
      <rect x="20" y="56" width="182" height="74" rx="37" fill={C.cyto} stroke={C.membrane} strokeWidth="2.4" />
      <path d={Array.from({ length: 41 }, (_, i) => crista(i / 40)).map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join(' ')} fill="none" stroke={C.spot} strokeWidth="3" />
      {dots.map(([dx, dy, nadh], i) => <circle key={i} cx={dx} cy={dy} r="4" fill={nadh ? C.sun : C.organelle} stroke={nadh ? C.sunEdge : C.membrane} strokeWidth="1.2" />)}
      {sparks.map(([sx, sy, o], i) => <path key={i} d={`M${sx} ${sy - 4} L${sx + 1.4} ${sy - 1.4} L${sx + 4} ${sy} L${sx + 1.4} ${sy + 1.4} L${sx} ${sy + 4} L${sx - 1.4} ${sy + 1.4} L${sx - 4} ${sy} L${sx - 1.4} ${sy - 1.4} Z`} fill={C.sun} opacity={o} />)}
      <Tag x="110" y="150">mitochondrion</Tag>
      </g>
      {b > 0 && (
        <g opacity={ease(b * 3) * L(1, 2)}>
          {s1.map(([x1, y1], i) => <line key={i} x1={x1} y1={y1} x2={s2[i][0]} y2={s2[i][1]} stroke={C.fill} strokeWidth="2" />)}
          <path d={s1.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join(' ')} fill="none" stroke={C.membrane} strokeWidth="2.4" />
          <path d={s2.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join(' ')} fill="none" stroke={C.nucleus} strokeWidth="2.4" />
          <Cell x={ex} y={ey} r={9} />
        </g>
      )}
      {b > 0 && <g opacity={L(1, 2)}><Tag x="268" y="30">DNA</Tag></g>}
    </g>
  );
}

// Sermorelin: it reaches the pituitary, growth hormone goes out in pulses, the liver makes IGF-1, the loop feeds back.
function Ser({ t, a, b, L }) {
  const px = 160, py = 46;
  const cx = lerp(-80, px - 96, ease(a));
  const pulses = a > 0.65 || b > 0 ? [0, 1, 2].map((i) => ((t / 1.6 + i / 3) % 1)) : [];
  const gh = b > 0 ? Array.from({ length: 4 }, (_, i) => { const u = (t * 0.35 + i / 4) % 1; return [lerp(px, 84, u), lerp(py + 10, 128, u)]; }) : [];
  const igf = b > 0.3 ? Array.from({ length: 4 }, (_, i) => { const u = (t * 0.35 + i / 4 + 0.5) % 1; return [lerp(104, 236, u), 134 + Math.sin(u * Math.PI) * -8]; }) : [];
  return (
    <g>
      <g opacity={L(0, 1)}>
        <circle cx={px} cy={py} r="15" fill={C.cyto} stroke={C.membrane} strokeWidth="2.4" />
        {pulses.map((p, i) => <circle key={i} cx={px} cy={py} r={15 + p * 36} fill="none" stroke={C.nucleus} strokeWidth="2" opacity={1 - p} />)}
        <Tag x={px} y="20">pituitary</Tag>
      </g>
      <g opacity={L(1, 2)}>{gh.map(([x, y], i) => <circle key={`g${i}`} cx={x} cy={y} r="3.2" fill={C.organelle} />)}</g>
      <g opacity={L(2)}>
        <path d="M50 124 Q60 108 90 112 Q118 116 116 132 Q112 148 84 148 Q56 146 50 136 Z" fill={C.cyto} stroke={C.membrane} strokeWidth="2" />
        {[[236, 122], [258, 140], [282, 122], [250, 108]].map(([x, y], i) => <Cell key={i} x={x} y={y} r={10} />)}
        {igf.map(([x, y], i) => <circle key={`i${i}`} cx={x} cy={y} r="3.2" fill={C.sun} stroke={C.sunEdge} strokeWidth="1" />)}
        {b > 0.5 && <Grow d="M268 100 Q250 40 180 44" u={(b - 0.5) / 0.4} w={2} color={C.spot} />}
        <Tag x="84" y="166">liver</Tag><Tag x="258" y="166">body</Tag>
      </g>
      <Chain pts={wave(cx, py, 12, 8, 3, t * 3)} r={3.4} />
    </g>
  );
}

// GHK-Cu: it carries copper into the skin, and fibroblasts weave collagen and elastin.
function Ghk({ t, a, b, L }) {
  const gy = lerp(4, 92, ease(a));
  const fibro = [[86, 124], [170, 146], [252, 118]];
  const fibers = [
    'M86 124 Q128 104 170 146', 'M170 146 Q212 110 252 118', 'M86 124 Q170 170 252 118',
    'M60 150 Q120 132 170 146', 'M252 118 Q284 140 300 160', 'M86 124 Q100 90 130 100',
  ];
  return (
    <g>
      <g opacity={L(0)}>
        <rect x="0" y="24" width="320" height="34" fill={C.cyto} />
        {Array.from({ length: 12 }, (_, i) => <circle key={i} cx={14 + i * 27} cy="41" r="9" fill={C.white} stroke={C.spot} strokeWidth="1.6" />)}
        <Tag x="270" y="18">skin surface</Tag>
      </g>
      <g opacity={L(2)}>{fibers.map((d, i) => <Grow key={i} d={d} u={(b - 0.3) * 2.2 - i * 0.12} w={i % 3 === 2 ? 1.6 : 2.6} color={i % 3 === 2 ? C.organelle : C.spot} />)}</g>
      <g opacity={L(1, 2)}>
        {b > 0 && fibro.map(([x, y], i) => { const p = (t * 0.9 + i / 3) % 1; return <circle key={`p${i}`} cx={x} cy={y} r={12 + p * 12} fill="none" stroke={C.sunEdge} strokeWidth="1.6" opacity={(1 - p) * 0.8} />; })}
        {fibro.map(([x, y], i) => <Cell key={i} x={x} y={y} r={11 + (b > 0 ? Math.sin(t * 3 + i) * 0.8 + ease(b / 0.3) * 1.5 : 0)} />)}
        <Tag x="86" y="168">fibroblasts</Tag>
      </g>
      <g transform={`translate(160 ${gy})`}>
        <line x1="-11" y1="8" x2="11" y2="8" stroke={C.membrane} strokeWidth="2" />
        <line x1="-11" y1="8" x2="0" y2="-10" stroke={C.membrane} strokeWidth="2" />
        <line x1="11" y1="8" x2="0" y2="-10" stroke={C.membrane} strokeWidth="2" />
        {[[-11, 8], [11, 8], [0, -10]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4.4" fill={C.white} stroke={C.membrane} strokeWidth="1.8" />)}
        <circle r="5" cy="2" fill={C.sun} stroke={C.sunEdge} strokeWidth="1.2" />
      </g>
    </g>
  );
}


const SCENES = { bpc157: Bpc, tb500: Tb, glp1: Glp, nad: Nad, sermorelin: Ser, ghkcu: Ghk };

// Where the spotlight sits in each step.
const FOCUS = {
  bpc157: [[160, 99], [160, 150], [160, 99]],
  tb500: [[150, 58], [130, 132], [160, 132]],
  glp1: [[56, 118], [164, 122], [262, 116]],
  nad: [[110, 93], [268, 96], [262, 118]],
  sermorelin: [[160, 46], [118, 88], [170, 132]],
  ghkcu: [[160, 41], [170, 136], [170, 128]],
};
const HYDRA_FOCUS = [[232, 96], [160, 92], [262, 96], [222, 98]];

// Which part of each drawing moves in each step: [a, b] for the scene, from the step (0, 1, 2) and its progress u.
const MAP = {
  bpc157: (s, u) => (s === 0 ? [u, 0] : s === 1 ? [1, u * 0.55] : [1, 0.55 + u * 0.45]),
  tb500: (s, u) => (s === 0 ? [u, 0] : s === 1 ? [1, u * 0.45] : [1, 0.45 + u * 0.55]),
  glp1: (s, u) => (s === 0 ? [u, 0] : s === 1 ? [1, u * 0.5] : [1, 0.5 + u * 0.5]),
  nad: (s, u) => (s === 0 ? [u, 0] : s === 1 ? [1, u * 0.6] : [1, 0.6 + u * 0.4]),
  sermorelin: (s, u) => (s === 0 ? [u, 0] : s === 1 ? [1, u * 0.45] : [1, 0.45 + u * 0.55]),
  ghkcu: (s, u) => (s === 0 ? [u, 0] : s === 1 ? [1, u * 0.3] : [1, 0.3 + u * 0.7]),
};

// ---- Mount Hydra: how its exosome product is made, in four steps (its own description, mounthydra.com) ----

const ring = (n, r, cx, cy, rot = 0) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2 + rot;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
});
// a 3D cluster of cells: a center, an inner ring and an outer ring, filling in as u grows
function Cluster({ cx, cy, u = 1, s = 1, o = 1 }) {
  const pts = [[cx, cy], ...ring(6, 15 * s, cx, cy, 0.3), ...ring(10, 29 * s, cx, cy)];
  const n = Math.max(1, Math.round(pts.length * clamp(u)));
  return <g opacity={o}>{pts.slice(0, n).map(([x, y], i) => <Cell key={i} x={x} y={y} r={8 * s} />)}</g>;
}
const Strike = ({ x1, y, x2, u }) => <line x1={x1} y1={y} x2={lerp(x1, x2, clamp(u))} y2={y} stroke={C.membrane} strokeWidth="2.6" strokeLinecap="round" />;
const Pill = ({ x, y, w, children, o = 1 }) => (
  <g opacity={o}>
    <rect x={x - w / 2} y={y - 11} width={w} height="22" rx="11" fill={C.white} stroke={C.spot} strokeWidth="1.6" />
    <text x={x} y={y + 4} textAnchor="middle" fontSize="10" fontWeight="800" fill={C.ink} fontFamily="'DM Mono', ui-monospace, monospace">{children}</text>
  </g>
);
const Vial = ({ x, y, label, fill = C.cyto, o = 1, dots = 0, t = 0 }) => (
  <g opacity={o}>
    <rect x={x - 16} y={y - 34} width="32" height="64" rx="8" fill={C.white} stroke={C.membrane} strokeWidth="2.2" />
    <rect x={x - 12} y={y - 6} width="24" height="32" rx="5" fill={fill} />
    <rect x={x - 19} y={y - 42} width="38" height="10" rx="3" fill={C.membrane} />
    {Array.from({ length: dots }, (_, i) => <circle key={i} cx={x - 7 + (i % 3) * 7} cy={y + 2 + Math.floor(i / 3) * 7 + Math.sin(t * 2 + i) * 1.2} r="2" fill={C.sun} stroke={C.sunEdge} strokeWidth=".8" />)}
    <Tag x={x} y={y + 46}>{label}</Tag>
  </g>
);

function HydraScene({ step, u, t }) {
  if (step === 0) return (
    <g>
      <ellipse cx="78" cy="118" rx="62" ry="16" fill={C.cyto} stroke={C.spot} strokeWidth="2" opacity="0.7" />
      {[40, 59, 78, 97, 116].map((x) => <Cell key={x} x={x} y={112} r={8} o={0.6} />)}
      <Tag x="78" y="154">flat dish</Tag>
      <Cluster cx={232} cy={96} u={0.15 + u * 0.85} />
      <Tag x="232" y="154">3D cluster</Tag>
    </g>
  );
  if (step === 1) {
    const bub = (cx, n) => Array.from({ length: n }, (_, i) => { const p = (t * 0.45 + i / n) % 1; return [cx - 34 + ((i * 23) % 68), 140 - p * 90, 1 - p]; });
    return (
      <g>
        <rect x="18" y="34" width="128" height="116" rx="16" fill={C.paper} stroke={C.spot} strokeWidth="2" />
        <rect x="174" y="34" width="128" height="116" rx="16" fill={C.paper} stroke={C.spot} strokeWidth="2" />
        {bub(82, 9).map(([x, y, o], i) => <circle key={`a${i}`} cx={x} cy={y} r="3" fill="none" stroke={C.organelle} strokeWidth="1.4" opacity={o} />)}
        {bub(238, 3).map(([x, y, o], i) => <circle key={`b${i}`} cx={x} cy={y} r="3" fill="none" stroke={C.organelle} strokeWidth="1.4" opacity={o} />)}
        <Cluster cx={82} cy={92} s={0.75} />
        <Cluster cx={238} cy={92} s={0.75} />
        <Tag x="82" y="26">face · normal oxygen</Tag><Tag x="238" y="26">hair · low oxygen</Tag>
        <Pill x={160} y={166} w={110} o={ease(u * 2)}>animal serum</Pill>
        <Strike x1={124} y={165} x2={196} u={u * 2 - 0.5} />
      </g>
    );
  }
  if (step === 2) {
    const ex = Array.from({ length: 10 }, (_, i) => { const p = clamp((u * 1.6 + i * 0.07) % 1.4 - 0.1); return [lerp(96, 252, p) + Math.sin(i * 1.7) * 4, 92 + Math.sin(i * 2.3 + p * 6) * 14, p]; });
    return (
      <g>
        <Cluster cx={70} cy={92} o={1 - ease(clamp((u - 0.55) / 0.4)) * 0.7} />
        <line x1="160" y1="40" x2="160" y2="150" stroke={C.spot} strokeWidth="2.4" strokeDasharray="5 5" />
        <Tag x="160" y="30">filter</Tag>
        {ex.map(([x, y, p], i) => (p > 0.02 && p < 0.98 ? <circle key={i} cx={x} cy={y} r="3" fill={C.sun} stroke={C.sunEdge} strokeWidth="1" /> : null))}
        <Vial x={262} y={96} label="cell-free" dots={Math.round(u * 9)} t={t} />
        <Tag x="70" y="154">cells stay behind</Tag>
      </g>
    );
  }
  const flakes = Array.from({ length: 6 }, (_, i) => { const p = (t * 0.25 + i / 6) % 1; return [186 + ((i * 37) % 120), 28 + p * 120, 1 - p]; });
  const pour = ease(clamp((u - 0.5) / 0.45));
  return (
    <g>
      <g opacity="0.55">
        <rect x="40" y="62" width="34" height="64" rx="8" fill={C.white} stroke={C.spot} strokeWidth="2" />
        <rect x="45" y="104" width="24" height="18" rx="4" fill={C.fill} />
        <Tag x="57" y="146">freeze-dried powder</Tag>
      </g>
      <line x1="30" y1="128" x2={lerp(30, 86, clamp(u * 2))} y2={lerp(128, 58, clamp(u * 2))} stroke={C.membrane} strokeWidth="3" strokeLinecap="round" />
      {flakes.map(([x, y, o], i) => <text key={i} x={x} y={y} fontSize="12" fill={C.organelle} opacity={o} textAnchor="middle">❄</text>)}
      <Vial x={lerp(196, 224, pour)} y={98} label={pour > 0.9 ? 'mixed fresh' : 'core'} dots={pour > 0.9 ? 9 : 5} t={t} />
      {pour < 0.9 && <Vial x={lerp(268, 236, pour)} y={98} label="shield" o={1 - pour} />}
      <Tag x="246" y="20">shipped cold</Tag>
    </g>
  );
}

// ---- the player ----

export const PX_CSS = `
.px-card { display:flex; flex-direction:column; gap:10px; }
.px-stage { position:relative; border-radius:16px; overflow:hidden; background:radial-gradient(120% 95% at 50% 25%, #FFFFFF 0%, var(--paper) 55%, #ECE6FF 100%); cursor:pointer; }
.px-svg { display:block; width:100%; height:auto; aspect-ratio:320/180; }
.px-cap { display:flex; gap:10px; align-items:baseline; min-height:3em; padding:10px 14px 12px; background:var(--white); border-top:2px solid var(--cytoplasm); }
.px-cap i { flex:none; font-style:normal; font-size:12px; font-weight:800; letter-spacing:.08em; color:var(--membrane); }
.px-cap span { font-size:16px; line-height:1.35; font-weight:700; color:var(--ink); animation:px-in .45s ease both; }
@keyframes px-in { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce) { .px-cap span { animation:none; } }
.px-ctl { display:flex; align-items:center; gap:8px; }
.px-ctl .px-pp { display:grid; place-items:center; width:34px; height:34px; border-radius:50%; border:0; background:var(--membrane); color:var(--white); cursor:pointer; }
.px-ctl .px-pp svg { width:14px; height:14px; }
.px-dots { display:flex; gap:6px; flex:1; }
.px-dots button { flex:1; height:30px; padding:0; border:0; background:none; cursor:pointer; }
.px-dots button span { display:block; height:5px; border-radius:3px; background:var(--cytoplasm); overflow:hidden; }
.px-dots button span em { display:block; height:100%; background:var(--membrane); }
.px-dots button:hover span { background:var(--fill, #CFE0FF); }
.px-tabs { display:flex; flex-wrap:wrap; gap:6px; margin-top:4px; }
.px-tabs button { min-height:32px; padding:0 12px; border-radius:999px; border:0; background:var(--cytoplasm); color:var(--ink); font:700 13px 'DM Mono', ui-monospace, monospace; cursor:pointer; }
.px-tabs button[aria-selected=true] { background:var(--ink); color:var(--white); }
.px-tab { min-height:4.4em; font-size:15px; line-height:1.55; color:var(--ink-soft); }
.px-hydra { margin-top:22px; padding:clamp(16px, 3vw, 26px); border-radius:var(--r-md); background:var(--white); box-shadow:inset 0 0 0 2px var(--cytoplasm); }
.px-hydra h4 { margin:6px 0 10px; font-size:22px; font-weight:800; letter-spacing:-.02em; }
.px-hydra .px-fine { margin:0; font-size:13.5px; line-height:1.5; color:var(--ink-soft); }
@media (min-width:860px) { .px-hydra { display:grid; grid-template-columns:minmax(0, .75fr) minmax(0, 1.25fr); gap:28px; align-items:center; } }
`;

const PlayIcon = ({ playing }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{playing ? <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></> : <path d="M8 5v14l11-7z" />}</svg>
);

// A looping, step-by-step animation. It plays while at least half of it is on screen (not for reduced motion), keeps
// its place when the pointer moves, and the dots jump to a step and pause there.
function useSteps(n, stepSec) {
  const ref = useRef(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [seen, setSeen] = useState(false); // half or more on screen: autoplay
  const [vis, setVis] = useState(true); // any of it on screen: a pressed Play runs
  const user = useRef(false); // the viewer paused or picked a step: no autoplay over that
  const still = useRef(typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => { setSeen(e.intersectionRatio >= 0.5); setVis(e.isIntersecting); }, { threshold: [0, 0.5] });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => { if (!user.current && !still.current) setPlaying(seen); }, [seen]);
  useEffect(() => {
    if (!playing || !vis) return undefined;
    let raf = 0;
    let last = performance.now();
    const total = n * stepSec;
    const tick = (now) => {
      const dt = Math.max(0, now - last) / 1000; // read here: React may run the updater later, after `last` moves
      last = now;
      setT((x) => (x + dt) % total);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, vis, n, stepSec]);
  const step = Math.min(n - 1, Math.floor(t / stepSec));
  const u = clamp((t - step * stepSec) / (stepSec * 0.72)); // move for most of the step, then hold so it can be read
  const go = (i) => { user.current = true; setPlaying(false); setT(i * stepSec + stepSec * 0.72); };
  const toggle = () => { user.current = true; setPlaying((p) => !p); };
  const p = clamp((t - step * stepSec) / stepSec);
  return { ref, t, step, u, p, playing, go, toggle, stepSec };
}

// `cut`: every step is its own drawing, so each one fades in and out; otherwise only the loop's ends fade.
export function Player({ captions, draw, label, w, cut = false }) {
  const n = captions.length;
  const s = useSteps(n, 4);
  const fadeIn = Math.min(1, s.p / 0.06), fadeOut = Math.min(1, (1 - s.p) / 0.05);
  const o = !s.playing ? 1 : cut ? Math.min(fadeIn, fadeOut) : s.step === 0 ? fadeIn : s.step === n - 1 ? fadeOut : 1;
  return (
    <div className="px-player" ref={s.ref}>
      <div className="px-stage" onClick={s.toggle} role="img" aria-label={`${label}: ${captions.join('. ')}`}>
        <svg className="px-svg" viewBox="0 0 320 180" aria-hidden="true"><g opacity={o}>{draw(s.step, s.u, s.t)}</g></svg>
        <p className="px-cap" aria-live="polite"><i>{`${s.step + 1}/${n}`}</i><span key={s.step}>{captions[s.step]}</span></p>
      </div>
      <div className="px-ctl">
        <button type="button" className="px-pp" onClick={s.toggle} aria-label={s.playing ? w.x_pause : w.x_play}><PlayIcon playing={s.playing} /></button>
        <div className="px-dots" role="tablist" aria-label={label}>
          {captions.map((c, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === s.step} aria-label={`${w.x_step} ${i + 1}: ${c}`} onClick={() => s.go(i)}>
              <span><em style={{ width: `${i < s.step ? 100 : i === s.step ? Math.round(clamp((s.t - i * s.stepSec) / s.stepSec) * 100) : 0}%` }} /></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const TABS = [['benefits', 'x_benefits'], ['risks', 'x_risks'], ['dose', 'x_dose'], ['stack', 'x_stack']];

// A peptide card's top: the animation, then its name, then the click-through tabs.
export function PeptideExplainer({ k, name, cap, w, children }) {
  const [tab, setTab] = useState('benefits');
  const Scene = SCENES[k];
  const captions = [1, 2, 3].map((i) => w[`x_${k}_s${i}`]).filter(Boolean);
  return (
    <div className="px-card">
      <Player label={name} captions={captions} w={w} draw={(step, u, t) => { const [a, b] = MAP[k](step, u); return <><Spot pts={FOCUS[k]} s={step} u={u} t={t} /><Scene t={t} a={a} b={b} L={lit(step, u)} /><Burst pts={FOCUS[k]} s={step} u={u} /></>; }} />
      <div><b>{name}</b><small style={{ display: 'block', marginTop: 2 }}>{cap}</small></div>
      {children}
      <div className="px-tabs" role="tablist">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{w[label]}</button>)}
      </div>
      <p className="px-tab" role="tabpanel">{w[`x_${k}_${tab}`]}</p>
    </div>
  );
}

// How Mount Hydra makes its exosome product, in four steps.
export function HydraExplainer({ w }) {
  const captions = [1, 2, 3, 4].map((i) => w[`exo_m_s${i}`]).filter(Boolean);
  return (
    <div className="px-hydra">
      <div>
        <p className="ghk-eye" style={{ margin: 0 }}>{w.exo_m_eye}</p>
        <h4>{w.exo_m_title}</h4>
        <p className="px-fine">{w.exo_m_fine}</p>
      </div>
      <Player label={w.exo_m_title} captions={captions} w={w} cut draw={(step, u, t) => <><Spot pts={HYDRA_FOCUS} s={step} u={1} t={t} /><HydraScene step={step} u={u} t={t} /><Burst pts={HYDRA_FOCUS} s={step} u={u} /></>} />
    </div>
  );
}
