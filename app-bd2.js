// app-bd2.js — BD Performance 2 tab: calls -> meetings -> joined -> Workpoint status,
// by BD rep (Call Flow sub-tab) and by team (Team-BD Performance sub-tab).
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).
//
// A meeting is one tracker row, dated by Date Assigned (like the original Call Flow).
// Each lead is matched to B2C by email only; a lead whose email is not found is
// grouped as Unmatched (as its own team, platform and status), never folded into
// another bucket. A matched lead's RM, and so its team, is that of its FIRST RM;
// the one exception is a lead first handled by someone on the BD team, which takes
// its CURRENT RM (and that RM's team) instead (see bd2Prepare). Status comes from
// the matched B2C record (Workpoint): Converted when it has a Converted Month,
// In Process when its status is IN PROCESS, otherwise Other. The BD Daily Log has
// no team, RM or platform, so call counts follow Month + Person only and are shown
// as "—" while a Team, RM or Platform filter is set. The RM BD Performance sub-tab
// also reports how many Google Sheet clients were mapped to B2C by email.

const BD2_UNMATCHED = 'Unmatched';
const BD2_NO_PLATFORM = 'No platform';
const BD2_STATUSES = ['In Process', 'Converted', 'Other', 'Unmatched'];
const BD2_DESK_TEAM = 'BD Team';
const BD2_BASIS_FIRST = 'First RM';
const BD2_BASIS_CURRENT = 'Current RM (first RM is on the BD team)';

const bd2Month = r => toMmmYyyy(r.dateAssigned);

// Resolves each tracker row's first RM, current RM, team and the basis used, once
// per load. firstRmTeam() is the dashboard-wide first-RM rule (EMPLOYEE_REF, then
// the RM Master alias, else SV); effectiveTeam is the current RM's team.
let _bd2Prepared = null;
let _bd2RmNames = null;

// One display spelling per RM, whatever case, spacing or RM Master alias the CRM
// used for the name. EMPLOYEE_REF's spelling wins; otherwise the first one seen.
function bd2RmLabel(name){
  const n = cleanName(name);
  if(!n) return '(unassigned)';
  if(!_bd2RmNames){
    _bd2RmNames = new Map();
    for(let i = 1; i < STATE.empref.length; i++){
      const nm = STATE.empref[i] && cleanName(STATE.empref[i][2]);
      if(nm) _bd2RmNames.set(normalizeNameKey(nm), nm);
    }
  }
  const canon = cleanName(mapRM(n));
  const key = normalizeNameKey(canon);
  if(!_bd2RmNames.has(key)) _bd2RmNames.set(key, canon);
  return _bd2RmNames.get(key);
}

function bd2Prepare(){
  _bd2RmNames = null;
  const b2c = buildB2CEmailIndex();
  for(const r of STATE.bd){
    const b = r.crmMatched ? b2c[bdClientKey(r)] : null;
    if(!b){
      r.bd2 = { team: BD2_UNMATCHED, rm: BD2_UNMATCHED, basis: BD2_UNMATCHED, firstRm: '', currentRm: '', firstTeam: '', firstRmKnown: true };
      continue;
    }
    const firstTeam = firstRmTeam(b);
    const onDesk = firstTeam === BD2_DESK_TEAM;
    r.bd2 = {
      firstRm: b.firstRmName || '', currentRm: b.currentRmName || '', firstTeam,
      team: onDesk ? (r.effectiveTeam || 'SV') : firstTeam,
      rm: bd2RmLabel(onDesk ? b.currentRmName : b.firstRmName),
      basis: onDesk ? BD2_BASIS_CURRENT : BD2_BASIS_FIRST,
      firstRmKnown: !!teamForRmName(b.firstRmName),
    };
  }
  _bd2Prepared = STATE.bd;
}
const bd2Info = r => { if(_bd2Prepared !== STATE.bd) bd2Prepare(); return r.bd2; };
const bd2Team = r => bd2Info(r).team;
const bd2Rm = r => bd2Info(r).rm;
const bd2Platform = r => r.crmMatched ? (r.effectivePlatform || BD2_NO_PLATFORM) : BD2_UNMATCHED;

const bd2Sel = v => (!v || v === 'All' || (Array.isArray(v) && !v.length)) ? null : (Array.isArray(v) ? v : [v]);
const bd2In = (v, x) => { const s = bd2Sel(v); return !s || s.includes(x); };
const bd2LeadFiltersActive = () => !!(bd2Sel(STATE.bd2.team) || bd2Sel(STATE.bd2.rm) || bd2Sel(STATE.bd2.platform));

