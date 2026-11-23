// Run with:  node --test tests/
// Covers the L&D Dashboard's data model: the lead-record rules (app-ld-lead.js) and LD.build() (app-ld.js),
// which joins the L&D workbook's rows to lead records and counts them. The tab's own sign-in lives in
// render(), not build(), so nothing here touches it.
const test = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const { loadScripts } = require('./load-model');

const sha16 = key => nodeCrypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
const TEAMS = { Asha: 'Team A', Bhanu: 'Team B', 'Ravi Sharma': 'Team R' };
const RM_ALIASES = { 'R. Sharma': 'Ravi Sharma' };

/** A context with the four scripts loaded, the given B2C rows, L&D rows and (optional) snapshot. */
function world({ raw = [], ldRows = [], snapshot = null } = {}){
  const run = loadScripts(['app-config.js', 'app-dateutils.js', 'app-ld-lead.js', 'app-ld.js'], {
    STATE: { raw, ldRows }, window: { LD_LEAD_SNAPSHOT: snapshot }, crypto: nodeCrypto.webcrypto, TextEncoder,
    teamForRmName: name => TEAMS[name] || '', mapRM: name => RM_ALIASES[name] || name,
  });
  const build = async () => JSON.parse(JSON.stringify(await run('LD.build()')));
  return { run, build };
}

const lead = (email, extra = {}) => ({
  userId: email, leadStatus: 'IN PROCESS', CM: 'N/A', convertedDate: '', createdDate: '2026-05-04', currentRmName: 'Asha', firstRmName: 'Bhanu',
  Team: 'Team A', leadHead: 'Primary', clientCategory: 'Alpha', platformName: 'Google', landingPage: 'LP-1', ...extra,
});
const plan = (email, extra = {}) => ({
  _sheet: 'Plan Approval Sheet Q1', _row: 2, 'Email Id': email, 'Client Name': 'Client', Month: 'May', Date: '2026-05-10',
  'Approved By': 'meena', 'Client Type': 'New', 'Unlisted Allocation': 100000, ...extra,
});
const ticket = (email, extra = {}) => ({
  _sheet: 'FY 2026-2027 Q1', _row: 2, 'Client Mail ID': email, 'Client Name': 'Client', Month: 'June', 'Tkt Recd Date': '2026-06-02',
  'Ticket Subject': 'FP Creation', 'Assigned to': 'srinivas', 'Client Type': 'Alpha', ...extra,
});
const snapRow = (status, converted = '') => [status, '2025-12-01', converted, 'Asha', '', 'Google', 'LP-OLD', 'Bhanu'];
const snapshotOf = (rows, extra = {}) => ({ generated: '29 Oct 2026, 02:00 PM', leadFile: 'FIN_2026-08-07 15_11_42.xlsx', rows, ...extra });
const byEmail = (model, email) => model.clients.find(c => c.key === email);

// ---- the pure rules ------------------------------------------------------------------------------

const { run: rules } = world();

test('a converted date makes a lead CONVERTED, otherwise the written status stands', () => {
  assert.equal(rules(`ldStatusOf('RE-ASSIGNED', true)`), 'CONVERTED');
  assert.equal(rules(`ldStatusOf('IN PROCESS', false)`), 'IN PROCESS');
  assert.equal(rules(`ldStatusOf('', false)`), 'BLANK');
});

test('the snapshot date is its own asOf, else the date in the export file name, else empty', () => {
  assert.equal(rules(`ldSnapshotAsOf({ asOf: '2026-11-01', leadFile: 'FIN_2026-08-07.xlsx' })`), '2026-11-01');
  assert.equal(rules(`ldSnapshotAsOf({ leadFile: 'FIN23032021186_2026-08-07 15_11_42.xlsx' })`), '2026-08-07');
  assert.equal(rules(`ldSnapshotAsOf({ leadFile: 'latest.xlsx' })`), '');
  assert.equal(rules(`ldSnapshotAsOf(null)`), '');
});

test('formats an ISO date for people, and nothing else', () => {
  assert.equal(rules(`ldFriendlyDate('2026-08-07')`), '7 Aug 2026');
  assert.equal(rules(`ldFriendlyDate('')`), '');
  assert.equal(rules(`ldFriendlyDate('7 August')`), '');
});

