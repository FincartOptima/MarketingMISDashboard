// app-renderers.js — Per-tab render functions and raw-data / B2B raw-data filter menus.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

// ---- renderers ----
function renderKPIs(){
  if(!STATE.filesLoaded.fin23){ $('#kpis').innerHTML = notUploadedHTML('fin23'); return; }
  const k = topKPIs();
  const cards = [
    {label:'YTD Leads (Fixed)', value: fmtIN(k.ytd), tone:'blue'},
    {label:'Generated Leads', value: fmtIN(k.generated), tone:'blue'},
    {label:'Converted',       value: fmtIN(k.converted), tone:'green'},
    {label:'In Process',      value: fmtIN(k.inProcess), tone:'cyan'},
    {label:'QL Conversion Rate', value: fmtPct(k.qlRate), tone:'violet'},
    {label:'Follow Up',       value: fmtIN(k.followUp), tone:'amber'},
    {label:'On Hold',         value: fmtIN(k.onHold), tone:'orange'},
    {label:'Dead',            value: fmtIN(k.dead), tone:'red'},
  ];
  $('#kpis').innerHTML = cards.map(c => `
    <div class="kpi kpi-${c.tone}">
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-label">${c.label}</div>
    </div>`).join('');
}

function renderLiveKPIs(){
  if(!STATE.filesLoaded.fin23){ $('#live-kpis').innerHTML = ''; return; }
  const k = liveDataKPIs();
  const month = STATE.filterMonth;
  const hint = month==='All' ? '<span style="color:var(--muted);font-size:11px">(Select a month for AnyMonth data)</span>' : '';
  const cards = [
    {label:'Assigned', value: fmtIN(k.assigned), tone:'blue'},
    {label:'AnyMonth Converted', value: k.anyConv!==null ? fmtIN(k.anyConv) : '—', tone:'green'},
    {label:'AnyMonth InProcess', value: k.anyIP!==null ? fmtIN(k.anyIP) : '—', tone:'cyan'},
    {label:'Same Month Converted', value: k.sameConv!==null ? fmtIN(k.sameConv) : '—', tone:'green'},
    {label:'Same Month InProcess', value: k.sameIP!==null ? fmtIN(k.sameIP) : '—', tone:'cyan'},
    {label:'B2B Corp Leads', value: fmtIN(b2bKPI()), tone:'violet'},
  ];
  const el = $('#live-kpis');
  el.innerHTML = '<div style="font-size:12px;color:#cfd9f0;margin-bottom:6px;font-weight:600">▲ Live Data '+hint+'</div>' +
    '<div class="live-kpi-grid">' +
    cards.map(c => `
    <div class="kpi kpi-${c.tone}">
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-label">${c.label}</div>
    </div>`).join('') + '</div>';
}

function renderStatusDistributionChart(){
  if(!STATE.filesLoaded.fin23){ const w=$('#status-dist-chart-wrap'); if(w) w.innerHTML=notUploadedHTML('fin23'); return; }
  if(!window.Chart) return;
  const canvas = $('#status-dist-chart');
  if(!canvas) return;
  const k = topKPIs();
  const labels = ['Assigned', 'Re-Assigned', 'On Hold', 'Follow Up', 'In Process', 'Converted', 'Dead'];
  const values = [k.assigned, k.reAssigned, k.onHold, k.followUp, k.inProcess, k.converted, k.dead];
  const colors = ['#0284c7', '#8b5cf6', '#2563eb', '#f59e0b', '#0891b2', '#16a34a', '#dc2626'];
  const filter = $('#status-chart-filter');
  if(filter) filter.textContent = filterSummary();
  if(STATE.statusChart) STATE.statusChart.destroy();
  STATE.statusChart = new Chart(canvas.getContext('2d'), {
    type:'bar',
    plugins: window.ChartDataLabels ? [window.ChartDataLabels] : [],
    data:{
      labels,
      datasets:[{
        label:'Clients',
        data:values,
        backgroundColor:colors,
        borderColor:colors,
        borderWidth:1,
        borderRadius:0,
        maxBarThickness:58,
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      layout:{padding:{top:22,right:8,left:4,bottom:0}},
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:c => `${c.label}: ${fmtIN(c.raw)}`}},
        datalabels:{
          anchor:'end',
          align:'top',
          offset:2,
          color:'#1f2937',
          font:{size:11,weight:'bold'},
          formatter:v => fmtIN(v),
        },
      },
      scales:{
        x:{
          ticks:{color:'#475569',font:{size:11,weight:'600'},maxRotation:0,minRotation:0},
          grid:{display:false},
          border:{color:'#cbd5e1'},
        },
        y:{
          beginAtZero:true,
          ticks:{color:'#64748b',callback:v => fmtIN(v)},
          grid:{color:'rgba(148,163,184,.25)'},
          border:{color:'#cbd5e1'},
        },
      },
    },
  });
}

function renderPlatformMonth(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-platform-month','fin23'); $('#legend-platform-month').innerHTML=''; return; }
  const data = leadsByPlatformMonth();
  const gt = data[data.length-1].total || 1;
  const months = filteredMonths();
  data.forEach((r,i) => r._tot = (i===data.length-1));
  applyHeatAndLegend(data, 'total', '#legend-platform-month', 'Row heat by Total leads');
  const rows = data.map((r,i) => {
    const o = {Platform:r.Platform};
    months.forEach(m => o[m] = fmtIN(r[m]));
    o.Total = fmtIN(r.total);
    o['Share %'] = i===data.length-1 ? '100.00%' : fmtPct(r.total/gt);
    o._tot = r._tot; o._heat = r._heat;
    return o;
  });
  renderTable('#tbl-platform-month', ['Platform', ...months, 'Total', 'Share %'], rows);
}

function renderStatusMonth(){
  if(!STATE.filesLoaded.fin23){
    setNotUploaded('#tbl-status-month-mapped','fin23');
    setNotUploaded('#tbl-status-month-sv','fin23');
    $('#legend-status-month-mapped').innerHTML='';
    $('#legend-status-month-sv').innerHTML='';
    return;
  }
  const months = filteredMonths();
  const headers = ['Status', ...months, 'Total'];
  const fmt = data => data.map(r => {
    const o = {Status:r.Status};
    months.forEach(m => o[m] = fmtIN(r[m]));
    o.Total = fmtIN(r.total);
    o._heat = r._heat;
    return o;
  });
  const mapped = statusByMonth('non-SV');
  applyHeatAndLegend(mapped, 'total', '#legend-status-month-mapped', 'Row heat by Total');
  renderTable('#tbl-status-month-mapped', headers, fmt(mapped));

  const sv = statusByMonth('SV');
  applyHeatAndLegend(sv, 'total', '#legend-status-month-sv', 'Row heat by Total');
  renderTable('#tbl-status-month-sv', headers, fmt(sv));
}

