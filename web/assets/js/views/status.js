import { api } from '../api.js';
import { $, esc, icon, agoStr, clockStr } from '../util.js';

let timer = null;

const HORIZON_LABEL = { 0: '0–2 分钟', 2: '2–5 分钟', 5: '5–10 分钟', 10: '10–20 分钟', 20: '20–40 分钟', 40: '40 分钟以上' };

export async function mount(el) {
  el.innerHTML = `
    <div class="page-head"><div><h1 class="page-title">数据与算法</h1><div class="page-sub">采集状态、模型准确度，以及预测是怎样算出来的</div></div></div>
    <div class="stat-strip" id="kpis" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))"></div>
    <div class="grid-2">
      <section class="card card-pad">
        <div class="card-head"><div class="card-title">${icon('target')}预测准确度（近 7 日）</div></div>
        <div id="acc"></div>
        <div class="faint" style="font-size:12px;margin-top:10px">系统每分钟为每辆车预测未来各站到达时间，车到站后自动对比，统计平均绝对误差与“落在可信范围内”的比例。</div>
      </section>
      <section class="card card-pad">
        <div class="card-head"><div class="card-title">${icon('server')}采集器</div></div>
        <dl class="kv" id="collector"></dl>
      </section>
    </div>
    <section class="card card-pad prose" style="margin-top:16px">
      <div class="card-title" style="color:var(--text)">${icon('info')}算法说明</div>
      <h3>1. 直接请求，不用浏览器</h3>
      <p>DSAT 巴士报站网页的接口以 MD5 + 时间戳签名。系统直接计算签名并请求 JSON，比无头浏览器省资源数百倍，可同时覆盖全部路线。有车的路线约每 10 秒轮询一次，没车的路线降频，并设有全局限速。</p>
      <h3>2. 由位置变化推算到站 / 离站时间</h3>
      <p>每辆车的进度被拆成交替的“到达第 i 站”与“离开第 i 站”里程碑。两次轮询之间经过多个里程碑时，按各段的预期时长按比例分配时间，而不是简单地记成轮询时刻；每个时间点都附带误差估计。</p>
      <h3>3. 分段、分时段的历史模型</h3>
      <ul>
        <li>行程被拆成“停站时间”与“站间行驶时间”两类小段，分别建模。</li>
        <li>同一对相邻站点的数据在所有途经路线之间共享（路况不分路线），本路线权重较高。</li>
        <li>按工作日 / 周六 / 周日分类，时间上用 14 分钟高斯核平滑，近期数据权重更高（半衰期 21 日）。</li>
        <li>用加权直方图求 15% / 50% / 85% 分位数，天然抵抗异常值（如总站停车、坏车）。数据不足时自动收缩到全日估计与按距离推算的物理先验。</li>
      </ul>
      <h3>4. 实时路况修正</h3>
      <p>最近 45 分钟内完成的路段，若比历史慢 / 快，会生成一个拥挤系数，传播到附近路段及共用道路的其他路线；越远的未来，修正越弱。</p>
      <h3>5. 带范围的预测</h3>
      <p>沿路逐段累加时间时，会用“到达该段时”的时刻去查历史模型（跨越繁忙时段的长途也准）；误差按段累积并考虑相关性，给出预计时间与可信范围。</p>
    </section>`;
  await load();
  timer = setInterval(load, 10000);
}

export function unmount() { clearInterval(timer); }

async function load() {
  const s = await api.status();
  if (!$('#kpis')) return;
  const d = s.data;
  const kpi = (k, v, u = '') => `<div class="stat"><div class="k">${k}</div><div class="v num">${v}<small>${u}</small></div></div>`;
  const days = d.first ? Math.max(1, Math.round((s.now - d.first) / 86400)) : 0;
  $('#kpis').innerHTML = [
    kpi('运行中巴士', s.buses, '辆'),
    kpi('活跃路线方向', s.routes_active, `/${d.routes}`),
    kpi('路段样本', d.segs.toLocaleString()),
    kpi('今日新增', d.segs_today.toLocaleString()),
    kpi('数据天数', days, '日'),
  ].join('');
  $('#acc').innerHTML = s.accuracy.length ? `<table class="acc-table">
      <thead><tr><th>预测提前量</th><th>平均误差</th><th>落在范围内</th><th>样本</th></tr></thead>
      <tbody>${s.accuracy.map(a => `<tr><td>${HORIZON_LABEL[a.horizon] || a.horizon}</td>
        <td><b>${a.mae < 60 ? Math.round(a.mae) + ' 秒' : (a.mae / 60).toFixed(1) + ' 分'}</b>
          <span class="faint" style="font-size:12px">${a.bias > 0 ? '偏早' : '偏晚'} ${Math.abs(Math.round(a.bias))}s</span></td>
        <td><span class="meter"><i style="width:${a.in_band * 100}%"></i></span>${Math.round(a.in_band * 100)}%</td>
        <td class="faint">${a.n.toLocaleString()}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty" style="padding:20px">运行数分钟后开始累积准确度数据</div>';
  const up = s.upstream || {};
  $('#collector').innerHTML = `
    <dt>状态</dt><dd>${s.collecting ? '<span class="chip good">采集中</span>' : '<span class="chip">仅查询</span>'}</dd>
    <dt>启动于</dt><dd>${s.started ? clockStr(s.started) : '—'}</dd>
    <dt>上次轮询循环</dt><dd>${agoStr(s.last_cycle)}</dd>
    <dt>请求 成功 / 失败</dt><dd>${(up.ok || 0).toLocaleString()} / ${(up.fail || 0).toLocaleString()}</dd>
    <dt>本次写入样本 / 到站</dt><dd>${s.samples_written.toLocaleString()} / ${s.passes_written.toLocaleString()}</dd>
    <dt>路线资料更新</dt><dd>${agoStr(s.static_updated)}</dd>
    <dt>采集范围</dt><dd>${esc(s.config.routes)}</dd>
    <dt>轮询间隔</dt><dd>${s.config.poll_active}s / 空闲 ${s.config.poll_idle}s</dd>
    <dt>数据保留</dt><dd>${s.config.retention_days} 日</dd>
    ${up.last_error ? `<dt>最近错误</dt><dd style="font-weight:500;font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${esc(up.last_error)}">${esc(up.last_error)}</dd>` : ''}`;
}
