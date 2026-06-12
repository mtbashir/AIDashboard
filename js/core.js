'use strict';

/* ============================================================
   core.js — helpers, state, file parsing, role/link detection,
   sample data, localStorage persistence.
   ============================================================ */

/* ---------- helpers ---------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ROLES = ['dimension', 'measure', 'datetime', 'flag', 'ignore'];
const ROLE_LABELS = {
  dimension: 'Dimension',
  measure:   'Measure',
  datetime:  'Date / Time',
  flag:      'Include flag (Y/N)',
  ignore:    'Ignore',
};
const AGG_LABELS = { sum: 'Sum', avg: 'Average', min: 'Min', max: 'Max', count: 'Count' };
const PERIOD_UNITS = ['minute', 'hour', 'day', 'week', 'month', 'year'];

const PALETTE = ['#4f8cff', '#34d399', '#f59e0b', '#f472b6', '#a78bfa', '#22d3ee',
                 '#fb7185', '#84cc16', '#e879f9', '#f97316', '#2dd4bf', '#94a3b8'];

const nf        = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const nfCompact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const fmtNum = v => v === null || v === undefined || Number.isNaN(v) ? '—'
  : Math.abs(v) >= 10000 ? nfCompact.format(v) : nf.format(v);

function aggregate(values, agg) {
  if (agg === 'count') return values.length;
  if (!values.length) return null;
  let sum = 0, min = Infinity, max = -Infinity;
  for (const v of values) { sum += v; if (v < min) min = v; if (v > max) max = v; }
  switch (agg) {
    case 'avg': return sum / values.length;
    case 'min': return min;
    case 'max': return max;
    default:    return sum;
  }
}

function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/[,\s$€£]/g, '').replace(/%$/, '');
  if (s === '' || isNaN(s)) return null;
  return parseFloat(s);
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
                 jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function mkDate(y, mo, d) {
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo, d);
  return (dt.getFullYear() === y && dt.getMonth() === mo && dt.getDate() === d) ? dt : null;
}

function parseDateValue(v) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T\s](\d{1,2}):(\d{2})(:\d{2})?/))) {
    const base = mkDate(+m[1], +m[2] - 1, +m[3]);
    if (!base) return null;
    base.setHours(+m[4], +m[5], m[6] ? +m[6].slice(1) : 0);
    return base;
  }
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)))
    return mkDate(+m[1], +m[2] - 1, +m[3]);
  // 05/03/2024, 5-3-24 — ambiguous defaults to day/month/year
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    let day, mo;
    if (a > 12)      { day = a; mo = b; }
    else if (b > 12) { mo = a; day = b; }
    else             { day = a; mo = b; }
    return mkDate(y, mo - 1, day);
  }
  if ((m = s.match(/^(\d{4})[\/\-](\d{1,2})$/))) return mkDate(+m[1], +m[2] - 1, 1);
  if ((m = s.match(/^([A-Za-z]{3,9})[\s\-,]+(\d{4})$/))) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    return mo === undefined ? null : mkDate(+m[2], mo, 1);
  }
  if (/[A-Za-z]/.test(s)) {
    const t = Date.parse(s);
    if (!isNaN(t)) return new Date(t);
  }
  return null;
}

const isoLocal = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- state ---------- */
const state = {
  fileName: null,
  columns: [],         // [{ name, samples, distinct }]
  rows: [],
  mapping: {},         // col -> { role, linkTo, level, agg }
  dimOrder: [],
  measureOrder: [],
  groups: [],          // [{ dims: [cols in hierarchy order], name }]
  records: [],
  excluded: 0,
  masterData: {},      // dim -> [{ member, rows, measures: {m: sum} }]
  kpis: [],            // [{ id, name, type:'agg'|'product'|'ratio', measure, agg, a, b }]
  kpiConfigured: false,
  activeKpi: null,
  filters: {},
  period: { mode: 'rolling', n: 1, unit: 'month',
            from: null, to: null, lastFrom: null, lastTo: null, lastTouched: false },
  gran: 'auto',
  chartPrefs: { datalabels: false, legend: true },
  chartKpis: [],       // KPI ids plotted on the overview charts (multi-select)
  chartTypes: { trend: 'auto', drill: 'auto', compare: 'auto', ddTrend: 'auto', ddCompare: 'auto', ddDim: 'auto' },
  sel: { dateCol: null },
  drill: { g: 0, path: [] },
  compare: { a: null, b: null },
  dd: { kpi: null, a: null, b: null },
  charts: {},
};

