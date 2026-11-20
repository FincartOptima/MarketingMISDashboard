// app-b2b.js — B2B Corporate Leads, read from the B2C landing-page names.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).
// The model only: parsing, aggregation and guards. app-b2b-view.js draws it.
//
// WHY THIS EXISTS
// Corporate-category leads arrive through one landing page per company workshop, and the page name
// carries three facts the CRM has no column for:
//
//     Workshop<Company>-<Employee>_<Type>          WorkshopMaanAluminum-S_WR
//
//   Company   what sits between "Workshop" and the last "-"
//   Employee  the one letter between "-" and "_": the Fincart team member who owns the company
//   Type      what follows "_": FC = Google, WR = LinkedIn / HR referral / referral,
//             RR = RM referral, B5 = BSE 500 company   (CONFIG.B2B_LEAD_TYPES)
//
// The names are typed by hand and drift ("D FC", "-H-FC", a trailing "_", "Worshop"). The COMPANY and the
// EMPLOYEE are read from the page whatever its ending — "-H-FC" is plainly Himanshi's — but the TYPE has to be the
// literal ending _FC / _WR / _RR / _B5, the same test an Excel "contains _FC" filter makes, so the dashboard and a
// spreadsheet count the same Google leads. A page without that ending keeps its company and employee; only its
// lead type is "Unclassified", and it is listed for correction. A page with no readable company is Unclassified
// throughout. Every lead stays in every total. Harmless slips (a trailing "_", lower case, the "Worshop" typo)
// are read and reported as repairs. A figure is either right or flagged — never silently short.
//
// "Leads from Google (Corporate)" is the same literal test on its own: the Corporate leads, under the
// Dashboard's filters, whose landing page contains "_FC" (CONFIG.B2B_GOOGLE_MARKER).

const B2B_UNCLASSIFIED = 'Unclassified';
const B2B_NO_EMPLOYEE = '(no employee in landing page)';

// Built from CONFIG so a new lead type is one config line, not a parser change.
const b2bTypeAlternation = () => Object.keys(CONFIG.B2B_LEAD_TYPES).join('|');
const B2B_PREFIX = /^work?shop/i;            // also reads the "Worshop" typo seen in the data
const B2B_STRICT = new RegExp(`^Workshop(.+)-[A-Za-z]_(?:${b2bTypeAlternation()})$`);
const B2B_TYPE_TAIL = new RegExp(`^(.*?)_(${b2bTypeAlternation()})$`, 'i');          // the type must follow an underscore
const B2B_LOOSE_TAIL = new RegExp(`^(.*?)[\\s_-]+(${b2bTypeAlternation()})$`, 'i');   // a type word after any separator: company and employee only
const B2B_EMPLOYEE_TAIL = /^(.*)-([A-Za-z])$/;
const B2B_TRAILING_SEPARATORS = /[\s_-]+$/;

// ---- landing-page parser ----

/**
 * Why a readable name still departs from the exact form, so the person fixing it knows what to change.
 * Empty when the name is exact, or when it has no employee (reported on its own, not as a repair).
 * @returns {string[]}
 */
function b2bRepairs(raw, parsed){
  if(!parsed.employeeCode || B2B_STRICT.test(raw)) return [];
  const body = raw.replace(B2B_TRAILING_SEPARATORS, '');
  const written = (body.match(B2B_TYPE_TAIL) || [])[2] || '';
  const checks = [
    [!/^Workshop/.test(raw), 'the prefix is not exactly "Workshop"'],
    [body !== raw, 'it ends with a stray "_", "-" or space'],
    [written !== written.toUpperCase(), 'the lead type is in lower case'],
  ];
  const fixes = checks.filter(([bad]) => bad).map(([, why]) => why);
  return fixes.length ? fixes : ['it is not in the exact Workshop<Company>-<Employee>_<Type> form'];
}

const b2bNoTypeReason = () => `it does not end in ${b2bTypeAlternation().split('|').map(code => '_' + code).join(', ')}`;

