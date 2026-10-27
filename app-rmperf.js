// app-rmperf.js — RM Performance, B2B Corp Leads, PROCESSED, RM Revenue, Missing leads.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

// ---- RM Performance (Lead → Revenue tracker) ----
function isAllRmPerfMonths(){ return STATE.rmPerfMonth==='All' || (Array.isArray(STATE.rmPerfMonth) && STATE.rmPerfMonth.length===0); }
function rmPerfMonthMatch(m){
  const sel = STATE.rmPerfMonth;
  if(isAllRmPerfMonths()) return filteredMonths().includes(m);
  if(Array.isArray(sel)) return sel.includes(m);
  return m === sel;
}
// ---- guard: revenue reconciliation ----
// This section goes to real lengths to make sure no revenue row is dropped:
// teams are resolved by a cascade (RM Master Mapping → EMPLOYEE_REF →
// 'Unmatched'), and unmatched rows are deliberately surfaced so the grand
// total still ties out to the Revenue Input file. That's a promise worth
// actually checking — if an RM silently stops resolving, revenue quietly
// goes missing from a team's row while the page looks perfectly normal.
const RM_REVENUE_CHECK = { expected: 0, reported: 0, reconciles: true, unmatchedRMs: [], unmatchedRevenue: 0 };

/** @returns {{headline:string, detail:string, fix:string}|null} null when revenue ties out and every RM resolves. */
function rmRevenueIssueReport(){
  const { expected, reported, reconciles, unmatchedRMs, unmatchedRevenue } = RM_REVENUE_CHECK;
  if(reconciles && !unmatchedRMs.length) return null;

  if(!reconciles){
    return {
      headline: 'RM Performance revenue does not tie out to the Revenue Input file',
      detail: `The table totals ${fmtINR(reported)} but the matching rows in the Revenue Input file ` +
              `add up to ${fmtINR(expected)} — a gap of ${fmtINR(Math.abs(expected - reported))}. ` +
              'Some revenue is being attributed to no team at all.',
      fix: 'This is a code-level fault rather than a data one: a revenue row is passing the month/platform ' +
           'filters but not landing in any team bucket. Check teamForRevRow in app-rmperf.js.',
    };
  }
  return {
    headline: `${unmatchedRMs.length} RM(s) on the Revenue Input file don't map to a team`,
    detail: `${fmtINR(unmatchedRevenue)} of revenue is shown under "Unmatched RM" instead of a real team, ` +
            `so team totals understate it: ${unmatchedRMs.slice(0, 10).join(', ')}.`,
    fix: 'Add each name to RM MASTER MAPPING (source name → canonical RM name → team), or to EMPLOYEE_REF ' +
         'if the RM is genuinely new. The revenue is counted in the grand total either way — only the ' +
         'team split is affected.',
  };
}

