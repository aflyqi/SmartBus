import { api } from '../api.js';
import { $, $$, esc, icon, badge, etaParts, clockStr, todStr, macauNow, dayType, DAYTYPES, debounce } from '../util.js';
import { bandChart, barChart } from '../charts.js';

let st = null;
let timer = null;

export async function mount(el, { parts }) {
  const [, route, dir, from, to] = parts;
  const m = macauNow();
  st = { route, dir: Number(dir), from: Number(from), to: Number(to), dt: dayType(m.dow), tod: Math.round(m.tod / 10) * 10, el };
  el.innerHTML = `<div class="skeleton" style="height:200px;border-radius:20px"></div>`;
  const live = await api.plan(route, dir, from, to);
  st.live = live;
  render();
  await loadHist();
  timer = setInterval(async () => {
    try { st.live = await api.plan(route, dir, from, to); renderLive(); } catch { /* ignore */ }
  }, 15000);
}

export function unmount() { clearInterval(timer); st = null; }

function render() {
  const d = st.live;
  st.el.innerHTML = `
    <div class="route-head">
      <a class="icon-btn" href="#/route/${encodeURIComponent(d.route)}/${d.dir}?stop=${d.from.idx}" title="返回">${icon('back')}</a>
      ${badge(d.route, d.color, 'lg')}
      <div class="titles">
        <div class="to" style="font-size:20px">${esc(d.from.name)} → ${esc(d.to.name)}</div>
        <div class="from">乘坐 ${d.stops} 站 · 行程时间预测</div>
      </div>
    </div>

    <div class="grid-2">
      <section class="card card-pad" id="live-card"></section>
      <section class="card card-pad">
        <div class="card-head"><div class="card-title">${icon('target')}准时到达规划</div></div>
        <div class="muted" style="font-size:14px;margin-bottom:10px">输入你需要到达“${esc(d.to.name)}”的时间：</div>
        <div class="row"><input type="time" class="input" id="arrive-by" style="max-width:160px" value="${todStr(Math.round((macauNow().tod + 60) / 10) * 10)}"><span class="faint" style="font-size:13px">（${DAYTYPES[st.dt]}）</span></div>
        <div id="arrive-out" style="margin-top:14px"></div>
      </section>
    </div>

    <section class="card card-pad" style="margin-top:16px">
      <div class="card-head wrap">
        <div><div class="card-title">${icon('calendar')}按历史时间查询</div><div class="card-sub">选择日子类型与出发时间，查看这段路通常要多久</div></div>
        <div class="seg" id="dt">${DAYTYPES.map((n, i) => `<button data-dt="${i}" class="${i === st.dt ? 'active' : ''}">${n}</button>`).join('')}</div>
      </div>
      <div class="row wrap" style="gap:18px;align-items:flex-end">
        <div>
          <div class="faint" style="font-size:12px;font-weight:600">出发时间</div>
          <div class="big-metric"><span class="v" id="tod-v">${todStr(st.tod)}</span></div>
        </div>
        <div>
          <div class="faint" style="font-size:12px;font-weight:600">预计乘车</div>
          <div class="big-metric"><span class="v" id="hist-v">–</span><span class="u">分钟</span></div>
        </div>
        <div class="grow" style="min-width:120px">
          <div class="faint" style="font-size:12px;font-weight:600">可信范围</div>
          <div style="font-size:18px;font-weight:700" class="num" id="hist-range">–</div>
        </div>
      </div>
      <input type="range" class="range-input" id="tod" min="0" max="1430" step="10" value="${st.tod}" style="margin:16px 0 6px">
      <div class="chart" id="curve"></div>
      <div class="faint" style="font-size:12px;margin-top:6px">实线为中位数，阴影为 15%–85% 范围。数据越多，曲线越可靠。</div>
    </section>

    <section class="card card-pad" style="margin-top:16px">
      <div class="card-head"><div class="card-title">${icon('clock')}${esc(d.from.name)} 班次密度</div><span class="chip" id="hw-chip">${DAYTYPES[st.dt]}</span></div>
      <div class="chart" id="hw"></div>
    </section>`;

  renderLive();
  $('#dt').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st.dt = Number(b.dataset.dt);
    $$('#dt button').forEach(x => x.classList.toggle('active', x === b));
    loadHist();
  });
  const slide = debounce(() => loadHist(true), 150);
  $('#tod').addEventListener('input', e => { st.tod = Number(e.target.value); $('#tod-v').textContent = todStr(st.tod); updateHistFromCurve(); slide(); });
  $('#arrive-by').addEventListener('input', renderArrive);
}

