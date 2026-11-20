// Run with:  node --test tests/
// Covers the B2B Corporate Leads model (app-b2b.js): the landing-page reader, the aggregations and the guards.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./load-model');

const row = (landingPage, extra = {}) => ({
  landingPage, 'Campaign Name': 'Corporate', leadStatus: 'ASSIGNED', CM: 'N/A', CTM: 'Nov-2026', ...extra,
});

function model(rows = []){
  const state = { raw: rows };
  return loadScripts(['app-config.js', 'app-dateutils.js', 'app-b2b.js'], {
    STATE: state, monthFilter: () => true, applyRefColdFilter: r => r, filteredMonths: () => ['Nov-2026'],
  });
}

const RUN = model();
const read = landingPage => RUN(`parseWorkshopLandingPage(${JSON.stringify(landingPage)})`);
const fields = p => [p.company, p.employeeCode, p.typeCode];

// Evaluates `expression` with `leads` bound to the classified rows of the model's STATE.
const over = (run, expression) => run(`(() => { const leads = STATE.raw.map(b2bClassify); return ${expression}; })()`);

// ---- the reader -------------------------------------------------------------------------------

test('reads the exact form', () => {
  const p = read('WorkshopMaanAluminum-S_WR');
  assert.deepEqual([p.ok, ...fields(p), p.repairs.length], [true, 'MaanAluminum', 'S', 'WR', 0]);
});

test('reads every lead type', () => {
  for(const type of ['WR', 'FC', 'RR', 'B5']) assert.equal(read(`WorkshopAcme-D_${type}`).typeCode, type);
});

// Real landing pages from the live data that are slightly off but still carry the literal ending.
const READABLE_SLIPS = [
  ['WorkshopCapitalBusinessSystems-D_FC_', ['CapitalBusinessSystems', 'D', 'FC']],
  ['WorshopC2FO-H_WR',                     ['C2FO', 'H', 'WR']],
  ['WORKSHOPATTENDEES2_WR',                ['ATTENDEES2', '', 'WR']],
];
for(const [page, expected] of READABLE_SLIPS){
  test(`reads the slip ${page}`, () => assert.deepEqual(fields(read(page)), expected));
}

// Real pages whose ending is not the literal _FC / _WR / _RR / _B5. An Excel "contains _FC" filter would skip
// them for the TYPE, so the dashboard does too — but the company and the employee are plain, and are still read.
const MISTYPED_ENDINGS = [
  ['WorkshopEphicacy-D_ FC',  ['Ephicacy', 'D']],
  ['WorkshopUpgrad-D FC',     ['Upgrad', 'D']],
  ['WorkshopDepusa-H-FC',     ['Depusa', 'H']],
  ['WorkshopMarlabsS2-D_ FC', ['MarlabsS2', 'D']],
];
for(const [page, [company, employee]] of MISTYPED_ENDINGS){
  test(`${page}: company and employee are read, the type is left Unclassified`, () => {
    const parsed = read(page);
    assert.deepEqual([parsed.ok, parsed.company, parsed.employeeCode, parsed.typeCode], [true, company, employee, '']);
    assert.equal(parsed.repairs.length, 0);
  });
}

test('a name that needed repair says why', () => {
  assert.ok(read('WorkshopCapitalBusinessSystems-D_FC_').repairs.some(r => r.includes('stray')));
  assert.ok(read('WorshopC2FO-H_WR').repairs.some(r => r.includes('prefix')));
  assert.ok(read('Workshopacme-H_fc').repairs.some(r => r.includes('lower case')));
});

test('an exact name needs no repair', () => assert.equal(read('WorkshopRohitjain&Co-H_RR').repairs.length, 0));

test('a name with no employee is readable but is not called a repair', () => {
  const p = read('WorkshopHurix_FC');
  assert.deepEqual([p.ok, ...fields(p), p.repairs.length], [true, 'Hurix', '', 'FC', 0]);
});

test('keeps spaces inside the company', () => assert.equal(read('WorkshopDiasysDiagnostics India_WR').company, 'DiasysDiagnostics India'));

test('a lower-case employee letter is read as upper case', () => assert.equal(read('WorkshopAcme-h_WR').employeeCode, 'H'));