function bd2Status(r){
  if(!r.crmMatched) return 'Unmatched';
  if(r.effectiveStage === 'CONVERTED') return 'Converted';
  if(r.effectiveStage === 'IN PROCESS') return 'In Process';
  return 'Other';
}

// ---- filter option lists (from the data, so new values appear with no code change) ----
function bd2Options(){
  const teamsPresent = new Set(STATE.bd.map(bd2Team));
  const teams = FIXED_TEAMS.filter(t => teamsPresent.has(t));
  for(const t of teamsPresent){ if(t !== BD2_UNMATCHED && !teams.includes(t)) teams.push(t); }
  if(teamsPresent.has(BD2_UNMATCHED)) teams.push(BD2_UNMATCHED);
  const platforms = [...new Set(STATE.bd.map(bd2Platform))].filter(p => p !== BD2_UNMATCHED).sort();
  if(STATE.bd.some(r => !r.crmMatched)) platforms.push(BD2_UNMATCHED);
  const months = sortMonths([...new Set([...STATE.bd.map(bd2Month), ...STATE.bdCalls.map(r => toMmmYyyy(r.date))])]);
  const persons = [...new Set([...STATE.bd.map(r => r.person), ...STATE.bdCalls.map(r => r.bdName)].filter(Boolean))].sort();
  return { months, teams, persons, platforms };
}

// RMs offered in the RM filter: those with a meeting under the chosen Team(s), A-Z, Unmatched last.
function bd2RmOptions(){
  const names = new Set();
  for(const r of STATE.bd){ if(bd2In(STATE.bd2.team, bd2Team(r))) names.add(bd2Rm(r)); }
  const list = [...names].filter(n => n !== BD2_UNMATCHED).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  if(names.has(BD2_UNMATCHED)) list.push(BD2_UNMATCHED);
  return list;
}

// After the Team filter changes, drop any chosen RM who is no longer in that team.
function bd2PruneRm(){
  const valid = new Set(bd2RmOptions());
  const keep = (bd2Sel(STATE.bd2.rm) || []).filter(n => valid.has(n));
  STATE.bd2.rm = keep.length ? keep : 'All';
}

// ---- scoped rows ----
function bd2Meetings(){
  const f = STATE.bd2;
  return STATE.bd.filter(r => bd2In(f.month, bd2Month(r)) && bd2In(f.person, r.person) &&
    bd2In(f.team, bd2Team(r)) && bd2In(f.rm, bd2Rm(r)) && bd2In(f.platform, bd2Platform(r)));
}
function bd2CallRows(){
  const f = STATE.bd2;
  return STATE.bdCalls.filter(r => bd2In(f.month, toMmmYyyy(r.date)) && bd2In(f.person, r.bdName));
}

// Meetings and their outcomes. Joined / Not Joined / Pending / Not Logged add up to
// meetings; In Process / Converted / Other / Unmatched add up to joined.
function bd2Tally(rows){
  const t = { meetings: rows.length, joined: 0, notJoined: 0, pending: 0, notLogged: 0,
    inProcess: 0, converted: 0, other: 0, unmatched: 0 };
  for(const r of rows){
    if(r.gmeetJoined === 'Yes'){
      t.joined++;
      const s = bd2Status(r);
      if(s === 'In Process') t.inProcess++;
      else if(s === 'Converted') t.converted++;
      else if(s === 'Unmatched') t.unmatched++;
      else t.other++;
    }
    else if(r.gmeetJoined === 'No') t.notJoined++;
    else if(r.gmeetJoined === 'Pending') t.pending++;
    else t.notLogged++;
  }
  return t;
}

const bd2Ratio = (a, b) => b > 0 ? a / b : 0;

function bd2Flow(){
  const c = bdCallsSummarize(bd2CallRows());
  const t = bd2Tally(bd2Meetings());
  const noCalls = bd2LeadFiltersActive();
  return {
    ...t,
    noCalls,
    totalCalls: c['Total Calls'], connected: c['Calls Connected'], cnp: c['CNP'],
    connectedPct: c['Connected %'], cnpPct: c['CNP %'],
    meetingPct: noCalls ? null : bd2Ratio(t.meetings, c['Calls Connected']),
  };
}

