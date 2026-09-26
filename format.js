// Shared formatting helpers. Money arrives from the engine in integer cents.
(function (root) {
  'use strict';
  const fmtEur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const fmtEur2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // The plan always starts next month: month 0 is the first full month after today.
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  root.Fmt = {
    eur: (cents) => fmtEur.format(cents / 100),
    eur2: (cents) => fmtEur2.format(cents / 100),
    pct: (x) => `${x.toFixed(3).replace('.', ',')} %`,
    pct2: (x) => `${x.toFixed(2).replace('.', ',')} %`,
    months: (n) => (Number.isFinite(n) ? `${n} mois` : 'jamais'),
    years: (n) => {
      if (!Number.isFinite(n)) return '';
      const y = Math.floor(n / 12);
      const parts = [y ? `${y} an${y > 1 ? 's' : ''}` : '', n % 12 ? `${n % 12} mois` : ''].filter(Boolean);
      return parts.join(' ') || '0 mois';
    },
    // "MM/AAAA" of month i of the plan.
    monthLabel: (i) => {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    },
    round: (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d,
  };
})(window);
