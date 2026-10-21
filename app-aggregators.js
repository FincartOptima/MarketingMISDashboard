// app-aggregators.js — Pure calculation functions: KPIs, breakdowns, cost summaries.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

// ---- aggregators ----

// Shared by every aggregator that appends a "Grand Total" row: sums each
// dynamic column (a month, a campaign name, a platform, etc.) across all
// data rows, optionally accumulating a running total field. Mathematically
// equivalent to summing each row's own total field, since a row's total is
// itself the sum of its dynamic columns.
function buildGrandTotalRow(labelField, labelValue, dynamicKeys, rows, totalField){
  const gt = { [labelField]: labelValue, _tot: true };
  if(totalField) gt[totalField] = 0;
  for(const key of dynamicKeys){
    gt[key] = rows.reduce((sum, row) => sum + (row[key] || 0), 0);
    if(totalField) gt[totalField] += gt[key];
  }
  return gt;
}

// Filters `pool` by whether a status's month-anchor column matches the active
// month filter, honoring the AnyMonth/SameMonth tri-state used by several
// breakdown tables: AnyMonth = the status event happened in the selected
// month(s) but the lead was NOT created then; SameMonth = the event happened
// in the selected month(s) AND the lead was created then; default (neither) =
// the event column just needs to match the selected month(s).
function applyMonthMode(pool, anyMonthColName, mode){
  // AnyMonth/SameMonth compare against a specific selected month, so they
  // only apply once one is actually picked — with "All Months" selected,
  // fall through to the plain monthFilter() check below (which itself
  // restricts to the fixed FY range), same as every other month-wise table.
  // Previously this returned `pool` unfiltered in that case, silently
  // including pre-FY-cutoff leads that Generated Leads and friends exclude.
  if(!isAllMonths()){
    if(mode === 'AnyMonth')  return pool.filter(r => monthFilter(r[anyMonthColName]) && !monthFilter(r.CTM));
    if(mode === 'SameMonth') return pool.filter(r => monthFilter(r[anyMonthColName]) && monthFilter(r.CTM));
  }
  return pool.filter(r => monthFilter(r[anyMonthColName]));
}

// The base row filter every Dashboard-tab aggregator starts from: Ref+Cold
// mode, then the universal Status + Lead Head filter (see dashboardRowMatch
// in app-filters.js).
function applyRefColdFilter(rows){
  const mode = rcFilter(STATE.filterRefCold);
  let out = rows;
  if(mode === 'Exclude')
    out = out.filter(r => r['Campaign Name']!=='Referral' && r['Campaign Name']!=='Cold Data');
  else if(mode === 'Only Referral')
    out = out.filter(r => r['Campaign Name']==='Referral');
  return out.filter(dashboardRowMatch);
}

function topKPIs(){
  let rows = applyRefColdFilter(STATE.raw);
  // YTD Leads (Fixed) is intentionally NOT affected by the Month or Ref+Cold filters —
  // it always reflects the full fixed FY period, unfiltered, and only changes when data is reloaded.
  const ytd = STATE.raw.filter(r=>filteredMonths().includes(r.FMONTH)).length;
  const generated = rows.filter(r=>monthFilter(r.CTM)).length;
  // Any lead with a CM belongs to CONVERTED — it is excluded from every other
  // leadStatus bucket (per 2026-07-29 rule).
  const sc = st => rows.filter(r => r.leadStatus===st && !isConvertedLead(r) && monthFilter(r[statusMonthCol(st)])).length;
  const converted = rows.filter(r => isConvertedLead(r, monthFilter)).length;
  const inProcess = sc('IN PROCESS');
  return {
    ytd, generated, assigned: sc('ASSIGNED'), converted, inProcess,
    followUp: sc('FOLLOW UP'), onHold: sc('ON HOLD'), dead: sc('DEAD'),
    reAssigned: sc('RE-ASSIGNED'),
    qlRate: generated>0 ? (converted+inProcess)/generated : 0,
  };
}

function liveDataKPIs(){
  let rows = applyRefColdFilter(STATE.raw);
  const assigned = rows.filter(r=>r.leadStatus==='ASSIGNED' && !isConvertedLead(r) && monthFilter(r.CTM)).length;
  if(isAllMonths()) return { assigned, anyConv: null, anyIP: null, sameConv: null, sameIP: null };
  // AnyMonth = status event in selected month(s), lead CREATED outside those month(s)
  // SameMonth = status event in selected month(s), lead CREATED in the same selected month(s)
  const anyConv = rows.filter(r =>
    isConvertedLead(r, monthFilter) && !monthFilter(r.CTM)
  ).length;
  const anyIP = rows.filter(r =>
    r.leadStatus==='IN PROCESS' && !isConvertedLead(r) && monthFilter(r.LPM) && !monthFilter(r.CTM)
  ).length;
  const sameConv = rows.filter(r =>
    isConvertedLead(r, monthFilter) && monthFilter(r.CTM)
  ).length;
  const sameIP = rows.filter(r =>
    r.leadStatus==='IN PROCESS' && !isConvertedLead(r) && monthFilter(r.LPM) && monthFilter(r.CTM)
  ).length;
  return { assigned, anyConv, anyIP, sameConv, sameIP };
}

function platformsForLeadsTable(){
  const names = [...new Set(STATE.raw.map(r => r.platformName).filter(Boolean))].sort();
  return names.map(p => ({label: p, match: r => r.platformName === p}));
}

function leadsByPlatformMonth(){
  const buckets = platformsForLeadsTable();
  // Previously filtered by platformName === 'Referral'/'Cold Leads' as a
  // stand-in for Ref+Cold, and only under "Exclude" mode — "Only Referral"
  // was never handled at all (every platform kept its full count). Using
  // applyRefColdFilter() directly makes this table respect Ref+Cold via the
  // same Campaign Name check (and modes) as everywhere else on the dashboard.
  const rows = applyRefColdFilter(STATE.raw);
  const months = filteredMonths();
  const out = buckets.map(b => {
    const o = {Platform: b.label, total:0};
    months.forEach(m => {
      const c = rows.filter(x => b.match(x) && x.CTM===m).length;
      o[m] = c; o.total += c;
    });
    return o;
  });
  out.push(buildGrandTotalRow('Platform', 'Grand Total', months, out, 'total'));
  return out;
}

function statusByMonth(teamFilter){
  const months = filteredMonths();
  // Was STATE.raw.filter(dashboardRowMatch) — Status/Lead Head applied but
  // Ref+Cold silently ignored (Exclude/Only Referral had no effect on this
  // table). applyRefColdFilter() already calls dashboardRowMatch internally.
  let base = applyRefColdFilter(STATE.raw);
  if(teamFilter === 'SV') base = base.filter(r => (r.Team || 'SV') === 'SV');
  else if(teamFilter === 'non-SV') base = base.filter(r => (r.Team || 'SV') !== 'SV');
  return STATUSES.map(st => {
    const r = {Status: st, total: 0};
    months.forEach(m => {
      const col = statusMonthCol(st);
      // CONVERTED counts any lead whose CM matches — leadStatus is not required.
      // Non-CONVERTED buckets exclude leads with a CM (they now count only under CONVERTED).
      const c = st === 'CONVERTED'
        ? base.filter(x => x.CM === m).length
        : base.filter(x => x.leadStatus===st && !isConvertedLead(x) && x[col]===m).length;
      r[m] = c; r.total += c;
    });
    return r;
  });
}

function platformStatusBreakdown(){
  const month = STATE.filterMonth;
  const mode = STATE.filterTable;
  let rows = applyRefColdFilter(STATE.raw);
  if(STATE.psTeamFilter !== 'All') rows = rows.filter(r => r.Team === STATE.psTeamFilter);
  // Grouped by Category Name (r['Campaign Name'] — buildRawData() maps the
  // source's own "Category Name"/"Campaign Name" columns onto this one field
  // interchangeably) rather than platformName.
  const categoryNames = [...new Set(rows.map(r => r['Campaign Name']).filter(Boolean))].sort();
  const groups = categoryNames.map(c => ({label: c, match: r => r['Campaign Name'] === c}));
  if(rows.some(r => !r['Campaign Name'])) groups.push({label: '(Blank)', match: r => !r['Campaign Name']});
  const out = [];
  for(const g of groups){
    const sub = rows.filter(g.match);
    const obj = {'Category Name': g.label}; let total = 0;
    for(const st of STATUSES){
      // CONVERTED gate: CM-presence, not leadStatus (per 2026-07-29 rule).
      // Non-converted rows carry CM='N/A' — exclude those. And any lead with a
      // CM is removed from every other leadStatus bucket.
      const filtered = st === 'CONVERTED'
        ? sub.filter(r => isConvertedLead(r))
        : sub.filter(r => r.leadStatus===st && !isConvertedLead(r));
      const pool = applyMonthMode(filtered, anyMonthCol(st), mode);
      obj[st] = pool.length; total += pool.length;
    }
    obj.Total = total;
    obj.LCR = total>0 ? obj.CONVERTED/total : 0;
    out.push(obj);
  }
  const gt = buildGrandTotalRow('Category Name', 'Grand Total', STATUSES, out, 'Total');
  gt.LCR = null;
  out.push(gt);
  return out;
}