/**
 * Read a Corporate landing-page name.
 * @param {string} landingPage
 * @returns {{ok:true, company:string, employeeCode:string, typeCode:string, repairs:string[]}
 *          |{ok:false, reason:string}}
 *   employeeCode is '' when the name has no "-<Employee>" part. typeCode is '' when the page has a type word
 *   but not the literal _FC / _WR / _RR / _B5 ending (a space or hyphen where the underscore belongs): its
 *   company and employee are still read. ok:false means no company could be read at all.
 */
function parseWorkshopLandingPage(landingPage){
  const raw = String(landingPage == null ? '' : landingPage).trim();
  if(!raw) return { ok: false, reason: 'the landing page is blank' };
  if(!B2B_PREFIX.test(raw)) return { ok: false, reason: 'it does not start with "Workshop"' };
  const body = raw.replace(B2B_PREFIX, '').replace(B2B_TRAILING_SEPARATORS, '');
  const literal = body.match(B2B_TYPE_TAIL);
  const typed = literal || body.match(B2B_LOOSE_TAIL);
  if(!typed) return { ok: false, reason: b2bNoTypeReason() };
  const employee = typed[1].match(B2B_EMPLOYEE_TAIL);
  const company = (employee ? employee[1] : typed[1]).trim();
  if(!company) return { ok: false, reason: 'it has no company name' };
  const parsed = { ok: true, company, employeeCode: employee ? employee[2].toUpperCase() : '', typeCode: literal ? typed[2].toUpperCase() : '' };
  return { ...parsed, repairs: literal ? b2bRepairs(raw, parsed) : [] };
}

/** One B2C row with its landing page read. Unreadable names keep `ok:false` and an empty company/employee/type. */
function b2bClassify(row){
  const parsed = parseWorkshopLandingPage(row.landingPage);
  return parsed.ok
    ? { row, ...parsed }
    : { row, ok: false, reason: parsed.reason, company: '', employeeCode: '', typeCode: '', repairs: [] };
}

const b2bCompanyKey = company => company.toLowerCase().replace(/\s+/g, '');

// Converted means a converted date. A date the loader had to infer for a lead merely written CONVERTED does
// not count, and such a lead is kept out of every status column and reported (b2bUndatedConvertedReport).
const B2B_UNDATED_CONVERTED = 'CONVERTED (no date)';
const b2bHasConvertedDate = row => Boolean(row.convertedDate) && !row._cvInferred;

function b2bStatusOf(row){
  if(b2bHasConvertedDate(row)) return 'CONVERTED';
  return row.leadStatus === 'CONVERTED' ? B2B_UNDATED_CONVERTED : row.leadStatus;
}

// ---- labels ----

const b2bTypeLabel = code => `${CONFIG.B2B_LEAD_TYPES[code] || 'Unknown type'} (${code})`;

function b2bEmployeeLabel(code){
  if(!code) return B2B_NO_EMPLOYEE;
  const name = CONFIG.B2B_EMPLOYEE_CODES[code];
  return name ? `${name} (${code})` : `${code} (not mapped)`;
}

/** The spelling a company is written with most often, so "karix" and "Karix" show once. */
function b2bCompanyName(leads){
  const spellings = new Map();
  for(const l of leads) if(l.ok) spellings.set(l.company, (spellings.get(l.company) || 0) + 1);
  const best = [...spellings].sort((a, b) => b[1] - a[1])[0];
  if(best) return best[0];
  return leads[0].row.landingPage || '(blank landing page)';
}

// ---- tally ----

const b2bCompanyCount = leads => new Set(leads.filter(l => l.ok).map(l => b2bCompanyKey(l.company))).size;

/** Status counts, lead and company totals, Conv. Rate and QL Conv. Rate for any set of classified leads. */
function b2bTally(leads){
  const out = Object.fromEntries(STATUSES.map(s => [s, 0]));
  for(const l of leads){
    const status = b2bStatusOf(l.row);
    if(Object.prototype.hasOwnProperty.call(out, status)) out[status]++;
  }
  const n = leads.length;
  out.Leads = n;
  out.Companies = b2bCompanyCount(leads);
  out['Conv. Rate'] = n ? out.CONVERTED / n : 0;
  out['QL Conv. Rate'] = n ? (out.CONVERTED + out['IN PROCESS']) / n : 0;     // the Dashboard's QL Conversion Rate
  return out;
}