// One row per BD rep: calls from the Daily Log, everything else from the tracker rows.
function bd2ByRep(){
  const rows = bd2Meetings(), calls = bd2CallRows();
  const people = [...new Set([...rows.map(r => r.person), ...calls.map(r => r.bdName)].filter(Boolean))].sort();
  const noCalls = bd2LeadFiltersActive();
  const line = (label, repRows, repCalls) => {
    const c = bdCallsSummarize(repCalls), t = bd2Tally(repRows);
    return { label, ...t, noCalls, calls: c['Total Calls'], connected: c['Calls Connected'] };
  };
  const out = people.map(p => line(p, rows.filter(r => r.person === p), calls.filter(r => r.bdName === p)));
  out.push({ ...line('Grand Total', rows, calls), _tot: true });
  return out;
}

// One row per team (Unmatched last). Calls can't be split by team, so there are none here.
function bd2ByTeam(){
  const rows = bd2Meetings();
  const present = new Set(rows.map(bd2Team));
  const teams = FIXED_TEAMS.filter(t => present.has(t));
  for(const t of present){ if(t !== BD2_UNMATCHED && !teams.includes(t)) teams.push(t); }
  if(present.has(BD2_UNMATCHED)) teams.push(BD2_UNMATCHED);
  const out = teams.map(t => ({ label: t, ...bd2Tally(rows.filter(r => bd2Team(r) === t)) }));
  out.push({ label: 'Grand Total', ...bd2Tally(rows), _tot: true });
  return out;
}

// One row per RM, most meetings first. Calls can't be split by RM either, so there are none here.
function bd2ByRm(){
  const rows = bd2Meetings();
  const byRm = new Map();
  for(const r of rows){
    const k = bd2Rm(r);
    if(!byRm.has(k)) byRm.set(k, []);
    byRm.get(k).push(r);
  }
  const out = [...byRm].map(([rm, rs]) => ({
    label: rm, team: [...new Set(rs.map(bd2Team))].sort().join(' / '), ...bd2Tally(rs),
  }));
  out.sort((a, b) => b.meetings - a.meetings || a.label.localeCompare(b.label));
  out.push({ label: 'Grand Total', team: '', ...bd2Tally(rows), _tot: true });
  return out;
}

// One line per meeting behind the flow, so any number can be checked against B2C by email.
function bd2MeetingLines(){
  const b2c = buildB2CEmailIndex();
  return bd2Meetings().map(r => {
    const b = b2c[bdClientKey(r)];
    return {
      'BD Rep': r.person || '',
      Email: String(r.email == null ? '' : r.email),
      'Client Name': (b && b.clientName) || '',
      'Date Assigned': toIsoDate(r.dateAssigned) || '',
      'GMeet Joined': ['Yes', 'No', 'Pending'].includes(r.gmeetJoined) ? r.gmeetJoined : 'Not Logged',
      'Found in B2C': r.crmMatched ? 'Yes' : 'No',
      'B2C Lead Status': b ? b.leadStatus : '',
      'B2C Converted Month': b && b.CM !== 'N/A' ? b.CM : '',
      'Status (Workpoint)': bd2Status(r),
      'First RM': bd2Info(r).firstRm,
      'First RM Team': bd2Info(r).firstTeam,
      'Current RM': bd2Info(r).currentRm,
      'Current RM Team': r.crmMatched ? (r.effectiveTeam || 'SV') : '',
      'Team Basis': bd2Info(r).basis,
      Team: bd2Team(r),
      RM: bd2Rm(r),
      Platform: bd2Platform(r),
    };
  });
}

const BD2_LINE_HEADERS = ['BD Rep', 'Email', 'Client Name', 'Date Assigned', 'GMeet Joined', 'Found in B2C', 'B2C Lead Status',
  'B2C Converted Month', 'Status (Workpoint)', 'First RM', 'First RM Team', 'Current RM', 'Current RM Team', 'Team Basis', 'Team', 'RM', 'Platform'];

// How the meetings in the current selection were assigned to a team, for the note above the team view.
function bd2TeamBasis(){
  const rows = bd2Meetings();
  const n = basis => rows.filter(r => bd2Info(r).basis === basis).length;
  const unknown = rows.filter(r => !bd2Info(r).firstRmKnown).length;
  return { total: rows.length, first: n(BD2_BASIS_FIRST), current: n(BD2_BASIS_CURRENT), unmatched: n(BD2_UNMATCHED), unknown };
}

// How many clients in the Google Sheet were found in B2C by email. A client is one distinct
// email; a row with no email cannot be matched and counts as its own unmapped client.
function bd2Mapping(rows){
  const byEmail = new Map();
  let noEmail = 0;
  for(const r of rows){
    const k = bdClientKey(r);
    if(!k){ noEmail++; continue; }
    byEmail.set(k, !!r.crmMatched);
  }
  const mapped = [...byEmail.values()].filter(Boolean).length;
  return {
    meetings: rows.length, clients: byEmail.size + noEmail,
    mapped, unmapped: byEmail.size - mapped + noEmail, noEmail,
    repeats: rows.length - noEmail - byEmail.size,    // extra entries for a client already listed
  };
}