function landingPageStatusBreakdown(){
  const mode = STATE.lpTableMode || 'All';
  let rows = applyRefColdFilter(STATE.raw);
  if(STATE.lpTeamFilter !== 'All') rows = rows.filter(r => r.Team === STATE.lpTeamFilter);
  // `!== null` (not `.length`): a real empty array means the user
  // deselected every option and the table should show nothing, not fall
  // back to unfiltered. null-only means "not yet initialized by the
  // renderer" and is treated as no filter.
  if(STATE.lpCampaignFilter !== null)
    rows = rows.filter(r => STATE.lpCampaignFilter.includes(r['Campaign Name']));
  if(STATE.lpLandingPages !== null)
    rows = rows.filter(r => STATE.lpLandingPages.includes(r.landingPage || '(Blank)'));

  // Group by landingPage — every row lands in exactly one bucket so grand total reconciles
  const lpMap = new Map();
  for(const r of rows){
    const lp = r.landingPage || '';
    if(!lpMap.has(lp)) lpMap.set(lp, []);
    lpMap.get(lp).push(r);
  }
  const sortedLPs = [...lpMap.keys()].sort((a,b)=>{
    if(a==='' && b!=='') return 1;
    if(a!=='' && b==='') return -1;
    return a.localeCompare(b);
  });

  const out = [];
  for(const lp of sortedLPs){
    const sub = lpMap.get(lp);
    const campCounts = {};
    for(const r of sub){ const c = r['Campaign Name']||''; campCounts[c] = (campCounts[c]||0)+1; }
    const campaign = Object.entries(campCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
    const obj = {'Landing Page': lp || '(Blank)', 'Campaign': campaign || '(Blank)'}; let total = 0;
    for(const st of STATUSES){
      // CONVERTED gate: CM-presence, not leadStatus (per 2026-07-29 rule).
      // Non-converted rows carry CM='N/A' — exclude those. And any lead with a
      // CM is removed from every other leadStatus bucket.
      const filtered = st === 'CONVERTED'
        ? sub.filter(r => isConvertedLead(r))
        : sub.filter(r => r.leadStatus===st && !isConvertedLead(r));
      const pool = applyMonthMode(filtered, anyMonthCol(st), mode);
      obj[st] = pool.length; total += pool.length;
    }
    obj.Total = total;
    obj.LCR  = total>0 ? obj.CONVERTED/total : 0;
    obj.QLCR = total>0 ? ((obj.CONVERTED||0)+(obj['IN PROCESS']||0))/total : 0;
    out.push(obj);
  }
  const gt = buildGrandTotalRow('Landing Page', 'Grand Total', STATUSES, out, 'Total');
  gt.Campaign = '';
  gt.LCR = null;
  gt.QLCR = null;
  out.push(gt);
  return out;
}

// FIXED_TEAMS in order, then any other team found in `rows`, so a team missing
// from FIXED_TEAMS still gets a row instead of its leads disappearing.
function teamsForRows(rows, teamOf){
  const teams = FIXED_TEAMS.slice();
  const seen = new Set(teams);
  for(const r of rows){
    const t = teamOf(r);
    if(t && !seen.has(t)){ seen.add(t); teams.push(t); }
  }
  return teams;
}

// The status column a lead is counted under and the month that anchors it
// (CM for CONVERTED, LPM for IN PROCESS, CTM otherwise), or null for a status
// the dashboard doesn't know.
function statusBucketOf(r){
  const st = isConvertedLead(r) ? 'CONVERTED' : r.leadStatus;
  if(!STATUSES.includes(st)) return null;
  return { status: st, month: r[st === 'CONVERTED' ? 'CM' : statusMonthCol(st)] };
}

// Status columns for one group of leads. Total Leads is the sum of the status
// columns (every lead with a status event in the selected months), so a row
// always adds up and Conv. Rate stays <= 100%. `Created` is the created-in-
// period count, kept for the footnote under the matrix.
function statusColumnsFor(rows){
  const o = {};
  let total = 0, created = 0;
  for(const st of STATUSES) o[st] = 0;
  for(const r of rows){
    if(monthFilter(r.CTM)) created++;
    const b = statusBucketOf(r);
    if(b && monthFilter(b.month)){ o[b.status]++; total++; }
  }
  o['Total Leads'] = total;
  o.Created = created;
  o['Conv. Rate'] = total>0 ? o.CONVERTED/total : 0;
  return o;
}

function teamOfMode(mode){
  return mode === 'first' ? firstRmTeam : (r => r.Team || 'SV');
}

function teamPerformance(){
  const base = applyRefColdFilter(STATE.raw);
  const teamOf = teamOfMode(STATE.teamPerfMode);
  const teams = teamsForRows(base, teamOf);

  const byTeam = new Map(teams.map(t => [t, []]));
  for(const r of base) byTeam.get(teamOf(r)).push(r);

  const out = teams.map(team => ({Team: team, ...statusColumnsFor(byTeam.get(team))}));
  const gt = buildGrandTotalRow('Team', 'Grand Total', [...STATUSES, 'Total Leads', 'Created'], out);
  gt['Conv. Rate'] = gt['Total Leads']>0 ? gt.CONVERTED/gt['Total Leads'] : 0;
  out.push(gt);
  return out;
}

// Per-RM drill-down for the Team Performance Matrix's Team filter: same
// status columns as teamPerformance(), one row per RM in the selected team.
// RMs are grouped by canonical name so spelling variants share one row.
function teamPerformanceByRM(team){
  const base = applyRefColdFilter(STATE.raw);
  const useFirst = STATE.teamPerfMode === 'first';
  const rmField = useFirst ? 'firstRmName' : 'currentRmName';
  const teamOf = teamOfMode(STATE.teamPerfMode);
  const teamRows = base.filter(r => teamOf(r) === team);
  const keyOf = name => normalizeNameKey(mapRM(name)) || '(unassigned)';

  // RM roster: everyone in EMPLOYEE_REF for this team, plus any RM appearing
  // in teamRows but missing from EMPLOYEE_REF, so no lead is silently dropped.
  const groups = new Map();   // key -> { name, rows }
  const ensure = (key, name) => {
    if(!groups.has(key)) groups.set(key, { name, rows: [] });
    return groups.get(key);
  };
  for(let i=1;i<STATE.empref.length;i++){
    const er = STATE.empref[i]; if(!er) continue;
    if((er[1]||'').toString().trim() === team){
      const nm = cleanName(er[2]);
      if(nm) ensure(keyOf(nm), nm);
    }
  }
  for(const r of teamRows){
    const nm = cleanName(r[rmField]);
    ensure(keyOf(nm), mapRM(nm) || '(unassigned)').rows.push(r);
  }

  const out = [...groups.values()].map(g => ({RM: g.name, ...statusColumnsFor(g.rows)}))
    .sort((a,b) => b['Total Leads'] - a['Total Leads']);

  const gt = buildGrandTotalRow('RM', team+' Total', [...STATUSES, 'Total Leads', 'Created'], out);
  gt['Conv. Rate'] = gt['Total Leads']>0 ? gt.CONVERTED/gt['Total Leads'] : 0;
  out.push(gt);
  return out;
}

function rmTransferData(){
  let base = applyRefColdFilter(STATE.raw);
  base = base.filter(r => monthFilter(r.CTM));

  const transfers = [];
  for(const r of base){
    const firstRm = (r.firstRmName || '').trim();
    const currentRm = (r.currentRmName || '').trim();
    if(!firstRm && !currentRm) continue;
    if(normalizeNameKey(mapRM(firstRm)) === normalizeNameKey(mapRM(currentRm))) continue;
    const firstTeam = firstRmTeam(r);
    const currentTeam = r.Team || 'SV';
    transfers.push({ firstRm: firstRm || '(blank)', firstTeam, currentRm: currentRm || '(blank)', currentTeam, campaign: r['Campaign Name'] || '(Blank)', status: r.leadStatus || '(Unknown)' });
  }

  const teamSummary = {};
  for(const t of transfers){
    if(!teamSummary[t.firstTeam]) teamSummary[t.firstTeam] = {team: t.firstTeam, total: 0, destinations: {}, details: []};
    teamSummary[t.firstTeam].total++;
    teamSummary[t.firstTeam].destinations[t.currentTeam] = (teamSummary[t.firstTeam].destinations[t.currentTeam] || 0) + 1;
    teamSummary[t.firstTeam].details.push(t);
  }

  for(const team of Object.values(teamSummary)){
    const grouped = {};
    for(const d of team.details){
      const key = d.firstRm+'|'+d.campaign+'|'+d.currentRm+'|'+d.status;
      if(!grouped[key]) grouped[key] = {firstRm:d.firstRm, campaign:d.campaign, currentRm:d.currentRm, currentTeam:d.currentTeam, status:d.status, count:0};
      grouped[key].count++;
    }
    team.detailRows = Object.values(grouped).sort((a,b) => b.count - a.count);
  }

  const result = [];
  for(const t of FIXED_TEAMS){ if(teamSummary[t]) result.push(teamSummary[t]); }
  for(const k of Object.keys(teamSummary)){ if(!FIXED_TEAMS.includes(k)) result.push(teamSummary[k]); }
  return {teams: result, totalTransfers: transfers.length};
}

// Same base population as rmTransferData() (Ref+Cold/Status/Lead Head all
// apply — Month is deliberately handled differently, see
// rmTransferMonthMatch below). Every row falls into exactly one of three
// buckets, compared at TEAM level rather than exact-RM level: a lead handed
// from one RM to a teammate still counts as "Same", matching how this is
// tracked outside the app (confirmed 2026-09 against a manual pivot) rather
// than the stricter firstRmName===currentRmName reading.
//   - Same Team: the lead's current Team equals its firstRmName's team
//     (STATE.teamMap) — includes intra-team handoffs between two RMs.
//   - Transferred to SV: current Team is SV and it isn't "Same Team" —
//     covers every generic placeholder currentRmName under that team (e.g.
//     "Support Wealth Manager"), not just a literal currentRmName of "SV".
//   - Transferred to another team: anything else.
const RM_TRANSFER_BUCKETS = ['Same Team', 'Transferred to SV', 'Transferred to another team'];
function rmTransferBucket(r){
  const firstTeam = firstRmTeam(r);
  const currentTeam = r.Team || 'SV';
  if(firstTeam === currentTeam) return 'Same Team';
  return currentTeam === 'SV' ? 'Transferred to SV' : 'Transferred to another team';
}
// "All" months means literally every lead ever (matching how the reference
// pivot this was validated against was built) rather than the FY-scoped
// convention (filteredMonths()) every other month-wise table on this
// dashboard uses — an explicit month selection still filters normally.
function rmTransferMonthMatch(ctm){
  return isAllMonths() ? true : monthFilter(ctm);
}
function rmTransferFilteredBase(){
  let base = applyRefColdFilter(STATE.raw);
  return base.filter(r => rmTransferMonthMatch(r.CTM));
}
// Tallies the three buckets across `rows`, plus a Total and a Retained %
// (Same Team ÷ Total) — the one shared shape used by the overall summary and
// both breakdowns below.
function rmTransferGroupCounts(rows){
  const counts = {}; RM_TRANSFER_BUCKETS.forEach(b => counts[b] = 0);
  for(const r of rows) counts[rmTransferBucket(r)]++;
  const total = rows.length;
  return {...counts, Total: total, 'Retained %': total>0 ? counts['Same Team']/total : 0};
}

function rmTransferSummary(){
  const base = rmTransferFilteredBase();
  const g = rmTransferGroupCounts(base);
  const out = RM_TRANSFER_BUCKETS.map(b => ({label: b, count: g[b], pct: g.Total>0 ? g[b]/g.Total : 0}));
  out.push({label: 'Total', count: g.Total, pct: g.Total>0 ? 1 : 0, _tot: true});
  return out;
}

// Category-wise (Category Name / Campaign Name — e.g. Branding, Corporate,
// Google, Social Media — dynamically read from uploaded data) breakdown of
// the same three buckets.
function rmTransferByCategory(){
  const base = rmTransferFilteredBase();
  const categories = [...new Set(base.map(r => r['Campaign Name']).filter(Boolean))].sort();
  const out = categories.map(cat => ({Category: cat, ...rmTransferGroupCounts(base.filter(r => r['Campaign Name'] === cat))}));
  const gt = buildGrandTotalRow('Category', 'Grand Total', [...RM_TRANSFER_BUCKETS, 'Total'], out);
  gt['Retained %'] = gt.Total>0 ? gt['Same Team']/gt.Total : 0;
  out.push(gt);
  return out;
}

// Team-wise breakdown, grouped by the ORIGINATING team (firstRmName's team
// via EMPLOYEE_REF) — same "From Team" framing as the FirstRM to CurrentRM
// Transfer table above it, and the same FIXED_TEAMS-first ordering.
function rmTransferByTeam(){
  const base = rmTransferFilteredBase();
  const teamOf = firstRmTeam;
  const present = new Set(base.map(teamOf));
  const teams = FIXED_TEAMS.filter(t => present.has(t));
  for(const t of present){ if(!teams.includes(t)) teams.push(t); }
  const out = teams.map(team => ({Team: team, ...rmTransferGroupCounts(base.filter(r => teamOf(r) === team))}));
  const gt = buildGrandTotalRow('Team', 'Grand Total', [...RM_TRANSFER_BUCKETS, 'Total'], out);
  gt['Retained %'] = gt.Total>0 ? gt['Same Team']/gt.Total : 0;
  out.push(gt);
  return out;
}

function campaignByTeam(){
  const refMode = rcFilter(STATE.filterRefCold);
  let base = applyRefColdFilter(STATE.raw);
  base = base.filter(r => monthFilter(r.CTM));

  const cpc = STATE.cost;
  const campaigns = [];
  for(let i=1;i<cpc.length;i++){
    const name = cpc[i][0];
    if(!name) continue;
    if(refMode==='Exclude' && (name==='Referral' || name==='Cold Data')) continue;
    campaigns.push(name);
  }
  // include any extra campaigns that exist in raw but not in CPC
  const knownSet = new Set(campaigns);
  for(const r of base){
    const c = r['Campaign Name'];
    if(c && !knownSet.has(c) && !(refMode==='Exclude' && (c==='Referral'||c==='Cold Data'))){
      campaigns.push(c); knownSet.add(c);
    }
  }

  const useFirst = STATE.campaignTeamMode === 'first';
  const getTeam = teamOfMode(useFirst ? 'first' : 'current');

  const teamSet = new Set(base.map(getTeam));
  const teams = FIXED_TEAMS.filter(t => teamSet.has(t));
  for(const t of teamSet){ if(!teams.includes(t)) teams.push(t); }

  const rows = teams.map(team => {
    const obj = {Team: team}; let total = 0;
    for(const c of campaigns){
      const n = base.filter(r => getTeam(r)===team && r['Campaign Name']===c).length;
      obj[c] = n; total += n;
    }
    obj.Total = total;
    return obj;
  });
  rows.push(buildGrandTotalRow('Team', 'Grand Total', campaigns, rows, 'Total'));
  return {campaigns, rows};
}

function incomeSegment(){
  const rows = applyRefColdFilter(STATE.raw);
  const leadRows = rows.filter(r => monthFilter(r.CTM));
  const convRows = rows.filter(r => isConvertedLead(r, monthFilter));
  const ipRows   = rows.filter(r => r.leadStatus==='IN PROCESS' && !isConvertedLead(r) && monthFilter(r.LPM));
  const preferredOrder = ['Above 20 Lac','15 Lac to 20 Lac','10 Lac to 20 Lac','10 Lac to 15 Lac','5 Lac to 10 Lac','0 to 5 Lac'];
  const preferredSet = new Set(preferredOrder);
  const allBands = new Set(leadRows.map(r => r.annualIncome).filter(v => v && String(v).trim() !== ''));
  const bands = [];
  for(const b of preferredOrder){ if(allBands.has(b)) bands.push(b); }
  for(const b of [...allBands].sort()){ if(!preferredSet.has(b)) bands.push(b); }

  const mkRow = (label, sub, conv, ip, opts={}) => {
    const quality = conv + ip;
    return { 'Income Band': label, Leads: sub, Converted: conv, 'In Process': ip,
      'Quality Leads': quality,
      'Conv. Rate':  sub>0 ? conv/sub    : 0,
      'QLCR':        sub>0 ? quality/sub : 0,
      ...opts };
  };

  const results = bands.map(b => mkRow(
    b,
    leadRows.filter(r => r.annualIncome === b).length,
    convRows.filter(r => r.annualIncome === b).length,
    ipRows.filter(r => r.annualIncome === b).length
  ));

  const blankSub = leadRows.filter(r => !r.annualIncome || String(r.annualIncome).trim()==='').length;
  const blankCon = convRows.filter(r => !r.annualIncome || String(r.annualIncome).trim()==='').length;
  const blankIP  = ipRows.filter(r => !r.annualIncome || String(r.annualIncome).trim()==='').length;
  if(blankSub || blankCon || blankIP) results.push(mkRow('Blank Values', blankSub, blankCon, blankIP, {_blank:true}));

  const totalBandLeads = leadRows.length;
  results.forEach(r => { r['Share %'] = totalBandLeads>0 ? r.Leads/totalBandLeads : 0; });
  return results;
}

function costSummaryByCampaign(){
  const cpc = STATE.cost; const header = cpc[0]||[];
  const monthCols = header.slice(1).map(toMmmYyyy);
  const refMode = rcFilter(STATE.filterRefCold);
  const out = [];
  for(let i=1;i<cpc.length;i++){
    const row = cpc[i]; const name = row[0];
    if(!name || !String(name).trim()) continue;
    let leads = STATE.raw.filter(r => r['Campaign Name']===name && dashboardRowMatch(r) && monthFilter(r.CTM)).length;
    let qual  = STATE.raw.filter(r => r['Campaign Name']===name && dashboardRowMatch(r) && (isConvertedLead(r, monthFilter) || (r.leadStatus==='IN PROCESS' && !isConvertedLead(r) && monthFilter(r.LPM)))).length;
    let conv  = STATE.raw.filter(r => r['Campaign Name']===name && dashboardRowMatch(r) && isConvertedLead(r, monthFilter)).length;
    const cost = effectiveMonths().reduce((s,m) => { const idx=monthCols.indexOf(m); return s + (idx>=0?(Number(row[idx+1])||0):0); }, 0);
    if(refMode==='Exclude' && (name==='Referral' || name==='Cold Data')){ leads = 0; qual = 0; conv = 0; }
    const cpl  = leads>0 ? cost/leads : 0;
    const cpql = qual>0  ? cost/qual  : 0;
    const cac  = conv>0  ? cost/conv  : 0;
    out.push({Campaign:name, Leads:leads, 'Cost (₹)':cost, 'CPL (₹)':cpl, 'Quality Leads':qual, 'CPQL (₹)':cpql, 'Converted Leads':conv, 'CAC (₹)':cac});
  }
  const gt = buildGrandTotalRow('Campaign', 'Grand Total', ['Leads', 'Cost (₹)', 'Quality Leads', 'Converted Leads'], out);
  gt['CPL (₹)']  = gt.Leads>0 ? gt['Cost (₹)']/gt.Leads : 0;
  gt['CPQL (₹)'] = gt['Quality Leads']>0 ? gt['Cost (₹)']/gt['Quality Leads'] : 0;
  gt['CAC (₹)']  = gt['Converted Leads']>0 ? gt['Cost (₹)']/gt['Converted Leads'] : 0;
  out.push(gt);
  return out;
}

function costPerLeadPerRM(){
  const cpc = STATE.cost; const header = cpc[0]||[];
  const monthCols = header.slice(1).map(toMmmYyyy);
  const refMode = rcFilter(STATE.filterRefCold);

  const costSummary = costSummaryByCampaign();
  const cplMap = {};
  for(const c of costSummary){ if(!c._tot) cplMap[c.Campaign] = c['CPL (₹)']; }

  let scope = STATE.raw;
  if(refMode==='Exclude') scope = scope.filter(r => r['Campaign Name']!=='Referral' && r['Campaign Name']!=='Cold Data');
  scope = scope.filter(r => monthFilter(r.CTM));
  scope = scope.filter(r => r.Team !== 'SV');

  const rms = {};
  for(const r of scope){
    const rm = r.currentRmName || '(unassigned)';
    if(!rms[rm]) rms[rm] = {RM: rm, Team: r.Team||'', Leads:0, Cost:0};
    rms[rm].Leads++;
    rms[rm].Cost += cplMap[r['Campaign Name']] || 0;
  }
  return Object.values(rms).map(o => ({
    Team:o.Team, RM:o.RM, Leads:o.Leads,
    'Cost (₹)': o.Cost, 'CPL (₹)': o.Leads>0?o.Cost/o.Leads:0,
  })).sort((a,b)=> a.Team.localeCompare(b.Team) || b.Leads-a.Leads);
}

function costPerLeadPerRMWithTotals(){
  const refMode = rcFilter(STATE.filterRefCold);
  const costSummary = costSummaryByCampaign();
  const cplMap = {};
  const campaignSet = new Set();
  let totalLeads = 0, totalCost = 0, totalCpl = 0, totalQual = 0;

  for(const row of costSummary){
    const costKey = Object.keys(row).find(k => k.startsWith('Cost '));
    const cplKey = Object.keys(row).find(k => k.startsWith('CPL '));
    if(row._tot){
      totalLeads = row.Leads || 0;
      totalCost = Number(row[costKey]) || 0;
      totalCpl = Number(row[cplKey]) || 0;
      totalQual = row['Quality Leads'] || 0;
    } else {
      campaignSet.add(row.Campaign);
      cplMap[row.Campaign] = Number(row[cplKey]) || 0;
    }
  }

  let scope = STATE.raw;
  if(refMode==='Exclude') scope = scope.filter(r => r['Campaign Name']!=='Referral' && r['Campaign Name']!=='Cold Data');
  scope = scope.filter(r => campaignSet.has(r['Campaign Name']) && dashboardRowMatch(r));

  // Total Leads and Total Cost counted by CTM (Created Month); Quality Leads uses the
  // same event-month logic as the Cost Summary table: CONVERTED by CM, IN PROCESS by LPM.
  const groups = {};
  const ensure = r => {
    const team = r.Team || 'SV';
    const rm = team === 'SV' ? 'SV Team (Collective)' : (r.currentRmName || '(unassigned)');
    const key = team === 'SV' ? 'SV' : team + '|' + rm;
    if(!groups[key]) groups[key] = {Team:team, RM:rm, totalLeads:0, totalCost:0, qualLeads:0};
    return groups[key];
  };
  for(const r of scope.filter(r => monthFilter(r.CTM))){
    const g = ensure(r);
    g.totalLeads++;
    g.totalCost += cplMap[r['Campaign Name']] || 0;
  }
  for(const r of scope){
    if(isConvertedLead(r, monthFilter)) ensure(r).qualLeads++;
    else if(r.leadStatus==='IN PROCESS' && !isConvertedLead(r) && monthFilter(r.LPM)) ensure(r).qualLeads++;
  }

  const rows = Object.values(groups).map(r => ({
    ...r,
    cpl:  r.totalLeads > 0 ? r.totalCost / r.totalLeads : 0,
    cpql: r.qualLeads  > 0 ? r.totalCost / r.qualLeads  : 0,
  })).sort((a,b) => {
    if(a.Team==='SV' && b.Team!=='SV') return 1;
    if(a.Team!=='SV' && b.Team==='SV') return -1;
    return a.Team.localeCompare(b.Team) || b.totalLeads-a.totalLeads;
  });

  rows.push({
    Team:'Grand Total', RM:'',
    totalLeads, totalCost,
    cpl: totalCpl,
    qualLeads: totalQual,
    cpql: totalQual > 0 ? totalCost / totalQual : 0,
    _tot:true,
  });
  return rows;
}

// "All" means every dated lead (no FY window); a selection goes through monthFilter.
function dateSetMonthMatch(m){
  return isAllMonths() ? isValidMonth(m) : monthFilter(m);
}

function inProcessDataset(){
  const base = applyRefColdFilter(STATE.raw);
  const statuses = ['DEAD','ON HOLD','ASSIGNED','RE-ASSIGNED','FOLLOW UP','CONVERTED'];
  const teams = teamsForRows(base, r => r.Team || 'SV');

  const out = teams.map(team => {
    const rows = base.filter(r => (r.Team || 'SV') === team);
    const obj = {Team: team}; let total = 0;
    for(const st of statuses){
      const pool = rows.filter(r => dateSetMonthMatch(r.LPM) && r.leadStatus===st);
      obj[st] = pool.length; total += pool.length;
    }
    obj.Total = total;
    return obj;
  });
  out.push(buildGrandTotalRow('Team', 'Grand Total', statuses, out, 'Total'));
  return {statuses, data: out};
}

// ---- Stagnant In-Process Leads ----
// Every currently-In-Process lead (same rule as everywhere else: leadStatus
// === 'IN PROCESS' AND not already converted by CM-presence) whose
// leadInProcessDate is more than 2 calendar months before today — i.e. it's
// been sitting in that status for over 2 months with no resolution. This is
// a point-in-time operational list (who needs follow-up right now), not a
// historical one, so it deliberately ignores the Month/Ref+Cold/Status/Lead
// Head filters and is always measured against today's real date.
function stagnantInProcessLeads(){
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth()-2, today.getDate());
  const out = [];
  for(const r of STATE.raw){
    if(r.leadStatus !== 'IN PROCESS' || isConvertedLead(r)) continue;
    const d = r.leadInProcessDate;
    if(!d || d==='N/A' || d.length<10) continue;
    const dt = new Date(d);
    if(isNaN(dt.getTime()) || dt >= cutoff) continue;
    const daysStagnant = Math.floor((today - dt) / 86400000);
    out.push({
      clientName: r.clientName || '(blank)',
      currentRmName: r.currentRmName || '(unassigned)',
      // Current RM's team — this section answers "who is sitting on this lead
      // now", so attribution follows the current owner, not whoever first
      // touched it. Leads parked with the Support Wealth Manager pool land in
      // SV, which is where they genuinely are.
      Team: r.Team || 'SV',
      platformName: r.platformName || '',
      campaignName: r['Campaign Name'] || '',
      leadInProcessDate: d.substring(0,10),
      daysStagnant,
    });
  }
  out.sort((a,b) => b.daysStagnant - a.daysStagnant);
  return out;
}