test('refuses what it cannot read, and says why', () => {
  const cases = {
    'BTL_DLFCyberCityBuild14_Cvent': 'does not start with',
    'WorkshopAcme-H_XX':             'does not end in',          // no type word at all
    'Workshop-H_WR':                 'no company',
    '':                              'blank',
    '   ':                           'blank',
  };
  for(const [page, why] of Object.entries(cases)){
    const p = read(page);
    assert.equal(p.ok, false, page);
    assert.ok(p.reason.includes(why), `${page}: ${p.reason}`);
  }
});

test('null and undefined landing pages are unreadable, not a crash', () => {
  assert.equal(RUN('parseWorkshopLandingPage(null)').ok, false);
  assert.equal(RUN('parseWorkshopLandingPage(undefined)').ok, false);
});

// ---- aggregation ------------------------------------------------------------------------------

const SAMPLE = [
  row('WorkshopAlpha-D_FC', { leadStatus: 'ON HOLD' }),
  row('WorkshopAlpha-D_FC', { leadStatus: 'DEAD' }),
  row('WorkshopAlpha-D_FC', { leadStatus: 'IN PROCESS' }),
  row('WorkshopAlpha-D_FC', { leadStatus: 'FOLLOW UP', convertedDate: '2026-11-12' }),   // converted: it has a date, whatever the status says
  row('WorkshopBeta-H_WR', { leadStatus: 'ASSIGNED' }),
  row('WorkshopBeta-H_FC', { leadStatus: 'ASSIGNED' }),                      // same company, second way of sourcing it
  row('WorkshopGamma-R_RR', { leadStatus: 'DEAD' }),                         // R has no name yet
  row('WorkshopDelta_B5', { leadStatus: 'ON HOLD' }),                        // no employee
  row('Something-else', { leadStatus: 'ASSIGNED' }),                         // unreadable
];

test('a status column per status, and a converted date wins over the written status', () => {
  const t = over(model(SAMPLE), 'b2bTally(leads.filter(l => l.ok && l.company === "Alpha"))');
  assert.equal(t.Leads, 4);
  assert.equal(t.CONVERTED, 1);
  assert.equal(t['FOLLOW UP'], 0);
  assert.equal(t['ON HOLD'] + t.DEAD + t['IN PROCESS'] + t.CONVERTED, 4);
  assert.equal(t['Conv. Rate'], 0.25);
  assert.equal(t['QL Conv. Rate'], 0.5);                       // (1 converted + 1 in process) of 4
});

test('every table reconciles to the lead total', () => {
  const run = model(SAMPLE);
  const grand = rows => rows.find(r => r._tot).Leads;
  const parts = rows => rows.filter(r => !r._tot).reduce((s, r) => s + r.Leads, 0);
  for(const table of ['b2bByType', 'b2bByEmployee', 'b2bByCompany']){
    const rows = over(run, `${table}(leads)`);
    assert.equal(grand(rows), SAMPLE.length, `${table} grand total`);
    assert.equal(parts(rows), SAMPLE.length, `${table} rows`);
  }
});

test('configured employees always show; unmapped and missing ones are named; nothing is dropped', () => {
  const labels = over(model(SAMPLE), 'b2bByEmployee(leads)').map(r => r.Employee);
  for(const expected of ['Devanshi (D)', 'Himanshi (H)', 'Shreya (S)', 'R (not mapped)', '(no employee in landing page)', 'Unclassified']){
    assert.ok(labels.includes(expected), expected);
  }
});

test('a company sold two ways is two company rows but one company in the headline count', () => {
  const rows = over(model(SAMPLE), 'b2bByCompany(leads)');
  assert.equal(rows.filter(r => r.Company === 'Beta').length, 2);
  assert.equal(rows.find(r => r._tot).Companies, 4);                         // Alpha, Beta, Gamma, Delta
});

test('company spellings that differ by case are one company', () => {
  const rows = over(model([row('Workshopkarix-H_WR'), row('WorkshopKarix-H_WR'), row('WorkshopKarix-H_WR')]), 'b2bByCompany(leads)').filter(r => !r._tot);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].Company, rows[0].Leads], ['Karix', 3]);
});

