// app-tables.js — Generic table renderer, heat-tier coloring, sortable tables.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

// ---- table renderer ----
function renderTable(host, headers, rows, opts={}){
  const fmt = opts.fmt || ((v)=>v);
  const rowClass = r => {
    const parts = [];
    if(r._tot) parts.push('grand');
    if(r._heat) parts.push('heat-'+r._heat);
    return parts.join(' ');
  };
  const html = `<table class="data ${opts.cls||''}">
    <thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr class="${rowClass(r)}">${headers.map(h=>`<td>${fmt(r[h],h,r)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`;
  if(typeof host==='string') $(host).innerHTML = html; else host.innerHTML = html;
}

// ---- heat tiers (quartile-based row highlighting) ----
function numFromCell(v){
  if(v==null) return 0;
  if(typeof v==='number') return v;
  const s = String(v).replace(/[^\d.-]/g,'');
  const n = parseFloat(s); return isNaN(n) ? 0 : n;
}
function applyHeat(rows, heatBy, opts={}){
  const invert = !!opts.invert; // invert=true → lower number gets 'high' tier (e.g. CPL)
  const valid = rows.filter(r => !r._tot);
  const vals = valid.map(r => numFromCell(r[heatBy])).slice().sort((a,b)=>a-b);
  if(vals.length < 2){ return rows; }
  const pick = q => vals[Math.min(vals.length-1, Math.max(0, Math.floor(vals.length*q)))];
  const q25 = pick(0.25), q50 = pick(0.50), q75 = pick(0.75);
  for(const r of valid){
    const v = numFromCell(r[heatBy]);
    let tier;
    if(v >= q75) tier = 'high';
    else if(v >= q50) tier = 'mid';
    else if(v >= q25) tier = 'low';
    else tier = 'vlow';
    if(invert){
      // flip the scale: best becomes worst
      tier = {high:'vlow', mid:'low', low:'mid', vlow:'high'}[tier];
    }
    r._heat = tier;
  }
  return rows;
}
// Every heated table applies the quartile heat tiers to its rows, then
// renders the matching legend, immediately before rendering the table
// itself. Consolidates that 2-call idiom (13 call sites).
function applyHeatAndLegend(rows, heatByField, legendSelector, legendLabel, invert=false){
  applyHeat(rows, heatByField, {invert});
  renderHeatLegend(legendSelector, legendLabel, invert);
}

function renderHeatLegend(host, metricLabel, invert){
  const el = typeof host==='string' ? $(host) : host;
  if(!el) return;
  const tiers = invert
    ? [['hl-high','Best (lowest 25%)'],['hl-mid','Good'],['hl-low','Below median'],['hl-vlow','Worst (top 25%)']]
    : [['hl-high','Top 25%'],['hl-mid','Above median'],['hl-low','Below median'],['hl-vlow','Bottom 25%']];
  el.innerHTML = '<div class="heat-legend">'
    + `<span class="hl-item" style="color:var(--text)">${escHtml(metricLabel)}:</span>`
    + tiers.map(([cls,lbl]) => `<span class="hl-item"><i class="hl-sw ${cls}"></i>${lbl}</span>`).join('')
    + '</div>';
}
function filterSummary(extra=''){
  const parts = ['Month: '+STATE.filterMonth, 'Ref+Cold: '+STATE.filterRefCold];
  const st = STATE.filterStatus;
  if(st && st !== 'All' && !(Array.isArray(st) && st.length === 0)){
    parts.push('Status: '+(Array.isArray(st) ? st.join(', ') : st));
  }
  if(extra) parts.push(extra);
  return '('+parts.join(' | ')+')';
}

// ---- sortable tables ----
const SORT_STATE = {};
function sortVal(v){
  if(v == null || v === '' || v === '—') return typeof v === 'string' ? '' : 0;
  const s = String(v).replace(/[₹,\s%]/g,'');
  const n = parseFloat(s);
  return isNaN(n) ? String(v).toLowerCase() : n;
}
function makeSortableTable(host, headers, rows, rerenderFn, opts={}){
  const id = typeof host==='string' ? host : '#el';
  if(!SORT_STATE[id]) SORT_STATE[id] = {col:null, dir:'desc'};
  const ss = SORT_STATE[id];
  let body = rows.filter(r=>!r._tot);
  const tots = rows.filter(r=>r._tot);
  if(ss.col){
    body = [...body].sort((a,b)=>{
      const av = sortVal(a[ss.col]), bv = sortVal(b[ss.col]);
      if(typeof av==='string'&&typeof bv==='string') return ss.dir==='asc'?av.localeCompare(bv):bv.localeCompare(av);
      return ss.dir==='asc' ? av-bv : bv-av;
    });
  }
  const sorted = [...body, ...tots];
  const rowClass = r => [r._tot?'grand':'', r._heat?'heat-'+r._heat:''].filter(Boolean).join(' ');
  const thHtml = headers.map(h=>{
    const icon = ss.col===h ? (ss.dir==='asc'?'▲':'▼') : '⇅';
    return `<th class="srt-th" data-col="${escHtml(h)}" style="cursor:pointer;user-select:none;white-space:nowrap">${escHtml(h)} <span style="opacity:0.45;font-size:10px">${icon}</span></th>`;
  }).join('');
  const bodyHtml = sorted.map(r=>`<tr class="${rowClass(r)}">${headers.map(h=>`<td>${r[h]??''}</td>`).join('')}</tr>`).join('');
  const el = typeof host==='string' ? $(host) : host;
  el.innerHTML = `<table class="data ${opts.cls||''}"><thead><tr>${thHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
  el.querySelectorAll('th.srt-th').forEach(th=>{
    th.onclick=()=>{
      const col=th.dataset.col;
      ss.col===col ? (ss.dir=ss.dir==='desc'?'asc':'desc') : (ss.col=col, ss.dir='desc');
      rerenderFn();
    };
  });
}
function updateDashboardHeaderFilters(){
  const summary = filterSummary();
  [
    '#hdr-platform-month',
    '#hdr-status-month',
    '#hdr-team',
    '#hdr-campaign-team',
    '#hdr-income',
    '#hdr-cost-summary',
    '#hdr-cpl-rm',
  ].forEach(sel => { const el = $(sel); if(el) el.textContent = summary; });
  const ps = $('#hdr-platform-status');
  if(ps) ps.textContent = filterSummary('Table: '+STATE.filterTable);
}

