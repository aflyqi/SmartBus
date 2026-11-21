import { api } from '../api.js';
import { $, $$, esc, icon, badge, todStr, macauNow, dayType, DAYTYPES } from '../util.js';
import { bandChart, heatColor } from '../charts.js';

export async function mount(el, { parts }) {
  const routes = (await api.routes()).routes;
  let route = parts[1] || null, dir = Number(parts[2] || 0);
  if (!route) {
    el.innerHTML = `
      <div class="page-head"><div><h1 class="page-title">路况洞察</h1><div class="page-sub">每条路线每段路、每个钟头的典型行车时间，找出最佳出行时段</div></div></div>
      <section class="card card-pad"><div class="route-grid">${routes.map(r => `
        <a class="route-tile" href="#/insights/${encodeURIComponent(r.route)}/${r.dirs[0].dir}">${badge(r.route, r.color)}<div class="to">${esc(r.dirs[0].from)} → ${esc(r.dirs[0].to)}</div></a>`).join('')}</div></section>`;
    return;
  }
  const r = routes.find(x => x.route === route);
  const m = macauNow();
  let dt = dayType(m.dow);
  el.innerHTML = `
    <div class="route-head">
      <a class="icon-btn" href="#/insights" title="返回">${icon('back')}</a>
      ${badge(route, r?.color, 'lg')}
      <div class="titles"><div class="to">路况洞察</div><div class="from">${r ? esc(r.dirs.find(x => x.dir === dir)?.from || '') + ' → ' + esc(r.dirs.find(x => x.dir === dir)?.to || '') : ''}</div></div>
      <div class="actions">
        ${r && r.dirs.length > 1 ? `<a class="btn" href="#/insights/${encodeURIComponent(route)}/${r.dirs.find(x => x.dir !== dir).dir}">${icon('swap')}<span class="hide-sm">对向</span></a>` : ''}
        <a class="btn" href="#/route/${encodeURIComponent(route)}/${dir}">${icon('bus')}<span class="hide-sm">实时</span></a>
      </div>
    </div>
    <div class="row" style="margin-bottom:16px"><div class="seg" id="dt">${DAYTYPES.map((n, i) => `<button data-dt="${i}" class="${i === dt ? 'active' : ''}">${n}</button>`).join('')}</div></div>
    <div class="stack">
      <section class="card card-pad">
        <div class="card-head"><div><div class="card-title">${icon('clock')}全程行车时间</div><div class="card-sub">由首站开出至尾站，按出发时间</div></div><div id="best" class="row wrap" style="gap:6px"></div></div>
        <div class="chart" id="full"></div>
      </section>
      <section class="card card-pad">
        <div class="card-head"><div><div class="card-title">${icon('map')}逐段挤塞热图</div><div class="card-sub">颜色 = 该段路相对其最畅顺时段慢了多少；悬停查看秒数</div></div></div>
        <div class="heat" id="heat"></div>
        <div class="heat-legend"><span>畅通</span><span class="scale"></span><span>慢 2.5 倍</span></div>
      </section>
    </div>`;

  const load = async () => {
    const d = await api.insights(route, dir, dt);
    const slotsWithService = d.full;
    bandChart($('#full'), slotsWithService, { marker: m.tod, height: 220 });
    const valid = d.full.filter(p => p.tod >= 360 && p.tod <= 1380);
    if (valid.length) {
      const best = valid.reduce((a, b) => b.med < a.med ? b : a);
      const worst = valid.reduce((a, b) => b.med > a.med ? b : a);
      $('#best').innerHTML = `<span class="chip good">最快 ${todStr(best.tod)} · ${Math.round(best.med / 60)} 分</span><span class="chip bad">最慢 ${todStr(worst.tod)} · ${Math.round(worst.med / 60)} 分</span>`;
    }
    const names = Object.fromEntries(d.stops.map(s => [s.code, s.name]));
    const sparse = d.map.filter(s => s.n >= 3).length < d.map.length / 2;
    if (sparse) $('#best').insertAdjacentHTML('afterbegin', '<span class="chip warn">数据累积中 · 部分为按距离推算</span>');
    const hours = [...Array(24).keys()].filter(h => h >= 6);
    $('#heat').innerHTML = `<table>
      <thead><tr><th></th>${hours.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${d.map.map(s => `<tr><td class="name" title="${esc(names[s.from])} → ${esc(names[s.to])}">${esc(names[s.from])}</td>
        ${hours.map(h => `<td class="cell" style="background:${heatColor(s.index[h])}" title="${esc(names[s.from])} → ${esc(names[s.to])}\n${todStr(h * 60)} 约 ${s.sec[h]} 秒（${s.index[h]}×）"></td>`).join('')}</tr>`).join('')}
      </tbody></table>`;
  };
  await load();
  $('#dt').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    dt = Number(b.dataset.dt);
    $$('#dt button').forEach(x => x.classList.toggle('active', x === b));
    load();
  });
}