function rmPerformance(){
  const monthMatch = m => rmPerfMonthMatch(m);
  const refExclude = STATE.rmPerfRefCold === 'Exclude';
  const campOK = r => !refExclude || (r['Campaign Name']!=='Referral' && r['Campaign Name']!=='Cold Data');
  const lsOK = ls => !refExclude || (ls!=='Referral' && ls!=='ReferralProgram');
  const lpOK = lp => !refExclude || (lp!=='Referral' && lp!=='ReferralProgram');

  // ---- per-RM (currentRmName / mapped) ----
  // RMs are compared by canonical key, cached per distinct name.
  const rmKeyCache = new Map();
  const rmKeyOf = name => {
    let k = rmKeyCache.get(name);
    if(k === undefined){ k = normalizeNameKey(mapRM(name)); rmKeyCache.set(name, k); }
    return k;
  };
  const leadsForRM = rm => { const k = rmKeyOf(rm); return STATE.raw.filter(r => rmKeyOf(r.currentRmName)===k && monthMatch(r.CTM) && campOK(r)).length; };
  // Quality = CONVERTED (by CM) + IN PROCESS (by LPM) — same column logic as KPI cards
  const qualityForRM = rm => { const k = rmKeyOf(rm); return STATE.raw.filter(r => rmKeyOf(r.currentRmName)===k && campOK(r) && (
    isConvertedLead(r, monthMatch) ||
    (r.leadStatus==='IN PROCESS' && !isConvertedLead(r) && monthMatch(r.LPM))
  )).length; };
  const rmEq = (a, b) => normalizeNameKey(a) === normalizeNameKey(b);
  const fpForRM = rm => {
    const fy = STATE.fy.filter(r => rmEq(r.mappedRM, rm) && monthMatch(r.Month) && lsOK(r.leadSource)).length;
    const pa = STATE.pa.filter(r => rmEq(r.mappedRM, rm) && r.clientType.toUpperCase()==='NEW' && monthMatch(r.Month) && lsOK(r.leadSource)).length;
    return fy + pa;
  };
  // Normalize OLD CHECK to "Mmm-yyyy" so the filter works regardless of how it's stored
  // (string "Jun-2026", "June 2026", Date object, Excel date serial, etc.)
  const revMonthOf = r => {
    const raw = r['OLD CHECK']||r['Old Check']||r['old check']||r['OldCheck']||'';
    return normalizeMonthLabel(raw) || toMmmYyyy(raw) || String(raw||'').trim();
  };
  const revRowMatches = r => {
    if(!monthMatch(revMonthOf(r))) return false;
    const lp = (r.LP||r.lp||r['Campaign Category']||'').toString().trim();
    return lpOK(lp);
  };
  const revAmount = r => Number(r.Total||r.TOTAL||r.total||0) || 0;
  const revClientType = r => (r['CLIENT TYPE']||r['client type']||r['Client Type']||'').toString().toUpperCase();
  // Revenue Input RM names also flow through RM Master Mapping so abbreviated or
  // variant names (e.g. "Vivek", "Ravi Sharma ", "Akansha") resolve to the canonical
  // RM name that EMPLOYEE_REF and the rest of the dashboard recognize.
  const revRawRm = r => (r.RM||r.rm||r['Curren RM']||r['Current RM']||'').toString().trim();
  const revMappedRm = r => mapRM(revRawRm(r)) || revRawRm(r);
  const revRowsForRM = rm => {
    const U = rm.toUpperCase();
    return STATE.rev.filter(r => revMappedRm(r).toUpperCase() === U && revRowMatches(r));
  };
  const rev15kForRM = rm => revRowsForRM(rm).filter(r => revClientType(r)==='REVENUE BASED').length;
  const transForRM  = rm => revRowsForRM(rm).filter(r => revClientType(r)==='NOT ELIGIBLE').length;
  const revenueForRM= rm => revRowsForRM(rm).reduce((s,r)=> s + revAmount(r), 0);

  // Team-direct revenue aggregation — guarantees no revenue rows are lost even if
  // an RM is missing from EMPLOYEE_REF. Team is resolved by cascade:
  //   1) RM Master Mapping team column (canonical-RM → team)
  //   2) EMPLOYEE_REF team map (RM → team)
  //   3) fall back to "Unmatched" so the grand total still reconciles
  const teamForRevRow = r => {
    const mapped = revMappedRm(r);
    const k = normalizeNameKey(mapped);
    return STATE.rmMasterTeam[k] || STATE.teamMap[k] || 'Unmatched';
  };
  const revTeamAgg = {};
  for(const r of STATE.rev){
    if(!revRowMatches(r)) continue;
    const t = teamForRevRow(r);
    if(!revTeamAgg[t]) revTeamAgg[t] = {revenue:0, rev15k:0, trans:0};
    revTeamAgg[t].revenue += revAmount(r);
    const ct = revClientType(r);
    if(ct==='REVENUE BASED') revTeamAgg[t].rev15k++;
    else if(ct==='NOT ELIGIBLE') revTeamAgg[t].trans++;
  }

  // ---- team-based (raw) for summary leads/quality ----
  const leadsForTeam = team => STATE.raw.filter(r => r.Team===team && monthMatch(r.CTM) && campOK(r)).length;
  // Quality = CONVERTED (by CM) + IN PROCESS (by LPM) — same column logic as KPI cards
  const qualityForTeam = team => STATE.raw.filter(r => r.Team===team && campOK(r) && (
    isConvertedLead(r, monthMatch) ||
    (r.leadStatus==='IN PROCESS' && !isConvertedLead(r) && monthMatch(r.LPM))
  )).length;

  // Group revenue rows by team → canonical (mapped) RM name so the detail table can
  // include every RM that has revenue (even ones missing from EMPLOYEE_REF).
  const revByTeamRM = {}; // team → { mappedRM → [rev rows] }
  for(const r of STATE.rev){
    if(!revRowMatches(r)) continue;
    const mapped = revMappedRm(r) || '(blank RM)';
    const team = teamForRevRow(r);
    if(!revByTeamRM[team]) revByTeamRM[team] = {};
    (revByTeamRM[team][mapped] = revByTeamRM[team][mapped] || []).push(r);
  }
  const revStatsFor = rows => ({
    rev15k:  rows.filter(r => revClientType(r)==='REVENUE BASED').length,
    trans:   rows.filter(r => revClientType(r)==='NOT ELIGIBLE').length,
    revenue: rows.reduce((s,r)=> s + revAmount(r), 0),
  });

  const teams = teamsForRows(STATE.raw, r => r.Team || 'SV');
  // team -> canonical names of the RMs holding its leads
  const leadRMsByTeam = new Map();
  for(const r of STATE.raw){
    const nm = mapRM(r.currentRmName);
    if(!nm) continue;
    const t = r.Team || 'SV';
    if(!leadRMsByTeam.has(t)) leadRMsByTeam.set(t, new Map());
    leadRMsByTeam.get(t).set(normalizeNameKey(nm), nm);
  }
  for(const [t, m] of leadRMsByTeam) leadRMsByTeam.set(t, [...m.values()]);
  const detail = [];
  const summary = [];
  for(const team of teams){
    const rms = [];
    const seenRM = new Set();
    for(let i=1;i<STATE.empref.length;i++){
      const er = STATE.empref[i]; if(!er) continue;
      if((er[1]||'').toString().trim()===team){
        const nm = (er[2]||'').toString().trim();
        if(nm && !seenRM.has(rmKeyOf(nm))){ rms.push(nm); seenRM.add(rmKeyOf(nm)); }
      }
    }
    // RMs holding leads for this team but missing from EMPLOYEE_REF
    for(const nm of (leadRMsByTeam.get(team) || [])){
      if(!seenRM.has(rmKeyOf(nm))){ rms.push(nm); seenRM.add(rmKeyOf(nm)); }
    }
    // Add RMs that have revenue rows attributed to this team but aren't in EMPLOYEE_REF
    const teamRevRMs = revByTeamRM[team] || {};
    for(const rm of Object.keys(teamRevRMs)){
      if(!seenRM.has(rmKeyOf(rm))){ rms.push(rm); seenRM.add(rmKeyOf(rm)); }
    }

    let tFp=0;
    for(const rm of rms){
      const row = { team, rm,
        leads: leadsForRM(rm), quality: qualityForRM(rm),
        fp: fpForRM(rm), rev15k: rev15kForRM(rm),
        trans: transForRM(rm), revenue: revenueForRM(rm) };
      detail.push(row);
      tFp += row.fp;
    }
    // Team-direct totals from STATE.rev guarantee no revenue rows are lost
    // even if the RM is missing from EMPLOYEE_REF or unmapped.
    const t = revTeamAgg[team] || {revenue:0, rev15k:0, trans:0};
    summary.push({ team,
      leads: leadsForTeam(team), quality: qualityForTeam(team),
      fp: tFp, rev15k: t.rev15k, trans: t.trans, revenue: t.revenue });
  }

  // Surface unmatched-RM revenue in both the summary AND the detail table
  // so the grand total reconciles exactly with the Revenue Input file.
  const um = revTeamAgg['Unmatched'];
  if(um && (um.revenue || um.rev15k || um.trans)){
    summary.push({ team:'Unmatched RM', leads:0, quality:0, fp:0,
      rev15k: um.rev15k, trans: um.trans, revenue: um.revenue });
    const unmatchedRMs = revByTeamRM['Unmatched'] || {};
    for(const rm of Object.keys(unmatchedRMs)){
      const stats = revStatsFor(unmatchedRMs[rm]);
      detail.push({ team:'Unmatched RM', rm,
        leads:0, quality:0, fp:0,
        rev15k:stats.rev15k, trans:stats.trans, revenue:stats.revenue });
    }
  }

  // Grand totals: leads/quality/fp from FIXED_TEAMS, revenue from the direct rev aggregation
  // (sum across all teams including 'Unmatched').
  const grand = summary.reduce((g,s)=>({
    leads:g.leads+s.leads, quality:g.quality+s.quality, fp:g.fp+s.fp,
    rev15k:g.rev15k+s.rev15k, trans:g.trans+s.trans, revenue:g.revenue+s.revenue,
  }), {leads:0,quality:0,fp:0,rev15k:0,trans:0,revenue:0});

  // Verify the "no revenue row is lost" promise above, rather than trusting it.
  // Compared on rounded rupees so float addition order can't raise a false alarm.
  RM_REVENUE_CHECK.expected = STATE.rev.reduce((s, r) => s + (revRowMatches(r) ? revAmount(r) : 0), 0);
  RM_REVENUE_CHECK.reported = grand.revenue;
  RM_REVENUE_CHECK.reconciles = Math.round(RM_REVENUE_CHECK.expected) === Math.round(grand.revenue);
  RM_REVENUE_CHECK.unmatchedRMs = Object.keys(revByTeamRM['Unmatched'] || {});
  RM_REVENUE_CHECK.unmatchedRevenue = (revTeamAgg['Unmatched'] || {}).revenue || 0;
  const revenueReport = rmRevenueIssueReport();
  if(revenueReport) console.warn(`[MIS] ${revenueReport.headline}: ${revenueReport.detail} Fix: ${revenueReport.fix}`);
  // Direct count from FY/PA sheets so plans for unmapped RMs are never lost
  grand.fp = STATE.fy.filter(r => monthMatch(r.Month) && lsOK(r.leadSource)).length
           + STATE.pa.filter(r => r.clientType.toUpperCase()==='NEW' && monthMatch(r.Month) && lsOK(r.leadSource)).length;

  // ---- KPI strip ----
  const statusCount = st => {
    const base = STATE.raw.filter(r => campOK(r));
    // CONVERTED gate: CM-presence, not leadStatus (per 2026-07-29 rule).
    // Leads with a CM are removed from every other status bucket.
    if(st === 'CONVERTED') return base.filter(r => isConvertedLead(r, monthMatch)).length;
    const col = st==='IN PROCESS'?'LPM':'CTM';
    return base.filter(r=>r.leadStatus===st && !isConvertedLead(r) && monthMatch(r[col])).length;
  };
  const kpi = {
    totalLeads: STATE.raw.filter(r => monthMatch(r.CTM) && campOK(r)).length,
    converted: statusCount('CONVERTED'), inProcess: statusCount('IN PROCESS'),
    followUp: statusCount('FOLLOW UP'), onHold: statusCount('ON HOLD'), dead: statusCount('DEAD'),
  };

  // The KPI strip counts the whole file; if the team rows fall short, a lead sits in no team.
  const teamLeadSum = summary.reduce((a, t) => a + t.leads, 0);
  if(teamLeadSum !== kpi.totalLeads){
    console.warn(`[MIS] RM Performance: team rows add up to ${teamLeadSum} leads but the KPI strip shows ${kpi.totalLeads} — ${Math.abs(kpi.totalLeads - teamLeadSum)} lead(s) belong to no team row.`);
  }

  return { kpi, summary, detail, grand };
}

