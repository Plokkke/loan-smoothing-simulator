// State, editable loans table and wiring.
(function (root) {
  'use strict';
  const E = root.Engine;
  const { eur2, pct, round, monthLabel } = root.Fmt;
  const R = root.Render;
  const $ = (sel) => document.querySelector(sel);

  const STORAGE_KEY = 'lissage-mensualites/v2';
  const LEGACY_KEY = 'lissage-mensualites/v1';
  // ?nostore : ne lit ni n'écrit le stockage (tests, démo).
  const PERSIST = !new URLSearchParams(location.search).has('nostore');
  const LOAN_FIELDS = ['id', 'name', 'enabled', 'advanced', 'capital', 'months', 'payment', 'rate', 'startOffset', 'segments', 'closing'];
  const simpleLoan = (id, name, capital, months, payment) => ({
    id, name, enabled: true, advanced: false, capital, months, payment, rate: 0, startOffset: 0, segments: [{ months, payment }], closing: 'continue',
  });
  const DEFAULT_STATE = {
    loans: [
      simpleLoan('A', 'Résidence principale', 183237.32, 164, 1237.24),
      simpleLoan('B', 'Investissement locatif', 86499.17, 143, 678.36),
      simpleLoan('C', 'Automobile', 13366.5, 49, 293.14),
    ],
    nextId: 4,
    line: { rate: 4.75, target: 1592 },
  };

  // v1 stored { capital, months, payment, enabled } per loan and { rate, target, start } for the line.
  function migrateLegacy(old) {
    return {
      loans: old.loans.map((l) => ({ ...simpleLoan(l.id, l.name, l.capital, l.months, l.payment), enabled: l.enabled !== false })),
      nextId: old.nextId ?? old.loans.length + 1,
      line: { rate: old.line.rate, target: old.line.target },
    };
  }
  function readKey(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
  }
  function loadState() {
    if (!PERSIST) return structuredClone(DEFAULT_STATE);
    const saved = readKey(STORAGE_KEY);
    if (saved?.loans && saved?.line) return saved;
    const legacy = readKey(LEGACY_KEY);
    if (legacy?.loans && legacy?.line) return migrateLegacy(legacy);
    return structuredClone(DEFAULT_STATE);
  }
  // Persisted / exported shape: inputs only, derived fields dropped.
  const serialize = () => ({
    loans: state.loans.map((l) => Object.fromEntries(LOAN_FIELDS.map((k) => [k, l[k]]))),
    nextId: state.nextId,
    line: { ...state.line },
  });
  function saveState() {
    if (!PERSIST) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize())); } catch (_) { /* ignore */ }
  }

  // Keeps the derived fields of a loan consistent with its mode.
  function normalize(loan) {
    if (loan.advanced) {
      loan.summary = E.schedule(E.fromEuros(loan));
      loan.valid = loan.summary.valid && loan.capital > 0;
    } else {
      const rate = E.rateFor(loan.capital, loan.months, loan.payment);
      loan.valid = rate !== null && loan.capital > 0;
      loan.rate = rate ?? 0;
      loan.startOffset = 0;
      loan.segments = [{ months: loan.months, payment: loan.payment }];
      loan.closing = 'continue';
    }
    return loan;
  }

  const state = loadState();
  state.loans.forEach(normalize);

  // ---------- editable loans table ----------
  const HEAD = ['', 'Crédit', 'Capital restant dû', 'Échéances', 'Mensualité', 'Taux annuel', '', ''];
  const numInput = (loan, key, step, unit) => `<div class="unit"><input id="${key}-${loan.id}" data-field="${key}" type="number" step="${step}" min="0" value="${round(loan[key])}" aria-label="${key}"><span>${unit}</span></div>`;
  const out = (value, note = '') => `<output class="num">${value}</output>${note ? `<div class="small muted">${note}</div>` : ''}`;

  function loanCells(loan) {
    if (!loan.advanced) {
      return [numInput(loan, 'capital', 100, '€'), numInput(loan, 'months', 1, 'mois'), numInput(loan, 'payment', 10, '€'),
        `<output class="rate num ${loan.valid ? '' : 'invalid'}">${loan.valid ? pct(loan.rate) : 'mensualité insuffisante'}</output>`];
    }
    const s = loan.summary;
    const capital = out(eur2(E.toCents(loan.capital)));
    if (!loan.valid) return [capital, out('—'), out('—'), '<output class="rate num invalid">échéancier invalide</output>'];
    const paying = s.duration - s.startOffset;
    return [
      capital,
      out(`${paying}`, loan.startOffset ? `démarre ${monthLabel(loan.startOffset)}` : `${loan.segments.length} palier${loan.segments.length > 1 ? 's' : ''}`),
      out(eur2(s.avgPayment), loan.closing === 'balloon' ? `clôture ${eur2(s.lastPayment)}` : 'moyenne'),
      out(pct(loan.rate)),
    ];
  }

  function loanRow(loan) {
    const tr = document.createElement('tr');
    tr.className = `${loan.enabled ? '' : 'off'} ${loan.advanced ? 'advanced' : ''}`;
    const cells = [
      `<label class="switch" title="${loan.enabled ? 'Sortir du lissage' : 'Inclure dans le lissage'}"><input id="on-${loan.id}" type="checkbox" ${loan.enabled ? 'checked' : ''}><span></span></label>`,
      `<input id="name-${loan.id}" data-field="name" type="text" value="${loan.name}" aria-label="Nom du crédit">${loan.enabled ? '' : '<div class="small muted">hors lissage</div>'}`,
      ...loanCells(loan),
      `<button class="ghost small" type="button" data-advanced title="Début différé, paliers, clôture">${loan.advanced ? 'Avancé ●' : 'Avancé'}</button>`,
      `<button class="ghost" type="button" data-remove title="Supprimer">✕</button>`,
    ];
    tr.innerHTML = cells.map((c, i) => `<td class="${i >= 2 && i <= 5 ? 'num' : ''}">${c}</td>`).join('');
    tr.addEventListener('input', (e) => onLoanInput(loan, e.target));
    tr.querySelector(`#on-${loan.id}`).addEventListener('change', (e) => { loan.enabled = e.target.checked; renderLoans(); update(); });
    tr.querySelector('[data-remove]').addEventListener('click', () => { state.loans = state.loans.filter((l) => l !== loan); renderLoans(); update(); });
    tr.querySelector('[data-advanced]').addEventListener('click', () => root.LoanDialog.open(loan, (draft) => applyDraft(loan, draft)));
    return tr;
  }

  function applyDraft(loan, draft) {
    Object.assign(loan, draft);
    if (!draft.advanced) {
      loan.months = draft.segments.reduce((s, seg) => s + seg.months, 0);
      loan.payment = round(draft.segments[0].payment);
    }
    normalize(loan);
    renderLoans();
    update();
  }

  function onLoanInput(loan, input) {
    const key = input.dataset.field;
    if (!key) return;
    if (key === 'name') loan.name = input.value;
    else {
      loan[key] = Number(input.value) || 0;
      normalize(loan);
      const rateOut = input.closest('tr').querySelector('.rate');
      rateOut.textContent = loan.valid ? pct(loan.rate) : 'mensualité insuffisante';
      rateOut.classList.toggle('invalid', !loan.valid);
    }
    update();
  }

  // Totals row: capital, and the highest monthly total (the effective maximum), each with its smoothed share.
  const peakPayment = (loans) => (loans.length ? Math.max(...E.baselineSchedule(loans).periods.map((p) => p.payment)) : 0);
  function totalCell(all, smoothed, label) {
    const note = smoothed !== all ? `<div class="small muted">dont lissé ${eur2(smoothed)}</div>` : `<div class="small muted">${label}</div>`;
    return `<td class="num"><b>${eur2(all)}</b>${note}</td>`;
  }
  function renderLoans() {
    const t = $('#table-loans');
    t.innerHTML = `<thead><tr>${HEAD.map((h, i) => `<th class="${i >= 2 && i <= 5 ? 'num' : ''}">${h}</th>`).join('')}</tr></thead><tbody></tbody>`;
    const body = t.querySelector('tbody');
    state.loans.forEach((loan) => body.appendChild(loanRow(loan)));
    t.appendChild(document.createElement('tfoot'));
  }
  // Rebuilt on every update: cell edits do not re-render the rows, to keep the focus.
  function renderTotals(loans) {
    const smoothed = loans.filter((l) => l.enabled);
    const sumCapital = (list) => list.reduce((s, l) => s + l.capital, 0);
    $('#table-loans tfoot').innerHTML = `<tr><td></td><td>Total</td>${totalCell(sumCapital(loans), sumCapital(smoothed), 'capital restant dû')}<td></td>${totalCell(peakPayment(loans), peakPayment(smoothed), 'mensualité max')}<td colspan="3"></td></tr>`;
  }

  $('#add-loan').addEventListener('click', () => {
    const id = String(state.nextId++);
    state.loans.push(normalize(simpleLoan(id, `Crédit ${id}`, 20000, 60, round(E.paymentFor(20000, 4, 60)))));
    renderLoans();
    update();
  });

  // ---------- results ----------
  function update() {
    saveState();
    const { rate } = state.line;
    const target = E.toCents(state.line.target);
    const valid = state.loans.filter((l) => l.valid);
    const loans = valid.map(E.fromEuros);
    const base = E.baselineSchedule(loans);
    const sim = E.simulateSmoothing(loans, { rate, target });
    renderTotals(loans);
    root.TargetScale.update(loans, rate, target);
    R.status(sim, loans, rate);
    R.keyPoints(sim, base);
    R.afterTable(sim);
    R.charts(sim, base);
    R.monthsTable(sim);
    root.Presets.sync();
  }

  const LINE_INPUTS = { '#line-rate': 'rate', '#line-target': 'target' };
  const syncLineInputs = () => Object.entries(LINE_INPUTS).forEach(([sel, key]) => { $(sel).value = state.line[key]; });
  Object.entries(LINE_INPUTS).forEach(([sel, key]) => {
    $(sel).addEventListener('input', (e) => { state.line[key] = Number(e.target.value) || 0; update(); });
  });

  // Replaces the whole working state (reset, scenario load, import).
  function setState(next) {
    Object.assign(state, structuredClone(next));
    state.loans.forEach(normalize);
    syncLineInputs();
    renderLoans();
    update();
  }
  $('#reset').addEventListener('click', () => setState(DEFAULT_STATE));
  root.TargetScale.init((cents) => { state.line.target = cents / 100; $('#line-target').value = state.line.target; update(); });
  root.Presets.init({ getState: serialize, setState, persist: PERSIST });

  syncLineInputs();
  renderLoans();
  update();
})(window);