// Overview tiles: total count, plus a severity breakdown (2-3mo / 3-6mo /
// 6mo+) so a glance shows not just how many but how bad.
function stagnantInProcessOverview(leads){
  const b2to3 = leads.filter(l => l.daysStagnant < 90).length;
  const b3to6 = leads.filter(l => l.daysStagnant >= 90 && l.daysStagnant < 180).length;
  const b6plus = leads.filter(l => l.daysStagnant >= 180).length;
  const avgDays = leads.length ? Math.round(leads.reduce((s,l)=>s+l.daysStagnant,0)/leads.length) : 0;
  const oldestDays = leads.length ? Math.max(...leads.map(l=>l.daysStagnant)) : 0;
  return { total: leads.length, b2to3, b3to6, b6plus, avgDays, oldestDays };
}

// Team-wise breakdown of the same list.
function stagnantInProcessByTeam(leads){
  const present = new Set(leads.map(l => l.Team));
  const teams = FIXED_TEAMS.filter(t => present.has(t));
  for(const t of present){ if(!teams.includes(t)) teams.push(t); }
  const out = teams.map(team => {
    const rows = leads.filter(l => l.Team === team);
    const avgDays = rows.length ? Math.round(rows.reduce((s,l)=>s+l.daysStagnant,0)/rows.length) : 0;
    return { Team: team, Count: rows.length, 'Avg Days Stagnant': avgDays };
  });
  const total = leads.length;
  const totalAvg = total ? Math.round(leads.reduce((s,l)=>s+l.daysStagnant,0)/total) : 0;
  out.push({ Team: 'Grand Total', Count: total, 'Avg Days Stagnant': totalAvg, _tot: true });
  return out;
}

