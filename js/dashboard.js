'use strict';

/* ============================================================
   dashboard.js — Overview tab: period selector (current vs last),
   KPI header cards, filters, trend, hierarchy drill-down,
   two-dimension comparison, top movers, data table.
   ============================================================ */

function showView(which) {
  $('#upload-view').hidden = which !== 'upload';
  $('#dashboard-view').hidden = which !== 'dashboard';
  $('#topbar-actions').hidden = which !== 'dashboard';
  $('#tabs').hidden = which !== 'dashboard';
}

function destroyChart(key) {
  if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
}

/* per-chart display prefs (data labels & legend) */
function prefFor(key) {
  if (!state.chartPrefs[key]) state.chartPrefs[key] = { labels: false, legend: true };
  return state.chartPrefs[key];
}

/* data-label settings per chart kind, honouring the per-chart toggle */
function dlOpts(kind, on) {
  if (!on) return { display: false };
  const themeText = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
  const base = {
    display: true,
    color: themeText || '#cdd5e0',
    font: { size: 10, weight: '600' },
    clamp: true,
    formatter: v => (v === null || v === undefined || v === 0) ? '' : nfCompact.format(v),
  };
  if (kind === 'stack') return { ...base, anchor: 'center', align: 'center' };
  if (kind === 'hbar')  return { ...base, anchor: 'end', align: 'end' };
  if (kind === 'line')  return { ...base, anchor: 'end', align: 'top', offset: 2 };
  if (kind === 'pie')   return { ...base, anchor: 'center', align: 'center', color: '#fff' };
  return { ...base, anchor: 'end', align: 'end' };          // vertical bars
}

function chartOpts({ y = false, legend = true, stacked = false, onClick = null, dl = 'bar', hbar = false, pie = false, prefKey = null } = {}) {
  const prefs = prefKey ? prefFor(prefKey) : { labels: false, legend: true };
  const legendConf = { display: legend && prefs.legend, labels: { boxWidth: 12 } };
  const dlConf = dlOpts(pie ? 'pie' : dl, prefs.labels);
  if (pie) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      onClick: onClick || undefined,
      plugins: { legend: legendConf, datalabels: dlConf },
    };
  }
  const valueScale = { beginAtZero: true, stacked, grid: { color: 'rgba(255,255,255,.06)' },
                        ticks: { callback: v => nfCompact.format(v) } };
  const catScale = { grid: { display: false }, stacked };
  return {
    responsive: true,
    maintainAspectRatio: false,
    onClick: onClick || undefined,
    indexAxis: hbar ? 'y' : 'x',
    plugins: { legend: legendConf, datalabels: dlConf },
    scales: hbar
      ? { x: y ? valueScale : undefined, y: catScale }
      : { x: catScale, y: y ? valueScale : undefined },
  };
}

/* ---------- dynamic chart types ---------- */
const CHART_TYPE_OPTIONS = {
  trend:     [['auto', 'Auto'], ['line', 'Line'], ['area', 'Area'], ['bar', 'Bar']],
  drill:     [['auto', 'Auto'], ['bar', 'Bar'], ['hbar', 'Horizontal bar'], ['line', 'Line'], ['pie', 'Pie'], ['doughnut', 'Doughnut']],
  compare:   [['auto', 'Auto (stacked)'], ['stacked', 'Stacked bar'], ['grouped', 'Grouped bar'], ['hbar', 'Horizontal bar'], ['line', 'Line'], ['pie', 'Pie']],
  ddTrend:   [['auto', 'Auto'], ['line', 'Line'], ['area', 'Area'], ['bar', 'Bar']],
  ddCompare: [['auto', 'Auto (stacked)'], ['stacked', 'Stacked bar'], ['grouped', 'Grouped bar'], ['hbar', 'Horizontal bar'], ['line', 'Line'], ['pie', 'Pie']],
  ddDim:     [['auto', 'Auto (horizontal bar)'], ['bar', 'Vertical bar'], ['hbar', 'Horizontal bar'], ['line', 'Line'], ['pie', 'Pie'], ['doughnut', 'Doughnut']],
};
const CHART_TYPE_SELECTORS = {
  trend: '#chart-trend-type', drill: '#chart-drill-type', compare: '#chart-compare-type',
  ddTrend: '#chart-ddtrend-type', ddCompare: '#chart-ddcompare-type', ddDim: '#chart-dddim-type',
};

