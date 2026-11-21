import { $, icon, esc, favs, sheet, store, badge } from './util.js';
import * as home from './views/home.js';
import * as route from './views/route.js';
import * as journey from './views/journey.js';
import * as plan from './views/plan.js';
import * as insights from './views/insights.js';
import * as status from './views/status.js';

const NAV = [
  { href: '#/', key: 'home', label: '首页', icon: 'home' },
  { href: '#/journey', key: 'journey', label: '行程', icon: 'route' },
  { href: '#/insights', key: 'insights', label: '洞察', icon: 'chart' },
  { href: '#/status', key: 'status', label: '数据', icon: 'activity' },
];

let current = null; // active view module (for cleanup)

function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { parts, query: new URLSearchParams(qs || '') };
}

function resolve({ parts }) {
  const [a] = parts;
  if (!a) return { mod: home, key: 'home' };
  if (a === 'route' && parts[1]) return { mod: route, key: 'home' };
  if (a === 'plan' && parts[1]) return { mod: plan, key: 'journey' };
  if (a === 'journey') return { mod: journey, key: 'journey' };
  if (a === 'insights') return { mod: insights, key: 'insights' };
  if (a === 'status') return { mod: status, key: 'status' };
  return { mod: home, key: 'home' };
}

async function render() {
  const r = parse();
  const { mod, key } = resolve(r);
  if (current && current.unmount) current.unmount();
  if (sheet.isOpen()) sheet.close();
  current = mod;
  renderNav(key);
  const view = $('#view');
  view.style.animation = 'none';
  void view.offsetHeight;
  view.style.animation = '';
  window.scrollTo(0, 0);
  try {
    await mod.mount(view, r);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card card-pad empty">${icon('info')}<div>载入失败：${esc(e.message)}</div>
      <button class="btn" style="margin-top:14px" onclick="location.reload()">${icon('refresh')}重试</button></div>`;
  }
}

function renderNav(active) {
  const links = NAV.map(n => `<a href="${n.href}" class="${n.key === active ? 'active' : ''}">${icon(n.icon)}<span>${n.label}</span></a>`).join('');
  $('#tabbar').innerHTML = NAV.map(n => `<a href="${n.href}" class="tab ${n.key === active ? 'active' : ''}">${icon(n.icon)}<span>${n.label}</span></a>`).join('');
  const fl = favs.all().slice(0, 10);
  const theme = document.documentElement.dataset.theme;
  $('#sidebar').innerHTML = `
    <a class="brand" href="#/">
      <img class="brand-mark" src="/assets/icon.svg" alt="">
      <div><div class="brand-name">SmartBus</div><div class="brand-sub">澳门巴士到站预测</div></div>
    </a>
    <nav class="nav">${links}</nav>
    ${fl.length ? `<div class="side-section"><div class="side-title">收藏</div>
      ${fl.map(f => `<a class="side-fav" href="${esc(f.href)}">${badge(f.route, f.color, 'sm')}<span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.label)}</span></a>`).join('')}
    </div>` : ''}
    <div class="side-foot">
      <span>数据来源：DSAT 巴士报站</span>
      <button class="icon-btn" id="theme-btn" title="切换深浅色">${icon(theme === 'dark' ? 'sun' : 'moon')}</button>
    </div>`;
  $('#theme-btn').onclick = toggleTheme;
}

function toggleTheme() {
  const root = document.documentElement;
  const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const cur = root.dataset.theme || (sysDark ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  store.set('theme', next);
  try { localStorage.setItem('sb.theme', next); } catch { /* ignore */ }
  renderNav(resolve(parse()).key);
}
window.__toggleTheme = toggleTheme;

$('#sheet-backdrop').addEventListener('click', () => sheet.close());
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheet.isOpen()) sheet.close(); });
window.addEventListener('hashchange', render);
window.addEventListener('favs', () => renderNav(resolve(parse()).key));

// swipe-down to close the bottom sheet on phones
(() => {
  const s = $('#sheet');
  let y0 = null;
  s.addEventListener('touchstart', e => { y0 = s.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  s.addEventListener('touchmove', e => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0;
    if (dy > 0) s.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  s.addEventListener('touchend', e => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0;
    s.style.transform = '';
    if (dy > 110) sheet.close();
    y0 = null;
  });
})();

render();