function renderPlatformStatus(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-platform-status','fin23'); $('#legend-platform-status').innerHTML=''; return; }
  updateDashboardHeaderFilters();

  // Team filter for this table only
  const wrap = $('#ps-team-filter-wrap');
  if(wrap && !wrap.querySelector('select')){
    const allTeams = ['All', ...FIXED_TEAMS];
    const sel = document.createElement('select');
    sel.id = 'ps-team-filter';
    sel.style.cssText = 'margin-bottom:8px;font-size:12px';
    allTeams.forEach(t => { const o=document.createElement('option'); o.value=t; o.textContent=t; sel.appendChild(o); });
    sel.value = STATE.psTeamFilter;
    sel.onchange = e => { STATE.psTeamFilter = e.target.value; renderPlatformStatus(); };
    wrap.innerHTML = '<label style="font-size:12px;color:var(--muted);margin-right:6px">Filter by Team:</label>';
    wrap.appendChild(sel);
  } else if(wrap){
    const sel = wrap.querySelector('select');
    if(sel) sel.value = STATE.psTeamFilter;
  }

  const data = platformStatusBreakdown();
  applyHeatAndLegend(data, 'Total', '#legend-platform-status', 'Row heat by Total');
  const headers = ['Platform', ...STATUSES, 'Total', 'LCR', 'QLCR'];
  const rows = data.map(r => {
    const o = {Platform:r.Platform};
    STATUSES.forEach(s => o[s] = fmtIN(r[s]));
    o.Total = fmtIN(r.Total);
    o.LCR = r.LCR == null ? '' : fmtPct(r.LCR);
    const qlcr = r.Total > 0 ? ((r.CONVERTED||0) + (r['IN PROCESS']||0)) / r.Total : 0;
    o.QLCR = r._tot ? '' : fmtPct(qlcr);
    o._tot = !!r._tot; o._heat = r._heat;
    return o;
  });
  makeSortableTable('#tbl-platform-status', headers, rows, renderPlatformStatus);
}

function renderLandingPageStatus(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-lp-status','fin23'); $('#legend-lp-status').innerHTML=''; return; }

  // Build campaign list from current raw data (after ref/cold filter)
  const campaigns = ['All', ...Array.from(new Set(
    applyRefColdFilter(STATE.raw).map(r => r['Campaign Name']).filter(Boolean)
  )).sort()];

  // Default to first actual campaign if not yet set
  if(!STATE.lpCampaignFilter || !campaigns.includes(STATE.lpCampaignFilter)){
    STATE.lpCampaignFilter = campaigns[1] || 'All';
  }

  // ---- Table mode selector ----
  const modeWrap = $('#lp-mode-wrap');
  if(modeWrap && !modeWrap.querySelector('select')){
    const sel = document.createElement('select');
    sel.id = 'lp-filter-table';
    sel.style.cssText = 'font-size:12px;margin-left:6px';
    [['All','Default (status-specific month)'],['SameMonth','Same Month (CTM)'],['AnyMonth','Any Month (created before selected)']].forEach(([v,t])=>{
      const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o);
    });
    sel.value = STATE.lpTableMode;
    sel.onchange = e => { STATE.lpTableMode = e.target.value; renderLandingPageStatus(); };
    modeWrap.appendChild(sel);
  } else if(modeWrap){
    const sel = modeWrap.querySelector('select');
    if(sel) sel.value = STATE.lpTableMode;
  }

  // ---- Team filter ----
  const teamWrap = $('#lp-team-filter-wrap');
  if(teamWrap && !teamWrap.querySelector('select')){
    const allTeams = ['All', ...FIXED_TEAMS];
    const sel = document.createElement('select');
    sel.id = 'lp-team-filter';
    sel.style.cssText = 'font-size:12px';
    allTeams.forEach(t=>{ const o=document.createElement('option'); o.value=t; o.textContent=t; sel.appendChild(o); });
    sel.value = STATE.lpTeamFilter;
    sel.onchange = e => { STATE.lpTeamFilter = e.target.value; STATE.lpLandingPages = []; renderLandingPageStatus(); };
    teamWrap.innerHTML = '<label style="font-size:12px;color:var(--muted);margin-right:6px">Team:</label>';
    teamWrap.appendChild(sel);
  } else if(teamWrap){
    const sel = teamWrap.querySelector('select');
    if(sel) sel.value = STATE.lpTeamFilter;
  }

  // ---- Campaign filter ----
  const campWrap = $('#lp-campaign-filter-wrap');
  if(campWrap){
    campWrap.innerHTML = '<label style="font-size:12px;color:var(--muted);margin-right:6px">Campaign:</label>';
    const sel = document.createElement('select');
    sel.id = 'lp-campaign-filter';
    sel.style.cssText = 'font-size:12px';
    campaigns.forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c; sel.appendChild(o); });
    sel.value = STATE.lpCampaignFilter;
    sel.onchange = e => { STATE.lpCampaignFilter = e.target.value; STATE.lpLandingPages = []; renderLandingPageStatus(); };
    campWrap.appendChild(sel);
  }

  // ---- Landing Page filter (multi-select) ----
  // Hand-rolled rather than buildMultiSelect: this filter allows deselecting
  // every option to show nothing ("None selected"), which buildMultiSelect
  // deliberately disallows (it auto-reverts to 'All' once selection hits 0).
  const lpWrap = $('#lp-lp-filter-wrap');
  if(lpWrap){
    let base = applyRefColdFilter(STATE.raw);
    if(STATE.lpTeamFilter !== 'All') base = base.filter(r => r.Team === STATE.lpTeamFilter);
    if(STATE.lpCampaignFilter && STATE.lpCampaignFilter !== 'All')
      base = base.filter(r => r['Campaign Name'] === STATE.lpCampaignFilter);
    const allLPs = [...new Set(base.map(r => r.landingPage || '(Blank)').filter(Boolean))].sort();
    if(!STATE.lpLandingPages.length) STATE.lpLandingPages = allLPs.slice();
    const selCount = STATE.lpLandingPages.length;
    const btnLabel = selCount === allLPs.length ? 'All Landing Pages' :
                     selCount === 0 ? 'None selected' :
                     selCount === 1 ? STATE.lpLandingPages[0] :
                     selCount + ' selected';
    lpWrap.innerHTML = '<label style="font-size:12px;color:var(--muted);margin-right:6px">Landing Page:</label>';
    const wrap = document.createElement('div');
    wrap.className = 'ms-wrap';
    const btn = document.createElement('div');
    btn.className = 'ms-btn';
    btn.innerHTML = '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px">'+escHtml(btnLabel)+'</span><span class="ms-arrow">▼</span>';
    btn.onclick = e => { e.stopPropagation(); wrap.classList.toggle('open'); };
    const dd = document.createElement('div');
    dd.className = 'ms-dropdown';
    // Select All / None
    const allOpt = document.createElement('label');
    allOpt.className = 'ms-opt ms-all';
    const allCb = document.createElement('input');
    allCb.type = 'checkbox';
    allCb.checked = selCount === allLPs.length;
    allCb.onchange = () => {
      STATE.lpLandingPages = allCb.checked ? allLPs.slice() : [];
      renderLandingPageStatus();
    };
    allOpt.appendChild(allCb);
    allOpt.appendChild(document.createTextNode(' Select All'));
    dd.appendChild(allOpt);
    for(const lp of allLPs){
      const opt = document.createElement('label');
      opt.className = 'ms-opt' + (STATE.lpLandingPages.includes(lp) ? ' ms-selected' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = STATE.lpLandingPages.includes(lp);
      cb.onchange = () => {
        if(cb.checked){ if(!STATE.lpLandingPages.includes(lp)) STATE.lpLandingPages.push(lp); }
        else { STATE.lpLandingPages = STATE.lpLandingPages.filter(x => x !== lp); }
        renderLandingPageStatus();
      };
      opt.appendChild(cb);
      opt.appendChild(document.createTextNode(' ' + lp));
      dd.appendChild(opt);
    }
    wrap.appendChild(btn);
    wrap.appendChild(dd);
    lpWrap.appendChild(wrap);
    document.addEventListener('click', () => wrap.classList.remove('open'), {once:true});
  }

  const data = landingPageStatusBreakdown();
  applyHeatAndLegend(data, 'Total', '#legend-lp-status', 'Row heat by Total');
  const headers = ['Landing Page', 'Campaign', ...STATUSES, 'Total'];
  const rows = data.map(r => {
    const o = {'Landing Page': r['Landing Page'], 'Campaign': r['Campaign'] || ''};
    STATUSES.forEach(s => o[s] = fmtIN(r[s]));
    o.Total = fmtIN(r.Total);
    o._tot = !!r._tot; o._heat = r._heat;
    return o;
  });
  makeSortableTable('#tbl-lp-status', headers, rows, renderLandingPageStatus);
}

