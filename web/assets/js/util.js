// ── DOM / formatting helpers ───────────────────────────────────────────
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const P = {
  bus: '<path d="M8 6v6M16 6v6M2 12h20M7 18h10"/><rect x="4" y="3" width="16" height="16" rx="3"/><path d="M6 19v2M18 19v2"/><circle cx="8" cy="15.5" r=".6" fill="currentColor"/><circle cx="16" cy="15.5" r=".6" fill="currentColor"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1-4.5-4.2 6.1-.8z"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  route: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H17a3.5 3.5 0 0 0 0-7H7a3.5 3.5 0 0 1 0-7h8.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-6"/>',
  activity: '<path d="M22 12h-4l-3 8L9 4l-3 8H2"/>',
  swap: '<path d="M7 4v16M7 4 3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4"/>',
  back: '<path d="M15 18 9 12l6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  locate: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="m9 21 2-6 3 3v3M7 12l2-4 4-1 3 4 3 1M11 15l-1-5"/>',
  flag: '<path d="M4 21V4M4 4h12l-2 4 2 4H4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  home: '<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  map: '<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
};

export function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

export function badge(route, color, size = '') {
  return `<span class="badge ${esc(color)} ${size}">${esc(route)}</span>`;
}

export const pad = n => String(n).padStart(2, '0');

export function clockStr(ts) {
  const d = new Date(ts * 1000);
  // Always show Macau time (UTC+8), whatever the viewer's zone.
  const m = new Date(d.getTime() + (d.getTimezoneOffset() + 480) * 60000);
  return `${pad(m.getHours())}:${pad(m.getMinutes())}`;
}

export function todStr(min) {
  min = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export function macauNow() {
  const d = new Date();
  const m = new Date(d.getTime() + (d.getTimezoneOffset() + 480) * 60000);
  return { tod: m.getHours() * 60 + m.getMinutes(), dow: m.getDay(), date: m };
}

export function dayType(dow) { return dow === 0 ? 2 : dow === 6 ? 1 : 0; }
export const DAYTYPES = ['工作日', '周六', '周日/假日'];

/** ETA chip parts: {v, u, now} */
export function etaParts(sec) {
  if (sec == null) return { v: '—', u: '' };
  if (sec < 40) return { v: '到站', u: '', now: true };
  if (sec < 90) return { v: '1', u: '分' };
  return { v: String(Math.round(sec / 60)), u: '分' };
}

export function durStr(sec) {
  if (sec == null) return '—';
  if (sec < 60) return `${Math.round(sec)} 秒`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} 分钟`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

export function minStr(sec) { return sec == null ? '—' : String(Math.max(0, Math.round(sec / 60))); }

export function agoStr(ts) {
  if (!ts) return '—';
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 10) return '刚刚';
  if (s < 60) return `${Math.round(s)} 秒前`;
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
  return `${Math.round(s / 3600)} 小时前`;
}

export function distStr(m) {
  if (m == null) return '';
  return m < 1000 ? `${Math.round(m / 10) * 10} 米` : `${(m / 1000).toFixed(1)} 公里`;
}

export function crowd(p) {
  if (p == null) return '';
  const l = p <= 1 ? 1 : p <= 3 ? 2 : 3;
  const t = ['', '宽松', '适中', '拥挤'][l];
  return `<span class="crowd l${l}" title="${t}"><i></i><i></i><i></i></span>`;
}

// ── storage ────────────────────────────────────────────────────────────
export const store = {
  get(k, d) { try { const v = localStorage.getItem('sb.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sb.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

export const favs = {
  all() { return store.get('favs', []); },
  has(id) { return this.all().some(f => f.id === id); },
  toggle(item) {
    let list = this.all();
    const on = list.some(f => f.id === item.id);
    list = on ? list.filter(f => f.id !== item.id) : [item, ...list];
    store.set('favs', list.slice(0, 40));
    window.dispatchEvent(new Event('favs'));
    return !on;
  },
};

// ── UI bits ────────────────────────────────────────────────────────────
let toastTimer;
export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

export const sheet = {
  onClose: null,
  open(html) {
    const s = $('#sheet');
    s.innerHTML = `<div class="sheet-grip"></div>${html}`;
    s.scrollTop = 0;
    requestAnimationFrame(() => { s.classList.add('open'); $('#sheet-backdrop').classList.add('open'); });
  },
  update(html) {
    const s = $('#sheet');
    const top = s.scrollTop;
    s.innerHTML = `<div class="sheet-grip"></div>${html}`;
    s.scrollTop = top;
  },
  isOpen() { return $('#sheet').classList.contains('open'); },
  close() {
    $('#sheet').classList.remove('open');
    $('#sheet-backdrop').classList.remove('open');
    const cb = this.onClose; this.onClose = null; cb && cb();
  },
};

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
