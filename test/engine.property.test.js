const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const E = require('../engine.js');

const sum = (arr, pick) => arr.reduce((s, x) => s + pick(x), 0);
const RESIDUAL = 50;

const rate = fc.double({ min: 0, max: 15, noNaN: true });
const capital = fc.integer({ min: 100_000, max: 100_000_000 });

const simpleLoan = fc.record({ capital, rate, months: fc.integer({ min: 1, max: 360 }) })
  .map(({ capital: k, rate: r, months }) => ({
    capital: k, rate: r, startOffset: 0, closing: 'continue', segments: [{ months, payment: Math.ceil(E.paymentFor(k, r, months)) }],
  }));

const advancedLoan = fc.record({
  capital,
  rate,
  startOffset: fc.integer({ min: 0, max: 24 }),
  closing: fc.constantFrom('continue', 'balloon'),
  segments: fc.array(fc.record({ months: fc.integer({ min: 1, max: 120 }), payment: fc.integer({ min: 0, max: 2_000_000 }) }), { minLength: 1, maxLength: 4 }),
});

const withIds = (loans) => loans.map((l, i) => ({ ...l, id: String(i) }));

test('every booked schedule amount is an integer number of cents', () => {
  fc.assert(fc.property(advancedLoan, (loan) => {
    E.schedule(loan).rows.forEach((row) => ['payment', 'interest', 'principal', 'balance'].forEach((k) => assert.ok(Number.isInteger(row[k]), `${k}=${row[k]}`)));
  }));
});

test('a valid schedule repays the capital to the exact cent', () => {
  fc.assert(fc.property(fc.oneof(simpleLoan, advancedLoan), (loan) => {
    const s = E.schedule(loan);
    fc.pre(s.valid);
    assert.equal(sum(s.rows, (x) => x.principal), loan.capital);
    assert.equal(sum(s.rows, (x) => x.payment), loan.capital + s.interest);
    assert.equal(s.rows[s.rows.length - 1].balance, 0);
    s.rows.forEach((x) => assert.ok(x.balance >= 0));
  }));
});

test('only the adjusting instalment deviates from the nominal payment, by less than the residual', () => {
  fc.assert(fc.property(simpleLoan, (loan) => {
    const s = E.schedule(loan);
    fc.pre(s.valid);
    s.rows.slice(0, -1).forEach((x) => assert.equal(x.payment, x.nominal));
    assert.ok(s.lastPayment <= loan.segments[0].payment + RESIDUAL);
  }));
});

const smoothing = fc.record({
  loans: fc.array(simpleLoan, { minLength: 1, maxLength: 3 }).map(withIds),
  rate: fc.double({ min: 0, max: 10, noNaN: true }),
  slack: fc.double({ min: 0, max: 1, noNaN: true }),
});

test('a feasible smoothing clears the line and conserves every cent', () => {
  fc.assert(fc.property(smoothing, ({ loans, rate: r, slack }) => {
    const peak = Math.max(...E.baselineSchedule(loans).periods.map((p) => p.payment));
    const minT = E.findMinTarget(loans, r);
    const target = Math.round(minT + slack * Math.max(peak - minT, 0));
    const sim = E.simulateSmoothing(loans, { rate: r, target });
    assert.ok(sim.feasible, `target ${target} >= min ${minT} must be feasible`);
    assert.equal(sim.months[sim.months.length - 1].lineBalance, 0);
    sim.months.forEach((m) => {
      ['lineFlow', 'lineInterest', 'lineBalance', 'totalPaid'].forEach((k) => assert.ok(Number.isInteger(m[k]), `${k}=${m[k]}`));
      assert.ok(m.lineBalance >= 0);
      assert.ok(m.totalPaid <= target);
    });
    assert.equal(sim.totalPaid, sum(loans, (l) => l.capital) + sim.smoothed.totalInterest + sim.lineInterest);
  }), { numRuns: 60 });
});

test('the minimum target is exact to the cent', () => {
  fc.assert(fc.property(smoothing, ({ loans, rate: r }) => {
    const minT = E.findMinTarget(loans, r);
    assert.ok(E.simulateSmoothing(loans, { rate: r, target: minT }).feasible);
    if (minT > 1) assert.ok(!E.simulateSmoothing(loans, { rate: r, target: minT - 1 }).feasible);
  }), { numRuns: 60 });
});

test('the IRR of an annuity is its rate', () => {
  fc.assert(fc.property(simpleLoan, (loan) => {
    const { months } = loan.segments[0];
    const exact = E.paymentFor(loan.capital, loan.rate, months);
    assert.ok(Math.abs(E.impliedRate(loan.capital, Array(months).fill(exact)) - loan.rate) < 1e-6);
  }));
});