function setupChartTypeSelect(key) {
  const sel = $(CHART_TYPE_SELECTORS[key]);
  if (!sel) return;
  if (!sel.dataset.wired) {
    for (const [v, l] of CHART_TYPE_OPTIONS[key]) {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = l;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      state.chartTypes[key] = sel.value;
      saveSession();
      refreshAll();
    });
    sel.dataset.wired = '1';

    // per-chart display toggles next to the type selector
    const tg = document.createElement('span');
    tg.className = 'chart-toggles';
    tg.id = 'toggles-' + key;
    for (const [prop, text] of [['labels', 'Labels'], ['legend', 'Legend']]) {
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.prop = prop;
      cb.addEventListener('change', () => {
        prefFor(key)[prop] = cb.checked;
        saveSession();
        refreshAll();
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(text));
      tg.appendChild(lab);
    }
    sel.parentElement.insertBefore(tg, sel);
  }
  sel.value = state.chartTypes[key] || 'auto';
  const prefs = prefFor(key);
  for (const cb of $('#toggles-' + key).querySelectorAll('input'))
    cb.checked = !!prefs[cb.dataset.prop];
}

/* turns a resolved chart-type id into Chart.js config pieces */
function shapeForType(type, labels, datasets, pieValues) {
  switch (type) {
    case 'hbar':  return { chartType: 'bar',  hbar: true,  isPie: false, datasets };
    case 'area':  return { chartType: 'line', hbar: false, isPie: false, datasets: datasets.map(d => ({ ...d, fill: true })) };
    case 'line':  return { chartType: 'line', hbar: false, isPie: false, datasets: datasets.map(d => ({ ...d, fill: false })) };
    case 'pie':
    case 'doughnut': {
      const values = pieValues || (datasets[0] ? datasets[0].data : []);
      return {
        chartType: type, hbar: false, isPie: true,
        datasets: [{ data: values, backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]) }],
      };
    }
    default: return { chartType: 'bar', hbar: false, isPie: false, datasets }; // bar / stacked / grouped
  }
}

/* ---------- multi-select dropdown (used for "Measures on charts") ---------- */
function renderMultiSelect(container, items, selectedIds, labelFn, onToggle) {
  container.innerHTML = '';
  const dd = document.createElement('div');
  dd.className = 'ms-dropdown';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ms-button';
  const summary = selectedIds.length === 1
    ? labelFn(items.find(i => i.id === selectedIds[0]) || items[0])
    : `${selectedIds.length} measures selected`;
  btn.innerHTML = `<span>${escapeHtml(summary)}</span><span class="caret">▾</span>`;

  const panel = document.createElement('div');
  panel.className = 'ms-panel';
  panel.hidden = true;

  for (const item of items) {
    const opt = document.createElement('label');
    opt.className = 'ms-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selectedIds.includes(item.id);
    cb.addEventListener('change', () => onToggle(item.id, cb.checked));
    const span = document.createElement('span');
    span.textContent = labelFn(item);
    opt.appendChild(cb);
    opt.appendChild(span);
    panel.appendChild(opt);
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });
  document.addEventListener('click', e => {
    if (!panel.hidden && !dd.contains(e.target)) panel.hidden = true;
  });

  dd.appendChild(btn);
  dd.appendChild(panel);
  container.appendChild(dd);
}

/* the KPIs currently selected for plotting (multi-select, ≥1) */
function chartKpiObjs() {
  state.chartKpis = (state.chartKpis || []).filter(id => state.kpis.some(k => k.id === id));
  if (!state.chartKpis.length && state.activeKpi) state.chartKpis = [state.activeKpi];
  return state.chartKpis.map(kpiById).filter(Boolean);
}

function buildDashboard() {
  showView('dashboard');
  $('#file-chip').textContent = state.fileName || 'data';
  if (!state.activeKpi || !state.kpis.some(k => k.id === state.activeKpi))
    state.activeKpi = state.kpis[0]?.id || null;
  chartKpiObjs();          // sanitize the multi-select against current KPIs
  computeGroups();
  if (state.drill.g >= state.groups.length) state.drill = { g: 0, path: [] };
  renderPeriodBar();
  renderFilterBar();
  refreshAll();
}

