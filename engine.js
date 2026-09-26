// Pure computation engine: no DOM. Loaded as a plain script in the browser,
// exported via module.exports for Node tests.
//
// Money is integer cents everywhere. Rates, solvers and IRR stay floating point: they are
// numerical methods, never booked. Every booked amount goes through `roundCents` exactly once.
(function (root) {
  'use strict';

  const MAX_MONTHS = 600;
  // A leftover below this is folded into the current instalment (adjusting instalment).
  const RESIDUAL = 50;

  // Half-up to the cent. Every amount rounded here is non-negative.
  const roundCents = (x) => Math.round(x);
  const toCents = (euros) => Math.round(euros * 100);
  const monthlyRate = (annualPct) => annualPct / 100 / 12;
  // Nominal (proportional) annual rate -> actuarial annual rate, the TAEG convention.
  const actuarialRate = (annualPct) => (Math.pow(1 + monthlyRate(annualPct), 12) - 1) * 100;
  const sum = (arr, pick) => arr.reduce((s, x) => s + pick(x), 0);

  function paymentFor(capital, annualPct, months) {
    const r = monthlyRate(annualPct);
    if (months <= 0) return 0;
    if (r === 0) return capital / months;
    // 1 - (1 + r)^-n, stable when r is tiny (plain pow rounds 1 + r to 1).
    return (capital * r) / -Math.expm1(-months * Math.log1p(r));
  }

  function monthsFor(capital, annualPct, payment) {
    const r = monthlyRate(annualPct);
    if (payment <= 0) return Infinity;
    if (r === 0) return capital / payment;
    if (payment <= capital * r) return Infinity;
    return -Math.log1p(-(capital * r) / payment) / Math.log1p(r);
  }

  // Implied annual rate such that `payment` over `months` repays `capital`.
  // Returns null when the payments cannot even cover the capital.
  function rateFor(capital, months, payment) {
    if (months <= 0 || payment <= 0 || payment * months < capital) return null;
    let lo = 0;
    let hi = 100;
    for (let k = 0; k < 80; k += 1) {
      const mid = (lo + hi) / 2;
      if (paymentFor(capital, mid, months) > payment) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  }

  // Annual rate at which the present value of a payment stream equals `capital` (IRR).
  function impliedRate(capital, payments) {
    const total = payments.reduce((a, b) => a + b, 0);
    if (capital <= 0 || total < capital) return null;
    const pv = (annual) => {
      const r = monthlyRate(annual);
      return payments.reduce((acc, p, i) => acc + p / Math.pow(1 + r, i + 1), 0);
    };
    let lo = 0;
    let hi = 100;
    for (let k = 0; k < 80; k += 1) {
      const mid = (lo + hi) / 2;
      if (pv(mid) > capital) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // Engine view of a loan entered in euros.
  const fromEuros = (loan) => ({
    ...loan,
    capital: toCents(loan.capital),
    segments: loan.segments.map((s) => ({ months: s.months, payment: toCents(s.payment) })),
  });

  // A loan is { capital, rate, startOffset, segments: [{ months, payment }], closing }.
  // closing: 'continue' keeps the last payment until the balance is repaid,
  // 'balloon' settles the remaining balance in one closing instalment.
  function schedule(loan) {
    const r = monthlyRate(loan.rate);
    const rows = [];
    let balance = loan.capital;
    const push = (nominal) => {
      const interest = roundCents(balance * r);
      let payment = Math.min(nominal, balance + interest);
      balance = balance + interest - payment;
      if (balance < RESIDUAL) { payment += balance; balance = 0; }
      rows.push({ nominal, payment, interest, principal: payment - interest, balance });
    };

    for (let k = 0; k < (loan.startOffset || 0); k += 1) {
      rows.push({ nominal: 0, payment: 0, interest: 0, principal: 0, balance, pending: true });
    }
    for (const seg of loan.segments) {
      for (let m = 0; m < seg.months && balance > 0 && rows.length < MAX_MONTHS; m += 1) push(seg.payment);
    }
    let reason = null;
    if (balance > 0) {
      const last = loan.segments[loan.segments.length - 1]?.payment ?? 0;
      if (loan.closing === 'balloon') push(balance + roundCents(balance * r));
      else if (last <= roundCents(balance * r)) reason = 'payment_below_interest';
      else while (balance > 0 && rows.length < MAX_MONTHS) push(last);
    }
    if (!reason && balance > 0) reason = 'horizon_exceeded';

    const paying = rows.filter((x) => !x.pending);
    return {
      rows,
      valid: !reason,
      reason,
      duration: rows.length,
      startOffset: loan.startOffset || 0,
      interest: sum(paying, (x) => x.interest),
      avgPayment: paying.length ? roundCents(sum(paying, (x) => x.payment) / paying.length) : 0,
      lastPayment: paying[paying.length - 1]?.payment ?? 0,
    };
  }

  function groupPeriods(months, keyOf, describe) {
    const periods = [];
    months.forEach((m, i) => {
      const key = keyOf(m);
      const last = periods[periods.length - 1];
      if (last && last.key === key) {
        last.to = i;
        last.months += 1;
      } else {
        periods.push({ key, from: i, to: i, months: 1, ...describe(m, i) });
      }
    });
    return periods;
  }

  const periodKey = (m) => `${m.activeIds.join('|')}@${m.nominal}`;

  // Aggregated month-by-month view of a set of loans.
  function baselineSchedule(loans) {
    const schedules = loans.map((loan) => ({ id: loan.id, ...schedule(loan) }));
    const duration = Math.max(0, ...schedules.map((s) => s.rows.length));
    const months = Array.from({ length: duration }, (_, i) => {
      const active = schedules.filter((s) => i < s.rows.length && !s.rows[i].pending);
      return {
        total: sum(active, (s) => s.rows[i].payment),
        nominal: sum(active, (s) => s.rows[i].nominal),
        interest: sum(active, (s) => s.rows[i].interest),
        activeIds: active.map((s) => s.id),
      };
    });
    return {
      months,
      periods: groupPeriods(months, periodKey, (m) => ({ activeIds: m.activeIds, payment: m.nominal })),
      duration,
      totalPaid: sum(months, (m) => m.total),
      totalInterest: sum(months, (m) => m.interest),
      perLoan: schedules,
    };
  }

  const at = (base, i, key, fallback) => (i < base.duration ? base.months[i][key] : fallback);

  // Simulates the smoothing credit line over loans flagged `enabled`. Loans left
  // out of the smoothing are still paid, on top of the target payment.
  function simulateSmoothing(loans, options) {
    const { rate, target } = options;
    const smoothed = baselineSchedule(loans.filter((l) => l.enabled !== false));
    const excluded = baselineSchedule(loans.filter((l) => l.enabled === false));
    const allDuration = Math.max(smoothed.duration, excluded.duration);
    const r = monthlyRate(rate);
    const months = [];
    let balance = 0;
    let reason = null;

    for (let i = 0; i < MAX_MONTHS; i += 1) {
      const loansPayment = at(smoothed, i, 'total', 0);
      const lineInterest = roundCents(balance * r);
      const available = target - loansPayment;
      let lineFlow = available;
      let smoothedPaid = target;
      if (available >= 0 && balance + lineInterest <= available) {
        lineFlow = balance + lineInterest;
        smoothedPaid = loansPayment + lineFlow;
      }
      balance = balance + lineInterest - lineFlow;
      const excludedPayment = at(excluded, i, 'total', 0);
      months.push({
        loansPayment,
        nominalFlow: target - at(smoothed, i, 'nominal', 0),
        excludedPayment,
        excludedNominal: at(excluded, i, 'nominal', 0),
        lineFlow,
        lineInterest,
        lineBalance: balance,
        totalPaid: smoothedPaid + excludedPayment,
        activeIds: [...at(smoothed, i, 'activeIds', []), ...at(excluded, i, 'activeIds', [])],
      });
      const loansDone = i >= allDuration - 1;
      if (loansDone && balance <= 0) break;
      if (i >= smoothed.duration - 1 && balance > 0 && target <= lineInterest) {
        reason = 'target_below_interest';
        break;
      }
    }

    const finished = !reason && months[months.length - 1].lineBalance <= 0;
    if (!finished && !reason) reason = 'horizon_exceeded';
    const lineInterestTotal = sum(months, (m) => m.lineInterest);
    const peak = months.reduce((best, m, i) => (m.lineBalance > best.value ? { value: m.lineBalance, month: i } : best), { value: 0, month: -1 });

    // Draw while the balance grows (nominal payment below accrued interest), repay once it shrinks.
    const modeOf = (m) => {
      if (m.lineBalance <= 0 && m.lineFlow <= 0 && m.nominalFlow >= 0) return 'none';
      return m.nominalFlow < m.lineInterest ? 'draw' : 'repay';
    };
    const phaseKey = (m) => `${m.activeIds.join('|')}#${modeOf(m)}@${m.nominalFlow}@${m.excludedNominal}`;
    const periods = groupPeriods(months, phaseKey, (m, i) => ({
      activeIds: m.activeIds,
      mode: modeOf(m),
      loansPayment: target - m.nominalFlow,
      excludedPayment: m.excludedNominal,
      lineFlow: m.lineFlow,
      lineInterestStart: m.lineInterest,
      balanceStart: i === 0 ? 0 : months[i - 1].lineBalance,
    }));
    periods.forEach((p) => {
      p.balanceEnd = months[p.to].lineBalance;
      p.lineInterestEnd = months[p.to].lineInterest;
      p.totalNominal = Math.min(target, p.loansPayment + Math.max(p.lineFlow, 0)) + p.excludedPayment;
    });

    // The whole smoothed structure seen as one classic loan: what a lender actually underwrites.
    const smoothedLoans = loans.filter((l) => l.enabled !== false);
    const drawMonths = months.filter((m) => m.lineFlow < 0);
    const equivalent = {
      capital: sum(smoothedLoans, (l) => l.capital),
      months: finished ? months.length : Infinity,
      payment: target,
      rate: finished ? impliedRate(sum(smoothedLoans, (l) => l.capital), months.map((m) => m.totalPaid - m.excludedPayment)) : null,
      disbursed: -sum(drawMonths, (m) => Math.min(m.lineFlow, 0)),
      drawMonths: drawMonths.length,
      repayMonths: peak.month >= 0 && finished ? months.length - 1 - peak.month : 0,
    };

    return {
      feasible: finished,
      reason,
      target,
      rate,
      months,
      periods,
      equivalent,
      duration: finished ? months.length : Infinity,
      totalPaid: sum(months, (m) => m.totalPaid),
      totalInterest: smoothed.totalInterest + excluded.totalInterest + lineInterestTotal,
      lineInterest: lineInterestTotal,
      peakBalance: peak.value,
      peakMonth: peak.month,
      everDrawn: months.some((m) => m.lineFlow < 0),
      hasExcluded: excluded.duration > 0,
      smoothed,
    };
  }

  // Rates of each smoothed loan, of the current situation, of the credit line and of the smoothed
  // plan, under both conventions: nominal (monthly rate × 12) and actuarial (TAEG basis, no fees).
  function rateComparison(loans, sim) {
    const smoothedLoans = loans.filter((l) => l.enabled !== false);
    const base = sim.smoothed;
    const row = (kind, nominal, interest, months, id = null) => ({
      kind, id, nominal, actuarial: nominal === null ? null : actuarialRate(nominal), interest, months,
    });
    const currentRate = impliedRate(sum(smoothedLoans, (l) => l.capital), base.months.map((m) => m.total));
    return [
      ...base.perLoan.map((s, i) => row('loan', smoothedLoans[i].rate, s.interest, s.duration, s.id)),
      row('current', currentRate, base.totalInterest, base.duration),
      row('line', sim.rate, sim.lineInterest, null),
      row('plan', sim.equivalent.rate, base.totalInterest + sim.lineInterest, sim.duration),
    ];
  }

  // Monotone bisection on the target payment (integer cents): higher target => shorter plan.
  // Returns the smallest target satisfying the predicate, exact to the cent.
  function bisectTarget(loans, rate, predicate) {
    let lo = 0;
    let hi = baselineSchedule(loans.filter((l) => l.enabled !== false)).periods.reduce((m, p) => Math.max(m, p.payment), 0) || 1;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (predicate(simulateSmoothing(loans, { rate, target: mid }))) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  const findMinTarget = (loans, rate) => bisectTarget(loans, rate, (sim) => sim.feasible);

  // Smallest target for which the whole plan ends within `maxDuration` months.
  const findTargetForDuration = (loans, rate, maxDuration) => bisectTarget(loans, rate, (sim) => sim.feasible && sim.duration <= maxDuration);

  const findIsoDurationTarget = (loans, rate) => findTargetForDuration(loans, rate, baselineSchedule(loans).duration);

  const api = {
    MAX_MONTHS,
    toCents,
    fromEuros,
    actuarialRate,
    paymentFor,
    monthsFor,
    rateFor,
    impliedRate,
    schedule,
    baselineSchedule,
    simulateSmoothing,
    rateComparison,
    findMinTarget,
    findTargetForDuration,
    findIsoDurationTarget,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
