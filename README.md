# Data Mapper & Instant Dashboard

Upload any raw tabular data (CSV / XLSX / XLS), map each column to a semantic role —
dimensions with linkable drill-down hierarchies, measures, date/time, include-flag —
define KPIs, and explore interactive dashboards with current-vs-last-period analysis.
100% client-side — no server, no install.

## Run it

Open `index.html` in a browser, or serve the folder:

```powershell
python -m http.server 8123
# then open http://localhost:8123
```

(Chart.js, PapaParse and SheetJS load from CDNs, so an internet connection is needed.)

## Workflow

### 1. Upload
Drag & drop a CSV/Excel file, or click *Try with sample sales data*.

### 2. Map columns (popup)
Every column is listed with sample values, distinct counts and an auto-detected role:

- **Dimension** — numbered in assignment order (first mapped = Dimension 1, the next is
  always Dimension 2, …). Each dimension has an **optional link** dropdown to mark it as
  related to / a subset of another dimension (e.g. *Product* linked to *Brand*,
  *Country* linked to *Region*). Linked dimensions form a **hierarchy group**, and each
  member gets a **hierarchy level** (H1 = top, e.g. Brand; H2 = Product; …). Functional
  relationships in the data (every Product belongs to exactly one Brand) are detected
  automatically and pre-linked — you can override everything.
- **Measure** — numeric fact with a default aggregation. Numbered like dimensions.
- **Date / Time** — auto-detected; if detection misses it you can map any column manually.
  Multiple date columns supported (the dashboard has a time-axis picker).
- **Include flag (Y/N)** — rows kept only when Y / Yes / True / 1. One flag max.
- **Ignore** — drop the column.

The mapping is saved in the browser per column-layout, so re-uploading a file with the
same columns restores your mapping automatically.

### 3. Attribute master data
On apply, the distinct attributes of every dimension (e.g. Product 1, Product 2, …) are
extracted into master lists with row counts and per-measure totals — the **Master data**
tab shows them and **exports to Excel** (one sheet per dimension). Lists are persisted in
localStorage; the exported workbook can serve as the local master-data backend, and a
Google Sheet / cloud database can be plugged in later behind the same structure.

### 4. KPIs
After mapping you are asked which KPIs to track. A KPI is either an **aggregated
measure** (sum / average / min / max / count) or **two measures combined** (multiplied —
e.g. Units × Price — or divided — e.g. Revenue ÷ Units). Every KPI becomes a header card.

### 5. Overview dashboard
- **Period selector** — *current vs last period* in minutes / hours / days / weeks /
  months / years (e.g. last 1 month vs the month before), or a custom date range
  compared with the equal-length range before it. Anchored to the latest data point.
- **KPI header** — one card per KPI (1 to 10+): current value and % change vs last
  period. Click a card to focus all charts on that KPI.
- **Trend** — current vs last period lines, bucketed by hour/day/week/month/year (auto
  or manual granularity).
- **Drill-down** — pick a hierarchy group, click a bar to drill from H1 down through the
  levels (Brand → Product), with a breadcrumb to climb back up.
- **Top movers** — every attribute of a chosen dimension with last value, current value
  and % change, sorted by *absolute* % change so the biggest swings (up or down) rank first.
- **Compare two dimensions** — stacked breakdown of any dimension against any other.
- **Filters** — per-dimension dropdowns + everything above respects them.
- **Data table** — the mapped rows in the current period.

### 6. Measure deep-dive dashboard
Pick one measure/KPI and get the whole story on one page: trend, a two-hierarchy
comparison, and one chart per dimension (every hierarchy level) showing its top
attributes, current vs last period.

## Files

- `index.html` — page shell: upload view, mapping & KPI modals, three dashboard tabs
- `styles.css` — dark theme styling
- `js/core.js` — helpers, state, parsing, role + hierarchy-link auto-detection, persistence
- `js/analytics.js` — transform, master data, period windows, KPI evaluation, movers
- `js/mapper.js` — mapping popup (roles, links, hierarchy levels)
- `js/kpi.js` — KPI builder popup
- `js/dashboard.js` — overview tab (period bar, KPI header, drill-down, compare, movers)
- `js/deepdive.js` — single-measure deep-dive tab
- `js/main.js` — tabs, master-data tab, wiring