// ---- client-level download ---------------------------------------------------------------------

const CLIENTS = [
  row('WorkshopAlpha-D_FC', { clientName: 'Zed One', userId: 'zed@x.com', createdDate: '2026-11-03', leadStatus: 'ON HOLD', leadHead: 'Primary', currentRmName: 'Rm A', firstRmName: 'Rm B' }),
  row('WorkshopAlpha-D_FC', { clientName: 'Amy Two', userId: 'amy@x.com', createdDate: '2026-11-09', leadStatus: 'FOLLOW UP', CM: 'Nov-2026', convertedDate: '2026-11-12' }),
  row('WorkshopBeta-H_WR', { clientName: 'Bob', userId: 'bob@x.com', createdDate: '2026-11-05' }),
  row('Something-else', { clientName: 'Odd', userId: 'odd@x.com', createdDate: '2026-11-01' }),
];

test('the client download has one row per client, with every column filled from the lead', () => {
  const { headers, rows } = over(model(CLIENTS), 'b2bClientRows(leads)');
  assert.equal(rows.length, CLIENTS.length);
  assert.equal(headers.length, 13);
  const zed = rows.find(r => r['Client Email'] === 'zed@x.com');
  assert.deepEqual(
    [zed.Employee, zed.Company, zed['Lead Type'], zed['Client Name'], zed['Created Date'], zed['Current RM'], zed['First RM'], zed['Landing Page']],
    ['Devanshi (D)', 'Alpha', 'Google (FC)', 'Zed One', '2026-11-03', 'Rm A', 'Rm B', 'WorkshopAlpha-D_FC']);
  for(const r of rows) for(const h of headers) assert.ok(h in r, h);
});

test('the client download uses the status the tables count by, so the converted date shows', () => {
  const rows = over(model(CLIENTS), 'b2bClientRows(leads)').rows;
  assert.equal(rows.find(r => r['Client Email'] === 'amy@x.com').Status, 'CONVERTED');   // written FOLLOW UP, but it has a converted date
  assert.equal(rows.find(r => r['Client Email'] === 'amy@x.com')['Converted Date'], '2026-11-12');
});

test('a table and its client download agree status for status', () => {
  const run = model(SAMPLE);
  const tally = over(run, 'b2bTally(leads)');
  const rows = over(run, 'b2bClientRows(leads)').rows;
  assert.equal(rows.length, tally.Leads);
  for(const status of ['CONVERTED', 'IN PROCESS', 'ASSIGNED', 'RE-ASSIGNED', 'FOLLOW UP', 'ON HOLD', 'DEAD']){
    assert.equal(rows.filter(r => r.Status === status).length, tally[status], status);
  }
});

test('the client download follows the table filters', () => {
  const run = model(SAMPLE);
  const forDevanshi = over(run, 'b2bClientRows(b2bFilterLeads(leads, { employees: ["Devanshi (D)"] })).rows');
  const tally = over(run, 'b2bTally(b2bFilterLeads(leads, { employees: ["Devanshi (D)"] }))');
  assert.equal(forDevanshi.length, tally.Leads);
  assert.ok(forDevanshi.every(r => r.Employee === 'Devanshi (D)'));
});

test('unreadable landing pages still come out as clients, labelled Unclassified', () => {
  const rows = over(model(CLIENTS), 'b2bClientRows(leads)').rows;
  const odd = rows.find(r => r['Client Email'] === 'odd@x.com');
  assert.deepEqual([odd.Employee, odd['Lead Type'], odd.Company], ['Unclassified', 'Unclassified', 'Something-else']);
});

test('the client download is ordered by employee, then company, newest first', () => {
  const rows = over(model(CLIENTS), 'b2bClientRows(leads)').rows;
  const alpha = rows.filter(r => r.Company === 'Alpha').map(r => r['Created Date']);
  assert.deepEqual(Array.from(alpha), ['2026-11-09', '2026-11-03']);
  assert.deepEqual(Array.from(rows, r => r.Employee), ['Devanshi (D)', 'Devanshi (D)', 'Himanshi (H)', 'Unclassified']);
});

// ---- filters ----------------------------------------------------------------------------------

