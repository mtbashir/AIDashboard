'use strict';

/* ============================================================
   analytics.js — transform, attribute master data, time-period
   windows (current vs last), KPI evaluation, movers.
   ============================================================ */

/* ---------- transform (apply mapping + include flag) ---------- */
function transformData() {
  const fc = flagCol();
  const yes = new Set(['y', 'yes', 'true', '1']);
  const dCols = datetimeCols();
  const records = [];
  let excluded = 0;

  for (const row of state.rows) {
    if (fc) {
      const v = String(row[fc] ?? '').trim().toLowerCase();
      if (!yes.has(v)) { excluded++; continue; }
    }
    const rec = { __dates: {} };
    for (const col of state.columns) {
      const name = col.name;
      const m = state.mapping[name];
      if (m.role === 'ignore' || m.role === 'flag') continue;
      const v = row[name];
      if (m.role === 'measure') rec[name] = toNumber(v);
      else if (m.role === 'datetime') {
        const d = parseDateValue(v);
        rec[name] = d;
        rec.__dates[name] = d;
      } else {
        rec[name] = (v === null || v === undefined || String(v).trim() === '') ? '(blank)' : String(v).trim();
      }
    }
    records.push(rec);
  }

  state.records = records;
  state.excluded = excluded;

  computeGroups();
  state.filters = {};
  for (const d of state.dimOrder) state.filters[d] = '__all__';
  if (!dCols.includes(state.sel.dateCol)) state.sel.dateCol = dCols[0] || null;
  state.drill = { g: 0, path: [] };
  state.compare = { a: null, b: null };
  state.dd = { kpi: null, a: null, b: null };
}

/* ---------- attribute master data ---------- */
function buildMasterData() {
  const md = {};
  for (const dim of state.dimOrder) {
    const map = new Map();
    for (const rec of state.records) {
      const member = rec[dim];
      let e = map.get(member);
      if (!e) { e = { member, rows: 0, measures: {} }; map.set(member, e); }
      e.rows++;
      for (const m of state.measureOrder) {
        const v = rec[m];
        if (v !== null) e.measures[m] = (e.measures[m] || 0) + v;
      }
    }
    md[dim] = [...map.values()].sort((a, b) => b.rows - a.rows).slice(0, 5000);
  }
  state.masterData = md;
}

function exportMasterData() {
  const wb = XLSX.utils.book_new();
  for (const dim of state.dimOrder) {
    const rows = (state.masterData[dim] || []).map((e, i) => {
      const o = { 'Attribute #': i + 1, 'Attribute': e.member, 'Rows': e.rows };
      for (const m of state.measureOrder) o[`Sum of ${m}`] = +((e.measures[m] || 0).toFixed(4));
      return o;
    });
    const sheetName = `Dim${dimNumber(dim)} ${dim}`.replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 31);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName);
  }
  XLSX.writeFile(wb, 'master_data.xlsx');
}