// ---- B2B Corp Leads ----
function b2bKPI(){
  if(!STATE.b2b.length) return 0;
  return STATE.b2b.filter(r => monthFilter(r.CreateMonth)).length;
}

function b2bByRMStatus(){
  const data = STATE.b2b.filter(r => monthFilter(r.CreateMonth));
  const B2B_STATUSES = ['ASSIGNED','DEAD','FOLLOW UP','ON HOLD','RE-ASSIGNED'];
  const rms = Array.from(new Set(data.map(r => r.currentRmName).filter(Boolean))).sort();
  const out = rms.map(rm => {
    const sub = data.filter(r => r.currentRmName===rm);
    const obj = {RM: rm}; let total = 0;
    for(const st of B2B_STATUSES){ obj[st] = sub.filter(r => r.status===st).length; total += obj[st]; }
    obj.Total = total;
    return obj;
  });
  if(!out.length) return {statuses: B2B_STATUSES, data: []};
  out.push(buildGrandTotalRow('RM', 'Grand Total', B2B_STATUSES, out, 'Total'));
  return {statuses: B2B_STATUSES, data: out};
}

function renderB2BTable(){
  if(!STATE.filesLoaded.b2b){ setNotUploaded('#tbl-b2b','b2b'); return; }
  const {statuses, data} = b2bByRMStatus();
  const monthLabel = hasSpecificMonths() ? effectiveMonths().join(', ') : 'All Months';
  const title = 'B2B CORP LEADS — RM × STATUS  (' + monthLabel + ')';
  const el = $('#b2b-table-title'); if(el) el.textContent = title;
  const host = '#tbl-b2b';
  if(!data.length){
    $(host).innerHTML = '<div class="meta" style="padding:12px">No B2B data — B2B.xlsx was not found in the repo.</div>';
    return;
  }
  const headers = ['RM', ...statuses, 'Total'];
  const rows = data.map(r => {
    const o = {RM: r.RM, _tot: !!r._tot};
    statuses.forEach(s => o[s] = fmtIN(r[s]));
    o.Total = fmtIN(r.Total);
    return o;
  });
  renderTable(host, headers, rows);
}

