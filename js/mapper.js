'use strict';

/* ============================================================
   mapper.js — the column-mapping popup. Dimensions are numbered
   in assignment order; each dimension can be linked to another
   (subset-of) to form a drill-down hierarchy with user-settable
   hierarchy levels.
   ============================================================ */

function openMappingModal(note) {
  computeGroups();
  $('#map-col-count').textContent = state.columns.length;
  $('#map-file-name').textContent = state.fileName || 'your data';
  $('#map-error').textContent = note || '';
  $('#map-error').style.color = note ? 'var(--green)' : '';
  renderMappingTable();
  $('#mapping-modal').hidden = false;
}

function closeMappingModal() { $('#mapping-modal').hidden = true; }

function setRole(col, role) {
  const m = state.mapping[col];
  const prevRole = m.role;

  state.dimOrder = state.dimOrder.filter(c => c !== col);
  state.measureOrder = state.measureOrder.filter(c => c !== col);

  if (prevRole === 'dimension' && role !== 'dimension') {
    m.linkTo = null;
    m.level = null;
    for (const c in state.mapping)               // unlink children pointing here
      if (state.mapping[c].linkTo === col) state.mapping[c].linkTo = null;
  }

  m.role = role;
  if (role === 'dimension') state.dimOrder.push(col);   // auto-number: next free slot
  if (role === 'measure') { state.measureOrder.push(col); m.agg = m.agg || 'sum'; }
  if (role === 'flag') {
    for (const c in state.mapping)                       // only one include flag
      if (c !== col && state.mapping[c].role === 'flag') state.mapping[c].role = 'ignore';
  }
  renderMappingTable();
}

function assignedBadge(col) {
  const m = state.mapping[col];
  switch (m.role) {
    case 'dimension': {
      const g = groupOf(col);
      const lvl = g && g.dims.length > 1 ? ` · H${levelOf(col)}` : '';
      return `<span class="badge badge-dim">Dimension ${dimNumber(col)}${lvl}</span>`;
    }
    case 'measure':  return `<span class="badge badge-meas">Measure ${measureNumber(col)}</span>`;
    case 'datetime': return `<span class="badge badge-date">Date/Time</span>`;
    case 'flag':     return `<span class="badge badge-flag">Include flag</span>`;
    default:         return `<span class="badge badge-ign">—</span>`;
  }
}

function renderMappingTable() {
  computeGroups();
  const body = $('.modal-body');
  const scroll = body.scrollTop;
  const tbody = $('#map-tbody');
  tbody.innerHTML = '';

  for (const col of state.columns) {
    const name = col.name;
    const m = state.mapping[name];
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td class="col-name">${escapeHtml(name)}</td>
      <td class="col-samples">${col.samples.map(escapeHtml).join(' · ') || '<i>empty</i>'}
        <div style="opacity:.7">${col.distinct} distinct</div></td>`;

    // role select
    const tdRole = document.createElement('td');
    const sel = document.createElement('select');
    for (const r of ROLES) {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = ROLE_LABELS[r];
      if (r === m.role) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => setRole(name, sel.value));
    tdRole.appendChild(sel);
    tr.appendChild(tdRole);

    // details column: dimension link / measure aggregation / flag note
    const tdDetail = document.createElement('td');
    if (m.role === 'dimension') {
      // link select: "is this dimension a subset of another?"
      const linkSel = document.createElement('select');
      linkSel.innerHTML = `<option value="">Not linked to another dimension</option>`;
      for (const d of state.dimOrder) {
        if (d === name) continue;
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = `Linked to Dim ${dimNumber(d)} — ${d}`;
        if (m.linkTo === d) opt.selected = true;
        linkSel.appendChild(opt);
      }
      linkSel.addEventListener('change', () => {
        m.linkTo = linkSel.value || null;
        renderMappingTable();
      });
      tdDetail.appendChild(linkSel);
    } else if (m.role === 'measure') {
      const aggSel = document.createElement('select');
      for (const a in AGG_LABELS) {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = `Aggregate: ${AGG_LABELS[a]}`;
        if (a === m.agg) opt.selected = true;
        aggSel.appendChild(opt);
      }
      aggSel.addEventListener('change', () => { m.agg = aggSel.value; });
      tdDetail.appendChild(aggSel);
    } else if (m.role === 'flag') {
      tdDetail.innerHTML = `<span class="muted" style="font-size:12.5px">rows kept when Y / Yes / True / 1</span>`;
    } else {
      tdDetail.innerHTML = `<span class="muted">—</span>`;
    }
    tr.appendChild(tdDetail);

    // hierarchy column: level within the dimension's linked group
    const tdHier = document.createElement('td');
    if (m.role === 'dimension') {
      const g = groupOf(name);
      if (g && g.dims.length > 1) {
        const lvlSel = document.createElement('select');
        for (let i = 1; i <= g.dims.length; i++) {
          const opt = document.createElement('option');
          opt.value = i;
          opt.textContent = `Hierarchy level ${i}${i === 1 ? ' (top)' : ''}`;
          if (i === levelOf(name)) opt.selected = true;
          lvlSel.appendChild(opt);
        }
        lvlSel.addEventListener('change', () => {
          m.level = +lvlSel.value;
          renderMappingTable();
        });
        tdHier.appendChild(lvlSel);
      } else {
        tdHier.innerHTML = `<span class="muted" style="font-size:12.5px">standalone — link it to create a hierarchy</span>`;
      }
    } else {
      tdHier.innerHTML = `<span class="muted">—</span>`;
    }
    tr.appendChild(tdHier);

    const tdBadge = document.createElement('td');
    tdBadge.innerHTML = assignedBadge(name);
    tr.appendChild(tdBadge);

    tbody.appendChild(tr);
  }

  const hierarchies = state.groups.filter(g => g.dims.length > 1);
  $('#map-summary').innerHTML =
    `<b>${state.dimOrder.length}</b> dimensions in <b>${state.groups.length}</b> groups ` +
    `(${hierarchies.length} hierarch${hierarchies.length === 1 ? 'y' : 'ies'}) · ` +
    `<b>${state.measureOrder.length}</b> measures · <b>${datetimeCols().length}</b> date/time · ` +
    `flag: <b>${flagCol() ? 'yes' : 'no'}</b>`;

  body.scrollTop = scroll;
}

function validateMapping() {
  if (!state.measureOrder.length)
    return 'Map at least one Measure (a numeric column) — KPIs and charts are built from measures.';
  return null;
}

function applyMapping() {
  const err = validateMapping();
  if (err) {
    $('#map-error').style.color = '';
    $('#map-error').textContent = err;
    return;
  }
  closeMappingModal();
  transformData();
  buildMasterData();

  // drop KPIs that reference measures no longer mapped
  state.kpis = state.kpis.filter(k =>
    k.type === 'agg' ? state.measureOrder.includes(k.measure)
                     : state.measureOrder.includes(k.a) && state.measureOrder.includes(k.b));

  if (!state.kpiConfigured) {
    if (!state.kpis.length) state.kpis = defaultKpis();
    openKpiModal(true);          // first run: ask which KPIs to track
  } else {
    if (!state.kpis.length) state.kpis = defaultKpis();
    saveSession();
    buildDashboard();
  }
}

function initModal() {
  $('#btn-map-apply').addEventListener('click', applyMapping);
  const cancel = () => {
    closeMappingModal();
    if (!state.records.length) showView('upload');
  };
  $('#btn-map-cancel').addEventListener('click', cancel);
  $('#btn-modal-close').addEventListener('click', cancel);
}
