// Advanced loan editor: explicit rate, deferred start, stepped schedule, closing mode.
(function (root) {
  'use strict';
  const E = root.Engine;
  const { eur, eur2, monthLabel, round } = root.Fmt;
  const dialog = document.getElementById('loan-dialog');
  const $ = (sel) => dialog.querySelector(sel);
  let draft = null;
  let onApply = null;

  const numField = (id, label, unit, value, step = 1) => `
    <div class="field"><label for="${id}">${label}</label>
      <div class="unit"><input id="${id}" type="number" min="0" step="${step}" value="${value}"><span>${unit}</span></div></div>`;

  function segmentRow(seg, i) {
    return `<div class="segment" data-index="${i}">
      <span class="muted small">Palier ${i + 1}</span>
      <div class="unit"><input type="number" min="1" step="1" data-seg="months" value="${seg.months}" aria-label="Nombre d'échéances"><span>éch.</span></div>
      <span class="muted">×</span>
      <div class="unit"><input type="number" min="0" step="10" data-seg="payment" value="${round(seg.payment)}" aria-label="Mensualité"><span>€</span></div>
      <button type="button" class="ghost" data-remove-seg title="Supprimer le palier" ${draft.segments.length > 1 ? '' : 'disabled'}>✕</button>
    </div>`;
  }

  function renderForm() {
    $('#dlg-name').textContent = draft.name;
    $('#dlg-fields').innerHTML = numField('dlg-capital', 'Capital restant dû', '€', draft.capital, 100)
      + numField('dlg-rate', 'Taux annuel', '%', round(draft.rate, 3), 0.01)
      + numField('dlg-offset', 'Démarre dans', 'mois', draft.startOffset, 1);
    $('#dlg-segments').innerHTML = draft.segments.map(segmentRow).join('');
    $(`input[name="closing"][value="${draft.closing}"]`).checked = true;
    renderPreview();
  }

  function renderPreview() {
    const s = E.schedule(E.fromEuros(draft));
    const el = $('#dlg-preview');
    if (!s.valid) {
      el.className = 'preview invalid';
      el.textContent = s.reason === 'payment_below_interest'
        ? 'La dernière mensualité ne couvre pas les intérêts : le capital ne sera jamais remboursé. Augmentez-la ou choisissez une échéance de clôture.'
        : 'Le remboursement dépasse 50 ans.';
      return;
    }
    const paying = s.duration - s.startOffset;
    el.className = 'preview';
    el.innerHTML = `
      <div><span class="eyebrow">Échéances</span><b class="num">${paying}</b> <span class="muted small">${s.startOffset ? `après ${s.startOffset} mois d'attente · ` : ''}fin ${monthLabel(s.duration - 1)}</span></div>
      <div><span class="eyebrow">Mensualité moyenne</span><b class="num">${eur2(s.avgPayment)}</b></div>
      <div><span class="eyebrow">Dernière échéance</span><b class="num">${eur2(s.lastPayment)}</b> <span class="muted small">${draft.closing === 'balloon' ? 'solde restant' : 'dernière mensualité ajustée'}</span></div>
      <div><span class="eyebrow">Intérêts</span><b class="num">${eur(s.interest)}</b></div>`;
  }

  function readForm() {
    draft.capital = Number($('#dlg-capital').value) || 0;
    draft.rate = Number($('#dlg-rate').value) || 0;
    draft.startOffset = Math.max(0, Math.round(Number($('#dlg-offset').value) || 0));
    draft.segments = [...dialog.querySelectorAll('.segment')].map((row) => ({
      months: Math.max(1, Math.round(Number(row.querySelector('[data-seg="months"]').value) || 1)),
      payment: Number(row.querySelector('[data-seg="payment"]').value) || 0,
    }));
    draft.closing = $('input[name="closing"]:checked').value;
  }

  dialog.addEventListener('input', () => { readForm(); renderPreview(); });
  dialog.addEventListener('click', (e) => {
    const remove = e.target.closest('[data-remove-seg]');
    if (remove) {
      readForm();
      draft.segments.splice(Number(remove.closest('.segment').dataset.index), 1);
      renderForm();
    }
  });
  $('#dlg-add-seg').addEventListener('click', () => {
    readForm();
    const last = draft.segments[draft.segments.length - 1];
    draft.segments.push({ months: 12, payment: last.payment });
    renderForm();
  });
  $('#dlg-apply').addEventListener('click', () => { readForm(); onApply({ ...draft, advanced: true }); dialog.close(); });
  $('#dlg-simple').addEventListener('click', () => { readForm(); onApply({ ...draft, advanced: false }); dialog.close(); });
  $('#dlg-cancel').addEventListener('click', () => dialog.close());

  function open(loan, apply) {
    draft = structuredClone(loan);
    onApply = apply;
    renderForm();
    dialog.showModal();
  }

  root.LoanDialog = { open };
})(window);