function renderCampaignByTeam(){
  const hdr = $('#hdr-campaign-team'); if(hdr) hdr.textContent = filterSummary();
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-campaign-team','fin23'); $('#legend-campaign-team').innerHTML=''; return; }
  const toggleWrap = $('#campaign-team-toggle');
  if(toggleWrap){
    toggleWrap.innerHTML = '<div class="toggle-group">' +
      '<button class="tg-btn'+(STATE.campaignTeamMode==='current'?' active':'')+'" data-mode="current">CurrentRM</button>' +
      '<button class="tg-btn'+(STATE.campaignTeamMode==='first'?' active':'')+'" data-mode="first">FirstRM</button>' +
      '</div>';
    toggleWrap.querySelectorAll('.tg-btn').forEach(btn => {
      btn.onclick = () => { STATE.campaignTeamMode = btn.dataset.mode; renderCampaignByTeam(); };
    });
  }
  const {campaigns, rows} = campaignByTeam();
  const headers = ['Team', ...campaigns, 'Total'];
  applyHeatAndLegend(rows, 'Total', '#legend-campaign-team', 'Row heat by Total Leads');
  const data = rows.map(r => {
    const o = {Team:r.Team, _tot:r._tot, _heat:r._heat};
    campaigns.forEach(c => o[c] = fmtIN(r[c]));
    o.Total = fmtIN(r.Total);
    return o;
  });
  makeSortableTable('#tbl-campaign-team', headers, data, renderCampaignByTeam);
}

function renderTeam(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-team','fin23'); $('#legend-team').innerHTML=''; return; }
  const toggleWrap = $('#team-perf-toggle');
  if(toggleWrap){
    toggleWrap.innerHTML = '<div class="toggle-group">' +
      '<button class="tg-btn'+(STATE.teamPerfMode==='current'?' active':'')+'" data-mode="current">CurrentRM</button>' +
      '<button class="tg-btn'+(STATE.teamPerfMode==='first'?' active':'')+'" data-mode="first">FirstRM</button>' +
      '</div>';
    toggleWrap.querySelectorAll('.tg-btn').forEach(btn => {
      btn.onclick = () => { STATE.teamPerfMode = btn.dataset.mode; renderTeam(); };
    });
  }
  const teamFilterWrap = $('#team-perf-team-filter-wrap');
  if(teamFilterWrap){
    buildMultiSelect('#team-perf-team-filter-wrap', ['All', ...FIXED_TEAMS], STATE.teamPerfTeamFilter,
      val => { STATE.teamPerfTeamFilter = val; renderTeam(); }, {multi: false});
  }

  const selectedTeam = STATE.teamPerfTeamFilter;
  if(selectedTeam && selectedTeam !== 'All'){
    // Drill-down: one row per RM in the selected team, same status columns.
    const data = teamPerformanceByRM(selectedTeam);
    const headers = ['RM', 'Total Leads', 'CONVERTED', 'Conv. Rate', 'IN PROCESS', 'FOLLOW UP', 'ASSIGNED', 'RE-ASSIGNED', 'ON HOLD', 'DEAD'];
    applyHeatAndLegend(data, 'Total Leads', '#legend-team', 'Row heat by Total Leads');
    const rows = data.map(r => ({
      RM: r.RM,
      'Total Leads': fmtIN(r['Total Leads']),
      CONVERTED: fmtIN(r.CONVERTED),
      'Conv. Rate': fmtPct(r['Conv. Rate']),
      'IN PROCESS': fmtIN(r['IN PROCESS']),
      'FOLLOW UP': fmtIN(r['FOLLOW UP']),
      ASSIGNED: fmtIN(r.ASSIGNED),
      'RE-ASSIGNED': fmtIN(r['RE-ASSIGNED']),
      'ON HOLD': fmtIN(r['ON HOLD']),
      DEAD: fmtIN(r.DEAD),
      _heat: r._heat, _tot: r._tot,
    }));
    makeSortableTable('#tbl-team', headers, rows, renderTeam);
    return;
  }

  const data = teamPerformance();
  const headers = ['Team', 'Total Leads', 'CONVERTED', 'Conv. Rate', 'IN PROCESS', 'FOLLOW UP', 'ASSIGNED', 'RE-ASSIGNED', 'ON HOLD', 'DEAD'];
  applyHeatAndLegend(data, 'Total Leads', '#legend-team', 'Row heat by Total Leads');
  const rows = data.map(r => ({
    Team: r.Team,
    'Total Leads': fmtIN(r['Total Leads']),
    CONVERTED: fmtIN(r.CONVERTED),
    'Conv. Rate': fmtPct(r['Conv. Rate']),
    'IN PROCESS': fmtIN(r['IN PROCESS']),
    'FOLLOW UP': fmtIN(r['FOLLOW UP']),
    ASSIGNED: fmtIN(r.ASSIGNED),
    'RE-ASSIGNED': fmtIN(r['RE-ASSIGNED']),
    'ON HOLD': fmtIN(r['ON HOLD']),
    DEAD: fmtIN(r.DEAD),
    _heat: r._heat, _tot: r._tot,
  }));
  makeSortableTable('#tbl-team', headers, rows, renderTeam);
}

