// app-tables.js — Generic table renderer, heat-tier coloring, sortable tables.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

/** Accept either a selector string or a live element, as every caller here does. */
const resolveHost = host => (typeof host === 'string' ? $(host) : host);

/** Row modifier classes: `_tot` marks a grand-total row, `_heat` a quartile tier. */
const tableRowClass = r => [r._tot ? 'grand' : '', r._heat ? `heat-${r._heat}` : '']
  .filter(Boolean).join(' ');

// ---- guard: header/row-key mismatch ----
// renderTable pulls each cell as `row[header]`, so a header with no
// matching key on any row renders an entirely blank column — silently, and
// looking exactly like legitimately-empty data. This has bitten for real:
// an "Assigned To" column rendered blank for every row because the values
// were being passed through a numeric formatter that returned '' for text.
//
// Checked across ALL rows rather than per row, because a grand-total row
// legitimately fills only some columns.
const _tableShapeIssues = new Map(); // "host :: header" -> { host, header, rowCount }

function checkTableShape(hostId, headers, rows){
  if(!rows.length) return; // nothing rendered, nothing to verify
  const presentKeys = new Set();
  rows.forEach(r => Object.keys(r).forEach(k => presentKeys.add(k)));
  headers
    .filter(h => !presentKeys.has(h))
    .forEach(h => _tableShapeIssues.set(`${hostId} :: ${h}`, { host: hostId, header: h, rowCount: rows.length }));
}

/** @returns {{total:number, columns:Array<{host:string,header:string,rowCount:number}>}} */
function tableShapeIssues(){
  const columns = [..._tableShapeIssues.values()];
  return { total: columns.length, columns };
}

/**
 * Plain-language description of any blank-column problems found.
 * @returns {{headline:string, detail:string, fix:string}|null} null when clean.
 */
function tableShapeIssueReport(){
  const { total, columns } = tableShapeIssues();
  if(!total) return null;
  const worst = columns.slice(0, 8).map(c => `"${c.header}" in ${c.host}`).join(', ');
  return {
    headline: `${total} table column(s) rendered completely blank`,
    detail: `These columns were requested but no row supplied a matching value, ` +
            `so they render empty and look like missing data rather than a wiring fault: ${worst}.`,
    fix: 'The column header and the row object key must match exactly (including case and spacing). ' +
         'Check the toRow/mapping function feeding that table — a renamed key or a formatter returning ' +
         'empty for non-numeric text is the usual cause.',
  };
}

// ---- table renderer ----

/**
 * Render an array of plain objects as a table, keyed by header name.
 * @param {string|Element} host Selector or element to render into.
 * @param {string[]} headers Column headers; each doubles as the row key.
 * @param {Array<Object>} rows Row objects. `_tot` marks a total row, `_heat` a heat tier.
 * @param {{fmt?:Function, cls?:string}} [opts] fmt(value, header, row) formats each cell.
 */
