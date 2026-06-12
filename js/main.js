'use strict';

/* ============================================================
   main.js — tab navigation, master-data tab, global wiring.
   ============================================================ */

function switchTab(tab) {
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tab-overview').hidden = tab !== 'overview';
  $('#tab-deepdive').hidden = tab !== 'deepdive';
  $('#tab-master').hidden = tab !== 'master';
  refreshAll();
}

/* ---------- master data tab ---------- */
function renderMasterTab() {
  const grid = $('#master-grid');
  grid.innerHTML = '';
  for (const g of state.groups) {
    for (const d of g.dims) {
      const entries = state.masterData[d] || [];
      const card = document.createElement('div');
      card.className = 'card';
      const tag = g.dims.length > 1 ? `<span class="dim-tag">H${levelOf(d)} of ${escapeHtml(g.dims[0])}</span>` : '';
      const measureHead = state.measureOrder.map(m => `<th>Σ ${escapeHtml(m)}</th>`).join('');
      card.innerHTML = `
        <h3>Dim ${dimNumber(d)} · ${escapeHtml(d)}${tag}
          <span class="dim-tag">${entries.length} attributes</span></h3>
        <div class="member-list">
          <table>
            <thead><tr><th>#</th><th style="text-align:left">Attribute</th><th>Rows</th>${measureHead}</tr></thead>
            <tbody>${entries.slice(0, 50).map((e, i) => `<tr>
              <td style="text-align:left">${i + 1}</td>
              <td style="text-align:left">${escapeHtml(e.member)}</td>
              <td>${nf.format(e.rows)}</td>
              ${state.measureOrder.map(m => `<td>${fmtNum(e.measures[m] ?? null)}</td>`).join('')}
            </tr>`).join('')}</tbody>
          </table>
          ${entries.length > 50 ? `<p class="muted" style="font-size:12px">…and ${entries.length - 50} more (full list in the Excel export)</p>` : ''}
        </div>`;
      grid.appendChild(card);
    }
  }
  if (!grid.children.length)
    grid.innerHTML = '<p class="muted">No dimensions mapped — edit the mapping to add some.</p>';
}

/* ---------- color theme picker ---------- */
function renderThemePanel() {
  const panel = $('#theme-panel');
  const theme = loadTheme();
  panel.innerHTML = '';

  const h = document.createElement('h4');
  h.textContent = 'Color theme';
  panel.appendChild(h);

  const grid = document.createElement('div');
  grid.className = 'theme-swatches';
  for (const p of THEME_PRESETS) {
    const sw = document.createElement('div');
    sw.className = 'theme-swatch' + (theme.name === p.name ? ' active' : '');
    sw.innerHTML = `<span class="dot" style="background:${p.bg}"></span><span>${p.label}</span>`;
    sw.addEventListener('click', () => {
      const t = { name: p.name };
      saveTheme(t);
      applyTheme(t);
      renderThemePanel();
    });
    grid.appendChild(sw);
  }
  panel.appendChild(grid);

  const custom = document.createElement('div');
  custom.className = 'theme-custom';
  custom.innerHTML = '<h4>Custom colors</h4>';
  const base = theme.name === 'custom' && theme.custom ? theme.custom
    : { bg: '#0e1117', panel: '#161b22', text: '#e6e9ef' };

  const fields = [
    ['bg', 'Background'],
    ['panel', 'Tile color'],
    ['text', 'Font color'],
  ];
  const inputs = {};
  for (const [key, label] of fields) {
    const row = document.createElement('div');
    row.className = 'theme-custom-row';
    row.innerHTML = `<span>${label}</span>`;
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = base[key];
    inputs[key] = inp;
    row.appendChild(inp);
    custom.appendChild(row);
  }

  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn btn-primary theme-custom-apply';
  applyBtn.textContent = theme.name === 'custom' ? 'Update custom theme' : 'Apply custom theme';
  applyBtn.addEventListener('click', () => {
    const t = { name: 'custom', custom: { bg: inputs.bg.value, panel: inputs.panel.value, text: inputs.text.value } };
    saveTheme(t);
    applyTheme(t);
    renderThemePanel();
  });
  custom.appendChild(applyBtn);
  panel.appendChild(custom);
}

function initThemePicker() {
  const btn = $('#theme-btn');
  const panel = $('#theme-panel');
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (panel.hidden) { renderThemePanel(); panel.hidden = false; }
    else panel.hidden = true;
  });
  document.addEventListener('click', e => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) panel.hidden = true;
  });
}

/* ---------- init ---------- */
function init() {
  if (window.Chart) {
    Chart.defaults.color = '#98a2b3';
    Chart.defaults.font.family = '"Segoe UI", system-ui, sans-serif';
    if (window.ChartDataLabels) Chart.register(ChartDataLabels);
  }
  initUpload();
  initModal();
  initKpiModal();
  initThemePicker();

  $$('#tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#btn-remap').addEventListener('click', () => openMappingModal());
  $('#btn-kpis').addEventListener('click', () => openKpiModal(false));
  $('#btn-export-master').addEventListener('click', exportMasterData);
  $('#btn-new-file').addEventListener('click', () => {
    state.records = [];
    state.excluded = 0;
    showView('upload');
  });
}

document.addEventListener('DOMContentLoaded', init);
