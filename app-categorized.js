// app-categorized.js — Categorized Leads tab: On-Hold lead remarks bucketed
// into categories by a calibrated rule-based matcher (scratch_mfsa/classify.py,
// not part of the live site), loaded from categorized_leads_data.js.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

const CATEGORIZED_HEADERS = ['Client Name', 'Current RM', 'Email', 'Mobile', 'Created Date', 'Campaign', 'Platform', 'Category', 'Remark'];

// The classification is a point-in-time snapshot re-run by hand against a
// fresh export, so it drifts out of date silently. Past this age it's worth
// surfacing; short enough to catch a forgotten refresh, long enough not to nag.
const CATEGORIZED_STALE_DAYS = 30;

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM' → 'Oct 2026'. */
const categorizedMonthLabel = ym => `${MONTH_ABBR[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

/** Distinct created months present in the snapshot, oldest first ('YYYY-MM'). */
function categorizedMonths(){
  return [...new Set(STATE.categorizedLeads.map(r => (r.createdDate || '').slice(0, 7)).filter(Boolean))].sort();
}

// Leads created inside the selected month range (bounds inclusive, '' = open).
// Memoised on the bounds — the snapshot is static, so only a range change
// invalidates it.
let _categorizedRange = { key: null, rows: [] };
function categorizedRangeRows(){
  const from = STATE.categorizedFromMonth, to = STATE.categorizedToMonth;
  const key = `${from}|${to}`;
  if(_categorizedRange.key === key) return _categorizedRange.rows;
  const rows = (!from && !to) ? STATE.categorizedLeads : STATE.categorizedLeads.filter(r => {
    const m = (r.createdDate || '').slice(0, 7);
    return m && (!from || m >= from) && (!to || m <= to);
  });
  _categorizedRange = { key, rows };
  _categorizedStats = null;
  return rows;
}

// Counts are derived once per range — the dataset is a static embedded
// snapshot (tens of thousands of rows), so recomputing per render wasted a
// full pass per table.
let _categorizedStats = null;

/**
 * Per-category counts plus the display order (most common first), matching
 * how the rest of this dashboard presents breakdowns.
 * @returns {{counts:Object<string,number>, order:string[], total:number}}
 */
function categorizedStats(){
  const rangeRows = categorizedRangeRows();
  if(_categorizedStats) return _categorizedStats;
  const counts = {};
  for(const row of rangeRows){
    counts[row.category] = (counts[row.category] || 0) + 1;
  }
  _categorizedStats = {
    counts,
    order: Object.keys(counts).sort((a, b) => counts[b] - counts[a]),
    total: rangeRows.length,
  };
  return _categorizedStats;
}

const categorizedCategoryOrder = () => categorizedStats().order;

/** Rows in the created-month range matching the category dropdown; all of them when 'All'. */
function categorizedFilteredRows(){
  const filter = STATE.categorizedCategoryFilter;
  const rows = categorizedRangeRows();
  if(!filter || filter === 'All') return rows;
  return rows.filter(r => r.category === filter);
}

// ---- guards: is this snapshot trustworthy? ----
// This tab is driven entirely by a hand-regenerated file, so the realistic
// failure modes are "it went stale" and "the generator emitted incomplete
// rows" — both of which otherwise look like perfectly normal output.

/** Whole-number days since the snapshot was generated, or null if unknown/unparseable. */
function categorizedSnapshotAgeDays(){
  const generated = Date.parse(STATE.categorizedGeneratedAt || '');
  if(isNaN(generated)) return null;
  return Math.floor((Date.now() - generated) / 86400000);
}

/**
 * Integrity findings for the loaded classification snapshot.
 * @returns {{blankCategory:number, blankEmail:number, reconciles:boolean,
 *            ageDays:number|null, stale:boolean, needsReview:boolean}}
 */
function categorizedDataIssues(){
  const { counts, total } = categorizedStats();
  // A row with no category silently becomes its own phantom bucket in both
  // the dropdown and the summary, which reads as a real category.
  const blankCategory = STATE.categorizedLeads.reduce((n, r) => n + (r.category ? 0 : 1), 0);
  // Email is the join key to every other dataset — blank rows can't be matched.
  const blankEmail = STATE.categorizedLeads.reduce((n, r) => n + (r.email ? 0 : 1), 0);
  const summed = Object.values(counts).reduce((a, b) => a + b, 0);
  const ageDays = categorizedSnapshotAgeDays();
  const stale = ageDays != null && ageDays > CATEGORIZED_STALE_DAYS;

  return {
    blankCategory,
    blankEmail,
    reconciles: summed === total,
    ageDays,
    stale,
    needsReview: blankCategory > 0 || blankEmail > 0 || summed !== total || stale,
  };
}

/**
 * Plain-language problem description for display.
 * @returns {{headline:string, detail:string, fix:string}|null} null when clean.
 */
function categorizedDataIssueReport(){
  const issues = categorizedDataIssues();
  if(!issues.needsReview) return null;

  const problems = [];
  if(issues.blankCategory) problems.push(`${fmtIN(issues.blankCategory)} row(s) have no category, so they form a blank bucket in the dropdown`);
  if(issues.blankEmail) problems.push(`${fmtIN(issues.blankEmail)} row(s) have no email, so they can't be matched to any other report`);
  if(!issues.reconciles) problems.push('the per-category counts do not add up to the row total');
  if(issues.stale) problems.push(`the classification is ${issues.ageDays} days old, so recent On-Hold leads are missing`);

  return {
    headline: 'This categorization needs review before you rely on it',
    detail: `${problems.join('; ')}.`,
    fix: 'Re-run `python scratch_mfsa/run_classification.py` against a fresh RAW_DATA export — ' +
         'it rewrites both the Excel file and categorized_leads_data.js. If rows still come through ' +
         'blank afterwards, the source export is missing leadActivity1 or userId for those leads.',
  };
}

