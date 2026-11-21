import { api } from '../api.js';
import { $, esc, icon, badge, etaParts, clockStr, durStr, debounce } from '../util.js';

let timer = null;

export async function mount(el, { query }) {
  const from = query.get('from') || '';
  const to = query.get('to') || '';
  el.innerHTML = `
    <div class="page-head"><div><h1 class="page-title">行程</h1><div class="page-sub">由 A 站到 B 站，比较所有直达路线的实时到达时间</div></div></div>
    <section class="card card-pad">
      <div class="od">
        <div class="od-fields">
          <span class="od-dot a"></span><span class="od-dot b"></span>
          <div class="ac"><input class="input" id="from" placeholder="起点站" value="${esc(from)}" autocomplete="off"><div class="ac-list card hidden" id="from-ac"></div></div>
          <div class="ac"><input class="input" id="to" placeholder="终点站" value="${esc(to)}" autocomplete="off"><div class="ac-list card hidden" id="to-ac"></div></div>
        </div>
        <button class="icon-btn" id="swap" title="对调">${icon('swap')}</button>
      </div>
    </section>
    <div id="results" class="stack" style="margin-top:16px"></div>`;

  setupAc('from'); setupAc('to');
  $('#swap').onclick = () => { const a = $('#from').value; $('#from').value = $('#to').value; $('#to').value = a; go(); };
  if (from && to) await search(from, to);
  else $('#results').innerHTML = `<div class="card card-pad empty">${icon('route')}<div>输入起点和终点站名称，例如“关闸总站”→“新马路/永亨”</div></div>`;
}

export function unmount() { clearInterval(timer); }

function go() {
  const f = $('#from').value.trim(), t = $('#to').value.trim();
  if (f && t) location.hash = `#/journey?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;
}

function setupAc(id) {
  const input = $('#' + id), list = $(`#${id}-ac`);
  const run = debounce(async () => {
    const q = input.value.trim();
    if (!q) { list.classList.add('hidden'); return; }
    const { stops } = await api.search(q, null, null, 8);
    list.innerHTML = stops.map(s => `<div class="sr-item" data-name="${esc(s.name)}" style="cursor:pointer">
        <div class="sr-icon">${icon('pin')}</div>
        <div class="grow"><div class="sr-name">${esc(s.name)}</div><div class="sr-meta">${s.routes.slice(0, 10).map(r => badge(r.route, r.color, 'sm')).join('')}</div></div></div>`).join('')
      || '<div class="empty" style="padding:14px">找不到站点</div>';
    list.classList.remove('hidden');
  }, 150);
  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (input.value) run(); });
  input.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 180));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { const f = list.querySelector('.sr-item'); if (f) input.value = f.dataset.name; list.classList.add('hidden'); go(); } });
  list.addEventListener('mousedown', e => {
    const it = e.target.closest('.sr-item'); if (!it) return;
    input.value = it.dataset.name;
    list.classList.add('hidden');
    go();
  });
}

async function search(from, to) {
  const box = $('#results');
  box.innerHTML = '<div class="skeleton" style="height:96px;border-radius:18px"></div><div class="skeleton" style="height:96px;border-radius:18px"></div>';
  const load = async () => {
    const d = await api.journey(from, to);
    if (!$('#results')) return;
    if (!d.options.length) {
      box.innerHTML = `<div class="card card-pad empty">${icon('info')}<div>没有由“${esc(from)}”直达“${esc(to)}”的路线。<br>请确认站名，或尝试附近站点。</div></div>`;
      return;
    }
    const now = Date.now() / 1000;
    box.innerHTML = d.options.map((o, i) => {
      const w = o.wait != null ? etaParts(o.wait) : null;
      const hw = o.headway?.per_hour ? `约每 ${Math.max(1, Math.round(60 / o.headway.per_hour))} 分钟一班` : '';
      return `<a class="opt ${i === 0 && o.arrive ? 'best' : ''}" href="#/plan/${encodeURIComponent(o.route)}/${o.dir}/${o.from_idx}/${o.to_idx}">
        ${badge(o.route, o.color, 'lg')}
        <div style="min-width:0">
          <div style="font-weight:700">往 ${esc(o.towards)} ${i === 0 && o.arrive ? '<span class="chip good" style="height:22px;margin-left:4px">最快</span>' : ''}</div>
          <div class="faint" style="font-size:13px">${w ? `候车 <b class="num" style="color:var(--text)">${w.v}${w.u}</b> · ` : '暂无车驶近 · '}乘车 <b class="num" style="color:var(--text)">${Math.round(o.ride.med / 60)} 分</b> · ${o.stops} 站</div>
          <div class="faint" style="font-size:12px">${o.later.length ? `之后 ${o.later.map(x => Math.round(x / 60) + ' 分').join('、')}` : hw}</div>
          ${o.wait != null ? `<div class="journey-bar" style="max-width:280px"><div class="w" style="flex:${Math.max(o.wait, 30)}"></div><div class="r" style="flex:${o.ride.med}"></div></div>` : ''}
        </div>
        <div class="arrive"><div class="faint" style="font-size:12px">${o.arrive ? '预计到达' : '乘车约'}</div>
          <div class="t">${o.arrive ? clockStr(o.arrive) : durStr(o.ride.med)}</div>
          ${o.arrive ? `<div class="faint num" style="font-size:12px">${clockStr(now + (o.wait || 0) + o.ride.lo)}–${clockStr(now + (o.wait || 0) + o.ride.hi)}</div>` : ''}</div>
      </a>`;
    }).join('');
  };
  await load();
  clearInterval(timer);
  timer = setInterval(() => load().catch(() => {}), 20000);
}