// One row per BD rep, then the Grand Total (each client once overall).
function bd2MappingByRep(){
  const rows = bd2Meetings();
  const people = [...new Set(rows.map(r => r.person).filter(Boolean))].sort();
  const out = people.map(p => ({ label: p, ...bd2Mapping(rows.filter(r => r.person === p)) }));
  out.push({ label: 'Grand Total', ...bd2Mapping(rows), _tot: true });
  return out;
}

// ---- filters ----
let _bd2FiltersBuilt = false;
function buildBD2Filters(){
  const o = bd2Options(), f = STATE.bd2;
  buildMultiSelect('#bd2-month-filter-wrap', ['All', ...o.months], f.month,
    val => { f.month = val; renderBD2(); }, { multi: true });
  buildMultiSelect('#bd2-team-filter-wrap', ['All', ...o.teams], f.team,
    val => { f.team = val; bd2PruneRm(); buildBD2RmFilter(); renderBD2(); }, { multi: true });
  buildBD2RmFilter();
  buildMultiSelect('#bd2-person-filter-wrap', ['All', ...o.persons], f.person,
    val => { f.person = val; renderBD2(); }, { multi: true });
  buildMultiSelect('#bd2-platform-filter-wrap', ['All', ...o.platforms], f.platform,
    val => { f.platform = val; renderBD2(); }, { multi: true });
  _bd2FiltersBuilt = true;
}

function buildBD2RmFilter(){
  const f = STATE.bd2;
  buildMultiSelect('#bd2-rm-filter-wrap', ['All', ...bd2RmOptions()], f.rm,
    val => { f.rm = val; renderBD2(); }, { multi: true, search: true });
}

function activateBd2Subtab(id){
  STATE.bd2.sub = id;
  $$('#tab-bdperf2 .dash-subtab').forEach(b => b.classList.toggle('active', b.dataset.bd2subtab === id));
  $$('#tab-bdperf2 .dash-subpanel').forEach(p => p.classList.toggle('active', p.id === 'bd2sub-' + id));
  requestAnimationFrame(() => {
    const panel = $('#bd2sub-' + id);
    if(panel) panel.querySelectorAll('.table-wrap').forEach(attachMirrorScroll);
  });
}

// ---- rendering ----
const bd2Pct = (a, b) => fmtPct(bd2Ratio(a, b));

const bd2Node = (label, value, sub, tone) =>
  `<div class="cf-node cf-${tone}">
     <div class="cf-value">${value}</div>
     <div class="cf-label">${label}</div>
     ${sub ? `<div class="cf-sub">${sub}</div>` : ''}
   </div>`;