function renderRmTransfer(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-rm-transfer','fin23'); return; }
  const {teams, totalTransfers} = rmTransferData();
  const el = $('#tbl-rm-transfer');
  if(!el) return;
  if(!teams.length){
    el.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:13px">No RM transfers found for the selected period.</div>';
    return;
  }
  let html = '<table class="data"><thead><tr>' +
    '<th style="text-align:center;width:30px"></th>' +
    '<th style="text-align:left">From Team</th>' +
    '<th>Total Transferred</th>' +
    '<th style="text-align:left">Top Destinations</th>' +
    '</tr></thead><tbody>';
  for(let i=0; i<teams.length; i++){
    const t = teams[i];
    const destStr = Object.entries(t.destinations).sort((a,b)=>b[1]-a[1]).map(([tm,c])=>'→ '+tm+' ('+c+')').join(', ');
    html += '<tr class="transfer-team-row" data-idx="'+i+'">' +
      '<td class="toggle-icon" style="text-align:center;font-size:12px;color:var(--orange)">&#9654;</td>' +
      '<td style="text-align:left;font-weight:700">'+escHtml(t.team)+'</td>' +
      '<td>'+fmtIN(t.total)+'</td>' +
      '<td style="text-align:left;font-size:12px;color:var(--muted)">'+escHtml(destStr)+'</td></tr>';
    html += '<tr class="transfer-detail" data-parent="'+i+'" style="display:none">' +
      '<td colspan="4" class="transfer-detail-cell">' +
      '<table class="data compact"><thead><tr>' +
      '<th style="text-align:left">FirstRM Name</th>' +
      '<th style="text-align:left">Campaign</th>' +
      '<th># Transferred</th>' +
      '<th style="text-align:left">Transferred To (CurrentRM)</th>' +
      '<th style="text-align:left">To Team</th>' +
      '<th style="text-align:left">Lead Status</th>' +
      '</tr></thead><tbody>';
    for(const d of t.detailRows){
      html += '<tr>' +
        '<td style="text-align:left">'+escHtml(d.firstRm)+'</td>' +
        '<td style="text-align:left">'+escHtml(d.campaign)+'</td>' +
        '<td>'+fmtIN(d.count)+'</td>' +
        '<td style="text-align:left">'+escHtml(d.currentRm)+'</td>' +
        '<td style="text-align:left">'+escHtml(d.currentTeam)+'</td>' +
        '<td style="text-align:left">'+escHtml(d.status)+'</td></tr>';
    }
    html += '</tbody></table></td></tr>';
  }
  html += '<tr class="grand"><td></td><td style="text-align:left">Grand Total</td><td>'+fmtIN(totalTransfers)+'</td><td></td></tr>';
  html += '</tbody></table>';
  el.innerHTML = html;
  el.querySelectorAll('.transfer-team-row').forEach(row => {
    row.onclick = () => {
      const idx = row.dataset.idx;
      const detail = el.querySelector('.transfer-detail[data-parent="'+idx+'"]');
      const icon = row.querySelector('.toggle-icon');
      const isOpen = icon.innerHTML === '&#9660;' || icon.textContent === '▼';
      icon.innerHTML = isOpen ? '&#9654;' : '&#9660;';
      detail.style.display = isOpen ? 'none' : '';
    };
  });
}

function renderIncome(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-income','fin23'); $('#legend-income').innerHTML=''; return; }
  const data = incomeSegment();
  applyHeatAndLegend(data, 'Leads', '#legend-income', 'Row heat by Leads');
  renderTable('#tbl-income',
    ['Income Band','Leads','Converted','In Process','Quality Leads','Conv. Rate','QLCR','Share %'],
    data.map(r => ({
      'Income Band': r['Income Band'],
      Leads: fmtIN(r.Leads),
      Converted: fmtIN(r.Converted),
      'In Process': fmtIN(r['In Process']),
      'Quality Leads': fmtIN(r['Quality Leads']),
      'Conv. Rate': fmtPct(r['Conv. Rate']),
      QLCR: fmtPct(r.QLCR),
      'Share %': fmtPct(r['Share %']),
      _heat: r._heat, _tot: r._tot,
    })));
}

function renderCostSummary(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-cost-summary','fin23'); $('#legend-cost-summary').innerHTML=''; return; }
  const data = costSummaryByCampaign();
  applyHeatAndLegend(data, 'Leads', '#legend-cost-summary', 'Row heat by Leads');
  renderTable('#tbl-cost-summary', ['Campaign','Leads','Cost (₹)','CPL (₹)','Quality Leads','CPQL (₹)','Converted Leads','CAC (₹)'], data.map(r => ({
    Campaign:r.Campaign, Leads:fmtIN(r.Leads), 'Cost (₹)':fmtINR(r['Cost (₹)']), 'CPL (₹)':fmtINR(r['CPL (₹)']),
    'Quality Leads':fmtIN(r['Quality Leads']), 'CPQL (₹)':fmtINR(r['CPQL (₹)']),
    'Converted Leads':fmtIN(r['Converted Leads']), 'CAC (₹)':fmtINR(r['CAC (₹)']),
    _tot:r._tot, _heat:r._heat,
  })));
}

function renderCplRmLegacy(){
  const data = costPerLeadPerRM();
  renderTable('#tbl-cpl-rm', ['Team','RM','Leads','Cost (₹)','CPL (₹)'], data.map(r=>({
    Team:r.Team, RM:r.RM, Leads:fmtIN(r.Leads), 'Cost (₹)':fmtINR(r['Cost (₹)']), 'CPL (₹)':fmtINR(r['CPL (₹)']),
  })));
}

function renderCplRm(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-cpl-rm','fin23'); $('#legend-cpl-rm').innerHTML=''; return; }
  const data = costPerLeadPerRMWithTotals();
  data.forEach(r => { r.totalLeadsVal = r.totalLeads; });
  applyHeatAndLegend(data, 'totalLeadsVal', '#legend-cpl-rm', 'Row heat by Total Leads');
  const headers = ['Team','RM','Total Leads','Total Cost (INR)','CPL (INR)','Quality Leads','CPQL (INR)'];
  const rows = data.map(r => ({
    Team:r.Team,
    RM:r.RM,
    'Total Leads':fmtIN(r.totalLeads),
    'Total Cost (INR)':fmtINR(r.totalCost),
    'CPL (INR)':fmtINR(r.cpl),
    'Quality Leads':fmtIN(r.qualLeads),
    'CPQL (INR)':fmtINR(r.cpql),
    _tot:r._tot, _heat:r._heat,
  }));
  makeSortableTable('#tbl-cpl-rm', headers, rows, renderCplRm);
}

function renderInProcessDataset(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-inprocess-ds','fin23'); return; }
  const month = STATE.filterMonth;
  const title = 'IN-PROCESS DATE SET, STATUS ≠ IN PROCESS   LPM: '+month+'  |  '+STATE.filterRefCold;
  $('#inprocess-ds-title').textContent = title;
  const {statuses, data} = inProcessDataset();
  const headers = ['Team', ...statuses, 'Total'];
  const rows = data.map(r => {
    const o = {Team: r.Team, _tot: !!r._tot};
    statuses.forEach(s => o[s] = fmtIN(r[s]));
    o.Total = fmtIN(r.Total);
    return o;
  });
  renderTable('#tbl-inprocess-ds', headers, rows);
}

function renderConvertedDataset(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-converted-ds','fin23'); return; }
  const month = STATE.filterMonth;
  const title = 'CONVERTED DATE SET, STATUS ≠ CONVERTED   CM: '+month+'  |  '+STATE.filterRefCold;
  $('#converted-ds-title').textContent = title;
  const {statuses, data} = convertedDataset();
  const headers = ['Team', ...statuses, 'Total'];
  const rows = data.map(r => {
    const o = {Team: r.Team, _tot: !!r._tot};
    statuses.forEach(s => o[s] = fmtIN(r[s]));
    o.Total = fmtIN(r.Total);
    return o;
  });
  renderTable('#tbl-converted-ds', headers, rows);
}

