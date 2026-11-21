const cache = new Map();

async function get(path, params = {}, { ttl = 0 } = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  const url = `/api/${path}${qs ? '?' + qs : ''}`;
  if (ttl) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.t < ttl) return hit.v;
  }
  const r = await fetch(url);
  if (!r.ok) {
    let msg = `${r.status}`;
    try { msg = (await r.json()).detail || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const v = await r.json();
  v._fetched = Date.now() / 1000;
  if (ttl) cache.set(url, { t: Date.now(), v });
  return v;
}

export const api = {
  routes: () => get('routes', {}, { ttl: 15000 }),
  route: (route, dir) => get(`route/${encodeURIComponent(route)}`, { dir }),
  stop: (route, dir, idx) => get('stop', { route, dir, idx }),
  plan: (route, dir, from, to, dt, tod) => get('plan', { route, dir, from, to, dt, tod }),
  search: (q, lat, lon, limit) => get('stops/search', { q, lat, lon, limit }, { ttl: 30000 }),
  journey: (from, to) => get('journey', { from, to }),
  insights: (route, dir, dt) => get('insights', { route, dir, dt }, { ttl: 60000 }),
  status: () => get('status'),
};
