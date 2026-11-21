// Tiny dependency-free SVG charts with hover tooltips.
import { todStr } from './util.js';

const M = { l: 36, r: 12, t: 14, b: 24 };

function frame(el, h) {
  const w = Math.max(el.clientWidth || 600, 280);
  return { w, h, iw: w - M.l - M.r, ih: h - M.t - M.b };
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function xAxis(f, x0, x1, sx) {
  const span = x1 - x0;
  const step = span > 900 ? 240 : span > 480 ? 120 : 60;
  let s = '';
  for (let t = Math.ceil(x0 / step) * step; t <= x1; t += step) {
    s += `<text x="${sx(t)}" y="${f.h - 6}" text-anchor="middle">${todStr(t)}</text>`;
  }
  return s;
}

function yAxis(f, ymax, sy, fmt) {
  let s = '';
  for (let i = 0; i <= 4; i++) {
    const v = (ymax * i) / 4;
    const y = sy(v);
    s += `<line class="gridline" x1="${M.l}" x2="${f.w - M.r}" y1="${y}" y2="${y}"/>`;
    s += `<text x="${M.l - 6}" y="${y + 3.5}" text-anchor="end">${fmt(v)}</text>`;
  }
  return s;
}

function attachHover(el, f, xs, sx, render) {
  const svg = el.querySelector('svg');
  const tip = el.querySelector('.chart-tip');
  const cursor = el.querySelector('.hover-line');
  const move = ev => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left) * (f.w / rect.width);
    let best = 0, bd = Infinity;
    xs.forEach((x, i) => { const d = Math.abs(sx(x) - px); if (d < bd) { bd = d; best = i; } });
    const { html, y } = render(best);
    if (!html) { tip.style.opacity = 0; cursor.style.opacity = 0; return; }
    const X = sx(xs[best]);
    tip.innerHTML = html;
    tip.style.left = `${(X / f.w) * 100}%`;
    tip.style.top = `${(y / f.h) * 100}%`;
    tip.style.opacity = 1;
    cursor.setAttribute('x1', X); cursor.setAttribute('x2', X);
    cursor.style.opacity = 1;
  };
  const leave = () => { tip.style.opacity = 0; cursor.style.opacity = 0; };
  svg.addEventListener('mousemove', move);
  svg.addEventListener('touchmove', move, { passive: true });
  svg.addEventListener('mouseleave', leave);
  svg.addEventListener('touchend', leave);
}

