import { api } from '../api.js';
import { $, esc, icon, badge, favs, etaParts, clockStr, crowd, sheet, store, toast, macauNow, todStr, DAYTYPES } from '../util.js';
import { barChart } from '../charts.js';

let timer = null;
let ctx = null;

export async function openStop(route, dir, idx, routeData, onClose) {
  clearInterval(timer);
  ctx = { route, dir, idx, routeData, data: null, fetched: 0 };
  const name = routeData?.stops?.[idx]?.name || '';
  sheet.open(`<div class="sheet-head"><div class="grow"><h2>${esc(name)}</h2></div></div>
    <div class="skeleton" style="height:90px"></div><div class="skeleton" style="height:90px;margin-top:10px"></div>`);
  sheet.onClose = () => { clearInterval(timer); ctx = null; onClose && onClose(); };
  await load();
  timer = setInterval(load, 10000);
}

async function load() {
  const c = ctx; if (!c) return;
  try {
    const d = await api.stop(c.route, c.dir, c.idx);
    if (ctx !== c) return;
    c.data = d;
    render();
  } catch (e) {
    sheet.update(`<div class="empty">${icon('info')}载入失败：${esc(e.message)}</div>`);
  }
}

function walkKey(c) { return `walk.${c.route}.${c.dir}.${c.idx}`; }