function renderTable(host, headers, rows, opts = {}){
  const fmt = opts.fmt || (v => v);
  checkTableShape(typeof host === 'string' ? host : (host?.id ? `#${host.id}` : 'element'), headers, rows);
  const body = rows.map(r =>
    `<tr class="${tableRowClass(r)}">${headers.map(h => `<td>${fmt(r[h], h, r)}</td>`).join('')}</tr>`
  ).join('');
  resolveHost(host).innerHTML = `<table class="data ${opts.cls || ''}">
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

/**
 * Download a headers+rows pair (the same shape renderTable takes) as .xlsx.
 */
function downloadRowsAsXlsx(headers, rows, sheetName, fileName){
  const aoa = [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}

// ---- heat tiers (quartile-based row highlighting) ----

/** Best-effort number out of a formatted cell ("₹1,234" → 1234); 0 when unreadable. */
function numFromCell(v){
  if(v == null) return 0;
  if(typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// Lower value = better for this metric (cost per lead, say), so the
// quartile scale is flipped end for end.
const INVERTED_TIER = { high: 'vlow', mid: 'low', low: 'mid', vlow: 'high' };

/**
 * Tag each non-total row with a quartile tier in `_heat`.
 * @param {Array<Object>} rows Mutated in place and returned.
 * @param {string} heatBy Header whose value determines the tier.
 * @param {{invert?:boolean}} [opts] invert=true → lowest value gets the best tier.
 */
function applyHeat(rows, heatBy, opts = {}){
  const scored = rows.filter(r => !r._tot);
  const values = scored.map(r => numFromCell(r[heatBy])).sort((a, b) => a - b);
  if(values.length < 2) return rows; // too few points for quartiles to mean anything

  const quartile = q => values[Math.min(values.length - 1, Math.max(0, Math.floor(values.length * q)))];
  const [q25, q50, q75] = [quartile(0.25), quartile(0.50), quartile(0.75)];

  for(const r of scored){
    const v = numFromCell(r[heatBy]);
    const tier = v >= q75 ? 'high' : v >= q50 ? 'mid' : v >= q25 ? 'low' : 'vlow';
    r._heat = opts.invert ? INVERTED_TIER[tier] : tier;
  }
  return rows;
}

// Every heated table applies the quartile heat tiers to its rows, then
// renders the matching legend, immediately before rendering the table
// itself. Consolidates that 2-call idiom (13 call sites).
function applyHeatAndLegend(rows, heatByField, legendSelector, legendLabel, invert = false){
  applyHeat(rows, heatByField, { invert });
  renderHeatLegend(legendSelector, legendLabel, invert);
}

function renderHeatLegend(host, metricLabel, invert){
  const el = resolveHost(host);
  if(!el) return;
  const tiers = invert
    ? [['hl-high', 'Best (lowest 25%)'], ['hl-mid', 'Good'], ['hl-low', 'Below median'], ['hl-vlow', 'Worst (top 25%)']]
    : [['hl-high', 'Top 25%'], ['hl-mid', 'Above median'], ['hl-low', 'Below median'], ['hl-vlow', 'Bottom 25%']];
  el.innerHTML = '<div class="heat-legend">'
    + `<span class="hl-item" style="color:var(--text)">${escHtml(metricLabel)}:</span>`
    + tiers.map(([cls, lbl]) => `<span class="hl-item"><i class="hl-sw ${cls}"></i>${lbl}</span>`).join('')
    + '</div>';
}

/** Human-readable echo of the active dashboard filters, shown above tables. */
function filterSummary(extra = ''){
  const parts = [`Month: ${STATE.filterMonth}`, `Ref+Cold: ${STATE.filterRefCold}`, `Lead Head: ${STATE.filterLeadHead}`];
  const status = STATE.filterStatus;
  if(status && status !== 'All' && !(Array.isArray(status) && status.length === 0)){
    parts.push(`Status: ${Array.isArray(status) ? status.join(', ') : status}`);
  }
  if(extra) parts.push(extra);
  return `(${parts.join(' | ')})`;
}

// ---- sortable tables ----
const SORT_STATE = {};

/** Numbers sort numerically even when formatted ("₹1,234", "12%"); text falls back to case-insensitive. */
function sortVal(v){
  if(v == null || v === '' || v === '—') return typeof v === 'string' ? '' : 0;
  const n = parseFloat(String(v).replace(/[₹,\s%]/g, ''));
  return isNaN(n) ? String(v).toLowerCase() : n;
}

/**
 * Like renderTable, but every header is clickable to sort. Total rows are
 * pinned to the bottom regardless of sort. Sort state persists per host.
 * @param {Function} rerenderFn Called after a sort click; must call back into this.
 */
function makeSortableTable(host, headers, rows, rerenderFn, opts = {}){
  const id = typeof host === 'string' ? host : '#el';
  const sort = SORT_STATE[id] || (SORT_STATE[id] = { col: null, dir: 'desc' });
  checkTableShape(id, headers, rows);

  const totals = rows.filter(r => r._tot);
  let body = rows.filter(r => !r._tot);
  if(sort.col){
    body = [...body].sort((a, b) => {
      const av = sortVal(a[sort.col]), bv = sortVal(b[sort.col]);
      if(typeof av === 'string' && typeof bv === 'string'){
        return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sort.dir === 'asc' ? av - bv : bv - av;
    });
  }

  const thHtml = headers.map(h => {
    const icon = sort.col === h ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅';
    return `<th class="srt-th" data-col="${escHtml(h)}" style="cursor:pointer;user-select:none;white-space:nowrap">${escHtml(h)} <span style="opacity:0.45;font-size:10px">${icon}</span></th>`;
  }).join('');
  const bodyHtml = [...body, ...totals].map(r =>
    `<tr class="${tableRowClass(r)}">${headers.map(h => `<td>${r[h] ?? ''}</td>`).join('')}</tr>`
  ).join('');

  const el = resolveHost(host);
  el.innerHTML = `<table class="data ${opts.cls || ''}"><thead><tr>${thHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
  el.querySelectorAll('th.srt-th').forEach(th => {
    th.onclick = () => {
      const col = th.dataset.col;
      if(sort.col === col) sort.dir = sort.dir === 'desc' ? 'asc' : 'desc';
      else { sort.col = col; sort.dir = 'desc'; }
      rerenderFn();
    };
  });
}

function updateDashboardHeaderFilters(){
  const summary = filterSummary();
  ['#hdr-platform-month', '#hdr-status-month', '#hdr-team', '#hdr-campaign-team',
   '#hdr-income', '#hdr-cost-summary', '#hdr-cpl-rm']
    .forEach(sel => { const el = $(sel); if(el) el.textContent = summary; });
  const ps = $('#hdr-platform-status');
  if(ps) ps.textContent = filterSummary(`Table: ${STATE.filterTable}`);
}