/** Warning block styled like the existing not-uploaded notice, so it reads as native. */
function categorizedWarningHtml(report){
  return `<div class="file-not-uploaded"><span class="fnu-icon">&#9888;</span>` +
    `<strong>${escHtml(report.headline)}</strong><br>${escHtml(report.detail)}` +
    `<br><em>${escHtml(report.fix)}</em></div>`;
}

// ---- rendering ----

function renderCategorizedSummary(){
  const { counts, order, total } = categorizedStats();
  const rows = order.map(category => ({
    Category: category,
    Count: fmtIN(counts[category]),
    Percent: fmtPct(counts[category] / total),
  }));
  rows.push({ Category: 'Total', Count: fmtIN(total), Percent: fmtPct(1), _tot: true });
  renderTable('#tbl-categorized-summary', ['Category', 'Count', 'Percent'], rows);
}

const categorizedToRow = r => ({
  'Client Name': r.clientName, 'Current RM': r.currentRm, Email: r.email,
  Mobile: r.mobile, 'Created Date': r.createdDate, Campaign: r.campaign, Platform: r.platform,
  Category: r.category, Remark: r.remark,
});

/** Filename-safe version of the active filters, for the Excel download. */
const categorizedDownloadLabel = () => {
  const filter = STATE.categorizedCategoryFilter;
  const category = (filter && filter !== 'All') ? filter.replace(/[^\w]+/g, '_').slice(0, 40) : 'All';
  const { categorizedFromMonth: from, categorizedToMonth: to } = STATE;
  return (from || to) ? `${category}_${from || 'start'}_to_${to || 'latest'}` : category;
};

