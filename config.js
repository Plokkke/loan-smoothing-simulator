// Smoothing policy: which target shortcuts are offered, and the range of the target scale.
(function (root) {
  'use strict';
  root.Config = Object.freeze({
    EXTRA_STEP_MONTHS: 12, // duration shortcuts: same duration, +12, +24, … months
    MAX_EXTRA_MONTHS: 84, // no shortcut extends the plan by more than 7 years…
    MAX_TOTAL_MONTHS: 240, // …nor beyond 20 years in total
    REDUCTION_PCTS: [10, 20, 30], // cuts of the highest monthly payment, same limits apply
    SCALE_TOP_SHARE: 0.15, // share of the target scale between the highest payment and "same duration"
  });
})(window);
