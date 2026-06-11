'use strict';

/* ============================================================
   kpi.js — "which KPIs do you want to track?" builder.
   KPI = aggregated measure, or two measures multiplied/divided.
   ============================================================ */

let kpiDraft = [];
let kpiFirstRun = false;

function openKpiModal(firstRun) {
  kpiFirstRun = !!firstRun;
  kpiDraft = (state.kpis.length ? state.kpis : defaultKpis()).map(k => ({ ...k }));
  $('#kpi-error').textContent = '';
  renderKpiList();
  $('#kpi-modal').hidden = false;
}

function closeKpiModal() { $('#kpi-modal').hidden = true; }

function renderKpiList() {
  const box = $('#kpi-list');
  box.innerHTML = '';
  if (!kpiDraft.length)
    box.innerHTML = '<p class="muted" style="margin:12px 0 0">No KPIs yet — add one below.</p>';

  kpiDraft.forEach((k, i) => {
    const row = document.createElement('div');
    row.className = 'kpi-def';

    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.placeholder = kpiLabel({ ...k, name: '' }) || 'KPI name';
    nameInp.value = k.name || '';
    nameInp.addEventListener('input', () => { k.name = nameInp.value; });
    row.appendChild(nameInp);

    const typeSel = document.createElement('select');
    for (const [v, label] of [['agg', 'Aggregate a measure'], ['product', 'Multiply two measures'], ['ratio', 'Divide two measures']]) {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = label;
      if (k.type === v) opt.selected = true;
      typeSel.appendChild(opt);
    }
    typeSel.addEventListener('change', () => {
      k.type = typeSel.value;
      if (k.type === 'agg') { k.measure = k.measure || state.measureOrder[0]; }
      else { k.a = k.a || state.measureOrder[0]; k.b = k.b || state.measureOrder[1] || state.measureOrder[0]; }
      renderKpiList();
    });
    row.appendChild(typeSel);

    const measureSel = (current, onPick) => {
      const s = document.createElement('select');
      for (const m of state.measureOrder) {
        const opt = document.createElement('option');
        opt.value = m; opt.textContent = m;
        if (m === current) opt.selected = true;
        s.appendChild(opt);
      }
      s.addEventListener('change', () => onPick(s.value));
      return s;
    };

    if (k.type === 'agg') {
      row.appendChild(measureSel(k.measure, v => { k.measure = v; }));
      const aggSel = document.createElement('select');
      for (const a in AGG_LABELS) {
        const opt = document.createElement('option');
        opt.value = a; opt.textContent = AGG_LABELS[a];
        if (a === k.agg) opt.selected = true;
        aggSel.appendChild(opt);
      }
      aggSel.addEventListener('change', () => { k.agg = aggSel.value; });
      row.appendChild(aggSel);
    } else {
      row.appendChild(measureSel(k.a, v => { k.a = v; }));
      const x = document.createElement('span');
      x.className = 'muted';
      x.textContent = k.type === 'product' ? '×' : '÷';
      row.appendChild(x);
      row.appendChild(measureSel(k.b, v => { k.b = v; }));
    }

    const rm = document.createElement('button');
    rm.className = 'kpi-remove';
    rm.title = 'Remove KPI';
    rm.textContent = '✕';
    rm.addEventListener('click', () => { kpiDraft.splice(i, 1); renderKpiList(); });
    row.appendChild(rm);

    box.appendChild(row);
  });
}

function initKpiModal() {
  $('#btn-kpi-add').addEventListener('click', () => {
    kpiDraft.push({
      id: 'k' + (Date.now() % 1e7),
      name: '',
      type: 'agg',
      measure: state.measureOrder[0],
      agg: 'sum',
      a: state.measureOrder[0],
      b: state.measureOrder[1] || state.measureOrder[0],
    });
    renderKpiList();
  });

  $('#btn-kpi-save').addEventListener('click', () => {
    if (!kpiDraft.length) { $('#kpi-error').textContent = 'Add at least one KPI.'; return; }
    state.kpis = kpiDraft.map(k => ({ ...k }));
    state.kpiConfigured = true;
    if (!state.kpis.some(k => k.id === state.activeKpi)) state.activeKpi = state.kpis[0].id;
    saveSession();
    closeKpiModal();
    buildDashboard();
  });

  $('#btn-kpi-close').addEventListener('click', () => {
    if (kpiFirstRun) {                    // skipping the first prompt = keep defaults
      if (!state.kpis.length) state.kpis = defaultKpis();
      state.kpiConfigured = true;
      saveSession();
      closeKpiModal();
      buildDashboard();
    } else {
      closeKpiModal();
    }
  });
}
