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

function applyRefColdFilter(rows){
  const mode = rcFilter(STATE.filterRefCold);
  if(mode === 'Exclude')
    return rows.filter(r => r['Campaign Name']!=='Referral' && r['Campaign Name']!=='Cold Data');
  if(mode === 'Only Referral')
    return rows.filter(r => r['Campaign Name']==='Referral');
  return rows;
}

function topKPIs(){
  let rows = applyRefColdFilter(STATE.raw);
  // YTD Leads (Fixed) is intentionally NOT affected by the Month or Ref+Cold filters —
  // it always reflects the full fixed FY period, unfiltered, and only changes when data is reloaded.
  const ytd = STATE.raw.filter(r=>filteredMonths().includes(r.FMONTH)).length;
  const generated = rows.filter(r=>monthFilter(r.CTM)).length;
  const sc = st => rows.filter(r => r.leadStatus===st && monthFilter(r[statusMonthCol(st)])).length;
  const converted = sc('CONVERTED'), inProcess = sc('IN PROCESS');
  return {
    ytd, generated, assigned: sc('ASSIGNED'), converted, inProcess,
    followUp: sc('FOLLOW UP'), onHold: sc('ON HOLD'), dead: sc('DEAD'),
    reAssigned: sc('RE-ASSIGNED'),
    qlRate: generated>0 ? (converted+inProcess)/generated : 0,
  };
}

function liveDataKPIs(){
  let rows = applyRefColdFilter(STATE.raw);
  const assigned = rows.filter(r=>r.leadStatus==='ASSIGNED' && monthFilter(r.CTM)).length;
  if(isAllMonths()) return { assigned, anyConv: null, anyIP: null, sameConv: null, sameIP: null };
  // AnyMonth = status event in selected month(s), lead CREATED outside those month(s)
  // SameMonth = status event in selected month(s), lead CREATED in the same selected month(s)
  const anyConv = rows.filter(r =>
    r.leadStatus==='CONVERTED' && monthFilter(r.CM) && !monthFilter(r.CTM)
  ).length;
  const anyIP = rows.filter(r =>
    r.leadStatus==='IN PROCESS' && monthFilter(r.LPM) && !monthFilter(r.CTM)
  ).length;
  const sameConv = rows.filter(r =>
    r.leadStatus==='CONVERTED' && monthFilter(r.CM) && monthFilter(r.CTM)
  ).length;
  const sameIP = rows.filter(r =>
    r.leadStatus==='IN PROCESS' && monthFilter(r.LPM) && monthFilter(r.CTM)
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
      let c = rows.filter(x => b.match(x) && x.CTM===m).length;
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
  let base = STATE.raw;
  if(teamFilter === 'SV') base = base.filter(r => (r.Team || 'SV') === 'SV');
  else if(teamFilter === 'non-SV') base = base.filter(r => (r.Team || 'SV') !== 'SV');
  return STATUSES.map(st => {
    const r = {Status: st, total: 0};
    months.forEach(m => {
      const col = statusMonthCol(st);
      const c = base.filter(x => x.leadStatus===st && x[col]===m).length;
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
  const platformNames = [...new Set(rows.map(r => r.platformName).filter(Boolean))].sort();
  const groups = platformNames.map(p => ({label: p, match: r => r.platformName === p}));
  const out = [];
  for(const g of groups){
    const sub = rows.filter(g.match);
    const obj = {Platform: g.label}; let total = 0;
    for(const st of STATUSES){
      const pool = applyMonthMode(sub.filter(r => r.leadStatus===st), anyMonthCol(st), mode);
      obj[st] = pool.length; total += pool.length;
    }
    obj.Total = total;
    obj.LCR = total>0 ? obj.CONVERTED/total : 0;
    out.push(obj);
  }
  const gt = buildGrandTotalRow('Platform', 'Grand Total', STATUSES, out, 'Total');
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
      const pool = applyMonthMode(sub.filter(r => r.leadStatus===st), anyMonthCol(st), mode);
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
      const pool = rows.filter(r => r.leadStatus===st && monthFilter(r[statusMonthCol(st)]));
      obj[st] = pool.length;
    }
    obj['Conv. Rate'] = totalLeads>0 ? obj.CONVERTED/totalLeads : 0;
    return obj;
  });
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
  const convRows = rows.filter(r => r.leadStatus==='CONVERTED' && monthFilter(r.CM));
  const ipRows   = rows.filter(r => r.leadStatus==='IN PROCESS' && monthFilter(r.LPM));
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
    let leads = STATE.raw.filter(r => r['Campaign Name']===name && monthFilter(r.CTM)).length;
    let qual  = STATE.raw.filter(r => r['Campaign Name']===name && ((r.leadStatus==='CONVERTED' && monthFilter(r.CM)) || (r.leadStatus==='IN PROCESS' && monthFilter(r.LPM)))).length;
    let conv  = STATE.raw.filter(r => r['Campaign Name']===name && r.leadStatus==='CONVERTED' && monthFilter(r.CM)).length;
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
  scope = scope.filter(r => campaignSet.has(r['Campaign Name']));

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
    if(r.leadStatus==='CONVERTED' && monthFilter(r.CM)) ensure(r).qualLeads++;
    else if(r.leadStatus==='IN PROCESS' && monthFilter(r.LPM)) ensure(r).qualLeads++;
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