const b2bGrandTotal = (labelField, leads) => ({ [labelField]: 'Grand Total', _tot: true, ...b2bTally(leads) });

// ---- by lead type ----

/** Every configured type, then any other code seen in the data, so no lead can fall between columns. */
function b2bTypeCodes(leads){
  const configured = Object.keys(CONFIG.B2B_LEAD_TYPES);
  const extra = new Set(leads.filter(l => l.typeCode && !configured.includes(l.typeCode)).map(l => l.typeCode));
  return [...configured, ...[...extra].sort()];
}

function b2bByType(leads){
  const rows = b2bTypeCodes(leads).map(code =>
    ({ 'Lead Type': b2bTypeLabel(code), ...b2bTally(leads.filter(l => l.typeCode === code)) }));
  const untyped = leads.filter(l => !l.typeCode);
  if(untyped.length) rows.push({ 'Lead Type': B2B_UNCLASSIFIED, ...b2bTally(untyped) });
  rows.push(b2bGrandTotal('Lead Type', leads));
  return rows;
}

// ---- by employee ----

/** Configured employees always (so a quiet one still shows 0), then unmapped letters, then the leftovers. */
function b2bEmployeeGroups(leads){
  const readable = leads.filter(l => l.ok);
  const unmapped = [...new Set(readable.map(l => l.employeeCode))]
    .filter(code => code && !CONFIG.B2B_EMPLOYEE_CODES[code]).sort();
  const groups = [...Object.keys(CONFIG.B2B_EMPLOYEE_CODES), ...unmapped]
    .map(code => ({ label: b2bEmployeeLabel(code), subset: readable.filter(l => l.employeeCode === code) }));
  const noEmployee = readable.filter(l => !l.employeeCode);
  if(noEmployee.length) groups.push({ label: B2B_NO_EMPLOYEE, subset: noEmployee });
  const unreadable = leads.filter(l => !l.ok);
  if(unreadable.length) groups.push({ label: B2B_UNCLASSIFIED, subset: unreadable });
  return groups;
}

function b2bByEmployee(leads){
  const rows = b2bEmployeeGroups(leads).map(g => ({ Employee: g.label, ...b2bTally(g.subset) }));
  rows.push(b2bGrandTotal('Employee', leads));
  return rows;
}

// ---- by company ----