function renderMTD(){
  if(!STATE.filesLoaded.fin23){ tabNotUploaded('#mtd-tables','fin23'); return; }
  const data = mtdPerformance();
  const byMonth = {};
  data.forEach(r => (byMonth[r.Month] = byMonth[r.Month]||[]).push(r));
  $('#mtd-tables').innerHTML = Object.entries(byMonth).map(([m, rows]) => `
    <div class="mtd-block">
      <h3>${m}</h3>
      <div class="table-wrap">
      <table class="data">
        <thead>
          <tr><th rowspan="2">Campaign</th><th colspan="2">Leads</th><th colspan="2">Converted</th><th colspan="2">In Process</th><th colspan="2">Qualified</th></tr>
          <tr><th>MTD</th><th>Projected</th><th>MTD</th><th>Projected</th><th>MTD</th><th>Projected</th><th>MTD</th><th>Projected</th></tr>
        </thead>
        <tbody>${rows.map(r=>`<tr>
          <td>${r.Campaign}</td>
          <td>${fmtIN(r.Leads)}</td><td>${r.LeadsProj.toFixed(1)}</td>
          <td>${fmtIN(r.Conv)}</td><td>${r.ConvProj.toFixed(1)}</td>
          <td>${fmtIN(r.InProc)}</td><td>${r.InProcProj.toFixed(1)}</td>
          <td>${fmtIN(r.Qual)}</td><td>${r.QualProj.toFixed(1)}</td>
        </tr>`).join('')}</tbody>
      </table>
      </div>
    </div>`).join('');
}

function renderCPC(){
  const cpc = STATE.cost; if(!cpc.length){ $('#cpc-editor').innerHTML='<p>No data.</p>'; return; }
  const header = cpc[0];
  const head = '<thead><tr>'+header.map((h,i)=>`<th>${i===0?'Campaign':toMmmYyyy(h)}</th>`).join('')+'</tr></thead>';
  const body = '<tbody>'+cpc.slice(1).map((row,ri)=>{
    return '<tr>'+row.map((v,ci)=>{
      if(ci===0) return `<td>${v}</td>`;
      return `<td><input type="number" data-r="${ri+1}" data-c="${ci}" value="${v||0}" class="cpc-input"/></td>`;
    }).join('')+'</tr>';
  }).join('')+'</tbody>';
  $('#cpc-editor').innerHTML = '<table class="data editable">'+head+body+'</table>';
  $$('.cpc-input').forEach(inp => {
    inp.oninput = () => {
      STATE.cost[+inp.dataset.r][+inp.dataset.c] = +inp.value || 0;
      try{ localStorage.setItem(CONFIG.STORAGE_KEYS.COST, JSON.stringify(STATE.cost)); }catch(e){}
      renderCostSummary(); renderCplRm(); renderMTD();
    };
  });
}

function renderProcessed(){
  if(!STATE.filesLoaded.fin23){
    ['#proc-platform','#proc-status','#proc-team'].forEach(s=>setNotUploaded(s,'fin23'));
    return;
  }
  const months = STATE.months;
  const plat = processedPlatform();
  renderTable('#proc-platform', ['Platform', ...months, 'total'], plat.map(r => {
    const o = {Platform:r.Platform};
    months.forEach(m => o[m] = fmtIN(r[m]));
    o.total = fmtIN(r.total); o._tot = !!r._tot;
    return o;
  }));
  const stat = processedStatus();
  renderTable('#proc-status', ['Status', ...months, 'total'], stat.map(r => {
    const o = {Status:r.Status};
    months.forEach(m => o[m] = fmtIN(r[m]));
    o.total = fmtIN(r.total); return o;
  }));
  const data = teamPerformance();
  const headers = ['Team', 'Total Leads', 'CONVERTED', 'Conv. Rate', 'IN PROCESS', 'FOLLOW UP', 'ASSIGNED', 'RE-ASSIGNED', 'ON HOLD', 'DEAD'];
  renderTable('#proc-team', headers, data.map(r => ({
    Team: r.Team,
    'Total Leads': fmtIN(r['Total Leads']),
    CONVERTED: fmtIN(r.CONVERTED),
    'Conv. Rate': fmtPct(r['Conv. Rate']),
    'IN PROCESS': fmtIN(r['IN PROCESS']),
    'FOLLOW UP': fmtIN(r['FOLLOW UP']),
    ASSIGNED: fmtIN(r.ASSIGNED),
    'RE-ASSIGNED': fmtIN(r['RE-ASSIGNED']),
    'ON HOLD': fmtIN(r['ON HOLD']),
    DEAD: fmtIN(r.DEAD),
  })));
}

function rawCellValue(row, col){
  if(col === 'Team of FirstRM'){
    const key = normalizeNameKey(row.firstRmName);
    return key ? (STATE.teamMap[key] || 'SV') : '';
  }
  return String(row[col] ?? '');
}

function hasRawFilter(col){
  return Object.prototype.hasOwnProperty.call(STATE.rawFilters, col);
}

function rawFilterDisplay(col){
  if(!hasRawFilter(col)) return '';
  const filterVal = STATE.rawFilters[col];
  if(filterVal && typeof filterVal === 'object' && !Array.isArray(filterVal)){
    return `contains: "${filterVal.value}"`;
  }
  const vals = filterVal || [];
  if(vals.length === 0) return 'None';
  const display = vals.map(v => v === '' ? '(blank)' : v);
  return display.length <= 2 ? display.join(', ') : display.length + ' selected';
}

function rawFilteredRows(opts={}){
  const excludeCol = opts.excludeCol || '';
  const searchBox = $('#raw-search');
  const filter = (searchBox ? searchBox.value : '').toLowerCase();
  return STATE.raw.filter(row => {
    if(filter && !RAW_COLUMNS.some(col => rawCellValue(row, col).toLowerCase().includes(filter))) return false;
    for(const [col, filterVal] of Object.entries(STATE.rawFilters)){
      if(col === excludeCol) continue;
      if(filterVal && typeof filterVal === 'object' && !Array.isArray(filterVal)){
        if(!rawCellValue(row, col).toLowerCase().includes(filterVal.value.toLowerCase())) return false;
        continue;
      }
      if(!Array.isArray(filterVal)) continue;
      if(!filterVal.includes(rawCellValue(row, col))) return false;
    }
    return true;
  });
}

function rawFilterValues(col){
  const set = new Set(rawFilteredRows({excludeCol: col}).map(row => rawCellValue(row, col)));
  return Array.from(set).sort((a,b) => {
    if(a === '' && b !== '') return -1;
    if(a !== '' && b === '') return 1;
    return a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'});
  });
}

function handleRawFilterOutside(e){
  const menu = $('#raw-filter-menu');
  if(menu && !menu.contains(e.target) && !e.target.classList.contains('raw-filter-btn')) closeRawFilterMenu();
}

function closeRawFilterMenu(){
  const menu = $('#raw-filter-menu');
  if(menu) menu.remove();
  document.removeEventListener('click', handleRawFilterOutside, true);
  window.removeEventListener('resize', closeRawFilterMenu);
}