function renderRMPerfFunnel(grand){
  const host = $('#rmperf-funnel'); if(!host) return;
  const stages = [
    {label:'Total Leads',           value:grand.leads,   color:'var(--blue)'},
    {label:'Quality Leads',         value:grand.quality, color:'var(--green)'},
    {label:'Plans Made',            value:grand.fp,      color:'var(--violet)'},
    {label:'Revenue >15K Clients',  value:grand.rev15k,  color:'var(--orange)'},
    {label:'Transactional Clients', value:grand.trans,   color:'var(--pink)'},
  ];
  const max = Math.max(...stages.map(s=>s.value), 1);
  const leads = grand.leads || 0;
  const sub = $('#rmperf-funnel-sub');
  if(sub){
    const m = STATE.rmPerfMonth;
    const mLabel = (m==='All' || (Array.isArray(m) && m.length===0)) ? 'All Months'
      : (Array.isArray(m) ? m.join(', ') : m);
    sub.textContent = '(' + mLabel + ' · ' + STATE.rmPerfRefCold + ')';
  }

  host.innerHTML = stages.map((s,i) => {
    // Square-root scaling so small stages (e.g. Plans Made vs Total Leads) stay visible,
    // plus a 45% floor so labels and values never get clipped.
    const ratio = s.value / max;
    const widthPct = Math.max(Math.sqrt(ratio) * 100, 45);
    const convFromLeads = leads>0 ? (s.value/leads*100) : 0;
    const conv = i===0
      ? '100% of leads'
      : `${convFromLeads.toFixed(1)}% of leads`;
    const arrow = i>0 ? '<div class="funnel-arrow">▼</div>' : '';
    return `${arrow}
      <div class="funnel-stage">
        <div class="funnel-bar" style="width:${widthPct}%;background:${s.color}">
          <span class="funnel-label">${s.label}</span>
          <span class="funnel-value">${fmtIN(s.value)}</span>
        </div>
        <div class="funnel-conv">${conv}</div>
      </div>`;
  }).join('');
}