// Team-wise reconciliation table: Total Leads / Total In-Process / Stagnant
// In-Process, plus what share of each denominator the stagnant count is.
// Deliberately built as three strictly nested pools over the SAME base
// STATE.raw rows (Total Leads ⊇ Total In-Process ⊇ Stagnant In-Process),
// each just adding one more condition on top of the last — that nesting is
// what guarantees Stagnant ≤ In-Process ≤ Total for every team and that
// every team row sums to the Grand Total row, with no separate "top-down"
// vs "bottom-up" pass to reconcile. Ignores every dashboard filter, same as
// the rest of the Stagnant In-Process section — this is a real-time
// operational snapshot, not a historical/filtered one.
function stagnantInProcessTeamSummary(){
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth()-2, today.getDate());

  const allLeads = STATE.raw;
  const inProcessLeads = allLeads.filter(r => r.leadStatus === 'IN PROCESS' && !isConvertedLead(r));
  const stagnantLeads = inProcessLeads.filter(r => {
    const d = r.leadInProcessDate;
    if(!d || d==='N/A' || d.length<10) return false;
    const dt = new Date(d);
    return !isNaN(dt.getTime()) && dt < cutoff;
  });

  // Current RM's team — matches stagnantInProcessLeads() above, so this table
  // and the By Team/By Client tables never disagree about which team a given
  // lead belongs to.
  const teamOf = r => r.Team || 'SV';
  const present = new Set([...allLeads.map(teamOf), ...inProcessLeads.map(teamOf), ...stagnantLeads.map(teamOf)]);
  const teams = FIXED_TEAMS.filter(t => present.has(t));
  for(const t of present){ if(!teams.includes(t)) teams.push(t); }

  const countBy = (rows, team) => rows.filter(r => teamOf(r) === team).length;

  const out = teams.map(team => {
    const totalLeads = countBy(allLeads, team);
    const totalInProcess = countBy(inProcessLeads, team);
    const stagnant = countBy(stagnantLeads, team);
    return {
      Team: team,
      'Total Leads': totalLeads,
      'Total In-Process Leads': totalInProcess,
      'Stagnant In-Process Leads': stagnant,
      '% Stagnant of In-Process': totalInProcess>0 ? stagnant/totalInProcess : 0,
      '% Stagnant of Total Leads': totalLeads>0 ? stagnant/totalLeads : 0,
    };
  });

  const gtTotalLeads = allLeads.length;
  const gtInProcess = inProcessLeads.length;
  const gtStagnant = stagnantLeads.length;
  out.push({
    Team: 'Grand Total',
    'Total Leads': gtTotalLeads,
    'Total In-Process Leads': gtInProcess,
    'Stagnant In-Process Leads': gtStagnant,
    '% Stagnant of In-Process': gtInProcess>0 ? gtStagnant/gtInProcess : 0,
    '% Stagnant of Total Leads': gtTotalLeads>0 ? gtStagnant/gtTotalLeads : 0,
    _tot: true,
  });
  return out;
}

// Landing pages under the BTL Marketing platform are run by three people;
// the owner is encoded as a "-D"/"-H"/"-S" suffix in the landing page name.
function workshopOwnerForLandingPage(lp){
  const s = (lp || '').toString();
  if(s.includes('-D')) return 'Devanshi';
  if(s.includes('-H')) return 'Himanshi';
  if(s.includes('-S')) return 'Shreya';
  return 'Unclassified';
}