/** One row per employee + company + lead type. A company sold two ways (Karix: WR and FC) shows twice. */
function b2bByCompany(leads){
  const groups = new Map();
  for(const l of leads){
    const key = l.ok ? `${b2bCompanyKey(l.company)}|${l.employeeCode}|${l.typeCode}` : `?|${l.row.landingPage || ''}`;
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  const rows = [...groups.values()].map(subset => {
    const first = subset[0];
    return {
      Employee: first.ok ? b2bEmployeeLabel(first.employeeCode) : B2B_UNCLASSIFIED,
      Company: b2bCompanyName(subset),
      'Lead Type': first.typeCode ? b2bTypeLabel(first.typeCode) : B2B_UNCLASSIFIED,
      ...b2bTally(subset),
    };
  }).sort((a, b) => b.Leads - a.Leads || a.Company.localeCompare(b.Company));
  rows.push(b2bGrandTotal('Employee', leads));
  return rows;
}

// ---- filters ----
// By Employee filters by lead type; By Company by employee, then company. A selection is a list of the
// values picked, or null for "no restriction" — buildMultiSelect's 'All' / one string / array, normalised.

/** A buildMultiSelect value as a list; null when nothing is restricted. */
const b2bSelectionList = value => (value == null || value === 'All' ? null : [].concat(value));

/** What to keep in STATE for a buildMultiSelect value: 'All', or always a list. */
const b2bKeepSelection = value => (value === 'All' ? 'All' : [].concat(value));

const b2bLeadEmployeeLabel = l => (l.ok ? b2bEmployeeLabel(l.employeeCode) : B2B_UNCLASSIFIED);
const b2bLeadCompanyLabel = l => (l.ok ? l.company : (l.row.landingPage || '(blank landing page)'));

/** The lead-type filter's entries, worded like the By Lead Type rows ("Google (FC)"). */
const b2bTypeOptions = leads => b2bTypeCodes(leads).map(b2bTypeLabel);

/** The type codes a lead-type selection stands for; null when nothing is restricted. */
function b2bTypeCodesFor(selection, leads){
  const picked = b2bSelectionList(selection);
  return picked && b2bTypeCodes(leads).filter(code => picked.includes(b2bTypeLabel(code)));
}

/** Companies on offer in `leads`, one entry per company whatever its spelling, A to Z. */
function b2bCompanyOptions(leads){
  const byKey = new Map();
  for(const l of leads){
    const key = b2bCompanyKey(b2bLeadCompanyLabel(l));
    if(!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(l);
  }
  return [...byKey.values()].map(b2bCompanyName).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Leads that pass every given filter; a filter left null does not restrict. */
function b2bFilterLeads(leads, { types = null, employees = null, companies = null } = {}){
  const typeSet = types && new Set(types);
  const employeeSet = employees && new Set(employees);
  const companySet = companies && new Set(companies.map(b2bCompanyKey));
  return leads.filter(l =>
    (!typeSet || typeSet.has(l.typeCode))
    && (!employeeSet || employeeSet.has(b2bLeadEmployeeLabel(l)))
    && (!companySet || companySet.has(b2bCompanyKey(b2bLeadCompanyLabel(l)))));
}

/**
 * Keep the selected values that are still on offer. null means "not chosen yet" and gives the fallback; a
 * selection that has lost every value gives 'All' rather than an empty table.
 */
function b2bReconcileSelection(selection, options, fallback){
  if(selection === null) return fallback;
  if(selection === 'All') return 'All';
  const kept = [].concat(selection).filter(value => options.includes(value));
  return kept.length ? kept : 'All';
}

// ---- client-level download ----

const B2B_CLIENT_HEADERS = ['Employee', 'Company', 'Lead Type', 'Client Name', 'Client Email', 'Created Date', 'Created Month',
  'Status', 'Lead Head', 'Current RM', 'First RM', 'Converted Date', 'Landing Page'];

const b2bDay = value => String(value || '').slice(0, 10);

/**
 * The clients behind a table, one row each — what every table's Excel button carries. `Status` is the one
 * the tables count by (a lead with a Converted Month is Converted, whatever its written status says), so the
 * file adds up to the table cell for cell. Ordered by employee, company, then newest first.
 * @returns {{headers:string[], rows:Object[]}}
 */
function b2bClientRows(leads){
  const rows = leads.map(l => ({
    Employee: b2bLeadEmployeeLabel(l),
    Company: b2bLeadCompanyLabel(l),
    'Lead Type': l.typeCode ? b2bTypeLabel(l.typeCode) : B2B_UNCLASSIFIED,
    'Client Name': l.row.clientName || '',
    'Client Email': l.row.userId || '',
    'Created Date': b2bDay(l.row.createdDate),
    'Created Month': l.row.CTM || '',
    Status: b2bStatusOf(l.row),
    'Lead Head': l.row.leadHead || '',
    'Current RM': l.row.currentRmName || '',
    'First RM': l.row.firstRmName || '',
    'Converted Date': b2bDay(l.row.convertedDate),
    'Landing Page': l.row.landingPage || '',
  }));
  rows.sort((a, b) => a.Employee.localeCompare(b.Employee)
    || a.Company.localeCompare(b.Company, undefined, { sensitivity: 'base' })
    || b['Created Date'].localeCompare(a['Created Date']));
  return { headers: B2B_CLIENT_HEADERS, rows };
}

// ---- leads from Google ----

/** Landing page contains "_FC" — read off the text itself, so it holds even for a page the reader cannot parse. */
const b2bIsGoogleLead = l => String(l.row.landingPage || '').toLowerCase().includes(CONFIG.B2B_GOOGLE_MARKER.toLowerCase());
const b2bGoogleLeads = leads => leads.filter(b2bIsGoogleLead);

// ---- scope ----

/**
 * Every Corporate lead in the financial year, whatever the Month / Status / Lead Head filters — what the
 * data-quality guards look at. Older leads are left out: a landing page named before the convention existed
 * is not something anyone can act on, and warning about it would bury the names that are.
 */
function b2bAllLeads(){
  const financialYear = new Set(filteredMonths());
  return STATE.raw.filter(r => r['Campaign Name'] === CONFIG.B2B_CATEGORY && financialYear.has(r.CTM)).map(b2bClassify);
}

/** Corporate leads created in the selected months, under the Dashboard's Status / Lead Head / Ref+Cold filters. */
function b2bScopedLeads(){
  return applyRefColdFilter(STATE.raw)
    .filter(r => r['Campaign Name'] === CONFIG.B2B_CATEGORY && monthFilter(r.CTM))
    .map(b2bClassify);
}

// ---- guards ----
// Each returns {id, level, headline, detail, fix} or null. They read the whole financial year, not the
// filtered view, because a bad landing-page name is a property of the data, not of the month selected.

const B2B_SAMPLE = 6;
const b2bSample = (pairs, fmt) => {
  const shown = pairs.slice(0, B2B_SAMPLE).map(fmt).join('; ');
  return pairs.length > B2B_SAMPLE ? `${shown}; and ${pairs.length - B2B_SAMPLE} more` : shown;
};

/** [[landing page, lead count], ...] most affected first. */
function b2bTallyPages(leads){
  const counts = new Map();
  for(const l of leads){
    const page = l.row.landingPage || '(blank)';
    counts.set(page, (counts.get(page) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

function b2bUnreadableReport(all){
  const bad = all.filter(l => !l.ok);
  if(!bad.length) return null;
  const pages = b2bTallyPages(bad);
  const why = new Map(bad.map(l => [l.row.landingPage || '(blank)', l.reason]));
  return {
    id: 'b2b-unreadable', level: 'warn',
    headline: `${fmtIN(bad.length)} Corporate lead(s) have a landing page the B2B section cannot read`,
    detail: `Wherever they fall in the selected months they are counted under "${B2B_UNCLASSIFIED}", with no company, employee or lead type: `
      + b2bSample(pages, ([page, n]) => `"${page}" (${fmtIN(n)}; ${why.get(page)})`) + '.',
    fix: 'Rename the landing page in the CRM to Workshop<Company>-<Employee>_<Type>, e.g. WorkshopMaanAluminum-S_WR, with Type one of '
      + b2bTypeAlternation().replace(/\|/g, ', ') + '.',
  };
}

function b2bNoTypeReport(all){
  const leads = all.filter(l => l.ok && !l.typeCode);
  if(!leads.length) return null;
  return {
    id: 'b2b-type-missing', level: 'warn',
    headline: `${fmtIN(leads.length)} Corporate lead(s) sit on a landing page that does not end in a valid lead type`,
    detail: `They are counted under their employee and company, but their lead type is "${B2B_UNCLASSIFIED}": they are in no type row and `
      + 'not in the Leads Generated from Google card, even where the page says FC. '
      + b2bSample(b2bTallyPages(leads), ([page, n]) => `"${page}" (${fmtIN(n)})`) + '.',
    fix: 'Rename each landing page in the CRM so it ends _FC, _WR, _RR or _B5 — an underscore, then the code, with no space or hyphen — e.g. WorkshopMaanAluminum-S_WR.',
  };
}

function b2bRepairedReport(all){
  const repaired = all.filter(l => l.ok && l.repairs.length);
  if(!repaired.length) return null;
  const why = new Map(repaired.map(l => [l.row.landingPage, l.repairs.join(', ')]));
  return {
    id: 'b2b-repaired', level: 'warn',
    headline: `${fmtIN(repaired.length)} Corporate lead(s) sit on landing pages that were read despite a typo`,
    detail: 'They are counted correctly, but only because the reader tolerated the slip: '
      + b2bSample(b2bTallyPages(repaired), ([page, n]) => `"${page}" (${fmtIN(n)}; ${why.get(page)})`) + '.',
    fix: 'Correct each landing page name in the CRM to the exact Workshop<Company>-<Employee>_<Type> form so it keeps reading the same way.',
  };
}

function b2bUnmappedEmployeeReport(all){
  const leads = all.filter(l => l.ok && l.employeeCode && !CONFIG.B2B_EMPLOYEE_CODES[l.employeeCode]);
  if(!leads.length) return null;
  const byCode = new Map();
  for(const l of leads) byCode.set(l.employeeCode, (byCode.get(l.employeeCode) || 0) + 1);
  return {
    id: 'b2b-employee-unmapped', level: 'warn',
    headline: `${fmtIN(leads.length)} Corporate lead(s) belong to an employee code with no name`,
    detail: `${b2bSample([...byCode], ([code, n]) => `"${code}" (${fmtIN(n)} leads)`)} — shown as "<code> (not mapped)" in the Employee tables.`,
    fix: 'Add the letter and the person\'s name to CONFIG.B2B_EMPLOYEE_CODES in app-config.js.',
  };
}

function b2bNoEmployeeReport(all){
  const leads = all.filter(l => l.ok && !l.employeeCode);
  if(!leads.length) return null;
  return {
    id: 'b2b-employee-missing', level: 'warn',
    headline: `${fmtIN(leads.length)} Corporate lead(s) have no employee in the landing page`,
    detail: `Wherever they fall in the selected months they are counted under "${B2B_NO_EMPLOYEE}": ` + b2bSample(b2bTallyPages(leads), ([page, n]) => `"${page}" (${fmtIN(n)})`) + '.',
    fix: 'Add the owner letter between "-" and "_", e.g. WorkshopHurix-H_FC.',
  };
}

function b2bUndatedConvertedReport(all){
  const leads = all.filter(l => b2bStatusOf(l.row) === B2B_UNDATED_CONVERTED);
  if(!leads.length) return null;
  return {
    id: 'b2b-converted-undated', level: 'warn',
    headline: `${fmtIN(leads.length)} Corporate lead(s) are written CONVERTED but have no converted date`,
    detail: 'Converted here means a converted date, so these are not counted as Converted and sit in no status column. '
      + 'Their client rows still come out in the Excel downloads, with the status "' + B2B_UNDATED_CONVERTED + '".',
    fix: 'Set the converted date in the CRM, or correct the status if the lead has not converted.',
  };
}

/** The status columns must add up to Leads on the grand total of every table. A gap means a status the dashboard does not know. */
function b2bReconciliationReport(leads){
  const t = b2bTally(leads);
  const undated = leads.filter(l => b2bStatusOf(l.row) === B2B_UNDATED_CONVERTED).length;     // reported on their own
  const counted = STATUSES.reduce((sum, s) => sum + t[s], 0) + undated;
  if(counted === t.Leads) return null;
  return {
    id: 'b2b-recon', level: 'error',
    headline: 'B2B Corporate status columns do not add up to the lead total',
    detail: `${fmtIN(t.Leads)} lead(s) are in scope but the status columns hold ${fmtIN(counted)}; ${fmtIN(t.Leads - counted)} lead(s) have a status the dashboard does not recognise.`,
    fix: 'Add the missing status to CONFIG.STATUSES (app-config.js); the Data Health panel names it under "status the dashboard doesn\'t know".',
  };
}

/** All B2B guard reports, worst first. */
function b2bIssueReports(){
  const all = b2bAllLeads();
  return [
    b2bReconciliationReport(b2bScopedLeads()),
    b2bUnreadableReport(all),
    b2bNoTypeReport(all),
    b2bRepairedReport(all),
    b2bUnmappedEmployeeReport(all),
    b2bNoEmployeeReport(all),
    b2bUndatedConvertedReport(all),
  ].filter(Boolean);
}
