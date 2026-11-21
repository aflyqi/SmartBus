import { api } from '../api.js';
import { $, $$, esc, icon, badge, favs, debounce, distStr, etaParts, macauNow, toast } from '../util.js';

let timer = null;
let filter = 'all';

function greeting() {
  const h = Math.floor(macauNow().tod / 60);
  if (h < 5) return '夜深了';
  if (h < 11) return '早安';
  if (h < 14) return '午安';
  if (h < 18) return '下午好';
  return '晚上好';
}

const HERO_ART = `<svg class="hero-art" viewBox="0 0 200 120" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round">
  <path d="M10 100 C 50 100, 50 40, 100 40 S 150 90, 190 20"/>
  <circle cx="10" cy="100" r="7" fill="#fff"/><circle cx="100" cy="40" r="7" fill="#fff"/><circle cx="190" cy="20" r="7" fill="#fff"/>
  <circle cx="55" cy="72" r="4"/><circle cx="148" cy="62" r="4"/></svg>`;

export async function mount(el) {
  el.innerHTML = `
    <section class="hero">
      ${HERO_ART}
      <h1>${greeting()}，要去哪里？</h1>
      <p>按历史行车时间与实时路况，预测巴士几时到站。</p>
      <div class="input-wrap" id="search-wrap">
        ${icon('search')}
        <input class="input" id="q" placeholder="搜寻路线或站点，例如 25、关闸、新马路" autocomplete="off" enterkeyhint="search">
        <div class="search-results card hidden" id="sr"></div>
      </div>
      <div class="hero-stats" id="hero-stats"><span>&nbsp;</span></div>
    </section>

    <div class="stack" style="margin-top:18px">
      <section class="card card-pad" id="fav-card" style="display:none">
        <div class="card-head"><div class="card-title">${icon('star')}收藏</div></div>
        <div class="fav-list" id="fav-list"></div>
      </section>

      <section class="card card-pad">
        <div class="card-head">
          <div><div class="card-title">${icon('pin')}附近站点</div><div class="card-sub">使用你的位置，找出最近的巴士站</div></div>
          <button class="btn btn-sm" id="locate">${icon('locate')}定位</button>
        </div>
        <div id="near" class="near-list"><div class="faint" style="font-size:14px">点击“定位”查看附近站点及即将到站的巴士。</div></div>
      </section>

      <section class="card card-pad">
        <div class="card-head wrap">
          <div class="card-title">${icon('bus')}全部路线</div>
          <div class="filters">
            <div class="seg" id="company">
              <button data-c="all" class="${filter === 'all' ? 'active' : ''}">全部</button>
              <button data-c="Orange" class="${filter === 'Orange' ? 'active' : ''}">澳巴</button>
              <button data-c="Blue" class="${filter === 'Blue' ? 'active' : ''}">新福利</button>
            </div>
          </div>
        </div>
        <div class="route-grid" id="routes">${Array.from({ length: 12 }, () => '<div class="skeleton" style="height:104px;border-radius:16px"></div>').join('')}</div>
      </section>
    </div>`;

  let routes = [];
  const load = async () => {
    try {
      const d = await api.routes();
      routes = d.routes;
      renderRoutes(routes);
      const buses = routes.reduce((s, r) => s + r.dirs.reduce((a, b) => a + b.buses, 0), 0);
      const active = routes.filter(r => r.dirs.some(d => d.buses)).length;
      $('#hero-stats').innerHTML = `<span><b class="num">${buses}</b>辆巴士运行中</span><span><b class="num">${active}</b>条路线在服务</span><span><b class="num">${routes.length}</b>条路线</span>`;
    } catch (e) {
      $('#routes').innerHTML = `<div class="empty">路线载入失败：${esc(e.message)}</div>`;
    }
  };
  await load();
  renderFavs();
  timer = setInterval(() => { load(); renderFavs(); }, 30000);

  $('#company').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    filter = b.dataset.c;
    $$('#company button').forEach(x => x.classList.toggle('active', x === b));
    renderRoutes(routes);
  });

  // search
  const q = $('#q'), sr = $('#sr');
  const doSearch = debounce(async () => {
    const term = q.value.trim();
    if (!term) { sr.classList.add('hidden'); return; }
    const up = term.toUpperCase();
    const rs = routes.filter(r => r.route.toUpperCase().startsWith(up)).slice(0, 6);
    let stops = [];
    try { stops = (await api.search(term, null, null, 8)).stops; } catch { /* ignore */ }
    if (q.value.trim() !== term) return;
    const html = [
      ...rs.map(r => `<a class="sr-item" href="#/route/${encodeURIComponent(r.route)}/${r.dirs[0].dir}">
          ${badge(r.route, r.color, 'sm')}
          <div class="grow"><div class="sr-name">路线 ${esc(r.route)}</div><div class="sr-meta">${esc(r.dirs.map(d => '往 ' + d.to).join(' · '))}</div></div>
          ${icon('right', 'faint')}</a>`),
      ...stops.map(s => `<a class="sr-item" href="#/journey?from=${encodeURIComponent(s.name)}">
          <div class="sr-icon">${icon('pin')}</div>
          <div class="grow"><div class="sr-name">${esc(s.name)}</div>
          <div class="sr-meta">${s.routes.slice(0, 10).map(r => badge(r.route, r.color, 'sm')).join('')}</div></div></a>`),
    ].join('');
    sr.innerHTML = html || '<div class="empty" style="padding:18px">找不到相关路线或站点</div>';
    sr.classList.remove('hidden');
  }, 160);
  q.addEventListener('input', doSearch);
  q.addEventListener('focus', doSearch);
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const first = $('#sr a'); if (first) location.hash = first.getAttribute('href'); }
  });
  document.addEventListener('click', outside);

  $('#locate').addEventListener('click', locate);
}

