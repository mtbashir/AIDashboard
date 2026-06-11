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