/* ---------- time periods: current vs last ---------- */
function subUnits(d, n, unit) {
  switch (unit) {
    case 'minute': return new Date(+d - n * 60000);
    case 'hour':   return new Date(+d - n * 3600000);
    case 'day':    return new Date(+d - n * 86400000);
    case 'week':   return new Date(+d - n * 604800000);
    case 'month':  return new Date(d.getFullYear(), d.getMonth() - n, d.getDate(),
                                   d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
    case 'year':   return new Date(d.getFullYear() - n, d.getMonth(), d.getDate(),
                                   d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
    default:       return d;
  }
}

/* Returns { cur: [startMs, endMs), prev: [startMs, endMs) } or null when no usable date. */
function periodWindows() {
  const dc = state.sel.dateCol;
  if (!dc) return null;
  let maxT = -Infinity;
  for (const r of state.records) {
    const d = r.__dates[dc];
    if (d && +d > maxT) maxT = +d;
  }
  if (maxT === -Infinity) return null;

  const p = state.period;
  let curS, curE, prevS, prevE;
  if (p.mode === 'custom' && p.from && p.to) {
    curS = +p.from;
    curE = +p.to + 86400000; // 'to' day inclusive
    if (p.lastFrom && p.lastTo) {       // user-picked last period
      prevS = +p.lastFrom;
      prevE = +p.lastTo + 86400000;
    } else {                            // fallback: equal-length range before current
      prevE = curS;
      prevS = curS - (curE - curS);
    }
  } else {
    curE = maxT + 1;
    curS = +subUnits(new Date(curE), p.n, p.unit);
    prevE = curS;
    prevS = +subUnits(new Date(curS), p.n, p.unit);
  }
  return { cur: [curS, curE], prev: [prevS, prevE] };
}

function periodLabel() {
  const p = state.period;
  if (p.mode === 'custom' && p.from && p.to) {
    const last = (p.lastFrom && p.lastTo)
      ? `${isoLocal(p.lastFrom)} → ${isoLocal(p.lastTo)}`
      : 'the previous range of equal length';
    return `${isoLocal(p.from)} → ${isoLocal(p.to)} vs ${last}`;
  }
  return `last ${p.n} ${p.unit}${p.n > 1 ? 's' : ''} vs the previous ${p.n} ${p.unit}${p.n > 1 ? 's' : ''}`;
}

function recsInWindow(recs, w) {
  if (!w) return recs;
  const dc = state.sel.dateCol;
  return recs.filter(r => {
    const d = r.__dates[dc];
    return d && +d >= w[0] && +d < w[1];
  });
}

/* dimension dropdown filters only (drill path and windows applied separately) */
function baseFiltered() {
  return state.records.filter(rec => {
    for (const d of state.dimOrder) {
      const f = state.filters[d];
      if (f && f !== '__all__' && rec[d] !== f) return false;
    }
    return true;
  });
}

/* ---------- KPIs ---------- */
function defaultKpis() {
  return state.measureOrder.map((m, i) => ({
    id: 'k' + (i + 1),
    name: '',
    type: 'agg',
    measure: m,
    agg: state.mapping[m].agg || 'sum',
    a: null, b: null,
  }));
}

function kpiById(id) { return state.kpis.find(k => k.id === id) || state.kpis[0] || null; }

function kpiLabel(k) {
  if (!k) return '';
  if (k.name) return k.name;
  if (k.type === 'agg')     return `${AGG_LABELS[k.agg]} of ${k.measure}`;
  if (k.type === 'product') return `${k.a} × ${k.b}`;
  return `${k.a} ÷ ${k.b}`;
}

function evalKpiOn(recs, k) {
  if (!k) return null;
  if (k.type === 'agg') {
    const vals = [];
    for (const r of recs) { const v = r[k.measure]; if (v !== null && v !== undefined) vals.push(v); }
    return aggregate(vals, k.agg);
  }
  if (k.type === 'product') {
    let s = 0, found = false;
    for (const r of recs) {
      const a = r[k.a], b = r[k.b];
      if (a !== null && a !== undefined && b !== null && b !== undefined) { s += a * b; found = true; }
    }
    return found ? s : null;
  }
  // ratio: sum(A) / sum(B)
  let sa = 0, sb = 0, found = false;
  for (const r of recs) {
    const a = r[k.a], b = r[k.b];
    if (a !== null && a !== undefined) { sa += a; found = true; }
    if (b !== null && b !== undefined) sb += b;
  }
  return found && sb !== 0 ? sa / sb : null;
}

/* % change current vs previous; null when not computable */
function pctChange(cur, prev) {
  if (cur === null || prev === null) return null;
  if (prev === 0) return cur === 0 ? 0 : Infinity;
  return (cur - prev) / Math.abs(prev) * 100;
}

function deltaHtml(cur, prev) {
  const d = pctChange(cur, prev);
  if (d === null) return '<span class="delta-flat">—</span>';
  if (d === Infinity) return '<span class="delta-up">▲ new</span>';
  const cls = d > 0.05 ? 'delta-up' : d < -0.05 ? 'delta-down' : 'delta-flat';
  const arrow = d > 0.05 ? '▲' : d < -0.05 ? '▼' : '■';
  return `<span class="${cls}">${arrow} ${Math.abs(d) >= 1000 ? nfCompact.format(d) : d.toFixed(1)}%</span>`;
}

/* ---------- per-member aggregation with windows ---------- */
/* Splits records into member -> { cur: [], prev: [] } record buckets. */
function memberGroups(recs, dimCol, windows) {
  const groups = new Map();
  const dc = state.sel.dateCol;
  for (const r of recs) {
    const k = r[dimCol] ?? '(blank)';
    let g = groups.get(k);
    if (!g) { g = { cur: [], prev: [] }; groups.set(k, g); }
    if (!windows) { g.cur.push(r); continue; }
    const d = r.__dates[dc];
    if (!d) continue;
    const t = +d;
    if (t >= windows.cur[0] && t < windows.cur[1]) g.cur.push(r);
    else if (t >= windows.prev[0] && t < windows.prev[1]) g.prev.push(r);
  }
  return groups;
}

/* Returns [{ member, cur, prev }] sorted by cur desc */
function memberValues(recs, dimCol, kpi, windows) {
  const groups = memberGroups(recs, dimCol, windows);
  const out = [];
  for (const [member, g] of groups) {
    const cur = evalKpiOn(g.cur, kpi);
    const prev = windows ? evalKpiOn(g.prev, kpi) : null;
    if (cur === null && prev === null) continue;
    out.push({ member, cur: cur ?? 0, prev });
  }
  out.sort((a, b) => (b.cur ?? 0) - (a.cur ?? 0));
  return out;
}

/* Movers: sorted by |%change| descending so the biggest swings (either
   direction) surface on top. */
function movers(recs, dimCol, kpi, windows) {
  const vals = memberValues(recs, dimCol, kpi, windows);
  for (const v of vals) v.delta = pctChange(v.cur, v.prev ?? null);
  vals.sort((a, b) => {
    const da = a.delta === null ? -1 : Math.abs(a.delta);
    const db = b.delta === null ? -1 : Math.abs(b.delta);
    return db - da;
  });
  return vals;
}

/* ---------- time bucketing for trends ---------- */
function chooseBucketUnit(spanMs) {
  const days = spanMs / 86400000;
  if (days <= 3) return 'hour';
  if (days <= 130) return 'day';
  if (days <= 430) return 'week';
  if (days <= 1500) return 'month';
  return 'year';
}

function bucketKey(d, unit) {
  switch (unit) {
    case 'hour':  return isoLocal(d) + ' ' + String(d.getHours()).padStart(2, '0');
    case 'day':   return isoLocal(d);
    case 'week': {
      const wd = (d.getDay() + 6) % 7;
      return isoLocal(new Date(d.getFullYear(), d.getMonth(), d.getDate() - wd));
    }
    case 'month': return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    default:      return String(d.getFullYear());
  }
}

function bucketLabel(key, unit) {
  if (unit === 'month') {
    const [y, m] = key.split('-');
    return new Date(+y, +m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }
  if (unit === 'hour') {
    const [day, h] = key.split(' ');
    const [y, m, dd] = day.split('-');
    return new Date(+y, +m - 1, +dd).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ` ${h}:00`;
  }
  if (unit === 'day' || unit === 'week') {
    const [y, m, dd] = key.split('-');
    return new Date(+y, +m - 1, +dd).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });
  }
  return key;
}