/** Median line with an uncertainty band. data: [{tod, med, lo, hi}] (seconds). */
export function bandChart(el, data, { marker = null, height = 200, unit = 60, unitLabel = '分' } = {}) {
  const pts = data.filter(d => d.med != null);
  if (!pts.length) { el.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  const f = frame(el, height);
  const x0 = pts[0].tod, x1 = pts[pts.length - 1].tod || 1;
  const ymax = niceMax(Math.max(...pts.map(d => d.hi)) / unit) * unit;
  const sx = x => M.l + ((x - x0) / Math.max(x1 - x0, 1)) * f.iw;
  const sy = y => M.t + f.ih - (y / ymax) * f.ih;
  const line = pts.map((d, i) => `${i ? 'L' : 'M'}${sx(d.tod).toFixed(1)},${sy(d.med).toFixed(1)}`).join('');
  const band = pts.map((d, i) => `${i ? 'L' : 'M'}${sx(d.tod).toFixed(1)},${sy(d.hi).toFixed(1)}`).join('')
    + pts.slice().reverse().map(d => `L${sx(d.tod).toFixed(1)},${sy(d.lo).toFixed(1)}`).join('') + 'Z';
  let mk = '';
  if (marker != null && marker >= x0 && marker <= x1) {
    const near = pts.reduce((a, b) => Math.abs(b.tod - marker) < Math.abs(a.tod - marker) ? b : a);
    mk = `<line class="marker" x1="${sx(marker)}" x2="${sx(marker)}" y1="${M.t}" y2="${M.t + f.ih}"/>
          <circle class="marker-dot" cx="${sx(near.tod)}" cy="${sy(near.med)}" r="5"/>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${f.w} ${f.h}" preserveAspectRatio="none">
      <g class="axis">${yAxis(f, ymax, sy, v => Math.round(v / unit))}${xAxis(f, x0, x1, sx)}</g>
      <path class="band" d="${band}"/>
      <path class="line" d="${line}"/>
      ${mk}
      <line class="marker hover-line" y1="${M.t}" y2="${M.t + f.ih}" style="opacity:0"/>
    </svg><div class="chart-tip"></div>`;
  attachHover(el, f, pts.map(d => d.tod), sx, i => ({
    html: `${todStr(pts[i].tod)} · ${Math.round(pts[i].med / unit)} ${unitLabel}<span style="opacity:.6;font-weight:500"> (${Math.round(pts[i].lo / unit)}–${Math.round(pts[i].hi / unit)})</span>`,
    y: sy(pts[i].hi),
  }));
}

/** Bars over the day. data: [{tod, y}] ; fmtTip(d) -> html */
export function barChart(el, data, { marker = null, height = 150, fmtY = v => v, fmtTip, width = 30 } = {}) {
  const pts = data.filter(d => d.y != null);
  if (!pts.some(d => d.y > 0)) { el.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  const nz = pts.filter(d => d.y > 0);
  const x0 = nz[0].tod, x1 = nz[nz.length - 1].tod + width;
  const f = frame(el, height);
  const ymax = niceMax(Math.max(...pts.map(d => d.y)));
  const sx = x => M.l + ((x - x0) / Math.max(x1 - x0, 1)) * f.iw;
  const sy = y => M.t + f.ih - (y / ymax) * f.ih;
  const bw = Math.max(((width / (x1 - x0)) * f.iw) - 2, 2);
  const shown = pts.filter(d => d.tod >= x0 && d.tod < x1);
  const bars = shown.map(d => {
    const cur = marker != null && marker >= d.tod && marker < d.tod + width;
    return `<rect class="bar ${marker != null && !cur ? 'dim' : ''}" x="${sx(d.tod) + 1}" y="${sy(d.y)}" width="${bw}" height="${Math.max(M.t + f.ih - sy(d.y), 0)}" rx="3"/>`;
  }).join('');
  el.innerHTML = `<svg viewBox="0 0 ${f.w} ${f.h}" preserveAspectRatio="none">
      <g class="axis">${yAxis(f, ymax, sy, fmtY)}${xAxis(f, x0, x1, sx)}</g>
      ${bars}
      <line class="marker hover-line" y1="${M.t}" y2="${M.t + f.ih}" style="opacity:0"/>
    </svg><div class="chart-tip"></div>`;
  attachHover(el, f, shown.map(d => d.tod + width / 2), sx, i => ({
    html: fmtTip ? fmtTip(shown[i]) : `${todStr(shown[i].tod)} · ${shown[i].y}`,
    y: sy(shown[i].y),
  }));
}

/** Congestion colour for a slowdown ratio (1 = free flow). */
export function heatColor(r) {
  const stops = [[1.0, [209, 250, 229]], [1.25, [253, 230, 138]], [1.5, [251, 146, 60]], [1.9, [239, 68, 68]], [2.5, [153, 27, 27]]];
  if (r <= stops[0][0]) return `rgb(${stops[0][1]})`;
  for (let i = 1; i < stops.length; i++) {
    if (r <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      const t = (r - a) / (b - a);
      return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * t)).join(',')})`;
    }
  }
  return `rgb(${stops[stops.length - 1][1]})`;
}

export function congColor(f) {
  if (f == null) return 'var(--line-strong)';
  if (f < 1.12) return 'var(--good)';
  if (f < 1.35) return 'var(--warn)';
  return 'var(--bad)';
}