function refreshAll() {
  if ($('#dashboard-view').hidden) return;
  const windows = periodWindows();
  const recs = baseFiltered();

  $('#dash-meta').innerHTML =
    `<b>${nf.format(recs.length)}</b> of <b>${nf.format(state.records.length)}</b> included rows in scope` +
    (state.excluded ? ` · <b>${nf.format(state.excluded)}</b> rows excluded by include-flag` : '') +
    (windows
      ? ` · comparing <b>${periodLabel()}</b>${state.period.mode === 'rolling' ? ' (anchored to latest data point)' : ''}`
      : ' · no date mapped — totals shown without period comparison');

  renderKpiHeader(recs, windows);

  const activeTab = $('#tabs button.active')?.dataset.tab || 'overview';
  if (activeTab === 'overview') refreshOverview(recs, windows);
  else if (activeTab === 'deepdive') refreshDeepdive();
  else renderMasterTab();
}

/* ---------- period bar ---------- */
/* keep the user-picked last period in sync with the current one until
   the user edits it explicitly */
function syncLastPeriod() {
  const p = state.period;
  if (!p.from || !p.to) return;
  const curS = +p.from;
  const len = (+p.to + 86400000) - curS;
  p.lastTo = new Date(curS - 86400000);
  p.lastFrom = new Date(curS - len);
}

function dateItem(label, value, onPick, { min = null, max = null } = {}) {
  const item = document.createElement('div');
  item.className = 'filter-item';
  item.innerHTML = `<label>${escapeHtml(label)}</label>`;
  const inp = document.createElement('input');
  inp.type = 'date';
  if (min) inp.min = min;
  if (max) inp.max = max;
  if (value) inp.value = isoLocal(value);
  inp.addEventListener('change', () => {
    if (inp.value) onPick(new Date(inp.value + 'T00:00:00'));
  });
  item.appendChild(inp);
  return item;
}

