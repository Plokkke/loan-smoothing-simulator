// Minimal SVG charts (bars, lines, steps, areas) on a shared band scale, with a hover tooltip.
(function (root) {
  'use strict';
  const { eur2, monthLabel } = root.Fmt;
  const W = 720, PAD = { l: 64, r: 36, t: 12, b: 28 };

  function niceStep(raw) {
    const pow = 10 ** Math.floor(Math.log10(raw || 1));
    // Tolerance: an adjusting instalment one cent above a round value must not bump the scale.
    const n = raw / pow - 1e-3;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  }

  function yTicks(max) {
    const step = niceStep(max / 4);
    const ticks = [];
    for (let v = 0; v <= max + step; v += step) ticks.push(v);
    return { ticks, max: ticks[ticks.length - 1] };
  }

  // Band scale: month i owns [x0(i), x0(i + 1)], point marks sit at its centre.
  function scales(count, max, H) {
    const slot = (W - PAD.l - PAD.r) / count;
    const x0 = (i) => PAD.l + i * slot;
    return { slot, x0, xc: (i) => x0(i) + slot / 2, y: (v) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b) };
  }

  const f = (n) => n.toFixed(1);
  const linePath = (s, sc) => s.values.map((v, i) => `${i ? 'L' : 'M'}${f(sc.xc(i))},${f(sc.y(v))}`).join(' ');
  const stepPath = (s, sc) => s.values.map((v, i) => `${i ? 'L' : 'M'}${f(sc.x0(i))},${f(sc.y(v))} L${f(sc.x0(i + 1))},${f(sc.y(v))}`).join(' ');

  function bars(s, k, n, sc) {
    const gap = Math.min(2, sc.slot * 0.25);
    const w = (sc.slot - gap) / n;
    return s.values.map((v, i) => (v > 0
      ? `<rect x="${f(sc.x0(i) + gap / 2 + k * w)}" y="${f(sc.y(v))}" width="${f(w)}" height="${f(sc.y(0) - sc.y(v))}" fill="${s.color}"/>`
      : '')).join('');
  }

  function marks(series, sc) {
    const barSeries = series.filter((s) => s.bars);
    return series.map((s) => {
      if (s.bars) return `<g shape-rendering="crispEdges">${bars(s, barSeries.indexOf(s), barSeries.length, sc)}</g>`;
      const d = s.step ? stepPath(s, sc) : linePath(s, sc);
      const last = s.values.length;
      const area = s.area ? `<path d="${d} L${f(s.step ? sc.x0(last) : sc.xc(last - 1))},${f(sc.y(0))} L${f(s.step ? sc.x0(0) : sc.xc(0))},${f(sc.y(0))} Z" fill="${s.color}" opacity="0.15"/>` : '';
      return `${area}<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    }).join('');
  }

  function draw(host, series, count, fmt, { floor = 1, height = 240 } = {}) {
    const H = height;
    const { ticks, max } = yTicks(Math.max(floor, ...series.flatMap((s) => s.values)));
    const sc = scales(count, max, H);
    const xTicks = Array.from({ length: Math.min(count, 8) }, (_, k) => Math.round((k / Math.min(count - 1, 7)) * (count - 1)));
    host.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img">
        <g class="grid">${ticks.map((t) => `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${sc.y(t)}" y2="${sc.y(t)}"/>`).join('')}</g>
        <g class="axis">${ticks.map((t) => `<text x="${PAD.l - 8}" y="${sc.y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('')}
          ${xTicks.map((i) => `<text x="${sc.xc(i)}" y="${H - 8}" text-anchor="middle">${monthLabel(i)}</text>`).join('')}</g>
        ${marks(series, sc)}
        <line class="zero" x1="${PAD.l}" x2="${W - PAD.r}" y1="${sc.y(0)}" y2="${sc.y(0)}"/>
        <line class="cursor" x1="0" x2="0" y1="${PAD.t}" y2="${sc.y(0)}"/>
        <rect class="hit" x="${PAD.l}" y="${PAD.t}" width="${W - PAD.l - PAD.r}" height="${H - PAD.t - PAD.b}"/>
      </svg><div class="tooltip"></div>`;
    bindHover(host, series, count, sc);
  }

  function bindHover(host, series, count, sc) {
    const svg = host.querySelector('svg');
    const cursor = host.querySelector('.cursor');
    const tip = host.querySelector('.tooltip');
    svg.addEventListener('mousemove', (ev) => {
      const rect = svg.getBoundingClientRect();
      const scale = W / rect.width;
      const px = (ev.clientX - rect.left) * scale;
      const i = Math.max(0, Math.min(count - 1, Math.floor((px - PAD.l) / sc.slot)));
      cursor.setAttribute('x1', sc.xc(i)); cursor.setAttribute('x2', sc.xc(i)); cursor.style.opacity = 1;
      tip.innerHTML = `<div>${monthLabel(i)} · mois ${i + 1}</div>` + series.map((s) => `<div>${s.label} : <b>${eur2(s.values[i] ?? 0)}</b></div>`).join('');
      tip.style.left = `${sc.xc(i) / scale}px`;
      tip.style.top = `${Math.max(0, PAD.t / scale - 8)}px`;
      tip.style.opacity = 1;
    });
    svg.addEventListener('mouseleave', () => { cursor.style.opacity = 0; tip.style.opacity = 0; });
  }

  root.Charts = { draw };
})(window);