function render() {
  const c = ctx; const d = c.data; if (!d) return;
  const id = `stop:${d.route}|${d.dir}|${d.stop.idx}`;
  const fav = favs.has(id);
  const now = Date.now() / 1000;
  const walk = store.get(walkKey(c), store.get('walk.default', 5));

  const arr = d.arrivals.filter(a => !a.here || true);
  const maxHi = Math.max(...arr.map(a => a.hi), 60);
  const arrHtml = arr.length ? arr.map((a, i) => {
    const p = etaParts(a.eta);
    const big = a.here ? '在站' : p.now ? '到站' : `${p.v}<small>分</small>`;
    return `<div class="arr ${i === 0 ? 'first' : ''}">
      <div class="arr-big">${big}</div>
      <div class="arr-meta">
        <div class="l1">${a.here ? '巴士正在此站' : a.away === 1 ? '下一站就到' : `相距 ${a.away} 站`} ${crowd(a.passenger)}</div>
        ${a.here ? '' : `<div class="range" title="可信范围 ${Math.round(a.lo / 60)}–${Math.round(a.hi / 60)} 分"><i style="left:${a.lo / maxHi * 100}%;width:${Math.max((a.hi - a.lo) / maxHi * 100, 2)}%"></i><b style="left:${a.eta / maxHi * 100}%"></b></div>`}
        <div class="mono" style="font-size:11.5px">${esc(a.plate)}</div>
      </div>
      <div class="arr-clock">${a.here ? clockStr(now) : clockStr(now + a.eta)}<small>${a.here ? '' : `${clockStr(now + a.lo)}–${clockStr(now + a.hi)}`}</small></div>
    </div>`;
  }).join('') : `<div class="arr"><div class="arr-big" style="font-size:20px">—</div>
      <div class="arr-meta"><div class="l1">暂时没有巴士驶近此站</div>
      <div>${d.headway_now ? `按过往数据，此时段约每 ${Math.max(1, Math.round(60 / d.headway_now.per_hour))} 分钟一班` : '此时段可能已停驶'}</div></div><div></div></div>`;

  // leave-home reminder: catch the first bus whose *early* bound is still reachable
  const walkSec = walk * 60;
  const catchable = arr.find(a => !a.here && a.lo >= walkSec);
  let leaveHtml;
  if (catchable) {
    const leaveIn = catchable.lo - walkSec;
    leaveHtml = `<div class="grow"><div class="faint" style="font-size:12px;font-weight:600">出门提醒 · 步行 ${walk} 分钟</div>
      <div class="big">${leaveIn < 60 ? '现在出门' : `${Math.round(leaveIn / 60)} 分钟后出门`}</div>
      <div class="muted" style="font-size:12.5px">赶搭约 ${clockStr(now + catchable.eta)} 到站的 ${esc(catchable.plate)}</div></div>`;
  } else {
    leaveHtml = `<div class="grow"><div class="faint" style="font-size:12px;font-weight:600">出门提醒 · 步行 ${walk} 分钟</div>
      <div class="big" style="font-size:17px">${arr.length ? '最近几班车赶不上' : '等有车驶近再提醒你'}</div></div>`;
  }

  const hw = d.headway?.slots || [];
  const m = macauNow();
  const others = d.others.map(o => `<a class="sr-item" href="#/route/${encodeURIComponent(o.route)}/${o.dir}?stop=${o.idx}">
      ${badge(o.route, o.color, 'sm')}<div class="grow" style="font-size:13.5px">往 ${esc(o.to)}</div>
      ${o.eta != null ? `<span class="eta ${o.eta < 40 ? 'now' : 'first'}" style="font-size:13px;min-width:44px">${etaParts(o.eta).v}<small>${etaParts(o.eta).u}</small></span>` : '<span class="faint" style="font-size:12px">暂无车</span>'}</a>`).join('');

  const rd = c.routeData;
  const downstream = rd ? rd.stops.slice(d.stop.idx + 1) : [];

  sheet.update(`
    <div class="sheet-head">
      ${badge(d.route, d.color)}
      <div class="grow">
        <h2>${esc(d.stop.name)}</h2>
        <div class="faint" style="font-size:12.5px">往 ${esc(d.to)} · <span class="mono">${esc(d.stop.code)}</span>${d.stop.lane ? ` · ${esc(d.stop.lane)}` : ''}</div>
      </div>
      <button class="icon-btn ${fav ? 'on' : ''}" id="fav-stop" title="收藏站点">${icon('star')}</button>
      <button class="icon-btn" id="close-sheet" title="关闭">${icon('x')}</button>
    </div>

    <div class="stack" style="gap:14px">
      <div class="arrivals">${arrHtml}</div>

      <div class="leave">
        <div class="sr-icon" style="background:var(--good-soft);color:var(--good)">${icon('walk')}</div>
        ${leaveHtml}
        <div class="stepper"><button id="walk-dec">−</button><span>${walk} 分</span><button id="walk-inc">+</button></div>
      </div>

      ${downstream.length ? `<div class="card card-pad" style="box-shadow:none">
        <div class="card-title" style="margin-bottom:10px">${icon('flag')}由此站出发，去…</div>
        <div class="row">
          <select class="input grow" id="dest" style="height:42px">${downstream.map(s => `<option value="${s.idx}">${esc(s.name)}</option>`).join('')}</select>
          <button class="btn btn-primary" id="go-plan">${icon('arrow')}行程时间</button>
        </div>
      </div>` : ''}

      <div class="card card-pad" style="box-shadow:none">
        <div class="card-head" style="margin-bottom:6px"><div class="card-title">${icon('clock')}班次密度</div><span class="chip">${DAYTYPES[d.daytype]} · 近 ${d.headway?.days || 0} 日</span></div>
        <div class="chart" id="hw-chart"></div>
        <div class="faint" style="font-size:12px;margin-top:6px">每小时班次；突出显示为现在时段。平均候车时间已考虑班次不均匀。</div>
      </div>

      ${d.recent.length ? `<div>
        <div class="card-title" style="font-size:14px;margin-bottom:8px">${icon('list')}最近 3 小时到站</div>
        <div class="row wrap" style="gap:6px">${d.recent.map(t => `<span class="chip num">${clockStr(t)}</span>`).join('')}</div>
      </div>` : ''}

      ${others ? `<div><div class="card-title" style="font-size:14px;margin-bottom:6px">${icon('bus')}此站其他路线</div>${others}</div>` : ''}
    </div>`);

  barChart($('#hw-chart'), hw.map(s => ({ tod: s.tod, y: s.per_hour, wait: s.wait })), {
    marker: m.tod, height: 140, width: 30,
    fmtTip: s => `${todStr(s.tod)} · 每小时 ${s.y} 班${s.wait ? ` · 平均候车 ${Math.round(s.wait / 60)} 分` : ''}`,
  });

  $('#close-sheet').onclick = () => sheet.close();
  $('#fav-stop').onclick = () => {
    const on = favs.toggle({ id, type: 'stop', route: d.route, dir: d.dir, idx: d.stop.idx, color: d.color,
      label: d.stop.name, sub: `往 ${d.to}`, href: `#/route/${encodeURIComponent(d.route)}/${d.dir}?stop=${d.stop.idx}` });
    $('#fav-stop').classList.toggle('on', on);
    toast(on ? '已收藏站点' : '已取消收藏');
  };
  const setWalk = v => { store.set(walkKey(c), v); store.set('walk.default', v); render(); };
  $('#walk-dec').onclick = () => setWalk(Math.max(0, walk - 1));
  $('#walk-inc').onclick = () => setWalk(Math.min(60, walk + 1));
  const go = $('#go-plan');
  if (go) go.onclick = () => { location.hash = `#/plan/${encodeURIComponent(d.route)}/${d.dir}/${d.stop.idx}/${$('#dest').value}`; };
}