function openRawFilterMenu(col, anchor){
  closeRawFilterMenu();
  const values = rawFilterValues(col);
  const active = hasRawFilter(col);
  const selected = new Set(active ? (STATE.rawFilters[col] || []).map(String) : values);
  const menu = document.createElement('div');
  menu.id = 'raw-filter-menu';
  menu.className = 'raw-filter-menu';
  menu.innerHTML = `
    <div class="raw-filter-title">${escHtml(col)}</div>
    <input type="text" class="raw-filter-search" placeholder="Search values">
    <div class="raw-filter-actions">
      <button type="button" class="secondary" data-action="all">All</button>
      <button type="button" class="secondary" data-action="none">None</button>
    </div>
    <div class="raw-filter-options">
      ${values.map((value, idx) => `
        <label class="raw-filter-option">
          <input type="checkbox" data-idx="${idx}" ${selected.has(value) ? 'checked' : ''}>
          <span title="${escHtml(value || '(blank)')}">${escHtml(value || '(blank)')}</span>
        </label>
      `).join('') || '<div class="raw-filter-empty">No values</div>'}
    </div>
    <div class="raw-filter-footer">
      <button type="button" class="secondary" data-action="reset">Reset</button>
      <button type="button" data-action="apply">Apply</button>
    </div>
  `;
  document.body.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  const width = 280;
  menu.style.width = width + 'px';
  menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 8)) + 'px';

  menu.addEventListener('click', e => e.stopPropagation());
  menu.querySelector('[data-action="all"]').onclick = () => {
    menu.querySelectorAll('input[type=checkbox]').forEach(inp => inp.checked = true);
  };
  menu.querySelector('[data-action="none"]').onclick = () => {
    menu.querySelectorAll('input[type=checkbox]').forEach(inp => inp.checked = false);
  };
  menu.querySelector('[data-action="reset"]').onclick = () => {
    delete STATE.rawFilters[col];
    closeRawFilterMenu();
    renderRawData();
  };
  menu.querySelector('[data-action="apply"]').onclick = () => {
    const checked = Array.from(menu.querySelectorAll('input[type=checkbox]:checked')).map(inp => values[+inp.dataset.idx]);
    if(checked.length === values.length) delete STATE.rawFilters[col];
    else STATE.rawFilters[col] = checked;
    closeRawFilterMenu();
    renderRawData();
  };
  const search = menu.querySelector('.raw-filter-search');
  const options = Array.from(menu.querySelectorAll('.raw-filter-option'));
  search.oninput = () => {
    const q = search.value.toLowerCase();
    options.forEach(opt => {
      opt.style.display = opt.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
    });
  };
  search.onkeydown = e => {
    if(e.key === 'Enter' && search.value.trim()){
      STATE.rawFilters[col] = {type:'text', value: search.value.trim()};
      closeRawFilterMenu();
      renderRawData();
    }
  };
  search.focus();

  setTimeout(() => document.addEventListener('click', handleRawFilterOutside, true), 0);
  window.addEventListener('resize', closeRawFilterMenu);
}

function bindRawFilterButtons(){
  $$('.raw-filter-btn').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      openRawFilterMenu(btn.dataset.col, btn);
    };
  });
}

// ---- B2B raw data filter ----
function b2bCellValue(row, col){ return String(row[col] ?? ''); }
function b2bHasFilter(col){ return Object.prototype.hasOwnProperty.call(STATE.b2bFilters, col); }
function b2bFilterDisplay(col){
  if(!b2bHasFilter(col)) return '';
  const vals = STATE.b2bFilters[col] || [];
  if(!vals.length) return 'None';
  const d = vals.map(v => v===''?'(blank)':v);
  return d.length <= 2 ? d.join(', ') : d.length+' selected';
}
function b2bFilteredRows(opts={}){
  const excl = opts.excludeCol||'';
  const q = ($('#b2b-search')||{value:''}).value.toLowerCase();
  return STATE.b2bRaw.filter(row => {
    if(q && !B2B_RAW_COLUMNS.some(c => b2bCellValue(row,c).toLowerCase().includes(q))) return false;
    for(const [col, vals] of Object.entries(STATE.b2bFilters)){
      if(col===excl || !Array.isArray(vals)) continue;
      if(!vals.includes(b2bCellValue(row,col))) return false;
    }
    return true;
  });
}
function b2bFilterValues(col){
  const set = new Set(b2bFilteredRows({excludeCol:col}).map(r => b2bCellValue(r,col)));
  return Array.from(set).sort((a,b)=>{
    if(a===''&&b!=='') return -1; if(a!==''&&b==='') return 1;
    return a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});
  });
}
function handleB2BFilterOutside(e){
  const m=$('#b2b-filter-menu');
  if(m && !m.contains(e.target) && !e.target.classList.contains('b2b-filter-btn')) closeB2BFilterMenu();
}
function closeB2BFilterMenu(){
  const m=$('#b2b-filter-menu'); if(m) m.remove();
  document.removeEventListener('click',handleB2BFilterOutside,true);
  window.removeEventListener('resize',closeB2BFilterMenu);
}
function openB2BFilterMenu(col, anchor){
  closeB2BFilterMenu();
  const values = b2bFilterValues(col);
  const active = b2bHasFilter(col);
  const selected = new Set(active ? (STATE.b2bFilters[col]||[]).map(String) : values);
  const menu = document.createElement('div');
  menu.id = 'b2b-filter-menu'; menu.className = 'raw-filter-menu';
  menu.innerHTML = `
    <div class="raw-filter-title">${escHtml(col)}</div>
    <input type="text" class="raw-filter-search" placeholder="Search values">
    <div class="raw-filter-actions">
      <button type="button" class="secondary" data-action="all">All</button>
      <button type="button" class="secondary" data-action="none">None</button>
    </div>
    <div class="raw-filter-options">
      ${values.map((v,i)=>`<label class="raw-filter-option"><input type="checkbox" data-idx="${i}" ${selected.has(v)?'checked':''}><span title="${escHtml(v||'(blank)')}">${escHtml(v||'(blank)')}</span></label>`).join('')||'<div class="raw-filter-empty">No values</div>'}
    </div>
    <div class="raw-filter-footer">
      <button type="button" class="secondary" data-action="reset">Reset</button>
      <button type="button" data-action="apply">Apply</button>
    </div>`;
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect(), w=280;
  menu.style.cssText = `width:${w}px;left:${Math.max(8,Math.min(rect.left,window.innerWidth-w-8))}px;top:${Math.max(8,Math.min(rect.bottom+6,window.innerHeight-menu.offsetHeight-8))}px`;
  menu.addEventListener('click', e=>e.stopPropagation());
  menu.querySelector('[data-action="all"]').onclick  = ()=>menu.querySelectorAll('input[type=checkbox]').forEach(i=>i.checked=true);
  menu.querySelector('[data-action="none"]').onclick = ()=>menu.querySelectorAll('input[type=checkbox]').forEach(i=>i.checked=false);
  menu.querySelector('[data-action="reset"]').onclick = ()=>{ delete STATE.b2bFilters[col]; closeB2BFilterMenu(); renderB2BRawData(); };
  menu.querySelector('[data-action="apply"]').onclick = ()=>{
    const checked = Array.from(menu.querySelectorAll('input[type=checkbox]:checked')).map(i=>values[+i.dataset.idx]);
    if(checked.length===values.length) delete STATE.b2bFilters[col]; else STATE.b2bFilters[col]=checked;
    closeB2BFilterMenu(); renderB2BRawData();
  };
  const srch=menu.querySelector('.raw-filter-search'), opts2=Array.from(menu.querySelectorAll('.raw-filter-option'));
  srch.oninput=()=>{ const q=srch.value.toLowerCase(); opts2.forEach(o=>{ o.style.display=o.textContent.toLowerCase().includes(q)?'flex':'none'; }); };
  srch.focus();
  setTimeout(()=>document.addEventListener('click',handleB2BFilterOutside,true),0);
  window.addEventListener('resize',closeB2BFilterMenu);
}
function bindB2BFilterButtons(){
  $$('.b2b-filter-btn').forEach(btn => {
    btn.onclick = e => { e.stopPropagation(); openB2BFilterMenu(btn.dataset.col, btn); };
  });
}
function renderB2BRawData(){
  if(!STATE.filesLoaded.b2b){ $('#b2b-raw-meta').textContent=''; setNotUploaded('#b2b-raw-table-wrap','b2b'); return; }
  closeB2BFilterMenu();
  const rows = b2bFilteredRows(), limit=500, slice=rows.slice(0,limit);
  const head = '<thead><tr>'+B2B_RAW_COLUMNS.map(col => {
    const active=b2bHasFilter(col), sel=b2bFilterDisplay(col);
    return `<th><div class="raw-filter-head"><span>${escHtml(col)}</span><button type="button" class="b2b-filter-btn ${active?'active':''}" data-col="${escHtml(col)}" title="Filter ${escHtml(col)}">v</button></div>${sel?`<div class="raw-filter-selected" title="${escHtml(sel)}">${escHtml(sel)}</div>`:''}</th>`;
  }).join('')+'</tr></thead>';
  const body = '<tbody>'+slice.map(r=>'<tr>'+B2B_RAW_COLUMNS.map(col=>`<td>${escHtml(b2bCellValue(r,col))}</td>`).join('')+'</tr>').join('')+'</tbody>';
  const af = Object.keys(STATE.b2bFilters).length;
  $('#b2b-raw-meta').textContent = `Showing ${slice.length.toLocaleString()} of ${rows.length.toLocaleString()} rows (total ${STATE.b2bRaw.length.toLocaleString()})${af?` | Filters: ${af}`:''}`;
  $('#b2b-raw-table-wrap').innerHTML = '<table class="data compact raw-data-table">'+head+body+'</table>';
  bindB2BFilterButtons();
  requestAnimationFrame(attachAllMirrors);
}