function renderBD2Flow(){
  const host = $('#bd2-call-flow');
  if(!host) return;
  const f = bd2Flow();
  const note = $('#bd2-flow-note');
  if(note){
    const rms = bd2Sel(STATE.bd2.rm);
    const shown = rms ? `Showing the flow for RM <strong>${escHtml(rms.length > 3 ? rms.slice(0, 3).join(', ') + ' +' + (rms.length - 3) + ' more' : rms.join(', '))}</strong>. ` : '';
    note.innerHTML = shown + (f.noCalls
      ? 'Calls Made, Connected and CNP come from the BD Daily Log, which has no team, RM or platform, so they are not shown while a Team, RM or Platform filter is set. '
        + 'Everything from Meetings Scheduled onward follows every filter.'
      : '');
  }

  const node = bd2Node;
  const call = (label, n, sub, tone) => f.noCalls
    ? node(label, '—', 'n/a with a Team / RM / Platform filter', 'muted')
    : node(label, fmtIN(n), sub, tone);
  const of = (n, base, what) => `${bd2Pct(n, base)} of ${what}`;

  host.innerHTML =
    `<div class="cf-flow">
      <div class="cf-row">${call('Total Calls Made', f.totalCalls, 'BD Daily Log', 'blue')}</div>
      <div class="cf-split"></div>
      <div class="cf-row cf-row-2">
        ${call('Calls Connected', f.connected, of(f.connected, f.totalCalls, 'calls made'), 'green')}
        ${call('CNP · Not Picked', f.cnp, of(f.cnp, f.totalCalls, 'calls made'), 'red')}
      </div>
      <div class="cf-arrow" title="Calls Connected → Meetings Scheduled">&#8595;</div>
      <div class="cf-row">${node('Meetings Scheduled', fmtIN(f.meetings),
        f.meetingPct === null ? 'Tracker · Date Assigned' : of(f.meetings, f.connected, 'calls connected'), 'violet')}</div>
      <div class="cf-split cf-split-4"></div>
      <div class="cf-row cf-row-4">
        ${node('Meeting Joined', fmtIN(f.joined), of(f.joined, f.meetings, 'meetings scheduled'), 'green')}
        ${node('Not Joined', fmtIN(f.notJoined), of(f.notJoined, f.meetings, 'meetings scheduled'), 'red')}
        ${node('Pending', fmtIN(f.pending), of(f.pending, f.meetings, 'meetings scheduled'), 'amber')}
        ${node('Not Logged', fmtIN(f.notLogged), of(f.notLogged, f.meetings, 'meetings scheduled'), 'muted')}
      </div>
      <div class="cf-branch"></div>
      <div class="cf-row cf-row-4">
        ${node('In Process', fmtIN(f.inProcess), of(f.inProcess, f.joined, 'meetings joined'), 'violet')}
        ${node('Converted', fmtIN(f.converted), of(f.converted, f.joined, 'meetings joined'), 'green')}
        ${node('Other States', fmtIN(f.other), of(f.other, f.joined, 'meetings joined'), 'amber')}
        ${node('Unmatched', fmtIN(f.unmatched), of(f.unmatched, f.joined, 'meetings joined'), 'muted')}
      </div>
      <div class="cf-caption">Of the <strong>${fmtIN(f.joined)}</strong> meetings joined, where each client stands in Workpoint (B2C), matched by email.
        <em>Other States</em> = Assigned, Re-assigned, Follow Up, On Hold or Dead. <em>Unmatched</em> = email not found in B2C.</div>
     </div>`;
}

const BD2_REP_HEADERS = ['Calls Made', 'Calls Connected', 'Meetings Scheduled', 'Meetings Joined', 'In Process', 'Converted',
  'Other States', 'Unmatched', 'Joined %', 'In Process %', 'Converted %'];

function bd2RepCells(r){
  const calls = v => r.noCalls ? '—' : fmtIN(v);
  return {
    'Calls Made': calls(r.calls), 'Calls Connected': calls(r.connected),
    'Meetings Scheduled': fmtIN(r.meetings), 'Meetings Joined': fmtIN(r.joined),
    'In Process': fmtIN(r.inProcess), Converted: fmtIN(r.converted),
    'Other States': fmtIN(r.other), Unmatched: fmtIN(r.unmatched),
    'Joined %': bd2Pct(r.joined, r.meetings),
    'In Process %': bd2Pct(r.inProcess, r.joined),
    'Converted %': bd2Pct(r.converted, r.joined),
  };
}

function renderBD2RepTable(){
  const headers = ['BD Rep', ...BD2_REP_HEADERS];
  const rows = bd2ByRep().map(r => ({ 'BD Rep': r.label, ...bd2RepCells(r), _tot: !!r._tot }));
  makeSortableTable('#tbl-bd2-rep', headers, rows, renderBD2RepTable);
}

const BD2_TEAM_HEADERS = ['Meetings Scheduled', 'Meetings Joined', 'Not Joined', 'Pending', 'Not Logged', 'In Process', 'Converted',
  'Other States', 'Unmatched', 'Joined %', 'In Process %', 'Converted %'];

const bd2FlowCells = r => ({
  'Meetings Scheduled': fmtIN(r.meetings), 'Meetings Joined': fmtIN(r.joined),
  'Not Joined': fmtIN(r.notJoined), Pending: fmtIN(r.pending), 'Not Logged': fmtIN(r.notLogged),
  'In Process': fmtIN(r.inProcess), Converted: fmtIN(r.converted),
  'Other States': fmtIN(r.other), Unmatched: fmtIN(r.unmatched),
  'Joined %': bd2Pct(r.joined, r.meetings),
  'In Process %': bd2Pct(r.inProcess, r.joined),
  'Converted %': bd2Pct(r.converted, r.joined),
});

function renderBD2TeamTable(){
  const headers = ['Team', ...BD2_TEAM_HEADERS];
  const rows = bd2ByTeam().map(r => ({ Team: r.label, ...bd2FlowCells(r), _tot: !!r._tot }));
  makeSortableTable('#tbl-bd2-team', headers, rows, renderBD2TeamTable);
}