function renderRMPerformance(){
  if(!STATE.premiumUnlocked) return;
  // Sync in-tab filter dropdowns (multi-select)
  const rmMonths = filteredMonths();
  if($('#rmperf-month-wrap')){
    buildMultiSelect('#rmperf-month-wrap', ['All',...rmMonths], STATE.rmPerfMonth,
      val => { STATE.rmPerfMonth = val; STATE.revMonth = val; renderRMPerformance(); if($('#rev-month-filter-wrap')) initRevFilters(); renderRMRev(); },
      {multi:true});
  }
  if($('#rmperf-refcold-wrap')){
    buildMultiSelect('#rmperf-refcold-wrap', ['Include','Exclude'], STATE.rmPerfRefCold,
      val => { STATE.rmPerfRefCold = val; renderRMPerformance(); }, {multi:false});
  }

  // Repo-fetch status banner for FY2026 / Plan Approval
  const fpReady = STATE.filesLoaded.fy || STATE.filesLoaded.pa;
  const banner = $('#rmperf-upload-banner');
  if(banner){
    const fyTxt = STATE.filesLoaded.fy ? `✓ FY2026.xlsx (${STATE.fy.length} rows)` : '✗ FY2026.xlsx not found in repo';
    const paTxt = STATE.filesLoaded.pa ? `✓ Plan Approval.xlsx (${STATE.pa.length} rows)` : '✗ Plan Approval.xlsx not found in repo';
    banner.innerHTML = `<span class="${STATE.filesLoaded.fy?'rmperf-ok':'rmperf-miss'}">${fyTxt}</span>
      <span class="${STATE.filesLoaded.pa?'rmperf-ok':'rmperf-miss'}">${paTxt}</span>
      ${fpReady?'':'<span class="rmperf-hint">Add these files to the repo to populate <strong>Financial Plans Made</strong>.</span>'}`;
  }

  if(!STATE.filesLoaded.fin23 && !STATE.filesLoaded.rev && !fpReady){
    setNotUploaded('#rmperf-summary','fin23');
    $('#rmperf-detail').innerHTML = '';
    $('#rmperf-kpis').innerHTML = '';
    $('#rmperf-funnel').innerHTML = '';
    return;
  }

  const {kpi, summary, detail, grand} = rmPerformance();

  // KPI strip
  const kpiCards = [
    {label:'Total Leads', value:fmtIN(kpi.totalLeads), tone:'blue'},
    {label:'Converted', value:fmtIN(kpi.converted), tone:'green'},
    {label:'In Process', value:fmtIN(kpi.inProcess), tone:'cyan'},
    {label:'Follow Up', value:fmtIN(kpi.followUp), tone:'amber'},
    {label:'On Hold', value:fmtIN(kpi.onHold), tone:'orange'},
    {label:'Dead', value:fmtIN(kpi.dead), tone:'red'},
  ];
  $('#rmperf-kpis').innerHTML = kpiCards.map(c=>`
    <div class="kpi kpi-${c.tone}"><div class="kpi-value">${c.value}</div><div class="kpi-label">${c.label}</div></div>`).join('');

  renderRMPerfFunnel(grand);

  // Summary table (team level)
  const sHeaders = ['Team','Total Leads','Quality Leads','Financial Plans Made','Revenue >15K Clients','Transactional Clients','Total Revenue (₹)'];
  applyHeatAndLegend(summary, 'leads', '#legend-rmperf-summary', 'Row heat by Total Leads');
  const sRows = summary.map(r => ({
    Team: r.team,
    'Total Leads': fmtIN(r.leads),
    'Quality Leads': fmtIN(r.quality),
    'Financial Plans Made': fmtIN(r.fp),
    'Revenue >15K Clients': fmtIN(r.rev15k),
    'Transactional Clients': fmtIN(r.trans),
    'Total Revenue (₹)': fmtINR(r.revenue),
    _heat: r._heat,
  }));
  sRows.push({
    Team:'TOTAL',
    'Total Leads': fmtIN(grand.leads),
    'Quality Leads': fmtIN(grand.quality),
    'Financial Plans Made': fmtIN(grand.fp),
    'Revenue >15K Clients': fmtIN(grand.rev15k),
    'Transactional Clients': fmtIN(grand.trans),
    'Total Revenue (₹)': fmtINR(grand.revenue),
    _tot:true,
  });
  renderTable('#rmperf-summary', sHeaders, sRows);

  // Detail table (team × RM) with team subtotals
  const dHeaders = ['Team','RM Name','Total Leads','Quality Leads','Financial Plans Made','Revenue >15K Clients','Transactional Clients','Total Revenue (₹)'];
  applyHeatAndLegend(detail, 'leads', '#legend-rmperf-detail', 'Row heat by Total Leads (excludes Team Totals)');
  const dRows = [];
  const byTeam = {};
  detail.forEach(r => (byTeam[r.team] = byTeam[r.team]||[]).push(r));
  // Include FIXED_TEAMS in order, plus any extra teams in detail (e.g. "Unmatched RM")
  const teamOrder = FIXED_TEAMS.concat(Object.keys(byTeam).filter(t => !FIXED_TEAMS.includes(t)));
  for(const team of teamOrder){
    const rms = byTeam[team] || [];
    if(!rms.length) continue;
    let t={leads:0,quality:0,fp:0,rev15k:0,trans:0,revenue:0};
    rms.forEach(r => {
      dRows.push({
        Team: r.team, 'RM Name': r.rm,
        'Total Leads': fmtIN(r.leads), 'Quality Leads': fmtIN(r.quality),
        'Financial Plans Made': fmtIN(r.fp), 'Revenue >15K Clients': fmtIN(r.rev15k),
        'Transactional Clients': fmtIN(r.trans), 'Total Revenue (₹)': fmtINR(r.revenue),
        _heat: r._heat,
      });
      t.leads+=r.leads; t.quality+=r.quality; t.fp+=r.fp; t.rev15k+=r.rev15k; t.trans+=r.trans; t.revenue+=r.revenue;
    });
    dRows.push({
      Team: team+' Total', 'RM Name':'',
      'Total Leads': fmtIN(t.leads), 'Quality Leads': fmtIN(t.quality),
      'Financial Plans Made': fmtIN(t.fp), 'Revenue >15K Clients': fmtIN(t.rev15k),
      'Transactional Clients': fmtIN(t.trans), 'Total Revenue (₹)': fmtINR(t.revenue),
      _tot:true,
    });
  }
  renderTable('#rmperf-detail', dHeaders, dRows);
}