function outside(e) {
  const w = $('#search-wrap');
  if (w && !w.contains(e.target)) $('#sr')?.classList.add('hidden');
}

export function unmount() {
  clearInterval(timer);
  document.removeEventListener('click', outside);
}

function renderRoutes(routes) {
  const list = routes.filter(r => filter === 'all' || r.color === filter);
  $('#routes').innerHTML = list.map(r => {
    const d = r.dirs[0];
    const buses = r.dirs.reduce((a, b) => a + b.buses, 0);
    const dest = r.dirs.length > 1 ? `${d.from} ⇄ ${d.to}` : `${d.from} → ${d.to}`;
    return `<a class="route-tile" href="#/route/${encodeURIComponent(r.route)}/${d.dir}">
      ${badge(r.route, r.color)}
      ${buses ? `<span class="live"><span class="dot-live"></span><span class="num">${buses}</span></span>` : '<span class="live">停驶</span>'}
      <div class="to">${esc(dest)}</div>
    </a>`;
  }).join('') || '<div class="empty">没有路线</div>';
}

async function renderFavs() {
  const list = favs.all();
  const card = $('#fav-card');
  if (!card) return;
  if (!list.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  const box = $('#fav-list');
  if (!box.children.length) {
    box.innerHTML = list.map(f => favItem(f, null)).join('');
  }
  // live ETA for favourite stops
  const stops = list.filter(f => f.type === 'stop').slice(0, 8);
  const byRoute = {};
  await Promise.all([...new Set(stops.map(f => `${f.route}|${f.dir}`))].map(async k => {
    const [r, d] = k.split('|');
    try { byRoute[k] = await api.route(r, d); } catch { /* ignore */ }
  }));
  box.innerHTML = list.map(f => {
    let eta = null;
    if (f.type === 'stop') {
      const rd = byRoute[`${f.route}|${f.dir}`];
      const nx = rd?.stops?.[f.idx]?.next?.[0];
      eta = nx ? nx.eta : (rd ? -1 : null);
    }
    return favItem(f, eta);
  }).join('');
}

function favItem(f, eta) {
  let right = `${icon('right', 'faint')}`;
  if (f.type === 'stop' && eta != null) {
    if (eta < 0) right = '<span class="faint" style="font-size:13px">暂无车</span>';
    else { const p = etaParts(eta); right = `<span class="eta ${p.now ? 'now' : 'first'}">${p.v}<small>${p.u}</small></span>`; }
  }
  return `<a class="fav-item" href="${esc(f.href)}">
    ${badge(f.route, f.color, 'sm')}
    <div class="grow"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f.label)}</div>
    <div class="faint" style="font-size:12px">${esc(f.sub || '')}</div></div>
    <div class="fav-eta">${right}</div></a>`;
}

async function locate() {
  const near = $('#near');
  if (!navigator.geolocation) { toast('浏览器不支援定位'); return; }
  near.innerHTML = '<div class="skeleton" style="height:56px"></div><div class="skeleton" style="height:56px;margin-top:8px"></div>';
  navigator.geolocation.getCurrentPosition(async pos => {
    try {
      const { stops } = await api.search('', pos.coords.latitude, pos.coords.longitude, 6);
      near.innerHTML = stops.map(s => `
        <div class="near-item">
          <div class="sr-icon">${icon('pin')}</div>
          <div class="grow">
            <a href="#/journey?from=${encodeURIComponent(s.name)}" style="font-weight:600">${esc(s.name)}</a>
            <div class="mini-routes">${s.routes.map(r => `<a href="#/route/${encodeURIComponent(r.route)}/${r.dir}?stop=${r.idx}">${badge(r.route, r.color, 'sm')}</a>`).join('')}</div>
          </div>
          <div class="near-dist">${distStr(s.distance)}</div>
        </div>`).join('') || '<div class="faint">附近没有站点</div>';
    } catch (e) { near.innerHTML = `<div class="faint">载入失败：${esc(e.message)}</div>`; }
  }, err => {
    near.innerHTML = `<div class="faint">无法取得位置（${esc(err.message || '权限被拒')}）。可直接在上方搜寻站点。</div>`;
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}