function renderPeriodBar() {
  const bar = $('#period-bar');
  bar.innerHTML = '';
  const dCols = datetimeCols();

  if (dCols.length) {
    if (dCols.length > 1) {
      const item = document.createElement('div');
      item.className = 'filter-item';
      item.innerHTML = '<label>Time axis</label>';
      const sel = document.createElement('select');
      for (const c of dCols) {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        if (c === state.sel.dateCol) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => { state.sel.dateCol = sel.value; renderPeriodBar(); refreshAll(); });
      item.appendChild(sel);
      bar.appendChild(item);
    }

    // mode: rolling vs pick-your-own periods
    const modeItem = document.createElement('div');
    modeItem.className = 'filter-item';
    modeItem.innerHTML = '<label>Analysis period</label>';
    const modeSel = document.createElement('select');
    for (const [v, l] of [['rolling', 'Rolling periods'], ['custom', 'Pick custom periods']]) {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = l;
      if (state.period.mode === v) opt.selected = true;
      modeSel.appendChild(opt);
    }
    modeSel.addEventListener('change', () => {
      state.period.mode = modeSel.value;
      saveSession();
      renderPeriodBar();
      refreshAll();
    });
    modeItem.appendChild(modeSel);
    bar.appendChild(modeItem);

    if (state.period.mode === 'rolling') {
      const nItem = document.createElement('div');
      nItem.className = 'filter-item';
      nItem.innerHTML = '<label>Current period = last</label>';
      const row = document.createElement('div');
      row.className = 'filter-item inline-row';
      const nInp = document.createElement('input');
      nInp.type = 'number';
      nInp.min = 1;
      nInp.value = state.period.n;
      nInp.addEventListener('change', () => {
        state.period.n = Math.max(1, +nInp.value || 1);
        saveSession();
        refreshAll();
      });
      const uSel = document.createElement('select');
      for (const u of PERIOD_UNITS) {
        const opt = document.createElement('option');
        opt.value = u; opt.textContent = u + 's';
        if (u === state.period.unit) opt.selected = true;
        uSel.appendChild(opt);
      }
      uSel.addEventListener('change', () => { state.period.unit = uSel.value; saveSession(); refreshAll(); });
      row.appendChild(nInp);
      row.appendChild(uSel);
      nItem.appendChild(row);
      bar.appendChild(nItem);

      const note = document.createElement('div');
      note.className = 'period-note';
      note.textContent = 'vs the equal period before it';
      bar.appendChild(note);
    } else {
      let lo = Infinity, hi = -Infinity;
      const dc = state.sel.dateCol;
      for (const r of state.records) {
        const d = r.__dates[dc];
        if (d) { const t = +d; if (t < lo) lo = t; if (t > hi) hi = t; }
      }
      if (lo !== Infinity) {
        const p = state.period;
        if (!p.from) p.from = new Date(new Date(hi).getFullYear(), new Date(hi).getMonth(), 1);
        if (!p.to) p.to = new Date(hi);
        if (!p.lastFrom || !p.lastTo) syncLastPeriod();
        const maxIso = isoLocal(new Date(hi));

        // current period — user picked
        bar.appendChild(dateItem('Current from', p.from, d => {
          p.from = d;
          if (!p.lastTouched) syncLastPeriod();
          saveSession(); renderPeriodBar(); refreshAll();
        }, { max: maxIso }));
        bar.appendChild(dateItem('Current to', p.to, d => {
          p.to = d;
          if (!p.lastTouched) syncLastPeriod();
          saveSession(); renderPeriodBar(); refreshAll();
        }, { max: maxIso }));

        // last period — user picked too
        bar.appendChild(dateItem('Last from', p.lastFrom, d => {
          p.lastFrom = d; p.lastTouched = true;
          saveSession(); refreshAll();
        }, { max: maxIso }));
        bar.appendChild(dateItem('Last to', p.lastTo, d => {
          p.lastTo = d; p.lastTouched = true;
          saveSession(); refreshAll();
        }, { max: maxIso }));

        const note = document.createElement('div');
        note.className = 'period-note';
        note.textContent = p.lastTouched
          ? 'last period set manually'
          : 'last period auto-follows (edit it to take over)';
        bar.appendChild(note);
      }
    }

    // trend granularity
    const gItem = document.createElement('div');
    gItem.className = 'filter-item';
    gItem.innerHTML = '<label>Trend granularity</label>';
    const gSel = document.createElement('select');
    for (const g of ['auto', 'hour', 'day', 'week', 'month', 'year']) {
      const opt = document.createElement('option');
      opt.value = g; opt.textContent = g === 'auto' ? 'Auto' : 'By ' + g;
      if (g === state.gran) opt.selected = true;
      gSel.appendChild(opt);
    }
    gSel.addEventListener('change', () => { state.gran = gSel.value; refreshAll(); });
    gItem.appendChild(gSel);
    bar.appendChild(gItem);
  }

  // measures plotted on charts (multi-select dropdown)
  if (state.kpis.length) {
    chartKpiObjs();
    const item = document.createElement('div');
    item.className = 'filter-item';
    item.innerHTML = '<label>Measures on charts</label>';
    const holder = document.createElement('div');
    item.appendChild(holder);
    renderMultiSelect(holder, state.kpis, state.chartKpis, kpiLabel, (id, checked) => {
      if (checked) {
        if (!state.chartKpis.includes(id)) state.chartKpis.push(id);
      } else if (state.chartKpis.length > 1) {
        state.chartKpis = state.chartKpis.filter(x => x !== id);
        if (state.activeKpi === id) state.activeKpi = state.chartKpis[0];
      }
      saveSession();
      renderPeriodBar();
      refreshAll();
    });
    bar.appendChild(item);
  }
}

/* ---------- KPI header (all measures/KPIs, click to focus) ---------- */
function renderKpiHeader(recs, windows) {
  const row = $('#kpi-row');
  row.innerHTML = '';
  const curRecs = recsInWindow(recs, windows ? windows.cur : null);
  const prevRecs = windows ? recsInWindow(recs, windows.prev) : null;

  for (const k of state.kpis) {
    const cur = evalKpiOn(curRecs, k);
    const prev = prevRecs ? evalKpiOn(prevRecs, k) : null;
    const card = document.createElement('div');
    card.className = 'kpi' + (k.id === state.activeKpi ? ' active' : '');
    card.innerHTML = `
      <div class="kpi-label" title="${escapeHtml(kpiLabel(k))}">${escapeHtml(kpiLabel(k))}</div>
      <div class="kpi-value">${fmtNum(cur)}</div>
      <div class="kpi-sub">${windows ? deltaHtml(cur, prev) + ` <span class="muted">vs ${fmtNum(prev)}</span>` : 'total in scope'}</div>`;
    card.addEventListener('click', () => {
      state.activeKpi = k.id;
      state.chartKpis = [k.id];      // focus charts on this KPI; add more via the chips
      saveSession();
      renderPeriodBar();
      refreshAll();
    });
    row.appendChild(card);
  }
}