function renderRawData(){
  if(!STATE.filesLoaded.fin23){ $('#raw-meta').textContent=''; setNotUploaded('#raw-table-wrap','fin23'); return; }
  closeRawFilterMenu();
  const rows = rawFilteredRows();
  const limit = 250;
  const slice = rows.slice(0, limit);
  const head = '<thead><tr>'+RAW_COLUMNS.map(col => {
    const active = hasRawFilter(col);
    const selected = rawFilterDisplay(col);
    return `<th>
      <div class="raw-filter-head">
        <span>${escHtml(col)}</span>
        <button type="button" class="raw-filter-btn ${active ? 'active' : ''}" data-col="${escHtml(col)}" title="Filter ${escHtml(col)}">v</button>
      </div>
      ${selected ? `<div class="raw-filter-selected" title="${escHtml(selected)}">${escHtml(selected)}</div>` : ''}
    </th>`;
  }).join('')+'</tr></thead>';
  const body = '<tbody>'+slice.map(r=>'<tr>'+RAW_COLUMNS.map(col=>`<td>${escHtml(rawCellValue(r, col))}</td>`).join('')+'</tr>').join('')+'</tbody>';
  const activeFilters = Object.keys(STATE.rawFilters).length;
  $('#raw-meta').textContent = `Showing ${slice.length.toLocaleString()} of ${rows.length.toLocaleString()} rows (total ${STATE.raw.length.toLocaleString()})${activeFilters ? ` | Filters: ${activeFilters}` : ''}.`;
  $('#raw-table-wrap').innerHTML = '<table class="data compact raw-data-table">'+head+body+'</table>';
  bindRawFilterButtons();
  requestAnimationFrame(attachAllMirrors);
}

function downloadRawExcel(){
  const rows = rawFilteredRows();
  const data = [RAW_COLUMNS.slice()];
  for(const r of rows){
    data.push(RAW_COLUMNS.map(col => rawCellValue(r, col)));
  }
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'RAW_DATA');
  const activeFilters = Object.keys(STATE.rawFilters).length;
  const search = ($('#raw-search')||{}).value||'';
  const suffix = (activeFilters || search) ? '_filtered' : '';
  XLSX.writeFile(wb, 'RAW_DATA' + suffix + '.xlsx');
}

function renderEmployee(){
  const rows = STATE.empref;
  if(!rows.length) rows.push(['Emp Code','Team','Name']);
  const header = rows[0];
  const head = '<thead><tr>'+header.map((h,i)=>`<th>${h}</th>`).join('')+(rows.length>1?'<th></th>':'')+'</tr></thead>';
  const body = '<tbody>'+rows.slice(1).map((row,ri)=>{
    return '<tr>'+row.map((v,ci)=>`<td><input class="emp-input" data-r="${ri+1}" data-c="${ci}" value="${(v??'').toString().replace(/"/g,'&quot;')}"/></td>`).join('')
      +`<td><button class="secondary emp-del" data-r="${ri+1}">×</button></td></tr>`;
  }).join('')+'</tbody>';
  $('#emp-editor').innerHTML = '<table class="data editable">'+head+body+'</table>';
  $$('.emp-input').forEach(inp => {
    inp.oninput = () => {
      STATE.empref[+inp.dataset.r][+inp.dataset.c] = inp.value;
      persistEmployee();
      rebuildTeamMap();
      renderAffectedByTeamChange();
    };
  });
  $$('.emp-del').forEach(btn => {
    btn.onclick = () => {
      STATE.empref.splice(+btn.dataset.r, 1);
      persistEmployee(); rebuildTeamMap(); renderEmployee(); renderAffectedByTeamChange(); initRevFilters();
    };
  });
}
function persistEmployee(){
  try{ localStorage.setItem(CONFIG.STORAGE_KEYS.EMPREF, JSON.stringify(STATE.empref)); }catch(e){}
}

