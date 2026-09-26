// Target payment scale: a vertical slider over the range allowed by the policy, shortcuts as marks.
// Highest payment at the top. The scale is graduated in plan duration, not in euros: the span
// between the highest payment and the same-duration target is squeezed into the top share; below
// it, positions are proportional to the extra months, so the +12m, +24m… marks are evenly spaced.
(function (root) {
  'use strict';
  const E = root.Engine;
  const C = root.Config;
  const { eur, years, monthLabel } = root.Fmt;
  const $ = (sel) => document.querySelector(sel);
  const STEPS = 1000;
  const ceilEuro = (cents) => Math.ceil(cents / 100) * 100;
  const roundEuro = (cents) => Math.round(cents / 100) * 100;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const smoothedOf = (loans) => loans.filter((l) => l.enabled !== false);
  const peakOf = (loans) => Math.max(0, ...E.baselineSchedule(loans).periods.map((p) => p.payment));

  // Longest plan the policy allows: never shorter than the current one.
  const limitOf = (current) => Math.max(current, Math.min(current + C.MAX_EXTRA_MONTHS, C.MAX_TOTAL_MONTHS));

  // Same duration, every step, and the policy limit, each with the target that reaches it.
  function durationPoints(loans, rate, current, limit) {
    const span = limit - current;
    const extras = Array.from({ length: Math.floor(span / C.EXTRA_STEP_MONTHS) + 1 }, (_, k) => k * C.EXTRA_STEP_MONTHS);
    if (extras[extras.length - 1] !== span) extras.push(span);
    return extras.map((extra) => ({ extra, value: ceilEuro(E.findTargetForDuration(loans, rate, current + extra)) }));
  }

  // Piecewise-linear map between target (cents, decreasing) and position (0 top .. 1 bottom).
  function scaleOf(peak, points, span) {
    const top = span ? C.SCALE_TOP_SHARE : 1;
    const anchors = [{ value: peak, pos: 0 }, ...points.map((p) => ({ value: p.value, pos: top + (span ? (p.extra / span) * (1 - top) : 0) }))]
      .filter((a, i, all) => i === 0 || a.value < all[i - 1].value);
    const last = anchors[anchors.length - 1];
    const interpolate = (x, from, to) => {
      const k = Math.max(1, anchors.findIndex((a) => (from === 'pos' ? a.pos >= x : a.value <= x)));
      const a = anchors[k - 1];
      const b = anchors[k] ?? a;
      return b === a ? a[to] : a[to] + ((x - a[from]) / (b[from] - a[from])) * (b[to] - a[to]);
    };
    return {
      min: last.value,
      posOf: (v) => interpolate(clamp(v, last.value, peak), 'value', 'pos'),
      valueOf: (p) => interpolate(clamp(p, 0, last.pos), 'pos', 'value'),
    };
  }

  function shortcuts(loans, rate, points, limit, peak) {
    const candidates = [
      ...points.filter((p) => p.extra % C.EXTRA_STEP_MONTHS === 0)
        .map((p) => ({ kind: 'duration', label: p.extra ? `+${p.extra} mois` : 'Même durée', short: p.extra ? `+${p.extra}m` : 'Même', value: p.value })),
      ...C.REDUCTION_PCTS.map((p) => ({ kind: 'reduction', label: `−${p} %`, short: `−${p}%`, value: ceilEuro(peak * (1 - p / 100)) })),
    ];
    return candidates
      .map((s) => ({ ...s, sim: E.simulateSmoothing(loans, { rate, target: s.value }) }))
      .filter((s) => s.sim.feasible && s.sim.duration <= limit);
  }

  const markHtml = (s, at, target) => `
    <button type="button" class="mark ${s.kind}" style="--at: ${at(s.value)}" data-value="${s.value}" aria-pressed="${s.value === target}" aria-label="${s.label} : ${eur(s.value)}">${s.short}
      <span class="tip"><b>${s.label}</b> · ${eur(s.value)}<br>fin ${monthLabel(s.sim.duration - 1)} (${years(s.sim.duration)})</span>
    </button>`;

  let scale = null;

  function update(loans, rate, target) {
    const host = $('#target-scale');
    const smoothed = smoothedOf(loans);
    host.hidden = !smoothed.length;
    if (host.hidden) return;
    const current = E.baselineSchedule(loans).duration;
    const limit = limitOf(current);
    const peak = ceilEuro(peakOf(smoothed));
    const points = durationPoints(loans, rate, current, limit);
    scale = scaleOf(peak, points, limit - current);
    const at = (v) => scale.posOf(v).toFixed(4);
    $('#target-range').value = Math.round(scale.posOf(target) * STEPS);
    const bubble = $('#target-bubble');
    bubble.style.setProperty('--at', at(target));
    bubble.textContent = eur(target);
    $('#target-marks').innerHTML = shortcuts(loans, rate, points, limit, peak).map((s) => markHtml(s, at, target)).join('');
    $('#scale-max').textContent = `${eur(peak)} · mensualité max`;
    $('#scale-min').textContent = `${eur(scale.min)} · plan de ${years(limit)}`;
  }

  // onPick receives a target in cents.
  function init(onPick) {
    const range = $('#target-range');
    range.max = STEPS;
    range.addEventListener('input', () => { if (scale) onPick(roundEuro(scale.valueOf(Number(range.value) / STEPS))); });
    $('#target-marks').addEventListener('click', (e) => {
      const mark = e.target.closest('[data-value]');
      if (mark) onPick(Number(mark.dataset.value));
    });
  }

  root.TargetScale = { init, update };
})(window);