/** Fill the From/To month dropdowns once (options come from the data) and wire them up. */
function setupCategorizedMonthFilters(){
  const fromSel = $('#categorized-from-month'), toSel = $('#categorized-to-month');
  if(!fromSel || !toSel) return;
  if(!fromSel.options.length){
    const months = categorizedMonths();
    const options = first => `<option value="">${first}</option>` +
      months.map(m => `<option value="${m}">${categorizedMonthLabel(m)}</option>`).join('');
    fromSel.innerHTML = options('Earliest');
    toSel.innerHTML = options('Latest');
  }
  fromSel.value = STATE.categorizedFromMonth;
  toSel.value = STATE.categorizedToMonth;
  const apply = e => {
    let from = fromSel.value, to = toSel.value;
    // Keep the range valid: moving one end past the other drags the other along.
    if(from && to && from > to){
      if(e.target === fromSel) to = from; else from = to;
    }
    STATE.categorizedFromMonth = from;
    STATE.categorizedToMonth = to;
    renderCategorizedLeads();
  };
  fromSel.onchange = apply;
  toSel.onchange = apply;
}

// ---- windowed detail list ----
// The detail list is the whole filtered set (tens of thousands of rows).
// Drawing every row freezes the page for several seconds, so only the rows in
// view (plus a small buffer) are in the DOM; spacer rows stand in for the rest
// so the scrollbar still spans the full list.
const CATEGORIZED_ROW_BUFFER = 15;
const CATEGORIZED_ROW_PX = 34; // measured from the first painted row; this is the fallback
// Fixed column widths (px) keep columns steady while rows swap in and out of
// the window. Long text is ellipsised and shown in full on hover.
const CATEGORIZED_COL_PX = {
  'Client Name': 170, 'Current RM': 170, Email: 230, Mobile: 100, 'Created Date': 120,
  Campaign: 110, Platform: 150, Category: 270, Remark: 480,
};

let _categorizedWin = null; // { host, rows, tbody, rowPx, headPx, first, last }

const categorizedSpacerHtml = px => px > 0
  ? `<tr class="cat-spacer" style="height:${px}px"><td colspan="${CATEGORIZED_HEADERS.length}" style="height:${px}px"></td></tr>`
  : '';

function categorizedRowHtml(lead){
  const row = categorizedToRow(lead);
  return '<tr class="cat-row">' + CATEGORIZED_HEADERS.map(h => {
    const text = escHtml(row[h]);
    return `<td title="${text}">${text}</td>`;
  }).join('') + '</tr>';
}

/** Draw the slice of rows that is on screen (plus buffer) and update the position read-out. */
function paintCategorizedWindow(){
  const w = _categorizedWin;
  if(!w) return;
  const { host, rows } = w;
  const view = host.clientHeight || 600;
  const first = Math.max(0, Math.floor((host.scrollTop - w.headPx) / w.rowPx) - CATEGORIZED_ROW_BUFFER);
  const last = Math.min(rows.length, Math.ceil((host.scrollTop + view - w.headPx) / w.rowPx) + CATEGORIZED_ROW_BUFFER);
  if(first !== w.first || last !== w.last){
    w.tbody.innerHTML = categorizedSpacerHtml(first * w.rowPx) +
      rows.slice(first, last).map(categorizedRowHtml).join('') +
      categorizedSpacerHtml((rows.length - last) * w.rowPx);
    w.first = first;
    w.last = last;
  }
  const info = $('#categorized-page-info');
  if(info){
    const top = Math.min(rows.length, Math.max(1, Math.floor(Math.max(0, host.scrollTop) / w.rowPx) + 1));
    const bottom = Math.min(rows.length, Math.max(top, Math.ceil((host.scrollTop + view - w.headPx) / w.rowPx)));
    info.textContent = `Rows ${fmtIN(top)}–${fmtIN(bottom)} of ${fmtIN(rows.length)} leads`;
  }
}

let _categorizedPaintQueued = false;
function scheduleCategorizedPaint(){
  if(_categorizedPaintQueued) return;
  _categorizedPaintQueued = true;
  requestAnimationFrame(() => { _categorizedPaintQueued = false; paintCategorizedWindow(); });
}

