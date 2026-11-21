import { api } from '../api.js';
import { $, $$, esc, icon, badge, favs, etaParts, agoStr, toast } from '../util.js';
import { congColor } from '../charts.js';
import { openStop } from './stop.js';

let state = null;
let timers = [];

export async function mount(el, { parts, query }) {
  const route = parts[1];
  const dir = Number(parts[2] || 0);
  state = { route, dir, data: null, sel: query.has('stop') ? Number(query.get('stop')) : null, el };

  el.innerHTML = `
    <div class="route-head">
      <a class="icon-btn" href="#/" title="返回">${icon('back')}</a>
      <div class="skeleton" style="width:72px;height:56px;border-radius:16px"></div>
      <div class="titles"><div class="skeleton" style="height:26px;width:60%"></div><div class="skeleton" style="height:14px;width:40%;margin-top:8px"></div></div>
    </div>
    <div class="card card-pad"><div class="skeleton" style="height:420px"></div></div>`;

  await refresh(true);
  timers.push(setInterval(() => refresh(false), 10000));
  timers.push(setInterval(tick, 1000));
  if (state.sel != null) openStopSheet(state.sel);
}

export function unmount() {
  timers.forEach(clearInterval);
  timers = [];
  state = null;
}

async function refresh(first) {
  const s = state;
  if (!s) return;
  let d;
  try {
    d = await api.route(s.route, s.dir);
  } catch (e) {
    if (first) s.el.innerHTML = `<div class="card card-pad empty">${icon('info')}<div>找不到路线 ${esc(s.route)}（${esc(e.message)}）</div><a class="btn" href="#/" style="margin-top:12px">返回首页</a></div>`;
    return;
  }
  if (state !== s) return;
  s.data = d;
  if (first) renderShell(d);
  renderStats(d);
  renderTimeline(d);
  renderMap(d);
}

function routeId(d) { return `route:${d.route}|${d.dir}`; }

function renderShell(d) {
  const last = d.stops[d.stops.length - 1], first = d.stops[0];
  const loop = first.name === last.name;
  const fav = favs.has(routeId(d));
  state.el.innerHTML = `
    <div class="route-head">
      <a class="icon-btn" href="#/" title="返回">${icon('back')}</a>
      ${badge(d.route, d.color, 'lg')}
      <div class="titles">
        <div class="to">${loop ? '循环线 · ' : '往 '}${esc(loop ? stopsMid(d) : last.name)}</div>
        <div class="from"><span class="dot-live" id="live-dot"></span><span id="live-txt">实时</span><span>·</span><span>由 ${esc(first.name)} 开出 · ${d.stops.length} 站</span></div>
      </div>
      <div class="actions">
        ${d.dirs.length > 1 ? `<a class="btn" href="#/route/${encodeURIComponent(d.route)}/${d.dirs.find(x => x !== d.dir)}" title="切换方向">${icon('swap')}<span class="hide-sm">对向</span></a>` : ''}
        <button class="icon-btn ${fav ? 'on' : ''}" id="fav-route" title="收藏路线">${icon('star')}</button>
        <a class="icon-btn" href="#/insights/${encodeURIComponent(d.route)}/${d.dir}" title="路况洞察">${icon('chart')}</a>
      </div>
    </div>
    <div class="stat-strip">
      <div class="stat"><div class="k">运行中</div><div class="v num" id="st-buses">–</div></div>
      <div class="stat"><div class="k">全程约</div><div class="v num" id="st-full">–</div></div>
      <div class="stat"><div class="k">即时路况</div><div class="v" id="st-cong">–</div></div>
    </div>
    <div class="route-layout">
      <section class="card" style="padding:10px 8px">
        <div class="timeline" id="tl"></div>
      </section>
      <aside class="route-side stack">
        <section class="card" style="padding:10px">
          <div class="route-map" id="map"></div>
        </section>
        <section class="card card-pad prose" style="font-size:13px">
          <div class="row" style="gap:8px;color:var(--text)">${icon('info')}<b>点击任何站点</b></div>
          <p style="margin-top:8px">查看未来几班车的预计到站时间与可信范围、出门提醒、此站班次密度，以及由该站出发的行程时间。</p>
        </section>
      </aside>
    </div>`;
  $('#fav-route').onclick = () => {
    const on = favs.toggle({ id: routeId(d), type: 'route', route: d.route, dir: d.dir, color: d.color,
      label: `往 ${last.name}`, sub: `由 ${first.name}`, href: `#/route/${encodeURIComponent(d.route)}/${d.dir}` });
    $('#fav-route').classList.toggle('on', on);
    toast(on ? '已加入收藏' : '已取消收藏');
  };
  api.plan(d.route, d.dir, 0, d.stops.length - 1).then(p => {
    const el = $('#st-full'); if (el) el.innerHTML = `${Math.round(p.travel.med / 60)}<small>分</small>`;
  }).catch(() => {});
}

