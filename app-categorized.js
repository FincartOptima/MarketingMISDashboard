// app-categorized.js — Categorized Leads tab: On-Hold lead remarks bucketed
// into categories by a calibrated rule-based matcher (scratch_mfsa/classify.py,
// not part of the live site), loaded from categorized_leads_data.js.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

// Category list ordered by count desc, cached per data load — same order
// the summary table and the dropdown use, so "All" lines up with "most
// common first" the way the rest of this dashboard presents breakdowns.
let _categorizedCategoryOrder = null;
function categorizedCategoryOrder(){
  if(_categorizedCategoryOrder) return _categorizedCategoryOrder;
  const counts = {};
  STATE.categorizedLeads.forEach(r => { counts[r.category] = (counts[r.category]||0) + 1; });
  _categorizedCategoryOrder = Object.keys(counts).sort((a,b) => counts[b]-counts[a]);
  return _categorizedCategoryOrder;
}

function categorizedFilteredRows(){
  const f = STATE.categorizedCategoryFilter;
  if(!f || f === 'All') return STATE.categorizedLeads;
  return STATE.categorizedLeads.filter(r => r.category === f);
}

function renderCategorizedSummary(){
  const total = STATE.categorizedLeads.length;
  const counts = {};
  STATE.categorizedLeads.forEach(r => { counts[r.category] = (counts[r.category]||0) + 1; });
  const rows = categorizedCategoryOrder().map(cat => ({
    Category: cat, Count: fmtIN(counts[cat]), Percent: fmtPct(counts[cat]/total),
  }));
  rows.push({ Category: 'Total', Count: fmtIN(total), Percent: fmtPct(1), _tot: true });
  renderTable('#tbl-categorized-summary', ['Category','Count','Percent'], rows);
}

function renderCategorizedDetail(){
  const headers = ['Client Name','Current RM','Email','Mobile','Category','Remark'];
  const toRow = r => ({
    'Client Name': r.clientName, 'Current RM': r.currentRm, Email: r.email,
    Mobile: r.mobile, Category: r.category, Remark: r.remark,
  });
  const rows = categorizedFilteredRows();

  const perPage = 25;
  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  STATE.categorizedPage = Math.min(Math.max(1, STATE.categorizedPage || 1), totalPages);
  const startIdx = (STATE.categorizedPage - 1) * perPage;
  renderTable('#tbl-categorized-detail', headers, rows.slice(startIdx, startIdx+perPage).map(toRow));

  const pageInfo = $('#categorized-page-info');
  if(pageInfo) pageInfo.textContent = `Page ${STATE.categorizedPage} of ${totalPages} (${fmtIN(rows.length)} leads)`;
  const prevBtn = $('#categorized-prev');
  if(prevBtn){ prevBtn.disabled = STATE.categorizedPage<=1; prevBtn.onclick = () => { STATE.categorizedPage--; renderCategorizedDetail(); }; }
  const nextBtn = $('#categorized-next');
  if(nextBtn){ nextBtn.disabled = STATE.categorizedPage>=totalPages; nextBtn.onclick = () => { STATE.categorizedPage++; renderCategorizedDetail(); }; }

  const dlBtn = $('#categorized-download');
  if(dlBtn) dlBtn.onclick = () => {
    const label = (STATE.categorizedCategoryFilter && STATE.categorizedCategoryFilter!=='All')
      ? STATE.categorizedCategoryFilter.replace(/[^\w]+/g,'_').slice(0,40) : 'All';
    downloadRowsAsXlsx(headers, rows.map(toRow), 'Categorized Leads', `OnHold_Leads_${label}.xlsx`);
  };
}

function renderCategorizedLeads(){
  if(!STATE.filesLoaded.categorized){
    setNotUploaded('#tbl-categorized-summary', 'categorized');
    setNotUploaded('#tbl-categorized-detail', 'categorized');
    const w = $('#categorized-category-filter-wrap'); if(w) w.innerHTML = '';
    return;
  }

  buildMultiSelect('#categorized-category-filter-wrap', ['All', ...categorizedCategoryOrder()], STATE.categorizedCategoryFilter,
    val => { STATE.categorizedCategoryFilter = val; STATE.categorizedPage = 1; renderCategorizedLeads(); }, { multi: false });

  renderCategorizedSummary();
  renderCategorizedDetail();

  const note = $('#categorized-generated-note');
  if(note) note.textContent = STATE.categorizedGeneratedAt ? `Classified ${STATE.categorizedGeneratedAt} — re-run scratch_mfsa/run_classification.py against a fresh export to update.` : '';
}