function renderCategorizedWindow(host, rows){
  const info = $('#categorized-page-info');
  if(!rows.length){
    _categorizedWin = null;
    host.innerHTML = '<div class="hint" style="padding:14px">No leads match these filters.</div>';
    if(info) info.textContent = '0 leads';
    return;
  }
  const widths = CATEGORIZED_HEADERS.map(h => CATEGORIZED_COL_PX[h]);
  host.innerHTML =
    `<table class="data cat-window" style="width:${widths.reduce((a, b) => a + b, 0)}px;min-width:100%">` +
    `<colgroup>${widths.map(px => `<col style="width:${px}px">`).join('')}</colgroup>` +
    `<thead><tr>${CATEGORIZED_HEADERS.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead><tbody></tbody></table>`;
  host.scrollTop = 0;

  _categorizedWin = {
    host, rows, tbody: host.querySelector('tbody'),
    rowPx: CATEGORIZED_ROW_PX, headPx: host.querySelector('thead').getBoundingClientRect().height, first: -1, last: -1,
  };
  paintCategorizedWindow();
  // Row height comes from the page's own CSS (and zoom), so measure it rather
  // than trust the constant, then redraw if it differs.
  const sample = _categorizedWin.tbody.querySelector('tr.cat-row');
  const measured = sample && sample.getBoundingClientRect().height;
  if(measured && Math.abs(measured - _categorizedWin.rowPx) > 0.01){
    _categorizedWin.rowPx = measured;
    _categorizedWin.first = _categorizedWin.last = -1;
    paintCategorizedWindow();
  }

  if(!host.dataset.windowBound){
    host.dataset.windowBound = '1';
    host.addEventListener('scroll', scheduleCategorizedPaint, { passive: true });
    window.addEventListener('resize', scheduleCategorizedPaint);
  }
}

function renderCategorizedDetail(){
  const rows = categorizedFilteredRows();
  checkTableShape('#tbl-categorized-detail', CATEGORIZED_HEADERS, rows.slice(0, 50).map(categorizedToRow));
  renderCategorizedWindow($('#tbl-categorized-detail'), rows);

  // Downloads the whole filtered set, not just the rows on screen.
  const download = $('#categorized-download');
  if(download){
    download.onclick = () => downloadRowsAsXlsx(CATEGORIZED_HEADERS, rows.map(categorizedToRow),
      'Categorized Leads', `OnHold_Leads_${categorizedDownloadLabel()}.xlsx`);
  }
}

function renderCategorizedLeads(){
  if(!STATE.filesLoaded.categorized){
    setNotUploaded('#tbl-categorized-summary', 'categorized');
    setNotUploaded('#tbl-categorized-detail', 'categorized');
    const wrap = $('#categorized-category-filter-wrap');
    if(wrap) wrap.innerHTML = '';
    return;
  }

  setupCategorizedMonthFilters();
  // A category with no leads in the chosen range drops out of the dropdown,
  // so fall back to All rather than leave an unlisted selection filtering to nothing.
  if(!categorizedCategoryOrder().includes(STATE.categorizedCategoryFilter)) STATE.categorizedCategoryFilter = 'All';
  buildMultiSelect('#categorized-category-filter-wrap', ['All', ...categorizedCategoryOrder()],
    STATE.categorizedCategoryFilter,
    val => { STATE.categorizedCategoryFilter = val; renderCategorizedLeads(); },
    { multi: false });

  renderCategorizedSummary();
  renderCategorizedDetail();

  const note = $('#categorized-generated-note');
  if(note){
    const generated = STATE.categorizedGeneratedAt
      ? `Classified ${STATE.categorizedGeneratedAt} — re-run scratch_mfsa/run_classification.py against a fresh export to update.`
      : '';
    const report = categorizedDataIssueReport();
    note.innerHTML = escHtml(generated) + (report ? categorizedWarningHtml(report) : '');
    if(report) console.warn(`[MIS] ${report.headline}: ${report.detail} Fix: ${report.fix}`);
  }
}