function renderBD2RmTable(){
  const headers = ['RM', 'Team', ...BD2_TEAM_HEADERS];
  const rows = bd2ByRm().map(r => ({ RM: r.label, Team: r.team, ...bd2FlowCells(r), _tot: !!r._tot }));
  makeSortableTable('#tbl-bd2-rmflow', headers, rows, renderBD2RmTable);
}

// One compact flow card (a team or an RM): bars are scaled to the card's own meetings, so the
// shape of each funnel is comparable across cards while the numbers carry the size.
function bd2FlowCard(title, subtitle, t){
  const base = t.meetings;
  const row = (label, n, tone, sub) =>
    `<div class="tf-row${sub ? ' tf-sub' : ''}">
       <div class="tf-label">${label}</div>
       <div class="tf-bar"><span class="tf-fill tf-${tone}" style="width:${Math.max(base ? n / base * 100 : 0, n ? 2 : 0)}%"></span></div>
       <div class="tf-num"><strong>${fmtIN(n)}</strong></div>
     </div>`;
  return `<div class="tf-card">
      <div class="tf-title">${escHtml(title)}</div>
      ${subtitle ? `<div class="tf-team">${escHtml(subtitle)}</div>` : ''}
      ${row('Meetings Scheduled', t.meetings, 'violet')}
      ${row('Meeting Joined', t.joined, 'green')}
      <div class="tf-meta">${bd2Pct(t.joined, t.meetings)} of meetings · not joined ${fmtIN(t.notJoined)} · pending ${fmtIN(t.pending)} · not logged ${fmtIN(t.notLogged)}</div>
      ${row('↳ In Process', t.inProcess, 'violet', true)}
      ${row('↳ Converted', t.converted, 'green', true)}
      ${row('↳ Other States', t.other, 'amber', true)}
      ${row('↳ Unmatched', t.unmatched, 'muted', true)}
      <div class="tf-meta">of joined: In Process ${bd2Pct(t.inProcess, t.joined)} · Converted ${bd2Pct(t.converted, t.joined)}</div>
    </div>`;
}

// How the meetings in the selection were assigned to a team / RM, for the note above the flows.
function bd2BasisHtml(what){
  const b = bd2TeamBasis(), s = n => n === 1 ? '' : 's';
  if(!b.total) return '';
  const first = what === 'RM' ? 'under the first RM' : "by the first RM's team";
  const current = what === 'RM' ? 'under the current RM (first RM is on the BD team)' : "by the current RM's team (first RM is on the BD team)";
  const unknown = b.unknown
    ? ` ${fmtIN(b.unknown)} meeting${s(b.unknown)} ${b.unknown === 1 ? 'has a first RM' : 'have a first RM'} that is not in EMPLOYEE_REF, so ${what === 'RM' ? (b.unknown === 1 ? 'its team is' : 'their team is') : (b.unknown === 1 ? 'it is' : 'they are')} counted ${what === 'RM' ? 'as' : 'under'} SV.`
    : '';
  return `${what} basis for the <strong>${fmtIN(b.total)}</strong> meetings in this selection: <strong>${fmtIN(b.first)}</strong> ${first} · `
    + `<strong>${fmtIN(b.current)}</strong> ${current} · <strong>${fmtIN(b.unmatched)}</strong> Unmatched.` + unknown;
}

function renderBD2TeamFlows(){
  const host = $('#bd2-team-flows');
  if(!host) return;
  const basisEl = $('#bd2-team-basis');
  if(basisEl) basisEl.innerHTML = bd2BasisHtml('Team');
  const teams = bd2ByTeam().filter(r => !r._tot);
  if(!teams.length){ host.innerHTML = '<div class="hint">No meetings match these filters.</div>'; return; }
  host.innerHTML = teams.map(t => bd2FlowCard(t.label, '', t)).join('');
}

// RM BD Performance: one flow per RM, most meetings first. With many RMs only the busiest are
// drawn until "Show all" is pressed; the table below always lists every RM.
const BD2_RM_CARDS = 24;
function renderBD2RmFlows(){
  const host = $('#bd2-rm-flows'), more = $('#bd2-rm-more');
  if(!host) return;
  const basisEl = $('#bd2-rm-basis');
  if(basisEl) basisEl.innerHTML = bd2BasisHtml('RM');
  const rms = bd2ByRm().filter(r => !r._tot);
  if(!rms.length){
    host.innerHTML = '<div class="hint">No meetings match these filters.</div>';
    if(more) more.innerHTML = '';
    return;
  }
  host.innerHTML = (STATE.bd2.rmAll ? rms : rms.slice(0, BD2_RM_CARDS))
    .map(r => bd2FlowCard(r.label, r.team ? 'Team: ' + r.team : '', r)).join('');
  if(more){
    more.innerHTML = rms.length > BD2_RM_CARDS
      ? `<button class="secondary" id="bd2-rm-more-btn">${STATE.bd2.rmAll ? `Show only the top ${BD2_RM_CARDS} RMs` : `Show all ${fmtIN(rms.length)} RMs`}</button>`
      : '';
    const btn = $('#bd2-rm-more-btn');
    if(btn) btn.onclick = () => { STATE.bd2.rmAll = !STATE.bd2.rmAll; renderBD2RmFlows(); };
  }
}