function workshopStatusDistribution(){
  const rows = applyRefColdFilter(STATE.raw).filter(r => r.platformName === 'BTL Marketing');
  const owners = ['Devanshi','Himanshi','Shreya','Unclassified'];
  const out = owners.map(owner => {
    const subset = rows.filter(r => workshopOwnerForLandingPage(r.landingPage) === owner);
    const obj = {Person: owner}; let total = 0;
    for(const st of STATUSES){
      const pool = st === 'CONVERTED'
        ? subset.filter(r => isConvertedLead(r, monthFilter))
        : subset.filter(r => r.leadStatus===st && !isConvertedLead(r) && monthFilter(r[statusMonthCol(st)]));
      obj[st] = pool.length; total += pool.length;
    }
    obj.Total = total;
    obj['Lead Conversion Rate'] = total>0 ? (obj.CONVERTED||0)/total : 0;
    obj['Quality Lead Rate']    = total>0 ? ((obj.CONVERTED||0)+(obj['IN PROCESS']||0))/total : 0;
    return obj;
  }).filter(r => r.Total > 0 || r.Person !== 'Unclassified');
  const gt = buildGrandTotalRow('Person', 'Grand Total', STATUSES, out, 'Total');
  gt['Lead Conversion Rate'] = gt.Total>0 ? (gt.CONVERTED||0)/gt.Total : 0;
  gt['Quality Lead Rate']    = gt.Total>0 ? ((gt.CONVERTED||0)+(gt['IN PROCESS']||0))/gt.Total : 0;
  out.push(gt);
  return out;
}

// ---- BD Performance (BD Accountability Tracker) ----
// Team is the primary grouping (mirrors the main dashboard's Team Performance
// Matrix): default view = one row per team; selecting a team in the Team
// filter drills down to one row per RM within it. Person (which BD rep
// sourced the lead) and Month are independent filters layered on top.
//
// Only dateAssigned/email/gmeetJoined come from the tracker itself — every
// other field (Stage, RM, Team, Month) is sourced from the matching B2C
// record. Each lead is matched by email (BD tracker) <-> userId (B2C) —
// userId is a misleadingly-named field that is actually the client's email,
// and is unique across B2C (verified: 0 duplicates in a 12k+ row export). A
// lead with no match (not yet in the CRM, or an email typo) has no B2C data
// to draw on: it gets a team row of its own, BD_NOT_IN_CRM, instead of being
// folded into SV; it shows the status the BD rep logged in the tracker
// (there is no CRM status to offer); and its Month falls back to the
// tracker's own Date Assigned. See annotateBDWithB2CMatch() in app-state.js,
// which sets effectiveStage/effectiveRM/effectiveTeam/effectiveMonth/
// crmMatched on every STATE.bd row once at load time.
//
// The tracker can list the same client more than once (logged twice by one
// rep, or by two reps), so every lead-level view counts DISTINCT clients, not
// rows — see bdLatestEntries(). Call Flow is the one exception: it counts
// assignments (a lead handed to a rep in a month), so it stays row-based.
const BD_NOT_IN_CRM = 'Not in CRM';
const B2C_STATUS_TO_BD_STAGE = {
  'ASSIGNED': 'LEAD ASSIGNED',
  'RE-ASSIGNED': 'LEAD ASSIGNED',
  'FOLLOW UP': 'IN FOLLOW-UP',
  'IN PROCESS': 'IN PROCESS',
  'CONVERTED': 'CONVERTED',
  'ON HOLD': 'ON HOLD/DEAD',
  'DEAD': 'ON HOLD/DEAD',
};
// B2C has no equivalent of the BD-specific DROPPED / TAX FILING DONE stages —
// those can no longer occur now that Stage is B2C-sourced only.
function bdStageFromB2C(b2cRow){
  // CM-presence rule (isConvertedLead) takes priority over leadStatus, same
  // as everywhere else in this dashboard — a lead with a CM is CONVERTED
  // even if leadStatus says something else.
  if(isConvertedLead(b2cRow)) return 'CONVERTED';
  return B2C_STATUS_TO_BD_STAGE[b2cRow.leadStatus] || '';
}
function buildB2CEmailIndex(){
  const idx = {};
  for(const r of STATE.raw){
    const email = (r.userId||'').toString().trim().toLowerCase();
    if(!email) continue;
    // Same email on a Primary and a Secondary row: the Primary row wins.
    const prev = idx[email];
    if(!prev || !(prev.leadHead === 'Primary' && r.leadHead !== 'Primary')) idx[email] = r;
  }
  return idx;
}

// Union with bdCalls (BD Daily Log) so the shared Month/Person dropdowns at
// the top of the tab cover every BD rep/month either data source has, even
// on a date the tracker itself has no leads for yet (the daily log tends to
// run a few days ahead of the tracker/B2C data for "today").
function bdPersonList(){
  const fromTracker = STATE.bd.map(r => r.person);
  const fromCalls = STATE.bdCalls.map(r => r.bdName);
  return [...new Set([...fromTracker, ...fromCalls].filter(Boolean))].sort();
}
function bdTeamList(){
  const present = new Set(STATE.bd.map(r => r.effectiveTeam));
  const teams = FIXED_TEAMS.filter(t => present.has(t));
  // Not in CRM sits after the real teams. Any other team value that isn't in
  // FIXED_TEAMS is appended too, so no row can silently drop out of the table
  // and leave the Grand Total short of the Total.
  if(present.has(BD_NOT_IN_CRM)) teams.push(BD_NOT_IN_CRM);
  for(const t of present){ if(t && !teams.includes(t)) teams.push(t); }
  return teams;
}
function bdMonthList(){
  const fromTracker = STATE.bd.map(r => r.effectiveMonth);
  const fromCalls = STATE.bdCalls.map(r => toMmmYyyy(r.date));
  return sortMonths([...new Set([...fromTracker, ...fromCalls].filter(Boolean))]);
}
function isAllBdMonths(){
  const f = STATE.bdMonthFilter;
  return !f || f === 'All' || (Array.isArray(f) && f.length === 0);
}
function bdMonthMatch(m){
  if(isAllBdMonths()) return true;
  const f = STATE.bdMonthFilter;
  return Array.isArray(f) ? f.includes(m) : m === f;
}
function isAllBdTeams(){
  const f = STATE.bdTeamFilter;
  return !f || f === 'All' || (Array.isArray(f) && f.length === 0);
}
function bdTeamMatch(team){
  if(isAllBdTeams()) return true;
  const f = STATE.bdTeamFilter;
  return Array.isArray(f) ? f.includes(team) : team === f;
}
function isAllBdPersons(){
  const f = STATE.bdPersonFilter;
  return !f || f === 'All' || (Array.isArray(f) && f.length === 0);
}
function bdPersonMatch(person){
  if(isAllBdPersons()) return true;
  const f = STATE.bdPersonFilter;
  return Array.isArray(f) ? f.includes(person) : person === f;
}
function bdPlatformList(){
  return [...new Set(STATE.bd.map(r => r.effectivePlatform).filter(Boolean))].sort();
}
function isAllBdPlatforms(){
  const f = STATE.bdPlatformFilter;
  return !f || f === 'All' || (Array.isArray(f) && f.length === 0);
}
function bdPlatformMatch(platform){
  if(isAllBdPlatforms()) return true;
  const f = STATE.bdPlatformFilter;
  return Array.isArray(f) ? f.includes(platform) : platform === f;
}
// Which stage classification the Workpoint Status / BD Team Status toggle
// currently selects — shared by the Team/RM Breakdown table and the Current
// Stage chart (NOT the GMeet-vs-In Process table, which always reads
// currentStage regardless of the toggle).
function bdActiveStageField(){
  return STATE.bdStatusSource === 'bdteam' ? 'currentStage' : 'effectiveStage';
}
// Every filter except GMeet — shared base for the table/Stage chart (which
// add the GMeet click-filter on top) and the GMeet-vs-Conversion correlation
// table (which deliberately does NOT apply it, since collapsing to a single
// GMeet state would defeat a table whose whole point is comparing all three).
function bdFilteredRowsBase(){
  return bdLatestEntries(bdScopedRows());
}

// Every tracker ENTRY inside the current Month/Team/Person/Platform scope — a
// client logged twice appears twice. Use bdFilteredRowsBase() for client
// counts; this is only for callers that must dedupe at their own level.
function bdScopedRows(){
  return STATE.bd.filter(r =>
    bdMonthMatch(r.effectiveMonth) && bdTeamMatch(r.effectiveTeam) && bdPersonMatch(r.person) &&
    bdPlatformMatch(r.effectivePlatform)
  );
}

const bdClientKey = r => (r.email || '').toString().trim().toLowerCase();

// One entry per client. The tracker can list the same email more than once —
// a lead logged twice by one rep, or by two reps — so counting rows
// double-counts the client. Keeps the MOST RECENT entry (latest Date Assigned;
// the later row on a tie) so Stage and GMeet reflect where the client stands
// now, the same "current owner" principle the Team/RM already follow.
//
// Applied within whatever scope the caller passes, so filtered to a rep you see
// the distinct clients THAT rep logged, and with no rep filter every client
// counts once overall. A row with no email can't be told apart from another,
// so each one stands as its own client.
function bdLatestEntries(rows){
  const latest = new Map();
  for(const r of rows){
    const k = bdClientKey(r);
    if(!k) continue;
    const cur = latest.get(k);
    if(!cur || toIsoDate(r.dateAssigned) >= toIsoDate(cur.dateAssigned)) latest.set(k, r);
  }
  return rows.filter(r => { const k = bdClientKey(r); return !k || latest.get(k) === r; });
}

// ---- Tracker data quality ----
// Describes the tracker sheet itself, so it ignores every filter. Feeds the
// note under the Team/RM table and the "download affected rows" list.
function bdTrackerStats(){
  const byEmail = new Map();
  let blank = 0, notInCrmRows = 0;
  const unmatchedKeys = new Set();
  for(const r of STATE.bd){
    const k = bdClientKey(r);
    if(!k){ blank++; if(!r.crmMatched) notInCrmRows++; continue; }
    if(!byEmail.has(k)) byEmail.set(k, []);
    byEmail.get(k).push(r);
    if(!r.crmMatched){ notInCrmRows++; unmatchedKeys.add(k); }
  }
  let repeatedEmails = 0, duplicateRows = 0, byTwoReps = 0;
  for(const v of byEmail.values()){
    if(v.length < 2) continue;
    repeatedEmails++;
    duplicateRows += v.length - 1;
    if(new Set(v.map(r => r.person)).size > 1) byTwoReps++;
  }
  return {
    rows: STATE.bd.length,
    clients: byEmail.size + blank,       // blank-email rows can't be merged
    repeatedEmails, duplicateRows, byTwoReps, blank,
    notInCrmRows,                        // rows with no B2C match (incl. blank email)
    notInCrmClients: unmatchedKeys.size + blank,
  };
}