test('the company table leads with Employee, then Company', () => {
  const row0 = over(model(SAMPLE), 'b2bByCompany(leads)')[0];
  assert.deepEqual(Object.keys(row0).slice(0, 3), ['Employee', 'Company', 'Lead Type']);
  const total = over(model(SAMPLE), 'b2bByCompany(leads)').find(r => r._tot);
  assert.equal(total.Employee, 'Grand Total');
});

test('a lead-type filter narrows By Employee to that type and nothing else', () => {
  const run = model(SAMPLE);
  const fc = over(run, 'b2bByEmployee(b2bFilterLeads(leads, { types: ["FC"] }))');
  assert.equal(fc.find(r => r._tot).Leads, 5);                                   // the five FC leads
  assert.equal(fc.find(r => r.Employee === 'Himanshi (H)').Leads, 1);             // Beta's FC page only
  assert.equal(fc.find(r => r.Employee === 'Shreya (S)').Leads, 0);               // configured, so still listed
  assert.equal(fc.some(r => r.Employee === 'Unclassified'), false);               // unreadable names have no type
});

test('with no type filter every lead is counted, unreadable ones included', () => {
  const all = over(model(SAMPLE), 'b2bByEmployee(b2bFilterLeads(leads, { types: null }))');
  assert.equal(all.find(r => r._tot).Leads, SAMPLE.length);
});

test('the type filter lists every type and maps its entries back to codes', () => {
  const run = model(SAMPLE);
  assert.deepEqual(Array.from(over(run, 'b2bTypeOptions(leads)')), ['Google (FC)', 'LinkedIn / HR Referral / Referral (WR)', 'RM Referral (RR)', 'BSE 500 company (B5)']);
  assert.deepEqual(Array.from(over(run, 'b2bTypeCodesFor(["Google (FC)", "RM Referral (RR)"], leads)')), ['FC', 'RR']);
  assert.equal(over(run, 'b2bTypeCodesFor("All", leads)'), null);
});

test('the company list offers only the companies of the chosen employees, once each, A to Z', () => {
  const rows = [row('WorkshopZeta-D_FC'), row('Workshopalpha-D_FC'), row('WorkshopAlpha-D_WR'), row('WorkshopMid-H_FC')];
  const run = model(rows);
  const options = over(run, 'b2bCompanyOptions(b2bFilterLeads(leads, { employees: ["Devanshi (D)"] }))');
  assert.deepEqual(Array.from(options, o => o.toLowerCase()), ['alpha', 'zeta']);   // Alpha counted once despite two spellings, A to Z
  assert.equal(over(run, 'b2bCompanyOptions(leads)').length, 3);                      // with no employee restriction Mid is on offer too
});

test('employee and company filters combine, and company names match whatever their capitalisation', () => {
  const rows = [row('WorkshopKarix-H_WR'), row('Workshopkarix-H_FC'), row('WorkshopOther-H_WR'), row('WorkshopKarix-D_WR')];
  const run = model(rows);
  const shown = over(run, 'b2bFilterLeads(leads, { employees: ["Himanshi (H)"], companies: ["KARIX"] })');
  assert.equal(shown.length, 2);
  assert.equal(over(run, 'b2bByCompany(b2bFilterLeads(leads, { employees: ["Himanshi (H)"], companies: ["Karix"] }))').find(r => r._tot).Leads, 2);
});

test('a filter left null restricts nothing', () => {
  assert.equal(over(model(SAMPLE), 'b2bFilterLeads(leads, {}).length'), SAMPLE.length);
});

test('selections: All and one-or-many values are read the same way', () => {
  const run = model();
  assert.equal(run('b2bSelectionList("All")'), null);
  assert.equal(run('b2bSelectionList(null)'), null);
  assert.deepEqual(Array.from(run('b2bSelectionList("Devanshi (D)")')), ['Devanshi (D)']);
  assert.deepEqual(Array.from(run('b2bSelectionList(["a", "b"])')), ['a', 'b']);
  assert.equal(run('b2bKeepSelection("All")'), 'All');
  assert.deepEqual(Array.from(run('b2bKeepSelection("x")')), ['x']);
});