function mtdPerformance(){
  const refMode = STATE.mtdFilterRefCold;
  const allCampaigns = [...new Set(STATE.raw.map(r => r['Campaign Name']).filter(Boolean))].sort();
  const buckets = refMode === 'Only Referral' ? allCampaigns.filter(c => c === 'Referral')
                : refMode === 'Exclude'        ? allCampaigns.filter(c => c !== 'Referral' && c !== 'Cold Data')
                : allCampaigns;
  const mtdMonths = STATE.months.filter(m => monthKey(m) >= monthKey('Apr-2026'));
  const sd = Math.min(STATE.mtdStart, STATE.mtdEnd), ed = Math.max(STATE.mtdStart, STATE.mtdEnd);
  const days = Math.max(1, ed-sd+1);
  const proj = v => v/days*30;
  const out = [];

  for(const m of mtdMonths){
    const [mon,yr] = m.split('-');
    const monIdx = MONTHS_3.indexOf(mon);
    const yyyymm = yr+'-'+pad2(monIdx+1);

    for(const c of buckets){
      const pool = STATE.raw.filter(r => r['Campaign Name']===c);

      // All three measures ask the same question of a different date column:
      // does this ISO date fall in this month, within the selected day window?
      const inDayWindow = d => {
        if(!d || d.length < 10) return false;
        if(d.substring(0, 7) !== yyyymm) return false;
        const day = parseInt(d.substring(8, 10), 10);
        return day >= sd && day <= ed;
      };

      const leads = pool.filter(r => inDayWindow(r.createdDate)).length;

      // CONVERTED gate: CM-presence (isConvertedLead), not leadStatus — same
      // rule as everywhere else on this dashboard. Was leadStatus==='CONVERTED'
      // literally, which misses any lead that converted (has a CM/convertedDate)
      // but was later moved to a different status label — undercounted by 27
      // for a real July-2026 check (106 by the standard rule vs 79 here).
      const conv = pool.filter(r => isConvertedLead(r) && inDayWindow(r.convertedDate)).length;

      // Also excludes CM-having leads now, so a lead that has since converted
      // can't double up as both "In Process" here and "Converted" above.
      const ip = pool.filter(r =>
        r.leadStatus === 'IN PROCESS' && !isConvertedLead(r) && inDayWindow(r.leadInProcessDate)
      ).length;

      out.push({Month:m, Campaign:c, Leads:leads, LeadsProj:proj(leads),
        Conv:conv, ConvProj:proj(conv), InProc:ip, InProcProj:proj(ip),
        Qual:conv+ip, QualProj:proj(conv+ip)});
    }
  }
  return out;
}