// Every tracker row involved in one of the three problems, flagged with
// whether it made it into the counts — what the BD team needs to clean the
// sheet.
function bdTrackerIssueRows(){
  const counted = new Set(bdLatestEntries(STATE.bd));
  const byEmail = new Map();
  for(const r of STATE.bd){
    const k = bdClientKey(r);
    if(k){ if(!byEmail.has(k)) byEmail.set(k, []); byEmail.get(k).push(r); }
  }
  const line = (issue, r, inCounts) => ({
    // String(): a stray number (e.g. a phone no. typed in the Email column) is a real value here
    Issue: issue, 'BD Rep': r.person || '', Sheet: r.sourceSheet || '', Email: String(r.email == null ? '' : r.email),
    'Date Assigned': toIsoDate(r.dateAssigned) || '', 'Current Stage': r.currentStage || '',
    'GMeet Joined': r.gmeetJoined || '', 'In the counts?': inCounts,
  });
  const out = [];
  for(const v of byEmail.values()){
    if(v.length < 2) continue;
    for(const r of v) out.push(line('Duplicate email', r,
      counted.has(r) ? 'Yes — most recent entry' : 'No — repeat entry'));
  }
  for(const r of STATE.bd){
    if(!bdClientKey(r)) out.push(line('No email', r, 'Yes — as its own client'));
    else if(!r.crmMatched) out.push(line('Not in CRM', r,
      counted.has(r) ? 'Yes — under Not in CRM' : 'No — repeat entry'));
  }
  const order = {'Duplicate email': 0, 'Not in CRM': 1, 'No email': 2};
  out.sort((a, b) => order[a.Issue] - order[b.Issue] ||
    a.Email.localeCompare(b.Email) || a['Date Assigned'].localeCompare(b['Date Assigned']));
  return out;
}

// Same {headline, detail, fix} shape as the other data guards; null when the
// tracker is clean.
function bdTrackerIssueReport(){
  const s = bdTrackerStats();
  if(!s.duplicateRows && !s.notInCrmRows && !s.blank) return null;
  const f = fmtIN;
  const detail = [];
  if(s.duplicateRows) detail.push(
    f(s.duplicateRows) + ' row' + (s.duplicateRows===1?'':'s') + ' repeat a client already listed ('
    + f(s.repeatedEmails) + ' email' + (s.repeatedEmails===1?'':'s') + (s.byTwoReps ? '; ' + f(s.byTwoReps)
    + ' logged by two different reps' : '') + ') — each client is counted once, using their most recent entry');
  if(s.notInCrmRows) detail.push(
    f(s.notInCrmRows) + ' row' + (s.notInCrmRows===1?'':'s') + ' ('
    + f(s.notInCrmClients) + ' client' + (s.notInCrmClients===1?'':'s')
    + ') have no match in B2C and show as “' + BD_NOT_IN_CRM + '” with the status logged in the tracker');
  if(s.blank) detail.push(f(s.blank) + ' row' + (s.blank===1?'':'s') + ' ha' + (s.blank===1?'s':'ve')
    + ' no email, so can’t be matched or de-duplicated');
  return {
    headline: f(s.rows) + ' tracker rows = ' + f(s.clients) + ' distinct clients',
    detail: detail.join('. ') + '.',
    fix: 'In the tracker sheet: delete repeat rows, correct typo’d or blank emails, and make sure each client '
       + 'exists in B2C. “Download affected rows” lists every row involved.',
  };
}
// The GMeet filter is set by clicking a pie slice (see renderBDGmeetChart)
// rather than a dropdown — it folds into the same filtered scope as
// Month/Team/Person/Platform, so a click cascades to the Current Stage
// chart and the table too.
function bdFilteredRows(){
  return bdFilteredRowsBase().filter(r =>
    STATE.bdGmeetFilter === 'All' || r.gmeetJoined === STATE.bdGmeetFilter
  );
}

// stageField picks which stage classification to tally: 'effectiveStage'
// (Workpoint Status — B2C-derived, current CRM ownership/status) or
// 'currentStage' (BD Team Status — the tracker's own self-reported stage,
// as logged by the BD rep). See the toggle in renderBDPerformance().
//
// "Not Logged" catches every row whose stageField value isn't one of the 7
// BD_STAGES — under Workpoint Status that's leads with no B2C match at all
// (bdStageFromB2C has nothing to resolve); under BD Team Status that's leads
// whose Current Stage cell the BD rep simply hasn't filled in yet. Without
// this bucket those rows still counted toward Total but vanished from every
// stage column, so Total silently didn't equal the sum of the columns —
// same "Not Logged" naming as the GMeet Joined? breakdown in Call Flow, for
// the same reason (a value that was never entered, not a real 8th stage).
function bdSummarize(rows, stageField){
  stageField = stageField || 'effectiveStage';
  const obj = {};
  for(const st of BD_STAGES) obj[st] = rows.filter(r => r[stageField] === st).length;
  obj['Not Logged'] = rows.filter(r => !BD_STAGES.includes(r[stageField])).length;
  obj.Total = rows.length;
  obj['GMeet Joined'] = rows.filter(r => r.gmeetJoined === 'Yes').length;
  obj['Conv. Rate'] = rows.length>0 ? (obj['CONVERTED']||0)/rows.length : 0;
  obj['QL Conv. Rate'] = rows.length>0 ? ((obj['CONVERTED']||0)+(obj['IN PROCESS']||0))/rows.length : 0;
  return obj;
}

// ---- Assigned by BD / Mapped to CRM ----
// "Assigned by BD" is what the BD rep logged: the tracker's Team Leader (-> team)
// and Assigned RM (-> RM). It is separate from the breakdown's other columns,
// which follow live CRM ownership. "Mapped to CRM" is the part of it found in
// the CRM and still held by that team / RM. Both are dated by Date Assigned.
const BD_UNKNOWN_TEAM = 'Team Leader not recognised';
const BD_UNKNOWN_RM = 'Assigned RM not recognised';
const BD_ASSIGN_COLS = ['Assigned by BD', 'Mapped to CRM'];

// False until the backend that reads Team Leader / Assigned RM has synced the
// tracker; the columns are then left out instead of showing everything as unrecognised.
const bdHasAssignment = () => STATE.bd.some(r => r.teamLeader || r.assignedRm);

// Team and RM a tracker row was assigned to ('' when not recognised). Assigned
// RM is free text, often a first name only, so a bare first name is matched
// inside the team.
function resolveBDAssignment(r){
  const asTeam = n => FIXED_TEAMS.find(t => normalizeNameKey(t) === normalizeNameKey(n)) || teamForRmName(n);
  const leader = cleanName(r.teamLeader), rmText = cleanName(r.assignedRm);
  const team = (leader && asTeam(leader)) || (rmText && teamForRmName(rmText)) || '';
  let rm = '';
  if(rmText && team){
    const canon = mapRM(rmText);
    if(teamForRmName(canon)){
      rm = canon;
    } else {
      const first = normalizeNameKey(rmText).split(' ')[0];
      const hits = STATE.empref.slice(1)
        .filter(e => e && (e[1]||'').toString().trim() === team)
        .map(e => cleanName(e[2]))
        .filter(n => normalizeNameKey(n).split(' ')[0] === first);
      if(hits.length === 1) rm = hits[0];
    }
  }
  return { team, rm };
}

// One entry per client, scoped by Date Assigned month, Person, Platform and GMeet
// (not by Team: the team here is the assigned one).
function bdAssignedEntries(){
  return bdLatestEntries(STATE.bd.filter(r =>
    bdMonthMatch(toMmmYyyy(r.dateAssigned)) && bdPersonMatch(r.person) && bdPlatformMatch(r.effectivePlatform)
  )).filter(r => STATE.bdGmeetFilter === 'All' || r.gmeetJoined === STATE.bdGmeetFilter);
}

function bdAssignedCounts(entries, assignedTo, heldBy){
  const mine = entries.filter(assignedTo);
  return {
    'Assigned by BD': mine.length,
    'Mapped to CRM': mine.filter(r => r.crmMatched && heldBy(r)).length,
  };
}

function bdPerformanceByTeam(stageField){
  const rows = bdFilteredRows();
  const assigned = bdAssignedEntries();
  const teams = bdTeamList();
  for(const t of new Set(assigned.map(r => r.assignedTeam))){
    if(t && !teams.includes(t)) teams.push(t);
  }
  const out = teams.map(team => ({
    Team: team,
    ...bdSummarize(rows.filter(r => r.effectiveTeam === team), stageField),
    ...bdAssignedCounts(assigned, r => r.assignedTeam === team, r => r.effectiveTeam === team),
  }));
  if(bdHasAssignment() && assigned.some(r => !r.assignedTeam)){
    out.push({Team: BD_UNKNOWN_TEAM, ...bdSummarize([], stageField),
      ...bdAssignedCounts(assigned, r => !r.assignedTeam, () => false)});
  }
  const gt = buildGrandTotalRow('Team', 'Grand Total', [...BD_STAGES,'Not Logged','Total','GMeet Joined', ...BD_ASSIGN_COLS], out);
  gt['Conv. Rate'] = gt.Total>0 ? (gt['CONVERTED']||0)/gt.Total : 0;
  gt['QL Conv. Rate'] = gt.Total>0 ? ((gt['CONVERTED']||0)+(gt['IN PROCESS']||0))/gt.Total : 0;
  out.push(gt);
  return out;
}