test('the first render picks one employee; later renders keep what is still on offer', () => {
  const run = model();
  const options = ['Devanshi (D)', 'Himanshi (H)', 'Shreya (S)'];
  const reconcile = (selection, fallback) => run(`b2bReconcileSelection(${JSON.stringify(selection)}, ${JSON.stringify(options)}, ${JSON.stringify(fallback)})`);
  assert.deepEqual(Array.from(reconcile(null, options.slice(0, 1))), ['Devanshi (D)']);          // not chosen yet -> the default
  assert.equal(reconcile('All', options.slice(0, 1)), 'All');                                       // the user chose All
  assert.deepEqual(Array.from(reconcile(['Himanshi (H)', 'Gone (G)'], [])), ['Himanshi (H)']);      // a value that left the list is dropped
  assert.equal(reconcile(['Gone (G)'], []), 'All');                                                 // nothing left -> All, never an empty table
});

// ---- leads from Google --------------------------------------------------------------------------

test('the Google card counts landing pages containing _FC in any case, and nothing else', () => {
  const rows = [row('WorkshopA-D_FC'), row('WorkshopB-H_fc'), row('WorkshopC-D_FC_'), row('WorkshopD-D_ FC'), row('WorkshopE-H_WR'), row('BTL_Thing_FC')];
  assert.equal(over(model(rows), 'b2bGoogleLeads(leads).length'), 4);   // A, B, C and the BTL page; not D (a space) or E
});

test('the Google card agrees with the FC row of By Lead Type', () => {
  const run = model(SAMPLE);
  const fc = over(run, 'b2bByType(leads)').find(r => r['Lead Type'] === 'Google (FC)').Leads;
  assert.equal(over(run, 'b2bGoogleLeads(leads).length'), fc);
});

test('a mistyped ending is Unclassified in the table and absent from the Google card', () => {
  const run = model([row('WorkshopA-D_FC'), row('WorkshopB-D_ FC')]);
  assert.equal(over(run, 'b2bGoogleLeads(leads).length'), 1);
  const byType = over(run, 'b2bByType(leads)');
  assert.equal(byType.find(r => r['Lead Type'] === 'Google (FC)').Leads, 1);
  assert.equal(byType.find(r => r['Lead Type'] === 'Unclassified').Leads, 1);
});

test('a page with a mistyped ending still counts for its employee and company, so no employee loses leads', () => {
  // Himanshi owns Depusa; its page reads "-H-FC". It must be in her row even though its type is Unclassified.
  const rows = [row('WorkshopDepusa-H-FC'), row('WorkshopDepusa-H-FC'), row('WorkshopAcme-H_FC'), row('WorkshopUpgrad-D FC')];
  const run = model(rows);
  const byEmployee = over(run, 'b2bByEmployee(leads)');
  assert.equal(byEmployee.find(r => r.Employee === 'Himanshi (H)').Leads, 3);       // Acme + both Depusa
  assert.equal(byEmployee.find(r => r.Employee === 'Devanshi (D)').Leads, 1);       // Upgrad
  assert.equal(byEmployee.some(r => r.Employee === 'Unclassified'), false);         // nothing is wholly unreadable
  assert.equal(byEmployee.find(r => r._tot).Leads, 4);
  const byType = over(run, 'b2bByType(leads)');
  assert.equal(byType.find(r => r['Lead Type'] === 'Google (FC)').Leads, 1);        // only the literal _FC
  assert.equal(byType.find(r => r['Lead Type'] === 'Unclassified').Leads, 3);
  const companies = over(run, 'b2bByCompany(leads)');
  assert.equal(companies.find(r => r.Company === 'Depusa')['Lead Type'], 'Unclassified');
  assert.equal(over(run, 'b2bClientRows(leads).rows').filter(r => r['Lead Type'] === 'Unclassified' && r.Employee === 'Himanshi (H)').length, 2);
});

test('the lead-type filter never offers an empty type code', () => {
  const options = over(model([row('WorkshopDepusa-H-FC')]), 'b2bTypeOptions(leads)');
  assert.equal(options.length, 4);
  assert.ok(Array.from(options).every(o => !o.startsWith('Unknown type')));
});