// Google Sheet clients mapped / unmapped to the Workpoint B2C file (by email), for the current
// filters, with the whole sheet underneath so the overall figure is always in view.
function renderBD2Mapping(){
  const host = $('#bd2-mapping');
  if(!host) return;
  const m = bd2Mapping(bd2Meetings()), all = bd2Mapping(STATE.bd);
  host.innerHTML =
    `<div class="cf-flow">
      <div class="cf-row">
        ${bd2Node('Clients in the Google Sheet', fmtIN(m.clients), `${fmtIN(m.meetings)} meeting${m.meetings === 1 ? '' : 's'} in this selection${m.repeats ? ` · ${fmtIN(m.repeats)} repeat entr${m.repeats === 1 ? 'y' : 'ies'}` : ''}`, 'blue')}
        ${bd2Node('Mapped to Workpoint B2C', fmtIN(m.mapped), `${bd2Pct(m.mapped, m.clients)} of clients`, 'green')}
        ${bd2Node('Unmapped', fmtIN(m.unmapped), `${bd2Pct(m.unmapped, m.clients)} of clients${m.noEmail ? ` · ${fmtIN(m.noEmail)} with no email` : ''}`, m.unmapped ? 'red' : 'muted')}
      </div>
      <div class="cf-caption">Whole Google Sheet, no filters: <strong>${fmtIN(all.clients)}</strong> clients ·
        <strong>${fmtIN(all.mapped)}</strong> mapped (${bd2Pct(all.mapped, all.clients)}) · <strong>${fmtIN(all.unmapped)}</strong> unmapped (${bd2Pct(all.unmapped, all.clients)}).</div>
    </div>`;

  const rows = bd2MappingByRep();
  const gt = rows[rows.length - 1];
  const shared = rows.slice(0, -1).reduce((a, r) => a + r.clients, 0) - gt.clients;
  makeSortableTable('#tbl-bd2-mapping', ['BD Rep', 'Clients', 'Mapped', 'Unmapped', 'Mapped %'],
    rows.map(r => ({ 'BD Rep': r.label, Clients: fmtIN(r.clients), Mapped: fmtIN(r.mapped), Unmapped: fmtIN(r.unmapped),
      'Mapped %': bd2Pct(r.mapped, r.clients), _tot: !!r._tot })), renderBD2Mapping);
  const note = $('#bd2-mapping-note');
  if(note) note.textContent = shared > 0
    ? `Grand Total counts each client once. ${fmtIN(shared)} client${shared === 1 ? ' was' : 's were'} logged by two reps and ${shared === 1 ? 'is' : 'are'} counted for each, so the rep rows add up to ${fmtIN(shared)} more than the Grand Total.`
    : '';
}

// Excel: RM-wise flow for the current filters, the meetings behind it, and the selection with a tie-out.
function bd2SelectionText(v){
  const s = bd2Sel(v);
  return s ? s.join(', ') : 'All';
}

