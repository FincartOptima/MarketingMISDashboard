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
  if(isAllMonths()) return pool;
  if(mode === 'AnyMonth')  return pool.filter(r => monthFilter(r[anyMonthColName]) && !monthFilter(r.CTM));
  if(mode === 'SameMonth') return pool.filter(r => monthFilter(r[anyMonthColName]) && monthFilter(r.CTM));
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
  const rows = STATE.raw;
  const months = filteredMonths();
  const refMode = STATE.filterRefCold;
  const out = buckets.map(b => {
    const o = {Platform: b.label, total:0};
    months.forEach(m => {
      let c = rows.filter(x => b.match(x) && x.CTM===m && dashboardRowMatch(x)).length;
      if(refMode==='Exclude' && (b.label==='Referral' || b.label==='Cold Leads')) c = 0;
      o[m] = c; o.total += c;
    });
    return o;
  });
  out.push(buildGrandTotalRow('Platform', 'Grand Total', months, out, 'total'));
  return out;
}

function statusByMonth(teamFilter){
  const months = filteredMonths();
  let base = STATE.raw.filter(dashboardRowMatch);
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
  if(STATE.lpCampaignFilter && STATE.lpCampaignFilter !== 'All')
    rows = rows.filter(r => r['Campaign Name'] === STATE.lpCampaignFilter);
  if(STATE.lpLandingPages.length)
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

function teamPerformance(){
  let base = applyRefColdFilter(STATE.raw);
  const teams = FIXED_TEAMS.slice();
  const useFirst = STATE.teamPerfMode === 'first';

  return teams.map(team => {
    const rows = useFirst
      ? base.filter(r => (STATE.teamMap[(r.firstRmName||'').toLowerCase()] || 'SV') === team)
      : base.filter(r => (r.Team || 'SV') === team);
    const totalLeads = rows.filter(r => monthFilter(r.CTM)).length;
    const obj = {Team: team, 'Total Leads': totalLeads};
    for(const st of STATUSES){
      // CONVERTED gate: CM-presence, not leadStatus (per 2026-07-29 rule).
      // Leads with a CM are removed from all other status buckets.
      const pool = st === 'CONVERTED'
        ? rows.filter(r => isConvertedLead(r, monthFilter))
        : rows.filter(r => r.leadStatus===st && !isConvertedLead(r) && monthFilter(r[statusMonthCol(st)]));
      obj[st] = pool.length;
    }
    obj['Conv. Rate'] = totalLeads>0 ? obj.CONVERTED/totalLeads : 0;
    return obj;
  });
}

// Per-RM drill-down for the Team Performance Matrix's Team filter: same
// status columns as teamPerformance(), one row per RM in the selected team
// instead of one row per team.
function teamPerformanceByRM(team){
  const base = applyRefColdFilter(STATE.raw);
  const useFirst = STATE.teamPerfMode === 'first';
  const rmField = useFirst ? 'firstRmName' : 'currentRmName';
  const teamRows = useFirst
    ? base.filter(r => (STATE.teamMap[(r.firstRmName||'').toLowerCase()] || 'SV') === team)
    : base.filter(r => (r.Team || 'SV') === team);

  // RM roster: everyone in EMPLOYEE_REF for this team, plus any RM appearing
  // in teamRows but missing from EMPLOYEE_REF, so no lead is silently dropped.
  const rms = [];
  const seen = new Set();
  for(let i=1;i<STATE.empref.length;i++){
    const er = STATE.empref[i]; if(!er) continue;
    if((er[1]||'').toString().trim() === team){
      const nm = (er[2]||'').toString().trim();
      if(nm && !seen.has(nm.toLowerCase())){ rms.push(nm); seen.add(nm.toLowerCase()); }
    }
  }
  for(const r of teamRows){
    const nm = (r[rmField]||'').toString().trim() || '(unassigned)';
    if(!seen.has(nm.toLowerCase())){ rms.push(nm); seen.add(nm.toLowerCase()); }
  }

  const out = rms.map(rm => {
    const rmRows = teamRows.filter(r => ((r[rmField]||'').toString().trim() || '(unassigned)') === rm);
    const totalLeads = rmRows.filter(r => monthFilter(r.CTM)).length;
    const obj = {RM: rm, 'Total Leads': totalLeads};
    for(const st of STATUSES){
      const pool = st === 'CONVERTED'
        ? rmRows.filter(r => isConvertedLead(r, monthFilter))
        : rmRows.filter(r => r.leadStatus===st && !isConvertedLead(r) && monthFilter(r[statusMonthCol(st)]));
      obj[st] = pool.length;
    }
    obj['Conv. Rate'] = totalLeads>0 ? obj.CONVERTED/totalLeads : 0;
    return obj;
  }).sort((a,b) => b['Total Leads'] - a['Total Leads']);

  const gt = buildGrandTotalRow('RM', team+' Total', [...STATUSES, 'Total Leads'], out);
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
    if(firstRm.toLowerCase() === currentRm.toLowerCase()) continue;
    const firstTeam = STATE.teamMap[firstRm.toLowerCase()] || 'SV';
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

// Same base population as rmTransferData() (Ref+Cold/Status/Lead Head/Month
// filters all apply). Every row falls into exactly one of three buckets:
//   - Same RM: firstRmName === currentRmName (never reassigned).
//   - Transferred to SV: reassigned, and the CURRENT team is SV — this
//     covers every generic placeholder currentRmName under that team (e.g.
//     "Support Wealth Manager"), not just a literal currentRmName of "SV".
//   - Transferred to another RM: reassigned, current team is anything else.
const RM_TRANSFER_BUCKETS = ['Same RM', 'Transferred to SV', 'Transferred to Other RM'];
function rmTransferBucket(r){
  const firstRm = (r.firstRmName || '').trim();
  const currentRm = (r.currentRmName || '').trim();
  if(firstRm.toLowerCase() === currentRm.toLowerCase()) return 'Same RM';
  return (r.Team || 'SV') === 'SV' ? 'Transferred to SV' : 'Transferred to Other RM';
}
function rmTransferFilteredBase(){
  let base = applyRefColdFilter(STATE.raw);
  return base.filter(r => monthFilter(r.CTM));
}
// Tallies the three buckets across `rows`, plus a Total and a Retained %
// (Same RM ÷ Total) — the one shared shape used by the overall summary and
// both breakdowns below.
function rmTransferGroupCounts(rows){
  const counts = {}; RM_TRANSFER_BUCKETS.forEach(b => counts[b] = 0);
  for(const r of rows) counts[rmTransferBucket(r)]++;
  const total = rows.length;
  return {...counts, Total: total, 'Retained %': total>0 ? counts['Same RM']/total : 0};
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
  gt['Retained %'] = gt.Total>0 ? gt['Same RM']/gt.Total : 0;
  out.push(gt);
  return out;
}

// Team-wise breakdown, grouped by the ORIGINATING team (firstRmName's team
// via EMPLOYEE_REF) — same "From Team" framing as the FirstRM to CurrentRM
// Transfer table above it, and the same FIXED_TEAMS-first ordering.
function rmTransferByTeam(){
  const base = rmTransferFilteredBase();
  const teamOf = r => STATE.teamMap[(r.firstRmName||'').toLowerCase()] || 'SV';
  const present = new Set(base.map(teamOf));
  const teams = FIXED_TEAMS.filter(t => present.has(t));
  for(const t of present){ if(!teams.includes(t)) teams.push(t); }
  const out = teams.map(team => ({Team: team, ...rmTransferGroupCounts(base.filter(r => teamOf(r) === team))}));
  const gt = buildGrandTotalRow('Team', 'Grand Total', [...RM_TRANSFER_BUCKETS, 'Total'], out);
  gt['Retained %'] = gt.Total>0 ? gt['Same RM']/gt.Total : 0;
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
  const getTeam = useFirst
    ? r => STATE.teamMap[(r.firstRmName||'').toLowerCase()] || 'SV'
    : r => r.Team || 'SV';

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
  const month = STATE.filterMonth, refMode = STATE.filterRefCold;

  const costSummary = costSummaryByCampaign();
  const cplMap = {};
  for(const c of costSummary){ if(!c._tot) cplMap[c.Campaign] = c['CPL (₹)']; }

  let scope = STATE.raw;
  if(refMode==='Exclude') scope = scope.filter(r => r['Campaign Name']!=='Referral' && r['Campaign Name']!=='Cold Data');
  if(month!=='All') scope = scope.filter(r => r.CTM===month);
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

function inProcessDataset(){
  const month = STATE.filterMonth;
  let base = applyRefColdFilter(STATE.raw);
  const statuses = ['DEAD','ON HOLD','ASSIGNED','RE-ASSIGNED','FOLLOW UP','CONVERTED'];
  const teams = FIXED_TEAMS.slice();

  const out = teams.map(team => {
    const rows = base.filter(r => r.Team === team);
    const obj = {Team: team}; let total = 0;
    for(const st of statuses){
      let pool;
      if(month==='All'){
        pool = rows.filter(r => r.LPM!=='N/A' && r.leadStatus===st);
      } else {
        pool = rows.filter(r => r.LPM===month && r.leadStatus===st);
      }
      obj[st] = pool.length; total += pool.length;
    }
    obj.Total = total;
    return obj;
  });
  out.push(buildGrandTotalRow('Team', 'Grand Total', statuses, out, 'Total'));
  return {statuses, data: out};
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
// to draw on: it's labeled "(Not in CRM)" under team SV, excluded from the
// Stage breakdown, and falls back to the tracker's own Date Assigned for
// Month. See annotateBDWithB2CMatch() in app-state.js, which sets
// effectiveStage/effectiveRM/effectiveTeam/effectiveMonth/crmMatched on
// every STATE.bd row once at load time.
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
    if(email) idx[email] = r;
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
  return FIXED_TEAMS.filter(t => present.has(t));
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
  return STATE.bd.filter(r =>
    bdMonthMatch(r.effectiveMonth) && bdTeamMatch(r.effectiveTeam) && bdPersonMatch(r.person) &&
    bdPlatformMatch(r.effectivePlatform)
  );
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
function bdSummarize(rows, stageField){
  stageField = stageField || 'effectiveStage';
  const obj = {};
  for(const st of BD_STAGES) obj[st] = rows.filter(r => r[stageField] === st).length;
  obj.Total = rows.length;
  obj['GMeet Joined'] = rows.filter(r => r.gmeetJoined === 'Yes').length;
  obj['Conv. Rate'] = rows.length>0 ? (obj['CONVERTED']||0)/rows.length : 0;
  obj['QL Conv. Rate'] = rows.length>0 ? ((obj['CONVERTED']||0)+(obj['IN PROCESS']||0))/rows.length : 0;
  return obj;
}

function bdPerformanceByTeam(stageField){
  const rows = bdFilteredRows();
  const teams = bdTeamList();
  const out = teams.map(team => ({Team: team, ...bdSummarize(rows.filter(r => r.effectiveTeam === team), stageField)}));
  const gt = buildGrandTotalRow('Team', 'Grand Total', [...BD_STAGES,'Total','GMeet Joined'], out);
  gt['Conv. Rate'] = gt.Total>0 ? (gt['CONVERTED']||0)/gt.Total : 0;
  gt['QL Conv. Rate'] = gt.Total>0 ? ((gt['CONVERTED']||0)+(gt['IN PROCESS']||0))/gt.Total : 0;
  out.push(gt);
  return out;
}

function bdPerformanceByRM(team, stageField){
  const rows = bdFilteredRows().filter(r => r.effectiveTeam === team);
  const rms = [...new Set(rows.map(r => (r.effectiveRM||'').trim()).filter(Boolean))];
  const out = rms.map(rm => ({RM: rm, ...bdSummarize(rows.filter(r => (r.effectiveRM||'').trim() === rm), stageField)}))
                 .sort((a,b) => b.Total - a.Total);
  const gt = buildGrandTotalRow('RM', team+' Total', [...BD_STAGES,'Total','GMeet Joined'], out);
  gt['Conv. Rate'] = gt.Total>0 ? (gt['CONVERTED']||0)/gt.Total : 0;
  gt['QL Conv. Rate'] = gt.Total>0 ? ((gt['CONVERTED']||0)+(gt['IN PROCESS']||0))/gt.Total : 0;
  out.push(gt);
  return out;
}

// GMeet Joined? vs In Process — one row per GMeet state (Yes/No/Pending), so
// you can see whether actually joining the meeting predicts progress. Always
// sourced from the BD tracker's OWN "Current Stage" column (currentStage),
// per the BD team's self-reported Google Sheet — not the B2C-derived
// effectiveStage — since this table is meant to reflect what BD ops
// themselves logged. Uses bdFilteredRowsBase() (Month/Team/Person/Platform
// only, no GMeet click-filter) since collapsing to one GMeet state would
// defeat the comparison this table exists to show.
function bdGmeetCorrelation(){
  const rows = bdFilteredRowsBase();
  const states = ['Yes','No','Pending'];
  const out = states.map(st => {
    const sub = rows.filter(r => r.gmeetJoined === st);
    const inProcess = sub.filter(r => r.currentStage === 'IN PROCESS').length;
    return {
      'GMeet Joined': st,
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
// The whole funnel is scoped to Month + Person only (NOT Team/Platform):
// Total Calls/Connected/CNP come from the BD Daily Log, which has no
// lead-level linkage to derive a Team or Platform from, so applying those
// filters to only later stages would silently desync the stages from
// each other.
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
function bdFlowTrackerRows(){
  return STATE.bd.filter(r => bdMonthMatch(toMmmYyyy(r.dateAssigned)) && bdPersonMatch(r.person));
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
    meetingPct: c['Calls Connected']>0 ? meetings/c['Calls Connected'] : 0,
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
    {Stage:'Meetings Scheduled',  Count:f.meetings,   Of:'of calls connected',    Pct:f.meetingPct,     Source:'Tracker · Date Assigned'},
    {Stage:'↳ Meeting Joined',    Count:f.joined,     Of:'of meetings scheduled', Pct:f.joinedPct,      Source:'Tracker · GMeet Joined?'},
    {Stage:'↳ Not Joined',        Count:f.notJoined,  Of:'of meetings scheduled', Pct:f.notJoinedPct,   Source:'Tracker · GMeet Joined?'},
    {Stage:'↳ Pending',           Count:f.pending,    Of:'of meetings scheduled', Pct:f.pendingPct,     Source:'Tracker · GMeet Joined?'},
    {Stage:'↳ Not Logged',        Count:f.notLogged,  Of:'of meetings scheduled', Pct:f.notLoggedPct,   Source:'Tracker · GMeet Joined?'},
  ];
}

// One row per month (chronological), for the stacked chart.
function bdCallsByMonth(){
  const rows = bdCallsFilteredRows();
  const months = sortMonths([...new Set(rows.map(r => toMmmYyyy(r.date)).filter(Boolean))]);
  return months.map(m => ({Month: m, ...bdCallsSummarize(rows.filter(r => toMmmYyyy(r.date) === m))}));
}

function convertedDataset(){
  const month = STATE.filterMonth;
  let base = applyRefColdFilter(STATE.raw);
  const statuses = ['DEAD','ON HOLD','ASSIGNED','RE-ASSIGNED','FOLLOW UP','IN PROCESS'];
  const teams = FIXED_TEAMS.slice();

  const isExcelMonthShape = v => /^.{3}-.{4}$/.test(String(v ?? ''));
  const out = teams.map(team => {
    const rows = base.filter(r => r.Team === team);
    const obj = {Team: team}; let total = 0;
    for(const st of statuses){
      let pool;
      if(month==='All'){
        pool = rows.filter(r => isExcelMonthShape(r.CM) && r.leadStatus===st);
      } else {
        pool = rows.filter(r => r.CM===month && r.leadStatus===st);
      }
      obj[st] = pool.length; total += pool.length;
    }
    obj.Total = total;
    return obj;
  });
  out.push(buildGrandTotalRow('Team', 'Grand Total', statuses, out, 'Total'));
  return {statuses, data: out};
}