function bdPerformanceByRM(team, stageField){
  const rows = bdFilteredRows().filter(r => r.effectiveTeam === team);
  const assigned = bdAssignedEntries().filter(r => r.assignedTeam === team);
  const key = normalizeNameKey;
  const names = new Map();   // key -> display name; CRM owners first, then RMs only assigned to
  for(const r of rows){ const nm = (r.effectiveRM||'').trim(); if(nm && !names.has(key(nm))) names.set(key(nm), nm); }
  for(const r of assigned){ if(r.assignedRM && !names.has(key(r.assignedRM))) names.set(key(r.assignedRM), r.assignedRM); }
  const out = [...names].map(([k, rm]) => ({
    RM: rm,
    ...bdSummarize(rows.filter(r => key(r.effectiveRM) === k), stageField),
    ...bdAssignedCounts(assigned, r => key(r.assignedRM) === k, r => key(r.effectiveRM) === k),
  })).sort((a,b) => b.Total - a.Total || b['Assigned by BD'] - a['Assigned by BD']);
  if(bdHasAssignment() && assigned.some(r => !r.assignedRM)){
    out.push({RM: BD_UNKNOWN_RM, ...bdSummarize([], stageField),
      ...bdAssignedCounts(assigned, r => !r.assignedRM, () => false)});
  }
  const gt = buildGrandTotalRow('RM', team+' Total', [...BD_STAGES,'Not Logged','Total','GMeet Joined', ...BD_ASSIGN_COLS], out);
  gt['Conv. Rate'] = gt.Total>0 ? (gt['CONVERTED']||0)/gt.Total : 0;
  gt['QL Conv. Rate'] = gt.Total>0 ? ((gt['CONVERTED']||0)+(gt['IN PROCESS']||0))/gt.Total : 0;
  out.push(gt);
  return out;
}

// GMeet Joined? vs In Process — one row per GMeet state (Yes/No/Pending, plus Not Logged), so
// you can see whether actually joining the meeting predicts progress. Always
// sourced from the BD tracker's OWN "Current Stage" column (currentStage),
// per the BD team's self-reported Google Sheet — not the B2C-derived
// effectiveStage — since this table is meant to reflect what BD ops
// themselves logged. Uses bdFilteredRowsBase() (Month/Team/Person/Platform
// only, no GMeet click-filter) since collapsing to one GMeet state would
// defeat the comparison this table exists to show.
const BD_GMEET_STATES = ['Yes','No','Pending'];

// One group per GMeet state, plus Not Logged for the clients with no value
// entered, so the groups always add up to every client in scope.
function bdGmeetGroups(rows){
  return [...BD_GMEET_STATES, 'Not Logged'].map(st => ({
    label: st,
    rows: rows.filter(r => st === 'Not Logged' ? !BD_GMEET_STATES.includes(r.gmeetJoined) : r.gmeetJoined === st),
  }));
}

function bdGmeetCorrelation(){
  const out = bdGmeetGroups(bdFilteredRowsBase()).map(({label, rows: sub}) => {
    const inProcess = sub.filter(r => r.currentStage === 'IN PROCESS').length;
    return {
      'GMeet Joined': label,
      Total: sub.length,
      'In Process': inProcess,
      'In Process Rate': sub.length>0 ? inProcess/sub.length : 0,
    };
  });
  const gtTotal = out.reduce((s,r)=>s+r.Total,0);
  const gtInProcess = out.reduce((s,r)=>s+r['In Process'],0);
  out.push({
    'GMeet Joined': 'Grand Total', Total: gtTotal, 'In Process': gtInProcess,
    'In Process Rate': gtTotal>0 ? gtInProcess/gtTotal : 0,
    _tot: true,
  });
  return out;
}

// GMeet Joined? vs Converted. Converted is read from B2C only: a lead counts
// when its email matched a B2C record that has a Converted Month (the same
// CM-presence rule as everywhere else). A lead with no B2C match has no CRM
// status to read, so it is counted as not converted and reported in Not Matched.
// Same scope as the In Process table: Month/Team/Person/Platform, no GMeet click-filter.
const bdIsConverted = r => !!r.crmMatched && r.effectiveStage === 'CONVERTED';

function bdGmeetConversion(){
  const tally = (label, sub, tot) => {
    const matched = sub.filter(r => r.crmMatched).length;
    const converted = sub.filter(bdIsConverted).length;
    return {
      'GMeet Joined': label, Total: sub.length, Matched: matched, 'Not Matched': sub.length - matched, Converted: converted,
      'Converted Rate': sub.length>0 ? converted/sub.length : 0,
      'Rate of Matched': matched>0 ? converted/matched : 0,
      _tot: tot,
    };
  };
  const rows = bdFilteredRowsBase();
  return [...bdGmeetGroups(rows).map(g => tally(g.label, g.rows, false)), tally('Grand Total', rows, true)];
}

// One line per client behind bdGmeetConversion, for the download: lets anyone
// check a count against the B2C file by email.
function bdGmeetConversionLeads(){
  const b2c = buildB2CEmailIndex();
  const order = ['Yes','No','Pending','Not Logged'];
  const state = r => BD_GMEET_STATES.includes(r.gmeetJoined) ? r.gmeetJoined : 'Not Logged';
  return bdFilteredRowsBase().map(r => {
    const b = b2c[bdClientKey(r)];
    return {
      'BD Rep': r.person || '',
      Email: String(r.email == null ? '' : r.email),
      'Client Name': (b && b.clientName) || '',
      'Date Assigned': toIsoDate(r.dateAssigned) || '',
      'GMeet Joined': state(r),
      'Found in B2C': r.crmMatched ? 'Yes' : 'No',
      'B2C Lead Status': b ? b.leadStatus : '',
      'B2C Converted Month': b && b.CM !== 'N/A' ? b.CM : '',
      'B2C Converted Date': b ? b.convertedDate : '',
      Converted: bdIsConverted(r) ? 'Yes' : 'No',
      Team: r.effectiveTeam || '',
      RM: r.effectiveRM || '',
    };
  }).sort((a, b) => order.indexOf(a['GMeet Joined']) - order.indexOf(b['GMeet Joined']) ||
    a['Found in B2C'].localeCompare(b['Found in B2C']) || a.Email.localeCompare(b.Email));
}

// Per-BD-rep summary joining the two data sources the whole tab is built
// from: Calls Made (BD Daily Log, only Month + Person apply — no Team/
// Platform link, same as everywhere else this sheet is used) and Total
// Leads / GMeet Joined / Converted (tracker + B2C match, full Month/Team/
// Person/Platform scope). The two are correlated by matching the tracker's
// own `person` against the Daily Log's `bdName` — the same join Call Flow
// already relies on (verified there against a real rep's day-by-day count).
// Converted uses effectiveStage (the CM-presence/B2C-derived rule used
// dashboard-wide), NOT currentStage — the tracker's own Current Stage
// column is the BD team's self-reported stage (LEAD ASSIGNED / IN
// FOLLOW-UP / IN PROCESS / DROPPED / TAX FILING DONE / ON HOLD-DEAD) and
// never actually contains the literal value "CONVERTED" in practice, so a
// currentStage-based check here would always read zero.
//
// Conversion Rate = Converted ÷ Total Leads — the same CONVERTED ÷ Total
// definition used dashboard-wide (Team/RM Breakdown, MTD, etc.), not ÷
// Calls Made: Calls Made counts every dial across the month (often
// thousands per rep), so dividing lead-level Converted by it produced a
// misleadingly tiny rate (e.g. 0.1%-0.3%) that didn't read as a real
// conversion rate next to every other rate on this page.
function bdCallsToConversion(){
  const scoped = bdScopedRows();
  const callRows = bdCallsFilteredRows();
  const people = [...new Set([...scoped.map(r=>r.person), ...callRows.map(r=>r.bdName)].filter(Boolean))].sort();

  const tally = leads => ({
    totalLeads: leads.length,
    gmeetJoined: leads.filter(r => r.gmeetJoined === 'Yes').length,
    converted: leads.filter(r => r.effectiveStage === 'CONVERTED').length,
  });

  const out = people.map(person => {
    const calls = callRows.filter(r => r.bdName === person).reduce((s,r) => s + (r.totalCalls||0), 0);
    // Each rep is credited with the distinct clients THEY logged — a client
    // two reps both logged counts for each, since both worked it.
    const t = tally(bdLatestEntries(scoped.filter(r => r.person === person)));
    return {
      Person: person, 'Calls Made': calls, 'Total Leads': t.totalLeads, 'GMeet Joined': t.gmeetJoined, Converted: t.converted,
      'Conversion Rate': t.totalLeads>0 ? t.converted/t.totalLeads : 0,
    };
  });
  const gt = buildGrandTotalRow('Person', 'Grand Total', ['Calls Made','Total Leads','GMeet Joined','Converted'], out);
  // ...but the Grand Total counts each client ONCE, so it can sit below the
  // sum of the rep rows by exactly the clients two reps both logged (see
  // 'sharedByReps' — the renderer prints the footnote).
  const all = tally(bdLatestEntries(scoped));
  gt.sharedByReps = gt['Total Leads'] - all.totalLeads;
  gt['Total Leads'] = all.totalLeads;
  gt['GMeet Joined'] = all.gmeetJoined;
  gt['Converted'] = all.converted;
  gt['Conversion Rate'] = gt['Total Leads']>0 ? gt['Converted']/gt['Total Leads'] : 0;
  out.push(gt);
  return out;
}

// Chart data — both reflect the currently active Month/Team/Person/Platform
// filters via bdFilteredRows(), regardless of whether the table above is
// showing team-level or RM-drilldown rows.
function bdGmeetBreakdown(){
  const rows = bdFilteredRows();
  const counts = {Yes:0, No:0, Pending:0};
  for(const r of rows){ if(Object.prototype.hasOwnProperty.call(counts, r.gmeetJoined)) counts[r.gmeetJoined]++; }
  return counts;
}
function bdStageBreakdown(stageField){
  stageField = stageField || 'effectiveStage';
  const rows = bdFilteredRows();
  const out = {};
  for(const st of BD_STAGES) out[st] = rows.filter(r => r[stageField] === st).length;
  out['Not Logged'] = rows.filter(r => !BD_STAGES.includes(r[stageField])).length;
  return out;
}