/* ---------- dimension filters ---------- */
function renderFilterBar() {
  const bar = $('#filter-bar');
  bar.innerHTML = '';
  for (const g of state.groups) {
    for (const d of g.dims) {
      const members = (state.masterData[d] || []).map(e => e.member);
      const item = document.createElement('div');
      item.className = 'filter-item';
      const tag = g.dims.length > 1 ? ` (H${levelOf(d)})` : '';
      item.innerHTML = `<label>Dim ${dimNumber(d)} · ${escapeHtml(d)}${tag}</label>`;
      const sel = document.createElement('select');
      sel.innerHTML = `<option value="__all__">All (${members.length})</option>` +
        members.slice(0, 500).map(v => `<option value="${escapeHtml(v)}"${state.filters[d] === v ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
      sel.addEventListener('change', () => { state.filters[d] = sel.value; refreshAll(); });
      item.appendChild(sel);
      bar.appendChild(item);
    }
  }
}

/* ---------- overview tab ---------- */
function refreshOverview(recs, windows) {
  renderTrendChart('chart-trend', '#trend-title', recs, chartKpiObjs(), windows, 'trend');
  renderDrill(recs, windows);
  renderCompareSection(recs, windows);
  renderMovers(recs, windows);
  renderDataTable(recs, windows);
}

/* shared trend renderer (also used by deep-dive); accepts one KPI or a list.
   With 2+ KPIs the first goes on the left axis and the rest on a right axis. */
function renderTrendChart(canvasId, titleSel, recs, kpis, windows, typeKey) {
  destroyChart(canvasId);
  setupChartTypeSelect(typeKey);
  const list = (Array.isArray(kpis) ? kpis : [kpis]).filter(Boolean);
  const card = $('#' + canvasId).closest('.card');
  if (!windows || !list.length) { card.hidden = true; return; }
  card.hidden = false;

  const dc = state.sel.dateCol;
  const adjacent = Math.abs(windows.prev[1] - windows.cur[0]) < 1000;
  const span = adjacent
    ? windows.cur[1] - windows.prev[0]
    : Math.max(windows.cur[1] - windows.cur[0], windows.prev[1] - windows.prev[0]);
  const unit = state.gran !== 'auto' ? state.gran : chooseBucketUnit(span);

  const curB = new Map(), prevB = new Map();
  for (const r of recs) {
    const d = r.__dates[dc];
    if (!d) continue;
    const t = +d;
    let target = null;
    if (t >= windows.cur[0] && t < windows.cur[1]) target = curB;
    else if (t >= windows.prev[0] && t < windows.prev[1]) target = prevB;
    if (!target) continue;
    const key = bucketKey(d, unit);
    if (!target.has(key)) target.set(key, []);
    target.get(key).push(r);
  }

  const multi = list.length > 1;
  const datasets = [];
  let labels;

  if (adjacent) {
    // contiguous periods: one real time axis
    const keys = [...new Set([...curB.keys(), ...prevB.keys()])].sort();
    labels = keys.map(k => bucketLabel(k, unit));
    list.forEach((kpi, i) => {
      const color = PALETTE[i % PALETTE.length];
      const pr = keys.length > 60 ? 0 : 3;
      datasets.push({
        label: multi ? `${kpiLabel(kpi)} — current` : 'Current period',
        data: keys.map(k => curB.has(k) ? evalKpiOn(curB.get(k), kpi) : null),
        borderColor: color, backgroundColor: color + '26',
        fill: !multi, tension: .3, pointRadius: pr, spanGaps: false,
        yAxisID: i === 0 ? 'y' : 'y1',
      });
      datasets.push({
        label: multi ? `${kpiLabel(kpi)} — last` : 'Last period',
        data: keys.map(k => prevB.has(k) ? evalKpiOn(prevB.get(k), kpi) : null),
        borderColor: multi ? color + '88' : '#98a2b3', borderDash: [5, 4],
        fill: false, tension: .3, pointRadius: keys.length > 60 ? 0 : 2, spanGaps: false,
        yAxisID: i === 0 ? 'y' : 'y1',
      });
    });
  } else {
    // user picked disjoint periods (e.g. May 2025 vs May 2024):
    // align both periods position-by-position so they overlay
    const curArr = [...curB.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
    const prevArr = [...prevB.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
    const n = Math.max(curArr.length, prevArr.length);
    labels = Array.from({ length: n }, (_, i) => {
      const c = curArr[i] ? bucketLabel(curArr[i][0], unit) : '';
      const p = prevArr[i] ? bucketLabel(prevArr[i][0], unit) : '';
      return c && p ? `${c} ∣ ${p}` : (c || p);
    });
    list.forEach((kpi, i) => {
      const color = PALETTE[i % PALETTE.length];
      datasets.push({
        label: `${kpiLabel(kpi)} — current`,
        data: Array.from({ length: n }, (_, j) => curArr[j] ? evalKpiOn(curArr[j][1], kpi) : null),
        borderColor: color, backgroundColor: color + '26',
        fill: !multi, tension: .3, pointRadius: n > 60 ? 0 : 3, spanGaps: false,
        yAxisID: i === 0 ? 'y' : 'y1',
      });
      datasets.push({
        label: `${kpiLabel(kpi)} — last`,
        data: Array.from({ length: n }, (_, j) => prevArr[j] ? evalKpiOn(prevArr[j][1], kpi) : null),
        borderColor: multi ? color + '88' : '#98a2b3', borderDash: [5, 4],
        fill: false, tension: .3, pointRadius: n > 60 ? 0 : 2, spanGaps: false,
        yAxisID: i === 0 ? 'y' : 'y1',
      });
    });
  }

  $(titleSel).textContent =
    `${list.map(kpiLabel).join(' · ')} by ${unit} — current vs last period` +
    (adjacent ? '' : ' (periods overlaid)');

  const userType = state.chartTypes[typeKey] || 'auto';
  const resolved = userType === 'auto' ? 'line' : userType;
  const shaped = shapeForType(resolved, labels, datasets);
  const dl = shaped.chartType === 'line' ? 'line' : 'bar';
  const opts = shaped.isPie
    ? chartOpts({ pie: true, dl: 'pie', prefKey: typeKey })
    : chartOpts({ y: true, dl, hbar: shaped.hbar, prefKey: typeKey });
  if (multi && !shaped.isPie && !shaped.hbar) {
    opts.scales.y1 = { beginAtZero: true, position: 'right', grid: { display: false },
                       ticks: { callback: v => nfCompact.format(v) } };
  }
  state.charts[canvasId] = new Chart($('#' + canvasId), {
    type: shaped.chartType,
    data: { labels, datasets: shaped.datasets },
    options: opts,
  });
}

/* ---------- drill-down ---------- */
function renderDrill(recs, windows) {
  const card = $('#card-drill');
  destroyChart('chart-drill');
  setupChartTypeSelect('drill');
  if (!state.groups.length) { card.hidden = true; return; }
  card.hidden = false;

  // group selector
  const gSel = $('#drill-group');
  gSel.innerHTML = '';
  state.groups.forEach((g, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = g.name;
    if (i === state.drill.g) opt.selected = true;
    gSel.appendChild(opt);
  });
  gSel.onchange = () => { state.drill = { g: +gSel.value, path: [] }; refreshAll(); };

  const group = state.groups[state.drill.g];
  const dims = group.dims;
  const depth = state.drill.path.length;
  const dim = dims[Math.min(depth, dims.length - 1)];
  const kpis = chartKpiObjs();
  const kpi = kpis[0];

  // breadcrumb
  const bc = $('#drill-breadcrumb');
  bc.innerHTML = `<span class="crumb root">${escapeHtml(group.name)}</span>`;
  state.drill.path.forEach((p, i) => {
    const c = document.createElement('span');
    c.className = 'crumb';
    c.innerHTML = `${escapeHtml(p.col)}: ${escapeHtml(p.member)} <button title="Remove">✕</button>`;
    c.querySelector('button').addEventListener('click', () => {
      state.drill.path = state.drill.path.slice(0, i);
      refreshAll();
    });
    bc.appendChild(c);
  });
  if (depth < dims.length - 1) {
    const hint = document.createElement('span');
    hint.className = 'crumb-hint';
    hint.textContent = `click a bar to drill into ${dims[depth + 1]}`;
    bc.appendChild(hint);
  }

  // records narrowed by drill path
  let scoped = recs;
  for (const p of state.drill.path) scoped = scoped.filter(r => r[p.col] === p.member);

  const vals = memberValues(scoped, dim, kpi, windows);
  const top = vals.slice(0, 12);
  const labels = top.map(v => v.member);
  let datasets;

  if (kpis.length > 1) {
    // several measures: one bar series per measure (current period values)
    const groups = memberGroups(scoped, dim, windows);
    datasets = kpis.map((k, i) => ({
      label: kpiLabel(k),
      data: labels.map(m => evalKpiOn(groups.get(m)?.cur || [], k) ?? 0),
      backgroundColor: PALETTE[i % PALETTE.length],
      borderRadius: 5,
    }));
    $('#drill-title').textContent = `${kpis.map(kpiLabel).join(' · ')} by ${dim} (H${dims.indexOf(dim) + 1})`;
  } else {
    datasets = [{
      label: 'Current', data: top.map(v => v.cur),
      backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]), borderRadius: 5,
    }];
    if (windows) datasets.push({
      label: 'Last period', data: top.map(v => v.prev ?? 0),
      backgroundColor: 'rgba(152,162,179,.35)', borderRadius: 5,
    });
    $('#drill-title').textContent = `${kpiLabel(kpi)} by ${dim} (H${dims.indexOf(dim) + 1})`;
  }

  const onClick = (evt, els) => {
    if (!els.length) return;
    if (state.drill.path.length >= dims.length - 1) return;   // deepest level
    const member = labels[els[0].index];
    state.drill.path.push({ col: dim, member });
    refreshAll();
  };

  const userType = state.chartTypes.drill || 'auto';
  const resolved = userType === 'auto' ? 'bar' : userType;
  const shaped = shapeForType(resolved, labels, datasets);
  const dl = shaped.chartType === 'line' ? 'line' : 'bar';
  const opts = shaped.isPie
    ? chartOpts({ pie: true, dl: 'pie', onClick, prefKey: 'drill' })
    : chartOpts({ y: true, legend: !!windows || kpis.length > 1, dl, hbar: shaped.hbar, onClick, prefKey: 'drill' });

  state.charts['chart-drill'] = new Chart($('#chart-drill'), {
    type: shaped.chartType,
    data: { labels, datasets: shaped.datasets },
    options: opts,
  });
}

/* ---------- compare two dimensions ---------- */
function fillDimSelect(sel, current, exclude) {
  sel.innerHTML = '';
  for (const g of state.groups) {
    for (const d of g.dims) {
      if (d === exclude) continue;
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = g.dims.length > 1 ? `${d} (H${levelOf(d)} of ${g.dims[0]})` : d;
      if (d === current) opt.selected = true;
      sel.appendChild(opt);
    }
  }
}

function renderCompareSection(recs, windows) {
  const card = $('#card-compare');
  destroyChart('chart-compare');
  const allDims = state.groups.flatMap(g => g.dims);
  if (allDims.length < 2) { card.hidden = true; return; }
  card.hidden = false;

  if (!state.compare.a || !allDims.includes(state.compare.a)) state.compare.a = state.groups[0].dims[0];
  if (!state.compare.b || !allDims.includes(state.compare.b) || state.compare.b === state.compare.a)
    state.compare.b = allDims.find(d => d !== state.compare.a);

  const aSel = $('#compare-a'), bSel = $('#compare-b');
  fillDimSelect(aSel, state.compare.a, null);
  fillDimSelect(bSel, state.compare.b, state.compare.a);
  aSel.onchange = () => { state.compare.a = aSel.value; if (state.compare.b === aSel.value) state.compare.b = null; refreshAll(); };
  bSel.onchange = () => { state.compare.b = bSel.value; refreshAll(); };

  renderCompareChart('chart-compare', recs, kpiById(state.activeKpi), windows, state.compare.a, state.compare.b, 'compare');
}

/* shared: stacked bars of KPI by dimension A split by dimension B (current period) */
function renderCompareChart(canvasId, recs, kpi, windows, colA, colB, typeKey) {
  destroyChart(canvasId);
  setupChartTypeSelect(typeKey);
  const cur = recsInWindow(recs, windows ? windows.cur : null);

  const byA = new Map();
  for (const r of cur) {
    const a = r[colA] ?? '(blank)', b = r[colB] ?? '(blank)';
    if (!byA.has(a)) byA.set(a, new Map());
    const byB = byA.get(a);
    if (!byB.has(b)) byB.set(b, []);
    byB.get(b).push(r);
  }

  // top A members by total
  const totals = [...byA.entries()].map(([a, byB]) =>
    [a, evalKpiOn([...byB.values()].flat(), kpi) ?? 0]).sort((x, y) => y[1] - x[1]);
  const aMembers = totals.slice(0, 8).map(e => e[0]);

  // top B members overall
  const bTotals = new Map();
  for (const [, byB] of byA)
    for (const [b, rs] of byB) bTotals.set(b, (bTotals.get(b) || 0) + rs.length);
  const bMembers = [...bTotals.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(e => e[0]);

  const datasets = bMembers.map((b, i) => ({
    label: String(b),
    data: aMembers.map(a => {
      const rs = byA.get(a)?.get(b);
      return rs ? evalKpiOn(rs, kpi) ?? 0 : 0;
    }),
    backgroundColor: PALETTE[i % PALETTE.length],
    borderRadius: 3,
  }));

  const userType = state.chartTypes[typeKey] || 'auto';
  const resolved = userType === 'auto' ? 'stacked' : userType;
  const stacked = resolved === 'stacked';
  const labels = aMembers.map(String);
  const pieValues = aMembers.map(a => totals.find(([m]) => m === a)?.[1] ?? 0);
  const shaped = shapeForType(resolved, labels, datasets, pieValues);
  const dl = shaped.isPie ? 'pie' : stacked ? 'stack' : shaped.chartType === 'line' ? 'line' : 'bar';
  const opts = shaped.isPie
    ? chartOpts({ pie: true, dl, prefKey: typeKey })
    : chartOpts({ y: true, stacked, dl, hbar: shaped.hbar, prefKey: typeKey });

  state.charts[canvasId] = new Chart($('#' + canvasId), {
    type: shaped.chartType,
    data: { labels, datasets: shaped.datasets },
    options: opts,
  });
}

/* ---------- movers ---------- */
function renderMovers(recs, windows) {
  const card = $('#card-movers');
  const allDims = state.groups.flatMap(g => g.dims);
  if (!windows || !allDims.length) { card.hidden = true; return; }
  card.hidden = false;

  const sel = $('#movers-dim');
  if (!allDims.includes(sel.value)) sel.value = '';
  fillDimSelect(sel, sel.value || allDims[0], null);
  sel.onchange = () => refreshAll();
  const dim = sel.value || allDims[0];

  const kpi = kpiById(state.activeKpi);
  const rows = movers(recs, dim, kpi, windows).slice(0, 12);

  $('#movers-table').innerHTML =
    `<thead><tr><th>${escapeHtml(dim)}</th><th>Last</th><th>Current</th><th>Change</th></tr></thead><tbody>` +
    rows.map(r => `<tr>
      <td title="${escapeHtml(r.member)}">${escapeHtml(r.member)}</td>
      <td>${fmtNum(r.prev)}</td>
      <td>${fmtNum(r.cur)}</td>
      <td>${deltaHtml(r.cur, r.prev ?? null)}</td>
    </tr>`).join('') +
    '</tbody>';
}

/* ---------- data table ---------- */
function tableColumns() {
  const cols = [];
  for (const c of datetimeCols()) cols.push({ name: c, role: 'Date/Time', cls: '' });
  for (const g of state.groups) {
    for (const d of g.dims) {
      const tag = g.dims.length > 1 ? ` · H${levelOf(d)}` : '';
      cols.push({ name: d, role: `Dimension ${dimNumber(d)}${tag}`, cls: '' });
    }
  }
  for (const m of state.measureOrder)
    cols.push({ name: m, role: `Measure ${measureNumber(m)}`, cls: 'num' });
  return cols;
}

function renderDataTable(recs, windows) {
  const cur = recsInWindow(recs, windows ? windows.cur : null);
  const cols = tableColumns();
  const limit = 100;
  $('#table-title').textContent = windows
    ? `Mapped data — first ${Math.min(limit, cur.length)} of ${nf.format(cur.length)} rows in the current period`
    : `Mapped data — first ${Math.min(limit, cur.length)} of ${nf.format(cur.length)} rows`;

  $('#data-table').innerHTML =
    '<thead><tr>' +
    cols.map(c => `<th>${escapeHtml(c.name)}<span class="th-role">${escapeHtml(c.role)}</span></th>`).join('') +
    '</tr></thead><tbody>' +
    cur.slice(0, limit).map(r => '<tr>' + cols.map(c => {
      let v = r[c.name];
      if (v instanceof Date) v = v.toLocaleDateString();
      else if (typeof v === 'number') v = nf.format(v);
      else if (v === null || v === undefined) v = '';
      return `<td class="${c.cls}">${escapeHtml(v)}</td>`;
    }).join('') + '</tr>').join('') +
    '</tbody>';
}