test('one-edit comparison: a typo is one character, not two', () => {
  const apart = (a, b) => rules(`ldOneEditApart(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
  assert.equal(apart('amitkh268', 'mitkh268'), true);       // dropped
  assert.equal(apart('amitkh268', 'amitkh2688'), true);     // added
  assert.equal(apart('amitkh268', 'amitkh269'), true);      // replaced
  assert.equal(apart('amitkh268', 'amitkh286'), true);      // swapped
  assert.equal(apart('amitkh268', 'amitkh268'), false);     // identical is not "apart"
  assert.equal(apart('amitkh268', 'amitxx268'), false);     // two edits
  assert.equal(apart('amit', 'amitkh268'), false);
});

const hints = (unmatched, known) => JSON.parse(rules(
  `JSON.stringify([...ldSuggestEmails(${JSON.stringify(unmatched)}, ${JSON.stringify(known)})])`));

test('suggests the single known address a mistyped one probably meant', () => {
  const known = ['demoperson@gmail.com', 'sarah.jones@company.example'];
  assert.deepEqual(hints(['emoperson@gmail.com'], known), [['emoperson@gmail.com', 'demoperson@gmail.com']]);
  assert.deepEqual(hints(['arah.jones@company.example'], known), [['arah.jones@company.example', 'sarah.jones@company.example']]);
});

test('same name before the @ on another domain is offered', () => {
  assert.deepEqual(hints(['testuser293@gmal.com'], ['testuser293@gmail.com']),
    [['testuser293@gmal.com', 'testuser293@gmail.com']]);
});

test('gmail ignores dots, so a dotted and an undotted address are the same mailbox', () => {
  assert.deepEqual(hints(['jamesdoe1120@gmail.com'], ['ja.mes.doe1120@gmail.com']),
    [['jamesdoe1120@gmail.com', 'ja.mes.doe1120@gmail.com']]);        // two dots apart: only the gmail rule bridges that
  assert.deepEqual(hints(['jamesdoe1120@yahoo.com'], ['ja.mes.doe1120@yahoo.com']), []);   // other providers keep their dots
});

test('two addresses pasted into one cell are matched on the first', () => {
  assert.deepEqual(hints(['alpha.user@gmail.combeta.user@gmail.com'], ['alpha.user@gmail.com']),
    [['alpha.user@gmail.combeta.user@gmail.com', 'alpha.user@gmail.com']]);
});

test('a cell that is not an email is called that, never matched', () => {
  assert.deepEqual(hints(['notregistered'], ['notregistered1@gmail.com']), [['notregistered', 'Not an email address']]);
});

test('no hint when two addresses are equally likely, when the name is short, or when nothing is close', () => {
  assert.deepEqual(hints(['sam.example9@gmail.com'], ['sam.example8@gmail.com', 'sam.example7@gmail.com']), []);
  assert.deepEqual(hints(['ab1@gmail.com'], ['ab2@gmail.com']), []);
  assert.deepEqual(hints(['zzzzzzzz@gmail.com'], ['demoperson@gmail.com']), []);
});

// ---- the join ------------------------------------------------------------------------------------

test('status from the live B2C row follows the converted-date rule', async () => {
  const { build } = world({
    raw: [lead('a@x.com', { leadStatus: 'RE-ASSIGNED', CM: 'Jun-2026', convertedDate: '2026-06-09' }), lead('b@x.com', { leadStatus: 'RE-ASSIGNED' })],
    ldRows: [plan('a@x.com'), plan('b@x.com', { _row: 3 })],
  });
  const model = await build();
  assert.equal(byEmail(model, 'a@x.com').status, 'CONVERTED');
  assert.equal(byEmail(model, 'b@x.com').status, 'RE-ASSIGNED');
  assert.equal(model.meta.convertedByDate, 1);
});

test('status from the snapshot follows the same rule, and is labelled with the snapshot date', async () => {
  const snapshot = snapshotOf({ [sha16('old1@x.com')]: snapRow('RE-ASSIGNED', '2026-02-03'), [sha16('old2@x.com')]: snapRow('RE-ASSIGNED') });
  const { build } = world({ ldRows: [plan('old1@x.com'), plan('old2@x.com', { _row: 3 })], snapshot });
  const model = await build();
  assert.equal(byEmail(model, 'old1@x.com').status, 'CONVERTED');
  assert.equal(byEmail(model, 'old2@x.com').status, 'RE-ASSIGNED');
  assert.equal(byEmail(model, 'old1@x.com').leadSrc, 'Snapshot');
  assert.equal(model.meta.snapshotAsOf, '2026-08-07');
  assert.equal(model.meta.leadsFromSnapshot, 2);
});

test('the live B2C row beats the snapshot, and Primary beats Secondary on a repeat', async () => {
  const snapshot = snapshotOf({ [sha16('a@x.com')]: snapRow('DEAD') });
  const { build } = world({
    raw: [lead('a@x.com', { leadStatus: 'ASSIGNED' }), lead('b@x.com', { leadHead: 'Primary', leadStatus: 'IN PROCESS' }), lead('b@x.com', { leadHead: 'Secondary', leadStatus: 'DEAD' })],
    ldRows: [plan('a@x.com'), plan('b@x.com', { _row: 3 })], snapshot,
  });
  const model = await build();
  assert.equal(byEmail(model, 'a@x.com').status, 'ASSIGNED');
  assert.equal(byEmail(model, 'a@x.com').leadSrc, 'Daily B2C');
  assert.equal(byEmail(model, 'b@x.com').status, 'IN PROCESS');
});

test('case and stray spaces in an email do not stop it reaching its lead', async () => {
  const { build } = world({ raw: [lead('mixed@x.com')], ldRows: [plan(' Mixed@X.com ')] });
  const model = await build();
  assert.equal(model.clients.filter(c => c.matched).length, 1);
});

test('an email with no lead stays unmatched and gets a hint that is never joined', async () => {
  const { build } = world({ raw: [lead('demoperson@gmail.com')], ldRows: [plan('emoperson@gmail.com'), plan('notregistered', { _row: 3 })] });
  const model = await build();
  const typo = byEmail(model, 'emoperson@gmail.com');
  assert.equal(typo.matched, false);
  assert.equal(typo.status, 'NOT IN LEAD DATA');
  assert.equal(typo.suggest, 'demoperson@gmail.com');
  assert.equal(byEmail(model, 'notregistered').suggest, 'Not an email address');
  assert.equal(model.unmapped.length, 2);
});

test('team comes from the live row, or from the snapshot RM through the team map', async () => {
  const snapshot = snapshotOf({ [sha16('old@x.com')]: snapRow('IN PROCESS') });
  const { build } = world({ raw: [lead('a@x.com', { Team: 'Team B' })], ldRows: [plan('a@x.com'), plan('old@x.com', { _row: 3 })], snapshot });
  const model = await build();
  assert.equal(byEmail(model, 'a@x.com').team, 'Team B');
  assert.equal(byEmail(model, 'old@x.com').team, 'Team A');
});

// ---- the sheets ----------------------------------------------------------------------------------

test('April 2026 rows are left out entirely', async () => {
  const { build } = world({ raw: [lead('a@x.com')], ldRows: [plan('a@x.com', { Month: 'April', Date: '2026-04-20' }), plan('a@x.com', { _row: 3 })] });
  const model = await build();
  assert.equal(model.tickets.length, 1);
  assert.equal(byEmail(model, 'a@x.com').nPA, 1);
});

test('a client on two sheets is one client; months, subjects and people are kept per row', async () => {
  const { build } = world({ raw: [lead('a@x.com')], ldRows: [plan('a@x.com'), ticket('a@x.com')] });
  const model = await build();
  const client = byEmail(model, 'a@x.com');
  assert.equal(model.clients.length, 1);
  assert.equal(client.inPA, true);
  assert.deepEqual(client.subjects, ['FP Creation']);
  assert.deepEqual(client.months, ['2026-05', '2026-06']);
  assert.deepEqual(client.ldTouches.map(t => t.slice(1, 3).join(':')).sort(), ['Meena:approved', 'Srinivas:created']);
});

test('tier comes from the B2C category first, the L&D sheet second; "Other" is no grade', async () => {
  const { build } = world({
    raw: [lead('a@x.com', { clientCategory: 'Beta' }), lead('b@x.com', { clientCategory: 'Other' })],
    ldRows: [ticket('a@x.com', { 'Client Type': 'Gamma' }), ticket('b@x.com', { _row: 3, 'Client Type': 'Gamma' })],
  });
  const model = await build();
  assert.deepEqual([byEmail(model, 'a@x.com').tier, byEmail(model, 'a@x.com').tierSrc], ['Beta', 'B2C']);
  assert.deepEqual([byEmail(model, 'b@x.com').tier, byEmail(model, 'b@x.com').tierSrc], ['Gamma', 'L&D sheet']);
});

// ---- plan amounts --------------------------------------------------------------------------------

test('a plan row repeated with identical amounts is counted once and reported', async () => {
  const { build } = world({ raw: [lead('a@x.com')], ldRows: [plan('a@x.com', { _row: 2 }), plan('a@x.com', { _row: 9 }), plan('a@x.com', { _row: 12, 'Unlisted Allocation': 250000 })] });
  const model = await build();
  const total = byEmail(model, 'a@x.com').rev.unlisted;
  assert.equal(total, 350000);                       // 100000 once + 250000, not 450000
  assert.deepEqual(model.meta.repeatedPlans, [{ sheet: 'Plan Approval Sheet Q1', row: 9, ofSheet: 'Plan Approval Sheet Q1', ofRow: 2, amount: 100000 }]);
  assert.equal(byEmail(model, 'a@x.com').nPA, 3);    // the rows are still on the sheet
});

test('rows with no amounts are never "repeats", and the same amounts for two clients are not either', async () => {
  const { build } = world({
    raw: [lead('a@x.com'), lead('b@x.com')],
    ldRows: [plan('a@x.com', { 'Unlisted Allocation': 0 }), plan('a@x.com', { _row: 3, 'Unlisted Allocation': 0 }), plan('b@x.com', { _row: 4 }), plan('a@x.com', { _row: 5 })],
  });
  const model = await build();
  assert.deepEqual(model.meta.repeatedPlans, []);
});

// ---- the top of the flow -------------------------------------------------------------------------

test('leads created are listed per lead with month, team, both RMs and the Primary flag', async () => {
  const { build } = world({
    raw: [lead('a@x.com'), lead('b@x.com', { leadHead: 'Secondary', Team: 'Team B', currentRmName: 'Bhanu', firstRmName: 'Asha' }),
          lead('old@x.com', { createdDate: '2026-03-31' }), lead('d@x.com', { Team: '' })],
    ldRows: [plan('a@x.com')],
  });
  const { createdLeads } = (await build()).meta;
  assert.deepEqual(createdLeads, [['2026-05', 'Team A', 'Asha', 'Bhanu', true], ['2026-05', 'Team B', 'Bhanu', 'Asha', false],
    ['2026-05', 'SV', 'Asha', 'Bhanu', true]]);
});

// ---- RMs ---------------------------------------------------------------------------------------------

test('a lead gives the client its current and first RM, from the live row or from the snapshot', async () => {
  const snapshot = snapshotOf({ [sha16('old@x.com')]: snapRow('IN PROCESS') });
  const { build } = world({ raw: [lead('a@x.com', { currentRmName: 'Bhanu', firstRmName: 'Asha' })], ldRows: [plan('a@x.com'), plan('old@x.com', { _row: 3 })], snapshot });
  const model = await build();
  assert.deepEqual([byEmail(model, 'a@x.com').rm, byEmail(model, 'a@x.com').firstRm, byEmail(model, 'a@x.com').rmSrc], ['Bhanu', 'Asha', 'Lead']);
  assert.deepEqual([byEmail(model, 'old@x.com').rm, byEmail(model, 'old@x.com').firstRm], ['Asha', 'Bhanu']);
});

test('a snapshot written before First RM was kept still loads, with no first RM', async () => {
  const snapshot = snapshotOf({ [sha16('old@x.com')]: snapRow('IN PROCESS').slice(0, 7) });
  const { build } = world({ ldRows: [plan('old@x.com')], snapshot });
  assert.equal(byEmail(await build(), 'old@x.com').firstRm, '');
});

test('a client with no lead is attributed to the RM named on its sheet row, through the RM name mapping', async () => {
  const { build } = world({ ldRows: [plan('ghost@x.com', { Advisor: 'R. Sharma' }), ticket('ghost2@x.com', { 'RM Name': 'Ravi Sharma' })] });
  const model = await build();
  for(const email of ['ghost@x.com', 'ghost2@x.com']){
    const client = byEmail(model, email);
    assert.equal(client.matched, false);
    assert.deepEqual([client.rm, client.team, client.rmSrc, client.firstRm], ['Ravi Sharma', 'Team R', 'L&D sheet', '']);
    assert.equal(client.status, 'NOT IN LEAD DATA');
  }
});

test('a sheet RM the team map does not know keeps its name but no team; no RM at all stays blank', async () => {
  const { build } = world({ ldRows: [plan('a@x.com', { Advisor: 'Unknown Person' }), plan('b@x.com', { _row: 3 })] });
  const model = await build();
  assert.deepEqual([byEmail(model, 'a@x.com').rm, byEmail(model, 'a@x.com').team], ['Unknown Person', 'No lead record']);
  assert.deepEqual([byEmail(model, 'b@x.com').rm, byEmail(model, 'b@x.com').rmSrc, byEmail(model, 'b@x.com').team], ['', '', 'No lead record']);
});

test('where a lead exists its RM wins over the sheet RM', async () => {
  const { build } = world({ raw: [lead('a@x.com', { currentRmName: 'Bhanu', Team: 'Team B' })], ldRows: [plan('a@x.com', { Advisor: 'Ravi Sharma' })] });
  const client = byEmail(await build(), 'a@x.com');
  assert.deepEqual([client.rm, client.team, client.rmSrc, client.advisor], ['Bhanu', 'Team B', 'Lead', 'Ravi Sharma']);
});
