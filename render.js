// Results rendering: status, suggestions, key points, plan and schedule tables, charts.
(function (root) {
  'use strict';
  const E = root.Engine;
  const { eur, eur2, pct2, months, years, monthLabel } = root.Fmt;
  const $ = (sel) => document.querySelector(sel);
  const ceilEuro = (cents) => Math.ceil(cents / 100) * 100;

  const table = (host, head, rows) => {
    host.innerHTML = `<thead><tr>${head.map(([h, cls]) => `<th class="${cls || ''}">${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${head[i][1] || ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
  };

  // Feasibility: only an impossible configuration is flagged.
  function status(sim, loans, rate) {
    const el = $('#status');
    const smoothedCount = loans.filter((l) => l.enabled !== false).length;
    el.hidden = false;
    if (!loans.length) { el.textContent = 'Ajoutez au moins un crédit valide'; return; }
    if (!smoothedCount) { el.textContent = 'Aucun crédit dans le lissage'; return; }
    if (!sim.everDrawn || sim.feasible) { el.hidden = true; return; }
    const minT = E.findMinTarget(loans, rate);
    el.textContent = sim.reason === 'target_below_interest'
      ? `Impossible : ${eur(sim.target)} ne couvre pas les intérêts de la modulation après les crédits. Minimum ${eur(minT)}.`
      : `Impossible : modulation non remboursée en 50 ans. Minimum ${eur(minT)}.`;
  }

  const endLabel = (duration) => `Plan terminé en ${monthLabel(duration - 1)} (${years(duration)})`;

  function chip(host, label, value, title, target, onPick) {
    const picked = ceilEuro(value);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.title = title;
    b.setAttribute('aria-pressed', picked === target);
    b.innerHTML = `<span>${label}</span><b>${eur(picked)}</b>`;
    b.addEventListener('click', () => onPick(picked));
    host.appendChild(b);
    return b;
  }

  // Duration chips: same duration, then +x months up to min(25 years, twice the current duration).
  // Reduction chips: -x % of the highest monthly payment of the smoothed loans.
  const EXTRA_STEPS = [12, 24, 60, 120];
  const REDUCTIONS = [10, 20, 30, 40];
  function suggestions(loans, rate, target, onPick) {
    const dur = $('#chips-duration');
    const red = $('#chips-reduction');
    dur.innerHTML = '';
    red.innerHTML = '';
    const smoothed = loans.filter((l) => l.enabled !== false);
    if (!smoothed.length) return;
    const current = E.baselineSchedule(loans).duration;
    const maxExtra = Math.min(300, current * 2) - current;
    const extras = EXTRA_STEPS.filter((x) => x < maxExtra);
    if (maxExtra > 0 && !extras.includes(maxExtra)) extras.push(maxExtra);
    [[0, 'Même durée'], ...extras.map((x) => [x, `+${x} mois`])].forEach(([extra, label]) => {
      chip(dur, label, E.findTargetForDuration(loans, rate, current + extra), endLabel(current + extra), target, onPick);
    });
    const peak = Math.max(...E.baselineSchedule(smoothed).periods.map((p) => p.payment));
    REDUCTIONS.forEach((p) => {
      const value = ceilEuro(peak * (1 - p / 100));
      const sim = E.simulateSmoothing(loans, { rate, target: value });
      const title = sim.feasible ? endLabel(sim.duration) : 'Impossible : la modulation ne se rembourse pas';
      chip(red, `−${p} %`, value, title, target, onPick).classList.toggle('infeasible', !sim.feasible);
    });
  }

  const tile = (label, value, note = '') => `<div class="kpi"><div class="eyebrow">${label}</div><div class="after num">${value}</div><div class="before">${note}</div></div>`;

  function keyPoints(sim, base) {
    const done = Number.isFinite(sim.duration) && sim.everDrawn;
    const eq = sim.equivalent;
    const extra = done ? sim.duration - base.duration : NaN;
    $('#keypoints').innerHTML = [
      tile('Durée totale', done ? `${sim.duration} mois` : `${base.duration} mois`, years(done ? sim.duration : base.duration)),
      tile('Durée ajoutée', done ? `+${extra} mois` : '—', done ? years(extra) : ''),
      tile('Taux du plan', done && eq.rate !== null ? pct2(eq.rate) : '—', done && eq.rate !== null ? `actuariel ${pct2(E.actuarialRate(eq.rate))}` : 'taux implicite'),
      tile('Intérêts', done ? eur(sim.lineInterest) : '—', `modulation à ${sim.rate} %`),
      tile('Décaissement', done ? eur(eq.disbursed) : '—', done ? `tiré sur ${eq.drawMonths} mois` : ''),
    ].join('');
  }

  function charts(sim, base) {
    const count = Math.max(sim.months.length, base.duration, 2);
    const pick = (rows, key) => Array.from({ length: count }, (_, i) => rows[i]?.[key] ?? 0);
    root.Charts.draw($('#chart-payments'), [
      { label: 'Situation actuelle', values: pick(base.months, 'total'), color: 'var(--before)', bars: true },
      { label: 'Plan lissé', values: pick(sim.months, 'totalPaid'), color: 'var(--after)', bars: true },
    ], count, eur);
    const n = Math.max(sim.months.length, 2);
    root.Charts.draw($('#chart-balance'), [
      { label: 'Encours de la modulation', values: sim.months.map((m) => m.lineBalance), color: 'var(--credit)', area: true },
    ], n, eur, { floor: 100_000 });
    root.Charts.draw($('#chart-draws'), [
      { label: 'Tirage du mois', values: sim.months.map((m) => Math.max(-m.lineFlow, 0)), color: 'var(--after)', bars: true },
    ], n, eur, { floor: 10_000, height: 130 });
  }

  // Nominal vs actuarial rates of each loan, the current situation, the line and the smoothed plan.
  function rates(rows, sim, loans) {
    const done = sim.feasible && sim.everDrawn;
    const nameOf = (id) => loans.find((l) => l.id === id)?.name ?? id;
    const LABEL = { current: 'Situation actuelle', line: 'Modulation', plan: 'Plan lissé' };
    const shown = rows.filter((r) => done || (r.kind !== 'line' && r.kind !== 'plan'));
    const rate = (x) => (x === null ? '—' : pct2(x));
    table($('#table-rates'), [['Taux'], ['Nominal', 'num'], ['Actuariel', 'num'], ['Intérêts', 'num'], ['Durée', 'num']], shown.map((r) => [
      r.kind === 'loan' ? nameOf(r.id) : `<b>${LABEL[r.kind]}</b>`,
      rate(r.nominal), rate(r.actuarial), eur(r.interest), r.months === null ? '—' : months(r.months),
    ]));
    const current = rows.find((r) => r.kind === 'current');
    const plan = rows.find((r) => r.kind === 'plan');
    const delta = done && current.actuarial !== null && plan.actuarial !== null ? plan.actuarial - current.actuarial : null;
    $('#rates-delta').textContent = delta === null ? '' : `Plan lissé ${delta >= 0 ? '+' : '−'}${pct2(Math.abs(delta)).replace(' %', ' pt')} actuariel`;
  }

  const MODE_LABEL = { draw: 'Tirage', repay: 'Remboursement', none: 'Neutre' };

  function afterTable(sim) {
    const head = [['Phase'], ['Dates'], ['Mois', 'num'], ['Crédits lissés', 'num'], ['Modulation', 'num'], ['Encours modulation', 'num']];
    if (sim.hasExcluded) head.push(['Hors lissage', 'num'], ['Total', 'num']);
    const rows = sim.periods.map((p, i) => {
      const flow = p.lineFlow < 0 ? `−${eur2(-p.lineFlow)} / mois` : `${eur2(p.lineFlow)} / mois`;
      const trend = p.lineFlow > 0 && p.mode === 'draw' ? `<br><span class="small muted">intérêts ${eur(p.lineInterestStart)} → ${eur(p.lineInterestEnd)} / mois</span>` : '';
      const row = [
        `Phase ${i + 1} <span class="tag ${p.mode}">${MODE_LABEL[p.mode]}</span>`, `${monthLabel(p.from)} → ${monthLabel(p.to)}`, `${p.months}`,
        eur2(p.loansPayment), flow, `${eur(p.balanceStart)} → ${eur(p.balanceEnd)}${trend}`,
      ];
      if (sim.hasExcluded) row.push(eur2(p.excludedPayment), eur2(p.totalNominal));
      return row;
    });
    table($('#table-after'), head, rows);
  }

  function monthsTable(sim) {
    const head = [['#', 'num'], ['Mois'], ['Crédits lissés', 'num'], ['Intérêts modulation', 'num'], ['Flux modulation', 'num'], ['Encours modulation', 'num']];
    if (sim.hasExcluded) head.push(['Hors lissage', 'num']);
    head.push(['Total payé', 'num']);
    const rows = sim.months.map((m, i) => {
      const row = [`${i + 1}`, monthLabel(i), eur2(m.loansPayment), eur2(m.lineInterest), eur2(m.lineFlow), eur2(m.lineBalance)];
      if (sim.hasExcluded) row.push(eur2(m.excludedPayment));
      row.push(eur2(m.totalPaid));
      return row;
    });
    table($('#table-months'), head, rows);
  }

  root.Render = { status, suggestions, keyPoints, rates, charts, afterTable, monthsTable };
})(window);