function stopsMid(d) {
  // name the far end of a loop route
  return d.stops[Math.floor(d.stops.length / 2)].name;
}

function renderStats(d) {
  const b = $('#st-buses'); if (!b) return;
  b.innerHTML = `${d.buses.length}<small>辆</small>`;
  const cs = d.stops.map(s => s.cong).filter(x => x != null);
  const avg = cs.length ? cs.reduce((a, c) => a + c, 0) / cs.length : 1;
  const max = cs.length ? Math.max(...cs) : 1;
  const label = max > 1.45 ? ['局部挤塞', 'var(--bad)'] : avg > 1.15 ? ['缓慢', 'var(--warn)'] : ['畅通', 'var(--good)'];
  $('#st-cong').innerHTML = `<span style="color:${label[1]}">${label[0]}</span>`;
  const age = d.updated ? Date.now() / 1000 - d.updated : 999;
  $('#live-dot')?.classList.toggle('stale', age > 60);
}

function segColor(d, i) {
  const c = d.stops[i]?.cong;
  if (c == null || c < 1.12) return d.color === 'Orange' ? 'var(--orange)' : d.color === 'Blue' ? 'var(--blue)' : 'var(--accent)';
  return congColor(c);
}

function etaChips(stop, offset) {
  const n = stop.next || [];
  if (!n.length) return '';
  const p0 = etaParts(Math.max(n[0].eta - offset, 0));
  const first = n[0].here ? `<span class="eta now">在站</span>` :
    `<span class="eta ${p0.now ? 'now' : 'first'}">${p0.v}<small>${p0.u}</small></span>`;
  let second = '';
  if (n[1]) { const p1 = etaParts(Math.max(n[1].eta - offset, 0)); second = `<span class="eta second">${p1.v}${p1.u}</span>`; }
  return second + first;
}

