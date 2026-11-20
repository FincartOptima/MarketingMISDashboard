// app-b2b-view.js — draws the Dashboard's B2B Corporate Leads sub-tab from the model in app-b2b.js.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

const B2B_TALLY_HEADERS = ['Companies', 'Leads', ...STATUSES, 'Conv. Rate', 'QL Conv. Rate'];
const B2B_COMPANY_HEADERS = ['Employee', 'Company', 'Lead Type', 'Leads', ...STATUSES, 'Conv. Rate', 'QL Conv. Rate'];
const B2B_VIEW_HOSTS = ['#tbl-b2b-type', '#tbl-b2b-employee', '#tbl-b2b-company', '#b2b-guards'];

// ---- cells ----

/** A tally row as table cells: counts with Indian digit grouping, rates as percentages. */
function b2bTallyCells(row){
  const cells = { Companies: fmtIN(row.Companies), Leads: fmtIN(row.Leads),
    'Conv. Rate': fmtPct(row['Conv. Rate']), 'QL Conv. Rate': fmtPct(row['QL Conv. Rate']) };
  STATUSES.forEach(status => { cells[status] = fmtIN(row[status]); });
  return cells;
}

/** What a table's Excel button carries: the clients its rows were counted from, under the table's own filters. */
const b2bClientDownload = (leads, name) => ({ ...b2bClientRows(leads), name });

function renderB2BTally(host, labelField, rows, leads, name){
  renderTable(host, [labelField, ...B2B_TALLY_HEADERS],
    rows.map(r => ({ [labelField]: r[labelField], ...b2bTallyCells(r), _tot: !!r._tot })),
    { download: b2bClientDownload(leads, name) });
}

/** Sortable per-company table. `rows` and `leads` are closed over so a sort click redraws the same data. */
function renderB2BCompanyTable(host, rows, leads, name){
  const cells = rows.map(r => ({
    Employee: r.Employee, Company: r.Company ?? '', 'Lead Type': r['Lead Type'] ?? '',
    ...b2bTallyCells(r), _tot: !!r._tot,
  }));
  makeSortableTable(host, B2B_COMPANY_HEADERS, cells, () => renderB2BCompanyTable(host, rows, leads, name),
    { download: b2bClientDownload(leads, name) });
}

// ---- tiles ----

function renderB2BKpiTiles(host, cards){
  $(host).innerHTML = cards.map(c => `
    <div class="kpi kpi-${c.tone}"${c.title ? ` title="${escHtml(c.title)}"` : ''}>
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-label">${escHtml(c.label)}</div>
    </div>`).join('');
}

/**
 * Leads generated from Google (Corporate): the leads the Corporate Leads card counts, narrowed to those whose
 * landing page contains "_FC". One definition shared by the Overview and the B2B tab so they cannot disagree.
 */
function b2bGoogleCard(leads = b2bScopedLeads()){
  return {
    label: 'Leads Generated from Google (Corporate)',
    value: fmtIN(b2bGoogleLeads(leads).length),
    tone: 'orange',
    title: `The Corporate leads counted in the Corporate Leads card (same Month, Lead Head, Ref+Cold and Status filters) `
      + `whose landing page contains "${CONFIG.B2B_GOOGLE_MARKER}".`,
  };
}

function b2bOverviewCards(t, leads){
  return [
    { label: 'Corporate Leads', value: fmtIN(t.Leads), tone: 'blue' },
    { label: 'Companies', value: fmtIN(t.Companies), tone: 'cyan' },
    { label: 'Converted', value: fmtIN(t.CONVERTED), tone: 'green',
      title: 'Leads with a converted date — the written status is not used.' },
    { label: 'In Process', value: fmtIN(t['IN PROCESS']), tone: 'cyan' },
    { label: 'Conv. Rate', value: fmtPct(t['Conv. Rate']), tone: 'violet', title: 'Converted ÷ Corporate Leads.' },
    { label: 'QL Conversion Rate', value: fmtPct(t['QL Conv. Rate']), tone: 'violet',
      title: '(Converted + In Process) ÷ Corporate Leads — the same formula as the Overview\'s QL Conversion Rate.' },
    b2bGoogleCard(leads),
  ];
}

// ---- guards ----

let _b2bWarnedFor = '';
let _b2bNotesOpen = null;     // null until first render: open only when something is actually wrong

/** One note, in the same layout as the Data Health panel's items. */
const b2bNoteHtml = r => `
  <li class="health-item health-${r.level}">
    <div class="health-title">${r.level === 'error' ? '&#9940;' : '&#9888;&#65039;'} ${escHtml(r.headline)}</div>
    <div>${escHtml(r.detail)}</div>
    <div class="health-fix"><em>To fix:</em> ${escHtml(r.fix)}</div>
  </li>`;

/**
 * The tab's data notes as one collapsible panel, so standing notes do not push the tables off the first
 * screen. Collapsed it still says how many there are; it opens by itself when one is an error.
 * Each is also said once in the console, and the Data Health panel lists the same set.
 */