test('the data notes say which pages lack a valid type ending, separately from pages that cannot be read at all', () => {
  const reports = model([row('WorkshopDepusa-H-FC'), row('Something-else')])('b2bIssueReports()');
  const typeMissing = reports.find(r => r.id === 'b2b-type-missing');
  assert.ok(typeMissing);
  assert.match(typeMissing.detail, /WorkshopDepusa-H-FC/);
  assert.match(typeMissing.detail, /not in the Leads Generated from Google card/);
  assert.match(reports.find(r => r.id === 'b2b-unreadable').detail, /Something-else/);
  assert.doesNotMatch(reports.find(r => r.id === 'b2b-unreadable').detail, /Depusa/);
});

// ---- converted means a converted date ------------------------------------------------------------

const DATED = [
  row('WorkshopA-D_FC', { leadStatus: 'RE-ASSIGNED', convertedDate: '2026-11-12' }),                      // written otherwise, has a date
  row('WorkshopA-D_FC', { leadStatus: 'CONVERTED' }),                                                      // written CONVERTED, no date
  row('WorkshopA-D_FC', { leadStatus: 'CONVERTED', convertedDate: '2026-11-13', _cvInferred: true }),     // a date the loader made up
  row('WorkshopA-D_FC', { leadStatus: 'ASSIGNED' }),
];

test('converted is a converted date only: the written status does not count, and an inferred date does not either', () => {
  const run = model(DATED);
  const tally = over(run, 'b2bTally(leads)');
  assert.deepEqual([tally.CONVERTED, tally['RE-ASSIGNED'], tally.ASSIGNED, tally.Leads], [1, 0, 1, 4]);
  const statuses = Array.from(over(run, 'b2bClientRows(leads).rows'), r => r.Status).sort();
  assert.deepEqual(statuses, ['ASSIGNED', 'CONVERTED', 'CONVERTED (no date)', 'CONVERTED (no date)']);
});

test('leads written CONVERTED with no date are reported, and not mistaken for an unknown status', () => {
  const ids = Array.from(model(DATED)('b2bIssueReports()'), r => r.id);
  assert.ok(ids.includes('b2b-converted-undated'));
  assert.equal(ids.includes('b2b-recon'), false);
});

test('QL Conv. Rate is (converted + in process) over leads, and Conv. Rate is converted over leads', () => {
  const rows = [row('WorkshopA-D_FC', { convertedDate: '2026-11-01' }), row('WorkshopA-D_FC', { leadStatus: 'IN PROCESS' }),
                row('WorkshopA-D_FC'), row('WorkshopA-D_FC')];
  const t = over(model(rows), 'b2bTally(leads)');
  assert.deepEqual([t['Conv. Rate'], t['QL Conv. Rate']], [0.25, 0.5]);
});

// ---- guards -----------------------------------------------------------------------------------

test('guards name each problem and how to fix it', () => {
  const reports = model(SAMPLE)('b2bIssueReports()');
  const ids = reports.map(r => r.id);
  for(const id of ['b2b-unreadable', 'b2b-employee-unmapped', 'b2b-employee-missing']) assert.ok(ids.includes(id), id);
  for(const r of reports){
    assert.ok(r.headline && r.detail && r.fix, r.id);
    assert.ok(['warn', 'error'].includes(r.level));
  }
  assert.match(reports.find(r => r.id === 'b2b-unreadable').detail, /Something-else/);
  assert.match(reports.find(r => r.id === 'b2b-employee-unmapped').detail, /"R"/);
});

test('guards stay silent on clean data', () => {
  const clean = [row('WorkshopAcme-D_FC'), row('WorkshopBeta-H_WR')];
  assert.equal(model(clean)('b2bIssueReports()').length, 0);
});

test('guards ignore leads from before the financial year', () => {
  const old = [row('Something-else', { CTM: 'Dec-2025' }), row('WorkshopAcme-R_FC', { CTM: 'Dec-2025' })];
  assert.equal(model(old)('b2bIssueReports()').length, 0);
});

test('an unknown status is caught by the reconciliation guard', () => {
  const ids = model([row('WorkshopAcme-D_FC', { leadStatus: 'MYSTERY' })])('b2bIssueReports()').map(r => r.id);
  assert.ok(ids.includes('b2b-recon'));
});