function renderTimeline(d) {
  const tl = $('#tl'); if (!tl) return;
  const offset = Date.now() / 1000 - d._fetched;
  const color = d.color === 'Orange' ? 'var(--orange)' : d.color === 'Blue' ? 'var(--blue)' : 'var(--accent)';
  if (!tl.dataset.built || tl.dataset.n !== String(d.stops.length)) {
    tl.innerHTML = d.stops.map((s, i) => `
      <div class="tl-stop ${i === 0 || i === d.stops.length - 1 ? 'terminal' : ''}" data-idx="${i}" style="--c:${color}">
        <div class="tl-rail before"></div><div class="tl-rail after"></div>
        <div class="tl-node"></div>
        <div class="tl-name">${esc(s.name)}<span class="code">${esc(s.code)}</span>${s.lane ? `<div class="lane">${esc(s.lane)}</div>` : ''}</div>
        <div class="tl-etas"></div>
      </div>`).join('');
    tl.dataset.built = '1';
    tl.dataset.n = String(d.stops.length);
    tl.addEventListener('click', e => {
      const row = e.target.closest('.tl-stop'); if (!row) return;
      openStopSheet(Number(row.dataset.idx));
    });
  }
  const rows = $$('.tl-stop', tl);
  rows.forEach((row, i) => {
    row.querySelector('.tl-rail.before').style.setProperty('--seg', segColor(d, i - 1));
    row.querySelector('.tl-rail.after').style.setProperty('--seg', segColor(d, i));
    row.querySelector('.tl-etas').innerHTML = etaChips(d.stops[i], offset);
    row.classList.toggle('sel', state.sel === i);
  });
  // buses
  const seen = new Set();
  for (const b of d.buses) {
    seen.add(b.plate);
    let el = tl.querySelector(`.tl-bus[data-plate="${CSS.escape(b.plate)}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tl-bus';
      el.dataset.plate = b.plate;
      el.style.setProperty('--c', color);
      el.innerHTML = `${icon('bus')}<span class="plate"></span>`;
      tl.appendChild(el);
    }
    const r0 = rows[b.idx], r1 = rows[Math.min(b.idx + 1, rows.length - 1)];
    if (!r0) continue;
    const y0 = r0.offsetTop + r0.offsetHeight / 2;
    const y1 = r1.offsetTop + r1.offsetHeight / 2;
    el.style.top = `${y0 + (y1 - y0) * (b.at_stop ? 0 : b.progress)}px`;
    el.querySelector('.plate').textContent = `${b.plate}${b.speed != null ? ` · ${Math.round(b.speed)}km/h` : ''}`;
    el.title = `${b.plate} ${b.at_stop ? '在站' : '行驶中'}`;
  }
  tl.querySelectorAll('.tl-bus').forEach(el => { if (!seen.has(el.dataset.plate)) el.remove(); });
}

function tick() {
  const d = state?.data; if (!d) return;
  const offset = Date.now() / 1000 - d._fetched;
  $$('#tl .tl-stop').forEach((row, i) => { row.querySelector('.tl-etas').innerHTML = etaChips(d.stops[i], offset); });
  const t = $('#live-txt');
  if (t) t.textContent = d.updated ? `实时 · ${agoStr(d.updated)}更新` : '暂无实时数据';
}

// ── schematic map ──────────────────────────────────────────────────────
function renderMap(d) {
  const box = $('#map'); if (!box) return;
  const pts = d.stops.filter(s => s.lat && s.lon);
  if (pts.length < 2) { box.innerHTML = '<div class="empty">没有座标数据</div>'; return; }
  const lat0 = pts.reduce((a, s) => a + s.lat, 0) / pts.length;
  const k = Math.cos(lat0 * Math.PI / 180);
  const xs = pts.map(s => s.lon * k), ys = pts.map(s => -s.lat);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = 400, H = 400, pad = 34;
  const sc = Math.min((W - 2 * pad) / Math.max(maxX - minX, 1e-6), (H - 2 * pad) / Math.max(maxY - minY, 1e-6));
  const ox = (W - (maxX - minX) * sc) / 2, oy = (H - (maxY - minY) * sc) / 2;
  const P = s => s.lat ? [ox + (s.lon * k - minX) * sc, oy + (-s.lat - minY) * sc] : null;
  const pos = d.stops.map(P);
  const color = d.color === 'Orange' ? 'var(--orange)' : d.color === 'Blue' ? 'var(--blue)' : 'var(--accent)';

  let segs = '';
  for (let i = 0; i < d.stops.length - 1; i++) {
    const a = pos[i], b = pos[i + 1]; if (!a || !b) continue;
    segs += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${segColor(d, i)}" stroke-width="5" stroke-linecap="round"/>`;
  }
  let grid = '';
  for (let g = 40; g < W; g += 40) grid += `<line x1="${g}" y1="0" x2="${g}" y2="${H}"/><line x1="0" y1="${g}" x2="${W}" y2="${g}"/>`;
  const stops = d.stops.map((s, i) => {
    const p = pos[i]; if (!p) return '';
    const term = i === 0 || i === d.stops.length - 1;
    const sel = state.sel === i;
    return `<circle class="map-stop ${sel ? 'sel' : ''}" data-idx="${i}" cx="${p[0]}" cy="${p[1]}" r="${term || sel ? 6.5 : 3.8}" stroke="${color}" style="cursor:pointer"><title>${esc(s.name)}</title></circle>`;
  }).join('');
  const labels = d.stops.map((s, i) => {
    const p = pos[i]; if (!p) return '';
    if (!(i === 0 || i === d.stops.length - 1 || state.sel === i)) return '';
    if (i === d.stops.length - 1 && d.stops[0].name === s.name) return '';
    return `<text class="map-label" x="${p[0] + 10}" y="${p[1] + 4}">${esc(s.name)}</text>`;
  }).join('');
  const buses = d.buses.map(b => {
    const a = pos[b.idx], c = pos[Math.min(b.idx + 1, pos.length - 1)];
    if (!a) return '';
    const t = b.at_stop ? 0 : b.progress;
    const x = a[0] + ((c || a)[0] - a[0]) * t, y = a[1] + ((c || a)[1] - a[1]) * t;
    return `<g class="map-bus" style="transform:translate(${x}px,${y}px)"><circle r="9" fill="${color}" stroke="var(--surface)" stroke-width="2.5"/>
      <rect x="-4" y="-4.5" width="8" height="8" rx="1.8" fill="#fff"/><title>${esc(b.plate)}</title></g>`;
  }).join('');
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}">
      <g class="map-grid">${grid}</g>
      ${segs}${stops}${labels}${buses}
    </svg>
    <div class="map-legend"><span><i style="background:${color}"></i>畅通</span><span><i style="background:var(--warn)"></i>缓慢</span><span><i style="background:var(--bad)"></i>挤塞</span></div>`;
  box.querySelector('svg').addEventListener('click', e => {
    const c = e.target.closest('.map-stop'); if (c) openStopSheet(Number(c.dataset.idx));
  });
}

function openStopSheet(idx) {
  if (!state) return;
  state.sel = idx;
  const url = `#/route/${encodeURIComponent(state.route)}/${state.dir}?stop=${idx}`;
  history.replaceState(null, '', url);
  if (state.data) { renderTimeline(state.data); renderMap(state.data); }
  openStop(state.route, state.dir, idx, state.data, () => {
    if (!state) return;
    state.sel = null;
    history.replaceState(null, '', `#/route/${encodeURIComponent(state.route)}/${state.dir}`);
    if (state.data) { renderTimeline(state.data); renderMap(state.data); }
  });
}