function renderB2BGuards(){
  const host = $('#b2b-guards');
  const reports = b2bIssueReports();
  const signature = reports.map(r => r.headline).join('|');
  if(signature && signature !== _b2bWarnedFor){
    reports.forEach(r => console.warn(`[MIS] ${r.headline}. ${r.detail} Fix: ${r.fix}`));
  }
  _b2bWarnedFor = signature;
  if(!reports.length){ host.innerHTML = ''; return; }

  const worst = reports.some(r => r.level === 'error') ? 'error' : 'warn';
  if(_b2bNotesOpen === null) _b2bNotesOpen = worst === 'error';
  const summary = `&#9888;&#65039; ${reports.length} data note${reports.length > 1 ? 's' : ''} for this tab — click to ${_b2bNotesOpen ? 'hide' : 'read'}`;
  host.innerHTML = `
    <div class="health-panel health-${worst}">
      <button type="button" class="health-toggle" aria-expanded="${_b2bNotesOpen}">${summary}
        <span class="health-caret">${_b2bNotesOpen ? '&#9650;' : '&#9660;'}</span></button>
      ${_b2bNotesOpen ? `<ul class="health-list">${reports.map(b2bNoteHtml).join('')}</ul>` : ''}
    </div>`;
  host.querySelector('.health-toggle').onclick = () => { _b2bNotesOpen = !_b2bNotesOpen; renderB2BGuards(); };
}

// ---- filters ----

/**
 * One filter widget bound to a STATE key. It keeps the stored selection to the values still on offer, draws the
 * widget, and on a change stores the new selection, runs `onChange` (which resets any filter that depends on
 * this one) and then `redraw`. Returns the selection as a list, or null for "All".
 */
function b2bFilter(host, key, options, fallback, { redraw, onChange = null, search = false }){
  STATE[key] = b2bReconcileSelection(STATE[key], options, fallback);
  buildMultiSelect(host, options, STATE[key], value => {
    STATE[key] = b2bKeepSelection(value);
    if(onChange) onChange();
    redraw();
  }, { multi: true, search });
  return b2bSelectionList(STATE[key]);
}

// ---- the sub-tab ----

/** The Companies column can add up to more than the grand total when one company is sold two ways. */
function renderB2BTypeNote(rows){
  const total = rows.find(r => r._tot).Companies;
  const summed = rows.filter(r => !r._tot).reduce((sum, r) => sum + r.Companies, 0);
  $('#b2b-type-note').textContent = summed > total
    ? `${fmtIN(summed - total)} company(ies) are sourced more than one way, so they count under each type; the Grand Total counts every company once.`
    : '';
}

/** By Lead Type, narrowed to the employees picked in its filter (All by default). */
function renderB2BTypeSection(leads){
  const redraw = () => renderB2BTypeSection(b2bScopedLeads());
  const employees = b2bFilter('#b2b-type-employee-filter-wrap', 'b2bTypeEmployeeFilter',
    b2bEmployeeGroups(leads).map(g => g.label), 'All', { redraw });
  const shown = b2bFilterLeads(leads, { employees });
  const rows = b2bByType(shown);
  renderB2BTally('#tbl-b2b-type', 'Lead Type', rows, shown, 'By Lead Type - clients');
  renderB2BTypeNote(rows);
}

/**
 * By Employee, narrowed to the lead types picked in its Lead Type filter and then to its Company filter (both
 * All by default). The Company list offers only the companies of the chosen types, and resets when they change.
 */
function renderB2BEmployeeSection(leads){
  const redraw = () => renderB2BEmployeeSection(b2bScopedLeads());
  b2bFilter('#b2b-employee-type-filter-wrap', 'b2bEmployeeTypeFilter', b2bTypeOptions(leads), 'All',
    { redraw, onChange: () => { STATE.b2bEmployeeCompanyFilter = 'All'; } });
  const ofTypes = b2bFilterLeads(leads, { types: b2bTypeCodesFor(STATE.b2bEmployeeTypeFilter, leads) });
  const companies = b2bFilter('#b2b-employee-company-filter-wrap', 'b2bEmployeeCompanyFilter',
    b2bCompanyOptions(ofTypes), 'All', { redraw, search: true });
  const shown = b2bFilterLeads(ofTypes, { companies });
  renderB2BTally('#tbl-b2b-employee', 'Employee', b2bByEmployee(shown), shown, 'By Employee - clients');
}

/**
 * By Company, for one employee until the Employee filter says otherwise. The Company list offers only the
 * companies of the chosen employees, and is reset whenever the employees change.
 */
function renderB2BCompanySection(leads){
  const redraw = () => renderB2BCompanySection(b2bScopedLeads());
  const employeeOptions = b2bEmployeeGroups(leads).map(g => g.label);
  const employees = b2bFilter('#b2b-company-employee-filter-wrap', 'b2bCompanyEmployeeFilter',
    employeeOptions, employeeOptions.slice(0, 1), { redraw, onChange: () => { STATE.b2bCompanyNameFilter = 'All'; } });
  const ofEmployees = b2bFilterLeads(leads, { employees });
  const companies = b2bFilter('#b2b-company-company-filter-wrap', 'b2bCompanyNameFilter',
    b2bCompanyOptions(ofEmployees), 'All', { redraw, search: true });
  const shown = b2bFilterLeads(ofEmployees, { companies });
  renderB2BCompanyTable('#tbl-b2b-company', b2bByCompany(shown), shown, 'By Company - clients');
}

function renderB2BCorp(){
  if(!STATE.filesLoaded.fin23){
    B2B_VIEW_HOSTS.forEach(host => { $(host).innerHTML = ''; });
    setNotUploaded('#b2b-corp-kpis', 'fin23');
    return;
  }
  const leads = b2bScopedLeads();
  $('#b2b-corp-scope').textContent = `${fmtIN(leads.length)} ${CONFIG.B2B_CATEGORY} leads created in the selected months ${filterSummary()}`;
  renderB2BGuards();
  renderB2BKpiTiles('#b2b-corp-kpis', b2bOverviewCards(b2bTally(leads), leads));
  renderB2BTypeSection(leads);
  renderB2BEmployeeSection(leads);
  renderB2BCompanySection(leads);
}