const dimNumber     = col => state.dimOrder.indexOf(col) + 1;
const measureNumber = col => state.measureOrder.indexOf(col) + 1;
const datetimeCols  = () => state.columns.map(c => c.name).filter(c => state.mapping[c]?.role === 'datetime');
const flagCol       = () => state.columns.map(c => c.name).find(c => state.mapping[c]?.role === 'flag') || null;
const columnDistinct = col => state.columns.find(c => c.name === col)?.distinct || 0;

/* ---------- dimension groups & hierarchy ---------- */
function levelSortKey(col) {
  const m = state.mapping[col];
  // user-set level wins; otherwise sort by cardinality (fewer members = higher level)
  return m.level ? m.level : 1000 + columnDistinct(col);
}

function computeGroups() {
  const dims = state.dimOrder.slice();
  const parent = {};
  dims.forEach(d => { parent[d] = d; });
  const find = x => parent[x] === x ? x : (parent[x] = find(parent[x]));
  for (const d of dims) {
    const t = state.mapping[d].linkTo;
    if (t && state.mapping[t]?.role === 'dimension') parent[find(d)] = find(t);
  }
  const byRoot = {};
  for (const d of dims) {
    const r = find(d);
    (byRoot[r] = byRoot[r] || []).push(d);
  }
  state.groups = Object.values(byRoot).map(g => {
    const sorted = g.slice().sort((a, b) => levelSortKey(a) - levelSortKey(b));
    return { dims: sorted, name: sorted.join(' ▸ ') };
  });
  state.groups.sort((a, b) => dimNumber(a.dims[0]) - dimNumber(b.dims[0]));
  return state.groups;
}

function groupOf(col) { return state.groups.find(g => g.dims.includes(col)); }
function levelOf(col) {
  const g = groupOf(col);
  return g ? g.dims.indexOf(col) + 1 : 1;
}

/* ---------- persistence (browser localStorage "backend") ---------- */
function columnsHash() {
  const s = state.columns.map(c => c.name).sort().join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return 'dmd:' + (h >>> 0).toString(36);
}

function saveSession() {
  try {
    localStorage.setItem(columnsHash(), JSON.stringify({
      mapping: state.mapping,
      dimOrder: state.dimOrder,
      measureOrder: state.measureOrder,
      kpis: state.kpis,
      kpiConfigured: state.kpiConfigured,
      dateCol: state.sel.dateCol,
      period: { mode: state.period.mode, n: state.period.n, unit: state.period.unit },
      chartPrefs: state.chartPrefs,
      chartKpis: state.chartKpis,
      chartTypes: state.chartTypes,
    }));
    localStorage.setItem(columnsHash() + ':master', JSON.stringify(state.masterData));
  } catch { /* storage full or unavailable — non-fatal */ }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(columnsHash());
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/* ---------- upload & parse ---------- */
function initUpload() {
  const dz = $('#dropzone');
  const input = $('#file-input');

  $('#btn-browse').addEventListener('click', e => { e.stopPropagation(); input.click(); });
  dz.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); input.value = ''; });

  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  $('#btn-sample').addEventListener('click', loadSampleData);
}

function handleFile(file) {
  state.fileName = file.name;
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'xlsx' || ext === 'xls') {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        ingestRows(XLSX.utils.sheet_to_json(ws, { defval: null, raw: true }));
      } catch (err) { alert('Could not read this Excel file: ' + err.message); }
    };
    reader.readAsArrayBuffer(file);
  } else {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: res => ingestRows(res.data),
      error: err => alert('Could not read this file: ' + err.message),
    });
  }
}