function renderLive() {
  const d = st.live; const box = $('#live-card'); if (!box) return;
  const now = Date.now() / 1000;
  const nx = d.next || [];
  const n0 = nx.find(a => !a.here) || nx[0];
  const wait = n0 ? n0.eta : null;
  const arrive = wait != null ? now + wait + d.travel.med : null;
  box.innerHTML = `
    <div class="card-head"><div class="card-title">${icon('zap')}现在出发</div><span class="row faint" style="font-size:12px;gap:6px"><span class="dot-live"></span>实时</span></div>
    <div class="row wrap" style="gap:22px">
      <div><div class="faint" style="font-size:12px;font-weight:600">下一班到 ${esc(d.from.name)}</div>
        <div class="big-metric"><span class="v">${wait != null ? etaParts(wait).v : '—'}</span><span class="u">${wait != null ? etaParts(wait).u : ''}</span></div></div>
      <div><div class="faint" style="font-size:12px;font-weight:600">乘车时间</div>
        <div class="big-metric"><span class="v">${Math.round(d.travel.med / 60)}</span><span class="u">分</span></div>
        <div class="faint num" style="font-size:12px">${Math.round(d.travel.lo / 60)}–${Math.round(d.travel.hi / 60)} 分</div></div>
      <div><div class="faint" style="font-size:12px;font-weight:600">预计到达</div>
        <div class="big-metric"><span class="v" style="background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent">${arrive ? clockStr(arrive) : '—'}</span></div></div>
    </div>
    ${wait != null ? `<div class="journey-bar"><div class="w" style="flex:${Math.max(wait, 30)}"></div><div class="r" style="flex:${d.travel.med}"></div></div>
      <div class="row faint" style="font-size:12px;margin-top:6px;justify-content:space-between"><span>候车</span><span>乘车</span></div>` :
      `<div class="muted" style="font-size:13px;margin-top:10px">暂时没有巴士驶近起点站。</div>`}`;
}

async function loadHist(fromSlider) {
  const s = st; if (!s) return;
  const d = await api.plan(s.route, s.dir, s.from, s.to, s.dt, s.tod);
  if (st !== s) return;
  s.hist = d;
  $('#hist-v').textContent = Math.round(d.travel.med / 60);
  $('#hist-range').textContent = `${Math.round(d.travel.lo / 60)}–${Math.round(d.travel.hi / 60)} 分钟`;
  $('#hw-chip').textContent = `${DAYTYPES[s.dt]} · 近 ${d.headway.days} 日`;
  if (!fromSlider || !s.curveDrawn) {
    s.curveDrawn = true;
    drawCurve();
    barChart($('#hw'), d.headway.slots.map(x => ({ tod: x.tod, y: x.per_hour, wait: x.wait })), {
      marker: s.tod, height: 150, width: 30,
      fmtTip: x => `${todStr(x.tod)} · 每小时 ${x.y} 班${x.wait ? ` · 平均候车 ${Math.round(x.wait / 60)} 分` : ''}`,
    });
  } else drawCurve();
  renderArrive();
}

function serviceCurve() {
  // trim the curve to hours when the route actually runs (from headway data)
  const d = st.hist; if (!d) return [];
  const slots = d.headway.slots.filter(x => x.per_hour > 0);
  if (!slots.length) return d.curve;
  const a = slots[0].tod, b = slots[slots.length - 1].tod + 30;
  return d.curve.filter(p => p.tod >= a && p.tod <= b);
}

function drawCurve() { bandChart($('#curve'), serviceCurve(), { marker: st.tod, height: 220 }); }

function updateHistFromCurve() {
  const c = st.hist?.curve; if (!c) return;
  const p = c.reduce((a, b) => Math.abs(b.tod - st.tod) < Math.abs(a.tod - st.tod) ? b : a);
  $('#hist-v').textContent = Math.round(p.med / 60);
  $('#hist-range').textContent = `${Math.round(p.lo / 60)}–${Math.round(p.hi / 60)} 分钟`;
}

function renderArrive() {
  const out = $('#arrive-out'); const c = serviceCurve(); if (!out || !c.length) return;
  const [h, m] = ($('#arrive-by').value || '09:00').split(':').map(Number);
  const target = h * 60 + m;
  let safe = null, typical = null;
  for (const p of c) {
    if (p.tod + p.hi / 60 <= target) safe = p;
    if (p.tod + p.med / 60 <= target) typical = p;
  }
  if (!safe && !typical) { out.innerHTML = '<div class="faint">这个时间之前没有合适的班次。</div>'; return; }
  const slot = st.hist.headway.slots[Math.min(Math.floor((safe || typical).tod / 30), 47)];
  const wait = slot?.wait ? Math.round(slot.wait / 60) : null;
  out.innerHTML = `<dl class="kv">
      ${safe ? `<dt>稳妥（约 85% 准时）最晚上车</dt><dd>${todStr(safe.tod)}</dd>` : ''}
      ${typical ? `<dt>一般情况最晚上车</dt><dd>${todStr(typical.tod)}</dd>` : ''}
      ${safe && wait ? `<dt>考虑平均候车，建议到站</dt><dd style="color:var(--accent)">${todStr(safe.tod - wait)}</dd>` : ''}
    </dl>`;
}