// ---- PROCESSED tab ----
function processedPlatform(){
  const buckets = platformsForLeadsTable();
  const rows = STATE.raw, months = STATE.months;
  const out = buckets.map(b => {
    const o = {Platform:b.label, total:0};
    months.forEach(m => { o[m] = rows.filter(x => b.match(x) && x.CTM===m).length; o.total += o[m]; });
    return o;
  });
  out.push(buildGrandTotalRow('Platform', 'Grand Total', months, out, 'total'));
  return out;
}
function processedStatus(){
  const months = STATE.months;
  return STATUSES.map(st => {
    const r = {Status:st, total:0};
    months.forEach(m => {
      const col = statusMonthCol(st);
      // CONVERTED gate: CM-presence, not leadStatus (per 2026-07-29 rule).
      // Leads with a CM are removed from all other status buckets.
      r[m] = st === 'CONVERTED'
        ? STATE.raw.filter(x => x.CM === m).length
        : STATE.raw.filter(x => x.leadStatus===st && !isConvertedLead(x) && x[col]===m).length;
      r.total += r[m];
    });
    return r;
  });
}

// ---- RM Revenue ----
// Revenue Input column names vary between exports, hence the fallback
// chains. NOTE: rmPerformance() above reads the same concepts with a
// slightly wider set of aliases ('OldCheck', 'Current RM', 'Client Type').
// That difference is pre-existing and load-bearing — the two sections can
// disagree on a row whose header casing only one of them recognizes — so
// it's preserved rather than unified, and called out here so the next
// person sees it on purpose instead of discovering it in a number mismatch.
const revOldCheckOf = r => String(r['OLD CHECK'] || r['Old Check'] || r['old check'] || '');
const revLeadPlatformOf = r => (r.LP || r.lp || r['Campaign Category'] || '').toString().trim();
const revRmNameOf = r => (r.RM || r.rm || r['Curren RM'] || '').toString().trim();
const revClientTypeOf = r => (r['CLIENT TYPE'] || r['client type'] || '').toString().toUpperCase();
const revTotalOf = r => Number(r.Total || r.TOTAL || r.total || 0) || 0;

/** Revenue rows passing the RM Revenue tab's month and lead-platform filters. */
function revenueRowsInScope(){
  let rows = STATE.rev;
  if(!isAllRevMonths()) rows = rows.filter(r => revMonthMatch(revOldCheckOf(r)));

  const lpMode = STATE.revLPFilter;
  if(lpMode === 'Exclude'){
    rows = rows.filter(r => {
      const lp = revLeadPlatformOf(r);
      return lp !== 'Referral' && lp !== 'Cold Data';
    });
  } else if(lpMode === 'Only Referral'){
    rows = rows.filter(r => revLeadPlatformOf(r) === 'Referral');
  }
  return rows;
}