// ---- BD Daily Log (Total Calls Made / Calls Connected / CNP) ----
// Independent of the tracker/B2C-matched STATE.bd rows above -- this is raw
// per-rep-per-day call activity from its own sheet, with no lead-level (and
// therefore no Team/Platform) linkage, so it only honors the Month/Person
// filters shared with the rest of the tab.
function bdCallsFilteredRows(){
  return STATE.bdCalls.filter(r => bdMonthMatch(toMmmYyyy(r.date)) && bdPersonMatch(r.bdName));
}

function bdCallsSummarize(rows){
  const totalCalls = rows.reduce((s,r) => s + (r.totalCalls||0), 0);
  const connected = rows.reduce((s,r) => s + (r.callsConnected||0), 0);
  const cnp = rows.reduce((s,r) => s + (r.cnp||0), 0);
  return {
    'Total Calls': totalCalls,
    'Calls Connected': connected,
    'CNP': cnp,
    'Connected %': totalCalls>0 ? connected/totalCalls : 0,
    'CNP %': totalCalls>0 ? cnp/totalCalls : 0,
  };
}

// One row per BD rep, for the table.
function bdCallsByPerson(){
  const rows = bdCallsFilteredRows();
  const people = [...new Set(rows.map(r => r.bdName).filter(Boolean))].sort();
  const out = people.map(person => ({BDName: person, ...bdCallsSummarize(rows.filter(r => r.bdName === person))}));
  const gt = buildGrandTotalRow('BDName', 'Grand Total', ['Total Calls','Calls Connected','CNP'], out);
  gt['Connected %'] = gt['Total Calls']>0 ? gt['Calls Connected']/gt['Total Calls'] : 0;
  gt['CNP %'] = gt['Total Calls']>0 ? gt['CNP']/gt['Total Calls'] : 0;
  out.push(gt);
  return out;
}

// ---- Call → Meeting funnel ----
// Total Calls/Connected/CNP come from the BD Daily Log, which has no
// lead-level link to derive a Team or Platform from, so they honor Month +
// Person only. Meetings Scheduled and the GMeet outcomes come from tracker
// rows carrying the matched lead's Team and Platform, so they honor those too.
// With either set, Meetings ÷ Calls Connected would divide a filtered count
// by an unfiltered one, so meetingPct is null (shown as n/a).
//
// Meetings Scheduled / Joined / Not Joined / Pending all come from the same
// row set -- every lead in the "<Person> Q<N>" tracker sheets whose Date
// Assigned falls in the selected month(s), i.e. every lead handed to that BD
// rep that period counts as a meeting scheduled with them. Joined/Not
// Joined/Pending is simply that same set's GMeet Joined? column, so those
// three always add up exactly to Meetings Scheduled -- verified against the
// real file (Suhani, Sept 2026: 27 leads assigned = 2 Yes + 0 No + 25
// Pending, exactly). This replaced an earlier version that summed the BD
// Daily Log's separate "Appointments Booked" column instead, which turned
// out not to match what the BD team actually means by "meetings scheduled".
//
// Meetings Scheduled vs Calls Connected IS still a cross-source comparison
// (Daily Log vs tracker) and won't line up as cleanly -- see the % label.
const bdLeadFiltersActive = () => !isAllBdTeams() || !isAllBdPlatforms();

function bdFlowTrackerRows(){
  return STATE.bd.filter(r => bdMonthMatch(toMmmYyyy(r.dateAssigned)) && bdPersonMatch(r.person) &&
    bdTeamMatch(r.effectiveTeam) && bdPlatformMatch(r.effectivePlatform));
}

function bdCallFlow(){
  const c = bdCallsSummarize(bdCallsFilteredRows());
  const t = bdFlowTrackerRows();
  const meetings = t.length;
  const joined = t.filter(r => r.gmeetJoined === 'Yes').length;
  const notJoined = t.filter(r => r.gmeetJoined === 'No').length;
  const pending = t.filter(r => r.gmeetJoined === 'Pending').length;
  // A handful of leads have no GMeet Joined? value logged at all (blank, or
  // something that didn't normalize to Yes/No/Pending) -- counting those
  // separately, rather than dropping them, is what makes Joined+NotJoined+
  // Pending+NotLogged equal Meetings Scheduled exactly, always.
  const notLogged = meetings - joined - notJoined - pending;
  return {
    totalCalls: c['Total Calls'],
    connected: c['Calls Connected'],
    cnp: c['CNP'],
    meetings,
    connectedPct: c['Connected %'],
    cnpPct: c['CNP %'],
    meetingPct: bdLeadFiltersActive() ? null : (c['Calls Connected']>0 ? meetings/c['Calls Connected'] : 0),
    joined, notJoined, pending, notLogged,
    joinedPct: meetings>0 ? joined/meetings : 0,
    notJoinedPct: meetings>0 ? notJoined/meetings : 0,
    pendingPct: meetings>0 ? pending/meetings : 0,
    notLoggedPct: meetings>0 ? notLogged/meetings : 0,
  };
}

// Same funnel as a stage-per-row table: each stage's count, what share it is
// of the stage it came from, and which sheet it came from.
function bdCallFlowStages(){
  const f = bdCallFlow();
  return [
    {Stage:'Total Calls Made',    Count:f.totalCalls, Of:'—',                     Pct:null,             Source:'BD Daily Log'},
    {Stage:'↳ Calls Connected',   Count:f.connected,  Of:'of calls made',         Pct:f.connectedPct,   Source:'BD Daily Log'},
    {Stage:'↳ CNP (not picked)',  Count:f.cnp,        Of:'of calls made',         Pct:f.cnpPct,         Source:'BD Daily Log'},
    {Stage:'Meetings Scheduled',  Count:f.meetings,   Of:f.meetingPct===null ? 'n/a — Team/Platform filter applied' : 'of calls connected', Pct:f.meetingPct, Source:'Tracker · Date Assigned'},
    {Stage:'↳ Meeting Joined',    Count:f.joined,     Of:'of meetings scheduled', Pct:f.joinedPct,      Source:'Tracker · GMeet Joined?'},
    {Stage:'↳ Not Joined',        Count:f.notJoined,  Of:'of meetings scheduled', Pct:f.notJoinedPct,   Source:'Tracker · GMeet Joined?'},
    {Stage:'↳ Pending',           Count:f.pending,    Of:'of meetings scheduled', Pct:f.pendingPct,     Source:'Tracker · GMeet Joined?'},
    {Stage:'↳ Not Logged',        Count:f.notLogged,  Of:'of meetings scheduled', Pct:f.notLoggedPct,   Source:'Tracker · GMeet Joined?'},
  ];
}

// Named reconciliation list for why Meetings Scheduled (Call Flow, dated by
// the tracker's own Date Assigned) doesn't always match the Lead-Level
// Detail tables' total (dated by the matched B2C lead's Created Month) for
// the same month selection -- every lead below is one where those two
// month-anchors disagree, so it's counted on one side but not the other.
// Same Person + Team + Platform scoping as Call Flow itself (see
// bdFlowTrackerRows), so this fully accounts for the gap between the two
// totals, not just part of it. Only CRM-matched leads can ever appear here:
// an unmatched lead's effectiveMonth is defined as toMmmYyyy(dateAssigned) (see
// annotateBDWithB2CMatch in app-state.js), so the two checks are identical
// by construction for it and it can never be part of the gap.
function bdMonthMismatchList(){
  const b2cIndex = buildB2CEmailIndex();
  const rows = STATE.bd.filter(r => bdPersonMatch(r.person) && bdTeamMatch(r.effectiveTeam) && bdPlatformMatch(r.effectivePlatform));
  // The entries Lead-Level Detail actually counts: one per client, drawn from
  // the rows whose Created Month is in the selection. A row outside this set
  // is either in the wrong month or a repeat entry of a client counted
  // elsewhere — both explain a gap, so both are named below.
  const counted = new Set(bdLatestEntries(rows.filter(r => bdMonthMatch(r.effectiveMonth))));
  const out = [];
  for(const r of rows){
    const inByAssigned = bdMonthMatch(toMmmYyyy(r.dateAssigned));
    const inByCreated  = bdMonthMatch(r.effectiveMonth);
    const inLeadLevel  = counted.has(r);
    if(inByAssigned === inLeadLevel) continue;
    const email = (r.email || '').toString().trim().toLowerCase();
    const b2cRow = email ? b2cIndex[email] : null;
    out.push({
      'Client Name': (b2cRow && b2cRow.clientName) || '(unknown)',
      Email: r.email || '',
      'BD Rep': r.person || '',
      'Date Assigned (Tracker)': toMmmYyyy(r.dateAssigned) || 'N/A',
      'Created Month (B2C)': r.effectiveMonth || 'N/A',
      'Counted In': inByAssigned ? 'Call Flow only' : 'Lead-Level Detail only',
      // Same month on both sides but not counted in Lead-Level Detail = a
      // repeat entry; otherwise the two month anchors disagree.
      'Why': (inByAssigned && inByCreated)
        ? 'Repeat entry — client counted once in Lead-Level Detail'
        : 'Date Assigned and Created Month fall in different months',
    });
  }
  out.sort((a,b) => a['Counted In'].localeCompare(b['Counted In']) || a['Client Name'].localeCompare(b['Client Name']));
  return out;
}

// One row per month (chronological), for the stacked chart.
function bdCallsByMonth(){
  const rows = bdCallsFilteredRows();
  const months = sortMonths([...new Set(rows.map(r => toMmmYyyy(r.date)).filter(Boolean))]);
  return months.map(m => ({Month: m, ...bdCallsSummarize(rows.filter(r => toMmmYyyy(r.date) === m))}));
}

function convertedDataset(){
  const base = applyRefColdFilter(STATE.raw);
  const statuses = ['DEAD','ON HOLD','ASSIGNED','RE-ASSIGNED','FOLLOW UP','IN PROCESS'];
  const teams = teamsForRows(base, r => r.Team || 'SV');

  const out = teams.map(team => {
    const rows = base.filter(r => (r.Team || 'SV') === team);
    const obj = {Team: team}; let total = 0;
    for(const st of statuses){
      const pool = rows.filter(r => dateSetMonthMatch(r.CM) && r.leadStatus===st);
      obj[st] = pool.length; total += pool.length;
    }
    obj.Total = total;
    return obj;
  });
  out.push(buildGrandTotalRow('Team', 'Grand Total', statuses, out, 'Total'));
  return {statuses, data: out};
}