function ingestRows(rows) {
  rows = (rows || []).filter(r => r && Object.values(r).some(v => v !== null && String(v).trim() !== ''));
  if (!rows.length) { alert('No data rows found in this file.'); return; }

  const seen = {};
  const rawCols = Object.keys(rows[0]);
  const colNames = rawCols.map(c => {
    let name = String(c).trim() || 'Column';
    if (seen[name]) name = `${name} (${++seen[name]})`;
    else seen[name] = 1;
    return name;
  });
  if (colNames.some((c, i) => c !== rawCols[i])) {
    rows = rows.map(r => {
      const o = {};
      rawCols.forEach((c, i) => { o[colNames[i]] = r[c]; });
      return o;
    });
  }

  state.rows = rows;
  state.columns = colNames.map(name => {
    const distinct = new Set();
    for (const r of rows) {
      const v = r[name];
      if (v !== null && v !== undefined && String(v).trim() !== '') distinct.add(String(v).trim());
      if (distinct.size > 100000) break;
    }
    return { name, samples: sampleValues(rows, name), distinct: distinct.size };
  });

  const saved = loadSession();
  if (saved && saved.mapping && colNames.every(c => saved.mapping[c])) {
    state.mapping = saved.mapping;
    state.dimOrder = saved.dimOrder.filter(c => colNames.includes(c));
    state.measureOrder = saved.measureOrder.filter(c => colNames.includes(c));
    state.kpis = saved.kpis || [];
    state.kpiConfigured = !!saved.kpiConfigured;
    if (saved.period) Object.assign(state.period, saved.period);
    if (saved.chartPrefs) Object.assign(state.chartPrefs, saved.chartPrefs);
    state.chartKpis = saved.chartKpis || [];
    if (saved.chartTypes) Object.assign(state.chartTypes, saved.chartTypes);
    openMappingModal('Restored your saved mapping for this column layout — review and continue.');
  } else {
    state.kpis = [];
    state.kpiConfigured = false;
    autoDetectRoles();
    openMappingModal();
  }
}

function sampleValues(rows, name) {
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    const v = r[name];
    if (v === null || v === undefined || String(v).trim() === '') continue;
    const s = v instanceof Date ? v.toLocaleDateString() : String(v);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s.length > 24 ? s.slice(0, 24) + '…' : s);
    if (out.length === 3) break;
  }
  return out;
}

/* ---------- auto-detection ---------- */
function autoDetectRoles() {
  state.mapping = {};
  state.dimOrder = [];
  state.measureOrder = [];

  const N = Math.min(state.rows.length, 400);
  let flagAssigned = false;

  for (const col of state.columns) {
    const name = col.name;
    const values = [];
    for (let i = 0; i < N; i++) {
      const v = state.rows[i][name];
      if (v !== null && v !== undefined && String(v).trim() !== '') values.push(v);
    }
    const role = detectRole(name, values, flagAssigned);
    state.mapping[name] = { role, linkTo: null, level: null, agg: 'sum' };
    if (role === 'dimension') state.dimOrder.push(name);
    if (role === 'measure')   state.measureOrder.push(name);
    if (role === 'flag')      flagAssigned = true;
  }

  detectDimensionLinks();
  computeGroups();
}

function detectRole(name, values, flagTaken) {
  if (!values.length) return 'ignore';
  const lower = name.toLowerCase();
  const strs = values.map(v => String(v).trim().toLowerCase());
  const uniq = new Set(strs);

  const flagSet = new Set(['y', 'n', 'yes', 'no', 'true', 'false']);
  if (!flagTaken && [...uniq].every(v => flagSet.has(v)) && uniq.size <= 3) return 'flag';
  if (!flagTaken && /include|flag|active|valid/.test(lower) &&
      [...uniq].every(v => flagSet.has(v) || v === '1' || v === '0')) return 'flag';

  const dateHits = values.filter(v => parseDateValue(v) !== null).length;
  if (dateHits / values.length > 0.85) return 'datetime';

  const numHits = values.filter(v => toNumber(v) !== null).length;
  if (numHits / values.length > 0.9) return 'measure';

  if (uniq.size === values.length && values.length > 50) return 'ignore'; // id-like
  return 'dimension';
}

/* Detect "dimension B groups dimension A" relationships (functional
   dependency A -> B with fewer members), used to pre-link hierarchies
   like Product -> Brand or Country -> Region. */
function detectDimensionLinks() {
  const dims = state.dimOrder;
  const N = Math.min(state.rows.length, 1500);
  for (const a of dims) {
    let best = null;
    for (const b of dims) {
      if (a === b) continue;
      if (columnDistinct(b) >= columnDistinct(a) || columnDistinct(b) < 2) continue;
      const map = new Map();
      let functional = true;
      for (let i = 0; i < N; i++) {
        const va = state.rows[i][a], vb = state.rows[i][b];
        if (va === null || va === undefined || vb === null || vb === undefined) continue;
        const ka = String(va).trim(), kb = String(vb).trim();
        if (!ka || !kb) continue;
        const prev = map.get(ka);
        if (prev === undefined) map.set(ka, kb);
        else if (prev !== kb) { functional = false; break; }
      }
      if (functional && map.size > 1 &&
          (!best || columnDistinct(b) > columnDistinct(best))) best = b; // closest ancestor
    }
    if (best) state.mapping[a].linkTo = best;
  }
}

