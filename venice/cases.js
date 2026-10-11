// Grateful Space Group · Venice pipeline cases. Every building runs through the same rent model as
// 132 Brooks (runBrooks in ../brooks/model.js): NNN master lease to the operator at $4.25/sf/mo with 3%
// bumps, ~50% loan at 7% / 25 yrs, 12-month carry reserve, 8% pref then 75/25. Only the building changes.
// Node: `node cases.js` prints each case at asking and the price that pencils (8% investor cash yield, year 3).
if (typeof runBrooks === 'undefined' && typeof require !== 'undefined') {
  ({ BROOKS, runBrooks } = require('../../../oasis-share/brooks/model.js'));
}

// Retrofit cost per building sf by starting condition (construction only; design/permits and 10%
// contingency are added on top). 132 Brooks is the calibration point: $750K / 9,498 sf = $79/sf.
const RETROFIT_PSF = { church: 79, hall: 79, office: 55, flex: 95, warehouse: 110, mixed: 70 };
const DESIGN_SHARE = 0.2667; // design, engineering and permits as a share of construction (Brooks: 200/750)

function spaceParams(b) {
  const ratio = b.sf / BROOKS.sf;
  const hard = Math.round(b.sf * RETROFIT_PSF[b.kind] / 5000) * 5000;
  return Object.assign({}, BROOKS, {
    sf: b.sf, lotSf: b.lotSf || b.sf,
    hard, soft: Math.round(hard * DESIGN_SHARE / 5000) * 5000,
    rentPsfMo: b.rentPsfMo || BROOKS.rentPsfMo,
    operator: {
      revenue: BROOKS.operator.revenue.map(r => [r[0], r[1], Math.round(r[2] * ratio)]),
      costs: BROOKS.operator.costs.map(r => [r[0], r[1], Math.round(r[2] * Math.max(0.6, ratio))]),
    },
  });
}

function caseFor(b) {
  const p = spaceParams(b);
  const atAsk = b.ask ? runBrooks(b.ask, p) : null;
  // price that pencils: highest price with year-3 investor cash yield >= 8%
  let lo = 250000, hi = Math.max(b.ask || 0, 20e6);
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; (runBrooks(mid, p).stabilizedYield >= 0.08 ? (lo = mid) : (hi = mid)); }
  const pencil = Math.floor(lo / 50000) * 50000;
  return { b, p, atAsk, pencil, atPencil: runBrooks(pencil, p), discount: b.ask ? 1 - pencil / b.ask : null };
}

if (typeof module !== 'undefined') {
  module.exports = { RETROFIT_PSF, spaceParams, caseFor };
  if (require.main === module) {
    const f = n => '$' + Math.round(n).toLocaleString('en-US');
    const c = caseFor({ name: '132 Brooks Ave', kind: 'church', sf: 9498, lotSf: 14999, ask: 5.9e6 });
    console.log('calibration 132 Brooks: hard', f(c.p.hard), 'soft', f(c.p.soft), 'Y3 at ask', (c.atAsk.stabilizedYield * 100).toFixed(1) + '%', 'pencils at', f(c.pencil), 'Y3 there', (c.atPencil.stabilizedYield * 100).toFixed(1) + '%');
    console.log('check $4M:', (runBrooks(4e6, c.p).stabilizedYield * 100).toFixed(1) + '%', 'raise', f(runBrooks(4e6, c.p).equity));
  }
}
