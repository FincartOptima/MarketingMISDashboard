// app-tables.js — Generic table renderer, heat-tier coloring, sortable tables.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

/** Accept either a selector string or a live element, as every caller here does. */
const resolveHost = host => (typeof host === 'string' ? $(host) : host);

/** HTML-safe text for a table cell; null/undefined render as empty. */
const cellText = v => escHtml(v ?? '');

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
  const cell = opts.html ? (v => v ?? '') : cellText;
  checkTableShape(typeof host === 'string' ? host : (host?.id ? `#${host.id}` : 'element'), headers, rows);
  const body = rows.map(r =>
    `<tr class="${tableRowClass(r)}">${headers.map(h => `<td>${cell(fmt(r[h], h, r))}</td>`).join('')}</tr>`
  ).join('');
  const el = resolveHost(host);
  el.innerHTML = `<table class="data ${opts.cls || ''}">
    <thead><tr>${headers.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
  // Export what is on screen, formatted cells and all, so the download and
  // the table can never disagree.
  attachTableDownload(el, headers, rows.map(r => {
    const o = {}; headers.forEach(h => { o[h] = fmt(r[h], h, r); }); o._tot = r._tot; return o;
  }), opts);
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

// ---- per-table Excel download ----
//
// Every table on the dashboard goes through renderTable() or
// makeSortableTable(), so the button is attached in those two places instead
// of at the 39 call sites. Each table therefore gains one without its
// renderer knowing, and a table added tomorrow gets one for free.
//
// What gets exported is what is on screen: the same headers, the same rows,
// in the order currently sorted, under the filters currently applied. That is
// the point — someone asking for "this table in Excel" means the thing they
// are looking at, not the unfiltered dataset behind it.

/** Excel forbids []:*?/\ in a sheet name and truncates past 31 characters. */
const xlsxSheetName = name => (String(name || 'Sheet').replace(/[[\]:*?\/\\]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet');

const xlsxSlug = name => String(name || 'table').replace(/[^A-Za-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '').slice(0, 60) || 'table';

/** The handful of entities the renderers emit, back to characters. */
const XLSX_ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&mdash;': '—', '&ndash;': '–', '&rarr;': '→', '&times;': '×',
  '&middot;': '·', '&rsquo;': '’', '&#8377;': '₹', '&check;': '✓',
};

/**
 * One rendered cell, as a value Excel can actually work with.
 *
 * Cells arrive as display strings ("63.27%", "₹1,04,040", "82d", "1.6×") and
 * sometimes as markup, because tables rendered with `html: true` carry it.
 * A cell that is ONE value becomes a real number so it can be summed,
 * averaged and pivoted; a percentage becomes the fraction with a percent
 * format, so Excel shows 63.27% and averages it correctly rather than
 * averaging the number 63.27 as if it were a count.
 *
 * A cell holding two values — the rate-over-count cells in Who Drives Each
 * Move and the transition matrix use a <br> for exactly that — cannot be one
 * number, so it is exported as readable text ("63.27% · 93") instead of being
 * silently halved. Losing the typing on those two tables is the right trade
 * against exporting a number that means something else.
 *
 * @returns {{v:(string|number), z?:string}}
 */
function xlsxCellValue(raw){
  if(raw == null) return { v: '' };
  if(typeof raw === 'number') return { v: isFinite(raw) ? raw : '' };
  if(typeof raw === 'boolean') return { v: raw ? 'Yes' : 'No' };
  let t = String(raw);
  if(t.indexOf('<') >= 0){
    // <br> separates two values in one cell; keep both, visibly.
    t = t.replace(/<br\s*\/?>/gi, ' · ').replace(/<[^>]*>/g, '');
  }
  if(t.indexOf('&') >= 0){
    t = t.replace(/&[a-z]+;|&#\d+;/gi, m => (XLSX_ENTITIES[m.toLowerCase()] !== undefined
      ? XLSX_ENTITIES[m.toLowerCase()] : ' '));
  }
  t = t.replace(/\s+/g, ' ').trim();
  if(t === '' || t === '—' || t === '-' || t === 'n/a') return { v: t };

  const plain = n => parseFloat(String(n).replace(/,/g, ''));
  let m = /^(-?[\d,]+(?:\.\d+)?)\s*%$/.exec(t);
  if(m) return { v: plain(m[1]) / 100, z: '0.00%' };
  m = /^₹\s*(-?[\d,]+(?:\.\d+)?)$/.exec(t);
  if(m) return { v: plain(m[1]), z: '#,##0' };
  m = /^(-?[\d,]+(?:\.\d+)?)\s*(?:d|×)$/.exec(t);
  if(m) return { v: plain(m[1]) };
  m = /^-?[\d,]+$/.exec(t);
  if(m) return { v: plain(t), z: '#,##0' };
  m = /^-?[\d,]*\.\d+$/.exec(t);
  if(m) return { v: plain(t) };
  return { v: t };
}

/**
 * Write headers + rows to .xlsx, typing each cell and applying the number
 * formats xlsxCellValue() asked for.
 */
function downloadTableAsXlsx(headers, rows, sheetName, fileName){
  if(!window.XLSX){ alert('The spreadsheet library did not load, so Excel export is unavailable. Reload the page.'); return; }
  const cells = rows.map(r => headers.map(h => xlsxCellValue(r[h])));
  const aoa = [headers, ...cells.map(row => row.map(c => c.v))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Number formats have to be set on the sheet after the fact; aoa_to_sheet
  // only carries values.
  cells.forEach((row, ri) => row.forEach((c, ci) => {
    if(!c.z) return;
    const ref = XLSX.utils.encode_cell({ r: ri + 1, c: ci });
    if(ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = c.z;
  }));
  ws['!cols'] = headers.map((h, i) => ({
    wch: Math.min(42, Math.max(String(h).length + 2,
      ...cells.map(row => String(row[i] && row[i].v != null ? row[i].v : '').length + 2))),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, xlsxSheetName(sheetName));
  XLSX.writeFile(wb, fileName);
}

/** The section heading above a table, for the sheet name and the file name. */
function tableTitleFor(hostEl){
  const sec = hostEl.closest ? (hostEl.closest('.section') || hostEl.parentElement) : null;
  const h2 = sec ? sec.querySelector('h2') : null;
  if(h2){
    const c = h2.cloneNode(true);
    c.querySelectorAll('button, .info-btn, a').forEach(n => n.remove());
    const t = c.textContent.replace(/\s+/g, ' ').replace(/[·|]+\s*$/, '').trim();
    if(t) return t;
  }
  return (hostEl.id || 'table').replace(/^tbl-/, '').replace(/-/g, ' ');
}

// Every table host gets a stable key, because the bar is found by lookup
// rather than by adjacency — see attachTableDownload.
let _dlSeq = 0;
const tableDlKey = hostEl => (hostEl.dataset.dlKey
  || (hostEl.dataset.dlKey = hostEl.id || ('tbl-anon-' + (++_dlSeq))));

/**
 * Put a download link above `hostEl`, as a SIBLING rather than inside it:
 * table hosts are `.table-wrap`, which scrolls, and a button inside would
 * scroll away with the rows.
 *
 * The bar is located by `data-for`, NOT by being the previous sibling, and
 * this is load-bearing: attachMirrorScroll() inserts the top scrollbar
 * immediately before every .table-wrap after each render, so an adjacency
 * check stops finding the bar as soon as a mirror lands between the two. It
 * looked fine on a first render and then bred a new button on every filter
 * change — 33 after one pass, and climbing.
 *
 * For the same reason the bar goes ABOVE the mirror, so the order on screen
 * stays download link, top scrollbar, table.
 *
 * Renderers run on every filter change, so the bar is created once per host
 * and its handler rebound to the current data each time.
 */
function attachTableDownload(hostEl, headers, rows, opts){
  if(!hostEl || !hostEl.parentNode) return;
  if(opts && opts.noDownload) return;
  // Nothing to download, and no button promising otherwise.
  const data = (rows || []).filter(r => r && !r._blank);
  const key = tableDlKey(hostEl);
  const existing = hostEl.parentNode.querySelector(
    '.tbl-dl-bar[data-for="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]');
  if(!data.length || (headers || []).length < 2){
    if(existing) existing.remove();
    return;
  }
  const bar = existing || (() => {
    const d = document.createElement('div');
    d.className = 'tbl-dl-bar';
    d.setAttribute('data-for', key);
    d.innerHTML = '<a href="#" class="tbl-dl" role="button">&darr; Excel</a>';
    const prev = hostEl.previousElementSibling;
    const before = (prev && prev.classList && prev.classList.contains('scroll-mirror')) ? prev : hostEl;
    hostEl.parentNode.insertBefore(d, before);
    return d;
  })();
  const link = bar.querySelector('.tbl-dl');
  const title = tableTitleFor(hostEl);
  link.title = 'Download these ' + fmtIN(data.length) + ' row(s) as shown — same columns, same sort, same filters';
  link.onclick = e => {
    e.preventDefault();
    downloadTableAsXlsx(headers, data, title,
      xlsxSlug(title) + '_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  };
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

/** "All", one month, or a comma list — a multi-select value is an array. */
function monthSelectionLabel(){
  return isAllMonths() ? 'All' : effectiveMonths().join(', ');
}

/** Human-readable echo of the active dashboard filters, shown above tables. */
function filterSummary(extra = ''){
  const parts = [`Month: ${monthSelectionLabel()}`, `Ref+Cold: ${rcFilter(STATE.filterRefCold)}`, `Lead Head: ${STATE.filterLeadHead}`];
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
  // Tables rendered with `html: true` hand us markup, so a numeric column
  // like "<strong>1.9×</strong>" has to be unwrapped before it can be
  // compared as a number — otherwise it sorts lexically on its own tags.
  const plain = String(v).replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;|&#\d+;/gi, ' ').trim();
  if(plain === '' || plain === '—') return typeof v === 'string' ? '' : 0;
  const n = parseFloat(plain.replace(/[₹,\s%×]/g, ''));
  return isNaN(n) ? plain.toLowerCase() : n;
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
    `<tr class="${tableRowClass(r)}">${headers.map(h => `<td>${opts.html ? (r[h] ?? '') : cellText(r[h])}</td>`).join('')}</tr>`
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
  // Rows in the order they are displayed, so a re-sort re-exports in the new
  // order and the total row stays pinned last.
  attachTableDownload(el, headers, [...body, ...totals], opts);
}

function updateDashboardHeaderFilters(){
  const summary = filterSummary();
  ['#hdr-platform-month', '#hdr-status-month', '#hdr-team', '#hdr-campaign-team',
   '#hdr-income', '#hdr-cost-summary', '#hdr-cpl-rm']
    .forEach(sel => { const el = $(sel); if(el) el.textContent = summary; });
  const ps = $('#hdr-platform-status');
  if(ps) ps.textContent = filterSummary(`Table: ${STATE.filterTable}`);
}
