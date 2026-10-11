// Grateful Space Group · 132 Brooks Ave rent model. No sale is assumed: investors hold the building
// and are paid from a triple-net master lease to Grateful Giraffes, the operator.
// Shared by the page (inlined) and node tests: `node model.js` prints both price scenarios.
const BROOKS = {
  sf: 9498, lotSf: 14999,
  closingPct: 0.02,          // title, escrow, due diligence
  hard: 750000,              // ADA + restrooms, café kitchen, life safety, AV, giraffe coat, courtyard
  soft: 200000,              // architect, engineering, CUP + Coastal Development Permit
  contPct: 0.10,             // contingency on hard costs
  formation: 100000,         // fund formation, legal, working capital
  ltc: 0.50, rate: 0.07, amortYrs: 25,
  rentPsfMo: 4.25,           // NNN; Main St retail asks $4.50 to $4.95
  rentGrowth: 0.03,
  openingRentFactor: 0.75,   // year 2: three months free while the doors open
  admin: 35000, adminGrowth: 0.03,
  pref: 0.08, lpShare: 0.75, // 8% cumulative preferred return, then 75/25
  years: 10,
  taxRate: 0.0118,
  operator: {                // stabilized year (year 3) operator P&L, for rent coverage
    revenue: [
      ['Memberships', '220 members at $185 a month', 220 * 185 * 12],
      ['Private events and weddings', '90 a year at $5,500', 90 * 5500],
      ['Studio residencies', '24 founder desks at $400 a month', 24 * 400 * 12],
      ['Classes and programs', 'AI bootcamps, workshops, gatherings', 180000],
      ['Film and photo shoots', '30 days at $4,000', 30 * 4000],
      ['Café and bar', 'net of cost of goods', 100000],
    ],
    costs: [
      ['Team', 'GM, events, community, café, cleaning', 440000],
      ['Insurance', '', 48000],
      ['Utilities', '', 55000],
      ['Repairs and maintenance', '', 45000],
      ['Marketing, software, supplies', '', 50000],
    ],
  },
};

function annualDebtService(loan, a) {
  const r = a.rate / 12, n = a.amortYrs * 12;
  return loan * r / (1 - Math.pow(1 + r, -n)) * 12;
}

function loanBalance(loan, a, years) {
  const r = a.rate / 12, n = a.amortYrs * 12, pmt = loan * r / (1 - Math.pow(1 + r, -n));
  let b = loan;
  for (let m = 0; m < years * 12; m++) b = b * (1 + r) - pmt;
  return b;
}

function runBrooks(price, a = BROOKS) {
  const closing = a.closingPct * price;
  const retrofit = a.hard + a.soft + a.contPct * a.hard;
  const k = annualDebtService(1, a);
  // carry reserve = year-1 debt service + admin (no rent while the retrofit runs); solve the loop
  const preCarry = price + closing + retrofit + a.formation;
  const rough = (preCarry + a.admin) / (1 - k * a.ltc);
  const loan = Math.round(a.ltc * rough / 50000) * 50000;
  const ds = annualDebtService(loan, a);
  const minEquity = preCarry + ds + a.admin - loan;
  const equity = Math.ceil(minEquity / 25000) * 25000;          // the raise, rounded up
  const reserve = equity + loan - preCarry;                       // rounding lands in the reserve
  const total = equity + loan;

  const baseRent = a.sf * a.rentPsfMo * 12;
  const rows = [];
  let owed = 0, lpCum = 0;
  for (let y = 1; y <= a.years; y++) {
    const rent = y === 1 ? 0 : y === 2 ? baseRent * a.openingRentFactor : baseRent * Math.pow(1 + a.rentGrowth, y - 2);
    const admin = a.admin * Math.pow(1 + a.adminGrowth, y - 1);
    const cash = y === 1 ? 0 : rent - ds - admin;                // year 1 is carried by the reserve
    owed += a.pref * equity;
    const toPref = Math.max(0, Math.min(cash, owed - lpCum));
    const over = Math.max(0, cash - toPref);
    const lp = toPref + over * a.lpShare, gp = over * (1 - a.lpShare);
    lpCum += lp;
    rows.push({ y, rent, ds, admin, cash, lp, gp, lpYield: lp / equity, lpCum,
                balance: loanBalance(loan, a, y) });
  }

  const tax = a.taxRate * (price + retrofit);
  const rev = a.operator.revenue.reduce((s, r) => s + r[2], 0);
  const costs = a.operator.costs.reduce((s, r) => s + r[2], 0) + tax;
  const y3rent = rows[2].rent;
  const ebitdar = rev - costs;

  return {
    price, closing, retrofit, formation: a.formation, reserve, total, loan, equity, ds, baseRent,
    pricePerBldgSf: price / a.sf, pricePerLandSf: price / a.lotSf,
    rows,
    stabilizedYield: rows[2].lpYield, year10Yield: rows[a.years - 1].lpYield,
    tenYearCash: lpCum, tenYearMultiple: lpCum / equity,
    principalPaid: loan - rows[a.years - 1].balance,
    operator: { rev, tax, costs, ebitdar, rent: y3rent, coverage: ebitdar / y3rent,
                cushion: (ebitdar - y3rent) / rev },
  };
}

if (typeof module !== 'undefined') {
  module.exports = { BROOKS, runBrooks };
  if (require.main === module) {
    const f = n => '$' + Math.round(n).toLocaleString('en-US');
    for (const p of [4e6, 5e6]) {
      const m = runBrooks(p);
      console.log(`\n=== ${f(p)} ===  total ${f(m.total)}  loan ${f(m.loan)}  RAISE ${f(m.equity)}  reserve ${f(m.reserve)}  DS ${f(m.ds)}`);
      console.log(`base rent ${f(m.baseRent)}  $/bldg sf ${f(m.pricePerBldgSf)}  $/land sf ${f(m.pricePerLandSf)}`);
      for (const r of m.rows) console.log(`Y${r.y}  rent ${f(r.rent)}  cash ${f(r.cash)}  LP ${f(r.lp)} (${(r.lpYield * 100).toFixed(1)}%)  GP ${f(r.gp)}  LPcum ${f(r.lpCum)}`);
      console.log(`10y LP cash ${f(m.tenYearCash)} = ${(m.tenYearMultiple * 100).toFixed(0)}% of capital; principal paid ${f(m.principalPaid)}`);
      const o = m.operator;
      console.log(`operator rev ${f(o.rev)} costs ${f(o.costs)} (tax ${f(o.tax)}) EBITDAR ${f(o.ebitdar)} rent ${f(o.rent)} coverage ${o.coverage.toFixed(2)}x cushion ${(o.cushion * 100).toFixed(0)}%`);
    }
  }
}
