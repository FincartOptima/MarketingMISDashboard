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

// ---- BD Performance: tracker <-> B2C matching ----
// A tracker row is matched to its B2C record by email only: tracker Email <-> B2C userId
// (despite the name, the client's email). annotateBDWithB2CMatch() in app-state.js makes
// the match once at load; the BD Performance tab (app-bd2.js) reads the result.
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

const bdClientKey = r => (r.email || '').toString().trim().toLowerCase();

// ---- BD Daily Log (Total Calls Made / Calls Connected / CNP) ----
// Per-rep-per-day call activity from its own sheet, with no lead-level link, so it can
// only be filtered by Month and Person.
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