function downloadBd2Workbook(){
  const rm = bd2ByRm();
  const total = rm[rm.length - 1];
  const rows = rm.slice(0, -1);
  const ratio = (a, b) => b > 0 ? a / b : 0;
  const head = ['RM', 'Team', 'Meetings Scheduled', 'Meetings Joined', 'Not Joined', 'Pending', 'Not Logged', 'In Process', 'Converted',
    'Other States', 'Unmatched', 'Joined %', 'In Process %', 'Converted %'];
  const line = r => [r.label, r.team, r.meetings, r.joined, r.notJoined, r.pending, r.notLogged, r.inProcess, r.converted, r.other,
    r.unmatched, ratio(r.joined, r.meetings), ratio(r.inProcess, r.joined), ratio(r.converted, r.joined)];
  const wsRm = XLSX.utils.aoa_to_sheet([head, ...rows.map(line), line(total)]);
  for(let i = 1; i <= rows.length + 1; i++){
    for(const c of [11, 12, 13]){
      const cell = wsRm[XLSX.utils.encode_cell({ r: i, c })];
      if(cell) cell.z = '0.0%';
    }
  }
  wsRm['!cols'] = [{ wch: 30 }, { wch: 14 }, ...head.slice(2).map(() => ({ wch: 14 }))];

  const lines = bd2MeetingLines();
  const wsMeet = XLSX.utils.aoa_to_sheet([BD2_LINE_HEADERS, ...lines.map(l => BD2_LINE_HEADERS.map(h => l[h] ?? ''))]);
  wsMeet['!cols'] = BD2_LINE_HEADERS.map(h => ({ wch: Math.max(12, h.length + 2) }));

  const f = STATE.bd2, sum = rows.reduce((a, r) => a + r.meetings, 0);
  const map = bd2Mapping(bd2Meetings()), mapAll = bd2Mapping(STATE.bd);
  const wsSel = XLSX.utils.aoa_to_sheet([
    ['BD Performance 2 — RM-wise flow'], [],
    ['Month', bd2SelectionText(f.month)], ['Team', bd2SelectionText(f.team)], ['RM', bd2SelectionText(f.rm)],
    ['BD rep (Person)', bd2SelectionText(f.person)], ['Platform', bd2SelectionText(f.platform)], [],
    ['Meetings in this selection', total.meetings], ['RMs listed', rows.length], ['Sum of the RM rows', sum],
    ['Tie-out (should be 0)', total.meetings - sum], [],
    ['Clients in this selection (distinct emails)', map.clients], ['Mapped to Workpoint B2C', map.mapped], ['Unmapped', map.unmapped],
    ['Unmapped with no email', map.noEmail], ['Whole Google Sheet: clients / mapped / unmapped', `${mapAll.clients} / ${mapAll.mapped} / ${mapAll.unmapped}`], [],
    ['RM basis', 'A lead\'s RM is its first RM; if the first RM is on the BD team, the current RM. Team follows the same rule. Leads whose email is not found in B2C are Unmatched.'],
    ['Meetings', 'One tracker row, counted in the month of its Date Assigned.'],
    ['Data till', STATE.dataTill || ''], ['Downloaded', new Date().toLocaleString('en-IN')],
  ]);
  wsSel['!cols'] = [{ wch: 28 }, { wch: 90 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsRm, 'RM Flow');
  XLSX.utils.book_append_sheet(wb, wsMeet, 'Meetings');
  XLSX.utils.book_append_sheet(wb, wsSel, 'Selection');
  XLSX.writeFile(wb, `BD_RM_Flow_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function renderBD2(){
  if(!STATE.filesLoaded.bd){
    _bd2FiltersBuilt = false;
    ['#bd2-call-flow', '#tbl-bd2-rep', '#bd2-team-flows', '#tbl-bd2-team', '#bd2-mapping', '#tbl-bd2-mapping', '#bd2-rm-flows', '#tbl-bd2-rmflow']
      .forEach(sel => setNotUploaded(sel, 'bd'));
    return;
  }
  if(!_bd2FiltersBuilt) buildBD2Filters();
  const reset = $('#bd2-reset-filters');
  if(reset) reset.onclick = () => {
    Object.assign(STATE.bd2, { month: 'All', team: 'All', rm: 'All', person: 'All', platform: 'All' });
    buildBD2Filters();
    renderBD2();
  };
  $$('#tab-bdperf2 .dash-subtab').forEach(b => { b.onclick = () => activateBd2Subtab(b.dataset.bd2subtab); });
  const xl = $('#bd2-xlsx-dl');
  if(xl) xl.onclick = downloadBd2Workbook;
  const rmXl = $('#bd2-rm-xlsx-dl');
  if(rmXl) rmXl.onclick = e => { e.preventDefault(); downloadBd2Workbook(); };
  const dl = $('#bd2-flow-dl');
  if(dl) dl.onclick = e => {
    e.preventDefault();
    downloadRowsAsXlsx(BD2_LINE_HEADERS, bd2MeetingLines(), 'Meetings', 'BD_Meetings_Workpoint_Status.xlsx');
  };

  renderBD2Flow();
  renderBD2RepTable();
  renderBD2TeamFlows();
  renderBD2TeamTable();
  renderBD2Mapping();
  renderBD2RmFlows();
  renderBD2RmTable();
  requestAnimationFrame(() => $$('#tab-bdperf2 .dash-subpanel.active .table-wrap').forEach(attachMirrorScroll));
}
