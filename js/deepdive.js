'use strict';

/* ============================================================
   deepdive.js — single-measure dashboard: pick one measure/KPI
   and see its trend plus every dimension, hierarchy and
   attribute on one page, with a two-hierarchy comparison.
   ============================================================ */

function refreshDeepdive() {
  const windows = periodWindows();
  const recs = baseFiltered();

  // KPI selector
  if (!state.dd.kpi || !state.kpis.some(k => k.id === state.dd.kpi)) state.dd.kpi = state.activeKpi;
  const kSel = $('#dd-kpi');
  kSel.innerHTML = '';
  for (const k of state.kpis) {
    const opt = document.createElement('option');
    opt.value = k.id;
    opt.textContent = kpiLabel(k);
    if (k.id === state.dd.kpi) opt.selected = true;
    kSel.appendChild(opt);
  }
  kSel.onchange = () => { state.dd.kpi = kSel.value; refreshDeepdive(); };
  const kpi = kpiById(state.dd.kpi);

  renderTrendChart('dd-trend', '#dd-trend-title', recs, kpi, windows);

  // two-hierarchy comparison
  const allDims = state.groups.flatMap(g => g.dims);
  const compareCard = $('#dd-compare').closest('.card');
  destroyChart('dd-compare');
  if (allDims.length >= 2) {
    compareCard.hidden = false;
    if (!state.dd.a || !allDims.includes(state.dd.a)) state.dd.a = state.groups[0].dims[0];
    if (!state.dd.b || !allDims.includes(state.dd.b) || state.dd.b === state.dd.a)
      state.dd.b = allDims.find(d => d !== state.dd.a);
    const aSel = $('#dd-compare-a'), bSel = $('#dd-compare-b');
    fillDimSelect(aSel, state.dd.a, null);
    fillDimSelect(bSel, state.dd.b, state.dd.a);
    aSel.onchange = () => { state.dd.a = aSel.value; if (state.dd.b === aSel.value) state.dd.b = null; refreshDeepdive(); };
    bSel.onchange = () => { state.dd.b = bSel.value; refreshDeepdive(); };
    renderCompareChart('dd-compare', recs, kpi, windows, state.dd.a, state.dd.b);
  } else {
    compareCard.hidden = true;
  }

  // one card per dimension across every hierarchy
  const grid = $('#dd-grid');
  for (const key of Object.keys(state.charts))
    if (key.startsWith('dd-dim-')) destroyChart(key);
  grid.innerHTML = '';

  let idx = 0;
  for (const g of state.groups) {
    for (const d of g.dims) {
      const canvasId = `dd-dim-${idx++}`;
      const card = document.createElement('div');
      card.className = 'card chart-card dd-dim-card';
      const tag = g.dims.length > 1 ? `<span class="dim-tag">H${levelOf(d)} of ${escapeHtml(g.dims[0])}</span>` : '';
      card.innerHTML = `<h3>Dim ${dimNumber(d)} · ${escapeHtml(d)}${tag}</h3>
        <div class="chart-wrap"><canvas id="${canvasId}"></canvas></div>`;
      grid.appendChild(card);

      const vals = memberValues(recs, d, kpi, windows).slice(0, 8);
      const labels = vals.map(v => String(v.member));
      const datasets = [{
        label: 'Current', data: vals.map(v => v.cur),
        backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]), borderRadius: 4,
      }];
      if (windows) datasets.push({
        label: 'Last period', data: vals.map(v => v.prev ?? 0),
        backgroundColor: 'rgba(152,162,179,.35)', borderRadius: 4,
      });
      state.charts[canvasId] = new Chart($('#' + canvasId), {
        type: 'bar',
        data: { labels, datasets },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: !!windows && state.chartPrefs.legend, labels: { boxWidth: 12 } },
            datalabels: dlOpts('hbar'),
          },
          scales: {
            y: { grid: { display: false } },
            x: { beginAtZero: true, grid: { color: 'rgba(255,255,255,.06)' },
                 ticks: { callback: v => nfCompact.format(v) } },
          },
        },
      });
    }
  }
}
