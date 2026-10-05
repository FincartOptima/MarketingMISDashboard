// app-categorized.js — Categorized Leads tab: On-Hold lead remarks bucketed
// into categories by a calibrated rule-based matcher (scratch_mfsa/classify.py,
// not part of the live site), loaded from categorized_leads_data.js.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

const CATEGORIZED_HEADERS = ['Client Name', 'Current RM', 'Email', 'Mobile', 'Category', 'Remark'];
const CATEGORIZED_PER_PAGE = 25;

// The classification is a point-in-time snapshot re-run by hand against a
// fresh export, so it drifts out of date silently. Past this age it's worth
// surfacing; short enough to catch a forgotten refresh, long enough not to nag.
const CATEGORIZED_STALE_DAYS = 30;

// Counts are derived once per data load — the dataset is a static embedded
// snapshot (tens of thousands of rows), so recomputing per render wasted a
// full pass per table.
let _categorizedStats = null;

/**
 * Per-category counts plus the display order (most common first), matching
 * how the rest of this dashboard presents breakdowns.
 * @returns {{counts:Object<string,number>, order:string[], total:number}}
 */
function categorizedStats(){
  if(_categorizedStats) return _categorizedStats;
  const counts = {};
  for(const row of STATE.categorizedLeads){
    counts[row.category] = (counts[row.category] || 0) + 1;
  }
  _categorizedStats = {
    counts,
    order: Object.keys(counts).sort((a, b) => counts[b] - counts[a]),
    total: STATE.categorizedLeads.length,
  };
  return _categorizedStats;
}

const categorizedCategoryOrder = () => categorizedStats().order;

/** Rows matching the active category dropdown; all rows when 'All'. */
function categorizedFilteredRows(){
  const filter = STATE.categorizedCategoryFilter;
  if(!filter || filter === 'All') return STATE.categorizedLeads;
  return STATE.categorizedLeads.filter(r => r.category === filter);
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
  Mobile: r.mobile, Category: r.category, Remark: r.remark,
});

/** Filename-safe version of the active filter, for the Excel download. */
const categorizedDownloadLabel = () => {
  const filter = STATE.categorizedCategoryFilter;
  return (filter && filter !== 'All') ? filter.replace(/[^\w]+/g, '_').slice(0, 40) : 'All';
};

function renderCategorizedDetail(){
  const rows = categorizedFilteredRows();
  const totalPages = Math.max(1, Math.ceil(rows.length / CATEGORIZED_PER_PAGE));
  STATE.categorizedPage = Math.min(Math.max(1, STATE.categorizedPage || 1), totalPages);
  const start = (STATE.categorizedPage - 1) * CATEGORIZED_PER_PAGE;

  renderTable('#tbl-categorized-detail', CATEGORIZED_HEADERS,
    rows.slice(start, start + CATEGORIZED_PER_PAGE).map(categorizedToRow));

  const pageInfo = $('#categorized-page-info');
  if(pageInfo) pageInfo.textContent = `Page ${STATE.categorizedPage} of ${totalPages} (${fmtIN(rows.length)} leads)`;

  const prev = $('#categorized-prev');
  if(prev){
    prev.disabled = STATE.categorizedPage <= 1;
    prev.onclick = () => { STATE.categorizedPage--; renderCategorizedDetail(); };
  }
  const next = $('#categorized-next');
  if(next){
    next.disabled = STATE.categorizedPage >= totalPages;
    next.onclick = () => { STATE.categorizedPage++; renderCategorizedDetail(); };
  }
  // Downloads the whole filtered set, not just the visible page.
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

  buildMultiSelect('#categorized-category-filter-wrap', ['All', ...categorizedCategoryOrder()],
    STATE.categorizedCategoryFilter,
    val => { STATE.categorizedCategoryFilter = val; STATE.categorizedPage = 1; renderCategorizedLeads(); },
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