function renderRMMaster(){
  const rows = STATE.rmMaster;
  if(!rows.length) rows.push(['Source Name','Correct RM Name','Team']);
  const header = rows[0];
  const head = '<thead><tr>'+header.map(h=>`<th>${escHtml(h)}</th>`).join('')+'<th></th></tr></thead>';
  const body = '<tbody>'+rows.slice(1).map((row,ri)=>{
    return '<tr>'+row.map((v,ci)=>`<td><input class="rmm-input" data-r="${ri+1}" data-c="${ci}" value="${(v??'').toString().replace(/"/g,'&quot;')}"/></td>`).join('')
      +`<td><button class="secondary rmm-del" data-r="${ri+1}">×</button></td></tr>`;
  }).join('')+'</tbody>';
  $('#rmm-editor').innerHTML = '<table class="data editable">'+head+body+'</table>';

  const stats = $('#rmm-stats');
  if(stats){
    const total = rows.length - 1;
    const teams = new Set(rows.slice(1).map(r => (r[2]||'').toString().trim()).filter(Boolean));
    const correct = new Set(rows.slice(1).map(r => (r[1]||'').toString().trim()).filter(Boolean));
    stats.innerHTML = `<strong>${total}</strong> mappings · <strong>${correct.size}</strong> unique canonical RMs · <strong>${teams.size}</strong> teams referenced`;
  }

  $$('.rmm-input').forEach(inp => {
    inp.oninput = () => {
      STATE.rmMaster[+inp.dataset.r][+inp.dataset.c] = inp.value;
      persistRMMaster();
      buildRMMasterLookup();
      // re-map FY/PA mappedRM since lookup changed
      if(STATE.fy && STATE.fy.length) STATE.fy.forEach(r => { r.mappedRM = mapRM(r.rmName); });
      if(STATE.pa && STATE.pa.length) STATE.pa.forEach(r => { r.mappedRM = mapRM(r.advisor); });
      // refresh stats only; do not full re-render the editor (would lose focus)
      const total = STATE.rmMaster.length - 1;
      const teams = new Set(STATE.rmMaster.slice(1).map(r => (r[2]||'').toString().trim()).filter(Boolean));
      const correct = new Set(STATE.rmMaster.slice(1).map(r => (r[1]||'').toString().trim()).filter(Boolean));
      if(stats) stats.innerHTML = `<strong>${total}</strong> mappings · <strong>${correct.size}</strong> unique canonical RMs · <strong>${teams.size}</strong> teams referenced`;
    };
  });
  $$('.rmm-del').forEach(btn => {
    btn.onclick = () => {
      STATE.rmMaster.splice(+btn.dataset.r, 1);
      persistRMMaster();
      buildRMMasterLookup();
      if(STATE.fy && STATE.fy.length) STATE.fy.forEach(r => { r.mappedRM = mapRM(r.rmName); });
      if(STATE.pa && STATE.pa.length) STATE.pa.forEach(r => { r.mappedRM = mapRM(r.advisor); });
      renderRMMaster();
    };
  });
}
function renderAffectedByTeamChange(){
  renderDashboard();
  renderProcessed();
  initRevFilters();
  renderRMRev();
}

function renderMissing(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-missing','fin23'); return; }
  const rows = missingLeads();
  const cols = ['currentRmName','Team','clientName','Campaign Name','platformName','createdDate','leadStatus','Reason'];
  const head = '<thead><tr>'+cols.map(c=>`<th>${c}</th>`).join('')+'</tr></thead>';
  const body = '<tbody>'+rows.slice(0,500).map(r=>'<tr>'+cols.map(c=>`<td>${r[c]??''}</td>`).join('')+'</tr>').join('')+'</tbody>';
  $('#tbl-missing').innerHTML = `<div class="meta">${rows.length.toLocaleString()} rows flagged (showing first 500).</div><table class="data compact">${head}${body}</table>`;
}

function renderRMRev(){
  if(!STATE.premiumUnlocked) return;
  if(!STATE.filesLoaded.rev){ setNotUploaded('#tbl-rmrev','rev'); const cw=$('#rev-chart-wrap'); if(cw) cw.innerHTML=notUploadedHTML('rev'); return; }
  const isTeamView = isAllRevTeams();
  const data = isTeamView ? revenueAggregatedByTeam() : revenueAggregated();
  const headers = isTeamView ? ['Team','# Revenue-Based','# Not Eligible','Total Revenue (₹)'] : ['RM','Team','# Revenue-Based','# Not Eligible','Total Revenue (₹)'];
  const rows = data.map(r => isTeamView
    ? { Team: r.Team, '# Revenue-Based': fmtIN(r.RevBased), '# Not Eligible': fmtIN(r.NotEligible), 'Total Revenue (₹)': fmtINR(r.Total) }
    : { RM: r.RM, Team: r.Team, '# Revenue-Based': fmtIN(r.RevBased), '# Not Eligible': fmtIN(r.NotEligible), 'Total Revenue (₹)': fmtINR(r.Total) }
  );
  const gt = buildGrandTotalRow(isTeamView ? 'Team' : 'RM', 'Grand Total', ['RevBased', 'NotEligible', 'Total'], data);
  const gtRow = isTeamView
    ? { Team: gt.Team, '# Revenue-Based': fmtIN(gt.RevBased), '# Not Eligible': fmtIN(gt.NotEligible), 'Total Revenue (₹)': fmtINR(gt.Total), _tot:true }
    : { RM: gt.RM, Team:'', '# Revenue-Based': fmtIN(gt.RevBased), '# Not Eligible': fmtIN(gt.NotEligible), 'Total Revenue (₹)': fmtINR(gt.Total), _tot:true };
  rows.push(gtRow);
  renderTable('#tbl-rmrev', headers, rows);
  drawRevChart();
}

function renderDashboard(){
  updateDashboardHeaderFilters();
  renderKPIs();
  renderLiveKPIs();
  renderStatusDistributionChart();
  renderPlatformMonth();
  renderStatusMonth();
  renderPlatformStatus();
  renderLandingPageStatus();
  renderTeam();
  renderRmTransfer();
  renderCampaignByTeam();
  renderIncome();
  renderCostSummary();
  renderCplRm();
  renderInProcessDataset();
  renderConvertedDataset();
  renderB2BTable();
  renderWorkshopStatus();
  requestAnimationFrame(attachAllMirrors);
}

function renderWorkshopStatus(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-workshop-status','fin23'); $('#legend-workshop-status').innerHTML=''; return; }
  const data = workshopStatusDistribution();
  applyHeatAndLegend(data, 'Total', '#legend-workshop-status', 'Row heat by Total');
  const headers = ['Person', ...STATUSES, 'Total', 'Lead Conversion Rate', 'Lead (In Process + Converted) Rate'];
  const rows = data.map(r => {
    const o = {Person: r.Person};
    STATUSES.forEach(s => o[s] = fmtIN(r[s]));
    o.Total = fmtIN(r.Total);
    o['Lead Conversion Rate'] = fmtPct(r['Lead Conversion Rate']);
    o['Lead (In Process + Converted) Rate'] = fmtPct(r['Quality Lead Rate']);
    o._tot = !!r._tot; o._heat = r._heat;
    return o;
  });
  renderTable('#tbl-workshop-status', headers, rows);
}

function renderAll(){
  renderDashboard();
  renderRMPerformance();
  renderMTD();
  renderCPC();
  renderProcessed();
  renderRawData();
  renderB2BRawData();
  renderEmployee();
  renderRMMaster();
  renderMissing();
  renderRMRev();
  renderBDPerformance();
  requestAnimationFrame(attachAllMirrors);
}

