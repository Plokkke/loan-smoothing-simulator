// Results rendering: status, key points, plan and schedule tables, charts.
(function (root) {
  'use strict';
  const E = root.Engine;
  const { eur, eur2, pct2, years, monthLabel } = root.Fmt;
  const $ = (sel) => document.querySelector(sel);

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

  const tile = (label, value, note = '') => `<div class="kpi"><div class="eyebrow">${label}</div><div class="after num">${value}</div><div class="before">${note}</div></div>`;

  function keyPoints(sim, base) {
    const done = Number.isFinite(sim.duration) && sim.everDrawn;
    const eq = sim.equivalent;
    const extra = done ? sim.duration - base.duration : NaN;
    const peak = Math.max(0, ...sim.smoothed.periods.map((p) => p.payment));
    const cut = peak - sim.target;
    $('#keypoints').innerHTML = [
      tile('Baisse mensuelle', done && cut > 0 ? `−${eur(cut)}` : '—', done && cut > 0 ? `−${Math.round((cut / peak) * 100)} % de ${eur(peak)}` : ''),
      tile('Durée totale', done ? `${sim.duration} mois` : `${base.duration} mois`, years(done ? sim.duration : base.duration)),
      tile('Durée ajoutée', done ? `+${extra} mois` : '—', done ? years(extra) : ''),
      tile('Taux moyen', done && eq.rate !== null ? pct2(eq.rate) : '—', 'taux implicite du plan'),
      tile('Intérêts', done ? eur(sim.lineInterest) : '—', `modulation à ${String(sim.rate).replace('.', ',')} %`),
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

  const MODE_LABEL = { draw: 'Tirage', repay: 'Remboursement', none: 'Neutre' };
  const TREND = { draw: '↗', repay: '↘', none: '→' };

  function afterTable(sim) {
    const head = [['Mois', 'num'], ['Fin'], ['Crédits lissés', 'num'], ['Modulation', 'num']];
    if (sim.hasExcluded) head.push(['Hors lissage', 'num'], ['Total', 'num']);
    head.push(['Encours début', 'num'], ['', 'trend'], ['Encours fin', 'num']);
    const rows = sim.periods.map((p) => {
      const flow = p.lineFlow < 0 ? `−${eur2(-p.lineFlow)}` : eur2(p.lineFlow);
      const interest = p.lineFlow > 0 && p.mode === 'draw' ? `<br><span class="small muted">intérêts ${eur(p.lineInterestStart)} → ${eur(p.lineInterestEnd)}</span>` : '';
      const row = [`${p.months}`, monthLabel(p.to), eur2(p.loansPayment), `${flow}${interest}`];
      if (sim.hasExcluded) row.push(eur2(p.excludedPayment), eur2(p.totalNominal));
      row.push(eur(p.balanceStart), `<span class="${p.mode}" title="${MODE_LABEL[p.mode]}">${TREND[p.mode]}</span>`, eur(p.balanceEnd));
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

  root.Render = { status, keyPoints, charts, afterTable, monthsTable };
})(window);
