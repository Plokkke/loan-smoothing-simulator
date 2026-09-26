const assert = require('node:assert/strict');
const E = require('../engine.js');

const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) < tol, `${a} !== ${b}`);
const c = E.toCents;
const simple = (id, capital, months, payment, extra = {}) => ({
  id, capital: c(capital), rate: E.rateFor(capital, months, payment), startOffset: 0, segments: [{ months, payment: c(payment) }], closing: 'continue', ...extra,
});

// annuity formulas are inverses
const p = E.paymentFor(200000, 3, 240);
near(p, 1109.20, 0.01);
near(E.monthsFor(200000, 3, p), 240, 1e-6);
near(E.rateFor(200000, 240, p), 3, 1e-6);
assert.equal(E.rateFor(200000, 240, 500), null);
near(E.rateFor(12000, 12, 1000), 0, 1e-4);

// example from the brief: 1300 €/month for 119 months, 700 €/month for 58 months
const A = simple('A', 130000, 119, 1300);
const B = simple('B', 38000, 58, 700);
const loans = [A, B];
const base = E.baselineSchedule(loans);
assert.equal(base.duration, 119);
assert.equal(base.periods.length, 2);
assert.equal(base.periods[0].payment, c(2000));
assert.equal(base.periods[1].payment, c(1300));

const sim = E.simulateSmoothing(loans, { rate: 5, target: c(1500) });
assert.ok(sim.feasible, `expected feasible, got ${sim.reason}`);
assert.ok(sim.duration > base.duration, 'smoothing must extend the plan');
assert.ok(sim.totalPaid > base.totalPaid, 'smoothing must cost more');
assert.equal(sim.months[0].lineFlow, c(-500));
assert.equal(sim.months[0].lineBalance, c(500));
assert.deepEqual(sim.periods.map((x) => x.mode), ['draw', 'repay', 'repay']);
assert.equal(sim.periods[1].lineFlow, c(200));
assert.equal(sim.periods[2].lineFlow, c(1500));
const last = sim.months[sim.months.length - 1];
assert.equal(last.lineBalance, 0);
assert.ok(last.totalPaid <= c(1500));
assert.equal(sim.totalPaid, c(130000 + 38000) + sim.totalInterest);

// a small positive payment that does not cover interest is still a draw phase
const slow = E.simulateSmoothing(loans, { rate: 5, target: c(1340) });
assert.deepEqual(slow.periods.map((x) => x.mode), ['draw', 'draw', 'repay']);

// infeasible: tiny target never covers interest
const bad = E.simulateSmoothing(loans, { rate: 5, target: c(300) });
assert.equal(bad.feasible, false);
assert.ok(bad.reason);

// bisection results are consistent
const minT = E.findMinTarget(loans, 5);
assert.ok(E.simulateSmoothing(loans, { rate: 5, target: minT }).feasible);
assert.ok(!E.simulateSmoothing(loans, { rate: 5, target: minT - 1 }).feasible);
const isoT = E.findIsoDurationTarget(loans, 5);
assert.ok(isoT > minT && isoT < c(2000));
assert.ok(E.simulateSmoothing(loans, { rate: 5, target: isoT }).duration <= base.duration);

// target for a longer plan sits between the iso-duration target and the minimum
const plus24 = E.findTargetForDuration(loans, 5, base.duration + 24);
assert.ok(plus24 < isoT && plus24 > minT);
assert.ok(E.simulateSmoothing(loans, { rate: 5, target: plus24 }).duration <= base.duration + 24);

// excluded loan: stays in the baseline and in the total paid, never compensated by the line
const excl = E.simulateSmoothing([A, { ...B, enabled: false }], { rate: 5, target: c(1500) });
assert.ok(!excl.everDrawn, 'line must not compensate an excluded loan');
assert.equal(excl.months[0].totalPaid, c(1300 + 700));
assert.equal(excl.months[0].excludedPayment, c(700));
assert.equal(E.baselineSchedule([A, { ...B, enabled: false }]).totalPaid, base.totalPaid);
assert.equal(excl.duration, 119);
assert.equal(excl.periods[0].totalNominal, c(2000));

// deferred start: no payment during the offset, then the schedule runs
const deferred = simple('C', 12000, 12, 1050, { startOffset: 7, rate: 8 });
const ds = E.schedule(deferred);
assert.equal(ds.rows[6].pending, true);
assert.equal(ds.rows[6].payment, 0);
assert.ok(ds.rows[7].payment > 0);
const withDeferred = E.baselineSchedule([A, deferred]);
assert.equal(withDeferred.months[0].total, c(1300));
assert.ok(withDeferred.months[7].total > c(1300));

// stepped schedule with a closing balloon instalment
const stepped = { id: 'D', capital: c(50000), rate: 4, startOffset: 0, closing: 'balloon', segments: [{ months: 13, payment: c(900) }, { months: 10, payment: c(1200) }] };
const ss = E.schedule(stepped);
assert.ok(ss.valid);
assert.equal(ss.duration, 24);
assert.ok(ss.lastPayment > c(1200), 'balloon settles the remaining balance');
assert.equal(ss.rows[23].balance, 0);
assert.equal(E.baselineSchedule([stepped]).periods.length, 3);

// stepped schedule that continues the last payment until repaid
const cont = { ...stepped, closing: 'continue' };
const cs = E.schedule(cont);
assert.ok(cs.valid && cs.duration > 24);
assert.equal(E.baselineSchedule([cont]).periods.length, 2);

// invalid: last payment below interest with no balloon
const broken = { ...stepped, closing: 'continue', segments: [{ months: 6, payment: c(50) }] };
assert.equal(E.schedule(broken).valid, false);
assert.equal(E.schedule(broken).reason, 'payment_below_interest');

// a rounded explicit rate leaves cents behind: they are settled in the last instalment, no phantom month
const rounded = { id: 'R', capital: c(38000), rate: 2.725, startOffset: 0, closing: 'balloon', segments: [{ months: 58, payment: c(700) }, { months: 24, payment: c(900) }] };
assert.equal(E.schedule(rounded).duration, 58);
assert.equal(E.baselineSchedule([rounded]).periods.length, 1);

// implied rate of a plain annuity stream is the annuity rate
near(E.impliedRate(200000, Array(240).fill(p)), 3, 1e-6);
assert.equal(E.impliedRate(1000, [100, 100]), null);

// equivalent single loan: same capital, plan duration, rate between the old loans and the line
const eq = sim.equivalent;
assert.equal(eq.capital, c(168000));
assert.equal(eq.months, sim.duration);
assert.ok(eq.rate > 2.7 && eq.rate < 5, `unexpected implied rate ${eq.rate}`);
// B's last instalment is the adjusting one (700.01 €): the cent it absorbs is drawn too
assert.equal(eq.disbursed, c(500 * 58) + (E.schedule(B).lastPayment - c(700)));
assert.equal(eq.drawMonths, 58);
near(E.paymentFor(eq.capital, eq.rate, eq.months) * eq.months, sim.totalPaid, sim.totalPaid * 0.01);

console.log('all tests passed');