/**
 * Group in-scope revenue rows and tally the same three measures either way.
 * @param {Function} keyOf Grouping key for a row ('' is a valid key).
 * @param {Function} seed Initial accumulator for a newly seen key.
 */
function aggregateRevenueBy(keyOf, seed){
  const groups = {};
  for(const r of revenueRowsInScope()){
    // Rows with no RM keep their own line so the total ties to the Revenue Input file.
    const rm = revRmNameOf(r) || '(blank RM)';
    const key = keyOf(r, rm);
    if(!groups[key]) groups[key] = seed(r, rm, key);
    const clientType = revClientTypeOf(r);
    if(clientType === 'REVENUE BASED') groups[key].RevBased++;
    if(clientType === 'NOT ELIGIBLE') groups[key].NotEligible++;
    groups[key].Total += revTotalOf(r);
  }
  return Object.values(groups).sort((a, b) => b.Total - a.Total);
}

// Same team cascade as RM Performance, applied to the canonical RM name.
function revenueTeamOf(rm){
  const k = normalizeNameKey(mapRM(rm) || rm);
  return STATE.rmMasterTeam[k] || STATE.teamMap[k] || '';
}

function revenueAggregatedByTeam(){
  return aggregateRevenueBy(
    (r, rm) => revenueTeamOf(rm),
    (r, rm, team) => ({ Team: team || '(unassigned)', RevBased: 0, NotEligible: 0, Total: 0 })
  );
}

function revenueAggregated(){
  const rows = aggregateRevenueBy(
    (r, rm) => normalizeNameKey(mapRM(rm) || rm),
    (r, rm, key) => ({ RM: mapRM(rm) || rm, Team: revenueTeamOf(rm), RevBased: 0, NotEligible: 0, Total: 0 })
  );
  return isAllRevTeams() ? rows : rows.filter(o => revTeamMatch(o.Team));
}

function drawRevChart(){
  if(!window.Chart) return;
  const data = isAllRevTeams() ? revenueAggregatedByTeam().slice(0, 20) : revenueAggregated().slice(0, 20);
  const ctx = $('#rev-chart').getContext('2d');
  if(STATE.revChart) STATE.revChart.destroy();
  STATE.revChart = new Chart(ctx, {
    type:'bar',
    plugins: [ChartDataLabels],
    data: {
      labels: data.map(d => isAllRevTeams() ? d.Team : d.RM),
      datasets: [{
        label: 'Total Revenue (₹)',
        data: data.map(d => d.Total),
        backgroundColor: '#5b8dff',
        borderRadius: 0,
      }]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend:{ labels:{ color:'#cfd9f0' } },
        tooltip:{ callbacks:{ label: c => '₹'+Math.round(c.raw).toLocaleString('en-IN') } },
        datalabels: {
          anchor: 'end',
          align: 'top',
          color: '#cfd9f0',
          font: { size: 10, weight: 'bold' },
          formatter: v => '₹'+Math.round(v).toLocaleString('en-IN'),
        }
      },
      scales: {
        x:{ ticks:{ color:'#9aa6bf', autoSkip:false, maxRotation:60, minRotation:45 }, grid:{ color:'rgba(255,255,255,.05)' } },
        y:{ ticks:{ color:'#9aa6bf', callback: v => '₹'+Number(v).toLocaleString('en-IN') }, grid:{ color:'rgba(255,255,255,.05)' } }
      }
    }
  });
}

// ---- MISSING leads ----
function missingLeads(){
  const out = [];
  for(const r of STATE.raw){
    const reasons = [];
    if(!r.currentRmName) reasons.push('No RM');
    if(!r['Campaign Name']) reasons.push('No Campaign');
    if(!r.leadStatus) reasons.push('No Status');
    if(!r.createdDate) reasons.push('No Created');
    if(r.createdDate && r.CTM === 'N/A') reasons.push('Unreadable Created date');
    if(r.leadStatus && !STATUSES.includes(r.leadStatus)) reasons.push('Unknown status "' + r.leadStatus + '"');
    if(r._ipInferred) reasons.push('IN PROCESS without in-process date (month inferred)');
    if(r._cvInferred) reasons.push('CONVERTED without converted date (month inferred)');
    if(reasons.length){ out.push({...r, Reason: reasons.join(', ')}); }
  }
  return out;
}