/* ---------- sample data ---------- */
function loadSampleData() {
  const regions = {
    North: ['United Kingdom', 'Norway', 'Sweden'],
    South: ['Spain', 'Italy', 'Greece'],
    East:  ['Poland', 'Romania', 'Czechia'],
    West:  ['France', 'Portugal', 'Netherlands'],
  };
  const brands = { TechNova: ['Laptop', 'Phone', 'Monitor'], HomeCraft: ['Desk', 'Chair'], PaperPro: ['Notebook', 'Pen'] };
  const basePrice = { Laptop: 950, Phone: 620, Monitor: 280, Desk: 340, Chair: 190, Notebook: 6, Pen: 2.5 };
  const channels = ['Online', 'Retail', 'Partner'];
  const regionKeys = Object.keys(regions);
  const brandKeys = Object.keys(brands);

  const rows = [];
  const start = new Date(2024, 0, 1).getTime();
  const span = new Date(2025, 5, 30).getTime() - start;
  for (let i = 0; i < 900; i++) {
    const d = new Date(start + Math.random() * span);
    const region = regionKeys[Math.floor(Math.random() * regionKeys.length)];
    const country = regions[region][Math.floor(Math.random() * regions[region].length)];
    const brand = brandKeys[Math.floor(Math.random() * brandKeys.length)];
    const product = brands[brand][Math.floor(Math.random() * brands[brand].length)];
    const channel = channels[Math.floor(Math.random() * channels.length)];
    const units = 1 + Math.floor(Math.random() * 40);
    const price = +(basePrice[product] * (0.9 + Math.random() * 0.25)).toFixed(2);
    rows.push({
      'Order Date': isoLocal(d),
      'Region': region,
      'Country': country,
      'Brand': brand,
      'Product': product,
      'Channel': channel,
      'Units': units,
      'Unit Price': price,
      'Revenue': +(units * price).toFixed(2),
      'Include': Math.random() < 0.95 ? 'Y' : 'N',
    });
  }
  state.fileName = 'sample_sales_data (generated)';
  ingestRows(rows);
}

/* ---------- color theme ---------- */
const THEME_KEY = 'dmd:theme';
const THEME_PRESETS = [
  { name: 'dark',  label: 'Dark',  bg: '#0e1117', panel: '#161b22', text: '#e6e9ef' },
  { name: 'light', label: 'White', bg: '#f3f5f8', panel: '#ffffff', text: '#1b2230' },
  { name: 'grey',  label: 'Grey',  bg: '#dde1e7', panel: '#f1f3f6', text: '#20242c' },
  { name: 'blue',  label: 'Blue',  bg: '#0b1f3a', panel: '#102a4c', text: '#e8f0ff' },
  { name: 'lilac', label: 'Lilac', bg: '#f4f0fb', panel: '#ffffff', text: '#2e2240' },
  { name: 'mint',  label: 'Mint',  bg: '#ecf8f1', panel: '#ffffff', text: '#1f3b30' },
];

function hexToRgb(hex) {
  hex = String(hex).replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const num = parseInt(hex, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}
function rgbToHex(rgb) {
  return '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function mixColors(c1, c2, t) {
  const a = hexToRgb(c1), b = hexToRgb(c2);
  return rgbToHex(a.map((v, i) => v + (b[i] - v) * t));
}
function relLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function loadTheme() {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw ? JSON.parse(raw) : { name: 'dark' };
  } catch { return { name: 'dark' }; }
}

function saveTheme(theme) {
  try { localStorage.setItem(THEME_KEY, JSON.stringify(theme)); } catch { /* ignore */ }
}

function applyTheme(theme) {
  const root = document.documentElement;
  const style = root.style;
  for (const v of ['--bg', '--panel', '--panel-2', '--border', '--text', '--muted'])
    style.removeProperty(v);

  if (theme.name === 'custom' && theme.custom) {
    const { bg, panel, text } = theme.custom;
    const dark = relLuminance(bg) < 0.5;
    const mixWith = dark ? '#ffffff' : '#000000';
    root.dataset.theme = dark ? 'dark' : 'light';
    style.setProperty('--bg', bg);
    style.setProperty('--panel', panel);
    style.setProperty('--panel-2', mixColors(panel, mixWith, 0.06));
    style.setProperty('--border', mixColors(panel, mixWith, 0.2));
    style.setProperty('--text', text);
    style.setProperty('--muted', mixColors(text, bg, 0.45));
  } else {
    root.dataset.theme = theme.name || 'dark';
  }
}

applyTheme(loadTheme());
